use hashbrown::HashSet;

use crate::vec::{Vec2, Vec3};

/// A filter for clients, used for specific broadcasting.
pub enum ClientFilter {
    All,
    Direct(String),
    Include(Vec<String>),
    Exclude(Vec<String>),
}

/// Denoting a change in block in the world.
pub type BlockChange = (Vec3<i32>, u32);

/// A map of updated chunks
pub type UpdatedChunks = HashSet<Vec2<i32>>;
