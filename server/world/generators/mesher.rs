use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    Chunk, GeometryProtocol, LightColor, MeshProtocol, MessageType, Registry, Space, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

use super::lights::Lights;

#[inline]
fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[inline]
fn clamp_u128_to_i64(value: u128) -> i64 {
    if value > i64::MAX as u128 {
        i64::MAX
    } else {
        value as i64
    }
}

#[inline]
fn mesh_protocol_level(level: u32) -> i32 {
    i32::try_from(level).unwrap_or(i32::MAX)
}

#[inline]
fn sub_chunk_y_bounds(min_y: i32, max_height: usize, sub_chunks: usize, level: u32) -> Option<(i32, i32)> {
    if max_height == 0 || sub_chunks == 0 {
        return None;
    }

    let level = usize::try_from(level).ok()?;
    if level >= sub_chunks {
        return None;
    }

    let sub_chunks_u128 = sub_chunks as u128;
    let max_height_u128 = max_height as u128;
    let level_u128 = level as u128;
    let start_offset = (level_u128 * max_height_u128) / sub_chunks_u128;
    let end_offset = ((level_u128 + 1) * max_height_u128) / sub_chunks_u128;
    if end_offset <= start_offset {
        return None;
    }

    let start = clamp_i64_to_i32(i64::from(min_y).saturating_add(clamp_u128_to_i64(start_offset)));
    let end = clamp_i64_to_i32(i64::from(min_y).saturating_add(clamp_u128_to_i64(end_offset)));
    if end <= start {
        return None;
    }

    Some((start, end))
}

pub struct Mesher {
    pub(crate) queue: std::collections::VecDeque<Vec2<i32>>,
    pub(crate) map: HashSet<Vec2<i32>>,
    pub(crate) pending_remesh: HashSet<Vec2<i32>>,
    sender: Arc<Sender<(Chunk, MessageType)>>,
    receiver: Arc<Receiver<(Chunk, MessageType)>>,
    pool: ThreadPool,
}

impl Mesher {
    #[inline]
    fn remove_queued_chunk(&mut self, coords: &Vec2<i32>) {
        if self.queue.is_empty() {
            return;
        }
        if self.queue.front().is_some_and(|front| front == coords) {
            self.queue.pop_front();
            return;
        }
        if self.queue.back().is_some_and(|back| back == coords) {
            self.queue.pop_back();
            return;
        }
        if let Some(index) = self.queue.iter().position(|queued| queued == coords) {
            self.queue.remove(index);
        }
    }

    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            queue: std::collections::VecDeque::new(),
            map: HashSet::new(),
            pending_remesh: HashSet::new(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("chunk-meshing-{index}"))
                .num_threads(
                    std::thread::available_parallelism()
                        .map(|p| p.get())
                        .unwrap_or(4),
                )
                .build()
                .unwrap(),
        }
    }

    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.map.contains(coords) {
            return;
        }

        if self.queue.is_empty() {
            if prioritized {
                self.queue.push_front(coords.to_owned());
            } else {
                self.queue.push_back(coords.to_owned());
            }
            return;
        }
        if prioritized {
            if self.queue.front().is_some_and(|front| front == coords) {
                return;
            }
        } else if self.queue.back().is_some_and(|back| back == coords) {
            return;
        }

        self.remove_queued_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.map.remove(coords);
        self.remove_queued_chunk(coords);
    }

    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains(coords)
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
            .filter(|(chunk, _)| self.map.insert(chunk.coords.to_owned()))
            .collect();

        if processes.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        let r#type = r#type.clone();
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        self.pool.spawn(move || {
            processes
                .into_par_iter()
                .for_each(|(mut chunk, mut space)| {
                    let chunk_size = if config.chunk_size == 0 {
                        1
                    } else if config.chunk_size > i32::MAX as usize {
                        i32::MAX
                    } else {
                        config.chunk_size as i32
                    };
                    let chunk_size_usize = chunk_size as usize;
                    let coords = space.coords.to_owned();
                    let min = space.min.to_owned();
                    let shape = space.shape.to_owned();

                    let light_colors = [
                        LightColor::Sunlight,
                        LightColor::Red,
                        LightColor::Green,
                        LightColor::Blue,
                    ];

                    let sub_chunks = chunk.updated_levels.clone();
                    let Vec3(min_x, min_y, min_z) = chunk.min;
                    let Vec3(max_x, _, max_z) = chunk.max;

                    if chunk.meshes.is_none() {
                        let mut light_queues = vec![VecDeque::new(); 4];

                        for dx in -1..=1 {
                            for dz in -1..=1 {
                                let center = dx == 0 && dz == 0;
                                let min_x = coords
                                    .0
                                    .saturating_add(dx)
                                    .saturating_mul(chunk_size)
                                    .saturating_sub(if center { 1 } else { 0 });
                                let min_z = coords
                                    .1
                                    .saturating_add(dz)
                                    .saturating_mul(chunk_size)
                                    .saturating_sub(if center { 1 } else { 0 });
                                let min = Vec3(
                                    min_x,
                                    0,
                                    min_z,
                                );
                                let shape = Vec3(
                                    chunk_size_usize + if center { 2 } else { 0 },
                                    space.options.max_height as usize,
                                    chunk_size_usize + if center { 2 } else { 0 },
                                );

                                let light_subqueues =
                                    Lights::propagate(&mut space, &min, &shape, &registry, &config);

                                for (queue, subqueue) in
                                    light_queues.iter_mut().zip(light_subqueues.into_iter())
                                {
                                    queue.extend(subqueue);
                                }
                            }
                        }

                        for (queue, color) in light_queues.into_iter().zip(light_colors.iter()) {
                            if !queue.is_empty() {
                                Lights::flood_light(
                                    &mut space,
                                    queue,
                                    color,
                                    &registry,
                                    &config,
                                    Some(&min),
                                    Some(&shape),
                                );
                            }
                        }

                        chunk.lights =
                            Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
                    }

                    let mesher_registry = registry.mesher_registry();

                    for level_u32 in sub_chunks {
                        let Some((level_start_y, level_end_y)) = sub_chunk_y_bounds(
                            min_y,
                            space.options.max_height,
                            space.options.sub_chunks,
                            level_u32,
                        ) else {
                            continue;
                        };
                        let level = mesh_protocol_level(level_u32);
                        let min = Vec3(min_x, level_start_y, min_z);
                        let max = Vec3(max_x, level_end_y, max_z);

                        let min_arr = [min.0, min.1, min.2];
                        let max_arr = [max.0, max.1, max.2];

                        let mesher_geometries = if config.greedy_meshing {
                            voxelize_mesher::mesh_space_greedy(
                                &min_arr,
                                &max_arr,
                                &space,
                                mesher_registry.as_ref(),
                            )
                        } else {
                            voxelize_mesher::mesh_space(
                                &min_arr,
                                &max_arr,
                                &space,
                                mesher_registry.as_ref(),
                            )
                        };

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

                        chunk
                            .meshes
                            .get_or_insert_with(HashMap::new)
                            .insert(level_u32, MeshProtocol { level, geometries });
                    }

                    sender.send((chunk, r#type.clone())).unwrap();
                });
        });
    }

    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let pending_results = self.receiver.len();
        if pending_results == 0 {
            return Vec::new();
        }
        if self.map.is_empty() {
            while self.receiver.try_recv().is_ok() {}
            return Vec::new();
        }
        if pending_results == 1 {
            if let Ok(result) = self.receiver.try_recv() {
                if self.map.remove(&result.0.coords) {
                    return vec![result];
                }
            }
            return Vec::new();
        }
        let mut results = Vec::with_capacity(pending_results.min(self.map.len()));

        while let Ok(result) = self.receiver.try_recv() {
            if self.map.remove(&result.0.coords) {
                results.push(result);
            }
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
    use super::{mesh_protocol_level, sub_chunk_y_bounds};

    #[test]
    fn sub_chunk_y_bounds_cover_full_height_for_irregular_partitions() {
        assert_eq!(sub_chunk_y_bounds(0, 10, 3, 0), Some((0, 3)));
        assert_eq!(sub_chunk_y_bounds(0, 10, 3, 1), Some((3, 6)));
        assert_eq!(sub_chunk_y_bounds(0, 10, 3, 2), Some((6, 10)));
    }

    #[test]
    fn sub_chunk_y_bounds_reject_invalid_sub_chunk_levels() {
        assert_eq!(sub_chunk_y_bounds(0, 10, 0, 0), None);
        assert_eq!(sub_chunk_y_bounds(0, 0, 3, 0), None);
        assert_eq!(sub_chunk_y_bounds(0, 10, 3, 3), None);
    }

    #[test]
    fn sub_chunk_y_bounds_clamp_to_i32_range_for_extreme_offsets() {
        assert_eq!(
            sub_chunk_y_bounds(0, usize::MAX, 1, 0),
            Some((0, i32::MAX))
        );
        assert_eq!(
            sub_chunk_y_bounds(i32::MAX - 1, usize::MAX, 1, 0),
            Some((i32::MAX - 1, i32::MAX))
        );
        assert_eq!(
            sub_chunk_y_bounds(i32::MIN + 1, usize::MAX, 1, 0),
            Some((i32::MIN + 1, i32::MAX))
        );
    }

    #[test]
    fn mesh_protocol_level_saturates_to_i32_max() {
        assert_eq!(mesh_protocol_level(0), 0);
        assert_eq!(mesh_protocol_level(i32::MAX as u32), i32::MAX);
        assert_eq!(mesh_protocol_level(u32::MAX), i32::MAX);
    }
}
