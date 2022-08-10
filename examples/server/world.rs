use voxelize::{
    BaseTerrainStage, DebugStage, FlatlandStage, NoiseParams, TerrainLayer, World, WorldConfig,
};

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
        // pipeline.add_stage(DebugStage::new(2));
        pipeline.add_stage(BaseTerrainStage::new(0.0, 2));
        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 2));
    }

    world
}
