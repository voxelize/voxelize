use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    Chunk, GeometryProtocol, LightColor, MeshProtocol, MessageType, Registry, Space, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

use super::lights::Lights;

pub struct Mesher {
    pub(crate) queue: std::collections::VecDeque<Vec2<i32>>,
    pub(crate) map: HashSet<Vec2<i32>>,
    pub(crate) pending_remesh: HashSet<Vec2<i32>>,
    sender: Arc<Sender<(Chunk, MessageType)>>,
    receiver: Arc<Receiver<(Chunk, MessageType)>>,
    pool: ThreadPool,
}

impl Mesher {
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
                    let blocks_per_sub_chunk =
                        (space.options.max_height / space.options.sub_chunks.max(1))
                            .min(i32::MAX as usize) as i32;

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

                    for level in sub_chunks {
                        let level = i32::try_from(level).unwrap_or(i32::MAX);

                        let level_start_y =
                            min_y.saturating_add(level.saturating_mul(blocks_per_sub_chunk));
                        let level_end_y = min_y.saturating_add(
                            level
                                .saturating_add(1)
                                .saturating_mul(blocks_per_sub_chunk),
                        );
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
                            .insert(level as u32, MeshProtocol { level, geometries });
                    }

                    sender.send((chunk, r#type.clone())).unwrap();
                });
        });
    }

    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if !self.map.contains(&result.0.coords) {
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
