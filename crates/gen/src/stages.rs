//! ChunkStage adapters: the compiled generator installed into the engine's
//! existing pipeline as four terrain stages (shape, surface, carve,
//! populate) plus rivers and flora when the spec carries them. Stages
//! never request a `Space` and never emit cross-chunk changes — every
//! cross-chunk agreement is by pure re-derivation, so generation is
//! chunk-order-free by construction.
//!
//! One stage set serves both terrain spines: the generator dispatches
//! heights, slopes, and structure views to the topology lane or the
//! solved geology internally. Where a `DensitySpec` is present the shape
//! and surface stages stop assuming one contiguous solid run per column
//! and evaluate the banded 3D solid test instead.

use std::sync::Arc;

use voxelize::{Chunk, ChunkStage, Pipeline, Registry, Resources, Space, Vec3, VoxelAccess};

use crate::climate::BiomeId;
use crate::density::DensityColumn;
use crate::ecology::{CellCache, Env};
use crate::hydro::VoidMaterial;
use crate::mosaic::ColumnSample;
use crate::rivers::{RiverColumn, RiverPoint};
use crate::spec::CompiledGenerator;
use crate::stream::{cell_id, mix64, HashStream};
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
    if generator.geo().is_some() || generator.walker_rivers().is_some() {
        pipeline.add_stage(RiverStage {
            generator: Arc::clone(&generator),
        });
    }
    pipeline.add_stage(FloraStage { generator });
}

/// Per-chunk column context, re-derived by each stage from the pure model.
/// Heights come from one prefetched grid over whichever spine the world
/// runs on, so the surface and its slope probes never re-evaluate the
/// height stack per column.
struct ColumnCtx {
    min_x: i32,
    min_z: i32,
    width: usize,
    surfaces: Vec<i32>,
    steepness: Vec<f64>,
    biomes: Vec<BiomeId>,
    plans: Vec<Arc<StructurePlan>>,
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

        let grid = generator.terrain_grid((min_x, min_z), (max_x, max_z));
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

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let base = generator.base_block();
        // Solved lakes fill with the river water: geology worlds carry
        // river materials by construction.
        let water = generator
            .geo()
            .and(generator.river_material_ids())
            .map(|(water, _, _)| water);

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);

                let column = generator.density_column(x, z, ctx.steep(x, z));
                match generator.density() {
                    Some(density) if !column.is_inert() => {
                        // Banded 3D solid test: the column may carry
                        // recessed beds below its nominal surface and
                        // protruding beds above it, so no early break
                        // until the band is truly past.
                        let band = density.band().ceil() as i32;
                        let low = surface - band;
                        let high = surface + band;
                        for y in min_y..max_y {
                            let solid = y <= low
                                || (y < high && density.solid(x, y, z, surface, &column));
                            if solid {
                                chunk.set_voxel(x, y, z, base);
                                continue;
                            }
                            if y <= surface {
                                // A recessed pocket. Density never acts
                                // at or below the waterline, so this air
                                // is above local water by construction.
                                continue;
                            }
                            match generator.void_material(x, y, z, surface, 0) {
                                VoidMaterial::Fluid(fluid) => {
                                    chunk.set_voxel(x, y, z, fluid);
                                }
                                VoidMaterial::Air => {
                                    if y >= high {
                                        break;
                                    }
                                }
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

                // Solved lakes: tarns, valley ponds, rift floors. The
                // fill level comes from the final pit fill, so every
                // lake is a closed basin — water cannot hang over air.
                if let (Some(geo), Some(water)) = (generator.geo(), water) {
                    if let Some(level) = geo.lake_level(x, z) {
                        let top = (level.floor() as i32).min(max_y - 1);
                        for y in (surface + 1)..=top {
                            if y >= min_y && chunk.get_voxel(x, y, z) == 0 {
                                chunk.set_voxel(x, y, z, water);
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

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        let max_depth = generator.surface_max_depth();

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
                let steepness = ctx.steep(x, z);
                let biome = ctx.biome(x, z);
                let table = generator.biome_surface_table(biome);
                let mut surface_ctx = generator.surface_ctx(x, z, surface, steepness);

                // Solved lakes put their floor under fluid exactly like
                // the sea does.
                let lake = generator.geo().and_then(|geo| geo.lake_level(x, z));
                if lake.is_some() {
                    surface_ctx.is_under_fluid = true;
                }

                // Where density is active the paintable ground starts at
                // the column's top solid — which may sit above the
                // nominal surface (a protruding bed) — and stops at the
                // first air below it, so shelf undersides stay base rock.
                let column = generator.density_column(x, z, steepness);
                let active_density = match generator.density() {
                    Some(density) if !column.is_inert() => Some(density),
                    _ => None,
                };
                let top = match active_density {
                    Some(density) => {
                        let high = surface + density.band().ceil() as i32;
                        let mut top = surface;
                        let mut y = high - 1;
                        while y > surface {
                            if density.solid(x, y, z, surface, &column) {
                                top = y;
                                break;
                            }
                            y -= 1;
                        }
                        top
                    }
                    None => surface,
                };

                for depth in 0..max_depth {
                    let y = top - depth as i32;
                    if y < min_y {
                        break;
                    }
                    if let Some(density) = active_density {
                        if !density.solid(x, y, z, surface, &column) {
                            break;
                        }
                    }
                    let mut block = generator.surface_place(table, depth, y, &surface_ctx);
                    // The mosaic re-judges the exposed block only: dry
                    // land, depth zero.
                    if depth == 0 && !surface_ctx.is_under_fluid {
                        if let (Some(mosaic), Some(geo)) = (generator.mosaic(), generator.geo()) {
                            let aspect = geo.aspect(x, z);
                            let probe = mosaic.talus_probe();
                            let uphill_surface = if probe > 0 && aspect != (0.0, 0.0) {
                                let ux = x - (aspect.0 * probe as f64).round() as i32;
                                let uz = z - (aspect.1 * probe as f64).round() as i32;
                                geo.surface(ux, uz)
                            } else {
                                surface
                            };
                            let sample = ColumnSample {
                                surface: top,
                                steepness,
                                moisture: geo.moisture(x, z),
                                aspect,
                                uphill_surface,
                            };
                            block = mosaic.top_block(x, z, block, &sample);
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

/// River access unified over the two solvers.
enum RiverSource<'a> {
    Walker(&'a crate::rivers::CompiledRivers, &'a CompiledGenerator),
    Geo(&'a crate::geology::GeoModel),
    None,
}

impl RiverSource<'_> {
    fn sample(&self, x: i32, z: i32) -> Option<RiverPoint> {
        match self {
            RiverSource::Walker(rivers, generator) => {
                let height = |ix: i32, iz: i32| generator.surface_raw(ix, iz) as f64;
                rivers.sample(x, z, &height)
            }
            RiverSource::Geo(geo) => geo.river_sample(x, z),
            RiverSource::None => None,
        }
    }

    fn column(&self, point: &RiverPoint) -> RiverColumn {
        match self {
            RiverSource::Walker(rivers, _) => rivers.column(point),
            RiverSource::Geo(geo) => geo.river_column(point),
            RiverSource::None => RiverColumn::Outside,
        }
    }

    fn is_none(&self) -> bool {
        matches!(self, RiverSource::None)
    }
}

fn river_source(generator: &CompiledGenerator) -> RiverSource<'_> {
    if let Some(geo) = generator.geo() {
        return RiverSource::Geo(geo);
    }
    match generator.walker_rivers() {
        Some(rivers) => RiverSource::Walker(rivers, generator),
        None => RiverSource::None,
    }
}

pub struct RiverStage {
    generator: Arc<CompiledGenerator>,
}

impl RiverStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for RiverStage {
    fn name(&self) -> String {
        "gen:rivers".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let rivers = river_source(generator);
        if rivers.is_none() {
            return chunk;
        }
        let registry = resources.registry;
        let (water, bed_material, bank_material) = generator
            .river_material_ids()
            .expect("a world with rivers carries validated river materials");
        let base = generator.base_block();

        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let plans = generator.plans_in_reach((min_x, min_z), (max_x, max_z));

        for x in min_x..max_x {
            for z in min_z..max_z {
                let Some(point) = rivers.sample(x, z) else {
                    continue;
                };
                match rivers.column(&point) {
                    RiverColumn::Channel { bed, water_y } => {
                        let ground = generator.surface_raw(x, z);
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
                        // tufts placed by populate before this stage)
                        // would hang in the air over the channel.
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
                            // The dark bed only under a real water
                            // column; the one-layer fringe at the channel
                            // edge reads as shore, and a dark bed there
                            // would smear the river twice as wide as its
                            // water.
                            let material = if water_y - bed >= 3 { bed_material } else { bank_material };
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
                        let ground = generator.surface_raw(x, z);
                        if ground < raise_to {
                            // Containment levee: bank material up to one
                            // above the waterline, so channel water cannot
                            // hang over lower ground beside it.
                            for y in (ground + 1)..=raise_to.min(max_y - 1) {
                                if y >= min_y {
                                    chunk.set_voxel(x, y, z, bank_material);
                                }
                            }
                        } else if ground <= water_y + 2 && ground >= min_y && ground < max_y {
                            // Beach edge where the bank meets the water.
                            chunk.set_voxel(x, ground, z, bank_material);
                        }
                    }
                    RiverColumn::Outside => {}
                }
            }
        }
        chunk
    }
}

pub struct FloraStage {
    generator: Arc<CompiledGenerator>,
}

impl FloraStage {
    pub fn new(generator: Arc<CompiledGenerator>) -> Self {
        Self { generator }
    }
}

impl ChunkStage for FloraStage {
    fn name(&self) -> String {
        "gen:flora".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let registry = resources.registry;
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        let rivers = river_source(generator);

        // Trees stay out of structure plans: a grove must not grow through
        // a plaza.
        let plans = generator.plans_in_reach((min_x - 8, min_z - 8), (max_x + 8, max_z + 8));

        let river_dist = |ix: i32, iz: i32| -> f64 {
            rivers
                .sample(ix, iz)
                .map(|point| point.dist)
                .unwrap_or(f64::MAX)
        };
        // Trees stand on the river-shaped ground: a bank column was raised
        // by the river stage, so the trunk must start on the levee, not
        // under it. Lake floors get no trees.
        let surface = |ix: i32, iz: i32| -> i32 {
            let ground = generator.surface_raw(ix, iz);
            match rivers.sample(ix, iz).map(|point| rivers.column(&point)) {
                Some(RiverColumn::Bank { raise_to, .. }) => ground.max(raise_to),
                _ => ground,
            }
        };
        let steepness = |ix: i32, iz: i32| generator.steepness(ix, iz);
        let biome_key = |ix: i32, iy: i32, iz: i32| -> &'static str {
            let blend = generator.blend_at(ix, iz, iy);
            generator.biome_key(blend.primary)
        };
        // Moisture: the geology model's folded answer where a backbone
        // exists, river proximity alone on lane worlds.
        let lane_reach = generator
            .ecology()
            .map(|ecology| ecology.spec().lane_moisture_reach)
            .unwrap_or(0.0);
        let moisture = |ix: i32, iz: i32| -> f64 {
            match generator.geo() {
                Some(geo) => geo.moisture(ix, iz),
                None => {
                    if lane_reach <= 0.0 {
                        return 0.5;
                    }
                    let dist = river_dist(ix, iz);
                    (1.0 - dist / lane_reach).clamp(0.0, 1.0)
                }
            }
        };
        let env = Env {
            surface: &surface,
            steepness: &steepness,
            biome_key: &biome_key,
            river_dist: &river_dist,
            moisture: &moisture,
            sea_level: generator.sea_level(),
        };

        let is_lake = |ix: i32, iz: i32| -> bool {
            generator
                .geo()
                .map(|geo| geo.lake_level(ix, iz).is_some())
                .unwrap_or(false)
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
            let in_plan = plans.iter().any(|plan| {
                tree.x >= plan.bbox_min.0 - 2
                    && tree.x < plan.bbox_max.0 + 2
                    && tree.z >= plan.bbox_min.2 - 2
                    && tree.z < plan.bbox_max.2 + 2
            });
            // No trunks in lakes or river channels: the channel cut
            // removed the ground the tree thinks it stands on.
            let in_channel = matches!(
                rivers.sample(tree.x, tree.z).map(|p| rivers.column(&p)),
                Some(RiverColumn::Channel { .. })
            );
            if in_plan || in_channel || is_lake(tree.x, tree.z) {
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
            let floor_seed = generator.flora_floor_seed();
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
                    let mut stream =
                        HashStream::new(floor_seed ^ mix64(cell_id(x as i64, z as i64)));
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
                    if is_lake(x, z)
                        || matches!(
                            rivers.sample(x, z).map(|p| rivers.column(&p)),
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
