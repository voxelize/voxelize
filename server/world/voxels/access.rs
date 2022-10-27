use crate::{BlockUtils, LightColor, LightUtils, Ndarray};

use super::block::BlockRotation;

#[allow(unused)]
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
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set the voxel type at a voxel coordinate. Returns false couldn't set.
    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
        let value = BlockUtils::insert_id(0, id);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    /// Get the voxel rotation at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if !self.contains(vx, vy, vz) {
            return BlockRotation::PX(0.0);
        }

        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set the voxel rotation at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) -> bool {
        let value = BlockUtils::insert_rotation(self.get_raw_voxel(vx, vy, vz), rotation);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    /// Get the voxel stage at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set the voxel stage at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) -> bool {
        let value = BlockUtils::insert_stage(self.get_raw_voxel(vx, vy, vz), stage);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    /// Get the sunlight level at a voxel position. Returns 0 if chunk does not exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    /// Set the sunlight level at a voxel coordinate. Returns false if could not set.
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_sunlight(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the red light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the red light level at the voxel position. Returns false if could not set.
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_red_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the green light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the green light level at the voxel position. Returns false if could not set.
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_green_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the blue light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the blue light level at the voxel position. Returns false if could not set.
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_blue_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the torch light level by color at a voxel coordinate. Returns 0 if chunk does not exist.
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
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
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
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

    /// Checks to see if the voxel is contained within the voxel acces.
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        todo!("Voxel access `contains` is not implemented.");
    }
}
