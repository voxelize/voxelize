use specs::{ReadExpect, System, WriteExpect};

use crate::{Chunks, Mesher, MessageType, Pipeline, Registry, Vec3, VoxelAccess, WorldConfig};

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
                chunks
                    .to_send
                    .push_back((chunk.coords.to_owned(), MessageType::Load));
                chunks.renew(chunk);
            });
        }

        if chunks.to_remesh.is_empty() {
            return;
        }

        let max_light_level = config.max_light_level as usize;

        let mut processes = vec![];
        let mut count = 0;

        while count < config.max_chunk_per_tick {
            count += 1;

            if let Some(coords) = chunks.to_remesh.pop_front() {
                let mut ready = true;

                for n_coords in chunks.light_traversed_chunks(&coords).into_iter() {
                    if !pipeline.has(&n_coords) && chunks.map.contains_key(&n_coords) {
                        // Apply the additional changes whenever available.
                        if let Some(blocks) = pipeline.leftovers.remove(&n_coords) {
                            blocks.into_iter().for_each(|(voxel, id)| {
                                let Vec3(vx, vy, vz) = voxel;

                                chunks.set_raw_voxel(vx, vy, vz, id);

                                let height = chunks.get_max_height(vx, vz);

                                if registry.is_air(id) {
                                    if vy == height as i32 {
                                        // on max height, should set max height to lower
                                        for y in (0..vy - 1).rev() {
                                            if y == 0
                                                || registry
                                                    .check_height(chunks.get_voxel(vx, y, vz))
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

                            if !chunks.to_remesh.contains(&n_coords) {
                                chunks.to_remesh.push_back(n_coords.to_owned());
                            }
                            continue;
                        }

                        continue;
                    }

                    ready = false;
                    break;
                }

                if !ready {
                    if !chunks.to_remesh.contains(&coords) {
                        chunks.to_remesh.push_back(coords);
                    }
                    continue;
                }

                let chunk = chunks.raw(&coords).unwrap().to_owned();

                let mut space = chunks
                    .make_space(&coords, max_light_level)
                    .needs_height_maps()
                    .needs_voxels();

                if chunk.mesh.is_some() {
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
