use crate::BlockRotation;

pub const PY_ROTATION: u32 = 0;
pub const NY_ROTATION: u32 = 1;
pub const PX_ROTATION: u32 = 2;
pub const NX_ROTATION: u32 = 3;
pub const PZ_ROTATION: u32 = 4;
pub const NZ_ROTATION: u32 = 5;

pub const Y_ROT_SEGMENTS: u32 = 16;

pub const ROTATION_MASK: u32 = 0xFFF0FFFF;
pub const Y_ROTATION_MASK: u32 = 0xFF0FFFFF;
pub const STAGE_MASK: u32 = 0xF0FFFFFF;

pub struct BlockUtils;

impl BlockUtils {
    #[inline]
    pub fn extract_id(voxel: u32) -> u32 {
        voxel & 0xFFFF
    }

    #[inline]
    pub fn insert_id(voxel: u32, id: u32) -> u32 {
        (voxel & 0xFFFF0000) | (id & 0xFFFF)
    }

    #[inline]
    pub fn extract_rotation(voxel: u32) -> BlockRotation {
        let rotation = (voxel >> 16) & 0xF;
        let y_rot = (voxel >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rot)
    }

    #[inline]
    pub fn insert_rotation(voxel: u32, rotation: &BlockRotation) -> u32 {
        let (rotation_val, y_rot) = BlockRotation::decode(rotation);
        let value = (voxel & ROTATION_MASK) | ((rotation_val & 0xF) << 16);
        (value & Y_ROTATION_MASK) | ((y_rot & 0xF) << 20)
    }

    #[inline]
    pub fn extract_stage(voxel: u32) -> u32 {
        (voxel >> 24) & 0xF
    }

    #[inline]
    pub fn insert_stage(voxel: u32, stage: u32) -> u32 {
        assert!(stage <= 15, "Maximum stage is 15");
        (voxel & STAGE_MASK) | (stage << 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_roundtrip() {
        for id in [0, 1, 100, 1000, 65535] {
            let voxel = BlockUtils::insert_id(0, id);
            assert_eq!(BlockUtils::extract_id(voxel), id);
        }
    }

    #[test]
    fn test_id_overflow() {
        let voxel = BlockUtils::insert_id(0, 65537);
        assert_eq!(BlockUtils::extract_id(voxel), 1);
    }

    #[test]
    fn test_stage_roundtrip() {
        for stage in 0..=15 {
            let voxel = BlockUtils::insert_stage(0, stage);
            assert_eq!(BlockUtils::extract_stage(voxel), stage);
        }
    }

    #[test]
    fn test_combined_voxel_data() {
        let mut voxel = 0u32;
        voxel = BlockUtils::insert_id(voxel, 42);
        voxel = BlockUtils::insert_stage(voxel, 7);

        assert_eq!(BlockUtils::extract_id(voxel), 42);
        assert_eq!(BlockUtils::extract_stage(voxel), 7);
    }

    #[test]
    fn test_rotation_roundtrip() {
        let rotation = BlockRotation::PY(0.0);
        let voxel = BlockUtils::insert_rotation(0, &rotation);
        let extracted = BlockUtils::extract_rotation(voxel);
        assert_eq!(extracted, rotation);
    }
}
