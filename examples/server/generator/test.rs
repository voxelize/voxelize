use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceRequirements, ResourceResults},
    vec::Vec3,
    world::{
        generators::{
            noise::NoiseParams,
            terrain::{SeededTerrain, TerrainLayer},
        },
        voxels::{access::VoxelAccess, space::Space},
    },
};

pub struct TestStage;

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test".to_owned()
    }

    fn needs_resources(&self) -> ResourceRequirements {
        ResourceRequirements {
            needs_registry: true,
            needs_config: true,
            needs_noise: true,
        }
    }

    fn process(&self, mut chunk: Chunk, resources: ResourceResults, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let config = resources.config.unwrap();
        let registry = resources.registry.unwrap();
        let noise = resources.noise.unwrap();

        let max_height = config.max_height as i32;

        let map = registry.get_type_map(&["Stone", "Lol"]);

        let params = NoiseParams::new()
            .scale(1200.0)
            .octaves(5)
            .persistance(0.9)
            .lacunarity(1.2)
            .normalize(true)
            .build();

        let mut terrain = SeededTerrain::new(config.seed, &params);

        let continentalness = TerrainLayer::new(
            &NoiseParams::new()
                .scale(1000.0)
                .octaves(5)
                .persistance(0.8)
                .lacunarity(1.8)
                .normalize(true)
                .build(),
        )
        .add_bias_points(vec![[-1.0, 4.0], [1.0, 4.0]])
        // .add_offset_points(vec![[-1.0, 60.0], [1.0, 100.0]]);
        .add_offset_points(vec![
            [-1.0, 150.0],
            [-0.9, 40.0],
            [-0.6, 43.0],
            [-0.4, 57.0],
            [-0.1, 66.0],
            [0.2, 100.0],
            [0.4, 125.0],
            [0.9, 127.0],
        ]);

        terrain.add_layer(&continentalness);

        // let layer1 = TerrainLayer::new(
        //     &NoiseParams::new()
        //         .scale(0.001)
        //         .octaves(4)
        //         .persistance(0.4)
        //         .lacunarity(2.0)
        //         .normalize(true)
        //         .build(),
        // )
        // .add_bias_points(vec![[-0.2, 3.0], [0.4, 2.5]])
        // // .add_offset_points(vec![[-1.0, 120.0], [-0.6, 90.0], [-0.3, 80.0], [0.3, 60.0]]);
        // .add_offset_points(vec![
        //     [-1.0, 150.0],
        //     [-0.9, 40.0],
        //     [-0.6, 43.0],
        //     [-0.4, 55.0],
        //     [-0.1, 60.0],
        //     [0.2, 72.0],
        //     [0.4, 80.0],
        // ]);
        // let layer2 = TerrainLayer::new(
        //     &NoiseParams::new()
        //         .scale(0.003)
        //         .octaves(5)
        //         .persistance(0.2)
        //         .lacunarity(1.4)
        //         .normalize(true)
        //         .build(),
        // )
        // .add_bias_points(vec![[-0.7, 1.0], [-0.4, 4.0], [0.2, 4.0], [0.8, 3.0]])
        // // .add_offset_points(vec![[-0.4, 80.0], [0.2, 70.0]]);
        // .add_offset_points(vec![
        //     [-1.0, 130.0],
        //     [-0.7, 108.0],
        //     [-0.4, 96.0],
        //     [-0.3, 90.0],
        //     [0.0, 50.0],
        //     [0.5, 60.0],
        //     [0.6, 66.0],
        //     [0.7, 72.0],
        //     [0.8, 66.0],
        //     [1.0, 30.0],
        // ]);
        // let layer3 = TerrainLayer::new(
        //     &NoiseParams::new()
        //         .scale(0.008)
        //         .octaves(5)
        //         .persistance(0.3)
        //         .lacunarity(1.8)
        //         .normalize(true)
        //         .build(),
        // )
        // .add_bias_points(vec![[-0.7, 4.0], [-0.4, 2.0], [0.2, 2.0], [0.8, 3.0]])
        // .add_offset_points(vec![
        //     [-0.9, 30.0],
        //     [-0.7, 30.0],
        //     [-0.6, 50.0],
        //     [-0.4, 58.0],
        //     [-0.2, 66.0],
        //     [0.4, 90.0],
        //     [0.8, 96.0],
        //     [0.9, 95.0],
        // ]);

        // terrain.add_layer(&layer1);
        // terrain.add_layer(&layer2);
        // terrain.add_layer(&layer3);

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height {
                    let density = terrain.density_at(vx, vy, vz);

                    // if (vy as f64) < offset {
                    //     chunk.set_voxel(vx, vy, vz, *map.get("Stone").unwrap());
                    // }
                    if density > 0.0 {
                        chunk.set_voxel(vx, vy, vz, *map.get("Stone").unwrap());
                    }
                }
            }
        }

        chunk
    }
}
