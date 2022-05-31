use specs::{Component, VecStorage};

use crate::Vec2;

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct CurrentChunkComp {
    pub coords: Vec2<i32>,
    pub changed: bool,
}
