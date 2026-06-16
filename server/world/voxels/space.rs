use std::sync::Arc;

use hashbrown::HashSet;
use rayon::iter::{IntoParallelIterator, ParallelIterator};

use crate::{ndarray, BlockUtils, LightUtils, Ndarray, Vec2, Vec3};

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
///
/// The neighboring chunks are stored in flat, contiguous grids indexed by their
/// integer offset from `grid_min` (rather than a hash map keyed by chunk
/// coordinate). Combined with branch-free integer coordinate decomposition, this
/// turns the per-voxel access that dominates light propagation into a couple of
/// array indexes, eliminating the per-access hashing and floating-point math.
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

    /// Minimum chunk coordinate covered by the flat grids.
    grid_min: Vec2<i32>,

    /// Grid dimensions, in chunks, along the x and z axes.
    grid_w: usize,
    grid_d: usize,

    /// Voxels of each grid cell (Arc for cheap cloning). `None` if not loaded.
    voxels: Vec<Option<Arc<Ndarray<u32>>>>,

    /// Lights of each grid cell (owned for mutation during light propagation).
    lights: Vec<Option<Ndarray<u32>>>,

    /// Height maps of each grid cell (Arc for cheap cloning).
    height_maps: Vec<Option<Arc<Ndarray<u32>>>>,

    /// Whether any voxel/light/height-map data was loaded for this space.
    has_voxels: bool,
    has_lights: bool,
    has_height_maps: bool,
}

impl Space {
    /// Flat grid index for a chunk coordinate, or `None` if it lies outside the grid.
    #[inline]
    fn chunk_index(&self, cx: i32, cz: i32) -> Option<usize> {
        let dx = cx.wrapping_sub(self.grid_min.0) as usize;
        let dz = cz.wrapping_sub(self.grid_min.1) as usize;

        if dx >= self.grid_w || dz >= self.grid_d {
            return None;
        }

        Some(dx + dz * self.grid_w)
    }

    /// Decompose a voxel position into its chunk coordinate and chunk-local
    /// coordinate using integer arithmetic.
    #[inline]
    fn to_local(&self, vx: i32, vy: i32, vz: i32) -> (i32, i32, usize, usize, usize) {
        let cs = self.options.chunk_size as i32;

        let cx = vx.div_euclid(cs);
        let cz = vz.div_euclid(cs);

        let lx = (vx - cx * cs) as usize;
        let lz = (vz - cz * cs) as usize;

        (cx, cz, lx, vy as usize, lz)
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

        let loaded: Vec<(Vec2<i32>, Option<Arc<Ndarray<u32>>>, Ndarray<u32>, Option<Arc<Ndarray<u32>>>)> =
            self.chunks
                .light_traversed_chunks(&self.coords)
                .into_par_iter()
                .filter_map(|n_coords| {
                    if !self.chunks.is_within_world(&n_coords) {
                        return None;
                    }

                    if let Some(chunk) = self.chunks.raw(&n_coords) {
                        let voxels = if self.needs_voxels {
                            Some(Arc::clone(&chunk.voxels))
                        } else {
                            None
                        };

                        let lights = if self.needs_lights {
                            (*chunk.lights).clone()
                        } else {
                            ndarray(&chunk.lights.shape, 0)
                        };

                        let height_maps = if self.needs_height_maps {
                            Some(Arc::clone(&chunk.height_map))
                        } else {
                            None
                        };

                        Some((n_coords, voxels, lights, height_maps))
                    } else if self.strict {
                        panic!("Space incomplete in strict mode: {:?}", n_coords);
                    } else {
                        None
                    }
                })
                .collect();

        // Bound the flat grids tightly around the chunks that were actually
        // loaded, then scatter each chunk's data into its grid slot.
        let mut grid_min = Vec2(i32::MAX, i32::MAX);
        let mut grid_max = Vec2(i32::MIN, i32::MIN);
        for (coords, ..) in &loaded {
            grid_min.0 = grid_min.0.min(coords.0);
            grid_min.1 = grid_min.1.min(coords.1);
            grid_max.0 = grid_max.0.max(coords.0);
            grid_max.1 = grid_max.1.max(coords.1);
        }

        let (grid_min, grid_w, grid_d) = if loaded.is_empty() {
            (Vec2(0, 0), 0, 0)
        } else {
            let w = (grid_max.0 - grid_min.0 + 1) as usize;
            let d = (grid_max.1 - grid_min.1 + 1) as usize;
            (grid_min, w, d)
        };

        let cells = grid_w * grid_d;
        let mut voxels = vec![None; cells];
        let mut lights = vec![None; cells];
        let mut height_maps = vec![None; cells];

        let has_voxels = self.needs_voxels && !loaded.is_empty();
        let has_lights = !loaded.is_empty();
        let has_height_maps = self.needs_height_maps && !loaded.is_empty();

        for (coords, chunk_voxels, chunk_lights, chunk_height_maps) in loaded {
            let dx = (coords.0 - grid_min.0) as usize;
            let dz = (coords.1 - grid_min.1) as usize;
            let index = dx + dz * grid_w;

            voxels[index] = chunk_voxels;
            lights[index] = Some(chunk_lights);
            height_maps[index] = chunk_height_maps;
        }

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

            grid_min,
            grid_w,
            grid_d,

            voxels,
            lights,
            height_maps,

            has_voxels,
            has_lights,
            has_height_maps,

            ..Default::default()
        }
    }
}

impl VoxelAccess for Space {
    /// Get the raw voxel data at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.has_voxels {
            panic!("Space does not contain voxel data.");
        }

        let (cx, cz, lx, ly, lz) = self.to_local(vx, vy, vz);

        if let Some(index) = self.chunk_index(cx, cz) {
            if let Some(voxels) = &self.voxels[index] {
                if !voxels.contains(&[lx, ly, lz]) {
                    return 0;
                }

                return voxels[&[lx, ly, lz]];
            }
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
        if !self.has_lights {
            panic!("Space does not contain light data.");
        }

        if vy > 0 && vy as usize >= self.options.max_height {
            return LightUtils::insert_sunlight(0, self.options.max_light_level);
        } else if vy < 0 {
            return 0;
        }

        let (cx, cz, lx, ly, lz) = self.to_local(vx, vy, vz);

        if let Some(index) = self.chunk_index(cx, cz) {
            if let Some(lights) = &self.lights[index] {
                if !lights.contains(&[lx, ly, lz]) {
                    return 0;
                }

                return lights[&[lx, ly, lz]];
            }
        }

        0
    }

    /// Set the raw light level at the voxel position. Returns false if chunk doesn't exist.
    #[inline]
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if !self.has_lights {
            panic!("Space does not contain light data.");
        }

        if vy < 0 || vy >= self.options.max_height as i32 {
            return false;
        }

        let (cx, cz, lx, ly, lz) = self.to_local(vx, vy, vz);

        let Some(index) = self.chunk_index(cx, cz) else {
            return false;
        };

        if let Some(lights) = &mut self.lights[index] {
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
        if !self.has_height_maps {
            panic!("Space does not contain height map data.");
        }

        let (cx, cz, lx, _, lz) = self.to_local(vx, 0, vz);

        if let Some(index) = self.chunk_index(cx, cz) {
            if let Some(height_map) = &self.height_maps[index] {
                return height_map[&[lx, lz]];
            }
        }

        0
    }

    /// Get a reference of lighting n-dimensional array.
    fn get_lights(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        self.chunk_index(cx, cz)
            .and_then(|index| self.lights[index].as_ref())
    }

    /// Check if space contains this coordinate
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        if vy < 0 || vy >= self.options.max_height as i32 {
            return false;
        }

        let (cx, cz, ..) = self.to_local(vx, vy, vz);

        self.chunk_index(cx, cz)
            .map(|index| {
                self.lights[index].is_some()
                    || self.voxels[index].is_some()
                    || self.height_maps[index].is_some()
            })
            .unwrap_or(false)
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
