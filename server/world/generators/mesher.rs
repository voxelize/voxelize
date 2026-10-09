use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool};

use crate::{
    world::shared_pools::{InflightJob, MESHING_INFLIGHT},
    Chunk, GeometryProtocol, LightColor, MeshProtocol, MessageType, Registry, Space, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

use super::lights::Lights;

/// How many times a finished Load pass may be thrown away because writes
/// reached the live chunk while it ran. Past this the result is accepted
/// as it is, so a chunk under a steady stream of writes (a fluid front on
/// its border) still reaches the clients waiting on it.
const MAX_STALE_LOAD_RETRIES: u8 = 2;

pub struct Mesher {
    pub(crate) queue: std::collections::VecDeque<Vec2<i32>>,
    pub(crate) map: HashSet<Vec2<i32>>,
    pub(crate) pending_remesh: HashSet<Vec2<i32>>,
    /// Load passes relit because the live chunk moved on under them, per
    /// chunk, forgotten once a result is accepted.
    stale_load_retries: HashMap<Vec2<i32>, u8>,
    sender: Arc<Sender<(Chunk, MessageType)>>,
    receiver: Arc<Receiver<(Chunk, MessageType)>>,
    pool: Arc<ThreadPool>,
}

impl Mesher {
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            queue: std::collections::VecDeque::new(),
            map: HashSet::new(),
            pending_remesh: HashSet::new(),
            stale_load_retries: HashMap::new(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: crate::world::shared_pools::meshing_pool(),
        }
    }

    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.map.contains(coords) {
            return;
        }

        self.remove_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.map.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    /// Drop a queued mesh nobody wants any more. A mesh already running is
    /// left to land: forgetting it would throw the result away. The chunk
    /// otherwise stays parked at `Meshing`, which neighbors treat as done and
    /// a later request revives.
    pub fn drop_queued(&mut self, coords: &Vec2<i32>) {
        self.queue.retain(|c| c != coords);
    }

    /// Forgets every chunk queued for meshing. Pairs with wiping the chunk map,
    /// where the geometry these entries describe no longer exists.
    pub fn clear(&mut self) {
        self.map.clear();
        self.queue.clear();
        self.pending_remesh.clear();
        self.stale_load_retries.clear();
    }

    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains(coords)
    }

    /// A Load result landed for a chunk that was written to since its
    /// dispatch. Says whether to light it again from the live state (true)
    /// or to accept the stale result after `MAX_STALE_LOAD_RETRIES` relights
    /// (false), so a chunk under constant writes still reaches clients.
    pub fn retry_stale_load(&mut self, coords: &Vec2<i32>) -> bool {
        let tries = self.stale_load_retries.entry(coords.to_owned()).or_insert(0);
        if *tries >= MAX_STALE_LOAD_RETRIES {
            self.stale_load_retries.remove(coords);
            return false;
        }
        *tries += 1;
        true
    }

    /// A Load result for this chunk was accepted: its retry count is over.
    pub fn accept_load(&mut self, coords: &Vec2<i32>) {
        self.stale_load_retries.remove(coords);
    }

    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    pub fn mark_for_remesh(&mut self, coords: &Vec2<i32>) {
        if self.map.contains(coords) {
            self.pending_remesh.insert(coords.to_owned());
        }
    }

    pub fn drain_pending_remesh(&mut self) -> Vec<Vec2<i32>> {
        self.pending_remesh.drain().collect()
    }

    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Space)>,
        r#type: &MessageType,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let processes: Vec<(Chunk, Space)> = processes
            .into_iter()
            .filter(|(chunk, _)| {
                if self.map.contains(&chunk.coords) {
                    false
                } else {
                    self.map.insert(chunk.coords.to_owned());
                    true
                }
            })
            .collect();

        if processes.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        let r#type = r#type.clone();
        let is_load = r#type == MessageType::Load;
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        InflightJob::queue(&MESHING_INFLIGHT, processes.len());
        self.pool.spawn(move || {
            processes
                .into_par_iter()
                .for_each(|(mut chunk, mut space)| {
                    let _inflight = InflightJob::adopt(&MESHING_INFLIGHT);
                    let coords = space.coords.to_owned();

                    let sub_chunks = chunk.updated_levels.clone();
                    let Vec3(min_x, min_y, min_z) = chunk.min;
                    let Vec3(max_x, _, max_z) = chunk.max;
                    let blocks_per_sub_chunk =
                        (space.options.max_height / space.options.sub_chunks) as i32;

                    if is_load {
                        Lights::light_fresh_chunk(&mut space, &registry, &config);

                        chunk.lights =
                            Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
                    }

                    let started = std::time::Instant::now();
                    if config.client_only_meshing {
                        chunk.meshes = None;
                    } else {
                        let mut mesher_registry = registry.to_mesher_registry();
                        mesher_registry.build_cache();

                        for level in sub_chunks {
                            let level = level as i32;

                            let min = Vec3(min_x, min_y + level * blocks_per_sub_chunk, min_z);
                            let max =
                                Vec3(max_x, min_y + (level + 1) * blocks_per_sub_chunk, max_z);

                            let min_arr = [min.0, min.1, min.2];
                            let max_arr = [max.0, max.1, max.2];

                            let mesher_geometries = voxelize_mesher::mesh_space_greedy(
                                &min_arr,
                                &max_arr,
                                &space,
                                &mesher_registry,
                            );
                            let connectivity = voxelize_mesher::compute_section_connectivity(
                                &min_arr,
                                &max_arr,
                                &space,
                                &mesher_registry,
                            );

                            let geometries: Vec<GeometryProtocol> = mesher_geometries
                                .into_iter()
                                .map(|g| GeometryProtocol {
                                    voxel: g.voxel,
                                    at: g.at.map(|[x, y, z]| vec![x, y, z]).unwrap_or_default(),
                                    face_name: g.face_name,
                                    positions: g.positions,
                                    indices: g.indices,
                                    uvs: g.uvs,
                                    lights: g.lights,
                                })
                                .collect();

                            chunk.meshes.get_or_insert_with(HashMap::new).insert(
                                level as u32,
                                MeshProtocol {
                                    level,
                                    geometries,
                                    connectivity: Some(connectivity),
                                },
                            );
                        }
                    }
                    super::gen_profiler::record("mesh: greedy", started.elapsed());

                    let _ = sender.send((chunk, r#type.clone()));
                });
        });
    }

    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if !self.map.contains(&result.0.coords) {
                // The only legitimate path here is a world wipe between
                // dispatch and completion (`clear` empties the map). A
                // finished mesh vanishing for any other reason means a chunk
                // some client is waiting on will never arrive — say so
                // instead of silently eating the work.
                log::warn!(
                    "[mesher] discarding a finished {:?} mesh for {:?}: no longer tracked (expected only after a world wipe)",
                    result.1,
                    result.0.coords
                );
                continue;
            }

            self.remove_chunk(&result.0.coords);
            results.push(result);
        }

        results
    }
}

impl Default for Mesher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_load_is_relit_a_bounded_number_of_times_then_accepted() {
        let mut mesher = Mesher::new();
        let coords = Vec2(3, -1);
        let other = Vec2(0, 0);

        assert!(mesher.retry_stale_load(&coords));
        assert!(mesher.retry_stale_load(&coords));
        assert!(
            !mesher.retry_stale_load(&coords),
            "a chunk written to on every pass must still be delivered"
        );
        // Another chunk's count is its own.
        assert!(mesher.retry_stale_load(&other));

        // Accepting a result forgets the count, so a later regenerate pass
        // gets its full allowance again.
        mesher.accept_load(&other);
        assert!(mesher.retry_stale_load(&other));
        assert!(mesher.retry_stale_load(&other));
        assert!(!mesher.retry_stale_load(&other));
    }
}
