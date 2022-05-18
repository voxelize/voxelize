use crate::{libs::ndarray::Ndarray, world::types::LightColor};

use super::block::BlockRotation;

pub trait VoxelAccess {
    /// Get the raw voxel data at the voxel coordinate. Zero is returned if chunk DNE.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_voxel` is not implemented.");
    }

    /// Set the raw voxel data at the voxel coordinate. Returns false couldn't set.
    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    /// Get the raw light data at the voxel coordinate. Zero is returned if chunk DNE.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_light` is not implemented.");
    }

    /// Set the raw light data at the voxel coordinate. Returns false couldn't set.
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    /// Get the voxel ID at a voxel coordinate. If chunk not found, 0 is returned.
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_voxel` is not implemented.");
    }

    /// Set the voxel type at a voxel coordinate. Returns false couldn't set.
    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
        todo!("Voxel access `set_voxel` is not implemented.");
    }

    /// Get the voxel rotation at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        todo!("Voxel access `get_voxel_rotation` is not implemented.");
    }

    /// Set the voxel rotation at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) -> bool {
        todo!("Voxel access `set_voxel_rotation` is not implemented.");
    }

    /// Get the voxel stage at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_voxel_stage` is not implemented.");
    }

    /// Set the voxel stage at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) -> bool {
        todo!("Voxel access `set_voxel_stage` is not implemented.");
    }

    /// Get the sunlight level at a voxel position. Returns 0 if chunk does not exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_sunlight` is not implemented.");
    }

    /// Set the sunlight level at a voxel coordinate. Returns false if could not set.
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_sunlight` is not implemented.");
    }

    /// Get the red light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_red_light` is not implemented.");
    }

    /// Set the red light level at the voxel position. Returns false if could not set.
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_red_light` is not implemented.");
    }

    /// Get the green light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_green_light` is not implemented.");
    }

    /// Set the green light level at the voxel position. Returns false if could not set.
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_green_light` is not implemented.");
    }

    /// Get the blue light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_blue_light` is not implemented.");
    }

    /// Set the blue light level at the voxel position. Returns false if could not set.
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_blue_light` is not implemented.");
    }

    /// Get the torch light level by color at a voxel coordinate. Returns 0 if chunk does not exist.
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        todo!("Voxel access `get_torch_light` is not implemented.");
    }

    /// Set the torch light level by color at a voxel coordinate. Returns false if could not set.
    fn set_torch_light(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
        level: u32,
        color: &LightColor,
    ) -> bool {
        todo!("Voxel access `set_torch_light` is not implemented.");
    }

    /// Get the max height at a voxel column. Returns 0 if column does not exist.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_max_height` is not implemented.");
    }

    /// Set the max height at a voxel column. Does nothing if column does not exist.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        todo!("Voxel access `set_max_height` is not implemented.");
    }

    /// Get a reference of voxel n-dimensional array.
    fn get_voxels(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_voxels` is not implemented.");
    }

    /// Get a reference of lighting n-dimensional array.
    fn get_lights(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_lights` is not implemented.");
    }
}
