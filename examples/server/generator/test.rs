use log::info;
use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceRequirements, ResourceResults},
    vec::Vec3,
    world::{
        generators::{
            noise::{NoiseParams, SeededNoise},
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
            needs_noise: false,
            needs_terrain: true,
        }
    }

    fn process(&self, mut chunk: Chunk, resources: ResourceResults, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let config = resources.config.unwrap();
        let registry = resources.registry.unwrap();
        let terrain = resources.terrain.unwrap();

        let max_height = config.max_height as i32;

        let map = registry.get_type_map(&["Stone", "Lol"]);

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
