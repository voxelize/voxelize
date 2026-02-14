use crate::{Vec2, Vec3};

fn get_concat() -> &'static str {
    if cfg!(target_os = "windows") {
        "_"
    } else {
        "|"
    }
}

/// A set of utility functions for chunk operations.
pub struct ChunkUtils;

impl ChunkUtils {
    /// Generate a chunk representation from a chunk coordinate.
    pub fn get_chunk_name(cx: i32, cz: i32) -> String {
        format!("{}{}{}", cx, get_concat(), cz)
    }

    /// Parse a chunk coordinate from a chunk representation.
    pub fn parse_chunk_name(name: &str) -> Vec2<i32> {
        let (raw_x, raw_z) = name
            .split_once(get_concat())
            .expect("Invalid chunk name format");
        Vec2(raw_x.parse().unwrap(), raw_z.parse().unwrap())
    }

    /// Generate a voxel representation from a voxel coordinate.
    pub fn get_voxel_name(vx: i32, vy: i32, vz: i32) -> String {
        let concat = get_concat();
        format!("{}{}{}{}{}", vx, concat, vy, concat, vz)
    }

    /// Parse a voxel coordinate from a voxel representation.
    pub fn parse_voxel_name(name: &str) -> Vec3<i32> {
        let concat = get_concat();
        let mut segments = name.split(concat);
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
        let cx = vx.div_euclid(cs);
        let cz = vz.div_euclid(cs);

        Vec3(
            (vx - cx * cs) as usize,
            vy as usize,
            (vz - cz * cs) as usize,
        )
    }

    pub fn distance_squared(a: &Vec2<i32>, b: &Vec2<i32>) -> f32 {
        let dx = a.0 - b.0;
        let dz = a.1 - b.1;
        (dx * dx + dz * dz) as f32
    }
}
