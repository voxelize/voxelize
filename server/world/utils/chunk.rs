use crate::{Vec2, Vec3};

#[cfg(target_os = "windows")]
const CHUNK_NAME_SEPARATOR: &str = "_";
#[cfg(not(target_os = "windows"))]
const CHUNK_NAME_SEPARATOR: &str = "|";

/// A set of utility functions for chunk operations.
pub struct ChunkUtils;

impl ChunkUtils {
    /// Generate a chunk representation from a chunk coordinate.
    pub fn get_chunk_name(cx: i32, cz: i32) -> String {
        format!("{}{}{}", cx, CHUNK_NAME_SEPARATOR, cz)
    }

    /// Parse a chunk coordinate from a chunk representation.
    pub fn parse_chunk_name(name: &str) -> Vec2<i32> {
        let mut segments = name.split(CHUNK_NAME_SEPARATOR);
        let raw_x = segments.next().expect("Invalid chunk name format");
        let raw_z = segments.next().expect("Invalid chunk name format");
        Vec2(raw_x.parse().unwrap(), raw_z.parse().unwrap())
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
        let mut segments = name.split(CHUNK_NAME_SEPARATOR);
        let raw_x = segments.next().expect("Invalid voxel name format");
        let raw_y = segments.next().expect("Invalid voxel name format");
        let raw_z = segments.next().expect("Invalid voxel name format");
        Vec3(
            raw_x.parse().unwrap(),
            raw_y.parse().unwrap(),
            raw_z.parse().unwrap(),
        )
    }

    /// Map a voxel coordinate to a chunk coordinate.
    pub fn map_voxel_to_chunk(vx: i32, _vy: i32, vz: i32, chunk_size: usize) -> Vec2<i32> {
        let cs = i32::try_from(chunk_size).unwrap_or(i32::MAX).max(1);
        Vec2(vx.div_euclid(cs), vz.div_euclid(cs))
    }

    /// Map a voxel coordinate to a chunk local coordinate.
    pub fn map_voxel_to_chunk_local(vx: i32, vy: i32, vz: i32, chunk_size: usize) -> Vec3<usize> {
        let cs = i32::try_from(chunk_size).unwrap_or(i32::MAX).max(1);
        let lx = vx.rem_euclid(cs) as usize;
        let lz = vz.rem_euclid(cs) as usize;

        Vec3(lx, vy as usize, lz)
    }

    pub fn distance_squared(a: &Vec2<i32>, b: &Vec2<i32>) -> f32 {
        let dx = a.0 - b.0;
        let dz = a.1 - b.1;
        (dx * dx + dz * dz) as f32
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
    fn map_voxel_to_chunk_local_handles_zero_chunk_size() {
        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(5, 7, -3, 0);
        assert_eq!(lx, 0);
        assert_eq!(ly, 7);
        assert_eq!(lz, 0);
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
}
