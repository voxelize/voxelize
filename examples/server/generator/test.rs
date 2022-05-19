use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceRequirements, ResourceResults},
    vec::Vec3,
    world::{
        generators::noise::NoiseQuery,
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

        let mut query = NoiseQuery::new()
            .scale(0.01)
            .octaves(10)
            .persistance(0.9)
            .lacunarity(1.2)
            .amplifier(3.0)
            .height_bias(3.0)
            .height_offset(50.0)
            .build();

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height {
                    query.voxel(vx, vy, vz);

                    let density = noise.simplex.get(&query);

                    if density > 0.0 {
                        chunk.set_voxel(vx, vy, vz, *map.get("Stone").unwrap());
                    }
                }
            }
        }

        chunk
    }
}
