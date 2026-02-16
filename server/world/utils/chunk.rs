use crate::{Vec2, Vec3};

#[cfg(target_os = "windows")]
const CHUNK_NAME_SEPARATOR: &str = "_";
#[cfg(not(target_os = "windows"))]
const CHUNK_NAME_SEPARATOR: &str = "|";
const MAX_I32_USIZE: usize = i32::MAX as usize;

/// A set of utility functions for chunk operations.
pub struct ChunkUtils;

#[inline]
fn normalized_chunk_size(chunk_size: usize) -> i32 {
    if chunk_size == 0 {
        1
    } else if chunk_size > MAX_I32_USIZE {
        i32::MAX
    } else {
        chunk_size as i32
    }
}

#[inline]
fn chunk_shift_if_power_of_two(chunk_size: i32) -> Option<u32> {
    if (chunk_size as u32).is_power_of_two() {
        Some(chunk_size.trailing_zeros())
    } else {
        None
    }
}

#[inline]
fn chunk_mask_if_power_of_two(chunk_size: i32) -> Option<i32> {
    if (chunk_size as u32).is_power_of_two() {
        Some(chunk_size - 1)
    } else {
        None
    }
}

#[inline]
fn first_segment(value: &str) -> &str {
    if let Some((segment, _)) = value.split_once(CHUNK_NAME_SEPARATOR) {
        segment
    } else {
        value
    }
}

impl ChunkUtils {
    /// Generate a chunk representation from a chunk coordinate.
    pub fn get_chunk_name(cx: i32, cz: i32) -> String {
        format!("{}{}{}", cx, CHUNK_NAME_SEPARATOR, cz)
    }

    /// Parse a chunk coordinate from a chunk representation.
    pub fn parse_chunk_name(name: &str) -> Vec2<i32> {
        let Some((raw_x, rest)) = name.split_once(CHUNK_NAME_SEPARATOR) else {
            return Vec2(0, 0);
        };
        let raw_z = first_segment(rest);
        Vec2(raw_x.parse().unwrap_or(0), raw_z.parse().unwrap_or(0))
    }

    /// Generate a voxel representation from a voxel coordinate.
    pub fn get_voxel_name(vx: i32, vy: i32, vz: i32) -> String {
        format!(
            "{}{}{}{}{}",
            vx, CHUNK_NAME_SEPARATOR, vy, CHUNK_NAME_SEPARATOR, vz
        )
    }

    /// Parse a voxel coordinate from a voxel representation.
    pub fn parse_voxel_name(name: &str) -> Vec3<i32> {
        let Some((raw_x, rest)) = name.split_once(CHUNK_NAME_SEPARATOR) else {
            return Vec3(0, 0, 0);
        };
        let Some((raw_y, rest)) = rest.split_once(CHUNK_NAME_SEPARATOR) else {
            return Vec3(0, 0, 0);
        };
        let raw_z = first_segment(rest);
        Vec3(
            raw_x.parse().unwrap_or(0),
            raw_y.parse().unwrap_or(0),
            raw_z.parse().unwrap_or(0),
        )
    }

    /// Map a voxel coordinate to a chunk coordinate.
    pub fn map_voxel_to_chunk(vx: i32, _vy: i32, vz: i32, chunk_size: usize) -> Vec2<i32> {
        let cs = normalized_chunk_size(chunk_size);
        if cs == 1 {
            return Vec2(vx, vz);
        }
        if let Some(shift) = chunk_shift_if_power_of_two(cs) {
            Vec2(vx >> shift, vz >> shift)
        } else {
            Vec2(vx.div_euclid(cs), vz.div_euclid(cs))
        }
    }

    /// Map a voxel coordinate to a chunk local coordinate.
    pub fn map_voxel_to_chunk_local(vx: i32, vy: i32, vz: i32, chunk_size: usize) -> Vec3<usize> {
        let cs = normalized_chunk_size(chunk_size);
        let ly = if vy < 0 { 0 } else { vy as usize };
        if cs == 1 {
            return Vec3(0, ly, 0);
        }
        let (lx, lz) = if let Some(mask) = chunk_mask_if_power_of_two(cs) {
            ((vx & mask) as usize, (vz & mask) as usize)
        } else {
            (vx.rem_euclid(cs) as usize, vz.rem_euclid(cs) as usize)
        };

        Vec3(lx, ly, lz)
    }

    pub fn distance_squared(a: &Vec2<i32>, b: &Vec2<i32>) -> f32 {
        let dx = f64::from(a.0) - f64::from(b.0);
        let dz = f64::from(a.1) - f64::from(b.1);
        dx.mul_add(dx, dz * dz) as f32
    }
}

#[cfg(test)]
mod tests {
    use super::{ChunkUtils, CHUNK_NAME_SEPARATOR};
    use crate::{Vec2, Vec3};

    #[test]
    fn map_voxel_to_chunk_handles_zero_chunk_size() {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(5, 0, -3, 0);
        assert_eq!(cx, 5);
        assert_eq!(cz, -3);
    }

    #[test]
    fn map_voxel_to_chunk_handles_negative_voxel_coords() {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(-17, 0, -1, 16);
        assert_eq!(cx, -2);
        assert_eq!(cz, -1);
    }

    #[test]
    fn map_voxel_to_chunk_with_unit_chunks_returns_original_xz() {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(i32::MAX, 0, i32::MIN, 1);
        assert_eq!(cx, i32::MAX);
        assert_eq!(cz, i32::MIN);
    }

    #[test]
    fn map_voxel_to_chunk_keeps_euclid_semantics_for_non_power_of_two_sizes() {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(-11, 0, 19, 10);
        assert_eq!(cx, -2);
        assert_eq!(cz, 1);
    }

    #[test]
    fn map_voxel_to_chunk_handles_oversized_chunk_size() {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(i32::MIN, 0, i32::MAX, usize::MAX);
        assert_eq!(cx, -2);
        assert_eq!(cz, 1);
    }

    #[test]
    fn map_voxel_to_chunk_local_handles_zero_chunk_size() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(5, 7, -3, 0);
        assert_eq!(lx, 0);
        assert_eq!(ly, 7);
        assert_eq!(lz, 0);
    }

    #[test]
    fn map_voxel_to_chunk_local_keeps_remainders_non_negative() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(-1, 7, -17, 16);
        assert_eq!(lx, 15);
        assert_eq!(ly, 7);
        assert_eq!(lz, 15);
    }

    #[test]
    fn map_voxel_to_chunk_local_with_unit_chunks_is_always_zero_xz() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(i32::MAX, 9, i32::MIN, 1);
        assert_eq!(lx, 0);
        assert_eq!(ly, 9);
        assert_eq!(lz, 0);
    }

    #[test]
    fn map_voxel_to_chunk_local_keeps_euclid_semantics_for_non_power_of_two_sizes() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(-1, 7, -11, 10);
        assert_eq!(lx, 9);
        assert_eq!(ly, 7);
        assert_eq!(lz, 9);
    }

    #[test]
    fn map_voxel_to_chunk_local_handles_oversized_chunk_size() {
        let Vec3(lx, ly, lz) =
            ChunkUtils::map_voxel_to_chunk_local(i32::MIN, 7, i32::MAX, usize::MAX);
        assert_eq!(lx, (i32::MIN.rem_euclid(i32::MAX)) as usize);
        assert_eq!(ly, 7);
        assert_eq!(lz, 0);
    }

    #[test]
    fn map_voxel_to_chunk_local_clamps_negative_y_to_zero() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(5, -2, -3, 16);
        assert_eq!(lx, 5);
        assert_eq!(ly, 0);
        assert_eq!(lz, 13);
    }

    #[test]
    fn parse_chunk_name_keeps_first_two_segments() {
        let raw = format!(
            "1{}2{}3",
            CHUNK_NAME_SEPARATOR, CHUNK_NAME_SEPARATOR
        );
        let Vec2(cx, cz) = ChunkUtils::parse_chunk_name(&raw);
        assert_eq!(cx, 1);
        assert_eq!(cz, 2);
    }

    #[test]
    fn parse_voxel_name_keeps_first_three_segments() {
        let raw = format!(
            "1{}2{}3{}4",
            CHUNK_NAME_SEPARATOR, CHUNK_NAME_SEPARATOR, CHUNK_NAME_SEPARATOR
        );
        let Vec3(vx, vy, vz) = ChunkUtils::parse_voxel_name(&raw);
        assert_eq!(vx, 1);
        assert_eq!(vy, 2);
        assert_eq!(vz, 3);
    }

    #[test]
    fn parse_chunk_name_returns_zero_vector_for_invalid_values() {
        let Vec2(cx, cz) = ChunkUtils::parse_chunk_name("bad-input");
        assert_eq!(cx, 0);
        assert_eq!(cz, 0);
    }

    #[test]
    fn parse_voxel_name_returns_zero_vector_for_invalid_values() {
        let invalid = format!("1{}bad", CHUNK_NAME_SEPARATOR);
        let Vec3(vx, vy, vz) = ChunkUtils::parse_voxel_name(&invalid);
        assert_eq!(vx, 0);
        assert_eq!(vy, 0);
        assert_eq!(vz, 0);
    }

    #[test]
    fn distance_squared_handles_extreme_coordinates_without_overflow() {
        let a = Vec2(i32::MAX, i32::MAX);
        let b = Vec2(i32::MIN, i32::MIN);
        let distance = ChunkUtils::distance_squared(&a, &b);
        assert!(distance.is_finite());
        assert!(distance > 0.0);
    }
}
