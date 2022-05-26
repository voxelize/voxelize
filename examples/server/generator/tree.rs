use noise::{NoiseFn, Worley};
use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceResults},
    vec::Vec3,
    world::voxels::{access::VoxelAccess, space::Space},
};

pub struct TreeTestStage {
    pub noise: Worley,
}

impl ChunkStage for TreeTestStage {
    fn name(&self) -> String {
        "TreeTest".to_owned()
    }

    fn process(&self, mut chunk: Chunk, resource: ResourceResults, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let registry = resource.registry.unwrap();

        let wood = registry.get_block_by_name("Wood");
        let leaves = registry.get_block_by_name("Leaves");

        let scale = 1.0;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = chunk.get_max_height(vx, vz) as i32;

                let id = chunk.get_voxel(vx, height, vz);
                let block = registry.get_block_by_id(id);

                if block.is_plantable
                    && self.noise.get([vx as f64 * scale, vz as f64 * scale]) > 0.9
                    && self.noise.get([vz as f64 * scale, vx as f64 * scale]) > 0.95
                {
                    let r = 3;
                    for i in -r..=r {
                        for j in -r..=r {
                            for y in 0..3 {
                                if i * i + j * j + y * y >= r * r {
                                    continue;
                                }

                                chunk.set_voxel(vx + i, height + 4 + y, vz + j, leaves.id);
                            }
                        }
                    }

                    for i in 0..5 {
                        chunk.set_voxel(vx, height + i, vz, wood.id);
                    }
                }
            }
        }

        chunk
    }
}
