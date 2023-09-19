use specs::{Component, VecStorage};
use voxelize::ChunkCoords;

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct ChunkRequests {
    pub requested: Vec<ChunkCoords>,
    pub pending: Vec<ChunkCoords>,
    pub completed: Vec<ChunkCoords>,
}
