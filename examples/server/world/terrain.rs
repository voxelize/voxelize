use voxelize::{BaseTerrainStage, NoiseParams, Terrain, TerrainLayer, World, WorldConfig};

use super::shared::{SoilingStage, MOUNTAIN_HEIGHT, PLAINS_HEIGHT, RIVER_HEIGHT, RIVER_TO_PLAINS};

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

    let continentalness = TerrainLayer::new(
        "continentalness",
        &NoiseParams::new()
            .frequency(0.0035)
            .octaves(7)
            .persistence(0.5)
            .lacunarity(1.8)
            .build(),
    )
    .add_bias_points(&[[-1.0, 2.5], [0.0, 2.0], [1.0, 1.8]])
    .add_offset_points(&[
        [-1.0, MOUNTAIN_HEIGHT],
        [0.0, PLAINS_HEIGHT],
        [RIVER_TO_PLAINS, RIVER_HEIGHT],
        [RIVER_TO_PLAINS * 2.0, PLAINS_HEIGHT],
        [1.0, PLAINS_HEIGHT],
    ]);

    terrain.add_layer(&continentalness, 0.8);

    {
        let mut pipeline = world.pipeline_mut();

        let mut terrain_stage = BaseTerrainStage::new(terrain);
        terrain_stage.set_base(2);
        terrain_stage.set_threshold(0.0);

        pipeline.add_stage(terrain_stage);
        pipeline.add_stage(SoilingStage::new(
            config.seed,
            &NoiseParams::new().frequency(0.04).lacunarity(3.0).build(),
        ));
    }

    world
}
