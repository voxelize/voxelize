use std::sync::Arc;

use hashbrown::{HashMap, HashSet};
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{ndarray, BlockUtils, ChunkUtils, LightUtils, Ndarray, Vec2, Vec3};

use super::{
    access::VoxelAccess,
    block::{BlockRotation, PY_ROTATION},
    chunks::Chunks,
};

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
    /// Converts a voxel position to a chunk coordinate and a chunk local coordinate.
    fn to_local(&self, vx: i32, vy: i32, vz: i32) -> (Vec2<i32>, Vec3<usize>) {
        let SpaceOptions { chunk_size, .. } = self.options;

        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let local = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        (coords, local)
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
        let SpaceOptions {
            margin,
            chunk_size,
            max_height,
            ..
        } = self.options;

        let Vec2(cx, cz) = self.coords;

        if margin == 0 {
            panic!("Margin of 0 on Space is wasteful.");
        }

        let width = chunk_size + margin * 2;

        let (voxels, lights, height_maps): (HashMap<_, _>, HashMap<_, _>, HashMap<_, _>) = self
            .chunks
            .light_traversed_chunks(&self.coords)
            .into_par_iter()
            .filter_map(|n_coords| {
                if !self.chunks.is_within_world(&n_coords) {
                    return None;
                }

                if let Some(chunk) = self.chunks.raw(&n_coords) {
                    let voxels = if self.needs_voxels {
                        Some((n_coords.clone(), Arc::clone(&chunk.voxels)))
                    } else {
                        None
                    };

                    let lights = if self.needs_lights {
                        Some((n_coords.clone(), (*chunk.lights).clone()))
                    } else {
                        Some((n_coords.clone(), ndarray(&chunk.lights.shape, 0)))
                    };

                    let height_maps = if self.needs_height_maps {
                        Some((n_coords.clone(), Arc::clone(&chunk.height_map)))
                    } else {
                        None
                    };

                    Some((voxels, lights, height_maps))
                } else if self.strict {
                    panic!("Space incomplete in strict mode: {:?}", n_coords);
                } else {
                    None
                }
            })
            .fold(
                || (HashMap::new(), HashMap::new(), HashMap::new()),
                |(mut voxels_acc, mut lights_acc, mut height_maps_acc),
                 (voxels, lights, height_maps)| {
                    if let Some(voxel) = voxels {
                        voxels_acc.insert(voxel.0, voxel.1);
                    }
                    if let Some(light) = lights {
                        lights_acc.insert(light.0, light.1);
                    }
                    if let Some(height_map) = height_maps {
                        height_maps_acc.insert(height_map.0, height_map.1);
                    }
                    (voxels_acc, lights_acc, height_maps_acc)
                },
            )
            .reduce(
                || (HashMap::new(), HashMap::new(), HashMap::new()),
                |(mut voxels_acc, mut lights_acc, mut height_maps_acc),
                 (voxels, lights, height_maps)| {
                    voxels_acc.extend(voxels);
                    lights_acc.extend(lights);
                    height_maps_acc.extend(height_maps);
                    (voxels_acc, lights_acc, height_maps_acc)
                },
            );

        let min = Vec3(
            cx * chunk_size as i32 - margin as i32,
            0,
            cz * chunk_size as i32 - margin as i32,
        );

        let shape = Vec3(width, max_height, width);

        Space {
            coords: self.coords,
            options: self.options,

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

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(voxels) = self.voxels.get(&coords) {
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
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    /// Get the voxel rotation at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if !self.contains(vx, vy, vz) {
            return BlockRotation::encode(PY_ROTATION, 0);
        }

        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    /// Get the voxel stage at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    /// Get the raw light level at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain lighting data.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.lights.is_empty() {
            panic!("Space does not contain light data.");
        }

        if vy > 0 && vy as usize >= self.options.max_height {
            return LightUtils::insert_sunlight(0, self.options.max_light_level);
        } else if vy < 0 {
            return 0;
        }

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(lights) = self.lights.get(&coords) {
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

        if !self.contains(vx, vy, vz) {
            return false;
        }

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(lights) = self.lights.get_mut(&coords) {
            let chunk_level =
                vy as u32 / (self.options.max_height / self.options.sub_chunks) as u32;
            self.updated_levels.insert(chunk_level);

            lights[&[lx, ly, lz]] = level;
            return true;
        }

        false
    }

    /// Get the sunlight level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return if vy < 0 {
                0
            } else {
                self.options.max_light_level
            };
        }

        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    /// Get the max height at the voxel column. Zero is returned if column doesn't exist.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if self.height_maps.is_empty() {
            panic!("Space does not contain height map data.");
        }

        if !self.contains(vx, 0, vz) {
            return 0;
        }

        let (coords, Vec3(lx, _, lz)) = self.to_local(vx, 0, vz);

        if let Some(height_map) = self.height_maps.get(&coords) {
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
        let (coords, _) = self.to_local(vx, vy, vz);

        vy >= 0
            && vy < self.options.max_height as i32
            && (self.lights.contains_key(&coords)
                || self.voxels.contains_key(&coords)
                || self.height_maps.contains_key(&coords))
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
