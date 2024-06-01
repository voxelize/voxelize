use std::time::Instant;
use std::{cmp::Ordering, collections::VecDeque};

use hashbrown::{HashMap, HashSet};
use log::info;
use nanoid::nanoid;
use rayon::iter::{IntoParallelIterator, IntoParallelRefIterator, ParallelIterator};
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::world::profiler::Profiler;
use crate::{
    BlockUtils, Chunk, ChunkInterests, ChunkOptions, ChunkRequestsComp, ChunkStatus, ChunkUtils,
    Chunks, Clients, Mesher, MessageType, Pipeline, PositionComp, Registry, Stats, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

#[derive(Default)]
pub struct ChunkGeneratingSystem;

impl<'a> System<'a> for ChunkGeneratingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, Profiler>,
        ReadStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            clients,
            stats,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            mut profiler,
            requests,
        ) = data;

        if stats.tick % 2 == 0 {
            return;
        }

        profiler.time("generating");

        let chunk_size = config.chunk_size;

        /* -------------------------------------------------------------------------- */
        /*                     RECALCULATE CHUNK INTEREST WEIGHTS                     */
        /* -------------------------------------------------------------------------- */

        profiler.time("recalculate_chunk_interest_weights");
        interests.weights.clear();

        let mut weights = HashMap::with_capacity(interests.map.len());

        for (coords, ids) in &interests.map {
            let weight: f32 = ids
                .iter()
                .filter_map(|id| clients.get(id))
                .filter_map(|client| requests.get(client.entity))
                .map(|request| {
                    let dist = ChunkUtils::distance_squared(&request.center, &coords);
                    let direction_to_chunk =
                        Vec2(coords.0 - request.center.0, coords.1 - request.center.1);
                    let mag = (direction_to_chunk.0.pow(2) as f32
                        + direction_to_chunk.1.pow(2) as f32)
                        .sqrt();
                    let normalized_direction_to_chunk = Vec2(
                        direction_to_chunk.0 as f32 / mag,
                        direction_to_chunk.1 as f32 / mag,
                    );
                    let dot_product = request.direction.0 * normalized_direction_to_chunk.0
                        + request.direction.1 * normalized_direction_to_chunk.1;
                    dist * dot_product.max(0.0)
                })
                .sum();

            weights.insert(coords.clone(), weight);
        }

        interests.weights = weights;
        profiler.time_end("recalculate_chunk_interest_weights");

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING PIPELINE RESULTS                         */
        /* -------------------------------------------------------------------------- */
        profiler.time("handling_pipeline_results");
        for (mut chunk, extra_changes) in pipeline.results() {
            for (voxel, id) in extra_changes {
                let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, chunk_size);

                if chunks.is_chunk_ready(&coords) {
                    chunks.update_voxel(&voxel, id);
                } else {
                    pipeline
                        .leftovers
                        .entry(coords)
                        .or_default()
                        .push((voxel, id));
                }
            }

            if let ChunkStatus::Generating(curr_stage) = chunk.status {
                let next_stage = curr_stage + 1;

                if next_stage >= pipeline.stages.len() {
                    chunk.status = ChunkStatus::Meshing;
                    mesher.add_chunk(&chunk.coords, false);
                    pipeline.remove_chunk(&chunk.coords);
                } else {
                    chunk.status = ChunkStatus::Generating(next_stage);
                    pipeline.add_chunk(&chunk.coords, false);
                }

                if let Some(listeners) = chunks.listeners.remove(&chunk.coords) {
                    for n_coords in listeners {
                        if !chunks.map.contains_key(&n_coords)
                            || matches!(
                                chunks.raw(&n_coords).unwrap().status,
                                ChunkStatus::Generating(_)
                            )
                        {
                            pipeline.add_chunk(&n_coords, true);
                        } else if let Some(chunk) = chunks.raw(&n_coords) {
                            if matches!(chunk.status, ChunkStatus::Meshing) {
                                mesher.add_chunk(&n_coords, true);
                            }
                        }
                    }
                }

                chunks.renew(chunk, false);
            }
        }
        profiler.time_end("handling_pipeline_results");

        /* -------------------------------------------------------------------------- */
        /*                       PUSHING CHUNKS TO BE PROCESSED                       */
        /* -------------------------------------------------------------------------- */
        profiler.time("pushing_chunks_to_be_processed");
        let mut processes = vec![];

        if !pipeline.queue.is_empty() {
            profiler.time("sorting_queue");
            let mut queue: Vec<Vec2<i32>> = pipeline.queue.iter().cloned().collect();
            queue.sort_by(|a, b| interests.compare(a, b));
            pipeline.queue = VecDeque::from(queue);
            profiler.time_end("sorting_queue");
        }

        let mut processed_count = 0;
        let mut to_load = vec![];
        while !pipeline.queue.is_empty()
            && !pipeline.stages.is_empty()
            && processed_count < config.max_chunks_per_tick
        {
            let coords = pipeline.get().unwrap();
            let chunk = chunks.raw(&coords);

            if chunk.is_none() {
                let can_load = chunks.test_load(&coords);
                if can_load {
                    pipeline.remove_chunk(&coords);
                    mesher.add_chunk(&coords, false);
                    to_load.push(coords);
                    continue;
                }

                let new_chunk = Chunk::new(
                    &nanoid!(),
                    coords.0,
                    coords.1,
                    &ChunkOptions {
                        max_height: config.max_height,
                        sub_chunks: config.sub_chunks,
                        size: config.chunk_size,
                    },
                );

                chunks.renew(new_chunk, false);
            }

            let chunk = chunks.raw(&coords).unwrap();

            if !matches!(chunk.status, ChunkStatus::Generating(_)) {
                pipeline.remove_chunk(&coords);
                continue;
            }

            let chunk = chunk.clone();
            let index = if let ChunkStatus::Generating(index) = chunk.status {
                index
            } else {
                unreachable!()
            };
            let stage = &pipeline.stages[index];
            let margin = stage.neighbors(&config);

            if margin > 0 {
                let r = (margin as f32 / chunk_size as f32).ceil() as i32;
                let mut ready = true;

                'outer: for x in -r..=r {
                    for z in -r..=r {
                        if (x == 0 && z == 0) || (x * x + z * z > r * r) {
                            continue;
                        }

                        let n_coords = Vec2(coords.0 + x, coords.1 + z);

                        if !chunks.is_within_world(&n_coords) || chunks.is_chunk_ready(&n_coords) {
                            continue;
                        }

                        if let Some(neighbor) = chunks.raw(&n_coords) {
                            if let ChunkStatus::Generating(n_stage) = neighbor.status {
                                if n_stage >= index {
                                    continue;
                                }
                            }
                        }

                        chunks.add_listener(&n_coords, &coords);
                        ready = false;
                        break 'outer;
                    }
                }

                if !ready {
                    continue;
                }
            }

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

            processed_count += 1;
        }

        // parallelize loading
        let loaded_chunks: Vec<(Vec2<i32>, Option<Chunk>)> = to_load
            .into_par_iter()
            .map(|coords| (coords.to_owned(), chunks.try_load(&coords)))
            .collect();

        for (coords, loaded_chunk) in loaded_chunks.into_iter() {
            if let Some(chunk) = loaded_chunk {
                chunks.renew(chunk, false);
            } else {
                pipeline.add_chunk(&coords, false);
            }
        }

        if !processes.is_empty() {
            profiler.time("pipeline_process");
            pipeline.process(processes, &registry, &config);
            profiler.time_end("pipeline_process");
        }
        profiler.time_end("pushing_chunks_to_be_processed");

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING MESHING RESULTS                          */
        /* -------------------------------------------------------------------------- */
        profiler.time("handling_meshing_results");
        for (mut chunk, r#type) in mesher.results() {
            if r#type == MessageType::Load {
                if let Some(listeners) = chunks.listeners.remove(&chunk.coords) {
                    for n_coords in listeners {
                        if !chunks.map.contains_key(&n_coords)
                            || matches!(
                                chunks.raw(&n_coords).unwrap().status,
                                ChunkStatus::Generating(_)
                            )
                        {
                            pipeline.add_chunk(&n_coords, true);
                        } else if let Some(chunk) = chunks.raw(&n_coords) {
                            if matches!(chunk.status, ChunkStatus::Meshing) {
                                mesher.add_chunk(&n_coords, true);
                            }
                        }
                    }
                }
            }

            chunk.status = ChunkStatus::Ready;
            let is_updating = r#type == MessageType::Update;

            if !is_updating {
                chunks.add_chunk_to_send(&chunk.coords, &r#type, false);
            }

            chunks.renew(chunk, is_updating);
        }
        profiler.time_end("handling_meshing_results");

        /* -------------------------------------------------------------------------- */
        /*                         PUSHING CHUNKS TO BE MESHED                        */
        /* -------------------------------------------------------------------------- */
        profiler.time("pushing_chunks_to_be_meshed");

        if !mesher.queue.is_empty() {
            let mut queue: Vec<Vec2<i32>> = mesher.queue.iter().cloned().collect();
            queue.sort_by(|a, b| interests.compare(a, b));
            mesher.queue = VecDeque::from(queue);
        }

        let mut processed_count = 0;
        let mut ready_chunks = vec![];

        while !mesher.queue.is_empty() && processed_count < config.max_chunks_per_tick {
            let coords = mesher.get().unwrap();
            let mut ready = true;

            for n_coords in chunks.light_traversed_chunks(&coords) {
                if !chunks.map.contains_key(&n_coords) {
                    ready = false;
                    break;
                }

                if let Some(n_chunk) = chunks.raw(&n_coords) {
                    if matches!(n_chunk.status, ChunkStatus::Generating(_)) {
                        ready = false;
                        chunks.add_listener(&n_coords, &coords);
                        break;
                    }
                }

                if let Some(blocks) = pipeline.leftovers.get(&n_coords) {
                    for (voxel, val) in blocks {
                        let Vec3(vx, vy, vz) = *voxel;
                        chunks.set_raw_voxel(vx, vy, vz, *val);

                        let height = chunks.get_max_height(vx, vz);
                        let id = BlockUtils::extract_id(*val);

                        if registry.is_air(id) {
                            if vy == height as i32 {
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
                    }
                }
            }

            if !ready {
                continue;
            }

            pipeline.leftovers.remove(&coords);

            if config.saving {
                chunks.add_chunk_to_save(&coords, false);
            }

            let chunk = chunks.raw(&coords).unwrap().clone();
            ready_chunks.push((coords, chunk));
            processed_count += 1;
        }

        // Process the ready chunks in parallel
        let processes = ready_chunks
            .into_par_iter()
            .map(|(coords, chunk)| {
                let mut space = chunks
                    .make_space(&coords, config.max_light_level as usize)
                    .needs_height_maps()
                    .needs_voxels();

                if chunk.meshes.is_some() {
                    space = space.needs_lights()
                }

                let space = space.strict().build();
                (chunk, space)
            })
            .collect::<Vec<_>>();

        if !processes.is_empty() {
            mesher.process(processes, &MessageType::Load, &registry, &config);
        }
        profiler.time_end("pushing_chunks_to_be_meshed");

        profiler.time_end("generating");
    }
}
