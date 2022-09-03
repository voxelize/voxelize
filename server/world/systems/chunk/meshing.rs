use specs::{ReadExpect, System, WriteExpect};

use crate::{
    BlockUtils, Chunks, Mesher, MessageType, Pipeline, Registry, Vec3, VoxelAccess, WorldConfig,
};

pub struct ChunkMeshingSystem;

impl<'a> System<'a> for ChunkMeshingSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, mut pipeline, mut mesher, mut chunks) = data;

        if let Ok(list) = mesher.results() {
            list.into_iter().for_each(|chunk| {
                chunks.add_chunk_to_send(&chunk.coords, &MessageType::Load, false);
                chunks.renew(chunk);
            });
        }

        if chunks.to_remesh.is_empty() {
            return;
        }

        let max_light_level = config.max_light_level as usize;

        let mut processes = vec![];
        let mut count = 0;

        while count < config.max_chunks_per_tick {
            if let Some(coords) = chunks.to_remesh.pop_front() {
                let mut ready = true;

                // Traverse through the neighboring coordinates. If any of them are not ready, then this chunk is not ready.
                for n_coords in chunks.light_traversed_chunks(&coords).into_iter() {
                    // The neighbor isn't even in the world.
                    if !chunks.map.contains_key(&n_coords) {
                        ready = false;
                        break;
                    }

                    // The neighbor is still in the pipeline, means this chunk can still have potential block changes.
                    if pipeline.has(&n_coords) {
                        ready = false;
                        break;
                    }

                    if let Some(blocks) = pipeline.leftovers.get(&n_coords) {
                        blocks.into_iter().for_each(|(voxel, val)| {
                            let Vec3(vx, vy, vz) = *voxel;

                            chunks.set_raw_voxel(vx, vy, vz, *val);

                            let height = chunks.get_max_height(vx, vz);
                            let id = BlockUtils::extract_id(*val);

                            // Change the max height if necessary.
                            if registry.is_air(id) {
                                if vy == height as i32 {
                                    // on max height, should set max height to lower
                                    for y in (0..vy - 1).rev() {
                                        if y == 0
                                            || registry.check_height(chunks.get_voxel(vx, y, vz))
                                        {
                                            chunks.set_max_height(vx, vz, y as u32);
                                            break;
                                        }
                                    }
                                }
                            } else if height < vy as u32 {
                                chunks.set_max_height(vx, vz, vy as u32);
                            }
                        });
                    }
                }

                count += 1;

                if !ready {
                    chunks.add_chunk_to_remesh(&coords, false);
                    continue;
                }

                pipeline.leftovers.remove(&coords);

                // At this point, the chunk is ready to be saved.
                if config.saving {
                    chunks.add_chunk_to_save(&coords, false);
                }

                let chunk = chunks.raw(&coords).unwrap().to_owned();

                let mut space = chunks
                    .make_space(&coords, max_light_level)
                    .needs_height_maps()
                    .needs_voxels();

                if chunk.meshes.is_some() {
                    space = space.needs_lights()
                }

                let space = space.strict().build();

                processes.push((chunk, space));
            } else {
                break;
            }
        }

        if !processes.is_empty() {
            mesher.process(processes, &registry, &config);
        }
    }
}
