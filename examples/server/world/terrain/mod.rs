pub mod biomes;

use kdtree::{distance::squared_euclidean, KdTree};
use noise::{Curve, Fbm, HybridMulti, MultiFractal, Perlin, ScaleBias};
use serde::{Deserialize, Serialize};
use voxelize::{
    Biome, Chunk, ChunkStage, NoiseOptions, Resources, SeededNoise, Space, Terrain, TerrainLayer,
    Vec3, VoxelAccess, World, WorldConfig,
};

use log::info;

pub const MOUNTAIN_HEIGHT: f64 = 0.8;
pub const RIVER_HEIGHT: f64 = 0.15;
pub const PLAINS_HEIGHT: f64 = 0.247;
pub const RIVER_WIDTH: f64 = 0.36;

pub const VARIANCE: f64 = 5.0;
pub const SNOW_HEIGHT: f64 = 0.6;
pub const STONE_HEIGHT: f64 = 0.5;

pub struct SoilingStage {
    noise: SeededNoise,
}

impl SoilingStage {
    pub fn new(seed: u32, options: &NoiseOptions) -> Self {
        Self {
            noise: SeededNoise::new(seed, options),
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
                for vy in 0..(water_level as i32) {
                    chunk.set_voxel(vx, vy, vz, water.id);
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
                let (bias, offset) = self.terrain.get_bias_offset(vx, vz);

                for vy in min_y..max_y {
                    let density = self.terrain.get_density_from_bias_offset(bias, offset, vy);
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

#[derive(Serialize, Deserialize, Debug)]
struct TimeMethodPayload {
    time: f32,
}

pub fn setup_terrain_world() -> World {
    let config = WorldConfig::new()
        .terrain(
            &NoiseOptions::new()
                .frequency(0.005)
                .octaves(8)
                .persistence(0.5)
                .lacunarity(1.8623123)
                .build(),
        )
        .preload(true)
        .seed(42313)
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
    //     .add_control_point(-RIVER_WIDTH, RIVER_HEIGHT)
    //     .add_control_point(RIVER_WIDTH, RIVER_HEIGHT)
    //     .add_control_point(1.0, PLAINS_HEIGHT);

    // let offset: Curve<f64, Fbm<Perlin>, 2> = Curve::new(fb0.clone())
    //     .add_control_point(-1.0, 3.5)
    //     .add_control_point(-RIVER_WIDTH, 5.0)
    //     .add_control_point(RIVER_WIDTH, 5.0)
    //     .add_control_point(1.0, 6.5);

    // let terrain: HybridMulti<Perlin> = HybridMulti::new(config.seed)
    //     .set_frequency(config.terrain.frequency)
    //     .set_lacunarity(config.terrain.lacunarity)
    //     .set_octaves(config.terrain.octaves)
    //     .set_persistence(config.terrain.persistence);

    // let offset_height = ScaleBias::new(offset).set

    // The base shape of the terrain:
    // The more extreme (far from 0) the value, the more mountainous the terrain will be.
    // The closer to 0, the more plains-like the terrain will be.
    let continentalness = TerrainLayer::new(
        "continentalness",
        &NoiseOptions::new()
            .frequency(0.001)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(2.0)
            .seed(1231252)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [0.0, 3.0], [0.4, 5.0], [1.0, 8.5]])
    .add_offset_points(&[
        [-2.9, MOUNTAIN_HEIGHT],
        [-1.0, PLAINS_HEIGHT + 0.01],
        [0.0, PLAINS_HEIGHT],
        // [RIVER_WIDTH, PLAINS_HEIGHT],
        // [0.0, PLAINS_HEIGHT],
        [1.1, RIVER_HEIGHT],
        [2.8, 0.0],
        [5.6, MOUNTAIN_HEIGHT], // [5.7, MOUNTAIN_HEIGHT],
    ]);

    // The peaks and valleys of the terrain:
    // The higher the value, the more mountainous the terrain will be.
    // The lower the value, the more plains-like the terrain will be.
    let peaks_and_valleys = TerrainLayer::new(
        "peaks_and_valleys",
        &NoiseOptions::new()
            .frequency(0.003)
            .octaves(7)
            .persistence(0.56)
            .lacunarity(1.8)
            .seed(51287)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [1.0, 3.5]])
    .add_offset_points(&[
        [-3.0, RIVER_HEIGHT],
        [-2.0, PLAINS_HEIGHT],
        [-0.4, PLAINS_HEIGHT * 0.9],
        [0.0, RIVER_HEIGHT],
        [RIVER_WIDTH, RIVER_HEIGHT * 1.05],
        [2.0, PLAINS_HEIGHT + RIVER_HEIGHT],
        [5.0, MOUNTAIN_HEIGHT * 2.0],
    ]);

    let erosion = TerrainLayer::new(
        "erosion",
        &NoiseOptions::new()
            .frequency(0.01)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.9)
            .seed(1233)
            .build(),
    )
    .add_bias_points(&[[-1.0, 3.5], [1.0, 3.5]])
    .add_offset_points(&[[-1.0, MOUNTAIN_HEIGHT], [1.0, RIVER_HEIGHT / 2.0]]);

    terrain.add_layer(&continentalness, 1.0);
    terrain.add_layer(&peaks_and_valleys, 0.5);

    terrain.add_noise_layer(&erosion, 0.015);

    // ●	Continentalness (weight: 1.7)
    //  ●	1.0: Low terrain, most likely water
    //  ●	0.0: Shores between plains and water
    //  ●	-1.0: Land, from plains to high mountains
    // ●	Peaks and Valleys (weight: 1.0)
    //  ●	1.0: Mountains, quite drastic
    //  ●	0.0: Water, shore, rivers
    //  ●	-1.0: Plains, flatland
    // ●	Erosion (weight: 0.3)
    //  ●	1.0: Low, shores or sea.
    //  ●	0.0: Land, mountainous
    //  ●	-1.0: Mountain peaks

    let cap = 0.2;

    terrain.add_biome(&[0.0, 0.0, 0.0], Biome::new("Biome 0", "Biome Test 0"));

    terrain.add_biome(&[0.0, 0.0, cap], Biome::new("Biome 1", "Biome Test 1"));
    terrain.add_biome(&[0.0, cap, 0.0], Biome::new("Biome 2", "Biome Test 2"));
    terrain.add_biome(&[0.0, cap, cap], Biome::new("Biome 3", "Biome Test 3"));
    terrain.add_biome(&[cap, 0.0, 0.0], Biome::new("Biome 4", "Biome Test 4"));
    terrain.add_biome(&[cap, 0.0, cap], Biome::new("Biome 5", "Biome Test 5"));
    terrain.add_biome(&[cap, cap, 0.0], Biome::new("Biome 6", "Biome Test 6"));
    terrain.add_biome(&[cap, cap, cap], Biome::new("Biome 7", "Biome Test 7"));

    terrain.add_biome(&[0.0, 0.0, -cap], Biome::new("Biome 8", "Biome Test 8"));
    terrain.add_biome(&[0.0, -cap, 0.0], Biome::new("Biome 9", "Biome Test 9"));
    terrain.add_biome(&[0.0, -cap, -cap], Biome::new("Biome 10", "Biome Test 10"));
    terrain.add_biome(&[-cap, 0.0, 0.0], Biome::new("Biome 11", "Biome Test 11"));
    terrain.add_biome(&[-cap, 0.0, -cap], Biome::new("Biome 12", "Biome Test 12"));
    terrain.add_biome(&[-cap, -cap, 0.0], Biome::new("Biome 13", "Biome Test 13"));
    terrain.add_biome(&[-cap, -cap, -cap], Biome::new("Biome 14", "Biome Test 14"));

    terrain.add_biome(&[cap, cap, -cap], Biome::new("Biome 15", "Biome Test 15"));
    terrain.add_biome(&[cap, -cap, cap], Biome::new("Biome 16", "Biome Test 16"));
    terrain.add_biome(&[cap, -cap, -cap], Biome::new("Biome 17", "Biome Test 17"));
    terrain.add_biome(&[-cap, cap, cap], Biome::new("Biome 18", "Biome Test 18"));
    terrain.add_biome(&[-cap, cap, -cap], Biome::new("Biome 19", "Biome Test 19"));
    terrain.add_biome(&[-cap, -cap, cap], Biome::new("Biome 20", "Biome Test 20"));

    {
        let mut pipeline = world.pipeline_mut();

        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseOptions::new().frequency(0.04).lacunarity(3.0).build(),
        ));

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        pipeline.add_stage(terrain_stage);
    }

    world.set_method_handle("time", |world, _, payload| {
        let time_per_day = world.config().time_per_day as f32;
        let new_time: TimeMethodPayload = serde_json::from_str(&payload).unwrap();
        world.stats_mut().set_time(new_time.time % time_per_day);
    });

    world
}
