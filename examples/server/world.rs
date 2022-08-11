use voxelize::{
    BaseTerrainStage, Chunk, ChunkStage, DebugStage, FlatlandStage, NoiseParams, Resources,
    SeededNoise, Space, SplineMap, TerrainLayer, Vec3, VoxelAccess, World, WorldConfig,
};

struct TerrainStage {
    noise: SeededNoise,
    map: SplineMap,
}

impl TerrainStage {
    fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededNoise::new(seed, params),
            map: SplineMap::default(),
        }
    }

    fn add_control_points(&mut self, points: &[[f64; 2]]) {
        points.iter().for_each(|[t, value]| {
            self.map.add(*t, *value);
        });
    }
}

const RIVER_DEPTH: f64 = 50.0;

impl ChunkStage for TerrainStage {
    fn name(&self) -> String {
        "River".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let value = self.noise.get2d(vx, vz);
                let height = (self.map.sample(value) * RIVER_DEPTH) as i32;

                for vy in 0..height {
                    chunk.set_voxel(vx, vy, vz, resources.registry.get_block_by_name("Stone").id);
                }
            }
        }

        chunk
    }
}

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        // .min_chunk([-20, -20])
        // .max_chunk([20, 20])
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
                .frequency(0.001)
                .octaves(7)
                .persistence(0.5)
                .lacunarity(1.4)
                .build(),
        )
        .add_bias_points(&[[-1.0, 2.0], [0.0, 3.0], [1.0, 4.0]])
        .add_offset_points(&[
            [-1.0, 0.9],
            [-0.9, 0.1],
            [-0.4, 0.1],
            [-0.3, 0.4],
            [-0.1, 0.4],
            [0.0, 0.75],
            [0.05, 0.8],
            [0.3, 0.83],
            [1.0, 0.9],
        ]);

        let erosion = TerrainLayer::new(
            "erosion",
            &NoiseParams::new()
                .frequency(0.0004)
                .octaves(7)
                .persistence(0.5)
                .lacunarity(1.2)
                .build(),
        )
        .add_bias_points(&[[-1.0, 2.0], [0.0, 2.0], [1.0, 2.0]])
        .add_offset_points(&[
            [-1.0, 1.2],
            [-0.7, 0.7],
            [-0.4, 0.5],
            [-0.35, 0.55],
            [0.0, 0.3],
            [0.5, 0.26],
            [0.53, 0.4],
            [0.73, 0.4],
            [0.75, 0.25],
            [1.0, 0.1],
        ]);

        let peaks_and_valleys = TerrainLayer::new(
            "peaks_and_valleys",
            &NoiseParams::new()
                .frequency(0.044)
                .octaves(7)
                .persistence(0.5)
                .lacunarity(1.2)
                .ridged(true)
                .build(),
        )
        .add_bias_points(&[[-1.0, 1.2], [0.0, 1.4], [1.0, 4.0]])
        .add_offset_points(&[
            [-0.8, 0.2],
            [-0.2, 0.35],
            [0.0, 0.3],
            [0.45, 0.45],
            [1.0, 0.5],
        ]);

        terrain.add_layer(&continentalness, 0.5);
        terrain.add_layer(&erosion, 0.5);
        terrain.add_layer(&peaks_and_valleys, 0.3);
    }

    {
        let mut pipeline = world.pipeline_mut();

        let mut river_stage = TerrainStage::new(
            config.seed,
            &NoiseParams::new()
                .frequency(0.007)
                // .ridged(true)
                // .attenuation(10.0)
                .build(),
        );
        river_stage.add_control_points(&[
            [-1.0, 1.0],
            [-0.4, 0.9],
            [-0.1, 0.4],
            [0.1, 0.5],
            [1.0, 0.5],
        ]);

        pipeline.add_stage(river_stage);
        // pipeline.add_stage(DebugStage::new(2));
        // pipeline.add_stage(BaseTerrainStage::new(0.0, 2));
        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 2));
    }

    world
}
