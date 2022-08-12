use voxelize::{
    BaseTerrainStage, Chunk, ChunkStage, HeightMapStage, NoiseParams, Resources, SeededNoise,
    Space, Terrain, TerrainLayer, Tree, Trees, Vec3, VoxelAccess, World, WorldConfig,
};

const MOUNTAIN_HEIGHT: f64 = 0.9;
const RIVER_HEIGHT: f64 = 0.20;
const PLAINS_HEIGHT: f64 = 0.24;
const RIVER_TO_PLAINS: f64 = 0.06;

const VARIANCE: f64 = 3.0;
const SNOW_HEIGHT: i32 = 90;
const STONE_HEIGHT: i32 = 80;

struct SoilingStage {
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
        let sand = registry.get_block_by_name("Sand");
        let dirt = registry.get_block_by_name("Dirt");
        let stone = registry.get_block_by_name("Stone");
        let grass_block = registry.get_block_by_name("Grass Block");
        let snow = registry.get_block_by_name("Snow");
        let grass = registry.get_block_by_name("Grass");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;

                let snow_height = SNOW_HEIGHT + (self.noise.get2d(vx, vz) * VARIANCE) as i32;
                let stone_height = STONE_HEIGHT + (self.noise.get2d(vx, vz) * VARIANCE) as i32;

                for vy in 0..=(height.max(water_level)) {
                    let depth = 2;

                    // Fill in the water
                    let id = chunk.get_voxel(vx, vy, vz);

                    if registry.is_air(id) && vy < water_level {
                        chunk.set_voxel(vx, vy, vz, water.id);
                        continue;
                    }

                    if height > water_level {
                        if vy >= height - depth {
                            if vy > snow_height {
                                chunk.set_voxel(vx, vy, vz, snow.id);
                            } else if vy > stone_height {
                                chunk.set_voxel(vx, vy, vz, stone.id);
                            } else {
                                if vy == height {
                                    chunk.set_voxel(vx, vy, vz, grass_block.id);
                                } else {
                                    chunk.set_voxel(vx, vy, vz, dirt.id);
                                }
                            }
                        }

                        if vy == height {
                            if self.noise.get3d(vx, vy, vz) > 1.0
                                && chunk.get_voxel(vx, vy, vz) == grass_block.id
                            {
                                chunk.set_voxel(vx, vy + 1, vz, grass.id);
                            }
                        }
                    } else if chunk.get_voxel(vx, vy, vz) != water.id
                        && vy <= height
                        && vy >= height - depth
                    {
                        if self.noise.get3d(vx, vy, vz) > 1.0 {
                            chunk.set_voxel(vx, vy, vz, stone.id);
                        } else {
                            chunk.set_voxel(vx, vy, vz, sand.id);
                        }
                    }
                }
            }
        }

        chunk
    }
}

struct TreeStage {
    threshold: f64,
    noise: SeededNoise,
    trees: Trees,
}

impl TreeStage {
    pub fn new(seed: u32, threshold: f64, params: &NoiseParams, trees: Trees) -> Self {
        Self {
            threshold,
            noise: SeededNoise::new(seed, params),
            trees,
        }
    }
}

impl ChunkStage for TreeStage {
    fn name(&self) -> String {
        "Trees".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, space: Option<Space>) -> Chunk {
        let leaves = resources.registry.get_block_by_name("Oak Leaves");
        let trunk = resources.registry.get_block_by_name("Oak Log");

        for vx in chunk.min.0..chunk.max.0 {
            for vz in chunk.min.2..chunk.max.2 {
                let height = chunk.get_max_height(vx, vz) as i32;

                if self.noise.get2d(vx, vz) > self.threshold {
                    self.trees
                        .generate("Oak", &Vec3(vx, height, vz))
                        .into_iter()
                        .for_each(|(Vec3(ux, uy, uz), id)| {
                            chunk.set_voxel(ux, uy, uz, id);
                        });
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

    let mut terrain = Terrain::new(&config);

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

    {
        let mut pipeline = world.pipeline_mut();

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        let oak = Tree::new(44, 43).leaf_height(2).leaf_radius(2).build();
        let mut trees = Trees::new(
            config.seed,
            &NoiseParams::new().frequency(0.04).lacunarity(2.9).build(),
        );
        trees.register("Oak", oak);

        pipeline.add_stage(terrain_stage);
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseParams::new().frequency(0.04).lacunarity(3.0).build(),
        ));
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(TreeStage::new(
            config.seed,
            3.5,
            &NoiseParams::new().build(),
            trees,
        ));
    }

    world
}
