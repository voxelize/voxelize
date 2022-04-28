use hashbrown::HashMap;

use crate::{
    common::BlockChange,
    utils::{chunk_utils::ChunkUtils, light_utils::LightColor, vec::Vec2},
    vec::Vec3,
};

use super::{
    access::VoxelAccess,
    block::BlockRotation,
    chunk::Chunk,
    space::{SpaceBuilder, SpaceParams},
    WorldConfig,
};

/// A manager for all chunks in the Voxelize world.
#[derive(Default)]
pub struct Chunks {
    /// A map of all the chunks, coords -> Chunk.
    pub map: HashMap<Vec2<i32>, Chunk>,

    /// A copy of the world's config.
    config: WorldConfig,
}

impl Chunks {
    /// Create a new instance of a chunk manager.
    pub fn new(config: &WorldConfig) -> Self {
        Self {
            config: config.to_owned(),
            ..Default::default()
        }
    }

    /// Update a chunk, removing the old chunk instance and updating with a new one.
    pub fn renew(&mut self, chunk: Chunk) {
        self.map.remove(&chunk.coords);
        self.map.insert(chunk.coords.to_owned(), chunk);
    }

    /// Add a new chunk, synonym for `chunks.renew`
    pub fn add(&mut self, chunk: Chunk) {
        self.renew(chunk);
    }

    /// Get raw chunk data.
    pub fn raw(&self, coords: &Vec2<i32>) -> Option<&Chunk> {
        self.map.get(coords)
    }

    /// Get raw mutable chunk data.
    pub fn raw_mut(&mut self, coords: &Vec2<i32>) -> Option<&mut Chunk> {
        self.map.get_mut(coords)
    }

    /// Get a chunk at a chunk coordinate. If chunk is still in the pipeline (being instantiated),
    /// then None is returned.
    pub fn get_chunk(&self, coords: &Vec2<i32>) -> Option<&Chunk> {
        if !self.is_within_world(coords) {
            return None;
        }

        if let Some(chunk) = self.map.get(coords) {
            if chunk.stage.is_some() {
                return None;
            }
        }

        self.map.get(coords)
    }

    // Get a mutable chunk at a chunk coordinate.
    pub fn get_chunk_mut(&mut self, coords: &Vec2<i32>) -> Option<&mut Chunk> {
        if !self.is_within_world(coords) {
            return None;
        }

        if let Some(chunk) = self.map.get(coords) {
            if chunk.stage.is_some() {
                return None;
            }
        }

        self.map.get_mut(coords)
    }

    // Get a chunk by voxel coordinates.
    pub fn get_chunk_by_voxel(&self, vx: i32, vy: i32, vz: i32) -> Option<&Chunk> {
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, self.config.chunk_size as usize);
        self.get_chunk(&coords)
    }

    /// Get a mutable chunk by voxel coordinates.
    pub fn get_chunk_by_voxel_mut(&mut self, vx: i32, vy: i32, vz: i32) -> Option<&mut Chunk> {
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, self.config.chunk_size as usize);
        self.get_chunk_mut(&coords)
    }

    /// Get neighboring coords
    pub fn get_voxel_affected_chunks(&self, vx: i32, vy: i32, vz: i32) -> Vec<Vec2<i32>> {
        let mut neighbors = vec![];
        let chunk_size = self.config.chunk_size;

        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let Vec3(lx, _, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        neighbors.push(Vec2(cx, cz));

        let a = lx == 0;
        let b = lz == 0;
        let c = lx == chunk_size - 1;
        let d = lz == chunk_size - 1;

        if a {
            neighbors.push(Vec2(cx - 1, cz))
        }
        if b {
            neighbors.push(Vec2(cx, cz - 1));
        }
        if c {
            neighbors.push(Vec2(cx + 1, cz));
        }
        if c {
            neighbors.push(Vec2(cx, cz + 1));
        }

        if a && b {
            neighbors.push(Vec2(cx - 1, cz - 1));
        }
        if a && d {
            neighbors.push(Vec2(cx - 1, cz + 1));
        }
        if b && c {
            neighbors.push(Vec2(cx + 1, cz - 1));
        }
        if c && d {
            neighbors.push(Vec2(cx + 1, cz + 1));
        }

        neighbors
    }

    /// Create a voxel querying space around a chunk coordinate.
    ///
    /// # Example
    ///
    /// ```
    /// // Create a space that has all voxel/light/height_map data.
    /// let space = Chunks::make_space(0, 0, 15).needs_all().build();
    /// ```
    pub fn make_space<'a>(&'a self, cx: i32, cz: i32, margin: usize) -> SpaceBuilder<'a> {
        SpaceBuilder {
            chunks: self,
            coords: Vec2(cx, cz),
            params: SpaceParams {
                margin,
                chunk_size: self.config.chunk_size,
                max_height: self.config.max_height,
                max_light_level: self.config.max_light_level,
            },
            needs_voxels: false,
            needs_lights: false,
            needs_height_maps: false,
        }
    }

    pub fn is_within_world(&self, coords: &Vec2<i32>) -> bool {
        coords.0 >= self.config.min_chunk[0]
            && coords.0 <= self.config.max_chunk[0]
            && coords.1 >= self.config.min_chunk[1]
            && coords.1 <= self.config.max_chunk[1]
    }
}

impl VoxelAccess for Chunks {
    /// Get the voxel ID at a voxel coordinate. If chunk not found, 0 is returned.
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, vy, vz) {
            chunk.get_voxel(vx, vy, vz)
        } else {
            0
        }
    }

    /// Set the voxel type at a voxel coordinate. Does nothing if chunk does not exit.
    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_voxel(vx, vy, vz, id);
        }
    }

    /// Get the voxel rotation at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, vy, vz) {
            chunk.get_voxel_rotation(vx, vy, vz)
        } else {
            panic!("Rotation not obtainable.");
        }
    }

    /// Set the voxel rotation at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_voxel_rotation(vx, vy, vz, rotation);
        }
    }

    /// Get the voxel stage at a voxel coordinate. Panics if chunk isn't found.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, vy, vz) {
            chunk.get_voxel_stage(vx, vy, vz)
        } else {
            panic!("Stage not obtainable.");
        }
    }

    /// Set the voxel stage at a voxel coordinate. Does nothing if chunk isn't found.
    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_voxel_stage(vx, vy, vz, stage);
        }
    }

    /// Get the sunlight level at a voxel position. Returns 0 if chunk does not exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, vy, vz) {
            chunk.get_sunlight(vx, vy, vz)
        } else {
            return if vy < 0 {
                0
            } else {
                self.config.max_light_level
            };
        }
    }

    /// Set the sunlight level at a voxel coordinate. Does nothing if chunk doesn't exist.
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_sunlight(vx, vy, vz, level);
        }
    }

    /// Get the torch light level by color at a voxel coordinate. Returns 0 if chunk does not exist.
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, vy, vz) {
            chunk.get_torch_light(vx, vy, vz, color)
        } else {
            0
        }
    }

    /// Set the torch light level by color at a voxel coordinate. Does nothing if chunk doesn't exist.
    fn set_torch_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32, color: &LightColor) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_torch_light(vx, vy, vz, level, color)
        }
    }

    /// Get the max height at a voxel column. Returns 0 if column does not exist.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.get_chunk_by_voxel(vx, 0, vz) {
            chunk.get_max_height(vx, vz)
        } else {
            0
        }
    }

    /// Set the max height at a voxel column. Does nothing if column does not exist.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) {
        if let Some(chunk) = self.get_chunk_by_voxel_mut(vx, 0, vz) {
            chunk.set_max_height(vx, vz, height);
        }
    }
}
