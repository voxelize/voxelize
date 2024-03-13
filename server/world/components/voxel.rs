use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

use crate::Vec3;

/// The direction this entity is positioned.
#[derive(Debug, Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct VoxelComp(pub Vec3<i32>);

impl VoxelComp {
    /// Create a new component of the position this entity is at.
    pub fn new(x: i32, y: i32, z: i32) -> Self {
        Self(Vec3(x, y, z))
    }

    /// Get the inner data.
    pub fn inner(&self) -> &Vec3<i32> {
        &self.0
    }

    /// Get a mutable reference to the inner data.
    pub fn inner_mut(&mut self) -> &mut Vec3<i32> {
        &mut self.0
    }
}
