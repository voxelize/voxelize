use crate::worlds::shared::quaternion::Quaternion;
use serde::{Deserialize, Serialize};

use specs::{Component, VecStorage};

// consider making this more implicit
#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct RotationComp(pub Quaternion);

impl RotationComp {
    pub fn new(qx: f32, qy: f32, qz: f32, qw: f32) -> Self {
        Self(Quaternion(qx, qy, qz, qw))
    }

    /// Instantiate a rotation component from a Quaternion
    pub fn from_quaternion(quaternion: &Quaternion) -> Self {
        Self(quaternion.to_owned())
    }
}
