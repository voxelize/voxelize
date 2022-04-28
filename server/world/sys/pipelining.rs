use hashbrown::HashSet;
use nanoid::nanoid;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    chunk::{Chunk, ChunkParams},
    chunks::Chunks,
    common::{BlockChanges, UpdatedChunks},
    pipeline::Pipeline,
    utils::chunk_utils::ChunkUtils,
    vec::{Vec2, Vec3},
    world::{access::VoxelAccess, registry::Registry, WorldConfig},
};

/// An ECS system to pipeline chunks through different phases of generation.
pub struct PipeliningSystem;

impl<'a> System<'a> for PipeliningSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, BlockChanges>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, UpdatedChunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, mut changes, mut pipeline, mut chunks, mut updated) = data;

        let max_per_tick = config.max_chunk_per_tick;
        let chunk_size = config.chunk_size;

        if let Ok((list, new_changes)) = pipeline.results() {
            // Store the block changes that exceed to neighboring chunks.
            new_changes.into_iter().for_each(|(voxel, id)| {
                let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, chunk_size);

                let mut already = changes.remove(&coords).unwrap_or_else(|| vec![]);
                already.push((voxel, id));
                changes.insert(coords, already);
            });

            // Advance each chunk's stage to the next stage. If the chunk is about to be meshed, then apply the changes
            // that the neighboring chunks have on it.
            list.into_iter().for_each(|mut chunk| {
                pipeline.advance(&mut chunk);

                if let Some(index) = chunk.stage {
                    if index == pipeline.len() - 1 {
                        if let Some(final_changes) = changes.remove(&chunk.coords) {
                            final_changes
                                .into_iter()
                                .for_each(|(Vec3(vx, vy, vz), id)| {
                                    chunk.set_voxel(vx, vy, vz, id);
                                });
                        }

                        // Calculate the height map of the chunk.
                        chunk.calculate_max_height(&registry);
                    }
                }

                if chunk.stage.is_none() {
                    // This means the chunk was pushed back into the pipeline for remeshing.
                    // Should send to users that has requested for these chunks for update.
                    if chunk.initialized {
                        updated.insert(chunk.coords.to_owned());
                    }

                    chunk.initialized = true;
                }

                chunks.renew(chunk);
            });
        }

        let mut processes = vec![];

        let mut processed = 0;

        while processed < max_per_tick {
            processed += 1;

            if pipeline.is_empty() {
                break;
            }

            let (Vec2(cx, cz), index) = pipeline.pop().unwrap();

            let stage = pipeline.get_stage(index);

            // Calculate the radius that this stage requires to be loaded.
            let margin = stage.neighbors(&config);
            let r = (margin as f32 / chunk_size as f32).ceil() as i32;

            let chunk = chunks.raw(&Vec2(cx, cz));

            // Chunk DNE, make one.
            if chunk.is_none() {
                let new_chunk = Chunk::new(
                    &nanoid!(),
                    cx,
                    cz,
                    &ChunkParams {
                        max_height: config.max_height,
                        size: config.chunk_size,
                    },
                );

                // Add this chunk to the pipeline with stage 0.
                pipeline.postpone(&new_chunk.coords, 0);
                chunks.add(new_chunk);

                continue;
            }

            let chunk = chunk.unwrap().clone();

            // Means chunk is already done.
            if chunk.stage.is_none() {
                continue;
            }

            // I don't even know why this would happen.
            if chunk.stage.unwrap() > index {
                continue;
            }

            // Check if chunk's neighbors are ready to be used.
            let mut ready = true;

            for x in -r..=r {
                for z in -r..=r {
                    if x == 0 && z == 0 {
                        break;
                    }

                    // OK cases are:
                    // - chunk's neighbor exist
                    // - neighbor's stage >= chunk's stage
                    let coords = Vec2(cx + x, cz + z);

                    // If chunk isn't within world borders, then it's fine to be absent.
                    if !chunks.is_within_world(&coords) {
                        continue;
                    }

                    if let Some(neighbor) = chunks.raw(&coords) {
                        if neighbor.stage.is_none()
                            || neighbor.stage.unwrap() >= chunk.stage.unwrap()
                        {
                            continue;
                        }
                    }

                    ready = false;
                    break;
                }

                if !ready {
                    break;
                }
            }

            // if this chunk cannot be processed yet, add it back to queue.
            if !ready {
                pipeline.postpone(&chunk.coords, index);
                continue;
            }

            // TODO: check if there are still block changes done on this chunk. If there are, remesh them in later ticks.

            // Create space that this stage requires.
            if let Some(data) = stage.needs_space() {
                let mut space = chunks.make_space(cx, cz, margin);

                if data.needs_voxels {
                    space.needs_voxels();
                }

                if data.needs_lights {
                    space.needs_lights();
                }

                if data.needs_height_maps {
                    space.needs_height_maps();
                }

                let space = space.build();

                processes.push((chunk, Some(space), index));
            } else {
                processes.push((chunk, None, index))
            }
        }

        // This part goes through all block changes (chunk coords -> list of changes) and see
        // if there are any leftover changes that are supposed to be applied to the chunks.
        let mut to_remove = HashSet::new();
        let mut to_remesh = HashSet::new();

        changes.iter_mut().for_each(|(coords, blocks)| {
            // If `get_chunk` results in a chunk, that means that chunk has already been through the pipeline.
            if chunks.get_chunk(coords).is_some() {
                if blocks.is_empty() {
                    to_remove.insert(coords.to_owned());
                    return;
                }

                blocks.drain(..).for_each(|(voxel, id)| {
                    let Vec3(vx, vy, vz) = voxel;

                    chunks.set_voxel(vx, vy, vz, id);

                    chunks
                        .get_voxel_affected_chunks(vx, vy, vz)
                        .into_iter()
                        .for_each(|coords| {
                            to_remesh.insert(coords);
                        });
                });
            }
        });

        if !to_remove.is_empty() {
            to_remove.into_iter().for_each(|coords| {
                changes.remove(&coords);
            });
        }

        if !to_remesh.is_empty() {
            to_remesh.into_iter().for_each(|coords| {
                pipeline.remesh(&coords);
            });
        }

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config);
        }
    }
}
