use linked_hash_set::LinkedHashSet;
use specs::{Component, VecStorage};

use crate::Vec2;

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

    /// Sort pending chunks.
    pub fn sort_pending(&mut self, center: &Vec2<i32>) {
        let Vec2(cx, cz) = center;

        let mut pendings: Vec<Vec2<i32>> = self.pending.clone().into_iter().collect();

        pendings.sort_by(|c1, c2| {
            let dist1 = (c1.0 - cx).pow(2) + (c1.1 - cz).pow(2);
            let dist2 = (c2.0 - cx).pow(2) + (c2.1 - cz).pow(2);
            dist1.cmp(&dist2)
        });

        let list = LinkedHashSet::from_iter(pendings.into_iter());

        self.pending = list;
    }

    /// Check to see if this client has requested or loaded a chunk.
    pub fn has(&self, coords: &Vec2<i32>) -> bool {
        self.pending.contains(coords) || self.loaded.contains(coords)
    }
}
