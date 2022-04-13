use hashbrown::HashMap;

use crate::utils::{
    block::BlockUtils,
    chunk::ChunkUtils,
    light::{LightColor, LightUtils},
    ndarray::Ndarray,
    vec::{Vec2, Vec3},
};

use super::{block::BlockRotation, chunks::Chunks};

#[derive(Default, Clone)]
pub struct SpaceParams {
    margin: usize,
    chunk_size: usize,
    max_height: usize,
}

#[derive(Default)]
pub struct Space {
    pub coords: Vec2<i32>,
    pub width: usize,
    pub shape: Vec3<usize>,
    pub min: Vec3<i32>,

    pub params: SpaceParams,

    voxels: HashMap<Vec2<i32>, Ndarray<u32>>,
    lights: HashMap<Vec2<i32>, Ndarray<u32>>,
    height_maps: HashMap<Vec2<i32>, Ndarray<u32>>,
}

impl Space {
    pub fn new<'a>(
        chunks: &'a Chunks,
        coords: Vec2<i32>,
        params: &'a SpaceParams,
    ) -> SpaceBuilder<'a> {
        SpaceBuilder {
            chunks,
            coords,
            params: params.to_owned(),
            needs_voxels: false,
            needs_lights: false,
            needs_height_maps: false,
        }
    }

    #[inline]
    pub fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.voxels.is_empty() {
            panic!("Space does not contain voxel data.");
        }

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(voxels) = self.voxels.get(&coords) {
            return voxels[&[lx, ly, lz]];
        }

        0
    }

    pub fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    pub fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    pub fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    #[inline]
    pub fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.lights.is_empty() {
            panic!("Space does not contain voxel data.");
        }

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(lights) = self.lights.get(&coords) {
            return lights[&[lx, ly, lz]];
        }

        0
    }

    #[inline]
    pub fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        if self.lights.is_empty() {
            panic!("Space does not contain voxel data.");
        }

        let (coords, Vec3(lx, ly, lz)) = self.to_local(vx, vy, vz);

        if let Some(lights) = self.lights.get_mut(&coords) {
            lights[&[lx, ly, lz]] = level;
        }
    }

    pub fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    pub fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_sunlight(self.get_raw_light(vx, vy, vz), level),
        );
    }

    pub fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    pub fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_red_light(self.get_raw_light(vx, vy, vz), level),
        );
    }

    pub fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    pub fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_green_light(self.get_raw_light(vx, vy, vz), level),
        );
    }

    pub fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    pub fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_blue_light(self.get_raw_light(vx, vy, vz), level),
        );
    }

    pub fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }

    pub fn set_torch_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32, color: &LightColor) {
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        };
    }

    pub fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if self.height_maps.is_empty() {
            panic!("Space does not contain height map data.");
        }

        let (coords, Vec3(lx, _, lz)) = self.to_local(vx, 0, vz);

        if let Some(height_map) = self.height_maps.get(&coords) {
            return height_map[&[lx, lz]];
        }

        0
    }

    fn to_local(&self, vx: i32, vy: i32, vz: i32) -> (Vec2<i32>, Vec3<usize>) {
        let SpaceParams {
            chunk_size,
            max_height,
            ..
        } = self.params;

        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let local = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        return (coords, local);
    }
}

pub struct SpaceBuilder<'a> {
    chunks: &'a Chunks,
    coords: Vec2<i32>,
    params: SpaceParams,

    needs_voxels: bool,
    needs_lights: bool,
    needs_height_maps: bool,
}

impl SpaceBuilder<'_> {
    pub fn needs_voxels(mut self) -> Self {
        self.needs_voxels = true;
        self
    }

    pub fn needs_lights(mut self) -> Self {
        self.needs_lights = true;
        self
    }

    pub fn needs_height_maps(mut self) -> Self {
        self.needs_height_maps = true;
        self
    }

    pub fn needs_all(mut self) -> Self {
        self.needs_voxels = true;
        self.needs_lights = true;
        self.needs_height_maps = true;
        self
    }

    pub fn build(self) -> Space {
        let SpaceParams {
            margin,
            chunk_size,
            max_height,
        } = self.params;

        let Self {
            needs_voxels,
            needs_lights,
            needs_height_maps,
            ..
        } = self;

        let Vec2(cx, cz) = self.coords;

        if margin <= 0 {
            panic!("Margin of 0 on Space is wasteful.");
        }

        let extended = (margin as f32 / chunk_size as f32).ceil() as i32;
        let width = chunk_size + margin * 2;

        let mut voxels = HashMap::<Vec2<i32>, Ndarray<u32>>::new();
        let mut lights = HashMap::<Vec2<i32>, Ndarray<u32>>::new();
        let mut height_maps = HashMap::<Vec2<i32>, Ndarray<u32>>::new();

        for x in -extended..=extended {
            for z in -extended..=extended {
                let n_coords = Vec2(cx + x, cz + z);
                let chunk = self
                    .chunks
                    .get_chunk(&n_coords)
                    .unwrap_or_else(|| panic!("Space incomplete!"));

                if self.needs_voxels {
                    voxels.insert(n_coords.to_owned(), chunk.voxels.clone());
                }

                if self.needs_lights {
                    lights.insert(n_coords.to_owned(), chunk.lights.clone());
                }

                if self.needs_height_maps {
                    height_maps.insert(n_coords.to_owned(), chunk.height_map.clone());
                }
            }
        }

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
