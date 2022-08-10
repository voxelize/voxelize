use std::collections::VecDeque;

use rayon::slice::ParallelSliceMut;
use specs::{Component, VecStorage};

use crate::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub pending: VecDeque<Vec2<i32>>,
    pub waiting: VecDeque<Vec2<i32>>,
    pub loaded: VecDeque<Vec2<i32>>,
}

impl ChunkRequestsComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Append a new chunk to be requested.
    pub fn append(&mut self, coords: &Vec2<i32>) {
        if !self.pending.contains(coords) {
            self.pending.push_back(coords.to_owned());
        }
    }

    /// Append a new chunk to the waiting queue.
    pub fn wait(&mut self, coords: &Vec2<i32>) {
        if !self.waiting.contains(coords) {
            self.waiting.push_back(coords.to_owned());
        }
    }

    /// Finish a requested chunk, add it to `loaded`.
    pub fn mark_finish(&mut self, coords: &Vec2<i32>) {
        self.pending.retain(|c| *c != *coords);
        self.waiting.retain(|c| *c != *coords);

        if !self.loaded.contains(coords) {
            self.loaded.push_back(coords.to_owned());
        }
    }

    /// Unload a chunk, remove from both requests and loaded
    pub fn unload(&mut self, coords: &Vec2<i32>) {
        self.pending.retain(|c| *c != *coords);
        self.loaded.retain(|c| *c != *coords);
        self.waiting.retain(|c| *c != *coords);
    }

    /// Sort pending chunks.
    pub fn sort_pending(&mut self, center: &Vec2<i32>) {
        let Vec2(cx, cz) = center;

        let mut pendings: Vec<Vec2<i32>> = self.pending.clone().into_iter().collect();

        pendings.par_sort_by(|c1, c2| {
            let dist1 = (c1.0 - cx).pow(2) + (c1.1 - cz).pow(2);
            let dist2 = (c2.0 - cx).pow(2) + (c2.1 - cz).pow(2);
            dist1.cmp(&dist2)
        });

        self.pending = VecDeque::from_iter(pendings.into_iter());
    }

    /// Check to see if this chunk request is interested in a chunk.
    pub fn is_interested(&self, coords: &Vec2<i32>) -> bool {
        self.waiting.contains(coords) || self.loaded.contains(coords)
    }

    /// Check to see if this client has requested or loaded a chunk.
    pub fn has(&self, coords: &Vec2<i32>) -> bool {
        self.pending.contains(coords)
            || self.waiting.contains(coords)
            || self.loaded.contains(coords)
    }
}
