use crate::vec::Vec3;

/// A filter for clients, used for specific broadcasting.
pub enum ClientFilter {
    All,
    Direct(String),
    Include(Vec<String>),
    Exclude(Vec<String>),
}

pub type BlockChange = (Vec3<i32>, u32);
