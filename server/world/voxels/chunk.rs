use std::ops::Range;
use std::sync::Arc;

use hashbrown::{HashMap, HashSet};

use crate::{
    BlockUtils, ChunkProtocol, ChunkUtils, MeshProtocol, Ndarray, Registry, Vec2, Vec3,
    VoxelUpdate,
};

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
        let ChunkOptions {
            size, max_height, ..
        } = self.options;
        let height_map = Arc::make_mut(&mut self.height_map);

        for lx in 0..size {
            for lz in 0..size {
                let mut column_height = 0;

                for ly in (0..max_height).rev() {
                    let id = BlockUtils::extract_id(self.voxels[&[lx, ly, lz]]);
                    if ly == 0 || registry.check_height(id) {
                        column_height = ly as u32;
                        break;
                    }
                }

                height_map[&[lx, lz]] = column_height;
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
        let max_height = self.options.max_height;
        let sub_chunks = self.options.sub_chunks;
        if sub_chunks == 0 || max_height == 0 || vy < 0 {
            return;
        }
        let vy = vy as usize;
        if vy >= max_height {
            return;
        }

        if max_height % sub_chunks == 0 {
            let partition = max_height / sub_chunks;
            if partition > 0 {
                let level = vy / partition;
                if level < sub_chunks {
                    if let Ok(level_u32) = u32::try_from(level) {
                        self.updated_levels.insert(level_u32);
                    }
                    let remainder = vy % partition;
                    if remainder + 1 == partition && level + 1 < sub_chunks {
                        if let Ok(next_level_u32) = u32::try_from(level + 1) {
                            self.updated_levels.insert(next_level_u32);
                        }
                    }
                    if remainder == 0 && level > 0 {
                        if let Ok(prev_level_u32) = u32::try_from(level - 1) {
                            self.updated_levels.insert(prev_level_u32);
                        }
                    }
                }
            }
            return;
        }

        let max_height_u128 = max_height as u128;
        let sub_chunks_u128 = sub_chunks as u128;
        let level = ((vy as u128) * sub_chunks_u128) / max_height_u128;
        if level >= sub_chunks_u128 {
            return;
        }
        let Ok(level_u32) = u32::try_from(level) else {
            return;
        };
        self.updated_levels.insert(level_u32);

        if level > 0 {
            let level_start = (level * max_height_u128) / sub_chunks_u128;
            if (vy as u128) == level_start {
                let prev_level = level - 1;
                if let Ok(prev_level_u32) = u32::try_from(prev_level) {
                    self.updated_levels.insert(prev_level_u32);
                }
            }
        }

        let next_level = level + 1;
        if next_level < sub_chunks_u128 {
            let next_level_start = (next_level * max_height_u128) / sub_chunks_u128;
            if (vy as u128).saturating_add(1) == next_level_start {
                if let Ok(next_level_u32) = u32::try_from(next_level) {
                    self.updated_levels.insert(next_level_u32);
                }
            }
        }
    }

    #[inline]
    fn local_voxel_if_contains(&self, vx: i32, vy: i32, vz: i32) -> Option<Vec3<usize>> {
        let size = if self.options.size > i64::MAX as usize {
            i64::MAX
        } else {
            self.options.size as i64
        };
        let max_height = if self.options.max_height > i64::MAX as usize {
            i64::MAX
        } else {
            self.options.max_height as i64
        };
        let Vec3(mx, my, mz) = self.min;
        let lx = i64::from(vx) - i64::from(mx);
        let ly = i64::from(vy) - i64::from(my);
        let lz = i64::from(vz) - i64::from(mz);

        if lx < 0 || ly < 0 || lz < 0 || lx >= size || ly >= max_height || lz >= size {
            return None;
        }

        Some(Vec3(lx as usize, ly as usize, lz as usize))
    }

    #[inline]
    fn local_column_if_contains(&self, vx: i32, vz: i32) -> Option<(usize, usize)> {
        let Vec3(lx, _, lz) = self.local_voxel_if_contains(vx, 0, vz)?;
        Some((lx, lz))
    }
}

impl VoxelAccess for Chunk {
    /// Get the raw value of voxel.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let Some(Vec3(lx, ly, lz)) = self.local_voxel_if_contains(vx, vy, vz) else {
            return 0;
        };
        self.voxels[&[lx, ly, lz]]
    }

    /// Set the raw value of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, val: u32) -> bool {
        let Some(Vec3(lx, ly, lz)) = self.local_voxel_if_contains(vx, vy, vz) else {
            if vy >= 0 && (vy as usize) < self.options.max_height {
                self.extra_changes.push((Vec3(vx, vy, vz), val));
            }

            return false;
        };
        if self.voxels[&[lx, ly, lz]] == val {
            return true;
        }

        self.add_updated_level(vy);
        Arc::make_mut(&mut self.voxels)[&[lx, ly, lz]] = val;

        true
    }

    /// Get the raw light of voxel.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let Some(Vec3(lx, ly, lz)) = self.local_voxel_if_contains(vx, vy, vz) else {
            return 0;
        };
        self.lights[&[lx, ly, lz]]
    }

    /// Set the raw light of voxel.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let Some(Vec3(lx, ly, lz)) = self.local_voxel_if_contains(vx, vy, vz) else {
            return false;
        };
        if self.lights[&[lx, ly, lz]] == level {
            return true;
        }

        self.add_updated_level(vy);

        Arc::make_mut(&mut self.lights)[&[lx, ly, lz]] = level;

        true
    }

    /// Get the max height of a voxel column.
    ///
    /// Returns `0` if it's not within the chunk.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        let Some((lx, lz)) = self.local_column_if_contains(vx, vz) else {
            return 0;
        };
        self.height_map[&[lx, lz]]
    }

    /// Set the max height of a voxel column.
    ///
    /// Panics if it's not within the chunk.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        let Some((lx, lz)) = self.local_column_if_contains(vx, vz) else {
            return false;
        };
        if self.height_map[&[lx, lz]] == height {
            return true;
        }
        Arc::make_mut(&mut self.height_map)[&[lx, lz]] = height;

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
        self.local_voxel_if_contains(vx, vy, vz).is_some()
    }
}
