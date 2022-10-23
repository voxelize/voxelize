use crate::Vec3;

/// Enum of light colors.
#[derive(PartialEq, Eq, Debug)]
pub enum LightColor {
    Sunlight,
    Red,
    Green,
    Blue,
}

/// Denoting a change in block in the world.
pub type VoxelUpdate = (Vec3<i32>, u32);
