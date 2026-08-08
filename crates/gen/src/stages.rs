//! ChunkStage adapters: the compiled generator installed into the engine's
//! existing pipeline as four stages (shape, surface, carve, populate).
//! Stages never request a `Space` and never emit cross-chunk changes —
//! every cross-chunk agreement is by pure re-derivation, so generation is
//! chunk-order-free by construction.

use std::sync::Arc;

use voxelize::{Chunk, ChunkStage, Pipeline, Resources, Space, Vec3, VoxelAccess};

use crate::climate::BiomeId;
use crate::hydro::VoidMaterial;
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
    pipeline.add_stage(GenPopulateStage { generator });
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

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let generator = &self.generator;
        let ctx = ColumnCtx::build(generator, &chunk);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let base = generator.base_block();

        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = ctx.surface(x, z);
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
                let biome = ctx.biome(x, z);
                let table = generator.biome_surface_table(biome);
                let surface_ctx = generator.surface_ctx(x, z, surface, ctx.steep(x, z));
                for depth in 0..max_depth {
                    let y = surface - depth as i32;
                    if y < min_y {
                        break;
                    }
                    let block = generator.surface_place(table, depth, y, &surface_ctx);
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
