use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

use voxelize_core::{
    BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockRuleLogic, CornerData,
    LightColor, LightUtils, VoxelAccess, AABB, UV,
};

use super::*;

pub(super) struct VoxelSpace<'a> {
    chunks: &'a [Option<ChunkData>],
    chunk_size: i32,
    center_coords: [i32; 2],
}

impl<'a> VoxelSpace<'a> {
    pub(super) fn new(chunks: &'a [Option<ChunkData>], chunk_size: i32, center_coords: [i32; 2]) -> Self {
        Self {
            chunks,
            chunk_size,
            center_coords,
        }
    }

    #[inline]
    pub(super) fn map_voxel_to_chunk(&self, vx: i32, vz: i32) -> [i32; 2] {
        [
            vx.div_euclid(self.chunk_size),
            vz.div_euclid(self.chunk_size),
        ]
    }

    #[inline]
    pub(super) fn get_chunk(&self, coords: [i32; 2]) -> Option<&ChunkData> {
        let dx = coords[0] - self.center_coords[0];
        let dz = coords[1] - self.center_coords[1];
        if dx < -1 || dx > 1 || dz < -1 || dz > 1 {
            return None;
        }
        let index = ((dz + 1) * 3 + (dx + 1)) as usize;
        self.chunks.get(index).and_then(|c| c.as_ref())
    }

    #[inline]
    pub(super) fn get_index(&self, chunk: &ChunkData, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        let lx = vx.rem_euclid(self.chunk_size) as usize;
        let ly = vy as usize;
        let lz = vz.rem_euclid(self.chunk_size) as usize;

        if ly >= chunk.shape[1] {
            return None;
        }

        let index = lx * chunk.shape[1] * chunk.shape[2] + ly * chunk.shape[2] + lz;
        if index < chunk.voxels.len() {
            Some(index)
        } else {
            None
        }
    }

    #[inline]
    pub(super) fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return chunk.voxels[index] & 0xFFFF;
            }
        }
        0
    }

    #[inline]
    pub(super) fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return chunk.voxels[index];
            }
        }
        0
    }

    #[inline]
    pub(super) fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        let rotation = (raw >> 16) & 0xF;
        let y_rotation = (raw >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rotation)
    }

    #[inline]
    pub(super) fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let raw = self.get_raw_voxel(vx, vy, vz);
        (raw >> 24) & 0xF
    }

    #[inline]
    pub(super) fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                // Lights can lag voxels for a chunk mid-transfer; missing
                // entries read as dark instead of panicking the worker.
                if let Some(light) = chunk.lights.get(index) {
                    return LightUtils::extract_sunlight(*light);
                }
            }
        }
        0
    }

    #[inline]
    pub(super) fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                if let Some(light) = chunk.lights.get(index).copied() {
                    return match color {
                        LightColor::Red => LightUtils::extract_red_light(light),
                        LightColor::Green => LightUtils::extract_green_light(light),
                        LightColor::Blue => LightUtils::extract_blue_light(light),
                        LightColor::Sunlight => LightUtils::extract_sunlight(light),
                    };
                }
            }
        }
        0
    }

    #[inline]
    pub(super) fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                if let Some(light) = chunk.lights.get(index) {
                    return LightUtils::extract_all(*light);
                }
            }
        }
        (0, 0, 0, 0)
    }

    #[inline]
    pub(super) fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let coords = self.map_voxel_to_chunk(vx, vz);
        self.get_chunk(coords).is_some() && vy >= 0
    }

    #[inline]
    pub(super) fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        u32::MAX
    }
}

impl<'a> VoxelAccess for VoxelSpace<'a> {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_voxel(self, vx, vy, vz)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_raw_voxel(self, vx, vy, vz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        VoxelSpace::get_voxel_rotation(self, vx, vy, vz)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_voxel_stage(self, vx, vy, vz)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_sunlight(self, vx, vy, vz)
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        VoxelSpace::get_torch_light(self, vx, vy, vz, color)
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        VoxelSpace::get_all_lights(self, vx, vy, vz)
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        VoxelSpace::get_max_height(self, vx, vz)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        VoxelSpace::contains(self, vx, vy, vz)
    }
}

pub(super) fn chunk_range_has_non_empty_voxel(
    chunk: &ChunkData,
    min: &[i32; 3],
    max: &[i32; 3],
    registry: &Registry,
) -> bool {
    let chunk_min = chunk.min;
    let chunk_max = [
        chunk_min[0] + chunk.shape[0] as i32,
        chunk_min[1] + chunk.shape[1] as i32,
        chunk_min[2] + chunk.shape[2] as i32,
    ];
    let start = [
        min[0].max(chunk_min[0]),
        min[1].max(chunk_min[1]),
        min[2].max(chunk_min[2]),
    ];
    let end = [
        max[0].min(chunk_max[0]),
        max[1].min(chunk_max[1]),
        max[2].min(chunk_max[2]),
    ];

    if start[0] >= end[0] || start[1] >= end[1] || start[2] >= end[2] {
        return false;
    }

    for vx in start[0]..end[0] {
        let lx = (vx - chunk_min[0]) as usize;
        for vy in start[1]..end[1] {
            let ly = (vy - chunk_min[1]) as usize;
            for vz in start[2]..end[2] {
                let lz = (vz - chunk_min[2]) as usize;
                let index = lx * chunk.shape[1] * chunk.shape[2] + ly * chunk.shape[2] + lz;
                // A chunk mid-transfer can arrive with fewer voxels than its
                // shape claims; treat the missing tail as air instead of
                // aborting the whole wasm worker on an out-of-bounds read.
                let Some(voxel) = chunk.voxels.get(index) else {
                    continue;
                };
                let voxel_id = extract_id(*voxel);
                if registry
                    .get_block_by_id(voxel_id)
                    .map(|block| !block.is_empty)
                    .unwrap_or(false)
                {
                    return true;
                }
            }
        }
    }

    false
}

pub(super) fn extract_id(voxel: u32) -> u32 {
    voxel & 0xFFFF
}

pub(super) enum ScanBounds {
    Empty,
    Sparse { min: [i32; 3], max: [i32; 3] },
    Dense,
}

pub(super) fn find_sparse_non_empty_bounds<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> ScanBounds {
    let [min_x, min_y, min_z] = *min;
    let [max_x, max_y, max_z] = *max;
    let mut scan_min = [i32::MAX; 3];
    let mut scan_max = [i32::MIN; 3];
    let volume = ((max_x - min_x) * (max_y - min_y) * (max_z - min_z)).max(1) as usize;
    let dense_threshold = (volume / 8).max(1);
    let mut non_empty_count = 0usize;

    for vx in min_x..max_x {
        for vz in min_z..max_z {
            for vy in min_y..max_y {
                let voxel_id = space.get_voxel(vx, vy, vz);
                let is_non_empty = registry
                    .get_block_by_id(voxel_id)
                    .map(|block| !block.is_empty)
                    .unwrap_or(false);

                if is_non_empty {
                    non_empty_count += 1;
                    if non_empty_count > dense_threshold {
                        return ScanBounds::Dense;
                    }
                    scan_min[0] = scan_min[0].min(vx);
                    scan_min[1] = scan_min[1].min(vy);
                    scan_min[2] = scan_min[2].min(vz);
                    scan_max[0] = scan_max[0].max(vx + 1);
                    scan_max[1] = scan_max[1].max(vy + 1);
                    scan_max[2] = scan_max[2].max(vz + 1);
                }
            }
        }
    }

    if scan_min[0] == i32::MAX {
        ScanBounds::Empty
    } else {
        ScanBounds::Sparse {
            min: scan_min,
            max: scan_max,
        }
    }
}
