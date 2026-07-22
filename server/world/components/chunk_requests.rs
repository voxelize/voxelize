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
    /// Chunks requested as reduced-detail meshes, with the LOD level per
    /// chunk. Only populated for worlds that enable `chunk_lod`. A chunk is
    /// requested in at most one form at a time: adding a LOD request drops
    /// any pending full request for the same coords and vice versa.
    pub lod_requests: Vec<(Vec2<i32>, u32)>,
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
        self.lod_requests.retain(|(c, _)| c != coords);

        if self.requests.contains(coords) {
            return;
        }

        self.requests.push(coords.to_owned());
    }

    /// Add a chunk to the list of chunks requested as a LOD mesh.
    pub fn add_lod(&mut self, coords: &Vec2<i32>, level: u32) {
        self.requests.retain(|c| c != coords);
        self.lod_requests.retain(|(c, _)| c != coords);
        self.lod_requests.push((coords.to_owned(), level));
    }

    pub fn sort(&mut self) {
        let center = self.center.to_owned();
        let distance =
            |coords: &Vec2<i32>| (coords.0 - center.0).abs() + (coords.1 - center.1).abs();

        self.requests.sort_by(|a, b| distance(a).cmp(&distance(b)));
        self.lod_requests
            .sort_by(|(a, _), (b, _)| distance(a).cmp(&distance(b)));
    }

    /// Remove a chunk from the list of chunks requested, in either form.
    pub fn remove(&mut self, coords: &Vec2<i32>) {
        self.requests.retain(|c| c != coords);
        self.lod_requests.retain(|(c, _)| c != coords);
    }
}
