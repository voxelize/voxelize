use std::ops::Range;

use hashbrown::{HashMap, HashSet};
use voxelize_protocol::{ChunkData, MeshData};

use crate::{
    block::{BlockAccess, BlockUpdate},
    libs::{Ndarray, Vec2, Vec3},
    Registry,
};

use super::ChunkUtils;

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ChunkStatus {
    Generating(usize),

    Meshing,

    Ready,
}

impl Default for ChunkStatus {
    fn default() -> Self {
        Self::Generating(0)
    }
}

#[derive(Debug, Default, Clone)]
pub struct ChunkOptions {
    pub size: usize,
    pub max_height: usize,
    pub sub_chunks: usize,
}

#[derive(Debug, Default, Clone)]
pub struct Chunk {
    pub id: String,
    pub name: String,
    pub coords: Vec2<i32>,

    pub status: ChunkStatus,

    pub blocks: Ndarray<u32>,
    pub lights: Ndarray<u32>,
    pub height_map: Ndarray<u32>,

    pub meshes: Option<HashMap<u32, MeshData>>,

    pub min: Vec3<i32>,
    pub max: Vec3<i32>,

    pub options: ChunkOptions,

    pub extra_updates: Vec<BlockUpdate>,
    pub updated_levels: HashSet<u32>,
}

impl Chunk {
    pub fn new(id: &str, cx: i32, cz: i32, options: &ChunkOptions) -> Self {
        let ChunkOptions {
            size,
            max_height,
            sub_chunks,
        } = *options;

        let blocks = Ndarray::new(&[size, max_height, size], 0);
        let lights = Ndarray::new(&[size, max_height, size], 0);
        let height_map = Ndarray::new(&[size, size], 0);

        let min = Vec3(cx * size as i32, 0, cz * size as i32);
        let max = Vec3(
            (cx + 1) * size as i32,
            max_height as i32,
            (cz + 1) * size as i32,
        );

        Self {
            id: id.to_owned(),
            name: ChunkUtils::get_chunk_name(cx, cz),
            coords: Vec2(cx, cz),

            blocks,
            lights,
            height_map,

            min,
            max,

            options: options.to_owned(),
            updated_levels: (0..sub_chunks as u32).collect(),

            ..Default::default()
        }
    }

    /// Convert chunk to protocol model.
    pub fn to_model(&self, mesh: bool, data: bool, levels: Range<u32>) -> ChunkData {
        let mut meshes = vec![];

        if mesh {
            if self.meshes.is_some() {
                levels.for_each(|level| {
                    if let Some(mesh) = self.meshes.as_ref().unwrap().get(&level) {
                        meshes.push(mesh.to_owned());
                    }
                });
            }
        }

        ChunkData {
            x: self.coords.0,
            z: self.coords.1,
            id: self.id.clone(),
            meshes,
            blocks: self.blocks.to_owned().data,
            lights: self.lights.to_owned().data,
            metainfo: None,
        }
    }

    /// Flag a level of sub-chunk as dirty, waiting to be remeshed.
    pub fn add_updated_level(&mut self, vy: i32) {
        let partition = (self.options.max_height / self.options.sub_chunks) as i32;

        let level = vy / partition;
        let remainder = vy % partition;

        if remainder == partition - 1 && (level) < (self.options.sub_chunks as i32) - 1 {
            self.updated_levels.insert(level as u32 + 1);
        }

        if remainder == 0 && level > 0 {
            self.updated_levels.insert(level as u32 - 1);
        }

        self.updated_levels.insert(level as u32);
    }

    /// Convert voxel coordinates to local chunk coordinates.
    fn to_local(&self, vx: i32, vy: i32, vz: i32) -> Vec3<usize> {
        let Vec3(mx, my, mz) = self.min;
        Vec3((vx - mx) as usize, (vy - my) as usize, (vz - mz) as usize)
    }
}

impl BlockAccess for Chunk {
    /// Get the raw value of block.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_block_data(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.blocks[&[lx, ly, lz]]
    }

    /// Set the raw value of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_block_data(&mut self, vx: i32, vy: i32, vz: i32, val: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            if vy >= 0 && vy < self.options.max_height as i32 {
                self.extra_updates.push((Vec3(vx, vy, vz), val));
            }

            return false;
        }

        self.add_updated_level(vy);

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.blocks[&[lx, ly, lz]] = val;

        true
    }

    /// Get the raw light of voxel.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_light_data(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.lights[&[lx, ly, lz]]
    }

    /// Set the raw light of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_light_data(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            return false;
        }

        self.add_updated_level(vy);

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.lights[&[lx, ly, lz]] = level;

        true
    }

    /// Get the max height of a voxel column.
    ///
    /// Returns `max_height` if it's not within the chunk.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if !self.contains(vx, 0, vz) {
            return self.options.max_height as u32;
        }

        let Vec3(lx, _, lz) = self.to_local(vx, 0, vz);
        self.height_map[&[lx as usize, lz as usize]]
    }

    /// Set the max height of a voxel column.
    ///
    /// Panics if it's not within the chunk.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        if !self.contains(vx, 0, vz) {
            return false;
        }

        let Vec3(lx, _, lz) = self.to_local(vx, 0, vz);
        self.height_map[&[lx as usize, lz as usize]] = height;

        true
    }

    fn get_lights(&self, _: i32, _: i32) -> Option<&Ndarray<u32>> {
        Some(&self.lights)
    }

    fn get_blocks(&self, _: i32, _: i32) -> Option<&Ndarray<u32>> {
        Some(&self.blocks)
    }

    /// Check if chunk contains this voxel coordinate.
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let ChunkOptions {
            size, max_height, ..
        } = self.options;
        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);

        lx < size && ly < max_height && lz < size
    }
}
