//! ChunkStage adapters: the compiled generator installed into the engine's
//! existing pipeline as shape, surface, carve, populate, and — when the
//! spec carries them — river and flora stages. Stages never request a
//! `Space` and never emit cross-chunk changes — every cross-chunk
//! agreement is by pure re-derivation, so generation is chunk-order-free
//! by construction, on either topology lane.

use std::sync::Arc;

use voxelize::{Chunk, ChunkStage, Pipeline, Resources, Space, Vec3, VoxelAccess};

use crate::climate::BiomeId;
use crate::ecology::{CellCache, Env};
use crate::hydro::VoidMaterial;
use crate::mosaic::ColumnSample;
use crate::rivers::RiverColumn;
use crate::spec::CompiledGenerator;
use crate::structures::{GroundPatch, StructurePlan};

pub fn install(pipeline: &mut Pipeline, generator: Arc<CompiledGenerator>) {
    pipeline.add_stage(GenShapeStage {
        generator: Arc::clone(&generator),
    });
    pipeline.add_stage(GenSurfaceStage {
        generator: Arc::clone(&generator),
    });
    pipeline.add_stage(GenCarveStage {
        generator: Arc::clone(&generator),
    });
    pipeline.add_stage(GenPopulateStage {
        generator: Arc::clone(&generator),
    });
    if generator.river_system().is_some() {
        pipeline.add_stage(GenRiverStage {
            generator: Arc::clone(&generator),
        });
    }
    if generator.has_flora() {
        pipeline.add_stage(GenFloraStage { generator });
    }
}

/// Per-chunk column context, re-derived by each stage from the pure model.
/// Lane heights come from one prefetched halo grid, so the surface and its
/// slope probes never re-evaluate the height stack per column.
struct ColumnCtx {
    min_x: i32,
    min_z: i32,
    width: usize,
    surfaces: Vec<i32>,
    steepness: Vec<f64>,
    biomes: Vec<BiomeId>,
    plans: Vec<Arc<StructurePlan>>,
    patches: Vec<GroundPatch>,
}

impl ColumnCtx {
    fn build(generator: &CompiledGenerator, chunk: &Chunk) -> Self {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        let width = (max_x - min_x) as usize;
        let depth = (max_z - min_z) as usize;

        let plans = generator.plans_in_reach((min_x, min_z), (max_x, max_z));
        let patches: Vec<GroundPatch> = plans
            .iter()
            .filter_map(|plan| plan.ground_patch.clone())
            .collect();

        let grid = generator.lane_grid((min_x, min_z), (max_x, max_z));
        let mut surfaces = Vec::with_capacity(width * depth);
        let mut steepness = Vec::with_capacity(width * depth);
        let mut biomes = Vec::with_capacity(width * depth);
        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = generator.adapt_surface(grid.surface_raw(x, z), x, z, &patches);
                let blend = generator.blend_at(x, z, surface);
                surfaces.push(surface);
                steepness.push(grid.steepness(x, z));
                biomes.push(generator.dithered_biome(x, z, &blend));
            }
        }

        Self {
            min_x,
            min_z,
            width,
            surfaces,
            steepness,
            biomes,
            plans,
            patches,
        }
    }

    #[inline]
    fn slot(&self, x: i32, z: i32) -> usize {
        ((x - self.min_x) as usize) * self.width + (z - self.min_z) as usize
    }

    fn surface(&self, x: i32, z: i32) -> i32 {
        self.surfaces[self.slot(x, z)]
    }

    fn steep(&self, x: i32, z: i32) -> f64 {
        self.steepness[self.slot(x, z)]
    }

    fn biome(&self, x: i32, z: i32) -> BiomeId {
        self.biomes[self.slot(x, z)]
    }

    /// Whether a structure claims this column: the 3D density term is
    /// silenced here so plans keep the ground their platform adapted.
    fn is_structure_column(&self, x: i32, z: i32) -> bool {
        self.plans.iter().any(|plan| {
            x >= plan.bbox_min.0 - 1
                && x < plan.bbox_max.0 + 1
                && z >= plan.bbox_min.2 - 1
                && z < plan.bbox_max.2 + 1
        }) || self.patches.iter().any(|patch| {
            let falloff = patch.falloff.max(1) as i32;
            x >= patch.min_x - falloff
                && x < patch.max_x + falloff
                && z >= patch.min_z - falloff
                && z < patch.max_z + falloff
        })
    }
}

pub struct GenShapeStage {
    generator: Arc<CompiledGenerator>,
}

impl GenShapeStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenShapeStage {
    fn name(&self) -> String {
        "gen:shape".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let base = generator.base_block();
        let sea = generator.sea_level();

        let density = generator.density();
        let lattice = density.map(|density| {
            let band = density.band();
            let lowest = ctx.surfaces.iter().copied().min().unwrap_or(min_y) - band;
            let highest = ctx.surfaces.iter().copied().max().unwrap_or(max_y) + band;
            density.build_lattice(
                (min_x, lowest.max(min_y), min_z),
                (max_x, (highest + 1).min(max_y), max_z),
            )
        });

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
                match (density, &lattice) {
                    (Some(density), Some(lattice)) => {
                        let band = density.band();
                        let mask = if ctx.is_structure_column(x, z) {
                            0.0
                        } else {
                            density.mask_at(x, z)
                        };
                        // Above both the band and the sea nothing remains
                        // but air; the loop stops there.
                        let top_bound = (surface + band).max(sea.unwrap_or(i32::MIN));
                        for y in min_y..max_y {
                            if y > top_bound {
                                break;
                            }
                            let is_solid =
                                density.is_solid(lattice, x, y, z, surface, mask, sea);
                            if is_solid {
                                chunk.set_voxel(x, y, z, base);
                            } else if let VoidMaterial::Fluid(fluid) =
                                generator.void_material(x, y, z, surface, 0)
                            {
                                chunk.set_voxel(x, y, z, fluid);
                            }
                        }
                    }
                    _ => {
                        for y in min_y..max_y {
                            if y <= surface {
                                chunk.set_voxel(x, y, z, base);
                            } else {
                                match generator.void_material(x, y, z, surface, 0) {
                                    VoidMaterial::Fluid(fluid) => {
                                        chunk.set_voxel(x, y, z, fluid);
                                    }
                                    VoidMaterial::Air => break,
                                }
                            }
                        }
                    }
                }

                // Solved lakes (geology lane): tarns, valley ponds, rift
                // floors. The level comes from the final pit fill, so
                // every lake is a closed basin — water cannot hang over
                // air. Contested seam basins already answered dry.
                if let Some(level) = generator.lake_level(x, z) {
                    if let Some(fluid) = generator.sea_fluid() {
                        let top = (level.floor() as i32).min(max_y - 1);
                        for y in (surface + 1)..=top {
                            if y >= min_y && chunk.get_voxel(x, y, z) == 0 {
                                chunk.set_voxel(x, y, z, fluid);
                            }
                        }
                    }
                }
            }
        }
        chunk
    }
}

pub struct GenSurfaceStage {
    generator: Arc<CompiledGenerator>,
}

impl GenSurfaceStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenSurfaceStage {
    fn name(&self) -> String {
        "gen:surface".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let registry = resources.registry;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        let max_depth = generator.surface_max_depth();
        let sea = generator.sea_level();
        let is_density = generator.density().is_some();

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
                let biome = ctx.biome(x, z);
                let table = generator.biome_surface_table(biome);
                let steepness = ctx.steep(x, z);
                let lake = generator.lake_level(x, z);
                let is_under_fluid =
                    sea.map(|s| surface < s).unwrap_or(false) || lake.is_some();
                let surface_ctx =
                    generator.surface_ctx(x, z, steepness, is_under_fluid);
                for depth in 0..max_depth {
                    let y = surface - depth as i32;
                    if y < min_y {
                        break;
                    }
                    // A density undercut may have opened this voxel (to
                    // air, or to water in the coastal notch band); the
                    // rules only repaint ground that exists.
                    if is_density {
                        let current = chunk.get_voxel(x, y, z);
                        if current == 0 || registry.is_fluid(current) {
                            continue;
                        }
                    }
                    let mut block = generator.surface_place(table, depth, y, &surface_ctx);
                    if depth == 0 && !is_under_fluid {
                        if let Some(mosaic) = generator.mosaic() {
                            let aspect = generator.aspect_at(x, z);
                            let probe = mosaic.talus_probe();
                            let uphill_surface = if probe > 0 && aspect != (0.0, 0.0) {
                                let ux = x - (aspect.0 * probe as f64).round() as i32;
                                let uz = z - (aspect.1 * probe as f64).round() as i32;
                                generator.surface_raw(ux, uz)
                            } else {
                                surface
                            };
                            block = mosaic.top_block(
                                x,
                                z,
                                block,
                                &ColumnSample {
                                    surface,
                                    steepness,
                                    moisture: generator.moisture_at(x, z),
                                    aspect,
                                    uphill_surface,
                                },
                            );
                        }
                    }
                    chunk.set_voxel(x, y, z, block);
                }
            }
        }
        chunk
    }
}

pub struct GenCarveStage {
    generator: Arc<CompiledGenerator>,
}

impl GenCarveStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenCarveStage {
    fn name(&self) -> String {
        "gen:carve".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        if !generator.has_carvers() {
            return chunk;
        }
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let max_surface = ctx.surfaces.iter().copied().max().unwrap_or(0);
        let lattices = generator.build_carve_lattices(
            (min_x, min_y.max(0), min_z),
            (max_x, max_surface + 2, max_z),
        );

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
                let mask = generator.biome_carver_mask(ctx.biome(x, z));
                if mask == 0 {
                    continue;
                }
                let steepness = ctx.steep(x, z);
                for y in (min_y + 2)..=surface {
                    if !generator.is_carved(&lattices, x, y, z, surface, steepness, mask) {
                        continue;
                    }
                    if generator.structures().is_protected(&ctx.plans, x, y, z) {
                        continue;
                    }
                    let roof = surface - y;
                    match generator.void_material(x, y, z, surface, roof) {
                        VoidMaterial::Fluid(fluid) => chunk.set_voxel(x, y, z, fluid),
                        VoidMaterial::Air => chunk.set_voxel(x, y, z, 0),
                    };
                }
            }
        }
        chunk
    }
}

pub struct GenPopulateStage {
    generator: Arc<CompiledGenerator>,
}

impl GenPopulateStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenPopulateStage {
    fn name(&self) -> String {
        "gen:populate".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        for plan in &ctx.plans {
            generator.structures().apply_slice(
                plan,
                (min_x, min_y, min_z),
                (max_x, max_y, max_z),
                &mut |x, y, z, block| {
                    chunk.set_voxel(x, y, z, block);
                },
            );
        }

        let registry = resources.registry;
        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
                if surface + 1 >= max_y || surface < min_y {
                    continue;
                }
                let ground = chunk.get_voxel(x, surface, z);
                if registry.is_air(ground) || registry.is_fluid(ground) {
                    continue;
                }
                if chunk.get_voxel(x, surface + 1, z) != 0 {
                    continue;
                }
                if let Some(block) = generator.dressing_at(ctx.biome(x, z), x, z) {
                    chunk.set_voxel(x, surface + 1, z, block);
                }
            }
        }
        chunk
    }
}

/// Re-cuts the built terrain along the solved channels: carve the eased
/// bed, keep a waterproof floor under it, contain the waterline behind
/// bank levees, and fill the channel with the spec's water. Runs after
/// populate so the cut clears hanging dressing; structure plans stay
/// protected.
pub struct GenRiverStage {
    generator: Arc<CompiledGenerator>,
}

impl GenRiverStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenRiverStage {
    fn name(&self) -> String {
        "gen:rivers".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let Some(system) = generator.river_system() else {
            return chunk;
        };
        let registry = resources.registry;
        let (water, bed_block, bank_block) = (system.water, system.bed, system.bank);
        let base = generator.base_block();

        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let plans = generator.plans_in_reach((min_x, min_z), (max_x, max_z));
        let grid = generator.lane_grid((min_x, min_z), (max_x, max_z));

        for x in min_x..max_x {
            for z in min_z..max_z {
                let Some(point) = generator.river_sample(x, z) else {
                    continue;
                };
                match generator.river_column(&point) {
                    RiverColumn::Channel { bed, water_y } => {
                        let ground = grid.surface_raw(x, z);
                        let cut_top = ground.max(water_y).min(max_y - 1);
                        for y in (bed + 1)..=cut_top {
                            if y < min_y {
                                continue;
                            }
                            if generator.structures().is_protected(&plans, x, y, z) {
                                continue;
                            }
                            chunk.set_voxel(x, y, z, 0);
                        }
                        // Dressing above the cut column (flowers, grass
                        // tufts placed by populate) would hang in the air
                        // over the channel.
                        for y in (cut_top + 1)..=(cut_top + 2).min(max_y - 1) {
                            if y < min_y {
                                continue;
                            }
                            let above = chunk.get_voxel(x, y, z);
                            if above != 0 {
                                let block = registry.get_block_by_id(above);
                                if block.is_passable && !block.is_fluid {
                                    chunk.set_voxel(x, y, z, 0);
                                }
                            }
                        }
                        // Waterproof floor: a carver that opened the bed
                        // must not drain the channel into a cave.
                        for y in (bed - 2)..=bed {
                            if y >= min_y && y < max_y && chunk.get_voxel(x, y, z) == 0 {
                                chunk.set_voxel(x, y, z, base);
                            }
                        }
                        if bed >= min_y && bed < max_y {
                            // The dark bed only under a real water column;
                            // the one-layer fringe at the channel edge
                            // reads as shore.
                            let material = if water_y - bed >= 3 { bed_block } else { bank_block };
                            chunk.set_voxel(x, bed, z, material);
                        }
                        let fill_top = water_y.min(max_y - 1);
                        for y in (bed + 1)..=fill_top {
                            if y < min_y {
                                continue;
                            }
                            if generator.structures().is_protected(&plans, x, y, z) {
                                continue;
                            }
                            chunk.set_voxel(x, y, z, water);
                        }
                    }
                    RiverColumn::Bank { raise_to, water_y } => {
                        let ground = grid.surface_raw(x, z);
                        if ground < raise_to {
                            // Containment levee: bank material up to one
                            // above the waterline, so channel water cannot
                            // hang over lower ground beside it.
                            for y in (ground + 1)..=raise_to.min(max_y - 1) {
                                if y >= min_y {
                                    chunk.set_voxel(x, y, z, bank_block);
                                }
                            }
                        } else if ground <= water_y + 2 && ground >= min_y && ground < max_y {
                            chunk.set_voxel(x, ground, z, bank_block);
                        }
                    }
                    RiverColumn::Outside => {}
                }
            }
        }
        chunk
    }
}

/// Plants trees and community understory: azonal sets and ecology
/// canopies place on deterministic cluster lattices, stamps re-derive
/// identically from both sides of a chunk border, trunks stay out of
/// structures, channels, and lakes.
pub struct GenFloraStage {
    generator: Arc<CompiledGenerator>,
}

impl GenFloraStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for GenFloraStage {
    fn name(&self) -> String {
        "gen:flora".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        if !generator.has_flora() {
            return chunk;
        }
        let registry = resources.registry;
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        let plans = generator.plans_in_reach((min_x - 8, min_z - 8), (max_x + 8, max_z + 8));

        let river_dist = |ix: i32, iz: i32| -> f64 { generator.river_distance(ix, iz) };
        // Trees stand on the river-shaped, density-shaped ground: a bank
        // column was raised by the river stage, a density undercut lowers
        // the top solid, so the trunk roots where ground actually is.
        let surface = |ix: i32, iz: i32| -> i32 {
            let ground = generator.ground_at(ix, iz);
            match generator
                .river_sample(ix, iz)
                .map(|point| generator.river_column(&point))
            {
                Some(RiverColumn::Bank { raise_to, .. }) => ground.max(raise_to),
                _ => ground,
            }
        };
        let steepness = |ix: i32, iz: i32| generator.steepness(ix, iz);
        let biome_key = |ix: i32, iy: i32, iz: i32| -> &'static str {
            let blend = generator.blend_at(ix, iz, iy);
            generator.biome_key(blend.primary)
        };
        let moisture = |ix: i32, iz: i32| generator.moisture_at(ix, iz);
        let env = Env {
            surface: &surface,
            steepness: &steepness,
            biome_key: &biome_key,
            river_dist: &river_dist,
            moisture: &moisture,
            sea_level: generator.sea_level(),
        };

        let mut cell_cache = CellCache::default();
        let trees = generator.flora().trees_in(
            (min_x, min_z),
            (max_x, max_z),
            &env,
            generator.ecology(),
            &mut cell_cache,
        );

        for tree in &trees {
            let is_in_plan = plans.iter().any(|plan| {
                tree.x >= plan.bbox_min.0 - 2
                    && tree.x < plan.bbox_max.0 + 2
                    && tree.z >= plan.bbox_min.2 - 2
                    && tree.z < plan.bbox_max.2 + 2
            });
            let is_in_channel = matches!(
                generator
                    .river_sample(tree.x, tree.z)
                    .map(|p| generator.river_column(&p)),
                Some(RiverColumn::Channel { .. })
            );
            if is_in_plan || is_in_channel || generator.lake_level(tree.x, tree.z).is_some() {
                continue;
            }
            generator.flora().stamp(tree, &mut |x, y, z, block, is_soft| {
                if x < min_x || x >= max_x || z < min_z || z >= max_z || y < min_y || y >= max_y {
                    return;
                }
                let current = chunk.get_voxel(x, y, z);
                if is_soft {
                    if current == 0 {
                        chunk.set_voxel(x, y, z, block);
                    }
                } else {
                    // Trunks claim air and passable dressing (grass tufts,
                    // flowers), never terrain, fluids, or structures.
                    let is_replaceable = current == 0 || {
                        let existing = registry.get_block_by_id(current);
                        existing.is_passable && !existing.is_fluid
                    };
                    if is_replaceable {
                        chunk.set_voxel(x, y, z, block);
                    }
                }
            });
        }

        // The community floor: understory where a community owns the
        // ground. Runs after trunks so shrubs and ferns fill between
        // trees, writes only into air above solid ground, and boosts
        // inside the riparian band.
        if let Some(ecology) = generator.ecology() {
            let floor_seed = generator.floor_seed();
            for x in min_x..max_x {
                for z in min_z..max_z {
                    let Some(owner) = ecology.owner_at(x, z, &env, &mut cell_cache) else {
                        continue;
                    };
                    let community = &ecology.communities()[owner.community];
                    let floor = &community.floor;
                    if floor.plants.is_empty() || floor.density <= 0.0 {
                        continue;
                    }
                    let mut stream = crate::stream::HashStream::new(
                        floor_seed ^ crate::stream::mix64(crate::stream::cell_id(x as i64, z as i64)),
                    );
                    let mut density = floor.density;
                    if floor.riparian_band > 0.0 && river_dist(x, z) <= floor.riparian_band {
                        density = (density * floor.riparian_boost).min(1.0);
                    }
                    if stream.unit() > density {
                        continue;
                    }
                    let ground_y = surface(x, z);
                    if ground_y < min_y || ground_y + 1 >= max_y {
                        continue;
                    }
                    if let Some(sea) = generator.sea_level() {
                        if ground_y <= sea {
                            continue;
                        }
                    }
                    if generator.lake_level(x, z).is_some()
                        || matches!(
                            generator
                                .river_sample(x, z)
                                .map(|p| generator.river_column(&p)),
                            Some(RiverColumn::Channel { .. })
                        )
                    {
                        continue;
                    }
                    let ground = chunk.get_voxel(x, ground_y, z);
                    if registry.is_air(ground) || registry.is_fluid(ground) {
                        continue;
                    }
                    if chunk.get_voxel(x, ground_y + 1, z) != 0 {
                        continue;
                    }
                    if generator.structures().is_protected(&plans, x, ground_y + 1, z) {
                        continue;
                    }
                    let block = generator.floor_plant(owner.community, &mut stream);
                    if block != 0 {
                        chunk.set_voxel(x, ground_y + 1, z, block);
                    }
                }
            }
        }
        chunk
    }
}
