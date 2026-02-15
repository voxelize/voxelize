use std::ops::Range;
use std::sync::Arc;

use hashbrown::{HashMap, HashSet};

use crate::{
    BlockUtils, ChunkProtocol, ChunkUtils, MeshProtocol, Ndarray, Registry, Vec2, Vec3,
    VoxelUpdate,
};

use super::access::VoxelAccess;

const MAX_REPRESENTABLE_LEVEL_COUNT: u128 = u32::MAX as u128 + 1;

#[inline]
fn representable_level_count(sub_chunks: usize) -> u128 {
    (sub_chunks as u128).min(MAX_REPRESENTABLE_LEVEL_COUNT)
}

#[inline]
fn map_y_to_level(vy: usize, max_height: usize, level_count: u128) -> u32 {
    if level_count == 0 || max_height == 0 {
        return 0;
    }
    let max_level = level_count.saturating_sub(1);
    ((vy as u128).saturating_mul(level_count) / max_height as u128).min(max_level) as u32
}

fn initial_updated_levels(sub_chunks: usize, max_height: usize) -> HashSet<u32> {
    if sub_chunks == 0 || max_height == 0 {
        return HashSet::new();
    }

    let level_count = representable_level_count(sub_chunks);
    let level_count_usize = level_count.min(usize::MAX as u128) as usize;
    if max_height >= level_count_usize {
        let mut levels = HashSet::with_capacity(level_count_usize);
        for level in 0..level_count_usize {
            levels.insert(level as u32);
        }
        return levels;
    }

    let mut levels = HashSet::with_capacity(max_height);
    for y in 0..max_height {
        levels.insert(map_y_to_level(y, max_height, level_count));
    }

    levels
}

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

        let clamp_i64_to_i32 =
            |value: i64| value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
        let size_i64 = if size > i64::MAX as usize {
            i64::MAX
        } else {
            size as i64
        };
        let min_x = i64::from(cx).saturating_mul(size_i64);
        let min_z = i64::from(cz).saturating_mul(size_i64);
        let max_x = min_x.saturating_add(size_i64);
        let max_z = min_z.saturating_add(size_i64);
        let max_height_i32 = if max_height > i32::MAX as usize {
            i32::MAX
        } else {
            max_height as i32
        };
        let min = Vec3(clamp_i64_to_i32(min_x), 0, clamp_i64_to_i32(min_z));
        let max = Vec3(
            clamp_i64_to_i32(max_x),
            max_height_i32,
            clamp_i64_to_i32(max_z),
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
            updated_levels: initial_updated_levels(sub_chunks, max_height),

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
                    if ly == 0 {
                        break;
                    }
                    let id = BlockUtils::extract_id(self.voxels[&[lx, ly, lz]]);
                    if registry.check_height(id) {
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

        let level_count = representable_level_count(sub_chunks);
        let max_height_u128 = max_height as u128;
        let vy_u128 = vy as u128;
        let max_level = level_count.saturating_sub(1);
        let level = ((vy_u128 * level_count) / max_height_u128).min(max_level);
        self.updated_levels.insert(level as u32);

        if level > 0 {
            let level_start = (level * max_height_u128) / level_count;
            if vy_u128 == level_start {
                self.updated_levels.insert((level - 1) as u32);
            }
        }

        let next_level = level + 1;
        if next_level < level_count {
            let next_level_start = (next_level * max_height_u128) / level_count;
            if vy_u128.saturating_add(1) == next_level_start {
                self.updated_levels.insert(next_level as u32);
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

#[cfg(test)]
mod tests {
    use hashbrown::HashSet;

    use super::{initial_updated_levels, map_y_to_level, representable_level_count, Chunk, ChunkOptions};

    #[test]
    fn initial_updated_levels_only_tracks_non_empty_dense_partitions() {
        let levels = initial_updated_levels(8, 4);
        let expected: HashSet<u32> = [0, 2, 4, 6].into_iter().collect();
        assert_eq!(levels, expected);
    }

    #[test]
    fn initial_updated_levels_covers_all_levels_when_height_is_dense() {
        let levels = initial_updated_levels(4, 16);
        let expected: HashSet<u32> = [0, 1, 2, 3].into_iter().collect();
        assert_eq!(levels, expected);
    }

    #[test]
    fn add_updated_level_clamps_oversized_sub_chunk_indices() {
        let mut chunk = Chunk::default();
        chunk.options = ChunkOptions {
            size: 16,
            max_height: 16,
            sub_chunks: u32::MAX as usize + 1,
        };

        chunk.add_updated_level(15);

        let expected_level = map_y_to_level(
            15,
            16,
            representable_level_count(u32::MAX as usize + 1),
        );
        assert!(chunk.updated_levels.contains(&expected_level));
    }

    #[test]
    fn add_updated_level_marks_adjacent_partitions_at_boundaries() {
        let mut chunk = Chunk::default();
        chunk.options = ChunkOptions {
            size: 16,
            max_height: 8,
            sub_chunks: 4,
        };

        chunk.add_updated_level(1);
        assert!(chunk.updated_levels.contains(&0));
        assert!(chunk.updated_levels.contains(&1));
    }
}
