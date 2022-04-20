use std::{collections::VecDeque, sync::Arc, time::Instant};

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use hashbrown::HashSet;
use log::info;
use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::{
    chunk::Chunk,
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

pub trait ChunkStage {
    fn name(&self) -> String;

    fn neighbors(&self, _: &WorldConfig) -> usize {
        0
    }

    fn needs_space(&self) -> Option<SpaceData> {
        None
    }

    fn process(
        &self,
        chunk: Chunk,
        registry: &Registry,
        config: &WorldConfig,
        space: Option<Space>,
    ) -> Chunk;
}

struct HeightMapStage;

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
    ) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        let max_height = chunk.params.max_height as i32;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in (0..max_height).rev() {
                    let id = chunk.get_voxel(vx, vy, vz);
                    let block = registry.get_block_by_id(id);

                    if vy == 0 || (id != 0 && !block.is_plant && !block.is_fluid) {
                        chunk.set_max_height(vx, vz, vy as u32);
                        break;
                    }
                }
            }
        }

        chunk
    }
}

struct LightMeshStage;

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
    ) -> Chunk {
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

        chunk
    }
}

pub type StageRecord = (Vec2<i32>, usize);

pub struct Pipeline {
    pub sender: Arc<Sender<Vec<Chunk>>>,

    pub receiver: Arc<Receiver<Vec<Chunk>>>,

    pub pool: ThreadPool,

    pub queue: VecDeque<StageRecord>,

    chunks: HashSet<Vec2<i32>>,

    /// A list of stages that chunks need to go through to be instantiated.
    stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,
}

impl Pipeline {
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            queue: VecDeque::default(),
            pool: ThreadPoolBuilder::new().build().unwrap(),
            chunks: HashSet::default(),
            stages: vec![Arc::new(HeightMapStage), Arc::new(LightMeshStage)],
        }
    }

    pub fn pop(&mut self) -> Option<StageRecord> {
        let record = self.queue.pop_front();

        if record.is_some() {
            self.chunks.remove(&record.clone().unwrap().0);
        }

        record
    }

    pub fn push(&mut self, record: StageRecord) {
        self.chunks.insert(record.0.to_owned());
        self.queue.push_back(record);
    }

    pub fn has(&self, coords: &Vec2<i32>) -> bool {
        self.chunks.contains(coords)
    }

    pub fn process(
        &self,
        processes: Vec<(Chunk, Option<Space>, Arc<dyn ChunkStage + Send + Sync>)>,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let sender = Arc::clone(&self.sender);

        let registry = registry.to_owned();
        let config = config.to_owned();

        self.pool.spawn(move || {
            let chunks: Vec<Chunk> = processes
                .into_iter()
                .map(|(chunk, space, stage)| {
                    let instant = Instant::now();
                    let chunk = stage.process(chunk, &registry, &config, space);
                    let elapsed = instant.elapsed().as_millis();
                    info!(
                        "Processing chunk {:?} in stage {:?} in {}ms",
                        chunk.coords,
                        stage.name(),
                        elapsed
                    );
                    chunk
                })
                .collect();
            sender.send(chunks).unwrap();
        });
    }

    pub fn results(&self) -> Result<Vec<Chunk>, TryRecvError> {
        self.receiver.try_recv()
    }

    pub fn remesh(&mut self, coords: &Vec2<i32>) {
        self.queue
            .push_back((coords.to_owned(), self.queue.len() - 1));
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn len(&self) -> usize {
        self.stages.len()
    }

    /// Add a stage to the chunking process. Keep in mind that the last two chunk stages
    /// will always be HeightMapStage and LightMeshStage. So, when a new stage is added, it is added
    /// before these two.
    pub fn add_stage<T>(&mut self, stage: T)
    where
        T: 'static + ChunkStage + Send + Sync,
    {
        self.stages.insert(self.stages.len() - 2, Arc::new(stage));
    }

    /// Get a reference to a stage to use.
    pub fn get_stage(&self, index: usize) -> Arc<(dyn ChunkStage + Send + Sync + 'static)> {
        self.stages.get(index).unwrap().clone()
    }
}
