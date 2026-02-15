use hashbrown::hash_map::RawEntryMut;
use nanoid::nanoid;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use super::height_updates::update_chunk_column_height_for_voxel_update;
use crate::world::profiler::Profiler;
use crate::world::system_profiler::WorldTimingContext;
use crate::{
    BlockUtils, Chunk, ChunkInterests, ChunkOptions, ChunkRequestsComp, ChunkStatus, ChunkUtils,
    Chunks, Clients, Mesher, MessageType, Pipeline, Registry, Stats, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};
const SMALL_PARALLEL_CHUNK_LOAD_LIMIT: usize = 2;

#[inline]
fn chunk_interest_alignment(center: &Vec2<i32>, coords: &Vec2<i32>, direction: &Vec2<f32>) -> f32 {
    if !direction.0.is_finite() || !direction.1.is_finite() {
        return 0.0;
    }
    let direction_to_chunk_x = f64::from(coords.0) - f64::from(center.0);
    let direction_to_chunk_z = f64::from(coords.1) - f64::from(center.1);
    let mag = direction_to_chunk_x
        .mul_add(direction_to_chunk_x, direction_to_chunk_z * direction_to_chunk_z)
        .sqrt();
    if mag <= f64::from(f32::EPSILON) {
        return 0.0;
    }
    let dot = (f64::from(direction.0) * direction_to_chunk_x
        + f64::from(direction.1) * direction_to_chunk_z)
        / mag;
    if !dot.is_finite() || dot <= 0.0 {
        return 0.0;
    }
    if dot >= f64::from(f32::MAX) {
        return f32::MAX;
    }
    dot as f32
}

#[inline]
fn accumulate_chunk_interest_weight(weight: f32, distance: f32, alignment: f32) -> f32 {
    if alignment <= 0.0 {
        return weight;
    }
    let contribution = distance * alignment;
    if !contribution.is_finite() {
        return f32::MAX;
    }
    let next = weight + contribution;
    if next.is_finite() {
        next
    } else {
        f32::MAX
    }
}

#[inline]
fn next_pipeline_stage(curr_stage: usize) -> usize {
    curr_stage.saturating_add(1)
}

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
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            clients,
            _stats,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            _profiler,
            requests,
            timing,
        ) = data;
        let _t = timing.timer("chunk-generating");

        let chunk_size = config.chunk_size.max(1);

        /* -------------------------------------------------------------------------- */
        /*                     RECALCULATE CHUNK INTEREST WEIGHTS                     */
        /* -------------------------------------------------------------------------- */

        let mut weights = std::mem::take(&mut interests.weights);
        let interest_map = &interests.map;
        if !weights.is_empty() {
            weights.retain(|coords, _| interest_map.contains_key(coords));
        }
        if weights.capacity() < interest_map.len() {
            weights.reserve(interest_map.len() - weights.capacity());
        }

        for (coords, ids) in interest_map {
            let mut weight = 0.0;

            for id in ids {
                if weight >= f32::MAX {
                    break;
                }
                if let Some(client) = clients.get(id) {
                    if let Some(request) = requests.get(client.entity) {
                        let dist = ChunkUtils::distance_squared(&request.center, &coords);
                        let alignment =
                            chunk_interest_alignment(&request.center, coords, &request.direction);
                        weight = accumulate_chunk_interest_weight(weight, dist, alignment);
                    }
                }
            }

            match weights.raw_entry_mut().from_key(coords) {
                RawEntryMut::Occupied(mut entry) => {
                    *entry.get_mut() = weight;
                }
                RawEntryMut::Vacant(entry) => {
                    entry.insert(coords.clone(), weight);
                }
            }
        }

        interests.weights = weights;

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING PIPELINE RESULTS                         */
        /* -------------------------------------------------------------------------- */

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
                let next_stage = next_pipeline_stage(curr_stage);

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
                        match chunks.raw(&n_coords) {
                            None => pipeline.add_chunk(&n_coords, true),
                            Some(neighbor) if matches!(neighbor.status, ChunkStatus::Generating(_)) => {
                                pipeline.add_chunk(&n_coords, true);
                            }
                            Some(neighbor) if matches!(neighbor.status, ChunkStatus::Meshing) => {
                                mesher.add_chunk(&n_coords, true);
                            }
                            Some(_) => {}
                        }
                    }
                }

                chunks.renew(chunk, false);
            }
        }

        for coords in pipeline.drain_pending_regenerate() {
            pipeline.add_chunk(&coords, true);
        }

        /* -------------------------------------------------------------------------- */
        /*                       PUSHING CHUNKS TO BE PROCESSED                       */
        /* -------------------------------------------------------------------------- */

        let mut processes = Vec::with_capacity(pipeline.queue.len());

        if pipeline.queue.len() > 1 {
            pipeline
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut to_load = Vec::with_capacity(pipeline.queue.len());
        if !pipeline.stages.is_empty() {
            while let Some(coords) = pipeline.get() {
                let chunk = chunks.raw(&coords);

                if chunk.is_none() {
                    let can_load = chunks.test_load(&coords);
                    if can_load {
                        pipeline.remove_chunk_tracking(&coords);
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

                    chunks.freshly_created.insert(coords);
                    chunks.renew(new_chunk, false);
                }

                let index = match chunks.raw(&coords) {
                    Some(chunk) => {
                        if let ChunkStatus::Generating(index) = chunk.status {
                            index
                        } else {
                            pipeline.remove_chunk_tracking(&coords);
                            continue;
                        }
                    }
                    None => {
                        pipeline.remove_chunk_tracking(&coords);
                        continue;
                    }
                };
                let stage = &pipeline.stages[index];
                let margin = stage.neighbors(&config);

                if margin > 0 {
                    let r = (margin
                        .saturating_add(chunk_size.saturating_sub(1))
                        / chunk_size)
                        .min(i32::MAX as usize) as i32;
                    let radius_sq = i64::from(r) * i64::from(r);
                    let mut ready = true;

                    'outer: for x in -r..=r {
                        for z in -r..=r {
                            if (x == 0 && z == 0)
                                || (i64::from(x) * i64::from(x) + i64::from(z) * i64::from(z)
                                    > radius_sq)
                            {
                                continue;
                            }

                            let Some(nx) = coords.0.checked_add(x) else {
                                continue;
                            };
                            let Some(nz) = coords.1.checked_add(z) else {
                                continue;
                            };
                            let n_coords = Vec2(nx, nz);

                            if !chunks.is_within_world(&n_coords)
                                || chunks.is_chunk_ready(&n_coords)
                            {
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

                let chunk = chunks.raw(&coords).unwrap().clone();
                if let Some(data) = stage.needs_space() {
                    let mut space = chunks.make_space(&coords, margin);

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
        }

        // parallelize loading
        let loaded_chunks: Vec<(Vec2<i32>, Option<Chunk>)> =
            if to_load.len() <= SMALL_PARALLEL_CHUNK_LOAD_LIMIT {
                let mut loaded_chunks = Vec::with_capacity(to_load.len());
                for coords in to_load {
                    let loaded = chunks.try_load(&coords, &registry);
                    loaded_chunks.push((coords, loaded));
                }
                loaded_chunks
            } else {
                to_load
                    .into_par_iter()
                    .map(|coords| {
                        let loaded = chunks.try_load(&coords, &registry);
                        (coords, loaded)
                    })
                    .collect()
            };

        for (coords, loaded_chunk) in loaded_chunks.into_iter() {
            if let Some(chunk) = loaded_chunk {
                chunks.renew(chunk, false);
            } else {
                pipeline.add_chunk(&coords, false);
            }
        }

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config);
        }

        /* -------------------------------------------------------------------------- */
        /*                          HANDLING MESHING RESULTS                          */
        /* -------------------------------------------------------------------------- */

        let mesher_results = mesher.results();

        for (mut chunk, r#type) in mesher_results {
            if r#type == MessageType::Load {
                if let Some(listeners) = chunks.listeners.remove(&chunk.coords) {
                    for n_coords in listeners {
                        match chunks.raw(&n_coords) {
                            None => pipeline.add_chunk(&n_coords, true),
                            Some(neighbor) if matches!(neighbor.status, ChunkStatus::Generating(_)) => {
                                pipeline.add_chunk(&n_coords, true);
                            }
                            Some(neighbor) if matches!(neighbor.status, ChunkStatus::Meshing) => {
                                mesher.add_chunk(&n_coords, true);
                            }
                            Some(_) => {}
                        }
                    }
                }
            }

            chunk.status = ChunkStatus::Ready;
            let is_updating = r#type == MessageType::Update;

            if r#type == MessageType::Load && chunks.freshly_created.remove(&chunk.coords) {
                chunks.newly_generated.push(chunk.coords);
            }

            chunks.add_chunk_to_send(&chunk.coords, &r#type, false);

            chunks.renew(chunk, is_updating);
        }

        let pending_remesh_coords = mesher.drain_pending_remesh();
        if !pending_remesh_coords.is_empty() {
            let mut remesh_processes = Vec::with_capacity(pending_remesh_coords.len());
            for coords in pending_remesh_coords {
                if !chunks.is_chunk_ready(&coords) {
                    continue;
                }
                if mesher.has_chunk(&coords) {
                    mesher.mark_for_remesh(&coords);
                    continue;
                }
                let space = chunks
                    .make_space(&coords, config.max_light_level as usize)
                    .needs_height_maps()
                    .needs_voxels()
                    .needs_lights()
                    .build();
                let chunk = chunks.raw(&coords).unwrap().to_owned();
                chunks.add_chunk_to_save(&coords, true);
                remesh_processes.push((chunk, space));
            }
            if !remesh_processes.is_empty() {
                mesher.process(remesh_processes, &MessageType::Update, &registry, &config);
            }
        }

        /* -------------------------------------------------------------------------- */
        /*                         PUSHING CHUNKS TO BE MESHED                        */
        /* -------------------------------------------------------------------------- */

        if mesher.queue.len() > 1 {
            mesher
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut ready_chunks = Vec::with_capacity(mesher.queue.len());

        while let Some(coords) = mesher.get() {
            let mut ready = true;

            for n_coords in chunks.light_traversed_chunks(&coords) {
                let Some(n_chunk) = chunks.raw(&n_coords) else {
                    ready = false;
                    break;
                };
                if matches!(n_chunk.status, ChunkStatus::Generating(_)) {
                    ready = false;
                    chunks.add_listener(&n_coords, &coords);
                    break;
                }

                if let Some(blocks) = pipeline.leftovers.get(&n_coords) {
                    for (voxel, val) in blocks.iter() {
                        let Vec3(vx, vy, vz) = *voxel;
                        if chunks.set_raw_voxel(vx, vy, vz, *val) {
                            let id = BlockUtils::extract_id(*val);
                            update_chunk_column_height_for_voxel_update(
                                &mut chunks,
                                &registry,
                                vx,
                                vy,
                                vz,
                                id,
                            );
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
        }

        // Process the ready chunks in parallel
        if !ready_chunks.is_empty() {
            let mut processes = Vec::with_capacity(ready_chunks.len());
            for (coords, chunk) in ready_chunks {
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
            mesher.process(processes, &MessageType::Load, &registry, &config);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        accumulate_chunk_interest_weight, chunk_interest_alignment, next_pipeline_stage,
    };
    use crate::Vec2;

    #[test]
    fn chunk_interest_alignment_is_zero_for_identical_coords() {
        let center = Vec2(10, -4);
        let alignment = chunk_interest_alignment(&center, &center, &Vec2(1.0, 0.0));
        assert_eq!(alignment, 0.0);
    }

    #[test]
    fn chunk_interest_alignment_clamps_negative_dot_products() {
        let center = Vec2(0, 0);
        let coords = Vec2(1, 0);
        let alignment = chunk_interest_alignment(&center, &coords, &Vec2(-1.0, 0.0));
        assert_eq!(alignment, 0.0);
    }

    #[test]
    fn chunk_interest_alignment_rejects_non_finite_direction_vectors() {
        let center = Vec2(0, 0);
        let coords = Vec2(1, 1);
        let alignment = chunk_interest_alignment(&center, &coords, &Vec2(f32::NAN, 1.0));
        assert_eq!(alignment, 0.0);
    }

    #[test]
    fn chunk_interest_alignment_clamps_large_finite_direction_vectors() {
        let center = Vec2(0, 0);
        let coords = Vec2(1, 0);
        let alignment = chunk_interest_alignment(&center, &coords, &Vec2(f32::MAX, 0.0));
        assert_eq!(alignment, f32::MAX);
    }

    #[test]
    fn chunk_interest_alignment_stays_finite_for_extreme_coordinates() {
        let center = Vec2(i32::MIN, i32::MIN);
        let coords = Vec2(i32::MAX, i32::MAX);
        let alignment = chunk_interest_alignment(&center, &coords, &Vec2(0.0, 1.0));
        assert!(alignment.is_finite());
        assert!(alignment > 0.0);
    }

    #[test]
    fn accumulate_chunk_interest_weight_clamps_non_finite_contributions() {
        assert_eq!(
            accumulate_chunk_interest_weight(1.0, f32::MAX, f32::MAX),
            f32::MAX
        );
    }

    #[test]
    fn accumulate_chunk_interest_weight_ignores_non_positive_alignment() {
        assert_eq!(accumulate_chunk_interest_weight(5.0, 10.0, 0.0), 5.0);
        assert_eq!(accumulate_chunk_interest_weight(5.0, 10.0, -1.0), 5.0);
    }

    #[test]
    fn next_pipeline_stage_saturates_at_usize_max() {
        assert_eq!(next_pipeline_stage(0), 1);
        assert_eq!(next_pipeline_stage(usize::MAX), usize::MAX);
    }
}
