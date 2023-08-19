/// A set of utility functions for light operations.
pub struct LightUtils;

impl LightUtils {
    /// Extract the bits in light that stores sunlight.
    pub fn extract_sunlight(light: u32) -> u32 {
        (light >> 12) & 0xF
    }

    /// Insert a value into the bits in light that stores sunlight.
    pub fn insert_sunlight(light: u32, level: u32) -> u32 {
        (light & 0xFFF) | (level << 12)
    }

    /// Extract the bits in light that stores red light.
    pub fn extract_red_light(light: u32) -> u32 {
        (light >> 8) & 0xF
    }

    /// Insert a value into the bits in light that stores red light.
    pub fn insert_red_light(light: u32, level: u32) -> u32 {
        (light & 0xF0FF) | (level << 8)
    }

    /// Extract the bits in light that stores green light.
    pub fn extract_green_light(light: u32) -> u32 {
        (light >> 4) & 0xF
    }

    /// Insert a value into the bits in light that stores green light.
    pub fn insert_green_light(light: u32, level: u32) -> u32 {
        (light & 0xFF0F) | (level << 4)
    }

    /// Extract the bits in light that stores blue light.
    pub fn extract_blue_light(light: u32) -> u32 {
        light & 0xF
    }

    /// Insert a value into the bits in light that stores blue light.
    pub fn insert_blue_light(light: u32, level: u32) -> u32 {
        (light & 0xFFF0) | (level)
    }
}
