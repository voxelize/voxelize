use noise::Worley;
use voxelize::{HeightMapStage, NoiseParams, TerrainLayer, World, WorldConfig};

use crate::generator::{test::TestStage, tree::TreeTestStage, water::WaterStage};

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        // .min_chunk([-1, -1])
        // .max_chunk([1, 1])
        .terrain(
            &NoiseParams::new()
                .frequency(0.008)
                .octaves(7)
                .persistence(0.8)
                .lacunarity(1.4)
                .build(),
        )
        .seed(1213123)
        .build();

    let mut world = World::new("world1", &config);

    {
        let mut pipeline = world.pipeline_mut();

        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 3));
        pipeline.add_stage(TestStage);
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(WaterStage);
        pipeline.add_stage(TreeTestStage {
            noise: Worley::new(),
        });
    }

    {
        let mut terrain = world.terrain_mut();

        let continentalness = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.001)
                .octaves(7)
                .persistence(0.8)
                .lacunarity(1.6)
                .build(),
        )
        .add_bias_points(vec![[-1.0, 3.6], [-0.5, 4.6], [0.4, 2.3], [1.0, 1.0]])
        .add_offset_points(vec![[-1.0, 60.0], [-0.3, 62.0], [1.2, 290.0]]);

        let erosion = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.0008)
                .octaves(5)
                .persistence(0.8)
                .lacunarity(1.8)
                .build(),
        )
        .add_bias_points(vec![
            [-1.0, 1.6],
            [-0.4, 1.2],
            [0.0, 2.0],
            [0.2, 6.8],
            [1.0, 2.0],
        ])
        .add_offset_points(vec![
            [-1.3, 230.0],
            [-0.5, 113.0],
            [-0.3, 85.0],
            [0.0, 65.0],
            [0.3, 66.0],
            [0.4, 63.0],
            [0.7, 63.0],
            [1.0, 10.0],
        ]);

        let pv = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.0015)
                .octaves(5)
                .persistence(1.2)
                .ridged(true)
                .build(),
        )
        .add_bias_points(vec![[-1.2, 0.4], [-0.4, 1.0], [0.9, 0.7], [1.3, 0.9]])
        .add_offset_points(vec![
            [-1.5, 166.0],
            [-0.3, 80.0],
            [0.5, 56.0],
            [0.9, 34.0],
            [1.2, 6.0],
        ]);

        terrain.add_layer(&continentalness);
        terrain.add_layer(&erosion);
        terrain.add_layer(&pv);
    }

    world
}
