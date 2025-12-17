#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

pub struct LightUtils;

impl LightUtils {
    #[inline]
    pub fn extract_sunlight(light: u32) -> u32 {
        (light >> 12) & 0xF
    }

    #[inline]
    pub fn insert_sunlight(light: u32, level: u32) -> u32 {
        (light & 0x0FFF) | ((level & 0xF) << 12)
    }

    #[inline]
    pub fn extract_red_light(light: u32) -> u32 {
        (light >> 8) & 0xF
    }

    #[inline]
    pub fn insert_red_light(light: u32, level: u32) -> u32 {
        (light & 0xF0FF) | ((level & 0xF) << 8)
    }

    #[inline]
    pub fn extract_green_light(light: u32) -> u32 {
        (light >> 4) & 0xF
    }

    #[inline]
    pub fn insert_green_light(light: u32, level: u32) -> u32 {
        (light & 0xFF0F) | ((level & 0xF) << 4)
    }

    #[inline]
    pub fn extract_blue_light(light: u32) -> u32 {
        light & 0xF
    }

    #[inline]
    pub fn insert_blue_light(light: u32, level: u32) -> u32 {
        (light & 0xFFF0) | (level & 0xF)
    }

    #[inline]
    pub fn extract_all(light: u32) -> (u32, u32, u32, u32) {
        (
            Self::extract_sunlight(light),
            Self::extract_red_light(light),
            Self::extract_green_light(light),
            Self::extract_blue_light(light),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sunlight_roundtrip() {
        for level in 0..=15 {
            let light = LightUtils::insert_sunlight(0, level);
            assert_eq!(LightUtils::extract_sunlight(light), level);
        }
    }

    #[test]
    fn test_red_light_roundtrip() {
        for level in 0..=15 {
            let light = LightUtils::insert_red_light(0, level);
            assert_eq!(LightUtils::extract_red_light(light), level);
        }
    }

    #[test]
    fn test_green_light_roundtrip() {
        for level in 0..=15 {
            let light = LightUtils::insert_green_light(0, level);
            assert_eq!(LightUtils::extract_green_light(light), level);
        }
    }

    #[test]
    fn test_blue_light_roundtrip() {
        for level in 0..=15 {
            let light = LightUtils::insert_blue_light(0, level);
            assert_eq!(LightUtils::extract_blue_light(light), level);
        }
    }

    #[test]
    fn test_combined_lights() {
        let mut light = 0u32;
        light = LightUtils::insert_sunlight(light, 15);
        light = LightUtils::insert_red_light(light, 10);
        light = LightUtils::insert_green_light(light, 5);
        light = LightUtils::insert_blue_light(light, 3);

        assert_eq!(LightUtils::extract_sunlight(light), 15);
        assert_eq!(LightUtils::extract_red_light(light), 10);
        assert_eq!(LightUtils::extract_green_light(light), 5);
        assert_eq!(LightUtils::extract_blue_light(light), 3);
    }

    #[test]
    fn test_extract_all() {
        let mut light = 0u32;
        light = LightUtils::insert_sunlight(light, 12);
        light = LightUtils::insert_red_light(light, 8);
        light = LightUtils::insert_green_light(light, 4);
        light = LightUtils::insert_blue_light(light, 2);

        let (sun, red, green, blue) = LightUtils::extract_all(light);
        assert_eq!(sun, 12);
        assert_eq!(red, 8);
        assert_eq!(green, 4);
        assert_eq!(blue, 2);
    }

    #[test]
    fn test_light_color_from() {
        assert_eq!(LightColor::from(0), LightColor::Sunlight);
        assert_eq!(LightColor::from(1), LightColor::Red);
        assert_eq!(LightColor::from(2), LightColor::Green);
        assert_eq!(LightColor::from(3), LightColor::Blue);
    }
}
