use crate::Vec3;

/// Enum of light colors.
#[derive(PartialEq, Eq, Debug)]
pub enum LightColor {
    Sunlight,
    Red,
    Green,
    Blue,
}

impl LightColor {
    pub fn from(color: usize) -> LightColor {
        match color {
            0 => LightColor::Sunlight,
            1 => LightColor::Red,
            2 => LightColor::Green,
            3 => LightColor::Blue,
            _ => panic!("Invalid light color!"),
        }
    }
}

/// Denoting a change in block in the world.
pub type VoxelUpdate = (Vec3<i32>, u32);
