use log::info;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    chunks::Chunks,
    common::BlockChanges,
    pipeline::Pipeline,
    vec::{Vec2, Vec3},
    world::{access::VoxelAccess, mesher::Mesher, registry::Registry, WorldConfig},
};

pub struct ChunkMeshingSystem;

impl<'a> System<'a> for ChunkMeshingSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, BlockChanges>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, pipeline, mut mesher, mut chunks, mut changes) = data;

        if let Ok(list) = mesher.results() {
            list.into_iter().for_each(|chunk| {
                chunks.to_send.insert(chunk.coords.to_owned());
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
                    if !chunks.is_within_world(&n_coords)
                        || (!pipeline.has(&n_coords) && chunks.map.contains_key(&n_coords))
                    {
                        // Apply the additional changes whenever available.
                        if let Some(blocks) = changes.remove(&n_coords) {
                            blocks.into_iter().for_each(|(voxel, id)| {
                                let Vec3(vx, vy, vz) = voxel;

                                chunks.set_voxel(vx, vy, vz, id);

                                let height = chunks.get_max_height(vx, vz);

                                if registry.is_air(id) {
                                    if voxel.1 == height as i32 {
                                        // on max height, should set max height to lower
                                        for y in (0..vy).rev() {
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

                            chunks.to_remesh.insert(coords.to_owned());
                            continue;
                        }

                        continue;
                    }

                    ready = false;
                    break;
                }

                if !ready {
                    chunks.to_remesh.insert(coords);
                    continue;
                }

                let chunk = chunks.raw(&coords).unwrap().to_owned();
                let space = chunks
                    .make_space(&coords, max_light_level)
                    .needs_height_maps()
                    .needs_voxels()
                    .strict()
                    .build();

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
