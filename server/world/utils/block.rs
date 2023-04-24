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

#[derive(Default)]
pub struct VoxelPacker {
    id: u32,
    rotation: BlockRotation,
    stage: u32,
}

impl VoxelPacker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_id(mut self, id: u32) -> Self {
        self.id = id;
        self
    }

    pub fn with_rotation(mut self, rotation: BlockRotation) -> Self {
        self.rotation = rotation;
        self
    }

    pub fn with_stage(mut self, stage: u32) -> Self {
        self.stage = stage;
        self
    }

    pub fn pack(&self) -> u32 {
        let mut voxel = 0;
        voxel = BlockUtils::insert_id(voxel, self.id);
        voxel = BlockUtils::insert_rotation(voxel, &self.rotation);
        voxel = BlockUtils::insert_stage(voxel, self.stage);
        voxel
    }
}
