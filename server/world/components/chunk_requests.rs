use specs::{Component, VecStorage};

use crate::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub center: Vec2<i32>,
    // coords + lod
    pub requests: Vec<(Vec2<i32>, usize)>,
}

impl ChunkRequestsComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the center of the list of chunk requests.
    pub fn set_center(&mut self, center: &Vec2<i32>) {
        self.center = center.to_owned();
    }

    /// Add a chunk to the list of chunks requested.
    pub fn add(&mut self, coords: &Vec2<i32>, lod: usize) {
        if self.requests.contains(&(coords.to_owned(), lod)) {
            return;
        }

        self.requests.push((coords.to_owned(), lod));
    }

    pub fn sort(&mut self) {
        self.requests.sort_by(|a, b| {
            let a_dist = (a.0 .0 - self.center.0).abs() + (a.0 .1 - self.center.1).abs();
            let b_dist = (b.0 .0 - self.center.0).abs() + (b.0 .1 - self.center.1).abs();

            a_dist.cmp(&b_dist)
        });
    }

    /// Remove a chunk from the list of chunks requested. This will remove all LOD requests!!!!!
    pub fn remove(&mut self, coords: &Vec2<i32>) {
        self.requests.retain(|c| c.0 != *coords);
    }
}
