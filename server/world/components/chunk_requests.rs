use hashbrown::HashSet;
use specs::{Component, VecStorage};

use crate::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub requested: HashSet<Vec2<i32>>,
    pub processed: HashSet<Vec2<i32>>,
}

impl ChunkRequestsComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a chunk to the list of chunks requested.
    pub fn add(&mut self, coords: &Vec2<i32>) {
        if self.processed.contains(coords) {
            return;
        }

        self.requested.insert(coords.to_owned());
    }

    /// Remove a chunk from the list of chunks requested.
    pub fn remove(&mut self, coords: &Vec2<i32>) {
        self.requested.remove(coords);
        self.processed.remove(coords);
    }

    /// Check to see if this entity is interested in the chunk at the given coordinates.
    pub fn is_interested(&self, coords: &Vec2<i32>) -> bool {
        self.requested.contains(coords) || self.processed.contains(coords)
    }
}
