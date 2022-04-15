use specs::{Component, VecStorage};

/// General name tagging component
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequests(pub Vec<String>);

impl ChunkRequests {
    pub fn new() -> Self {
        Self::default()
    }
}
