use std::ops::Range;
use std::sync::Arc;

use hashbrown::{HashMap, HashSet};

use crate::{ChunkProtocol, ChunkUtils, MeshProtocol, Ndarray, Registry, Vec2, Vec3, VoxelUpdate};

use super::access::VoxelAccess;

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

    pub voxels: Arc<Ndarray<u32>>,
    pub lights: Arc<Ndarray<u32>>,
    pub height_map: Arc<Ndarray<u32>>,

    pub meshes: Option<HashMap<u32, MeshProtocol>>,

    pub min: Vec3<i32>,
    pub max: Vec3<i32>,

    pub options: ChunkOptions,

    pub extra_changes: Vec<VoxelUpdate>,
    pub updated_levels: HashSet<u32>,
}

impl Chunk {
    pub fn new(id: &str, cx: i32, cz: i32, options: &ChunkOptions) -> Self {
        let ChunkOptions {
            size,
            max_height,
            sub_chunks,
        } = *options;

        let voxels = Arc::new(Ndarray::new(&[size, max_height, size], 0));
        let lights = Arc::new(Ndarray::new(&[size, max_height, size], 0));
        let height_map = Arc::new(Ndarray::new(&[size, size], 0));

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

            voxels,
            lights,
            height_map,

            min,
            max,

            options: options.to_owned(),
            updated_levels: (0..sub_chunks as u32).collect(),

            ..Default::default()
        }
    }

    /// Calculate the height map of this chunk.
    pub fn calculate_max_height(&mut self, registry: &Registry) {
        let Vec3(min_x, _, min_z) = self.min;
        let Vec3(max_x, _, max_z) = self.max;

        let max_height = self.options.max_height as i32;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in (0..max_height).rev() {
                    let id = self.get_voxel(vx, vy, vz);

                    if vy == 0 || registry.check_height(id) {
                        self.set_max_height(vx, vz, vy as u32);
                        break;
                    }
                }
            }
        }
    }

    /// Convert chunk to protocol model.
    pub fn to_model(&self, mesh: bool, data: bool, levels: Range<u32>) -> ChunkProtocol {
        let mut meshes = vec![];

        if mesh {
            if let Some(chunk_meshes) = &self.meshes {
                for level in levels {
                    if let Some(mesh) = chunk_meshes.get(&level) {
                        meshes.push(mesh.to_owned());
                    }
                }
            }
        }

        ChunkProtocol {
            x: self.coords.0,
            z: self.coords.1,
            id: self.id.clone(),
            meshes,
            voxels: if data {
                Some((*self.voxels).clone())
            } else {
                None
            },
            lights: if data {
                Some((*self.lights).clone())
            } else {
                None
            },
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

impl VoxelAccess for Chunk {
    /// Get the raw value of voxel.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.voxels[&[lx, ly, lz]]
    }

    /// Set the raw value of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, val: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            if vy >= 0 && vy < self.options.max_height as i32 {
                self.extra_changes.push((Vec3(vx, vy, vz), val));
            }

            return false;
        }

        self.add_updated_level(vy);

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        Arc::make_mut(&mut self.voxels)[&[lx, ly, lz]] = val;

        true
    }

    /// Get the raw light of voxel.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.lights[&[lx, ly, lz]]
    }

    /// Set the raw light of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if !self.contains(vx, vy, vz) {
            return false;
        }

        self.add_updated_level(vy);

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        Arc::make_mut(&mut self.lights)[&[lx, ly, lz]] = level;

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
        Arc::make_mut(&mut self.height_map)[&[lx as usize, lz as usize]] = height;

        true
    }

    fn get_lights(&self, _: i32, _: i32) -> Option<&Ndarray<u32>> {
        Some(&self.lights)
    }

    fn get_voxels(&self, _: i32, _: i32) -> Option<&Ndarray<u32>> {
        Some(&self.voxels)
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
