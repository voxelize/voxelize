use specs::{Component, VecStorage};

use crate::Vec2;

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp {
    pub center: Vec2<i32>,
    // a 2d unit vector
    pub direction: Vec2<f32>,
    pub requests: Vec<Vec2<i32>>,
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

    /// Set the direction of the list of chunk requests.
    pub fn set_direction(&mut self, direction: &Vec2<f32>) {
        self.direction = direction.to_owned();
    }

    /// Add a chunk to the list of chunks requested.
    pub fn add(&mut self, coords: &Vec2<i32>) {
        if self.requests.contains(coords) {
            return;
        }

        self.requests.push(coords.to_owned());
    }

    pub fn sort(&mut self) {
        self.requests.sort_by(|a, b| {
            let a_dist = (a.0 - self.center.0).abs() + (a.1 - self.center.1).abs();
            let b_dist = (b.0 - self.center.0).abs() + (b.1 - self.center.1).abs();

            a_dist.cmp(&b_dist)
        });
    }

    /// Remove a chunk from the list of chunks requested.
    pub fn remove(&mut self, coords: &Vec2<i32>) {
        self.requests.retain(|c| c != coords);
    }
}
