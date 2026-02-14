use hashbrown::HashMap;
use nanoid::nanoid;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::world::profiler::Profiler;
use crate::world::system_profiler::WorldTimingContext;
use crate::{
    BlockUtils, Chunk, ChunkInterests, ChunkOptions, ChunkRequestsComp, ChunkStatus, ChunkUtils,
    Chunks, Clients, Mesher, MessageType, Pipeline, Registry, Stats, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};

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
    let normalized_direction_to_chunk = Vec2(
        (direction_to_chunk_x / mag) as f32,
        (direction_to_chunk_z / mag) as f32,
    );
    (direction.0 * normalized_direction_to_chunk.0 + direction.1 * normalized_direction_to_chunk.1)
        .max(0.0)
}

#[inline]
fn apply_leftover_height_update(
    chunks: &mut Chunks,
    registry: &Registry,
    vx: i32,
    vy: i32,
    vz: i32,
    updated_id: u32,
) {
    let height = chunks.get_max_height(vx, vz);
    if registry.is_air(updated_id) {
        let Ok(vy_u32) = u32::try_from(vy) else {
            return;
        };
        if vy_u32 != height {
            return;
        }
        for y in (0..vy).rev() {
            if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz)) {
                chunks.set_max_height(vx, vz, y as u32);
                break;
            }
        }
    } else if let Ok(vy_u32) = u32::try_from(vy) {
        if height < vy_u32 {
            chunks.set_max_height(vx, vz, vy_u32);
        }
    }
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
            stats,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            mut profiler,
            requests,
            timing,
        ) = data;
        let _t = timing.timer("chunk-generating");

        let chunk_size = config.chunk_size.max(1);

        /* -------------------------------------------------------------------------- */
        /*                     RECALCULATE CHUNK INTEREST WEIGHTS                     */
        /* -------------------------------------------------------------------------- */

        interests.weights.clear();

        let mut weights = HashMap::with_capacity(interests.map.len());

        for (coords, ids) in &interests.map {
            let mut weight = 0.0;

            for id in ids {
                if let Some(client) = clients.get(id) {
                    if let Some(request) = requests.get(client.entity) {
                        let dist = ChunkUtils::distance_squared(&request.center, &coords);
                        let alignment =
                            chunk_interest_alignment(&request.center, coords, &request.direction);
                        if alignment > 0.0 {
                            weight += dist * alignment;
                        }
                    }
                }
            }

            weights.insert(coords.clone(), weight);
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

        for coords in pipeline.drain_pending_regenerate() {
            pipeline.add_chunk(&coords, true);
        }

        /* -------------------------------------------------------------------------- */
        /*                       PUSHING CHUNKS TO BE PROCESSED                       */
        /* -------------------------------------------------------------------------- */

        let mut processes = vec![];

        if !pipeline.queue.is_empty() {
            pipeline
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut to_load = vec![];
        while !pipeline.queue.is_empty() && !pipeline.stages.is_empty() {
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

                chunks.freshly_created.insert(coords.to_owned());
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
        }

        // parallelize loading
        let loaded_chunks: Vec<(Vec2<i32>, Option<Chunk>)> = to_load
            .into_par_iter()
            .map(|coords| (coords.to_owned(), chunks.try_load(&coords, &registry)))
            .collect();

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

            if r#type == MessageType::Load && chunks.freshly_created.remove(&chunk.coords) {
                chunks.newly_generated.push(chunk.coords.to_owned());
            }

            chunks.add_chunk_to_send(&chunk.coords, &r#type, false);

            chunks.renew(chunk, is_updating);
        }

        let pending_remesh_coords = mesher.drain_pending_remesh();
        if !pending_remesh_coords.is_empty() {
            let mut remesh_processes = Vec::new();
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

        if !mesher.queue.is_empty() {
            mesher
                .queue
                .make_contiguous()
                .sort_by(|a, b| interests.compare(a, b));
        }

        let mut ready_chunks = vec![];

        while !mesher.queue.is_empty() {
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
                    for (voxel, val) in blocks.iter() {
                        let Vec3(vx, vy, vz) = *voxel;
                        chunks.set_raw_voxel(vx, vy, vz, *val);

                        let id = BlockUtils::extract_id(*val);
                        apply_leftover_height_update(&mut chunks, &registry, vx, vy, vz, id);
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
            let processes = ready_chunks
                .into_iter()
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{apply_leftover_height_update, chunk_interest_alignment};
    use crate::{Block, Chunk, ChunkOptions, Chunks, Registry, Vec2, VoxelAccess, WorldConfig};

    fn create_chunk_registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("stone").id(1).build());
        registry
    }

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
    fn chunk_interest_alignment_stays_finite_for_extreme_coordinates() {
        let center = Vec2(i32::MIN, i32::MIN);
        let coords = Vec2(i32::MAX, i32::MAX);
        let alignment = chunk_interest_alignment(&center, &coords, &Vec2(0.0, 1.0));
        assert!(alignment.is_finite());
        assert!(alignment > 0.0);
    }

    #[test]
    fn apply_leftover_height_update_scans_from_previous_voxel_level() {
        let registry = create_chunk_registry();
        let config = WorldConfig {
            chunk_size: 16,
            max_height: 16,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
            saving: false,
            ..Default::default()
        };
        let mut chunks = Chunks::new(&config);
        chunks.add(Chunk::new(
            "chunk-0-0",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 16,
                sub_chunks: 1,
            },
        ));

        chunks.set_raw_voxel(0, 4, 0, 1);
        chunks.set_raw_voxel(0, 5, 0, 1);
        chunks.set_max_height(0, 0, 5);

        chunks.set_raw_voxel(0, 5, 0, 0);
        apply_leftover_height_update(&mut chunks, &registry, 0, 5, 0, 0);

        assert_eq!(chunks.get_max_height(0, 0), 4);
    }

    #[test]
    fn apply_leftover_height_update_ignores_negative_voxel_y_for_solid_blocks() {
        let registry = create_chunk_registry();
        let config = WorldConfig {
            chunk_size: 16,
            max_height: 16,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
            saving: false,
            ..Default::default()
        };
        let mut chunks = Chunks::new(&config);
        chunks.add(Chunk::new(
            "chunk-0-0",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 16,
                sub_chunks: 1,
            },
        ));
        chunks.set_max_height(0, 0, 2);

        apply_leftover_height_update(&mut chunks, &registry, 0, -1, 0, 1);

        assert_eq!(chunks.get_max_height(0, 0), 2);
    }
}
