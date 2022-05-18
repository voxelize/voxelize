use crate::vec::Vec3;

/// Enum of light colors.
#[derive(PartialEq, Eq)]
pub enum LightColor {
    Sunlight,
    Red,
    Green,
    Blue,
}

/// Denoting a change in block in the world.
pub type BlockChange = (Vec3<i32>, u32);
