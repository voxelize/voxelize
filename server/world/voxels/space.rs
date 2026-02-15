use std::sync::Arc;

use hashbrown::{HashMap, HashSet};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{ndarray, BlockUtils, ChunkUtils, LightUtils, Ndarray, Vec2, Vec3};

use super::{
    access::VoxelAccess,
    block::{BlockRotation, PY_ROTATION},
    chunks::Chunks,
};
const SMALL_SPACE_CHUNK_LOAD_LIMIT: usize = 4;

/// What kind of data does this space have/need?
#[derive(Default)]
pub struct SpaceData {
    pub needs_lights: bool,
    pub needs_voxels: bool,
    pub needs_height_maps: bool,
}

/// Parameters of constructing a Space data structure.
#[derive(Default, Clone)]
pub struct SpaceOptions {
    /// By how many blocks does the space extend from the center chunk.
    pub margin: usize,

    /// The horizontal dimension of each chunk.
    pub chunk_size: usize,

    /// The number of sub-chunks of each chunk.
    pub sub_chunks: usize,

    /// Maximum height of the chunk/space.
    pub max_height: usize,

    /// Maximum light of the voxelize world.
    pub max_light_level: u32,
}

/// A data structure used in Voxelize to access voxel data of multiple chunks at
/// the same time. Centered with one chunk, a Space allows developers to know what's
/// around a chunk.
///
/// Construct a space by calling `chunks.make_space`.
#[derive(Default, Clone)]
pub struct Space {
    /// Chunk coordinate of the center chunk of the space.
    pub coords: Vec2<i32>,

    /// Width of the space.
    pub width: usize,

    /// Shape of the space.
    pub shape: Vec3<usize>,

    /// Minimum voxel coordinate of the space.
    pub min: Vec3<i32>,

    /// Parameters to construct the space.
    pub options: SpaceOptions,

    /// A set of sub-chunks that have been updated.
    pub updated_levels: HashSet<u32>,

    /// A map of voxels, chunk coordinates -> n-dims array of voxels (Arc for cheap cloning).
    voxels: HashMap<Vec2<i32>, Arc<Ndarray<u32>>>,

    /// A map of lights, chunk coordinates -> n-dims array of lights (owned for mutation during light propagation).
    lights: HashMap<Vec2<i32>, Ndarray<u32>>,

    /// A map of height maps, chunk coordinates -> n-dims array of height maps (Arc for cheap cloning).
    height_maps: HashMap<Vec2<i32>, Arc<Ndarray<u32>>>,
}

impl Space {
    #[inline]
    fn chunk_size(&self) -> usize {
        self.options.chunk_size.max(1)
    }

    #[inline]
    fn max_height_i32(&self) -> Option<i32> {
        if self.options.max_height > i32::MAX as usize {
            None
        } else {
            Some(self.options.max_height as i32)
        }
    }

    #[inline]
    fn is_y_above_world_height(&self, vy: i32) -> bool {
        self.max_height_i32().is_some_and(|max_height| vy >= max_height)
    }

    #[inline]
    fn is_y_out_of_world_height(&self, vy: i32) -> bool {
        vy < 0 || self.is_y_above_world_height(vy)
    }

    #[inline]
    pub(crate) fn take_lights(&mut self, cx: i32, cz: i32) -> Option<Ndarray<u32>> {
        self.lights.remove(&Vec2(cx, cz))
    }
}

/// A data structure to build a space.
pub struct SpaceBuilder<'a> {
    pub chunks: &'a Chunks,
    pub coords: Vec2<i32>,
    pub options: SpaceOptions,

    pub needs_voxels: bool,
    pub needs_lights: bool,
    pub needs_height_maps: bool,

    pub strict: bool,
}

impl SpaceBuilder<'_> {
    /// Set this space to load in voxel data.
    pub fn needs_voxels(mut self) -> Self {
        self.needs_voxels = true;
        self
    }

    /// Set this space to load in lighting data.
    pub fn needs_lights(mut self) -> Self {
        self.needs_lights = true;
        self
    }

    /// Set this space to load in height map data.
    pub fn needs_height_maps(mut self) -> Self {
        self.needs_height_maps = true;
        self
    }

    /// Set this space to load in all voxel, lighting, and height map data.
    pub fn needs_all(mut self) -> Self {
        self.needs_voxels = true;
        self.needs_lights = true;
        self.needs_height_maps = true;
        self
    }

    /// Sets if this space is strict. If strict, space panics if one of the chunks DNE.
    pub fn strict(mut self) -> Self {
        self.strict = true;
        self
    }

    /// Create a `Space` instance with the instructed data loaded in.
    pub fn build(self) -> Space {
        let mut options = self.options;
        let margin = options.margin;
        let chunk_size = options.chunk_size.max(1);
        let max_height = options.max_height;
        options.chunk_size = chunk_size;

        let Vec2(cx, cz) = self.coords;

        if margin == 0 {
            panic!("Margin of 0 on Space is wasteful.");
        }

        let needs_voxels = self.needs_voxels;
        let needs_lights = self.needs_lights;
        let needs_height_maps = self.needs_height_maps;
        let strict = self.strict;

        let width = chunk_size.saturating_add(margin.saturating_mul(2));
        let (voxels, lights, height_maps): (HashMap<_, _>, HashMap<_, _>, HashMap<_, _>) =
            if let Some((min_x, max_x, min_z, max_z)) = self.chunks.light_traversed_bounds(&self.coords)
            {
                let width_x = (i64::from(max_x) - i64::from(min_x) + 1) as usize;
                let width_z = (i64::from(max_z) - i64::from(min_z) + 1) as usize;
                let traversed_count = width_x.saturating_mul(width_z);
                if traversed_count <= SMALL_SPACE_CHUNK_LOAD_LIMIT {
                    let mut voxels = if needs_voxels {
                        HashMap::with_capacity(traversed_count)
                    } else {
                        HashMap::new()
                    };
                    let mut lights = HashMap::with_capacity(traversed_count);
                    let mut height_maps = if needs_height_maps {
                        HashMap::with_capacity(traversed_count)
                    } else {
                        HashMap::new()
                    };
                    for x in min_x..=max_x {
                        for z in min_z..=max_z {
                            let n_coords = Vec2(x, z);
                            if let Some(chunk) = self.chunks.raw(&n_coords) {
                                if needs_voxels {
                                    voxels.insert(n_coords, Arc::clone(&chunk.voxels));
                                }
                                if needs_lights {
                                    lights.insert(n_coords, (*chunk.lights).clone());
                                } else {
                                    lights.insert(n_coords, ndarray(&chunk.lights.shape, 0));
                                }
                                if needs_height_maps {
                                    height_maps.insert(n_coords, Arc::clone(&chunk.height_map));
                                }
                            } else if strict {
                                panic!("Space incomplete in strict mode: {:?}", n_coords);
                            }
                        }
                    }
                    (voxels, lights, height_maps)
                } else {
                    (min_x..=max_x)
                        .into_par_iter()
                        .map(|x| {
                            let mut voxels = if needs_voxels {
                                HashMap::with_capacity(width_z)
                            } else {
                                HashMap::new()
                            };
                            let mut lights = HashMap::with_capacity(width_z);
                            let mut height_maps = if needs_height_maps {
                                HashMap::with_capacity(width_z)
                            } else {
                                HashMap::new()
                            };

                            for z in min_z..=max_z {
                                let n_coords = Vec2(x, z);
                                if let Some(chunk) = self.chunks.raw(&n_coords) {
                                    if needs_voxels {
                                        voxels.insert(n_coords, Arc::clone(&chunk.voxels));
                                    }
                                    if needs_lights {
                                        lights.insert(n_coords, (*chunk.lights).clone());
                                    } else {
                                        lights.insert(n_coords, ndarray(&chunk.lights.shape, 0));
                                    }
                                    if needs_height_maps {
                                        height_maps.insert(n_coords, Arc::clone(&chunk.height_map));
                                    }
                                } else if strict {
                                    panic!("Space incomplete in strict mode: {:?}", n_coords);
                                }
                            }

                            (voxels, lights, height_maps)
                        })
                        .reduce(
                            || {
                                (
                                    if needs_voxels {
                                        HashMap::with_capacity(traversed_count)
                                    } else {
                                        HashMap::new()
                                    },
                                    HashMap::with_capacity(traversed_count),
                                    if needs_height_maps {
                                        HashMap::with_capacity(traversed_count)
                                    } else {
                                        HashMap::new()
                                    },
                                )
                            },
                            |(mut voxels_acc, mut lights_acc, mut height_maps_acc),
                             (voxels, lights, height_maps)| {
                                voxels_acc.extend(voxels);
                                lights_acc.extend(lights);
                                height_maps_acc.extend(height_maps);
                                (voxels_acc, lights_acc, height_maps_acc)
                            },
                        )
                }
            } else {
                (HashMap::new(), HashMap::new(), HashMap::new())
            };

        let clamp_i64_to_i32 =
            |value: i64| value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
        let chunk_size_i64 = if chunk_size > i64::MAX as usize {
            i64::MAX
        } else {
            chunk_size as i64
        };
        let margin_i64 = if margin > i64::MAX as usize {
            i64::MAX
        } else {
            margin as i64
        };
        let min_x = i64::from(cx)
            .saturating_mul(chunk_size_i64)
            .saturating_sub(margin_i64);
        let min_z = i64::from(cz)
            .saturating_mul(chunk_size_i64)
            .saturating_sub(margin_i64);
        let min = Vec3(clamp_i64_to_i32(min_x), 0, clamp_i64_to_i32(min_z));

        let shape = Vec3(width, max_height, width);

        Space {
            coords: self.coords,
            options,

            width,
            shape,
            min,

            voxels,
            lights,
            height_maps,

            ..Default::default()
        }
    }
}

impl VoxelAccess for Space {
    /// Get the raw voxel data at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.voxels.is_empty() {
            panic!("Space does not contain voxel data.");
        }
        if self.is_y_out_of_world_height(vy) {
            return 0;
        }

        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        if let Some(voxels) = self.voxels.get(&coords) {
            let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);
            if !voxels.contains(&[lx, ly, lz]) {
                return 0;
            }

            return voxels[&[lx, ly, lz]];
        }

        0
    }

    /// Get the voxel type at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    /// Get the voxel rotation at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        if raw == 0 {
            return BlockRotation::encode(PY_ROTATION, 0);
        }

        BlockUtils::extract_rotation(raw)
    }

    /// Get the voxel stage at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    /// Get the raw light level at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain lighting data.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.lights.is_empty() {
            panic!("Space does not contain light data.");
        }

        if self.is_y_above_world_height(vy) {
            return LightUtils::insert_sunlight(0, self.options.max_light_level);
        } else if vy < 0 {
            return 0;
        }

        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        if let Some(lights) = self.lights.get(&coords) {
            let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);
            if !lights.contains(&[lx, ly, lz]) {
                return 0;
            }

            return lights[&[lx, ly, lz]];
        }

        0
    }

    /// Set the raw light level at the voxel position. Returns false if chunk doesn't exist.
    #[inline]
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if self.lights.is_empty() {
            panic!("Space does not contain light data.");
        }

        if self.is_y_out_of_world_height(vy) {
            return false;
        }

        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        if let Some(lights) = self.lights.get_mut(&coords) {
            let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);
            if !lights.contains(&[lx, ly, lz]) {
                return false;
            }
            if lights[&[lx, ly, lz]] == level {
                return true;
            }
            let sub_chunks = self.options.sub_chunks;
            if sub_chunks > 0 {
                let representable_level_count = (sub_chunks as u128).min(u128::from(u32::MAX) + 1);
                let max_level = representable_level_count.saturating_sub(1) as u32;
                let max_height = self.options.max_height as u128;
                let chunk_level = if max_height == 0 {
                    0
                } else {
                    (u128::from(vy as u32)
                        .saturating_mul(representable_level_count)
                        / max_height)
                        .min(max_level as u128) as u32
                };
                self.updated_levels.insert(chunk_level);
            }

            lights[&[lx, ly, lz]] = level;
            return true;
        }

        false
    }

    /// Get the sunlight level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.lights.is_empty() {
            panic!("Space does not contain light data.");
        }
        if vy < 0 {
            return 0;
        }
        if self.is_y_above_world_height(vy) {
            return self.options.max_light_level;
        }

        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        if let Some(lights) = self.lights.get(&coords) {
            let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);
            if lights.contains(&[lx, ly, lz]) {
                return LightUtils::extract_sunlight(lights[&[lx, ly, lz]]);
            }
        }

        self.options.max_light_level
    }

    /// Get the max height at the voxel column. Zero is returned if column doesn't exist.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if self.height_maps.is_empty() {
            panic!("Space does not contain height map data.");
        }
        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, 0, vz, chunk_size);
        if let Some(height_map) = self.height_maps.get(&coords) {
            let Vec3(lx, _, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, 0, vz, chunk_size);
            if !height_map.contains(&[lx, lz]) {
                return 0;
            }
            return height_map[&[lx, lz]];
        }

        0
    }

    /// Get a reference of lighting n-dimensional array.
    fn get_lights(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        self.lights.get(&Vec2(cx, cz))
    }

    /// Check if space contains this coordinate
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        if self.is_y_out_of_world_height(vy) {
            return false;
        }
        let chunk_size = self.chunk_size();
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let lights = self.lights.get(&coords);
        let voxels = self.voxels.get(&coords);
        let height_map = self.height_maps.get(&coords);
        if lights.is_none() && voxels.is_none() && height_map.is_none() {
            return false;
        }

        let Vec3(lx, ly, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);
        if let Some(lights) = lights {
            if lights.contains(&[lx, ly, lz]) {
                return true;
            }
        }
        if let Some(voxels) = voxels {
            if voxels.contains(&[lx, ly, lz]) {
                return true;
            }
        }
        if let Some(height_map) = height_map {
            if height_map.contains(&[lx, lz]) {
                return true;
            }
        }
        false
    }
}

impl voxelize_core::VoxelAccess for Space {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_voxel(self, vx, vy, vz)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_raw_voxel(self, vx, vy, vz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        VoxelAccess::get_voxel_rotation(self, vx, vy, vz)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_voxel_stage(self, vx, vy, vz)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_sunlight(self, vx, vy, vz)
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: voxelize_core::LightColor) -> u32 {
        match color {
            voxelize_core::LightColor::Red => VoxelAccess::get_red_light(self, vx, vy, vz),
            voxelize_core::LightColor::Green => VoxelAccess::get_green_light(self, vx, vy, vz),
            voxelize_core::LightColor::Blue => VoxelAccess::get_blue_light(self, vx, vy, vz),
            voxelize_core::LightColor::Sunlight => VoxelAccess::get_sunlight(self, vx, vy, vz),
        }
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        let raw = VoxelAccess::get_raw_light(self, vx, vy, vz);
        LightUtils::extract_all(raw)
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        VoxelAccess::get_max_height(self, vx, vz)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        VoxelAccess::contains(self, vx, vy, vz)
    }
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;

    use super::{Space, SpaceOptions};
    use crate::{ndarray, Vec2, Vec3, VoxelAccess};

    fn test_space_with_sub_chunks(sub_chunks: usize) -> Space {
        let mut lights = HashMap::new();
        lights.insert(Vec2(0, 0), ndarray(&[16, 16, 16], 0));
        Space {
            coords: Vec2(0, 0),
            width: 16,
            shape: Vec3(16, 16, 16),
            min: Vec3(0, 0, 0),
            options: SpaceOptions {
                margin: 1,
                chunk_size: 16,
                sub_chunks,
                max_height: 16,
                max_light_level: 15,
            },
            lights,
            ..Default::default()
        }
    }

    #[test]
    fn set_raw_light_handles_sub_chunk_count_above_u32_range() {
        let mut space = test_space_with_sub_chunks(u32::MAX as usize + 1);

        assert!(space.set_raw_light(0, 0, 0, 1));
        assert!(space.updated_levels.contains(&0));
    }

    #[test]
    fn set_raw_light_clamps_dense_sub_chunk_levels_to_u32_range() {
        let mut space = test_space_with_sub_chunks(usize::MAX);

        assert!(space.set_raw_light(0, 15, 0, 1));
        let level = *space
            .updated_levels
            .iter()
            .next()
            .expect("expected updated level");
        assert_eq!(level, 4_026_531_840);
    }

    #[test]
    fn set_raw_light_normalizes_zero_chunk_size() {
        let mut space = test_space_with_sub_chunks(1);
        space.options.chunk_size = 0;

        assert!(space.set_raw_light(0, 0, 0, 1));
    }

    #[test]
    fn take_lights_moves_light_array_out_of_space() {
        let mut space = test_space_with_sub_chunks(1);

        let lights = space.take_lights(0, 0).expect("missing test lights");
        assert_eq!(lights.shape, vec![16, 16, 16]);
        assert!(space.get_lights(0, 0).is_none());
    }
}

impl voxelize_lighter::LightVoxelAccess for Space {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_raw_voxel(self, vx, vy, vz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        VoxelAccess::get_voxel_rotation(self, vx, vy, vz)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_voxel_stage(self, vx, vy, vz)
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelAccess::get_raw_light(self, vx, vy, vz)
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        VoxelAccess::set_raw_light(self, vx, vy, vz, level)
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        VoxelAccess::get_max_height(self, vx, vz)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        VoxelAccess::contains(self, vx, vy, vz)
    }
}
