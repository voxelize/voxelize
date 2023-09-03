/// Enum of light colors.
#[derive(PartialEq, Eq, Debug)]
pub enum LightColor {
    Sunlight,
    Red,
    Green,
    Blue,
}

pub const RED: LightColor = LightColor::Red;
pub const GREEN: LightColor = LightColor::Green;
pub const BLUE: LightColor = LightColor::Blue;
pub const SUNLIGHT: LightColor = LightColor::Sunlight;
