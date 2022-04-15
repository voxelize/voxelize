use specs::{Component, VecStorage};

use crate::vec::Vec2;

/// General name tagging component
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequestsComp(pub Vec<Vec2<i32>>);

impl ChunkRequestsComp {
    pub fn new() -> Self {
        Self::default()
    }
}
