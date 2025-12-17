use crate::{BlockUtils, LightColor, LightUtils, Ndarray};

use super::block::BlockRotation;

#[allow(unused)]
pub trait VoxelAccess {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_voxel` is not implemented.");
    }

    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_light` is not implemented.");
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
        let value = BlockUtils::insert_id(0, id);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if !self.contains(vx, vy, vz) {
            return BlockRotation::PX(0.0);
        }

        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) -> bool {
        let value = BlockUtils::insert_rotation(self.get_raw_voxel(vx, vy, vz), rotation);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) -> bool {
        let value = BlockUtils::insert_stage(self.get_raw_voxel(vx, vy, vz), stage);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_sunlight(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_red_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_green_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_blue_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }

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
            LightColor::Sunlight => panic!("Setting torch light of Sunlight!"),
        }
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_max_height` is not implemented.");
    }

    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        todo!("Voxel access `set_max_height` is not implemented.");
    }

    fn get_voxels(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_voxels` is not implemented.");
    }

    fn get_lights(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_lights` is not implemented.");
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        todo!("Voxel access `contains` is not implemented.");
    }
}
