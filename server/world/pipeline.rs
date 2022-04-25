use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use hashbrown::HashSet;
use log::warn;
use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::{
    chunk::Chunk,
    common::BlockChange,
    server::models::Mesh,
    vec::{Vec2, Vec3},
};

use super::{
    lights::Lights,
    mesher::Mesher,
    registry::Registry,
    space::{Space, SpaceData},
    WorldConfig,
};

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
    ///
    /// # Example
    ///
    /// ```
    /// // If this stage needs the neighboring chunk's voxel data.
    /// impl ChunkStage for TreePlanting {
    ///   ...
    ///   // neighboring 5 blocks.
    ///   fn neighbors(&self, _:&WorldConfig) -> usize {
    ///     5
    ///   }
    ///
    ///   // get the voxel data around this chunk.
    ///   fn needs_space(&self) -> Option<SpaceData> {
    ///     Some(SpaceData {
    ///       needs_voxels: true,
    ///       ..Default::default()
    ///     })
    ///   }
    ///   ...
    /// }
    /// ```
    fn needs_space(&self) -> Option<SpaceData> {
        None
    }

    /// The core of this chunk stage, in other words what is done on the chunk. Returns the chunk instance
    /// along with additional block changes to be applied onto the world. For instance, if a tree is placed on the border
    /// of a chunk, the leaves would exceed the chunk border, so add those blocks to this `Vec`. Use "chunk.contains" or
    /// "space.contains" to see if voxel coordinate is within the chunk stage's control. Return None for the second field
    /// if no additional changes are required.
    fn process(
        &self,
        chunk: Chunk,
        registry: &Registry,
        config: &WorldConfig,
        space: Option<Space>,
    ) -> (Chunk, Option<Vec<BlockChange>>);
}

/// A preset chunk stage to calculate the chunk's height map.
pub struct HeightMapStage;

impl ChunkStage for HeightMapStage {
    fn name(&self) -> String {
        "HeightMap".to_owned()
    }

    fn process(
        &self,
        mut chunk: Chunk,
        registry: &Registry,
        _: &WorldConfig,
        _: Option<Space>,
    ) -> (Chunk, Option<Vec<BlockChange>>) {
        chunk.calculate_max_height(registry);
        (chunk, None)
    }
}

pub struct LightMeshStage;

impl ChunkStage for LightMeshStage {
    fn name(&self) -> String {
        "LightMesh".to_owned()
    }

    fn neighbors(&self, config: &WorldConfig) -> usize {
        config.max_light_level as usize
    }

    fn needs_space(&self) -> Option<SpaceData> {
        Some(SpaceData {
            needs_voxels: true,
            needs_lights: true,
            needs_height_maps: true,
        })
    }

    fn process(
        &self,
        mut chunk: Chunk,
        registry: &Registry,
        config: &WorldConfig,
        space: Option<Space>,
    ) -> (Chunk, Option<Vec<BlockChange>>) {
        // Propagate light if chunk hasn't been propagated.
        let mut space = space.unwrap();

        if chunk.mesh.is_none() {
            chunk.lights = Lights::propagate(&mut space, registry, config);
        }

        let opaque = Mesher::mesh_space(&chunk.min, &chunk.max, &space, registry, false);
        let transparent = Mesher::mesh_space(&chunk.min, &chunk.max, &space, registry, true);

        chunk.mesh = Some(Mesh {
            opaque,
            transparent,
        });

        (chunk, None)
    }
}

/// A pipeline where chunks are initialized and generated.
pub struct Pipeline {
    /// A HashSet that keeps track of what chunks are in the pipeline.
    pub chunks: HashSet<Vec2<i32>>,

    /// Sender of processed chunks from other threads to main thread.
    sender: Arc<Sender<(Vec<Chunk>, Vec<BlockChange>)>>,

    /// Receiver to receive processed chunks from other threads to main thread.
    receiver: Arc<Receiver<(Vec<Chunk>, Vec<BlockChange>)>>,

    /// Pipeline's thread pool to process chunks.
    pool: ThreadPool,

    /// Queue of chunk jobs to finish.
    queue: VecDeque<(Vec2<i32>, usize)>,

    /// A list of stages that chunks are in.
    stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
}

impl Pipeline {
    /// Create a new chunk pipeline.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            chunks: HashSet::default(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("voxelize-chunking-{index}"))
                .build()
                .unwrap(),
            queue: VecDeque::default(),
            stages: vec![Arc::new(LightMeshStage)],
        }
    }

    /// Check to see if a chunk is in this pipeline. Chunks are added into the pipeline
    /// by calling `pipeline.push`.
    pub fn has(&self, coords: &Vec2<i32>) -> bool {
        self.chunks.contains(coords)
    }

    /// Get the length of this pipeline, in other words how many stages there are.
    pub fn len(&self) -> usize {
        self.stages.len()
    }

    /// Push a chunk job into the pipeline's queue. Does nothing if chunk is in the
    /// pipeline already. Chunks that are pushed into the pipeline will only be freed
    /// from the pipeline if they reach the end of the pipeline.
    pub fn push(&mut self, coords: &Vec2<i32>, index: usize) {
        assert!(index < self.stages.len());

        if self.has(coords) {
            return;
        }

        self.chunks.insert(coords.to_owned());
        self.queue.push_back((coords.to_owned(), index));
    }

    /// Pop a chunk job from the queue. This does not remove the chunk from the pipeline.
    /// Calling `pipeline.has` will still return true as chunk hasn't reached the last stage.
    pub fn pop(&mut self) -> Option<(Vec2<i32>, usize)> {
        self.queue.pop_front()
    }

    /// Postpone the chunk process to wait for its neighbors. Similar to `pipeline.push`, but
    /// checks if chunk is already waiting in queue. Panics if true.
    pub fn postpone(&mut self, coords: &Vec2<i32>, index: usize) {
        self.queue.iter().for_each(|(c, _)| {
            if *coords == *c {
                panic!("Chunk {:?} is already waiting in queue.", coords);
            }
        });

        self.chunks.remove(&coords);
        self.push(coords, index);
    }

    /// Add a stage to the chunking pipeline. Keep in mind that the pipeline by default
    /// comes with a preset stage: `LightMeshStage`, and stages added afterwards are
    /// appended before this stage preset.
    pub fn add_stage<T>(&mut self, stage: T)
    where
        T: 'static + ChunkStage + Send + Sync,
    {
        // Insert the stage before `LightMeshStage`
        self.stages.insert(self.stages.len() - 1, Arc::new(stage));
    }

    pub fn get_stage(&mut self, index: usize) -> &Arc<dyn ChunkStage + Send + Sync> {
        &self.stages[index]
    }

    /// Process a list of chunk processes, generated from the ECS system `PipeliningSystem` .
    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Option<Space>, usize)>,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        // Retrieve the chunk stages' Arc clones.
        let processes: Vec<(Chunk, Option<Space>, Arc<dyn ChunkStage + Send + Sync>)> = processes
            .into_iter()
            .map(|(chunk, space, index)| {
                let stage = self.stages.get(index).unwrap().clone();
                (chunk, space, stage)
            })
            .collect();

        let sender = Arc::clone(&self.sender);

        let registry = registry.to_owned();
        let config = config.to_owned();

        self.pool.spawn(move || {
            let mut changes = vec![];

            let chunks: Vec<Chunk> = processes
                .into_iter()
                .map(|(chunk, space, stage)| {
                    let (chunk, leftovers) = stage.process(chunk, &registry, &config, space);
                    if let Some(mut blocks) = leftovers {
                        changes.append(&mut blocks);
                    }
                    chunk
                })
                .collect();

            sender.send((chunks, changes)).unwrap();
        });
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&self) -> Result<(Vec<Chunk>, Vec<BlockChange>), TryRecvError> {
        self.receiver.try_recv()
    }

    /// Advance a chunk to the next chunk stage. If chunk has reached the end of
    /// the pipeline, `chunk.stage` is set to None.
    pub fn advance(&mut self, chunk: &mut Chunk) {
        // Chunk not in pipeline
        if !self.chunks.contains(&chunk.coords) {
            panic!("Chunk {:?} isn't in the pipeline.", chunk.coords);
        }

        // Why would chunk's stage even be none?
        if chunk.stage.is_none() {
            panic!(
                "Something's wrong! Why does chunk {:?} not have a stage?",
                chunk.coords
            );
        }

        let index = chunk.stage.unwrap();

        // Reached the end of the stages.
        if index == self.stages.len() - 1 {
            chunk.stage = None;

            // Remove this chunk from the pipeline.
            self.chunks.remove(&chunk.coords);

            return;
        }

        chunk.stage = Some(index + 1);

        // Add the chunk with the new index to the queue.
        self.queue.push_back((chunk.coords.to_owned(), index + 1));
    }

    pub fn remesh(&mut self, coords: &Vec2<i32>) {
        self.push(coords, self.stages.len() - 1);
    }

    /// Is this pipeline vacant?
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty() || self.queue.is_empty()
    }

    /// Get the stage name from index.
    pub fn get_stage_name(&self, index: Option<usize>) -> Option<String> {
        if index.is_none() {
            return None;
        }

        let index = index.unwrap();

        if let Some(stage) = self.stages.get(index) {
            return Some(stage.name());
        }

        None
    }
}
