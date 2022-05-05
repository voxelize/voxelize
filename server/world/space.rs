use hashbrown::HashMap;
use log::info;

use crate::utils::{
    block_utils::BlockUtils,
    chunk_utils::ChunkUtils,
    light_utils::{LightColor, LightUtils},
    ndarray::{ndarray, Ndarray},
    vec::{Vec2, Vec3},
};

use super::{
    access::VoxelAccess,
    block::{BlockRotation, PY_ROTATION, Y_000_ROTATION},
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
pub struct SpaceParams {
    /// By how many blocks does the space extend from the center chunk.
    pub margin: usize,

    /// The horizontal dimension of each chunk.
    pub chunk_size: usize,

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
    pub params: SpaceParams,

    /// A map of voxels, chunk coordinates -> n-dims array of voxels.
    voxels: HashMap<Vec2<i32>, Ndarray<u32>>,

    /// A map of lights, chunk coordinates -> n-dims array of lights.
    lights: HashMap<Vec2<i32>, Ndarray<u32>>,

    /// A map of height maps, chunk coordinates -> n-dims array of height maps.
    height_maps: HashMap<Vec2<i32>, Ndarray<u32>>,
}

impl Space {
    /// Check if space contains this coordinate
    pub fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let (coords, _) = self.to_local(vx, vy, vz);

        vy >= 0
            && vy < self.params.max_height as i32
            && (self.lights.contains_key(&coords)
                || self.voxels.contains_key(&coords)
                || self.height_maps.contains_key(&coords))
    }

    /// Converts a voxel position to a chunk coordinate and a chunk local coordinate.
    fn to_local(&self, vx: i32, vy: i32, vz: i32) -> (Vec2<i32>, Vec3<usize>) {
        let SpaceParams { chunk_size, .. } = self.params;

        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let local = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        (coords, local)
    }
}

/// A data structure to build a space.
pub struct SpaceBuilder<'a> {
    pub chunks: &'a Chunks,
    pub coords: Vec2<i32>,
    pub params: SpaceParams,

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
        let SpaceParams {
            margin,
            chunk_size,
            max_height,
            ..
        } = self.params;

        let Vec2(cx, cz) = self.coords;

        if margin <= 0 {
            panic!("Margin of 0 on Space is wasteful.");
        }

        let width = chunk_size + margin * 2;

        let mut voxels = HashMap::<Vec2<i32>, Ndarray<u32>>::new();
        let mut lights = HashMap::<Vec2<i32>, Ndarray<u32>>::new();
        let mut height_maps = HashMap::<Vec2<i32>, Ndarray<u32>>::new();

        self.chunks
            .light_traversed_chunks(&self.coords)
            .into_iter()
            .for_each(|n_coords| {
                if !self.chunks.is_within_world(&n_coords) {
                    return;
                }

                if let Some(chunk) = self.chunks.raw(&n_coords) {
                    if self.needs_voxels {
                        voxels.insert(n_coords.to_owned(), chunk.voxels.clone());
                    }

                    if self.needs_lights {
                        lights.insert(n_coords.to_owned(), chunk.lights.clone());
                    } else {
                        lights.insert(n_coords.to_owned(), ndarray(&chunk.lights.shape, 0));
                    }

                    if self.needs_height_maps {
                        height_maps.insert(n_coords.to_owned(), chunk.height_map.clone());
                    }
                } else if self.strict {
                    panic!("Space incomplete in strict mode: {:?}", n_coords);
                }
            });

        let min = Vec3(
            cx * chunk_size as i32 - margin as i32,
            0,
            cz * chunk_size as i32 - margin as i32,
        );

        let shape = Vec3(width, max_height, width);

        Space {
            coords: self.coords.to_owned(),
            params: self.params.to_owned(),

            width,
            shape,
            min,

            voxels,
            lights,
            height_maps,
        }
    }
}

impl VoxelAccess for Space {
    /// Get the raw voxel data at the voxel position. Zero is returned if chunk doesn't exist.
    /// Panics if space does not contain voxel data.
    #[inline]
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
            return BlockRotation::encode(PY_ROTATION, Y_000_ROTATION);
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
    #[inline]
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.lights.is_empty() {
            panic!("Space does not contain voxel data.");
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
                self.params.max_light_level
            };
        }

        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    /// Set the sunlight level at the voxel position. Returns false if chunk doesn't exist.
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_sunlight(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the red light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the red light level at the voxel position. Returns false if chunk doesn't exist.
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_red_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the green light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the green light level at the voxel position. Returns false if chunk doesn't exist.
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_green_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the blue light level at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    /// Set the blue light level at the voxel position. Returns false if chunk doesn't exist.
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_blue_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    /// Get the torch light level of a color at the voxel position. Zero is returned if chunk doesn't exist.
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }

    /// Set the torch light level of a color at the voxel position. Returns false if chunk doesn't exist.
    fn set_torch_light(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
        level: u32,
        color: &LightColor,
    ) -> bool {
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
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
}
