use voxelize::{
    BaseTerrainStage, Chunk, ChunkStage, HeightMapStage, NoiseParams, Resources, SeededNoise,
    Space, TerrainLayer, VoxelAccess, World, WorldConfig,
};

const MOUNTAIN_HEIGHT: f64 = 0.9;
const RIVER_HEIGHT: f64 = 0.20;
const PLAINS_HEIGHT: f64 = 0.24;
const RIVER_TO_PLAINS: f64 = 0.06;

struct WaterStage {
    noise: SeededNoise,
}

impl WaterStage {
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededNoise::new(seed, params),
        }
    }
}

impl ChunkStage for WaterStage {
    fn name(&self) -> String {
        "Water".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let config = resources.config;
        let registry = resources.registry;

        let water_level = config.water_level as i32;
        let max_height = config.max_height as i32;

        let water = registry.get_block_by_name("Water");
        let sand = registry.get_block_by_name("Sand");
        let dirt = registry.get_block_by_name("Dirt");
        let stone = registry.get_block_by_name("Stone");
        let grass = registry.get_block_by_name("Grass");
        let snow = registry.get_block_by_name("Snow");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;
                let mut was_air = false;

                for vy in 0..max_height {
                    let id = chunk.get_voxel(vx, vy, vz);
                    let is_air = registry.is_air(id);

                    if is_air && vy < water_level {
                        chunk.set_voxel(vx, vy, vz, water.id);
                        continue;
                    }

                    if height < water_level {
                        chunk.set_voxel(vx, height, vz, sand.id);
                        continue;
                    }

                    let relative_height = if is_air && !was_air && vy < height {
                        vy
                    } else {
                        height
                    };

                    let snow_height = 90;
                    let stone_height = 80;

                    let should_snow_stone = self.noise.get2d(vx, vz) > 0.0;

                    if should_snow_stone {
                        if vy == relative_height {
                            if vy >= snow_height {
                                chunk.set_voxel(vx, vy, vz, snow.id);
                            } else if vy >= stone_height {
                                chunk.set_voxel(vx, vy, vz, stone.id);
                            } else {
                                chunk.set_voxel(vx, vy, vz, grass.id);
                            }
                        }
                    } else if vy >= height - 2 && vy < relative_height {
                        chunk.set_voxel(vx, vy, vz, dirt.id);
                    }

                    was_air = is_air;
                }
            }
        }

        chunk
    }
}

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        .terrain(
            &NoiseParams::new()
                .frequency(0.005)
                .octaves(8)
                .persistence(0.5)
                .lacunarity(1.8623123)
                .build(),
        )
        .seed(1213123)
        .build();

    let mut world = World::new("world1", &config);

    {
        let mut terrain = world.terrain_mut();

        let continentalness = TerrainLayer::new(
            "continentalness",
            &NoiseParams::new()
                .frequency(0.0035)
                .octaves(7)
                .persistence(0.5)
                .lacunarity(1.8)
                .build(),
        )
        .add_bias_points(&[[-1.0, 3.0], [0.0, 2.0], [1.0, 3.0]])
        .add_offset_points(&[
            [-1.0, MOUNTAIN_HEIGHT + RIVER_HEIGHT],
            [-RIVER_TO_PLAINS, PLAINS_HEIGHT],
            [0.0, RIVER_HEIGHT],
            [RIVER_TO_PLAINS, PLAINS_HEIGHT],
            [1.0, PLAINS_HEIGHT],
        ]);

        terrain.add_layer(&continentalness, 0.8);
    }

    {
        let mut pipeline = world.pipeline_mut();

        pipeline.add_stage(BaseTerrainStage::new(0.0, 2));
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(WaterStage::new(
            config.seed,
            &NoiseParams::new().frequency(0.1).build(),
        ));
    }

    world
}
