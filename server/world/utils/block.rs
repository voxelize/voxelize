pub use voxelize_core::BlockUtils;
use crate::BlockRotation;

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
