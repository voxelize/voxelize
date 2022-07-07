use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

use crate::Vec3;

/// The direction this entity is positioned.
#[derive(Debug, Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct PositionComp(pub Vec3<f32>);

impl PositionComp {
    /// Create a new component of the position this entity is at.
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self(Vec3(x, y, z))
    }

    /// Get the inner data.
    pub fn inner(&self) -> &Vec3<f32> {
        &self.0
    }

    /// Get a mutable reference to the inner data.
    pub fn inner_mut(&mut self) -> &mut Vec3<f32> {
        &mut self.0
    }
}
