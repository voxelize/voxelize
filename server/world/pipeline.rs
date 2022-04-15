use std::sync::Arc;

use hashbrown::HashMap;
use nanoid::nanoid;

use crate::{chunk::ChunkParams, vec::Vec2};

use super::{chunk::Chunk, chunks::Chunks, registry::Registry, WorldConfig};

pub trait ChunkStage {
    fn neighbors(&self) -> usize;

    fn process(&self, chunk: &mut Chunk, chunks: &Chunks, registry: &Registry, pipeline: &Pipeline);
}

#[derive(Default)]
pub struct Pipeline {
    pub stages: Vec<Arc<dyn ChunkStage + Send + Sync>>,

    map: HashMap<Vec2<i32>, Chunk>,
}

impl Pipeline {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_chunk(&mut self, coords: &Vec2<i32>, config: &WorldConfig) -> &Chunk {
        let new_chunk = Chunk::new(
            &nanoid!(),
            coords.0,
            coords.1,
            &ChunkParams {
                max_height: config.max_height,
                size: config.chunk_size,
            },
        );

        self.map.insert(coords.to_owned(), new_chunk);

        &self.map.get(coords).unwrap()
    }

    pub fn add_stage<T>(&mut self, stage: T)
    where
        T: 'static + ChunkStage + Send + Sync,
    {
        self.stages.push(Arc::new(stage));
    }
}
