use kdtree::{distance::squared_euclidean, KdTree};
use noise::{Curve, Fbm, HybridMulti, MultiFractal, Perlin, ScaleBias};
use voxelize::{
    Biome, Chunk, ChunkStage, NoiseParams, Resources, SeededNoise, Space, Terrain, TerrainLayer,
    Vec3, VoxelAccess, World, WorldConfig,
};

use log::info;

pub const MOUNTAIN_HEIGHT: f64 = 0.6;
pub const RIVER_HEIGHT: f64 = 0.20;
pub const PLAINS_HEIGHT: f64 = 0.24;
pub const RIVER_TO_PLAINS: f64 = 0.2;

pub const VARIANCE: f64 = 5.0;
pub const SNOW_HEIGHT: f64 = 0.6;
pub const STONE_HEIGHT: f64 = 0.5;

pub struct SoilingStage {
    noise: SeededNoise,
}

impl SoilingStage {
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededNoise::new(seed, params),
        }
    }
}

impl ChunkStage for SoilingStage {
    fn name(&self) -> String {
        "Water".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let config = resources.config;
        let registry = resources.registry;

        let water_level = config.water_level as i32;

        let water = registry.get_block_by_name("Water");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;

                for vy in 0..=(height.max(water_level)) {
                    // Fill in the water
                    let id = chunk.get_voxel(vx, vy, vz);

                    if registry.is_air(id) && vy < water_level {
                        chunk.set_voxel(vx, vy, vz, water.id);
                        continue;
                    }
                }
            }
        }

        chunk
    }
}

pub struct BaseTerrainStage {
    threshold: f64,
    base: u32,
    terrain: Terrain,
}

impl BaseTerrainStage {
    pub fn new(terrain: Terrain) -> Self {
        Self {
            threshold: 0.0,
            base: 0,
            terrain,
        }
    }

    pub fn set_base(&mut self, base: u32) {
        self.base = base;
    }

    pub fn set_threshold(&mut self, threshold: f64) {
        self.threshold = threshold;
    }
}

impl ChunkStage for BaseTerrainStage {
    fn name(&self) -> String {
        "Base Terrain".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        let registry = resources.registry;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in min_y..max_y {
                    let density = self.terrain.get_density_at(vx, vy, vz);
                    let biome = self.terrain.get_biome_at(vx, vz);

                    let block = registry.get_block_by_name(&biome.test_block);

                    if density > self.threshold {
                        chunk.set_voxel(vx, vy, vz, block.id);
                    }
                }
            }
        }

        chunk
    }
}

pub fn setup_terrain_world() -> World {
    let config = WorldConfig::new()
        .terrain(
            &NoiseParams::new()
                .frequency(0.005)
                .octaves(8)
                .persistence(0.5)
                .lacunarity(1.8623123)
                .build(),
        )
        .preload(true)
        .seed(12313)
        .build();

    let mut world = World::new("terrain", &config);

    let mut terrain = Terrain::new(&config);

    // let fb0: Fbm<Perlin> = Fbm::new(config.seed)
    //     .set_frequency(0.007)
    //     .set_lacunarity(2.22)
    //     .set_octaves(10)
    //     .set_persistence(0.5);

    // let bias: Curve<f64, Fbm<Perlin>, 2> = Curve::new(fb0.clone())
    //     .add_control_point(-1.0, MOUNTAIN_HEIGHT)
    //     .add_control_point(-RIVER_TO_PLAINS, RIVER_HEIGHT)
    //     .add_control_point(RIVER_TO_PLAINS, RIVER_HEIGHT)
    //     .add_control_point(1.0, PLAINS_HEIGHT);

    // let offset: Curve<f64, Fbm<Perlin>, 2> = Curve::new(fb0.clone())
    //     .add_control_point(-1.0, 3.5)
    //     .add_control_point(-RIVER_TO_PLAINS, 5.0)
    //     .add_control_point(RIVER_TO_PLAINS, 5.0)
    //     .add_control_point(1.0, 6.5);

    // let terrain: HybridMulti<Perlin> = HybridMulti::new(config.seed)
    //     .set_frequency(config.terrain.frequency)
    //     .set_lacunarity(config.terrain.lacunarity)
    //     .set_octaves(config.terrain.octaves)
    //     .set_persistence(config.terrain.persistence);

    // let offset_height = ScaleBias::new(offset).set

    let continentalness = TerrainLayer::new(
        "continentalness",
        &NoiseParams::new()
            .frequency(0.0035)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.8)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [0.0, 3.0], [0.4, 5.0], [1.0, 8.5]])
    .add_offset_points(&[
        [-10.0, MOUNTAIN_HEIGHT],
        [0.0, PLAINS_HEIGHT],
        [RIVER_TO_PLAINS, RIVER_HEIGHT],
        [RIVER_TO_PLAINS * 2.0, PLAINS_HEIGHT],
        [0.8, PLAINS_HEIGHT],
        [2.0, PLAINS_HEIGHT],
    ]);

    let rivers = TerrainLayer::new(
        "rivers",
        &NoiseParams::new()
            .frequency(0.0015)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.8)
            .seed(123123)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [1.0, 3.5]])
    .add_offset_points(&[
        [-2.0, MOUNTAIN_HEIGHT],
        [0.0, RIVER_HEIGHT],
        [2.0, MOUNTAIN_HEIGHT],
    ]);

    let oceans = TerrainLayer::new(
        "oceans",
        &NoiseParams::new()
            .frequency(0.0005)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.8)
            .seed(1233)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [1.0, 3.5]])
    .add_offset_points(&[[-10.0, MOUNTAIN_HEIGHT], [10.0, RIVER_HEIGHT]]);

    terrain.add_layer(&rivers, 0.8);
    terrain.add_layer(&oceans, 0.8);
    terrain.add_layer(&continentalness, 0.8);
    terrain.add_biome(&[1.0, 1.0, 1.0], Biome::new("Biome 0", "Biome Test 0"));
    terrain.add_biome(&[0.0, 0.0, 0.0], Biome::new("Biome 1", "Biome Test 1"));
    terrain.add_biome(&[-1.0, -1.0, -1.0], Biome::new("Biome 2", "Biome Test 2"));

    {
        let mut pipeline = world.pipeline_mut();

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        pipeline.add_stage(terrain_stage);

        // let biomes: Biomes<Biome> = Biomes::new(&config)
        //     .add_criterion("c0", &NoiseParams::new().frequency(0.008).seed(123).build())
        //     .add_criterion("c1", &NoiseParams::new().frequency(0.008).seed(245).build())
        //     .add_criterion("c2", &NoiseParams::new().frequency(0.010).seed(12).build())
        //     .add_biome(&[-1.0, -1.0, -1.0], Biome::new("ocean", "Biome Test 0"))
        //     .add_biome(&[1.0, 1.0, 1.0], Biome::new("plains", "Biome Test 1"))
        //     .add_biome(&[0.0, 0.0, 0.0], Biome::new("river", "Biome Test 2"))
        //     .add_biome(&[0.5, 0.5, 1.0], Biome::new("mountain", "Biome Test 3"));

        // pipeline.add_stage(BiomeStage { biomes });

        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseParams::new().frequency(0.04).lacunarity(3.0).build(),
        ));
    }

    world
}
