use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use hashbrown::{HashMap, HashSet};
use rayon::prelude::{IndexedParallelIterator, IntoParallelIterator, ParallelIterator};
use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::{
    Chunk, ChunkStatus, Registry, Space, SpaceData, Terrain, Vec2, Vec3, VoxelAccess, VoxelUpdate,
    WorldConfig,
};

#[derive(Clone)]
pub struct Resources<'a> {
    pub registry: &'a Registry,
    pub config: &'a WorldConfig,
}

#[derive(Default)]
pub(crate) struct MetaStage {
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
}

impl MetaStage {
    pub fn add_stage(&mut self, stage: Arc<dyn ChunkStage + Send + Sync>) {
        self.stages.push(stage);
    }
}

impl ChunkStage for MetaStage {
    fn name(&self) -> String {
        self.stages
            .iter()
            .map(|stage| stage.name())
            .collect::<Vec<_>>()
            .join(" -> ")
    }

    fn process(&self, mut chunk: Chunk, resources: Resources, _: Option<Space>) -> Chunk {
        for stage in &self.stages {
            chunk = stage.process(chunk, resources.clone(), None);
            chunk.calculate_max_height(&resources.registry);
        }

        chunk
    }
}

/// A stage in the pipeline where a chunk gets populated.
pub trait ChunkStage {
    /// The name of the stage, e.g. "Soiling"
    fn name(&self) -> String;

    /// The radius neighbor from the center chunk that are required before
    /// being processed in this chunk. Defaults to 0 blocks.
    fn neighbors(&self, _: &WorldConfig) -> usize {
        0
    }

    /// Whether if this stage needs a data-fetching structure called Space for
    /// each chunk process. In short, space provides additional information such as
    /// voxels/lights/height around the center chunk by cloning the neighboring data
    /// into the same Space, and providing data accessing utility functions. Defaults
    /// to `None`.
    fn needs_space(&self) -> Option<SpaceData> {
        None
    }

    /// The core of this chunk stage, in other words what is done on the chunk. Returns the chunk instance, and additional
    /// block changes to the world would be automatically added into `chunk.exceeded_changes`. For instance, if a tree is
    /// placed on the border of a chunk, the leaves would exceed the chunk border, thus appended to `exceeded_changes`.
    /// After each stage, the `exceeded_changes` list of block changes would be emptied and applied to the world.
    fn process(&self, chunk: Chunk, resources: Resources, space: Option<Space>) -> Chunk;
}

pub struct DebugStage {
    block: u32,
}

impl DebugStage {
    pub fn new(block: u32) -> Self {
        Self { block }
    }
}

impl ChunkStage for DebugStage {
    fn name(&self) -> String {
        "Debug".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        chunk.set_voxel(min_x, 0, min_z, self.block);
        chunk.set_voxel(min_x, 0, max_z - 1, self.block);
        chunk.set_voxel(max_x - 1, 0, min_z, self.block);
        chunk.set_voxel(max_x - 1, 0, max_z - 1, self.block);

        chunk
    }
}

/// A preset chunk stage to set a flat land.
#[derive(Default)]
pub struct FlatlandStage {
    top_height: u32,
    soiling: Vec<u32>,
}

impl FlatlandStage {
    pub fn new() -> Self {
        Self {
            top_height: 0,
            soiling: vec![],
        }
    }

    pub fn add_soiling(mut self, block: u32, height: usize) -> Self {
        for _ in 0..height {
            self.soiling.push(block);
        }

        self.top_height += height as u32;

        self
    }

    pub fn query_soiling(&self, y: u32) -> Option<u32> {
        self.soiling.get(y as usize).copied()
    }
}

impl ChunkStage for FlatlandStage {
    fn name(&self) -> String {
        "Flatland".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..self.top_height {
                    if let Some(soiling) = self.query_soiling(vy) {
                        chunk.set_voxel(vx, vy as i32, vz, soiling);
                    }
                }
            }
        }

        chunk
    }
}

pub struct BaseTerrainStage {
    threshold: f64,
    base: u32,
    terrain: Terrain,
}

impl BaseTerrainStage {
    pub fn new(terrain: Terrain) -> Self {
        Self {
            threshold: 0.0,
            base: 0,
            terrain,
        }
    }

    pub fn set_base(&mut self, base: u32) {
        self.base = base;
    }

    pub fn set_threshold(&mut self, threshold: f64) {
        self.threshold = threshold;
    }
}

impl ChunkStage for BaseTerrainStage {
    fn name(&self) -> String {
        "Base Terrain".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in min_y..max_y {
                    let (bias, offset) = self.terrain.get_bias_offset(vx, vy, vz);
                    let density = self.terrain.get_density_from_bias_offset(bias, offset, vy);

                    if density > self.threshold {
                        chunk.set_voxel(vx, vy, vz, self.base);
                    }
                }
            }
        }

        chunk
    }
}

/// A pipeline is strictly for holding the stages necessary to build the chunks.
pub struct Pipeline {
    /// A list of stages that chunks are in.
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,

    /// A set of chunk coordinates in this pipeline to know which chunks are in this pipeline.
    pub(crate) chunks: HashSet<Vec2<i32>>,

    /// A queue of chunk coordinates that are waiting to be processed.
    pub(crate) queue: VecDeque<Vec2<i32>>,

    /// A map of leftover changes from processing chunk stages.
    pub(crate) leftovers: HashMap<Vec2<i32>, Vec<VoxelUpdate>>,

    /// Chunks that received requests while being processed - need regeneration after current processing completes.
    pub(crate) pending_regenerate: HashSet<Vec2<i32>>,

    /// Sender of processed chunks from other threads to main thread.
    sender: Arc<Sender<(Chunk, Vec<VoxelUpdate>)>>,

    /// Receiver to receive processed chunks from other threads to main thread.
    receiver: Arc<Receiver<(Chunk, Vec<VoxelUpdate>)>>,

    /// Pipeline's thread pool to process chunks.
    pool: ThreadPool,
}

impl Pipeline {
    /// Create a new chunk pipeline.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("voxelize-chunking-{index}"))
                .build()
                .unwrap(),
            chunks: HashSet::new(),
            leftovers: HashMap::new(),
            pending_regenerate: HashSet::new(),
            queue: VecDeque::new(),
            stages: Vec::new(),
        }
    }

    pub fn mark_for_regenerate(&mut self, coords: &Vec2<i32>) {
        if self.chunks.contains(coords) {
            self.pending_regenerate.insert(coords.to_owned());
        }
    }

    pub fn drain_pending_regenerate(&mut self) -> Vec<Vec2<i32>> {
        self.pending_regenerate.drain().collect()
    }

    /// Add a chunk coordinate to the pipeline to be processed.
    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.has_chunk(coords) {
            self.mark_for_regenerate(coords);
            return;
        }

        self.remove_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    /// Remove a chunk coordinate from the pipeline.
    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.chunks.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    /// Check to see if a chunk coordinate is in the pipeline.
    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.chunks.contains(coords)
    }

    /// Pop the first chunk coordinate in the queue.
    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    /// Add a stage to the chunking pipeline.
    pub fn add_stage<T>(&mut self, stage: T)
    where
        T: 'static + ChunkStage + Send + Sync,
    {
        // Insert the stage to the last.
        self.stages.push(Arc::new(stage));
    }

    /// Process a list of chunk processes, generated from the ECS system `PipeliningSystem`.
    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Option<Space>)>,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        processes.iter().for_each(|(chunk, _)| {
            self.chunks.insert(chunk.coords.to_owned());
        });

        // Retrieve the chunk stages' Arc clones.
        let processes: Vec<(Chunk, Option<Space>, Arc<dyn ChunkStage + Send + Sync>)> = processes
            .into_iter()
            .map(|(chunk, space)| {
                let index = if let ChunkStatus::Generating(index) = chunk.status {
                    index
                } else {
                    panic!("Chunk in pipeline does not have a generating status.");
                };

                let stage = self.stages.get(index).unwrap().clone();
                (chunk, space, stage)
            })
            .collect();

        let sender = Arc::clone(&self.sender);
        let registry = registry.to_owned();
        let config = config.to_owned();

        rayon::spawn(move || {
            processes
                .into_par_iter()
                .enumerate()
                .for_each(|(_, (chunk, space, stage))| {
                    let sender = Arc::clone(&sender);
                    let registry = registry.clone();
                    let config = config.clone();

                    rayon::spawn_fifo(move || {
                        let mut changes = vec![];

                        let mut chunk = stage.process(
                            chunk,
                            Resources {
                                registry: &registry,
                                config: &config,
                            },
                            space,
                        );

                        // Calculate the max height after processing each chunk.
                        chunk.calculate_max_height(&registry);

                        if !chunk.extra_changes.is_empty() {
                            changes.append(&mut chunk.extra_changes.drain(..).collect());
                        }

                        sender.send((chunk, changes)).unwrap();
                    });
                });
        });
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&mut self) -> Vec<(Chunk, Vec<VoxelUpdate>)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if self.chunks.contains(&result.0.coords) {
                self.remove_chunk(&result.0.coords);
                results.push(result);
            }
        }

        results
    }

    /// Merge consecutive chunk stages that don't require spaces together into meta stages.
    pub(crate) fn merge_stages(&mut self) {
        let mut new_stages: Vec<Arc<dyn ChunkStage + Send + Sync>> = vec![];

        let mut current_meta: Option<MetaStage> = None;

        for stage in self.stages.to_owned().into_iter() {
            if stage.needs_space().is_some() {
                if let Some(current_stage) = current_meta {
                    new_stages.push(Arc::new(current_stage));
                }
                current_meta = None;
                new_stages.push(stage);
                continue;
            }

            if let Some(mut meta) = current_meta {
                meta.add_stage(stage);
                current_meta = Some(meta);
            } else {
                let mut meta = MetaStage::default();
                meta.add_stage(stage);
                current_meta = Some(meta);
            }
        }

        if let Some(meta) = current_meta {
            new_stages.push(Arc::new(meta));
        }

        self.stages = new_stages;
    }
}
