use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

use crate::Vec3;

/// The direction this entity is looking at.
#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct DirectionComp(pub Vec3<f32>);

impl DirectionComp {
    /// Create a component of the direction this entity is looking at.
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self(Vec3(x, y, z))
    }
}
