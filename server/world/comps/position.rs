use specs::{Component, VecStorage};

use crate::vec::Vec3;

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct PositionComp(pub Vec3<f32>);

impl PositionComp {
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Self(Vec3(x, y, z))
    }
}
