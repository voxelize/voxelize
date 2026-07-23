use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    Chunk, ChunkLodConfig, GeometryProtocol, LightColor, MeshProtocol, MessageType, Registry,
    Space, Vec2, Vec3, VoxelAccess, WorldConfig,
};

use super::lights::Lights;

fn to_geometry_protocols(
    geometries: Vec<voxelize_mesher::GeometryProtocol>,
) -> Vec<GeometryProtocol> {
    geometries
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
        .collect()
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
        let is_load = r#type == MessageType::Load;
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        self.pool.spawn(move || {
            processes
                .into_par_iter()
                .for_each(|(mut chunk, mut space)| {
                    let chunk_size = config.chunk_size as i32;
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
                        (space.options.max_height / space.options.sub_chunks) as i32;

                    if is_load {
                        let mut light_queues = vec![VecDeque::new(); 4];

                        let started = std::time::Instant::now();
                        for dx in -1..=1 {
                            for dz in -1..=1 {
                                let min = Vec3(
                                    (coords.0 + dx) * chunk_size
                                        - if dx == 0 && dz == 0 { 1 } else { 0 },
                                    0,
                                    (coords.1 + dz) * chunk_size
                                        - if dx == 0 && dz == 0 { 1 } else { 0 },
                                );
                                let shape = Vec3(
                                    chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
                                    space.options.max_height as usize,
                                    chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
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
                        super::gen_profiler::record("lights: propagate scan", started.elapsed());

                        let started = std::time::Instant::now();
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
                        super::gen_profiler::record("lights: flood", started.elapsed());

                        chunk.lights =
                            Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
                    }

                    let started = std::time::Instant::now();
                    let needs_full_meshes = !config.client_only_meshing;

                    let mesher_registry = if needs_full_meshes || config.chunk_lod.is_some() {
                        let mut mesher_registry = registry.to_mesher_registry();
                        mesher_registry.build_cache();
                        Some(mesher_registry)
                    } else {
                        None
                    };

                    if !needs_full_meshes {
                        chunk.meshes = None;
                    } else {
                        let mesher_registry = mesher_registry.as_ref().unwrap();

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
                                mesher_registry,
                            );

                            chunk.meshes.get_or_insert_with(HashMap::new).insert(
                                level as u32,
                                MeshProtocol {
                                    level,
                                    lod: 0,
                                    geometries: to_geometry_protocols(mesher_geometries),
                                },
                            );
                        }
                    }

                    if let Some(chunk_lod) = &config.chunk_lod {
                        Self::build_lod_pyramid(
                            &mut chunk,
                            chunk_lod,
                            mesher_registry.as_ref().unwrap(),
                            &config,
                        );
                    }
                    super::gen_profiler::record("mesh: greedy", started.elapsed());

                    let _ = sender.send((chunk, r#type.clone()));
                });
        });
    }

    /// Build (or rebuild) the chunk's reduced-detail mesh pyramid, one
    /// whole-column mesh per configured LOD level. Runs on the meshing
    /// thread pool next to the full-detail meshing; the downsample pass is a
    /// single sweep over the chunk arrays and the coarse mesh volume is
    /// `1/8^level` of the chunk, so the added cost is a small fraction of a
    /// full mesh.
    fn build_lod_pyramid(
        chunk: &mut Chunk,
        chunk_lod: &ChunkLodConfig,
        mesher_registry: &voxelize_mesher::Registry,
        config: &WorldConfig,
    ) {
        let shape = [config.chunk_size, config.max_height, config.chunk_size];

        let lod_meshes = chunk.lod_meshes.get_or_insert_with(HashMap::new);

        for level in chunk_lod.levels() {
            let geometries = voxelize_mesher::mesh_chunk_lod(
                &chunk.voxels.data,
                &chunk.lights.data,
                shape,
                level,
                mesher_registry,
            );

            lod_meshes.insert(
                level,
                MeshProtocol {
                    level: 0,
                    lod: level,
                    geometries: to_geometry_protocols(geometries),
                },
            );
        }
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
