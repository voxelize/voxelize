use crate::{
    server::models::{Chunk as ChunkModel, Mesh},
    utils::{
        block_utils::BlockUtils,
        chunk_utils::ChunkUtils,
        light_utils::{LightColor, LightUtils},
        ndarray::Ndarray,
        vec::{Vec2, Vec3},
    },
};

use super::{access::VoxelAccess, block::BlockRotation, registry::Registry};

#[derive(Default, Clone)]
pub struct ChunkParams {
    pub size: usize,
    pub max_height: usize,
}

#[derive(Default, Clone)]
pub struct Chunk {
    pub id: String,
    pub name: String,
    pub coords: Vec2<i32>,
    pub stage: Option<usize>,

    pub voxels: Ndarray<u32>,
    pub lights: Ndarray<u32>,
    pub height_map: Ndarray<u32>,

    pub mesh: Option<Mesh>,

    pub min: Vec3<i32>,
    pub max: Vec3<i32>,

    pub params: ChunkParams,
}

impl Chunk {
    pub fn new(id: &str, cx: i32, cz: i32, params: &ChunkParams) -> Self {
        let ChunkParams { size, max_height } = *params;

        let voxels = Ndarray::new(&[size, max_height, size], 0);
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
            stage: Some(0),

            mesh: None,

            voxels,
            lights,
            height_map,

            min,
            max,

            params: params.to_owned(),
        }
    }

    /// Calculate the height map of this chunk.
    pub fn calculate_max_height(&mut self, registry: &Registry) {
        let Vec3(min_x, _, min_z) = self.min;
        let Vec3(max_x, _, max_z) = self.max;

        let max_height = self.params.max_height as i32;

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

    /// Check if chunk contains this voxel coordinate.
    pub fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let ChunkParams { size, max_height } = self.params;
        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);

        lx < size && ly < max_height && lz < size
    }

    /// Convert chunk to protocol model.
    pub fn to_model(&self) -> ChunkModel {
        ChunkModel {
            x: self.coords.0,
            z: self.coords.1,
            id: self.id.clone(),
            mesh: self.mesh.to_owned(),
            voxels: Some(self.voxels.to_owned()),
            lights: Some(self.lights.to_owned()),
            height_map: Some(self.height_map.to_owned()),
        }
    }

    /// Get the red light value locally.
    #[inline]
    fn get_local_red_light(&self, lx: usize, ly: usize, lz: usize) -> u32 {
        LightUtils::extract_red_light(self.lights[&[lx, ly, lz]])
    }

    /// Set the red light value locally.
    #[inline]
    fn set_local_red_light(&mut self, lx: usize, ly: usize, lz: usize, level: u32) {
        self.lights[&[lx, ly, lz]] =
            LightUtils::insert_red_light(self.lights[&[lx, ly, lz]], level);
    }

    /// Get the green light value locally.
    #[inline]
    fn get_local_green_light(&self, lx: usize, ly: usize, lz: usize) -> u32 {
        LightUtils::extract_green_light(self.lights[&[lx, ly, lz]])
    }

    /// Set the green light value locally.
    #[inline]
    fn set_local_green_light(&mut self, lx: usize, ly: usize, lz: usize, level: u32) {
        self.lights[&[lx, ly, lz]] =
            LightUtils::insert_green_light(self.lights[&[lx, ly, lz]], level);
    }

    /// Get the blue light value locally.
    #[inline]
    fn get_local_blue_light(&self, lx: usize, ly: usize, lz: usize) -> u32 {
        LightUtils::extract_blue_light(self.lights[&[lx, ly, lz]])
    }

    /// Set the blue light value locally.
    #[inline]
    fn set_local_blue_light(&mut self, lx: usize, ly: usize, lz: usize, level: u32) {
        self.lights[&[lx, ly, lz]] =
            LightUtils::insert_blue_light(self.lights[&[lx, ly, lz]], level);
    }

    /// Get the sunlight value locally.
    #[inline]
    fn get_local_sunlight(&self, lx: usize, ly: usize, lz: usize) -> u32 {
        LightUtils::extract_sunlight(self.lights[&[lx, ly, lz]])
    }

    /// Set the sunlight value locally.
    #[inline]
    fn set_local_sunlight(&mut self, lx: usize, ly: usize, lz: usize, level: u32) {
        self.lights[&[lx, ly, lz]] = LightUtils::insert_sunlight(self.lights[&[lx, ly, lz]], level);
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
    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, val: u32) {
        if !self.contains(vx, vy, vz) {
            return;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.voxels[&[lx, ly, lz]] = val;
    }

    /// Get a voxel type within chunk by voxel coordinates.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set a voxel to type within chunk by voxel coordinates.
    ///
    /// Note: This clears the rotation and stage.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) {
        let value = BlockUtils::insert_id(0, id);
        self.set_raw_voxel(vx, vy, vz, value);
    }

    /// Get a voxel rotation within chunk by voxel coordinates.
    ///
    /// Panics if it's outside of chunk.
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if !self.contains(vx, vy, vz) {
            return BlockRotation::PX(0);
        }

        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set a voxel to rotation within chunk by voxel coordinates.
    ///
    /// Panics if the coordinates are outside of chunk.
    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) {
        let value = BlockUtils::insert_rotation(self.get_raw_voxel(vx, vy, vz), rotation);
        self.set_raw_voxel(vx, vy, vz, value);
    }

    /// Get a voxel stage within chunk by voxel coordinates.
    ///
    /// Panics if it's outside of chunk.
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set a voxel stage within chunk by voxel coordinates.
    ///
    /// Panics if it's outside of chunk.
    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) {
        let value = BlockUtils::insert_stage(self.get_raw_voxel(vx, vy, vz), stage);
        self.set_raw_voxel(vx, vy, vz, value);
    }

    /// Get the red light value for voxel by voxel coordinates.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.get_local_red_light(lx as usize, ly as usize, lz as usize)
    }

    /// Set the red light value for voxel by voxel coordinates.
    ///
    /// Panics if it's outside of the chunk.
    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if !self.contains(vx, vy, vz) {
            return;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.set_local_red_light(lx as usize, ly as usize, lz as usize, level);
    }

    /// Get the green light value for voxel by voxel coordinates.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.get_local_green_light(lx as usize, ly as usize, lz as usize)
    }

    /// Set the green light value for voxel by voxel coordinates.
    ///
    /// Panics if it's outside of the chunk.
    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if !self.contains(vx, vy, vz) {
            return;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.set_local_green_light(lx as usize, ly as usize, lz as usize, level);
    }

    /// Get the blue light value for voxel by voxel coordinates.
    ///
    /// Returns 0 if it's outside of the chunk.
    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.get_local_blue_light(lx as usize, ly as usize, lz as usize)
    }

    /// Set the blue light value for voxel by voxel coordinates.
    ///
    /// Panics if it's outside of the chunk.
    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if !self.contains(vx, vy, vz) {
            return;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.set_local_blue_light(lx as usize, ly as usize, lz as usize, level);
    }

    /// Get the torch light value for voxel by voxel coordinates by color.
    ///
    /// Returns 0 if it's outside of the chunk.
    #[inline]
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }

    /// Set the torch light value for voxel by voxel coordinates by color>
    ///
    /// Panics if it's outside of the chunk.
    #[inline]
    fn set_torch_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32, color: &LightColor) {
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Setting torch light of Sunlight!"),
        }
    }

    /// Get the sunlight value for voxel by voxel coordinates.
    ///
    /// Returns 0 if it's not within the chunk.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if !self.contains(vx, vy, vz) {
            return 0;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.get_local_sunlight(lx as usize, ly as usize, lz as usize)
    }

    /// Set the sunlight value for voxel by voxel coordinates.
    ///
    /// Panics if it's outside of the chunk.
    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if !self.contains(vx, vy, vz) {
            return;
        }

        let Vec3(lx, ly, lz) = self.to_local(vx, vy, vz);
        self.set_local_sunlight(lx as usize, ly as usize, lz as usize, level)
    }

    /// Get the max height of a voxel column.
    ///
    /// Returns `max_height` if it's not within the chunk.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if !self.contains(vx, 0, vz) {
            return self.params.max_height as u32;
        }

        let Vec3(lx, _, lz) = self.to_local(vx, 0, vz);
        self.height_map[&[lx as usize, lz as usize]]
    }

    /// Set the max height of a voxel column.
    ///
    /// Panics if it's not within the chunk.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) {
        if !self.contains(vx, 0, vz) {
            return;
        }

        let Vec3(lx, _, lz) = self.to_local(vx, 0, vz);
        self.height_map[&[lx as usize, lz as usize]] = height;
    }
}
