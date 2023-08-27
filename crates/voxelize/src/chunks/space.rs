use hashbrown::HashMap;

use crate::{BlockAccess, BlockUpdate, Chunk, ChunkOptions, ChunkUtils, Vec2, Vec3};

#[derive(Debug, Default, Clone)]
pub struct Space {
    pub chunks: HashMap<Vec2<i32>, Chunk>,
    pub center: Vec2<i32>,
    pub radius: i32, // In chunks
    pub options: ChunkOptions,
    pub extra_block_updates: Vec<BlockUpdate>,
}

impl Space {
    pub fn get_chunk(&self, cx: i32, cz: i32) -> Option<&Chunk> {
        self.chunks.get(&Vec2(cx, cz))
    }

    pub fn get_chunk_mut(&mut self, cx: i32, cz: i32) -> Option<&mut Chunk> {
        self.chunks.get_mut(&Vec2(cx, cz))
    }
}

impl BlockAccess for Space {
    fn get_raw_block_data(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let chunk_size = self.options.chunk_size;
        let chunk_coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let chunk_local_coords = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        if let Some(chunk) = self.chunks.get(&chunk_coords) {
            chunk.get_raw_block_data(
                chunk_local_coords.0,
                chunk_local_coords.1,
                chunk_local_coords.2,
            )
        } else {
            0
        }
    }

    fn set_raw_block_data(&mut self, vx: i32, vy: i32, vz: i32, val: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            return false;
        }

        let chunk_size = self.options.chunk_size;
        let chunk_coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let chunk_local_coords = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        if chunk_coords != self.center {
            self.extra_block_updates.push((Vec3(vx, vy, vz), val));
        }

        if let Some(chunk) = self.chunks.get_mut(&chunk_coords) {
            chunk.set_raw_block_data(
                chunk_local_coords.0,
                chunk_local_coords.1,
                chunk_local_coords.2,
                val,
            )
        } else {
            false
        }
    }

    fn get_raw_light_data(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let chunk_size = self.options.chunk_size;
        let chunk_coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let chunk_local_coords = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        if let Some(chunk) = self.chunks.get(&chunk_coords) {
            chunk.get_raw_light_data(
                chunk_local_coords.0,
                chunk_local_coords.1,
                chunk_local_coords.2,
            )
        } else {
            0
        }
    }

    fn set_raw_light_data(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            return false;
        }

        let chunk_size = self.options.chunk_size;
        let chunk_coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let chunk_local_coords = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        if let Some(chunk) = self.chunks.get_mut(&chunk_coords) {
            chunk.set_raw_light_data(
                chunk_local_coords.0,
                chunk_local_coords.1,
                chunk_local_coords.2,
                level,
            )
        } else {
            false
        }
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let chunk_size = self.options.chunk_size;
        let chunk_coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        self.chunks.contains_key(&chunk_coords)
    }
}
