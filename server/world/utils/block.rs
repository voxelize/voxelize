use crate::world::voxels::{BlockRotation, ROTATION_MASK, STAGE_MASK, Y_ROTATION_MASK};

/// A set of utility functions for block operations.
pub struct BlockUtils;

impl BlockUtils {
    /// Extract the bits in voxel that stores the voxel id.
    pub fn extract_id(voxel: u32) -> u32 {
        voxel & 0xFFFF
    }

    /// Insert a voxel id into voxel value.
    pub fn insert_id(voxel: u32, id: u32) -> u32 {
        (voxel & 0xFFFF0000) | (id & 0xFFFF)
    }

    /// Extract the bits in voxel that stores the voxel rotation.
    pub fn extract_rotation(voxel: u32) -> BlockRotation {
        let rotation = (voxel >> 16) & 0xF;
        let y_rot = (voxel >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rot)
    }

    /// Insert a voxel rotation into voxel value.
    pub fn insert_rotation(voxel: u32, rotation: &BlockRotation) -> u32 {
        let (rotation, y_rot) = BlockRotation::decode(rotation);
        let value = (voxel & ROTATION_MASK) | ((rotation & 0xF) << 16);
        (value & Y_ROTATION_MASK) | ((y_rot & 0xF) << 20)
    }

    /// Extract the bits in voxel that stores the stage value.
    pub fn extract_stage(voxel: u32) -> u32 {
        (voxel >> 24) & 0xF
    }

    /// Insert a voxel stage into voxel value. Panics if the stage passed in overflows 15.
    pub fn insert_stage(voxel: u32, stage: u32) -> u32 {
        assert!(stage <= 15, "Maximum stage is 15");

        (voxel & STAGE_MASK) | (stage << 24)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_insertion() {
        let mut voxel = 100230120;
        let id = 13;

        voxel = BlockUtils::insert_id(voxel, id);
        assert_eq!(BlockUtils::extract_id(voxel), id);

        // Exceeded maximum
        voxel = BlockUtils::insert_id(voxel, 65537);
        assert_eq!(BlockUtils::extract_id(voxel), 1);
    }

    #[test]
    fn rotation_insertion() {
        // let mut voxel = 0;
        let id = 13;

        // TODO: add rotation tests.

        // voxel = BlockUtils::insert_id(voxel, id);
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::PY(0.0));

        // voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::NX(0.0));
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::NX(0.0));

        // voxel = BlockUtils::insert_rotation(voxel, &BlockRotation::PZ(90.0));
        // assert_eq!(BlockUtils::extract_rotation(voxel), BlockRotation::PZ(90.0));

        // assert_eq!(BlockUtils::extract_id(voxel), id);
    }

    #[test]
    fn rotation_correctness() {
        let rotation = BlockRotation::PX(0.0);

        let compare = |a: [f32; 3], b: [f32; 3]| {
            assert!((a[0] - b[0]).abs() < f32::EPSILON);
            assert!((a[1] - b[1]).abs() < f32::EPSILON);
            assert!((a[2] - b[2]).abs() < f32::EPSILON);
        };

        // default rotation at PY
        let mut point = [0.0, 1.0, 0.0];
        rotation.rotate_node(&mut point, false);
        compare(point, [1.0, 0.0, 0.0]);

        point = [0.0, 0.0, 1.0];
        rotation.rotate_node(&mut point, false);
        compare(point, [0.0, 0.0, 1.0]);
    }

    #[test]
    fn stage() {
        let mut voxel = 0;
        let id = 13;

        voxel = BlockUtils::insert_id(voxel, id);

        assert_eq!(BlockUtils::extract_stage(voxel), 0);

        for stage in 0..16 {
            voxel = BlockUtils::insert_stage(voxel, stage);
            assert_eq!(BlockUtils::extract_stage(voxel), stage);
        }

        assert_eq!(BlockUtils::extract_id(voxel), id);
    }
}
