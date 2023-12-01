use crate::{Vec2, Vec3};

fn get_concat() -> &'static str {
    if (cfg!(target_os = "windows")) {
        "_"
    } else {
        "|"
    }
}

/// A set of utility functions for chunk operations.
pub struct ChunkUtils;

fn floor_scale_coords(x: f32, y: f32, z: f32, factor: f32) -> Vec3<f32> {
    Vec3(
        (x * factor).floor(),
        (y * factor).floor(),
        (z * factor).floor(),
    )
}

impl ChunkUtils {
    /// Generate a chunk representation from a chunk coordinate.
    pub fn get_chunk_name(cx: i32, cz: i32) -> String {
        format!("{}{}{}", cx, get_concat(), cz)
    }

    /// Parse a chunk coordinate from a chunk representation.
    pub fn parse_chunk_name(name: &str) -> Vec2<i32> {
        let vec = name.split(get_concat()).collect::<Vec<&str>>();
        Vec2(vec[0].parse().unwrap(), vec[1].parse().unwrap())
    }

    /// Generate a voxel representation from a voxel coordinate.
    pub fn get_voxel_name(vx: i32, vy: i32, vz: i32) -> String {
        let concat = get_concat();
        format!("{}{}{}{}{}", vx, concat, vy, concat, vz)
    }

    /// Parse a voxel coordinate from a voxel representation.
    pub fn parse_voxel_name(name: &str) -> Vec3<i32> {
        let concat = get_concat();
        let vec = name.split(concat).collect::<Vec<&str>>();
        Vec3(
            vec[0].parse().unwrap(),
            vec[1].parse().unwrap(),
            vec[2].parse().unwrap(),
        )
    }

    /// Map a voxel coordinate to a chunk coordinate.
    pub fn map_voxel_to_chunk(vx: i32, vy: i32, vz: i32, chunk_size: usize) -> Vec2<i32> {
        let scaled = Vec3::<i32>::from(&floor_scale_coords(
            vx as f32,
            vy as f32,
            vz as f32,
            1.0 / (chunk_size as f32),
        ));
        Vec2(scaled.0, scaled.2)
    }

    /// Map a voxel coordinate to a chunk local coordinate.
    pub fn map_voxel_to_chunk_local(vx: i32, vy: i32, vz: i32, chunk_size: usize) -> Vec3<usize> {
        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let cs = chunk_size as i32;

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
