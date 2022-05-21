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
            .scale(0.01)
            .octaves(3)
            .persistance(0.9)
            .lacunarity(1.2)
            .build();

        let mut terrain = SeededTerrain::new(config.seed, &params);

        let layer1 = TerrainLayer::new(
            &NoiseParams::new()
                .scale(0.005)
                .octaves(4)
                .persistance(0.5)
                .lacunarity(2.0)
                .normalize(true)
                .build(),
        )
        .add_bias_points(vec![[-0.2, 3.0], [0.4, 2.5]])
        .add_offset_points(vec![[-0.2, 120.0], [0.1, 70.0]]);
        // .add_bias_points(vec![[-0.3, 2.4], [0.0, 1.8], [0.4, 1.3], [0.9, 1.4]])
        // .add_offset_points(vec![[-0.2, 120.0], [-0.1, 70.0], [0.3, 70.0], [0.7, 60.0]]);

        terrain.add_layer(&layer1);

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height {
                    let density = terrain.density_at(vx, vy, vz);

                    if density > 0.0 {
                        chunk.set_voxel(vx, vy, vz, *map.get("Stone").unwrap());
                    }
                }
            }
        }

        chunk
    }
}
