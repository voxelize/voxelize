use std::{cmp::Ordering, collections::VecDeque};

use hashbrown::{HashMap, HashSet};
use log::info;
use nanoid::nanoid;
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    BlockUtils, Chunk, ChunkInterests, ChunkParams, ChunkStatus, ChunkUtils, Chunks, Clients,
    Mesher, MessageType, Pipeline, PositionComp, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

#[derive(Default)]
pub struct ChunkGeneratingSystem;

impl<'a> System<'a> for ChunkGeneratingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Clients>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        ReadStorage<'a, PositionComp>,
    );

    /// If the pipeline queue is not empty, pop the first chunk coordinate `MAX_CHUNKS_PER_TICK` times and
    /// put the chunks into their respective stages. If the pipeline is done with a batch of chunks, advance
    /// the chunks to the next stage, and if any of the chunks are done, prepare them to be meshed.
    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            clients,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            positions,
        ) = data;

        let chunk_size = config.chunk_size;
        let max_chunks_per_tick = config.max_chunks_per_tick;

        /* -------------------------------------------------------------------------- */
        /*                     RECALCULATE CHUNK INTEREST WEIGHTS                     */
        /* -------------------------------------------------------------------------- */

        interests.weights.clear();

        let mut weights = HashMap::new();

        for (coords, ids) in &interests.map {
            let mut weight = 0.0;

            ids.iter().for_each(|id| {
                if let Some(client) = clients.get(id) {
                    if let Some(pos) = positions.get(client.entity) {
                        let client_coords = ChunkUtils::map_voxel_to_chunk(
                            (pos.0 .0).floor() as i32,
                            (pos.0 .1).floor() as i32,
                            (pos.0 .2).floor() as i32,
                            config.chunk_size,
                        );

                        let dist = ChunkUtils::distance_squared(&client_coords, &coords);
                        weight += dist;
                    }
                }
            });

            let original_weight = interests.weights.get(&coords).cloned().unwrap_or_default();
            weights.insert(coords.clone(), original_weight + weight);
        }

        interests.weights = weights;

        let mut to_notify = HashSet::new();

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING PIPELINE RESULTS                         */
        /* -------------------------------------------------------------------------- */
        if let Some((mut chunk, extra_changes)) = pipeline.results() {
            // Apply the extra changes from processing these chunks to the other chunks.
            extra_changes.into_iter().for_each(|(voxel, id)| {
                let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, chunk_size);

                if chunks.is_chunk_ready(&coords) {
                    chunks.update_voxel(&voxel, id);
                    return;
                }

                let mut already = pipeline.leftovers.remove(&coords).unwrap_or_default();
                already.push((voxel, id));
                pipeline.leftovers.insert(coords, already);
            });

            // Advance the chunk to the next stage.
            if let ChunkStatus::Generating(curr_stage) = chunk.status {
                let next_stage = curr_stage + 1;

                // This chunk is done with the last stage.
                // Can be pushed to the mesher.
                if next_stage >= pipeline.stages.len() {
                    // At this point, this chunk has nothing to do with the pipeline.
                    chunk.status = ChunkStatus::Meshing;
                    mesher.add_chunk(&chunk.coords, false);
                    pipeline.remove_chunk(&chunk.coords);
                } else {
                    // Otherwise, advance the chunk to the next stage.
                    chunk.status = ChunkStatus::Generating(next_stage);
                    pipeline.add_chunk(&chunk.coords, false);
                }

                // Notify neighbors that this chunk is ready.
                to_notify.insert(chunk.coords.clone());

                // Renew the chunk to the world map.
                chunks.renew(chunk);
            }
        }

        /* -------------------------------------------------------------------------- */
        /*                       PUSHING CHUNKS TO BE PROCESSED                       */
        /* -------------------------------------------------------------------------- */
        let mut processes = vec![];

        if !pipeline.queue.is_empty() {
            let mut queue: Vec<Vec2<i32>> = pipeline.queue.to_owned().into();
            queue.sort_by(|a, b| interests.compare(a, b));
            pipeline.queue = VecDeque::from(queue);
        }

        while !pipeline.queue.is_empty() && !pipeline.stages.is_empty() {
            let coords = pipeline.get().unwrap();
            let chunk = chunks.raw(&coords);

            // Check if this chunk DNE. If DNE, try loading or make one.
            if chunk.is_none() {
                // Try loading the chunk from disk.
                if let Some(chunk) = chunks.try_load(&coords) {
                    pipeline.remove_chunk(&coords);
                    mesher.add_chunk(&coords, false);
                    chunks.renew(chunk);

                    continue;
                }

                let new_chunk = Chunk::new(
                    &nanoid!(),
                    coords.0,
                    coords.1,
                    &ChunkParams {
                        max_height: config.max_height,
                        sub_chunks: config.sub_chunks,
                        size: config.chunk_size,
                    },
                );

                chunks.renew(new_chunk);
            }

            // Retrieve the chunk again from the world map.
            let chunk = chunks.raw(&coords).unwrap();

            // Means the chunk shouldn't be in the pipeline. Not sure why this would ever happen.
            if !matches!(chunk.status, ChunkStatus::Generating(_)) {
                pipeline.remove_chunk(&coords);
                continue;
            }

            // Take ownership of the chunk.
            let chunk = chunk.clone();

            let index = if let ChunkStatus::Generating(index) = chunk.status {
                index
            } else {
                unreachable!()
            };
            let stage = &pipeline.stages[index];

            // Calculate the radius that this stage requires to be processed.
            let margin = stage.neighbors(&config);

            if margin > 0 {
                let r = (margin as f32 / chunk_size as f32).ceil() as i32;

                // Loop through the neighbors to see if they are ready.
                let mut ready = true;

                for x in -r..=r {
                    for z in -r..=r {
                        if (x == 0 && z == 0) || (x * x + z * z > r * r) {
                            continue;
                        }

                        // OK cases are:
                        // 1. The neighbor is ready.
                        // 2. The neighbor's stage >= chunk's stage.
                        let n_coords = Vec2(coords.0 + x, coords.1 + z);

                        // If the chunk isn't within the world borders or its ready, then we skip.
                        if !chunks.is_within_world(&n_coords) || chunks.is_chunk_ready(&n_coords) {
                            continue;
                        }

                        // See if the neighbor's stage is >= chunk's stage.
                        if let Some(neighbor) = chunks.raw(&n_coords) {
                            if let ChunkStatus::Generating(n_stage) = neighbor.status {
                                if n_stage >= index {
                                    continue;
                                }
                            }
                        }

                        // Till this point, the neighbor is not ready. We can add a listener to it.
                        chunks.add_listener(&n_coords, &coords);

                        ready = false;

                        break;
                    }

                    if !ready {
                        break;
                    }
                }

                // If this chunk cannot be processed yet, we ignore it until the listeners notify us.
                if !ready {
                    continue;
                }
            }

            // To this point, we know that this chunk is ready to be processed by the stage.
            if let Some(data) = stage.needs_space() {
                let mut space = chunks.make_space(&chunk.coords, margin);

                if data.needs_voxels {
                    space = space.needs_voxels();
                }

                if data.needs_lights {
                    space = space.needs_lights();
                }

                if data.needs_height_maps {
                    space = space.needs_height_maps();
                }

                let space = space.build();

                processes.push((chunk, Some(space)));
            } else {
                processes.push((chunk, None));
            }
        }

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config);
        }

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING MESHING RESULTS                          */
        /* -------------------------------------------------------------------------- */
        if let Some(mut chunk) = mesher.results() {
            // Notify neighbors that this chunk is ready.
            to_notify.insert(chunk.coords.clone());

            // Update chunk status.
            chunk.status = ChunkStatus::Ready;

            chunks.add_chunk_to_send(&chunk.coords, &MessageType::Load, false);
            chunks.renew(chunk);
        }

        /* -------------------------------------------------------------------------- */
        /*                         PUSHING CHUNKS TO BE MESHED                        */
        /* -------------------------------------------------------------------------- */
        let mut processes = vec![];

        if !mesher.queue.is_empty() {
            let mut queue: Vec<Vec2<i32>> = mesher.queue.to_owned().into();
            queue.sort_by(|a, b| interests.compare(a, b));
            mesher.queue = VecDeque::from(queue);
        }

        while !mesher.queue.is_empty() {
            let coords = mesher.get().unwrap();

            // Traverse through the neighboring coordinates. If any of them are not ready, then this chunk is not ready.
            let mut ready = true;

            for n_coords in chunks.light_traversed_chunks(&coords).into_iter() {
                // The neighbor isn't even in the world.
                if !chunks.map.contains_key(&n_coords) {
                    ready = false;
                    break;
                }

                if let Some(n_chunk) = chunks.raw(&n_coords) {
                    // If the neighbor is still in the pipeline, then this chunk is not ready to be meshed.
                    if matches!(n_chunk.status, ChunkStatus::Generating(_)) {
                        ready = false;

                        // Add a listener to this neighbor.
                        chunks.add_listener(&n_coords, &coords);
                        break;
                    }
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
                                    if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz))
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

            // If this chunk is not ready, we ignore it until the listeners notify us.
            if !ready {
                continue;
            }

            pipeline.leftovers.remove(&coords);

            // At this chunk, the chunk is ready to be saved.
            if config.saving {
                chunks.add_chunk_to_save(&coords, false);
            }

            let chunk = chunks.raw(&coords).unwrap().clone();

            let mut space = chunks
                .make_space(&coords, config.max_light_level as usize)
                .needs_height_maps()
                .needs_voxels();

            if chunk.meshes.is_some() {
                space = space.needs_lights()
            }

            let space = space.strict().build();

            processes.push((chunk, space));
        }

        if !processes.is_empty() {
            mesher.process(processes, &registry, &config);
        }

        /* -------------------------------------------------------------------------- */
        /*                         NOTIFY THE CHUNK NEIGHBORS                         */
        /* -------------------------------------------------------------------------- */

        to_notify.into_iter().for_each(|coords| {
            // This is the list of chunks that we need to notify.
            if !chunks.listeners.contains_key(&coords) {
                return;
            }

            let listeners = chunks.listeners.remove(&coords).unwrap();

            listeners.into_iter().for_each(|n_coords| {
                // If this chunk is DNE or if this chunk is still in the pipeline, we re-add it to the pipeline.
                if !chunks.map.contains_key(&n_coords)
                    || matches!(
                        chunks.raw(&n_coords).unwrap().status,
                        ChunkStatus::Generating(_)
                    )
                {
                    pipeline.add_chunk(&n_coords, true);
                }
                // If this chunk is in the meshing stage, we re-add it to the mesher.
                else if let Some(chunk) = chunks.raw(&n_coords) {
                    if matches!(chunk.status, ChunkStatus::Meshing) {
                        mesher.add_chunk(&n_coords, true);
                    }
                }
            })
        });
    }
}
