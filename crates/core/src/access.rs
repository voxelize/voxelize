use crate::{BlockRotation, LightColor};

pub trait VoxelAccess {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation;
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32;
    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32);
    fn get_max_height(&self, vx: i32, vz: i32) -> u32;
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool;
}
