use linked_hash_set::LinkedHashSet;
use specs::{Component, VecStorage};

use crate::vec::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub pending: LinkedHashSet<Vec2<i32>>,
    pub loaded: LinkedHashSet<Vec2<i32>>,
}

impl ChunkRequestsComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a requested chunk.
    pub fn add(&mut self, coords: &Vec2<i32>) {
        self.pending.insert(coords.to_owned());
    }

    /// Finish a requested chunk, add it to `loaded`.
    pub fn mark_finish(&mut self, coords: &Vec2<i32>) {
        self.pending.remove(coords);
        self.loaded.insert(coords.to_owned());
    }

    /// Unload a chunk, remove from both requests and loaded
    pub fn unload(&mut self, coords: &Vec2<i32>) {
        self.pending.remove(coords);
        self.loaded.remove(coords);
    }

    /// Check to see if this client has requested or loaded a chunk.
    pub fn has(&self, coords: &Vec2<i32>) -> bool {
        self.pending.contains(coords) || self.loaded.contains(coords)
    }
}
