use voxelize::{NoiseParams, TerrainLayer, World, WorldConfig};

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        // .min_chunk([-1, -1])
        // .max_chunk([1, 1])
        .terrain(
            &NoiseParams::new()
                .frequency(0.000)
                .octaves(0)
                .persistence(0.0)
                .lacunarity(0.0)
                .build(),
        )
        .seed(1213123)
        .max_response_per_tick(1)
        .build();

    let mut world = World::new("world1", &config);

    {
        let mut terrain = world.terrain_mut();

        let continentalness = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.004)
                .octaves(7)
                .persistence(0.8)
                .lacunarity(1.6)
                .build(),
        )
        .add_bias_points(vec![[-1.0, 1.0], [0.0, 1.0], [1.0, 1.0]])
        .add_offset_points(vec![[-1.0, 60.0], [-0.1, 60.0], [0.1, 90.0], [1.0, 90.0]]);

        terrain.add_layer(&continentalness);
    }

    world
}
