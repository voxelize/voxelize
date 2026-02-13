use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

use voxelize_core::{
    BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockRuleLogic, CornerData,
    LightColor, LightUtils, VoxelAccess, AABB, UV,
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: u32,
    pub name: String,
    #[serde(skip)]
    pub name_lower: String,
    #[serde(skip, default)]
    pub cache_ready: bool,
    pub rotatable: bool,
    pub y_rotatable: bool,
    pub is_empty: bool,
    pub is_fluid: bool,
    pub is_waterlogged: bool,
    pub is_opaque: bool,
    pub is_see_through: bool,
    pub is_transparent: [bool; 6],
    #[serde(skip, default)]
    pub is_all_transparent: bool,
    #[serde(skip, default = "default_greedy_face_indices")]
    pub greedy_face_indices: [i16; 6],
    #[serde(skip, default)]
    pub has_standard_six_faces: bool,
    #[serde(skip, default)]
    pub fluid_face_uvs: Option<[UV; 6]>,
    #[serde(skip, default)]
    pub has_diagonal_faces: bool,
    #[serde(skip, default)]
    pub is_full_cube_cached: bool,
    #[serde(skip, default)]
    pub has_mixed_diagonal_and_cardinal: bool,
    #[serde(skip, default)]
    pub greedy_mesh_eligible_no_rotation: bool,
    pub transparent_standalone: bool,
    #[serde(default)]
    pub occludes_fluid: bool,
    pub faces: Vec<BlockFace>,
    pub aabbs: Vec<AABB>,
    pub dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
}

impl Block {
    pub fn compute_name_lower(&mut self) {
        self.name_lower = self.name.to_lowercase();
        self.cache_ready = true;
        self.is_all_transparent = self.is_transparent.iter().all(|transparent| *transparent);
        self.greedy_face_indices = default_greedy_face_indices();
        self.is_full_cube_cached = is_full_cube_from_aabbs(&self.aabbs);
        let mut has_standard_six_faces = false;
        let mut fluid_face_uvs = std::array::from_fn(|_| UV::default());
        let mut has_diagonal = false;
        let mut has_cardinal = false;
        for (face_index, face) in self.faces.iter_mut().enumerate() {
            face.compute_name_lower();
            match face.get_name_lower() {
                "py" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[0] = face.range.clone();
                }
                "ny" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[1] = face.range.clone();
                }
                "px" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[2] = face.range.clone();
                }
                "nx" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[3] = face.range.clone();
                }
                "pz" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[4] = face.range.clone();
                }
                "nz" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[5] = face.range.clone();
                }
                _ => {}
            }
            if face.dir == [0, 0, 0] {
                has_diagonal = true;
            } else {
                let manhattan = face.dir[0].abs() + face.dir[1].abs() + face.dir[2].abs();
                if manhattan == 1 {
                    has_cardinal = true;
                }
            }
            if let Some(dir_index) = cardinal_dir_index(face.dir) {
                if self.greedy_face_indices[dir_index] == -1 {
                    self.greedy_face_indices[dir_index] = face_index as i16;
                } else {
                    self.greedy_face_indices[dir_index] = -2;
                }
            }
        }
        self.has_standard_six_faces = has_standard_six_faces;
        self.fluid_face_uvs = if has_standard_six_faces {
            Some(fluid_face_uvs)
        } else {
            None
        };
        self.has_diagonal_faces = has_diagonal;
        self.has_mixed_diagonal_and_cardinal = has_diagonal && has_cardinal;
        self.greedy_mesh_eligible_no_rotation = !self.is_fluid
            && !self.rotatable
            && !self.y_rotatable
            && self.dynamic_patterns.is_none()
            && self.is_full_cube_cached
            && !self.has_mixed_diagonal_and_cardinal;
        if let Some(patterns) = &mut self.dynamic_patterns {
            for pattern in patterns {
                for part in &mut pattern.parts {
                    for face in &mut part.faces {
                        face.compute_name_lower();
                    }
                }
            }
        }
    }

    pub fn is_full_cube(&self) -> bool {
        if !self.cache_ready {
            is_full_cube_from_aabbs(&self.aabbs)
        } else {
            self.is_full_cube_cached
        }
    }

    pub fn get_name_lower(&self) -> &str {
        if !self.cache_ready {
            &self.name
        } else {
            &self.name_lower
        }
    }

    pub fn has_standard_six_faces_cached(&self) -> bool {
        if !self.cache_ready {
            has_standard_six_faces(&self.faces)
        } else {
            self.has_standard_six_faces
        }
    }

    pub fn can_greedy_mesh_without_rotation(&self) -> bool {
        if !self.cache_ready {
            !self.is_fluid
                && !self.rotatable
                && !self.y_rotatable
                && self.dynamic_patterns.is_none()
                && self.is_full_cube()
                && !(has_diagonal_faces(self) && has_cardinal_faces(self))
        } else {
            self.greedy_mesh_eligible_no_rotation
        }
    }

    pub fn has_diagonal_faces_cached(&self) -> bool {
        if !self.cache_ready {
            has_diagonal_faces(self)
        } else {
            self.has_diagonal_faces
        }
    }
}

#[inline]
const fn default_greedy_face_indices() -> [i16; 6] {
    [-1; 6]
}

#[inline]
fn is_full_cube_from_aabbs(aabbs: &[AABB]) -> bool {
    aabbs.len() == 1
        && (aabbs[0].min_x - 0.0).abs() < f32::EPSILON
        && (aabbs[0].min_y - 0.0).abs() < f32::EPSILON
        && (aabbs[0].min_z - 0.0).abs() < f32::EPSILON
        && (aabbs[0].max_x - 1.0).abs() < f32::EPSILON
        && (aabbs[0].max_y - 1.0).abs() < f32::EPSILON
        && (aabbs[0].max_z - 1.0).abs() < f32::EPSILON
}

#[inline]
const fn cardinal_dir_index(dir: [i32; 3]) -> Option<usize> {
    match dir {
        [1, 0, 0] => Some(0),
        [-1, 0, 0] => Some(1),
        [0, 1, 0] => Some(2),
        [0, -1, 0] => Some(3),
        [0, 0, 1] => Some(4),
        [0, 0, -1] => Some(5),
        _ => None,
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub blocks_by_id: Vec<(u32, Block)>,
    #[serde(skip)]
    lookup_cache: Option<HashMap<u32, usize>>,
}

impl Registry {
    pub fn new(blocks_by_id: Vec<(u32, Block)>) -> Self {
        Self {
            blocks_by_id,
            lookup_cache: None,
        }
    }

    pub fn build_cache(&mut self) {
        let mut cache = HashMap::with_capacity(self.blocks_by_id.len());
        for (idx, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            cache.insert(*id, idx);
            block.compute_name_lower();
        }
        self.lookup_cache = Some(cache);
    }

    pub fn get_block_by_id(&self, id: u32) -> Option<&Block> {
        if let Some(cache) = &self.lookup_cache {
            cache.get(&id).map(|&idx| &self.blocks_by_id[idx].1)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block)
        }
    }

    pub fn has_type(&self, id: u32) -> bool {
        if let Some(cache) = &self.lookup_cache {
            cache.contains_key(&id)
        } else {
            self.blocks_by_id
                .iter()
                .any(|(block_id, _)| *block_id == id)
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryProtocol {
    pub voxel: u32,
    pub at: Option<[i32; 3]>,
    pub face_name: Option<String>,
    pub positions: Vec<f32>,
    pub indices: Vec<i32>,
    pub uvs: Vec<f32>,
    pub lights: Vec<i32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshConfig {
    pub chunk_size: i32,
    pub greedy_meshing: bool,
}

impl Default for MeshConfig {
    fn default() -> Self {
        Self {
            chunk_size: 16,
            greedy_meshing: true,
        }
    }
}

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];

const FLUID_BASE_HEIGHT: f32 = 0.875;
const FLUID_STAGE_DROPOFF: f32 = 0.1;
const FLUID_SURFACE_OFFSET: f32 = 0.005;

struct NeighborCache {
    data: [[u32; 2]; 27],
}

impl NeighborCache {
    #[inline]
    fn offset_to_index(x: i32, y: i32, z: i32) -> usize {
        ((x + 1) + (y + 1) * 3 + (z + 1) * 9) as usize
    }

    fn populate<S: VoxelAccess>(vx: i32, vy: i32, vz: i32, space: &S) -> Self {
        let mut data = [[0u32; 2]; 27];

        for x in -1..=1 {
            for y in -1..=1 {
                for z in -1..=1 {
                    let idx = Self::offset_to_index(x, y, z);
                    data[idx][0] = space.get_raw_voxel(vx + x, vy + y, vz + z);
                    let (sun, red, green, blue) = space.get_all_lights(vx + x, vy + y, vz + z);
                    data[idx][1] = (sun << 12) | (red << 8) | (green << 4) | blue;
                }
            }
        }

        Self { data }
    }

    #[inline]
    fn get_raw_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][0]
    }

    #[inline]
    fn get_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        extract_id(self.get_raw_voxel(dx, dy, dz))
    }

    #[inline]
    fn get_raw_light(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][1]
    }

    #[inline]
    fn get_all_lights(&self, dx: i32, dy: i32, dz: i32) -> (u32, u32, u32, u32) {
        let light = self.get_raw_light(dx, dy, dz);
        LightUtils::extract_all(light)
    }
}

#[inline]
fn build_neighbor_opaque_mask(neighbors: &NeighborCache, registry: &Registry) -> [bool; 27] {
    let mut mask = [false; 27];
    for x in -1..=1 {
        for y in -1..=1 {
            for z in -1..=1 {
                let idx = NeighborCache::offset_to_index(x, y, z);
                let id = neighbors.get_voxel(x, y, z);
                mask[idx] = registry
                    .get_block_by_id(id)
                    .map(|block| block.is_opaque)
                    .unwrap_or(false);
            }
        }
    }
    mask
}

#[inline]
fn neighbor_is_opaque(mask: &[bool; 27], ox: i32, oy: i32, oz: i32) -> bool {
    mask[NeighborCache::offset_to_index(ox, oy, oz)]
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct FaceKey {
    block_id: u32,
    face_name: Option<String>,
    independent: bool,
    ao: [i32; 4],
    light: [i32; 4],
    uv_start_u: u32,
    uv_end_u: u32,
    uv_start_v: u32,
    uv_end_v: u32,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
struct FaceData {
    key: FaceKey,
    uv_range: UV,
    is_fluid: bool,
}

#[derive(Clone, Debug)]
struct GreedyQuad {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    data: FaceData,
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
enum GeometryMapKey {
    Block(u32),
    Face(u32, String),
    Isolated(u32, String, i32, i32, i32),
}

#[inline]
fn estimate_geometry_capacity(min: &[i32; 3], max: &[i32; 3]) -> usize {
    let dx = (max[0] - min[0]).max(0) as usize;
    let dy = (max[1] - min[1]).max(0) as usize;
    let dz = (max[2] - min[2]).max(0) as usize;
    let volume = dx.saturating_mul(dy).saturating_mul(dz);
    (volume / 4).max(64)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkData {
    pub voxels: Vec<u32>,
    pub lights: Vec<u32>,
    pub shape: [usize; 3],
    pub min: [i32; 3],
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshInput {
    pub chunks: Vec<Option<ChunkData>>,
    pub min: [i32; 3],
    pub max: [i32; 3],
    pub registry: Registry,
    pub config: MeshConfig,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshInputNoRegistry {
    pub chunks: Vec<Option<ChunkData>>,
    pub min: [i32; 3],
    pub max: [i32; 3],
    pub config: MeshConfig,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshOutput {
    pub geometries: Vec<GeometryProtocol>,
}

struct VoxelSpace<'a> {
    chunks: &'a [Option<ChunkData>],
    chunk_size: i32,
    center_coords: [i32; 2],
}

impl<'a> VoxelSpace<'a> {
    fn new(chunks: &'a [Option<ChunkData>], chunk_size: i32, center_coords: [i32; 2]) -> Self {
        Self {
            chunks,
            chunk_size,
            center_coords,
        }
    }

    #[inline]
    fn map_voxel_to_chunk(&self, vx: i32, vz: i32) -> [i32; 2] {
        [
            vx.div_euclid(self.chunk_size),
            vz.div_euclid(self.chunk_size),
        ]
    }

    #[inline]
    fn get_chunk(&self, coords: [i32; 2]) -> Option<&ChunkData> {
        let dx = coords[0] - self.center_coords[0];
        let dz = coords[1] - self.center_coords[1];
        if dx < -1 || dx > 1 || dz < -1 || dz > 1 {
            return None;
        }
        let index = ((dz + 1) * 3 + (dx + 1)) as usize;
        self.chunks.get(index).and_then(|c| c.as_ref())
    }

    #[inline]
    fn get_index(&self, chunk: &ChunkData, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        let lx = vx.rem_euclid(self.chunk_size) as usize;
        let ly = vy as usize;
        let lz = vz.rem_euclid(self.chunk_size) as usize;

        if ly >= chunk.shape[1] {
            return None;
        }

        let index = lx * chunk.shape[1] * chunk.shape[2] + ly * chunk.shape[2] + lz;
        if index < chunk.voxels.len() {
            Some(index)
        } else {
            None
        }
    }

    #[inline]
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return chunk.voxels[index] & 0xFFFF;
            }
        }
        0
    }

    #[inline]
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return chunk.voxels[index];
            }
        }
        0
    }

    #[inline]
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        let rotation = (raw >> 16) & 0xF;
        let y_rotation = (raw >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rotation)
    }

    #[inline]
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let raw = self.get_raw_voxel(vx, vy, vz);
        (raw >> 24) & 0xF
    }

    #[inline]
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return LightUtils::extract_sunlight(chunk.lights[index]);
            }
        }
        0
    }

    #[inline]
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                let light = chunk.lights[index];
                return match color {
                    LightColor::Red => LightUtils::extract_red_light(light),
                    LightColor::Green => LightUtils::extract_green_light(light),
                    LightColor::Blue => LightUtils::extract_blue_light(light),
                    LightColor::Sunlight => LightUtils::extract_sunlight(light),
                };
            }
        }
        0
    }

    #[inline]
    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return LightUtils::extract_all(chunk.lights[index]);
            }
        }
        (0, 0, 0, 0)
    }

    #[inline]
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        let coords = self.map_voxel_to_chunk(vx, vz);
        self.get_chunk(coords).is_some() && vy >= 0
    }

    #[inline]
    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        u32::MAX
    }
}

impl<'a> VoxelAccess for VoxelSpace<'a> {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_voxel(self, vx, vy, vz)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_raw_voxel(self, vx, vy, vz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        VoxelSpace::get_voxel_rotation(self, vx, vy, vz)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_voxel_stage(self, vx, vy, vz)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        VoxelSpace::get_sunlight(self, vx, vy, vz)
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        VoxelSpace::get_torch_light(self, vx, vy, vz, color)
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        VoxelSpace::get_all_lights(self, vx, vy, vz)
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        VoxelSpace::get_max_height(self, vx, vz)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        VoxelSpace::contains(self, vx, vy, vz)
    }
}

fn extract_id(voxel: u32) -> u32 {
    voxel & 0xFFFF
}

fn vertex_ao(side1: bool, side2: bool, corner: bool) -> i32 {
    let num_s1 = !side1 as i32;
    let num_s2 = !side2 as i32;
    let num_c = !corner as i32;

    if num_s1 == 1 && num_s2 == 1 {
        0
    } else {
        3 - (num_s1 + num_s2 + num_c)
    }
}

fn get_fluid_effective_height(stage: u32) -> f32 {
    (FLUID_BASE_HEIGHT - (stage as f32 * FLUID_STAGE_DROPOFF)).max(0.1)
}

fn has_fluid_above<S: VoxelAccess>(vx: i32, vy: i32, vz: i32, fluid_id: u32, space: &S) -> bool {
    space.get_voxel(vx, vy + 1, vz) == fluid_id
}

fn get_fluid_height_at<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &S,
) -> Option<f32> {
    if space.get_voxel(vx, vy, vz) == fluid_id {
        let stage = space.get_voxel_stage(vx, vy, vz);
        Some(get_fluid_effective_height(stage))
    } else {
        None
    }
}

fn calculate_fluid_corner_height<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    corner_x: i32,
    corner_z: i32,
    corner_offsets: &[[i32; 2]; 3],
    fluid_id: u32,
    space: &S,
    registry: &Registry,
) -> f32 {
    let upper_check_offsets: [[i32; 2]; 4] = [
        [corner_x - 1, corner_z - 1],
        [corner_x - 1, corner_z],
        [corner_x, corner_z - 1],
        [corner_x, corner_z],
    ];

    for [dx, dz] in upper_check_offsets {
        if space.get_voxel(vx + dx, vy + 1, vz + dz) == fluid_id {
            return 1.0;
        }
    }

    let self_stage = space.get_voxel_stage(vx, vy, vz);
    let self_height = get_fluid_effective_height(self_stage);

    let mut total_height = self_height;
    let mut count = 1.0;
    let mut has_air_neighbor = false;
    let mut has_solid_neighbor = false;

    for [dx, dz] in corner_offsets {
        let nx = vx + dx;
        let nz = vz + dz;

        if has_fluid_above(nx, vy, nz, fluid_id, space) {
            total_height += 1.0;
            count += 1.0;
        } else if let Some(h) = get_fluid_height_at(nx, vy, nz, fluid_id, space) {
            total_height += h;
            count += 1.0;
        } else {
            let neighbor_id = space.get_voxel(nx, vy, nz);
            if let Some(neighbor_block) = registry.get_block_by_id(neighbor_id) {
                if neighbor_block.is_empty {
                    has_air_neighbor = true;
                } else {
                    has_solid_neighbor = true;
                }
            }
        }
    }

    if count == 1.0 && has_air_neighbor && !has_solid_neighbor {
        return 0.1;
    }
    total_height / count
}

fn has_standard_six_faces(faces: &[BlockFace]) -> bool {
    faces.iter().any(|f| {
        matches!(
            f.get_name_lower(),
            "py" | "ny" | "px" | "nx" | "pz" | "nz"
        )
    })
}

fn standard_face_uvs(faces: &[BlockFace]) -> [UV; 6] {
    let mut uvs = std::array::from_fn(|_| UV::default());
    for face in faces {
        match face.get_name_lower() {
            "py" => uvs[0] = face.range.clone(),
            "ny" => uvs[1] = face.range.clone(),
            "px" => uvs[2] = face.range.clone(),
            "nx" => uvs[3] = face.range.clone(),
            "pz" => uvs[4] = face.range.clone(),
            "nz" => uvs[5] = face.range.clone(),
            _ => {}
        }
    }
    uvs
}

fn create_fluid_faces<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &S,
    block: &Block,
    registry: &Registry,
) -> Vec<BlockFace> {
    let corner_nxnz: [[i32; 2]; 3] = [[-1, 0], [0, -1], [-1, -1]];
    let corner_pxnz: [[i32; 2]; 3] = [[1, 0], [0, -1], [1, -1]];
    let corner_nxpz: [[i32; 2]; 3] = [[-1, 0], [0, 1], [-1, 1]];
    let corner_pxpz: [[i32; 2]; 3] = [[1, 0], [0, 1], [1, 1]];

    let h_nxnz =
        calculate_fluid_corner_height(vx, vy, vz, 0, 0, &corner_nxnz, fluid_id, space, registry)
            - FLUID_SURFACE_OFFSET;
    let h_pxnz =
        calculate_fluid_corner_height(vx, vy, vz, 1, 0, &corner_pxnz, fluid_id, space, registry)
            - FLUID_SURFACE_OFFSET;
    let h_nxpz =
        calculate_fluid_corner_height(vx, vy, vz, 0, 1, &corner_nxpz, fluid_id, space, registry)
            - FLUID_SURFACE_OFFSET;
    let h_pxpz =
        calculate_fluid_corner_height(vx, vy, vz, 1, 1, &corner_pxpz, fluid_id, space, registry)
            - FLUID_SURFACE_OFFSET;

    let fallback_uvs;
    let standard_uvs = if let Some(uvs) = block.fluid_face_uvs.as_ref() {
        uvs
    } else {
        fallback_uvs = standard_face_uvs(&block.faces);
        &fallback_uvs
    };

    vec![
        BlockFace {
            name: "py".to_string(),
            name_lower: "py".to_string(),
            dir: [0, 1, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[0].clone(),
            corners: [
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, 1.0],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "ny".to_string(),
            name_lower: "ny".to_string(),
            dir: [0, -1, 0],
            independent: false,
            isolated: false,
            texture_group: None,
            range: standard_uvs[1].clone(),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 1.0],
                },
            ],
        },
        BlockFace {
            name: "px".to_string(),
            name_lower: "px".to_string(),
            dir: [1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[2].clone(),
            corners: [
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, h_pxpz],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [1.0, h_pxnz],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "nx".to_string(),
            name_lower: "nx".to_string(),
            dir: [-1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[3].clone(),
            corners: [
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [0.0, h_nxnz],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, h_nxpz],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "pz".to_string(),
            name_lower: "pz".to_string(),
            dir: [0, 0, 1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[4].clone(),
            corners: [
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [0.0, h_nxpz],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [1.0, h_pxpz],
                },
            ],
        },
        BlockFace {
            name: "nz".to_string(),
            name_lower: "nz".to_string(),
            dir: [0, 0, -1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[5].clone(),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, h_pxnz],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, h_nxnz],
                },
            ],
        },
    ]
}

fn has_diagonal_faces(block: &Block) -> bool {
    block.faces.iter().any(|f| f.dir == [0, 0, 0])
}

#[inline]
fn diagonal_face_offsets(vx: i32, vy: i32, vz: i32) -> (f32, f32) {
    let h = (vx as u32).wrapping_mul(73856093)
        ^ (vy as u32).wrapping_mul(19349663)
        ^ (vz as u32).wrapping_mul(83492791);
    let h = h.wrapping_mul(2654435761);
    let ox = ((h >> 24) & 0xFF) as f32 / 255.0 * 0.04;
    let oz = ((h >> 16) & 0xFF) as f32 / 255.0 * 0.04;
    (ox, oz)
}

#[inline]
fn plant_position_jitter(vx: i32, vy: i32, vz: i32) -> (f32, f32) {
    let h = (vx as u32).wrapping_mul(73856093)
        ^ (vy as u32).wrapping_mul(19349663)
        ^ (vz as u32).wrapping_mul(83492791);
    let h = h.wrapping_mul(2654435761);
    let ox = ((h >> 24) & 0xFF) as f32 / 255.0 * 0.2 - 0.1;
    let oz = ((h >> 16) & 0xFF) as f32 / 255.0 * 0.2 - 0.1;
    (ox, oz)
}

fn has_cardinal_faces(block: &Block) -> bool {
    block.faces.iter().any(|f| {
        let d = f.dir;
        (d[0].abs() + d[1].abs() + d[2].abs()) == 1
    })
}

fn can_greedy_mesh_block(block: &Block, rotation: &BlockRotation) -> bool {
    block.can_greedy_mesh_without_rotation() && matches!(rotation, BlockRotation::PY(r) if *r == 0.0)
}

fn geometry_key_for_face(block: &Block, face: &BlockFace, vx: i32, vy: i32, vz: i32) -> GeometryMapKey {
    if face.isolated {
        GeometryMapKey::Isolated(block.id, face.get_name_lower().to_string(), vx, vy, vz)
    } else if face.independent {
        GeometryMapKey::Face(block.id, face.get_name_lower().to_string())
    } else {
        GeometryMapKey::Block(block.id)
    }
}

fn geometry_key_for_quad(block: &Block, face_name: Option<&str>, independent: bool) -> GeometryMapKey {
    if independent {
        GeometryMapKey::Face(block.id, face_name.unwrap_or_default().to_string())
    } else {
        GeometryMapKey::Block(block.id)
    }
}

#[inline]
fn block_min_corner(block: &Block) -> [f32; 3] {
    if block.is_full_cube() {
        [0.0, 0.0, 0.0]
    } else {
        let block_aabb = AABB::union_all(&block.aabbs);
        [block_aabb.min_x, block_aabb.min_y, block_aabb.min_z]
    }
}

fn should_render_face<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    dir: [i32; 3],
    block: &Block,
    space: &S,
    registry: &Registry,
    see_through: bool,
    is_fluid: bool,
) -> bool {
    let nvx = vx + dir[0];
    let nvy = vy + dir[1];
    let nvz = vz + dir[2];

    let neighbor_id = space.get_voxel(nvx, nvy, nvz);
    let n_is_void = !space.contains(nvx, nvy, nvz);

    let n_block_type = match registry.get_block_by_id(neighbor_id) {
        Some(b) => b,
        None => return n_is_void,
    };

    let is_opaque = block.is_opaque;
    let is_see_through = block.is_see_through;

    if is_fluid && !block.is_waterlogged && n_block_type.is_waterlogged {
        return false;
    }

    if is_fluid && n_block_type.occludes_fluid {
        return false;
    }

    (n_is_void || n_block_type.is_empty)
        || (see_through
            && !is_opaque
            && !n_block_type.is_opaque
            && ((is_see_through && neighbor_id == voxel_id && n_block_type.transparent_standalone)
                || (neighbor_id != voxel_id && (is_see_through || n_block_type.is_see_through))))
        || (!see_through && (!is_opaque || !n_block_type.is_opaque))
        || (is_fluid
            && n_block_type.is_opaque
            && !n_block_type.is_fluid
            && !has_fluid_above(vx, vy, vz, voxel_id, space)
            && (!n_block_type.is_full_cube() || dir == [0, 1, 0]))
}

#[inline]
fn is_surrounded_by_opaque_neighbors<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    space: &S,
    registry: &Registry,
) -> bool {
    for [nx, ny, nz] in VOXEL_NEIGHBORS {
        let id = space.get_voxel(vx + nx, vy + ny, vz + nz);
        if !registry
            .get_block_by_id(id)
            .map(|block| block.is_opaque)
            .unwrap_or(false)
        {
            return false;
        }
    }
    true
}

fn compute_face_ao_and_light(
    dir: [i32; 3],
    block: &Block,
    neighbors: &NeighborCache,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let [block_min_x, block_min_y, block_min_z] = block_min_corner(block);

    let is_see_through = block.is_see_through;
    let is_all_transparent = block.is_all_transparent;

    let corner_positions: [[f32; 3]; 4] = match dir {
        [1, 0, 0] => [
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
        ],
        [-1, 0, 0] => [
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 1.0],
            [0.0, 0.0, 1.0],
        ],
        [0, 1, 0] => [
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
        ],
        [0, -1, 0] => [
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
        ],
        [0, 0, 1] => [
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
        ],
        [0, 0, -1] => [
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        _ => return ([3, 3, 3, 3], [0, 0, 0, 0]),
    };

    let mut aos = [0i32; 4];
    let mut lights = [0i32; 4];

    for (i, pos) in corner_positions.iter().enumerate() {
        let dx = if pos[0] <= block_min_x + 0.01 {
            -1
        } else {
            1
        };
        let dy = if pos[1] <= block_min_y + 0.01 {
            -1
        } else {
            1
        };
        let dz = if pos[2] <= block_min_z + 0.01 {
            -1
        } else {
            1
        };

        let get_block_opaque = |ox: i32, oy: i32, oz: i32| -> bool {
            let id = neighbors.get_voxel(ox, oy, oz);
            registry
                .get_block_by_id(id)
                .map(|b| b.is_opaque)
                .unwrap_or(false)
        };

        let b011 = !get_block_opaque(0, dy, dz);
        let b101 = !get_block_opaque(dx, 0, dz);
        let b110 = !get_block_opaque(dx, dy, 0);
        let b111 = !get_block_opaque(dx, dy, dz);

        let ao = if is_see_through || is_all_transparent {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let (sunlight, red_light, green_light, blue_light) = if is_see_through || is_all_transparent
        {
            neighbors.get_all_lights(0, 0, 0)
        } else {
            let mut sum_sunlights = Vec::with_capacity(8);
            let mut sum_red_lights = Vec::with_capacity(8);
            let mut sum_green_lights = Vec::with_capacity(8);
            let mut sum_blue_lights = Vec::with_capacity(8);

            for x in 0..=1 {
                for y in 0..=1 {
                    for z in 0..=1 {
                        let ddx = x * dx;
                        let ddy = y * dy;
                        let ddz = z * dz;

                        let (local_sunlight, local_red_light, local_green_light, local_blue_light) =
                            neighbors.get_all_lights(ddx, ddy, ddz);

                        if local_sunlight == 0
                            && local_red_light == 0
                            && local_green_light == 0
                            && local_blue_light == 0
                        {
                            continue;
                        }

                        let diagonal4_id = neighbors.get_voxel(ddx, ddy, ddz);
                        let diagonal4_opaque = registry
                            .get_block_by_id(diagonal4_id)
                            .map(|b| b.is_opaque)
                            .unwrap_or(false);

                        if diagonal4_opaque {
                            continue;
                        }

                        if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing_id =
                                neighbors.get_voxel(ddx * dir[0], ddy * dir[1], ddz * dir[2]);
                            let facing_opaque = registry
                                .get_block_by_id(facing_id)
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);

                            if facing_opaque {
                                continue;
                            }
                        }

                        if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                            let diagonal_yz_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(0, ddy, ddz))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);
                            let diagonal_xz_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(ddx, 0, ddz))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);
                            let diagonal_xy_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(ddx, ddy, 0))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);

                            if diagonal_yz_opaque && diagonal_xz_opaque && diagonal_xy_opaque {
                                continue;
                            }

                            if diagonal_xy_opaque && diagonal_xz_opaque {
                                let neighbor_y_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, ddy, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_z_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, 0, ddz))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_y_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(ddx, 0, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_z_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, 0, ddz))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_x_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(ddx, 0, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_y_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, ddy, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_x_opaque && neighbor_y_opaque {
                                    continue;
                                }
                            }
                        }

                        sum_sunlights.push(local_sunlight);
                        sum_red_lights.push(local_red_light);
                        sum_green_lights.push(local_green_light);
                        sum_blue_lights.push(local_blue_light);
                    }
                }
            }

            let len = sum_sunlights.len();
            if len > 0 {
                let len_f32 = len as f32;
                (
                    (sum_sunlights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_red_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_green_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_blue_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                )
            } else {
                (0, 0, 0, 0)
            }
        };

        aos[i] = ao;
        let mut light = 0u32;
        light = LightUtils::insert_red_light(light, red_light);
        light = LightUtils::insert_green_light(light, green_light);
        light = LightUtils::insert_blue_light(light, blue_light);
        light = LightUtils::insert_sunlight(light, sunlight);
        lights[i] = light as i32;
    }

    (aos, lights)
}

fn compute_face_ao_and_light_fast(
    dir: [i32; 3],
    block: &Block,
    neighbors: &NeighborCache,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let block_aabb = AABB::union_all(&block.aabbs);

    let is_see_through = block.is_see_through;
    let is_all_transparent = block.is_all_transparent;
    let needs_opaque_checks = !(is_see_through || is_all_transparent);
    let opaque_mask = if needs_opaque_checks {
        Some(build_neighbor_opaque_mask(neighbors, registry))
    } else {
        None
    };

    let corner_positions: [[f32; 3]; 4] = match dir {
        [1, 0, 0] => [
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
        ],
        [-1, 0, 0] => [
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 1.0],
            [0.0, 0.0, 1.0],
        ],
        [0, 1, 0] => [
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
        ],
        [0, -1, 0] => [
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
        ],
        [0, 0, 1] => [
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
        ],
        [0, 0, -1] => [
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        _ => return ([3, 3, 3, 3], [0, 0, 0, 0]),
    };

    let mut aos = [0i32; 4];
    let mut lights = [0i32; 4];

    for (i, pos) in corner_positions.iter().enumerate() {
        let dx = if pos[0] <= block_aabb.min_x + 0.01 {
            -1
        } else {
            1
        };
        let dy = if pos[1] <= block_aabb.min_y + 0.01 {
            -1
        } else {
            1
        };
        let dz = if pos[2] <= block_aabb.min_z + 0.01 {
            -1
        } else {
            1
        };

        let (b011, b101, b110, b111) = if let Some(mask) = &opaque_mask {
            (
                !neighbor_is_opaque(mask, 0, dy, dz),
                !neighbor_is_opaque(mask, dx, 0, dz),
                !neighbor_is_opaque(mask, dx, dy, 0),
                !neighbor_is_opaque(mask, dx, dy, dz),
            )
        } else {
            (false, false, false, false)
        };

        let ao = if is_see_through || is_all_transparent {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let (sunlight, red_light, green_light, blue_light) = if is_see_through || is_all_transparent
        {
            neighbors.get_all_lights(0, 0, 0)
        } else {
            let mask = opaque_mask
                .as_ref()
                .expect("opaque mask exists when opaque checks are needed");
            let mut sum_sunlights = 0u32;
            let mut sum_red_lights = 0u32;
            let mut sum_green_lights = 0u32;
            let mut sum_blue_lights = 0u32;
            let mut count = 0u32;

            for x in 0..=1 {
                for y in 0..=1 {
                    for z in 0..=1 {
                        let ddx = x * dx;
                        let ddy = y * dy;
                        let ddz = z * dz;

                        let (local_sunlight, local_red_light, local_green_light, local_blue_light) =
                            neighbors.get_all_lights(ddx, ddy, ddz);

                        if local_sunlight == 0
                            && local_red_light == 0
                            && local_green_light == 0
                            && local_blue_light == 0
                        {
                            continue;
                        }

                        let diagonal4_opaque = neighbor_is_opaque(mask, ddx, ddy, ddz);

                        if diagonal4_opaque {
                            continue;
                        }

                        if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing_opaque = neighbor_is_opaque(
                                mask,
                                ddx * dir[0],
                                ddy * dir[1],
                                ddz * dir[2],
                            );

                            if facing_opaque {
                                continue;
                            }
                        }

                        if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                            let diagonal_yz_opaque = neighbor_is_opaque(mask, 0, ddy, ddz);
                            let diagonal_xz_opaque = neighbor_is_opaque(mask, ddx, 0, ddz);
                            let diagonal_xy_opaque = neighbor_is_opaque(mask, ddx, ddy, 0);

                            if diagonal_yz_opaque && diagonal_xz_opaque && diagonal_xy_opaque {
                                continue;
                            }

                            if diagonal_xy_opaque && diagonal_xz_opaque {
                                let neighbor_y_opaque = neighbor_is_opaque(mask, 0, ddy, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(mask, 0, 0, ddz);
                                if neighbor_y_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(mask, ddx, 0, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(mask, 0, 0, ddz);
                                if neighbor_x_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(mask, ddx, 0, 0);
                                let neighbor_y_opaque = neighbor_is_opaque(mask, 0, ddy, 0);
                                if neighbor_x_opaque && neighbor_y_opaque {
                                    continue;
                                }
                            }
                        }

                        sum_sunlights += local_sunlight;
                        sum_red_lights += local_red_light;
                        sum_green_lights += local_green_light;
                        sum_blue_lights += local_blue_light;
                        count += 1;
                    }
                }
            }

            if count > 0 {
                (
                    sum_sunlights / count,
                    sum_red_lights / count,
                    sum_green_lights / count,
                    sum_blue_lights / count,
                )
            } else {
                (0, 0, 0, 0)
            }
        };

        aos[i] = ao;
        let mut light = 0u32;
        light = LightUtils::insert_red_light(light, red_light);
        light = LightUtils::insert_green_light(light, green_light);
        light = LightUtils::insert_blue_light(light, blue_light);
        light = LightUtils::insert_sunlight(light, sunlight);
        lights[i] = light as i32;
    }

    (aos, lights)
}

fn extract_greedy_quads(
    mask: &mut HashMap<(i32, i32), FaceData>,
    min_u: i32,
    max_u: i32,
    min_v: i32,
    max_v: i32,
) -> Vec<GreedyQuad> {
    let estimated_cells = ((max_u - min_u) * (max_v - min_v)).max(0) as usize;
    let mut quads = Vec::with_capacity((estimated_cells / 2).max(16));

    for v in min_v..max_v {
        for u in min_u..max_u {
            if let Some(data) = mask.remove(&(u, v)) {
                let mut width = 1;
                while u + width < max_u {
                    if let Some(neighbor) = mask.get(&(u + width, v)) {
                        if neighbor.key == data.key {
                            mask.remove(&(u + width, v));
                            width += 1;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                let mut height = 1;
                'height: while v + height < max_v {
                    for du in 0..width {
                        if let Some(neighbor) = mask.get(&(u + du, v + height)) {
                            if neighbor.key != data.key {
                                break 'height;
                            }
                        } else {
                            break 'height;
                        }
                    }
                    for du in 0..width {
                        mask.remove(&(u + du, v + height));
                    }
                    height += 1;
                }

                quads.push(GreedyQuad {
                    x: u,
                    y: v,
                    w: width,
                    h: height,
                    data,
                });
            }
        }
    }

    quads
}

fn extract_greedy_quads_dense(
    mask: &mut [Option<FaceData>],
    min_u: i32,
    max_u: i32,
    min_v: i32,
    max_v: i32,
) -> Vec<GreedyQuad> {
    let estimated_cells = ((max_u - min_u) * (max_v - min_v)).max(0) as usize;
    let mut quads = Vec::with_capacity((estimated_cells / 2).max(16));
    let width = (max_u - min_u) as usize;

    let index = |u: i32, v: i32| -> usize { (v - min_v) as usize * width + (u - min_u) as usize };

    for v in min_v..max_v {
        for u in min_u..max_u {
            let start_index = index(u, v);
            if let Some(data) = mask[start_index].take() {
                let mut quad_width = 1;
                while u + quad_width < max_u {
                    let neighbor_index = index(u + quad_width, v);
                    if let Some(neighbor) = mask[neighbor_index].as_ref() {
                        if neighbor.key == data.key {
                            mask[neighbor_index] = None;
                            quad_width += 1;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                let mut quad_height = 1;
                'height: while v + quad_height < max_v {
                    for du in 0..quad_width {
                        let neighbor_index = index(u + du, v + quad_height);
                        if let Some(neighbor) = mask[neighbor_index].as_ref() {
                            if neighbor.key != data.key {
                                break 'height;
                            }
                        } else {
                            break 'height;
                        }
                    }

                    for du in 0..quad_width {
                        let neighbor_index = index(u + du, v + quad_height);
                        mask[neighbor_index] = None;
                    }
                    quad_height += 1;
                }

                quads.push(GreedyQuad {
                    x: u,
                    y: v,
                    w: quad_width,
                    h: quad_height,
                    data,
                });
            }
        }
    }

    quads
}

fn process_greedy_quad(
    quad: &GreedyQuad,
    axis: usize,
    slice: i32,
    dir: [i32; 3],
    min: &[i32; 3],
    block: &Block,
    geometry: &mut GeometryProtocol,
) {
    let [min_x, min_y, min_z] = *min;
    let is_opaque = block.is_opaque;
    let is_fluid = quad.data.is_fluid;

    let start_u = quad.data.uv_range.start_u;
    let end_u = quad.data.uv_range.end_u;
    let start_v = quad.data.uv_range.start_v;
    let end_v = quad.data.uv_range.end_v;

    let scale = if is_opaque { 0.0 } else { 0.0001 };

    let u_min = quad.x as f32;
    let u_max = (quad.x + quad.w) as f32;
    let v_min = quad.y as f32;
    let v_max = (quad.y + quad.h) as f32;

    let slice_pos = slice as f32 + if dir[axis] > 0 { 1.0 } else { 0.0 };

    let (corners, uv_corners): ([[f32; 3]; 4], [[f32; 2]; 4]) = match (dir[0], dir[1], dir[2]) {
        (1, 0, 0) => (
            [
                [slice_pos, v_max, u_max],
                [slice_pos, v_min, u_max],
                [slice_pos, v_max, u_min],
                [slice_pos, v_min, u_min],
            ],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (-1, 0, 0) => (
            [
                [slice_pos, v_max, u_min],
                [slice_pos, v_min, u_min],
                [slice_pos, v_max, u_max],
                [slice_pos, v_min, u_max],
            ],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (0, 1, 0) => (
            [
                [u_min, slice_pos, v_max],
                [u_max, slice_pos, v_max],
                [u_min, slice_pos, v_min],
                [u_max, slice_pos, v_min],
            ],
            [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
        ),
        (0, -1, 0) => (
            [
                [u_max, slice_pos, v_max],
                [u_min, slice_pos, v_max],
                [u_max, slice_pos, v_min],
                [u_min, slice_pos, v_min],
            ],
            [[1.0, 0.0], [0.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ),
        (0, 0, 1) => (
            [
                [u_min, v_min, slice_pos],
                [u_max, v_min, slice_pos],
                [u_min, v_max, slice_pos],
                [u_max, v_max, slice_pos],
            ],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
        (0, 0, -1) => (
            [
                [u_max, v_min, slice_pos],
                [u_min, v_min, slice_pos],
                [u_max, v_max, slice_pos],
                [u_min, v_max, slice_pos],
            ],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
        _ => return,
    };

    let ndx = (geometry.positions.len() / 3) as i32;

    for i in 0..4 {
        let pos = corners[i];
        geometry
            .positions
            .push(pos[0] - min_x as f32 - dir[0] as f32 * scale);
        geometry
            .positions
            .push(pos[1] - min_y as f32 - dir[1] as f32 * scale);
        geometry
            .positions
            .push(pos[2] - min_z as f32 - dir[2] as f32 * scale);

        let u = uv_corners[i][0] * (end_u - start_u) + start_u;
        let v = uv_corners[i][1] * (end_v - start_v) + start_v;
        geometry.uvs.push(u);
        geometry.uvs.push(v);

        let ao = quad.data.key.ao[i];
        let light = quad.data.key.light[i];
        let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
        let greedy_bit = 1 << 19;
        geometry
            .lights
            .push(light | (ao << 16) | fluid_bit | greedy_bit);
    }

    let face_aos = quad.data.key.ao;
    let face_lights = quad.data.key.light;

    let a_rt = LightUtils::extract_red_light(face_lights[0] as u32) as i32;
    let b_rt = LightUtils::extract_red_light(face_lights[1] as u32) as i32;
    let c_rt = LightUtils::extract_red_light(face_lights[2] as u32) as i32;
    let d_rt = LightUtils::extract_red_light(face_lights[3] as u32) as i32;

    let a_gt = LightUtils::extract_green_light(face_lights[0] as u32) as i32;
    let b_gt = LightUtils::extract_green_light(face_lights[1] as u32) as i32;
    let c_gt = LightUtils::extract_green_light(face_lights[2] as u32) as i32;
    let d_gt = LightUtils::extract_green_light(face_lights[3] as u32) as i32;

    let a_bt = LightUtils::extract_blue_light(face_lights[0] as u32) as i32;
    let b_bt = LightUtils::extract_blue_light(face_lights[1] as u32) as i32;
    let c_bt = LightUtils::extract_blue_light(face_lights[2] as u32) as i32;
    let d_bt = LightUtils::extract_blue_light(face_lights[3] as u32) as i32;

    let threshold = 0;

    let one_tr0 = a_rt <= threshold || b_rt <= threshold || c_rt <= threshold || d_rt <= threshold;
    let one_tg0 = a_gt <= threshold || b_gt <= threshold || c_gt <= threshold || d_gt <= threshold;
    let one_tb0 = a_bt <= threshold || b_bt <= threshold || c_bt <= threshold || d_bt <= threshold;

    let fequals = (face_aos[0] + face_aos[3]) == (face_aos[1] + face_aos[2]);
    let ozao_r = a_rt + d_rt < b_rt + c_rt && fequals;
    let ozao_g = a_gt + d_gt < b_gt + c_gt && fequals;
    let ozao_b = a_bt + d_bt < b_bt + c_bt && fequals;

    let anzp1_r = (b_rt as f32 > (a_rt + d_rt) as f32 / 2.0
        && (a_rt + d_rt) as f32 / 2.0 > c_rt as f32)
        || (c_rt as f32 > (a_rt + d_rt) as f32 / 2.0 && (a_rt + d_rt) as f32 / 2.0 > b_rt as f32);
    let anzp1_g = (b_gt as f32 > (a_gt + d_gt) as f32 / 2.0
        && (a_gt + d_gt) as f32 / 2.0 > c_gt as f32)
        || (c_gt as f32 > (a_gt + d_gt) as f32 / 2.0 && (a_gt + d_gt) as f32 / 2.0 > b_gt as f32);
    let anzp1_b = (b_bt as f32 > (a_bt + d_bt) as f32 / 2.0
        && (a_bt + d_bt) as f32 / 2.0 > c_bt as f32)
        || (c_bt as f32 > (a_bt + d_bt) as f32 / 2.0 && (a_bt + d_bt) as f32 / 2.0 > b_bt as f32);

    let anz_r = one_tr0 && anzp1_r;
    let anz_g = one_tg0 && anzp1_g;
    let anz_b = one_tb0 && anzp1_b;

    if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
        || (ozao_r || ozao_g || ozao_b)
        || (anz_r || anz_g || anz_b)
    {
        geometry.indices.push(ndx);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 3);
        geometry.indices.push(ndx + 3);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx);
    } else {
        geometry.indices.push(ndx);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 3);
    }
}

fn rotate_offset_y(offset: &mut [f32; 3], rotation: &BlockRotation) {
    let rot = match rotation {
        BlockRotation::PX(rot) => *rot,
        BlockRotation::NX(rot) => *rot,
        BlockRotation::PY(rot) => *rot,
        BlockRotation::NY(rot) => *rot,
        BlockRotation::PZ(rot) => *rot,
        BlockRotation::NZ(rot) => *rot,
    };

    if rot.abs() > f32::EPSILON {
        let cos_rot = rot.cos();
        let sin_rot = rot.sin();
        let x = offset[0];
        let z = offset[2];
        offset[0] = x * cos_rot - z * sin_rot;
        offset[2] = x * sin_rot + z * cos_rot;
    }
}

fn evaluate_block_rule<S: VoxelAccess>(
    rule: &BlockRule,
    pos: [i32; 3],
    space: &S,
    rotation: &BlockRotation,
    y_rotatable: bool,
    world_space: bool,
) -> bool {
    match rule {
        BlockRule::None => true,
        BlockRule::Simple(simple) => {
            let mut offset = [
                simple.offset[0] as f32,
                simple.offset[1] as f32,
                simple.offset[2] as f32,
            ];

            if y_rotatable && !world_space {
                rotate_offset_y(&mut offset, rotation);
            }

            let check_pos = [
                pos[0] + offset[0].round() as i32,
                pos[1] + offset[1].round() as i32,
                pos[2] + offset[2].round() as i32,
            ];

            let mut rule_ok = true;
            let actual_id = space.get_voxel(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_id) = simple.id {
                if actual_id != expected_id {
                    rule_ok = false;
                }
            }

            let actual_rotation =
                space.get_voxel_rotation(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_rotation) = &simple.rotation {
                if actual_rotation != *expected_rotation {
                    rule_ok = false;
                }
            }

            let actual_stage = space.get_voxel_stage(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_stage) = simple.stage {
                if actual_stage != expected_stage {
                    rule_ok = false;
                }
            }

            rule_ok
        }
        BlockRule::Combination { logic, rules } => match logic {
            BlockRuleLogic::And => rules
                .iter()
                .all(|r| evaluate_block_rule(r, pos, space, rotation, y_rotatable, world_space)),
            BlockRuleLogic::Or => rules
                .iter()
                .any(|r| evaluate_block_rule(r, pos, space, rotation, y_rotatable, world_space)),
            BlockRuleLogic::Not => {
                if let Some(first) = rules.first() {
                    !evaluate_block_rule(first, pos, space, rotation, y_rotatable, world_space)
                } else {
                    true
                }
            }
        },
    }
}

fn get_dynamic_faces<S: VoxelAccess>(
    block: &Block,
    pos: [i32; 3],
    space: &S,
    rotation: &BlockRotation,
) -> Vec<(BlockFace, bool)> {
    if let Some(dynamic_patterns) = &block.dynamic_patterns {
        for pattern in dynamic_patterns {
            let mut matched_faces: Vec<(BlockFace, bool)> = Vec::new();
            let mut any_matched = false;

            for part in &pattern.parts {
                let rule_result = evaluate_block_rule(
                    &part.rule,
                    pos,
                    space,
                    rotation,
                    block.y_rotatable,
                    part.world_space,
                );
                if rule_result {
                    any_matched = true;
                    matched_faces.extend(part.faces.iter().cloned().map(|f| (f, part.world_space)));
                }
            }

            if any_matched {
                return matched_faces;
            }
        }
    }

    block.faces.iter().cloned().map(|f| (f, false)).collect()
}

struct FaceProcessCache {
    opaque_mask: Option<[bool; 27]>,
    center_lights: Option<(u32, u32, u32, u32)>,
    fluid_surface_above: bool,
    block_min: [f32; 3],
}

fn build_face_process_cache<S: VoxelAccess>(
    block: &Block,
    is_see_through: bool,
    is_fluid: bool,
    neighbors: &NeighborCache,
    registry: &Registry,
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    space: &S,
) -> FaceProcessCache {
    let is_all_transparent = block.is_all_transparent;

    FaceProcessCache {
        opaque_mask: if !(is_see_through || is_all_transparent) {
            Some(build_neighbor_opaque_mask(neighbors, registry))
        } else {
            None
        },
        center_lights: if is_see_through || is_all_transparent {
            Some(neighbors.get_all_lights(0, 0, 0))
        } else {
            None
        },
        fluid_surface_above: is_fluid && has_fluid_above(vx, vy, vz, voxel_id, space),
        block_min: block_min_corner(block),
    }
}

fn process_face<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    rotation: &BlockRotation,
    face: &BlockFace,
    uv_range: &UV,
    block: &Block,
    registry: &Registry,
    space: &S,
    neighbors: &NeighborCache,
    cache: Option<&FaceProcessCache>,
    see_through: bool,
    is_fluid: bool,
    positions: &mut Vec<f32>,
    indices: &mut Vec<i32>,
    uvs: &mut Vec<f32>,
    lights: &mut Vec<i32>,
    min: &[i32; 3],
    world_space: bool,
) {
    let [min_x, min_y, min_z] = *min;

    let is_opaque = block.is_opaque;
    let is_see_through = block.is_see_through;
    let rotatable = block.rotatable;
    let y_rotatable = block.y_rotatable;

    let mut dir = [face.dir[0] as f32, face.dir[1] as f32, face.dir[2] as f32];
    let is_all_transparent = block.is_all_transparent;

    if (rotatable || y_rotatable) && !world_space {
        rotation.rotate_node(&mut dir, y_rotatable, false);
    }

    let dir = [
        dir[0].round() as i32,
        dir[1].round() as i32,
        dir[2].round() as i32,
    ];

    let nvx = vx + dir[0];
    let nvy = vy + dir[1];
    let nvz = vz + dir[2];

    let neighbor_id = space.get_voxel(nvx, nvy, nvz);
    let n_is_void = !space.contains(nvx, nvy, nvz);

    let n_block_type = match registry.get_block_by_id(neighbor_id) {
        Some(b) => b,
        None => return,
    };

    if is_fluid && !block.is_waterlogged && n_block_type.is_waterlogged {
        return;
    }

    if is_fluid && n_block_type.occludes_fluid {
        return;
    }

    let n_is_empty = n_is_void || n_block_type.is_empty;

    let should_mesh = n_is_empty
        || (see_through
            && !is_opaque
            && !n_block_type.is_opaque
            && ((is_see_through
                && neighbor_id == voxel_id
                && n_block_type.transparent_standalone)
                || (neighbor_id != voxel_id && (is_see_through || n_block_type.is_see_through))))
        || (!see_through && (!is_opaque || !n_block_type.is_opaque))
        || (is_fluid
            && n_block_type.is_opaque
            && !n_block_type.is_fluid
            && !has_fluid_above(vx, vy, vz, voxel_id, space)
            && (!n_block_type.is_full_cube() || dir == [0, 1, 0]));

    if !should_mesh {
        return;
    }

    let start_u = uv_range.start_u;
    let end_u = uv_range.end_u;
    let start_v = uv_range.start_v;
    let end_v = uv_range.end_v;

    let ndx = (positions.len() / 3) as i32;
    let mut face_aos = [0i32; 4];
    let mut four_red_lights = [0u32; 4];
    let mut four_green_lights = [0u32; 4];
    let mut four_blue_lights = [0u32; 4];

    let [block_min_x, block_min_y, block_min_z] = cache
        .map(|entry| entry.block_min)
        .unwrap_or_else(|| block_min_corner(block));
    let needs_opaque_checks = !(is_see_through || is_all_transparent);
    let precomputed_opaque_mask = cache.and_then(|entry| entry.opaque_mask.as_ref());
    let built_opaque_mask = if needs_opaque_checks && precomputed_opaque_mask.is_none() {
        Some(build_neighbor_opaque_mask(neighbors, registry))
    } else {
        None
    };
    let opaque_mask = if needs_opaque_checks {
        precomputed_opaque_mask.or(built_opaque_mask.as_ref())
    } else {
        None
    };
    let center_lights = if is_see_through || is_all_transparent {
        cache
            .and_then(|entry| entry.center_lights)
            .or_else(|| Some(neighbors.get_all_lights(0, 0, 0)))
    } else {
        None
    };
    let fluid_surface_above = cache
        .map(|entry| entry.fluid_surface_above)
        .unwrap_or_else(|| is_fluid && has_fluid_above(vx, vy, vz, voxel_id, space));

    let is_diagonal = dir == [0, 0, 0];
    let has_diagonals = is_see_through && block.has_diagonal_faces_cached();
    let (hash_ox, _hash_oz) = if has_diagonals {
        diagonal_face_offsets(vx, vy, vz)
    } else {
        (0.0, 0.0)
    };
    let (diag_x_offset, diag_z_offset) = if is_diagonal {
        plant_position_jitter(vx, vy, vz)
    } else {
        (0.0, 0.0)
    };
    let face_inset = if is_opaque {
        0.0
    } else if has_diagonals && !is_diagonal {
        0.0001 + hash_ox
    } else {
        0.0001
    };

    for (corner_index, corner) in face.corners.iter().enumerate() {
        let mut pos = corner.pos;

        if (rotatable || y_rotatable) && !world_space {
            rotation.rotate_node(&mut pos, y_rotatable, true);
        }

        let pos_x = pos[0] + vx as f32;
        let pos_y = pos[1] + vy as f32;
        let pos_z = pos[2] + vz as f32;

        positions.push(pos_x - min_x as f32 - dir[0] as f32 * face_inset + diag_x_offset);
        positions.push(pos_y - min_y as f32 - dir[1] as f32 * face_inset);
        positions.push(pos_z - min_z as f32 - dir[2] as f32 * face_inset + diag_z_offset);

        uvs.push(corner.uv[0] * (end_u - start_u) + start_u);
        uvs.push(corner.uv[1] * (end_v - start_v) + start_v);

        let dx = if pos[0] <= block_min_x + 0.01 {
            -1
        } else {
            1
        };
        let dy = if pos[1] <= block_min_y + 0.01 {
            -1
        } else {
            1
        };
        let dz = if pos[2] <= block_min_z + 0.01 {
            -1
        } else {
            1
        };

        let (b011, b101, b110, b111) = if let Some(mask) = &opaque_mask {
            (
                !neighbor_is_opaque(mask, 0, dy, dz),
                !neighbor_is_opaque(mask, dx, 0, dz),
                !neighbor_is_opaque(mask, dx, dy, 0),
                !neighbor_is_opaque(mask, dx, dy, dz),
            )
        } else {
            (false, false, false, false)
        };

        let ao = if is_see_through || is_all_transparent {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let sunlight;
        let red_light;
        let green_light;
        let blue_light;

        if let Some((s, r, g, b)) = center_lights {
            sunlight = s;
            red_light = r;
            green_light = g;
            blue_light = b;
        } else {
            let mask = opaque_mask.expect("opaque mask exists when opaque checks are needed");
            let mut sum_sunlights = 0u32;
            let mut sum_red_lights = 0u32;
            let mut sum_green_lights = 0u32;
            let mut sum_blue_lights = 0u32;
            let mut light_count = 0u32;

            for x in 0..=1 {
                for y in 0..=1 {
                    for z in 0..=1 {
                        let ddx = x * dx;
                        let ddy = y * dy;
                        let ddz = z * dz;

                        let (local_sunlight, local_red_light, local_green_light, local_blue_light) =
                            neighbors.get_all_lights(ddx, ddy, ddz);

                        if local_sunlight == 0
                            && local_red_light == 0
                            && local_green_light == 0
                            && local_blue_light == 0
                        {
                            continue;
                        }

                        let diagonal4_opaque = neighbor_is_opaque(mask, ddx, ddy, ddz);

                        if diagonal4_opaque {
                            continue;
                        }

                        if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing_opaque = neighbor_is_opaque(
                                mask,
                                ddx * dir[0],
                                ddy * dir[1],
                                ddz * dir[2],
                            );

                            if facing_opaque {
                                continue;
                            }
                        }

                        if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                            let diagonal_yz_opaque = neighbor_is_opaque(mask, 0, ddy, ddz);
                            let diagonal_xz_opaque = neighbor_is_opaque(mask, ddx, 0, ddz);
                            let diagonal_xy_opaque = neighbor_is_opaque(mask, ddx, ddy, 0);

                            if diagonal_yz_opaque && diagonal_xz_opaque && diagonal_xy_opaque {
                                continue;
                            }

                            if diagonal_xy_opaque && diagonal_xz_opaque {
                                let neighbor_y_opaque = neighbor_is_opaque(mask, 0, ddy, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(mask, 0, 0, ddz);
                                if neighbor_y_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(mask, ddx, 0, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(mask, 0, 0, ddz);
                                if neighbor_x_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(mask, ddx, 0, 0);
                                let neighbor_y_opaque = neighbor_is_opaque(mask, 0, ddy, 0);
                                if neighbor_x_opaque && neighbor_y_opaque {
                                    continue;
                                }
                            }
                        }

                        sum_sunlights += local_sunlight;
                        sum_red_lights += local_red_light;
                        sum_green_lights += local_green_light;
                        sum_blue_lights += local_blue_light;
                        light_count += 1;
                    }
                }
            }

            if light_count > 0 {
                sunlight = sum_sunlights / light_count;
                red_light = sum_red_lights / light_count;
                green_light = sum_green_lights / light_count;
                blue_light = sum_blue_lights / light_count;
            } else {
                sunlight = 0;
                red_light = 0;
                green_light = 0;
                blue_light = 0;
            }
        }

        let mut light = 0u32;
        light = LightUtils::insert_red_light(light, red_light);
        light = LightUtils::insert_green_light(light, green_light);
        light = LightUtils::insert_blue_light(light, blue_light);
        light = LightUtils::insert_sunlight(light, sunlight);
        let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
        let wave_bit = if is_fluid && dy == 1 && !fluid_surface_above {
            1 << 20
        } else {
            0
        };
        lights.push(light as i32 | ao << 16 | fluid_bit | wave_bit);

        four_red_lights[corner_index] = red_light;
        four_green_lights[corner_index] = green_light;
        four_blue_lights[corner_index] = blue_light;
        face_aos[corner_index] = ao;
    }

    let a_rt = four_red_lights[0];
    let b_rt = four_red_lights[1];
    let c_rt = four_red_lights[2];
    let d_rt = four_red_lights[3];

    let a_gt = four_green_lights[0];
    let b_gt = four_green_lights[1];
    let c_gt = four_green_lights[2];
    let d_gt = four_green_lights[3];

    let a_bt = four_blue_lights[0];
    let b_bt = four_blue_lights[1];
    let c_bt = four_blue_lights[2];
    let d_bt = four_blue_lights[3];

    let threshold = 0;

    let one_tr0 = a_rt <= threshold || b_rt <= threshold || c_rt <= threshold || d_rt <= threshold;
    let one_tg0 = a_gt <= threshold || b_gt <= threshold || c_gt <= threshold || d_gt <= threshold;
    let one_tb0 = a_bt <= threshold || b_bt <= threshold || c_bt <= threshold || d_bt <= threshold;

    let fequals = (face_aos[0] + face_aos[3]) == (face_aos[1] + face_aos[2]);
    let ozao_r = a_rt + d_rt < b_rt + c_rt && fequals;
    let ozao_g = a_gt + d_gt < b_gt + c_gt && fequals;
    let ozao_b = a_bt + d_bt < b_bt + c_bt && fequals;

    let anzp1_r = (b_rt as f32 > (a_rt + d_rt) as f32 / 2.0
        && (a_rt + d_rt) as f32 / 2.0 > c_rt as f32)
        || (c_rt as f32 > (a_rt + d_rt) as f32 / 2.0 && (a_rt + d_rt) as f32 / 2.0 > b_rt as f32);
    let anzp1_g = (b_gt as f32 > (a_gt + d_gt) as f32 / 2.0
        && (a_gt + d_gt) as f32 / 2.0 > c_gt as f32)
        || (c_gt as f32 > (a_gt + d_gt) as f32 / 2.0 && (a_gt + d_gt) as f32 / 2.0 > b_gt as f32);
    let anzp1_b = (b_bt as f32 > (a_bt + d_bt) as f32 / 2.0
        && (a_bt + d_bt) as f32 / 2.0 > c_bt as f32)
        || (c_bt as f32 > (a_bt + d_bt) as f32 / 2.0 && (a_bt + d_bt) as f32 / 2.0 > b_bt as f32);

    let anz_r = one_tr0 && anzp1_r;
    let anz_g = one_tg0 && anzp1_g;
    let anz_b = one_tb0 && anzp1_b;

    indices.push(ndx);
    indices.push(ndx + 1);

    if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
        || (ozao_r || ozao_g || ozao_b)
        || (anz_r || anz_g || anz_b)
    {
        indices.push(ndx + 3);
        indices.push(ndx + 3);
        indices.push(ndx + 2);
        indices.push(ndx);
    } else {
        indices.push(ndx + 2);
        indices.push(ndx + 2);
        indices.push(ndx + 1);
        indices.push(ndx + 3);
    }
}

fn mesh_space_greedy_legacy_impl<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let mut map: HashMap<GeometryMapKey, GeometryProtocol> =
        HashMap::with_capacity(estimate_geometry_capacity(min, max));
    let mut processed_non_greedy: HashSet<(i32, i32, i32)> = HashSet::new();

    let [min_x, min_y, min_z] = *min;
    let [max_x, max_y, max_z] = *max;

    let directions: [(i32, i32, i32); 6] = [
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    ];

    let slice_size = (max_x - min_x).max(max_y - min_y).max(max_z - min_z) as usize;
    let mut greedy_mask: HashMap<(i32, i32), FaceData> =
        HashMap::with_capacity(slice_size * slice_size);
    let mut non_greedy_faces: Vec<(
        i32,
        i32,
        i32,
        u32,
        BlockRotation,
        Block,
        BlockFace,
        UV,
        bool,
        bool,
        bool,
    )> = Vec::new();

    for (dx, dy, dz) in directions {
        let dir = [dx, dy, dz];

        let (axis, u_axis, v_axis) = if dx != 0 {
            (0, 2, 1)
        } else if dy != 0 {
            (1, 0, 2)
        } else {
            (2, 0, 1)
        };

        let slice_range = match axis {
            0 => min_x..max_x,
            1 => min_y..max_y,
            _ => min_z..max_z,
        };

        let u_range = match u_axis {
            0 => (min_x, max_x),
            1 => (min_y, max_y),
            _ => (min_z, max_z),
        };

        let v_range = match v_axis {
            0 => (min_x, max_x),
            1 => (min_y, max_y),
            _ => (min_z, max_z),
        };

        for slice in slice_range {
            greedy_mask.clear();
            non_greedy_faces.clear();

            for u in u_range.0..u_range.1 {
                for v in v_range.0..v_range.1 {
                    let (vx, vy, vz) = match (axis, u_axis, v_axis) {
                        (0, 2, 1) => (slice, v, u),
                        (1, 0, 2) => (u, slice, v),
                        (2, 0, 1) => (u, v, slice),
                        _ => continue,
                    };

                    let voxel_id = space.get_voxel(vx, vy, vz);

                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = match registry.get_block_by_id(voxel_id) {
                        Some(b) => b,
                        None => continue,
                    };

                    if block.is_empty {
                        continue;
                    }

                    if block.is_opaque {
                        if is_surrounded_by_opaque_neighbors(vx, vy, vz, space, registry) {
                            continue;
                        }
                    }

                    let is_fluid = block.is_fluid;
                    let is_see_through = block.is_see_through;

                    let faces: Vec<(BlockFace, bool)> =
                        if is_fluid && block.has_standard_six_faces_cached() {
                            create_fluid_faces(vx, vy, vz, block.id, space, block, registry)
                                .into_iter()
                                .map(|f| (f, false))
                                .collect()
                        } else if block.dynamic_patterns.is_some() {
                            get_dynamic_faces(block, [vx, vy, vz], space, &rotation)
                        } else {
                            block.faces.iter().cloned().map(|f| (f, false)).collect()
                        };

                    let is_non_greedy_block = !can_greedy_mesh_block(block, &rotation);

                    if is_non_greedy_block {
                        if processed_non_greedy.contains(&(vx, vy, vz)) {
                            continue;
                        }
                        processed_non_greedy.insert((vx, vy, vz));

                        for (face, world_space) in faces.iter() {
                            let uv_range = face.range.clone();
                            non_greedy_faces.push((
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                rotation.clone(),
                                block.clone(),
                                face.clone(),
                                uv_range,
                                is_see_through,
                                is_fluid,
                                *world_space,
                            ));
                        }
                        continue;
                    }

                    let matching_faces: Vec<_> = faces
                        .iter()
                        .filter(|(f, world_space)| {
                            let mut face_dir = [f.dir[0] as f32, f.dir[1] as f32, f.dir[2] as f32];
                            if (block.rotatable || block.y_rotatable) && !*world_space {
                                rotation.rotate_node(&mut face_dir, block.y_rotatable, false);
                            }
                            let effective_dir = [
                                face_dir[0].round() as i32,
                                face_dir[1].round() as i32,
                                face_dir[2].round() as i32,
                            ];
                            effective_dir == dir
                        })
                        .collect();

                    if matching_faces.is_empty() {
                        continue;
                    }

                    let should_render = should_render_face(
                        vx,
                        vy,
                        vz,
                        voxel_id,
                        dir,
                        block,
                        space,
                        registry,
                        is_see_through,
                        is_fluid,
                    );

                    if !should_render {
                        continue;
                    }

                    for (face, world_space) in matching_faces {
                        let uv_range = face.range.clone();

                        if face.isolated {
                            non_greedy_faces.push((
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                rotation.clone(),
                                block.clone(),
                                face.clone(),
                                uv_range,
                                is_see_through,
                                is_fluid,
                                *world_space,
                            ));
                            continue;
                        }

                        let neighbors = NeighborCache::populate(vx, vy, vz, space);
                        let (aos, lights) =
                            compute_face_ao_and_light(dir, block, &neighbors, registry);

                        let key = FaceKey {
                            block_id: block.id,
                            face_name: if face.independent {
                                Some(face.get_name_lower().to_string())
                            } else {
                                None
                            },
                            independent: face.independent,
                            ao: aos,
                            light: lights,
                            uv_start_u: (uv_range.start_u * 1000000.0) as u32,
                            uv_end_u: (uv_range.end_u * 1000000.0) as u32,
                            uv_start_v: (uv_range.start_v * 1000000.0) as u32,
                            uv_end_v: (uv_range.end_v * 1000000.0) as u32,
                        };

                        let data = FaceData {
                            key,
                            uv_range,
                            is_fluid,
                        };

                        greedy_mask.insert((u, v), data);
                    }
                }
            }

            let quads =
                extract_greedy_quads(&mut greedy_mask, u_range.0, u_range.1, v_range.0, v_range.1);

            for quad in quads {
                let block = match registry.get_block_by_id(quad.data.key.block_id) {
                    Some(b) => b,
                    None => continue,
                };
                let geo_key = geometry_key_for_quad(
                    block,
                    quad.data.key.face_name.as_deref(),
                    quad.data.key.independent,
                );

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut g = GeometryProtocol::default();
                    g.voxel = quad.data.key.block_id;
                    if quad.data.key.independent {
                        g.face_name = quad.data.key.face_name.clone();
                    }
                    g
                });

                process_greedy_quad(&quad, axis, slice, dir, min, block, geometry);
            }

            for (
                vx,
                vy,
                vz,
                voxel_id,
                rotation,
                block,
                face,
                uv_range,
                is_see_through,
                is_fluid,
                world_space,
            ) in non_greedy_faces.drain(..)
            {
                let geo_key = geometry_key_for_face(&block, &face, vx, vy, vz);

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut g = GeometryProtocol::default();
                    g.voxel = voxel_id;
                    if face.independent || face.isolated {
                        g.face_name = Some(face.name.clone());
                    }
                    if face.isolated {
                        g.at = Some([vx, vy, vz]);
                    }
                    g
                });

                let neighbors = NeighborCache::populate(vx, vy, vz, space);
                let face_cache = build_face_process_cache(
                    &block,
                    is_see_through,
                    is_fluid,
                    &neighbors,
                    registry,
                    vx,
                    vy,
                    vz,
                    voxel_id,
                    space,
                );
                process_face(
                    vx,
                    vy,
                    vz,
                    voxel_id,
                    &rotation,
                    &face,
                    &uv_range,
                    &block,
                    registry,
                    space,
                    &neighbors,
                    Some(&face_cache),
                    is_see_through,
                    is_fluid,
                    &mut geometry.positions,
                    &mut geometry.indices,
                    &mut geometry.uvs,
                    &mut geometry.lights,
                    min,
                    world_space,
                );
            }
        }
    }

    map.into_values()
        .filter(|geometry| !geometry.indices.is_empty())
        .collect()
}

pub fn mesh_space_greedy_legacy<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    mesh_space_greedy_legacy_impl(min, max, space, registry)
}

fn mesh_space_greedy_fast_impl<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let mut map: HashMap<GeometryMapKey, GeometryProtocol> =
        HashMap::with_capacity(estimate_geometry_capacity(min, max));

    let [min_x, min_y, min_z] = *min;
    let [max_x, max_y, max_z] = *max;
    let x_span = (max_x - min_x).max(0) as usize;
    let y_span = (max_y - min_y).max(0) as usize;
    let z_span = (max_z - min_z).max(0) as usize;
    let mut processed_non_greedy = vec![false; x_span * y_span * z_span];
    let voxel_index = |vx: i32, vy: i32, vz: i32| -> usize {
        let local_x = (vx - min_x) as usize;
        let local_y = (vy - min_y) as usize;
        let local_z = (vz - min_z) as usize;
        local_x * y_span * z_span + local_y * z_span + local_z
    };
    const OCCLUSION_UNKNOWN: u8 = 2;
    let mut fully_occluded_opaque = vec![OCCLUSION_UNKNOWN; x_span * y_span * z_span];

    let directions: [(i32, i32, i32); 6] = [
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    ];

    let mut non_greedy_faces: Vec<(i32, i32, i32, u32, BlockFace, bool)> = Vec::new();

    for (dx, dy, dz) in directions {
        let dir = [dx, dy, dz];
        let dir_index =
            cardinal_dir_index(dir).expect("greedy directions are always cardinal unit vectors");

        let (axis, u_axis, v_axis) = if dx != 0 {
            (0, 2, 1)
        } else if dy != 0 {
            (1, 0, 2)
        } else {
            (2, 0, 1)
        };

        let slice_range = match axis {
            0 => min_x..max_x,
            1 => min_y..max_y,
            _ => min_z..max_z,
        };

        let u_range = match u_axis {
            0 => (min_x, max_x),
            1 => (min_y, max_y),
            _ => (min_z, max_z),
        };

        let v_range = match v_axis {
            0 => (min_x, max_x),
            1 => (min_y, max_y),
            _ => (min_z, max_z),
        };

        let slice_area = ((u_range.1 - u_range.0) * (v_range.1 - v_range.0)).max(0) as usize;
        if non_greedy_faces.capacity() < slice_area {
            non_greedy_faces.reserve(slice_area - non_greedy_faces.capacity());
        }

        let mask_width = (u_range.1 - u_range.0) as usize;
        let mask_height = (v_range.1 - v_range.0) as usize;
        let mut greedy_mask: Vec<Option<FaceData>> = vec![None; mask_width * mask_height];
        let mask_index =
            |u: i32, v: i32| -> usize { (v - v_range.0) as usize * mask_width + (u - u_range.0) as usize };

        for slice in slice_range {
            greedy_mask.fill(None);
            non_greedy_faces.clear();

            for u in u_range.0..u_range.1 {
                for v in v_range.0..v_range.1 {
                    let (vx, vy, vz) = match (axis, u_axis, v_axis) {
                        (0, 2, 1) => (slice, v, u),
                        (1, 0, 2) => (u, slice, v),
                        (2, 0, 1) => (u, v, slice),
                        _ => continue,
                    };

                    let voxel_id = space.get_voxel(vx, vy, vz);
                    let block = match registry.get_block_by_id(voxel_id) {
                        Some(candidate) => candidate,
                        None => continue,
                    };
                    let current_voxel_index = voxel_index(vx, vy, vz);

                    if block.is_empty {
                        continue;
                    }

                    if block.is_opaque {
                        let cached = fully_occluded_opaque[current_voxel_index];
                        let is_fully_occluded = if cached == OCCLUSION_UNKNOWN {
                            let value = is_surrounded_by_opaque_neighbors(vx, vy, vz, space, registry);
                            fully_occluded_opaque[current_voxel_index] = if value { 1 } else { 0 };
                            value
                        } else {
                            cached == 1
                        };
                        if is_fully_occluded {
                            continue;
                        }
                    }

                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let is_non_greedy_block = !can_greedy_mesh_block(block, &rotation);
                    if is_non_greedy_block && processed_non_greedy[current_voxel_index] {
                        continue;
                    }

                    let is_fluid = block.is_fluid;
                    let is_see_through = block.is_see_through;

                    if is_non_greedy_block {
                        let faces: Vec<(BlockFace, bool)> =
                            if is_fluid && block.has_standard_six_faces_cached() {
                                create_fluid_faces(vx, vy, vz, block.id, space, block, registry)
                                    .into_iter()
                                    .map(|face| (face, false))
                                    .collect()
                            } else if block.dynamic_patterns.is_some() {
                                get_dynamic_faces(block, [vx, vy, vz], space, &rotation)
                            } else {
                                block.faces.iter().cloned().map(|face| (face, false)).collect()
                            };

                        processed_non_greedy[current_voxel_index] = true;
                        for (face, world_space) in faces {
                            non_greedy_faces.push((
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                face,
                                world_space,
                            ));
                        }
                        continue;
                    }

                    let should_render = should_render_face(
                        vx,
                        vy,
                        vz,
                        voxel_id,
                        dir,
                        block,
                        space,
                        registry,
                        is_see_through,
                        is_fluid,
                    );

                    if !should_render {
                        continue;
                    }

                    let mut neighbors = None;
                    let mut cached_ao_light: Option<([i32; 4], [i32; 4])> = None;
                    let mut push_greedy_face = |face: &BlockFace| {
                        if face.isolated {
                            non_greedy_faces.push((
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                face.clone(),
                                false,
                            ));
                            return;
                        }

                        let (aos, lights) = *cached_ao_light.get_or_insert_with(|| {
                            let neighbors_ref =
                                neighbors.get_or_insert_with(|| NeighborCache::populate(vx, vy, vz, space));
                            compute_face_ao_and_light_fast(dir, block, neighbors_ref, registry)
                        });
                        let uv_range = face.range.clone();

                        let key = FaceKey {
                            block_id: block.id,
                            face_name: if face.independent {
                                Some(face.get_name_lower().to_string())
                            } else {
                                None
                            },
                            independent: face.independent,
                            ao: aos,
                            light: lights,
                            uv_start_u: (uv_range.start_u * 1000000.0) as u32,
                            uv_end_u: (uv_range.end_u * 1000000.0) as u32,
                            uv_start_v: (uv_range.start_v * 1000000.0) as u32,
                            uv_end_v: (uv_range.end_v * 1000000.0) as u32,
                        };

                        greedy_mask[mask_index(u, v)] = Some(FaceData {
                            key,
                            uv_range,
                            is_fluid,
                        });
                    };

                    let face_index = block.greedy_face_indices[dir_index];
                    if face_index >= 0 {
                        if let Some(face) = block.faces.get(face_index as usize) {
                            push_greedy_face(face);
                        }
                    } else if face_index == -2 {
                        for face in &block.faces {
                            if face.dir == dir {
                                push_greedy_face(face);
                            }
                        }
                    }
                }
            }

            let quads = extract_greedy_quads_dense(
                &mut greedy_mask,
                u_range.0,
                u_range.1,
                v_range.0,
                v_range.1,
            );

            for quad in quads {
                let block = match registry.get_block_by_id(quad.data.key.block_id) {
                    Some(candidate) => candidate,
                    None => continue,
                };
                let geo_key = geometry_key_for_quad(
                    block,
                    quad.data.key.face_name.as_deref(),
                    quad.data.key.independent,
                );

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut entry = GeometryProtocol::default();
                    entry.voxel = quad.data.key.block_id;
                    if quad.data.key.independent {
                        entry.face_name = quad.data.key.face_name.clone();
                    }
                    entry
                });

                process_greedy_quad(&quad, axis, slice, dir, min, block, geometry);
            }

            let mut cached_voxel: Option<(i32, i32, i32, u32)> = None;
            let mut cached_block: Option<&Block> = None;
            let mut cached_neighbors: Option<NeighborCache> = None;
            let mut cached_face_cache: Option<FaceProcessCache> = None;
            let mut cached_rotation: Option<BlockRotation> = None;

            for (
                vx,
                vy,
                vz,
                voxel_id,
                face,
                world_space,
            ) in non_greedy_faces.drain(..)
            {
                let voxel_key = (vx, vy, vz, voxel_id);
                if cached_voxel != Some(voxel_key) {
                    let block = match registry.get_block_by_id(voxel_id) {
                        Some(candidate) => candidate,
                        None => {
                            cached_voxel = None;
                            cached_block = None;
                            cached_neighbors = None;
                            cached_face_cache = None;
                            cached_rotation = None;
                            continue;
                        }
                    };
                    let is_see_through = block.is_see_through;
                    let is_fluid = block.is_fluid;
                    let neighbors = NeighborCache::populate(vx, vy, vz, space);
                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let face_cache = build_face_process_cache(
                        block,
                        is_see_through,
                        is_fluid,
                        &neighbors,
                        registry,
                        vx,
                        vy,
                        vz,
                        voxel_id,
                        space,
                    );
                    cached_neighbors = Some(neighbors);
                    cached_face_cache = Some(face_cache);
                    cached_rotation = Some(rotation);
                    cached_block = Some(block);
                    cached_voxel = Some(voxel_key);
                }
                let block = cached_block
                    .expect("cached block must exist for non-greedy face");
                let is_see_through = block.is_see_through;
                let is_fluid = block.is_fluid;
                let geo_key = geometry_key_for_face(block, &face, vx, vy, vz);

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut entry = GeometryProtocol::default();
                    entry.voxel = voxel_id;
                    if face.independent || face.isolated {
                        entry.face_name = Some(face.name.clone());
                    }
                    if face.isolated {
                        entry.at = Some([vx, vy, vz]);
                    }
                    entry
                });
                let neighbors = cached_neighbors
                    .as_ref()
                    .expect("cached neighbors must exist for non-greedy face");
                let face_cache = cached_face_cache
                    .as_ref()
                    .expect("cached face data must exist for non-greedy face");
                let rotation = cached_rotation
                    .as_ref()
                    .expect("cached rotation must exist for non-greedy face");
                process_face(
                    vx,
                    vy,
                    vz,
                    voxel_id,
                    rotation,
                    &face,
                    &face.range,
                    block,
                    registry,
                    space,
                    neighbors,
                    Some(face_cache),
                    is_see_through,
                    is_fluid,
                    &mut geometry.positions,
                    &mut geometry.indices,
                    &mut geometry.uvs,
                    &mut geometry.lights,
                    min,
                    world_space,
                );
            }
        }
    }

    map.into_values()
        .filter(|geometry| !geometry.indices.is_empty())
        .collect()
}

pub fn mesh_space_greedy<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    mesh_space_greedy_fast_impl(min, max, space, registry)
}

pub fn mesh_space<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let mut map: HashMap<GeometryMapKey, GeometryProtocol> =
        HashMap::with_capacity(estimate_geometry_capacity(min, max));

    let [min_x, min_y, min_z] = *min;
    let [max_x, max_y, max_z] = *max;

    for vx in min_x..max_x {
        for vz in min_z..max_z {
            for vy in min_y..max_y {
                let voxel_id = space.get_voxel(vx, vy, vz);
                let block = match registry.get_block_by_id(voxel_id) {
                    Some(b) => b,
                    None => continue,
                };

                let is_see_through = block.is_see_through;
                let is_empty = block.is_empty;
                let is_opaque = block.is_opaque;
                let is_fluid = block.is_fluid;

                if is_empty {
                    continue;
                }

                if is_opaque {
                    if is_surrounded_by_opaque_neighbors(vx, vy, vz, space, registry) {
                        continue;
                    }
                }

                let rotation = space.get_voxel_rotation(vx, vy, vz);
                let neighbors = NeighborCache::populate(vx, vy, vz, space);
                let is_all_transparent = block.is_all_transparent;
                let face_cache = FaceProcessCache {
                    opaque_mask: if !(is_see_through || is_all_transparent) {
                        Some(build_neighbor_opaque_mask(&neighbors, registry))
                    } else {
                        None
                    },
                    center_lights: if is_see_through || is_all_transparent {
                        Some(neighbors.get_all_lights(0, 0, 0))
                    } else {
                        None
                    },
                    fluid_surface_above: is_fluid && has_fluid_above(vx, vy, vz, voxel_id, space),
                    block_min: block_min_corner(block),
                };

                let mut process_single_face = |face: &BlockFace, world_space: bool| {
                    let key = geometry_key_for_face(block, face, vx, vy, vz);

                    let geometry = map.entry(key).or_default();

                    geometry.voxel = block.id;

                    if face.independent || face.isolated {
                        geometry.face_name = Some(face.name.clone());
                    }

                    if face.isolated {
                        geometry.at = Some([vx, vy, vz]);
                    }

                    process_face(
                        vx,
                        vy,
                        vz,
                        voxel_id,
                        &rotation,
                        face,
                        &face.range,
                        block,
                        registry,
                        space,
                        &neighbors,
                        Some(&face_cache),
                        is_see_through,
                        is_fluid,
                        &mut geometry.positions,
                        &mut geometry.indices,
                        &mut geometry.uvs,
                        &mut geometry.lights,
                        min,
                        world_space,
                    );
                };

                if is_fluid && block.has_standard_six_faces_cached() {
                    let fluid_faces =
                        create_fluid_faces(vx, vy, vz, block.id, space, block, registry);
                    for face in &fluid_faces {
                        process_single_face(face, false);
                    }
                } else if block.dynamic_patterns.is_some() {
                    let dynamic_faces = get_dynamic_faces(block, [vx, vy, vz], space, &rotation);
                    for (face, world_space) in &dynamic_faces {
                        process_single_face(face, *world_space);
                    }
                } else {
                    for face in &block.faces {
                        process_single_face(face, false);
                    }
                }
            }
        }
    }

    map.into_values()
        .filter(|geometry| !geometry.indices.is_empty())
        .collect()
}

pub fn mesh_chunk(mut input: MeshInput) -> MeshOutput {
    let center_chunk = input.chunks.get(4).and_then(|c| c.as_ref());
    if center_chunk.is_none() {
        return MeshOutput { geometries: vec![] };
    }

    let center_chunk = center_chunk.unwrap();
    let center_coords = [
        center_chunk.min[0] / input.config.chunk_size,
        center_chunk.min[2] / input.config.chunk_size,
    ];

    input.registry.build_cache();

    let space = VoxelSpace::new(&input.chunks, input.config.chunk_size, center_coords);

    let geometries = if input.config.greedy_meshing {
        mesh_space_greedy(&input.min, &input.max, &space, &input.registry)
    } else {
        mesh_space(&input.min, &input.max, &space, &input.registry)
    };

    MeshOutput { geometries }
}

pub fn mesh_chunk_with_registry(input: MeshInputNoRegistry, registry: &Registry) -> MeshOutput {
    let center_chunk = input.chunks.get(4).and_then(|c| c.as_ref());
    if center_chunk.is_none() {
        return MeshOutput { geometries: vec![] };
    }

    let center_chunk = center_chunk.unwrap();
    let center_coords = [
        center_chunk.min[0] / input.config.chunk_size,
        center_chunk.min[2] / input.config.chunk_size,
    ];

    let space = VoxelSpace::new(&input.chunks, input.config.chunk_size, center_coords);

    let geometries = if input.config.greedy_meshing {
        mesh_space_greedy(&input.min, &input.max, &space, registry)
    } else {
        mesh_space(&input.min, &input.max, &space, registry)
    };

    MeshOutput { geometries }
}
