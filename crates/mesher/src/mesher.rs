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
    pub has_independent_or_isolated_faces: bool,
    #[serde(skip, default)]
    pub has_dynamic_patterns: bool,
    #[serde(skip, default)]
    pub block_min_cached: [f32; 3],
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
        self.block_min_cached = if self.is_full_cube_cached {
            [0.0, 0.0, 0.0]
        } else {
            let block_aabb = AABB::union_all(&self.aabbs);
            [block_aabb.min_x, block_aabb.min_y, block_aabb.min_z]
        };
        let mut has_standard_six_faces = false;
        let mut fluid_face_uvs = std::array::from_fn(|_| UV::default());
        let mut has_diagonal = false;
        let mut has_cardinal = false;
        let mut has_independent_or_isolated_faces = false;
        for (face_index, face) in self.faces.iter_mut().enumerate() {
            face.compute_name_lower();
            if face.independent || face.isolated {
                has_independent_or_isolated_faces = true;
            }
            match face.get_name_lower() {
                "py" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[0] = face.range;
                }
                "ny" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[1] = face.range;
                }
                "px" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[2] = face.range;
                }
                "nx" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[3] = face.range;
                }
                "pz" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[4] = face.range;
                }
                "nz" => {
                    has_standard_six_faces = true;
                    fluid_face_uvs[5] = face.range;
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
        self.has_independent_or_isolated_faces = has_independent_or_isolated_faces;
        self.has_mixed_diagonal_and_cardinal = has_diagonal && has_cardinal;
        self.has_dynamic_patterns = self.dynamic_patterns.is_some();
        self.greedy_mesh_eligible_no_rotation = !self.is_fluid
            && !self.rotatable
            && !self.y_rotatable
            && !self.has_dynamic_patterns
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

    pub fn has_independent_or_isolated_faces_cached(&self) -> bool {
        if !self.cache_ready {
            self.faces
                .iter()
                .any(|face| face.independent || face.isolated)
        } else {
            self.has_independent_or_isolated_faces
        }
    }

    pub fn has_dynamic_patterns_cached(&self) -> bool {
        if !self.cache_ready {
            self.dynamic_patterns.is_some()
        } else {
            self.has_dynamic_patterns
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
    #[serde(skip)]
    dense_lookup: Option<Vec<usize>>,
}

impl Registry {
    pub fn new(blocks_by_id: Vec<(u32, Block)>) -> Self {
        Self {
            blocks_by_id,
            lookup_cache: None,
            dense_lookup: None,
        }
    }

    pub fn build_cache(&mut self) {
        let mut cache = HashMap::with_capacity(self.blocks_by_id.len());
        let mut max_id = 0u32;
        for (idx, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            cache.insert(*id, idx);
            if *id > max_id {
                max_id = *id;
            }
            block.compute_name_lower();
        }
        self.lookup_cache = Some(cache);

        let dense_limit = self.blocks_by_id.len().saturating_mul(16);
        if (max_id as usize) <= dense_limit {
            let mut dense = vec![usize::MAX; max_id as usize + 1];
            for (idx, (id, _)) in self.blocks_by_id.iter().enumerate() {
                dense[*id as usize] = idx;
            }
            self.dense_lookup = Some(dense);
        } else {
            self.dense_lookup = None;
        }
    }

    #[inline(always)]
    pub fn get_block_by_id(&self, id: u32) -> Option<&Block> {
        if let Some(dense) = &self.dense_lookup {
            if let Some(&idx) = dense.get(id as usize) {
                if idx != usize::MAX {
                    return Some(&self.blocks_by_id[idx].1);
                }
            }
            None
        } else if let Some(cache) = &self.lookup_cache {
            cache.get(&id).map(|&idx| &self.blocks_by_id[idx].1)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block)
        }
    }

    #[inline(always)]
    pub fn has_type(&self, id: u32) -> bool {
        if let Some(dense) = &self.dense_lookup {
            dense
                .get(id as usize)
                .map(|idx| *idx != usize::MAX)
                .unwrap_or(false)
        } else if let Some(cache) = &self.lookup_cache {
            cache.contains_key(&id)
        } else {
            self.blocks_by_id
                .iter()
                .any(|(block_id, _)| *block_id == id)
        }
    }

    #[inline(always)]
    pub fn is_opaque_id(&self, id: u32) -> bool {
        if let Some(dense) = &self.dense_lookup {
            if let Some(&idx) = dense.get(id as usize) {
                return idx != usize::MAX && self.blocks_by_id[idx].1.is_opaque;
            }
            false
        } else if let Some(cache) = &self.lookup_cache {
            cache
                .get(&id)
                .map(|&idx| self.blocks_by_id[idx].1.is_opaque)
                .unwrap_or(false)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block.is_opaque)
                .unwrap_or(false)
        }
    }

    #[inline(always)]
    pub fn is_empty_id(&self, id: u32) -> bool {
        if let Some(dense) = &self.dense_lookup {
            if let Some(&idx) = dense.get(id as usize) {
                return idx != usize::MAX && self.blocks_by_id[idx].1.is_empty;
            }
            false
        } else if let Some(cache) = &self.lookup_cache {
            cache
                .get(&id)
                .map(|&idx| self.blocks_by_id[idx].1.is_empty)
                .unwrap_or(false)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block.is_empty)
                .unwrap_or(false)
        }
    }

    #[inline(always)]
    pub fn has_type_and_is_opaque(&self, id: u32) -> (bool, bool) {
        if let Some(dense) = &self.dense_lookup {
            if let Some(&idx) = dense.get(id as usize) {
                if idx != usize::MAX {
                    return (true, self.blocks_by_id[idx].1.is_opaque);
                }
            }
            (false, false)
        } else if let Some(cache) = &self.lookup_cache {
            if let Some(&idx) = cache.get(&id) {
                (true, self.blocks_by_id[idx].1.is_opaque)
            } else {
                (false, false)
            }
        } else if let Some((_, block)) = self
            .blocks_by_id
            .iter()
            .find(|(block_id, _)| *block_id == id)
        {
            (true, block.is_opaque)
        } else {
            (false, false)
        }
    }

    #[inline(always)]
    pub fn has_type_and_opaque_and_empty(&self, id: u32) -> (bool, bool, bool) {
        if let Some(dense) = &self.dense_lookup {
            if let Some(&idx) = dense.get(id as usize) {
                if idx != usize::MAX {
                    let block = &self.blocks_by_id[idx].1;
                    return (true, block.is_opaque, block.is_empty);
                }
            }
            (false, false, false)
        } else if let Some(cache) = &self.lookup_cache {
            if let Some(&idx) = cache.get(&id) {
                let block = &self.blocks_by_id[idx].1;
                (true, block.is_opaque, block.is_empty)
            } else {
                (false, false, false)
            }
        } else if let Some((_, block)) = self
            .blocks_by_id
            .iter()
            .find(|(block_id, _)| *block_id == id)
        {
            (true, block.is_opaque, block.is_empty)
        } else {
            (false, false, false)
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
const FLUID_CORNER_NXNZ: [[i32; 2]; 3] = [[-1, 0], [0, -1], [-1, -1]];
const FLUID_CORNER_PXNZ: [[i32; 2]; 3] = [[1, 0], [0, -1], [1, -1]];
const FLUID_CORNER_NXPZ: [[i32; 2]; 3] = [[-1, 0], [0, 1], [-1, 1]];
const FLUID_CORNER_PXPZ: [[i32; 2]; 3] = [[1, 0], [0, 1], [1, 1]];

struct NeighborCache {
    data: [[u32; 2]; 27],
}

impl NeighborCache {
    #[inline(always)]
    fn offset_to_index(x: i32, y: i32, z: i32) -> usize {
        ((x + 1) + (y + 1) * 3 + (z + 1) * 9) as usize
    }

    fn populate<S: VoxelAccess>(vx: i32, vy: i32, vz: i32, space: &S) -> Self {
        let mut data = [[0u32; 2]; 27];
        let mut idx = 0usize;
        for z in -1..=1 {
            let sample_z = vz + z;
            for y in -1..=1 {
                let sample_y = vy + y;
                for x in -1..=1 {
                    let sample_x = vx + x;
                    let (raw_voxel, raw_light) =
                        space.get_raw_voxel_and_raw_light(sample_x, sample_y, sample_z);
                    data[idx][0] = raw_voxel;
                    data[idx][1] = raw_light;
                    idx += 1;
                }
            }
        }

        Self { data }
    }

    #[inline(always)]
    fn get_raw_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][0]
    }

    #[inline(always)]
    fn get_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        extract_id(self.get_raw_voxel(dx, dy, dz))
    }

    #[inline(always)]
    fn get_raw_light(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][1]
    }
}

#[inline(always)]
fn build_neighbor_opaque_mask(neighbors: &NeighborCache, registry: &Registry) -> [bool; 27] {
    let mut mask = [false; 27];
    for (idx, entry) in neighbors.data.iter().enumerate() {
        mask[idx] = registry.is_opaque_id(entry[0] & 0xFFFF);
    }
    mask
}

#[inline(always)]
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

    #[inline(always)]
    fn get_index(&self, chunk: &ChunkData, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        if vy < 0 {
            return None;
        }
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

    #[inline(always)]
    fn get_raw_voxel_and_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, (u32, u32, u32, u32)) {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                let raw_voxel = chunk.voxels[index];
                return (raw_voxel, LightUtils::extract_all(chunk.lights[index]));
            }
        }
        (0, (0, 0, 0, 0))
    }

    #[inline(always)]
    fn get_raw_voxel_and_raw_light(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32) {
        let coords = self.map_voxel_to_chunk(vx, vz);
        if let Some(chunk) = self.get_chunk(coords) {
            if let Some(index) = self.get_index(chunk, vx, vy, vz) {
                return (chunk.voxels[index], chunk.lights[index]);
            }
        }
        (0, 0)
    }

    #[inline(always)]
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let raw = self.get_raw_voxel(vx, vy, vz);
        let rotation = (raw >> 16) & 0xF;
        let y_rotation = (raw >> 20) & 0xF;
        BlockRotation::encode(rotation, y_rotation)
    }

    #[inline(always)]
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
        if vy < 0 {
            return false;
        }
        let coords = self.map_voxel_to_chunk(vx, vz);
        self.get_chunk(coords).is_some()
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

    fn get_raw_voxel_and_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, (u32, u32, u32, u32)) {
        VoxelSpace::get_raw_voxel_and_lights(self, vx, vy, vz)
    }

    fn get_raw_voxel_and_raw_light(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32) {
        VoxelSpace::get_raw_voxel_and_raw_light(self, vx, vy, vz)
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

#[inline(always)]
fn extract_id(voxel: u32) -> u32 {
    voxel & 0xFFFF
}

#[inline(always)]
fn extract_rotation(voxel: u32) -> BlockRotation {
    let rotation = (voxel >> 16) & 0xF;
    let y_rotation = (voxel >> 20) & 0xF;
    BlockRotation::encode(rotation, y_rotation)
}

#[inline(always)]
fn extract_stage(voxel: u32) -> u32 {
    (voxel >> 24) & 0xF
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

#[inline(always)]
fn has_channel_midpoint_anomaly(a: u32, b: u32, c: u32, d: u32) -> bool {
    let ad_sum = a + d;
    (2 * b > ad_sum && ad_sum > 2 * c) || (2 * c > ad_sum && ad_sum > 2 * b)
}

#[inline(always)]
fn pack_light_nibbles(sunlight: u32, red: u32, green: u32, blue: u32) -> u32 {
    ((sunlight & 0xF) << 12) | ((red & 0xF) << 8) | ((green & 0xF) << 4) | (blue & 0xF)
}

#[inline(always)]
fn get_fluid_effective_height(stage: u32) -> f32 {
    (FLUID_BASE_HEIGHT - (stage as f32 * FLUID_STAGE_DROPOFF)).max(0.1)
}

#[inline(always)]
fn has_fluid_above<S: VoxelAccess>(vx: i32, vy: i32, vz: i32, fluid_id: u32, space: &S) -> bool {
    extract_id(space.get_raw_voxel(vx, vy + 1, vz)) == fluid_id
}

#[inline(always)]
fn get_fluid_height_at<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &S,
) -> Option<f32> {
    let raw_voxel = space.get_raw_voxel(vx, vy, vz);
    if extract_id(raw_voxel) == fluid_id {
        let stage = extract_stage(raw_voxel);
        Some(get_fluid_effective_height(stage))
    } else {
        None
    }
}

fn calculate_fluid_corner_height<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    self_height: f32,
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
        if extract_id(space.get_raw_voxel(vx + dx, vy + 1, vz + dz)) == fluid_id {
            return 1.0;
        }
    }

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
            let neighbor_id = extract_id(space.get_raw_voxel(nx, vy, nz));
            let (neighbor_has_type, _, neighbor_is_empty) =
                registry.has_type_and_opaque_and_empty(neighbor_id);
            if neighbor_has_type {
                if neighbor_is_empty {
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
            "py" => uvs[0] = face.range,
            "ny" => uvs[1] = face.range,
            "px" => uvs[2] = face.range,
            "nx" => uvs[3] = face.range,
            "pz" => uvs[4] = face.range,
            "nz" => uvs[5] = face.range,
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
) -> [BlockFace; 6] {
    let self_height = get_fluid_effective_height(extract_stage(space.get_raw_voxel(vx, vy, vz)));
    let h_nxnz =
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            self_height,
            0,
            0,
            &FLUID_CORNER_NXNZ,
            fluid_id,
            space,
            registry,
        )
            - FLUID_SURFACE_OFFSET;
    let h_pxnz =
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            self_height,
            1,
            0,
            &FLUID_CORNER_PXNZ,
            fluid_id,
            space,
            registry,
        )
            - FLUID_SURFACE_OFFSET;
    let h_nxpz =
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            self_height,
            0,
            1,
            &FLUID_CORNER_NXPZ,
            fluid_id,
            space,
            registry,
        )
            - FLUID_SURFACE_OFFSET;
    let h_pxpz =
        calculate_fluid_corner_height(
            vx,
            vy,
            vz,
            self_height,
            1,
            1,
            &FLUID_CORNER_PXPZ,
            fluid_id,
            space,
            registry,
        )
            - FLUID_SURFACE_OFFSET;

    let fallback_uvs;
    let standard_uvs = if let Some(uvs) = block.fluid_face_uvs.as_ref() {
        uvs
    } else {
        fallback_uvs = standard_face_uvs(&block.faces);
        &fallback_uvs
    };

    [
        BlockFace {
            name: "py".to_string(),
            name_lower: String::new(),
            dir: [0, 1, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[0],
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
            name_lower: String::new(),
            dir: [0, -1, 0],
            independent: false,
            isolated: false,
            texture_group: None,
            range: standard_uvs[1],
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
            name_lower: String::new(),
            dir: [1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[2],
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
            name_lower: String::new(),
            dir: [-1, 0, 0],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[3],
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
            name_lower: String::new(),
            dir: [0, 0, 1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[4],
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
            name_lower: String::new(),
            dir: [0, 0, -1],
            independent: true,
            isolated: false,
            texture_group: None,
            range: standard_uvs[5],
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

#[inline(always)]
fn can_greedy_mesh_block(block: &Block) -> bool {
    if block.cache_ready {
        block.greedy_mesh_eligible_no_rotation
    } else {
        block.can_greedy_mesh_without_rotation()
    }
}

#[inline(always)]
fn face_name_owned(face: &BlockFace) -> String {
    if face.name_lower.is_empty() {
        face.name.clone()
    } else {
        face.name_lower.clone()
    }
}

#[inline(always)]
fn geometry_key_for_face(block: &Block, face: &BlockFace, vx: i32, vy: i32, vz: i32) -> GeometryMapKey {
    if face.isolated {
        GeometryMapKey::Isolated(block.id, face_name_owned(face), vx, vy, vz)
    } else if face.independent {
        GeometryMapKey::Face(block.id, face_name_owned(face))
    } else {
        GeometryMapKey::Block(block.id)
    }
}

#[inline(always)]
fn geometry_key_for_quad(block: &Block, face_name: Option<&str>, independent: bool) -> GeometryMapKey {
    if independent {
        let name = face_name.expect("independent greedy quad must include a face name");
        GeometryMapKey::Face(block.id, name.to_string())
    } else {
        GeometryMapKey::Block(block.id)
    }
}

#[inline(always)]
fn block_min_corner(block: &Block) -> [f32; 3] {
    if block.cache_ready {
        block.block_min_cached
    } else if block.is_full_cube() {
        [0.0, 0.0, 0.0]
    } else {
        let block_aabb = AABB::union_all(&block.aabbs);
        [block_aabb.min_x, block_aabb.min_y, block_aabb.min_z]
    }
}

#[inline(always)]
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
) -> bool {
    let is_opaque = block.is_opaque;
    if !see_through && !is_opaque {
        return true;
    }

    let nvx = vx + dir[0];
    let nvy = vy + dir[1];
    let nvz = vz + dir[2];

    let neighbor_id = extract_id(space.get_raw_voxel(nvx, nvy, nvz));

    if !see_through {
        let (neighbor_has_type, neighbor_is_opaque) = registry.has_type_and_is_opaque(neighbor_id);
        if neighbor_is_opaque {
            return false;
        }
        if neighbor_has_type {
            return true;
        }
        return !space.contains(nvx, nvy, nvz);
    }

    if neighbor_id == voxel_id {
        return !is_opaque && block.transparent_standalone;
    }

    let (neighbor_has_type, neighbor_is_opaque) = registry.has_type_and_is_opaque(neighbor_id);

    if neighbor_is_opaque {
        return false;
    }
    if !neighbor_has_type {
        return !space.contains(nvx, nvy, nvz);
    }
    if !is_opaque {
        return true;
    }
    registry.is_empty_id(neighbor_id)
}

#[inline(always)]
fn is_surrounded_by_opaque_neighbors<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    space: &S,
    registry: &Registry,
) -> bool {
    registry.is_opaque_id(extract_id(space.get_raw_voxel(vx + 1, vy, vz)))
        && registry.is_opaque_id(extract_id(space.get_raw_voxel(vx - 1, vy, vz)))
        && registry.is_opaque_id(extract_id(space.get_raw_voxel(vx, vy + 1, vz)))
        && registry.is_opaque_id(extract_id(space.get_raw_voxel(vx, vy - 1, vz)))
        && registry.is_opaque_id(extract_id(space.get_raw_voxel(vx, vy, vz + 1)))
        && registry.is_opaque_id(extract_id(space.get_raw_voxel(vx, vy, vz - 1)))
}

#[inline(always)]
fn compute_face_ao_and_light(
    dir: [i32; 3],
    block: &Block,
    neighbors: &NeighborCache,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let is_see_through = block.is_see_through;
    let is_all_transparent = block.is_all_transparent;
    if is_see_through || is_all_transparent {
        let light = (neighbors.get_raw_light(0, 0, 0) & 0xFFFF) as i32;
        return ([3, 3, 3, 3], [light; 4]);
    }
    let [block_min_x, block_min_y, block_min_z] = block_min_corner(block);
    let opaque_mask = build_neighbor_opaque_mask(neighbors, registry);

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
    let dir_is_x = dir[0].abs() == 1;
    let dir_is_y = dir[1].abs() == 1;
    let center_opaque = neighbor_is_opaque(&opaque_mask, 0, 0, 0);

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

        let b011 = !neighbor_is_opaque(&opaque_mask, 0, dy, dz);
        let b101 = !neighbor_is_opaque(&opaque_mask, dx, 0, dz);
        let b110 = !neighbor_is_opaque(&opaque_mask, dx, dy, 0);
        let b111 = !neighbor_is_opaque(&opaque_mask, dx, dy, dz);

        let ao = if dir_is_x {
            vertex_ao(b110, b101, b111)
        } else if dir_is_y {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let (sunlight, red_light, green_light, blue_light) = {
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

                        let diagonal4_opaque = neighbor_is_opaque(&opaque_mask, ddx, ddy, ddz);

                        if diagonal4_opaque {
                            continue;
                        }

                        let is_face_plane_sample = if dir_is_x {
                            ddx == 0
                        } else if dir_is_y {
                            ddy == 0
                        } else {
                            ddz == 0
                        };
                        if is_face_plane_sample && center_opaque {
                            continue;
                        }

                        if x + y + z == 3 {
                            let diagonal_yz_opaque = neighbor_is_opaque(&opaque_mask, 0, ddy, ddz);
                            let diagonal_xz_opaque = neighbor_is_opaque(&opaque_mask, ddx, 0, ddz);
                            let diagonal_xy_opaque = neighbor_is_opaque(&opaque_mask, ddx, ddy, 0);

                            if diagonal_yz_opaque && diagonal_xz_opaque && diagonal_xy_opaque {
                                continue;
                            }

                            if diagonal_xy_opaque && diagonal_xz_opaque {
                                let neighbor_y_opaque = neighbor_is_opaque(&opaque_mask, 0, ddy, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(&opaque_mask, 0, 0, ddz);
                                if neighbor_y_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(&opaque_mask, ddx, 0, 0);
                                let neighbor_z_opaque = neighbor_is_opaque(&opaque_mask, 0, 0, ddz);
                                if neighbor_x_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = neighbor_is_opaque(&opaque_mask, ddx, 0, 0);
                                let neighbor_y_opaque = neighbor_is_opaque(&opaque_mask, 0, ddy, 0);
                                if neighbor_x_opaque && neighbor_y_opaque {
                                    continue;
                                }
                            }
                        }

                        let local_light = neighbors.get_raw_light(ddx, ddy, ddz);
                        if local_light == 0 {
                            continue;
                        }
                        let local_sunlight = (local_light >> 12) & 0xF;
                        let local_red_light = (local_light >> 8) & 0xF;
                        let local_green_light = (local_light >> 4) & 0xF;
                        let local_blue_light = local_light & 0xF;

                        sum_sunlights += local_sunlight;
                        sum_red_lights += local_red_light;
                        sum_green_lights += local_green_light;
                        sum_blue_lights += local_blue_light;
                        light_count += 1;
                    }
                }
            }

            if light_count > 0 {
                (
                    sum_sunlights / light_count,
                    sum_red_lights / light_count,
                    sum_green_lights / light_count,
                    sum_blue_lights / light_count,
                )
            } else {
                (0, 0, 0, 0)
            }
        };

        aos[i] = ao;
        lights[i] = pack_light_nibbles(sunlight, red_light, green_light, blue_light) as i32;
    }

    (aos, lights)
}

#[inline(always)]
fn compute_face_ao_and_light_fast(
    dir: [i32; 3],
    block: &Block,
    neighbors: &NeighborCache,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let is_see_through = block.is_see_through;
    let is_all_transparent = block.is_all_transparent;
    let skip_opaque_checks = is_see_through || is_all_transparent;
    if skip_opaque_checks {
        let light = (neighbors.get_raw_light(0, 0, 0) & 0xFFFF) as i32;
        return ([3, 3, 3, 3], [light; 4]);
    }
    let (block_min_x, block_min_y, block_min_z) = if block.cache_ready {
        (
            block.block_min_cached[0],
            block.block_min_cached[1],
            block.block_min_cached[2],
        )
    } else if block.is_full_cube() {
        (0.0, 0.0, 0.0)
    } else {
        let block_aabb = AABB::union_all(&block.aabbs);
        (block_aabb.min_x, block_aabb.min_y, block_aabb.min_z)
    };
    let opaque_mask = build_neighbor_opaque_mask(neighbors, registry);
    let dir_is_x = dir[0].abs() == 1;
    let dir_is_y = dir[1].abs() == 1;
    let block_min_x_eps = block_min_x + 0.01;
    let block_min_y_eps = block_min_y + 0.01;
    let block_min_z_eps = block_min_z + 0.01;

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
    let mask = &opaque_mask;
    let center_opaque = neighbor_is_opaque(mask, 0, 0, 0);

    for (i, pos) in corner_positions.iter().enumerate() {
        let dx = if pos[0] <= block_min_x_eps {
            -1
        } else {
            1
        };
        let dy = if pos[1] <= block_min_y_eps {
            -1
        } else {
            1
        };
        let dz = if pos[2] <= block_min_z_eps {
            -1
        } else {
            1
        };

        let b011 = !neighbor_is_opaque(mask, 0, dy, dz);
        let b101 = !neighbor_is_opaque(mask, dx, 0, dz);
        let b110 = !neighbor_is_opaque(mask, dx, dy, 0);
        let b111 = !neighbor_is_opaque(mask, dx, dy, dz);

        let ao = if dir_is_x {
            vertex_ao(b110, b101, b111)
        } else if dir_is_y {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

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

                    let diagonal4_opaque = neighbor_is_opaque(mask, ddx, ddy, ddz);

                    if diagonal4_opaque {
                        continue;
                    }

                    let is_face_plane_sample = if dir_is_x {
                        ddx == 0
                    } else if dir_is_y {
                        ddy == 0
                    } else {
                        ddz == 0
                    };
                    if is_face_plane_sample && center_opaque {
                        continue;
                    }

                    if x + y + z == 3 {
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

                    let local_light = neighbors.get_raw_light(ddx, ddy, ddz);
                    if local_light == 0 {
                        continue;
                    }
                    let local_sunlight = (local_light >> 12) & 0xF;
                    let local_red_light = (local_light >> 8) & 0xF;
                    let local_green_light = (local_light >> 4) & 0xF;
                    let local_blue_light = local_light & 0xF;

                    sum_sunlights += local_sunlight;
                    sum_red_lights += local_red_light;
                    sum_green_lights += local_green_light;
                    sum_blue_lights += local_blue_light;
                    count += 1;
                }
            }
        }

        let (sunlight, red_light, green_light, blue_light) = if count > 0 {
            (
                sum_sunlights / count,
                sum_red_lights / count,
                sum_green_lights / count,
                sum_blue_lights / count,
            )
        } else {
            (0, 0, 0, 0)
        };

        aos[i] = ao;
        lights[i] = pack_light_nibbles(sunlight, red_light, green_light, blue_light) as i32;
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
    let width = (max_u - min_u).max(0) as usize;
    let height = (max_v - min_v).max(0) as usize;
    let estimated_cells = width * height;
    let mut quads = Vec::with_capacity((estimated_cells / 2).max(16));
    for v_off in 0..height {
        for u_off in 0..width {
            let start_index = v_off * width + u_off;
            if let Some(data) = mask[start_index].take() {
                let mut quad_width = 1usize;
                while u_off + quad_width < width {
                    let neighbor_index = start_index + quad_width;
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

                let mut quad_height = 1usize;
                'height: while v_off + quad_height < height {
                    let row_start = (v_off + quad_height) * width + u_off;
                    for du in 0..quad_width {
                        let neighbor_index = row_start + du;
                        if let Some(neighbor) = mask[neighbor_index].as_ref() {
                            if neighbor.key != data.key {
                                break 'height;
                            }
                        } else {
                            break 'height;
                        }
                    }

                    for du in 0..quad_width {
                        let neighbor_index = row_start + du;
                        mask[neighbor_index] = None;
                    }
                    quad_height += 1;
                }

                quads.push(GreedyQuad {
                    x: min_u + u_off as i32,
                    y: min_v + v_off as i32,
                    w: quad_width as i32,
                    h: quad_height as i32,
                    data,
                });
            }
        }
    }

    quads
}

#[inline(always)]
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
    let uv_span_u = end_u - start_u;
    let uv_span_v = end_v - start_v;

    let scale = if is_opaque { 0.0 } else { 0.0001 };
    let min_x_f = min_x as f32;
    let min_y_f = min_y as f32;
    let min_z_f = min_z as f32;
    let dir_scale_x = dir[0] as f32 * scale;
    let dir_scale_y = dir[1] as f32 * scale;
    let dir_scale_z = dir[2] as f32 * scale;
    let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
    let light_flags = fluid_bit | (1 << 19);

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

    let face_aos = quad.data.key.ao;
    let face_lights = quad.data.key.light;
    let ndx = (geometry.positions.len() / 3) as i32;

    for i in 0..4 {
        let pos = corners[i];
        geometry.positions.push(pos[0] - min_x_f - dir_scale_x);
        geometry.positions.push(pos[1] - min_y_f - dir_scale_y);
        geometry.positions.push(pos[2] - min_z_f - dir_scale_z);

        let u = uv_corners[i][0] * uv_span_u + start_u;
        let v = uv_corners[i][1] * uv_span_v + start_v;
        geometry.uvs.push(u);
        geometry.uvs.push(v);

        let ao = face_aos[i];
        let light = face_lights[i];
        geometry.lights.push(light | (ao << 16) | light_flags);
    }

    if face_aos[0] == face_aos[1]
        && face_aos[1] == face_aos[2]
        && face_aos[2] == face_aos[3]
        && face_lights[0] == face_lights[1]
        && face_lights[1] == face_lights[2]
        && face_lights[2] == face_lights[3]
    {
        geometry.indices.push(ndx);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 3);
        return;
    }

    let ao_diag_sum = face_aos[0] + face_aos[3];
    let ao_off_sum = face_aos[1] + face_aos[2];
    let should_flip = if ao_diag_sum > ao_off_sum {
        true
    } else {
        let light0 = face_lights[0] as u32;
        let light1 = face_lights[1] as u32;
        let light2 = face_lights[2] as u32;
        let light3 = face_lights[3] as u32;
        let a_rt = (light0 >> 8) & 0xF;
        let b_rt = (light1 >> 8) & 0xF;
        let c_rt = (light2 >> 8) & 0xF;
        let d_rt = (light3 >> 8) & 0xF;

        let a_gt = (light0 >> 4) & 0xF;
        let b_gt = (light1 >> 4) & 0xF;
        let c_gt = (light2 >> 4) & 0xF;
        let d_gt = (light3 >> 4) & 0xF;

        let a_bt = light0 & 0xF;
        let b_bt = light1 & 0xF;
        let c_bt = light2 & 0xF;
        let d_bt = light3 & 0xF;

        let one_tr0 = a_rt == 0 || b_rt == 0 || c_rt == 0 || d_rt == 0;
        let one_tg0 = a_gt == 0 || b_gt == 0 || c_gt == 0 || d_gt == 0;
        let one_tb0 = a_bt == 0 || b_bt == 0 || c_bt == 0 || d_bt == 0;

        let fequals = ao_diag_sum == ao_off_sum;
        let ozao_r = fequals && a_rt + d_rt < b_rt + c_rt;
        let ozao_g = fequals && a_gt + d_gt < b_gt + c_gt;
        let ozao_b = fequals && a_bt + d_bt < b_bt + c_bt;

        let anz_r = one_tr0 && has_channel_midpoint_anomaly(a_rt, b_rt, c_rt, d_rt);
        let anz_g = one_tg0 && has_channel_midpoint_anomaly(a_gt, b_gt, c_gt, d_gt);
        let anz_b = one_tb0 && has_channel_midpoint_anomaly(a_bt, b_bt, c_bt, d_bt);

        (ozao_r || ozao_g || ozao_b) || (anz_r || anz_g || anz_b)
    };

    if should_flip {
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

#[inline(always)]
fn rotation_radians(rotation: &BlockRotation) -> f32 {
    match rotation {
        BlockRotation::PX(rot) => *rot,
        BlockRotation::NX(rot) => *rot,
        BlockRotation::PY(rot) => *rot,
        BlockRotation::NY(rot) => *rot,
        BlockRotation::PZ(rot) => *rot,
        BlockRotation::NZ(rot) => *rot,
    }
}

#[inline(always)]
fn evaluate_block_rule_with_trig<S: VoxelAccess>(
    rule: &BlockRule,
    pos: [i32; 3],
    space: &S,
    rotation_trig: Option<(f32, f32)>,
) -> bool {
    match rule {
        BlockRule::None => true,
        BlockRule::Simple(simple) => {
            if simple.id.is_none() && simple.rotation.is_none() && simple.stage.is_none() {
                return true;
            }

            let [offset_x, offset_y, offset_z] = simple.offset;
            let (check_x, check_y, check_z) = if let Some((sin_rot, cos_rot)) = rotation_trig {
                if offset_x != 0 || offset_z != 0 {
                    let x = offset_x as f32;
                    let z = offset_z as f32;
                    (
                        pos[0] + (x * cos_rot - z * sin_rot).round() as i32,
                        pos[1] + offset_y,
                        pos[2] + (x * sin_rot + z * cos_rot).round() as i32,
                    )
                } else {
                    (pos[0] + offset_x, pos[1] + offset_y, pos[2] + offset_z)
                }
            } else {
                (pos[0] + offset_x, pos[1] + offset_y, pos[2] + offset_z)
            };
            let has_expected_rotation = simple.rotation.is_some();
            let has_expected_stage = simple.stage.is_some();
            let raw_voxel = space.get_raw_voxel(check_x, check_y, check_z);

            if let Some(expected_id) = simple.id {
                let actual_id = extract_id(raw_voxel);
                if actual_id != expected_id {
                    return false;
                }

                if !has_expected_rotation && !has_expected_stage {
                    return true;
                }
            }

            if let Some(expected_rotation) = &simple.rotation {
                let (expected_rotation_code, expected_y_rotation_code) =
                    BlockRotation::decode(expected_rotation);
                let actual_rotation_code = (raw_voxel >> 16) & 0xF;
                let actual_y_rotation_code = (raw_voxel >> 20) & 0xF;
                if actual_rotation_code != expected_rotation_code
                    || actual_y_rotation_code != expected_y_rotation_code
                {
                    return false;
                }
            }

            if let Some(expected_stage) = simple.stage {
                let actual_stage = (raw_voxel >> 24) & 0xF;
                if actual_stage != expected_stage {
                    return false;
                }
            }

            true
        }
        BlockRule::Combination { logic, rules } => match logic {
            BlockRuleLogic::And => {
                for nested_rule in rules {
                    if !evaluate_block_rule_with_trig(
                        nested_rule,
                        pos,
                        space,
                        rotation_trig,
                    ) {
                        return false;
                    }
                }
                true
            }
            BlockRuleLogic::Or => {
                for nested_rule in rules {
                    if evaluate_block_rule_with_trig(
                        nested_rule,
                        pos,
                        space,
                        rotation_trig,
                    ) {
                        return true;
                    }
                }
                false
            }
            BlockRuleLogic::Not => {
                if let Some(first) = rules.first() {
                    !evaluate_block_rule_with_trig(first, pos, space, rotation_trig)
                } else {
                    true
                }
            }
        },
    }
}

fn visit_dynamic_faces<S, F>(
    block: &Block,
    pos: [i32; 3],
    space: &S,
    rotation: &BlockRotation,
    mut visitor: F,
)
where
    S: VoxelAccess,
    F: FnMut(&BlockFace, bool),
{
    let mut local_rotation_trig = None;

    if let Some(dynamic_patterns) = &block.dynamic_patterns {
        for pattern in dynamic_patterns {
            let mut matched_rule = false;

            for part in &pattern.parts {
                let rotation_trig = if part.world_space {
                    None
                } else {
                    *local_rotation_trig.get_or_insert_with(|| {
                        if block.y_rotatable {
                            let rotation_rad = rotation_radians(rotation);
                            if rotation_rad.abs() > f32::EPSILON {
                                let (sin_rot, cos_rot) = rotation_rad.sin_cos();
                                Some((sin_rot, cos_rot))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    })
                };
                let rule_result = evaluate_block_rule_with_trig(
                    &part.rule,
                    pos,
                    space,
                    rotation_trig,
                );
                if rule_result {
                    matched_rule = true;
                    for face in &part.faces {
                        visitor(face, part.world_space);
                    }
                }
            }

            if matched_rule {
                return;
            }
        }
    }

    for face in &block.faces {
        visitor(face, false);
    }
}

struct FaceProcessCache {
    opaque_mask: Option<[bool; 27]>,
    center_light: Option<u32>,
    fluid_surface_above: bool,
    block_min: [f32; 3],
}

#[inline(always)]
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

    let center_light = if is_see_through || is_all_transparent {
        Some(neighbors.get_raw_light(0, 0, 0) & 0xFFFF)
    } else {
        None
    };

    FaceProcessCache {
        opaque_mask: if !(is_see_through || is_all_transparent) {
            Some(build_neighbor_opaque_mask(neighbors, registry))
        } else {
            None
        },
        center_light,
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
    cache: &FaceProcessCache,
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
    let rotatable = block.rotatable;
    let y_rotatable = block.y_rotatable;
    let needs_rotation = (rotatable || y_rotatable) && !world_space;
    let is_all_transparent = block.is_all_transparent;
    let dir = if needs_rotation {
        let mut rotated_dir = [face.dir[0] as f32, face.dir[1] as f32, face.dir[2] as f32];
        rotation.rotate_node(&mut rotated_dir, y_rotatable, false);
        [
            rotated_dir[0].round() as i32,
            rotated_dir[1].round() as i32,
            rotated_dir[2].round() as i32,
        ]
    } else {
        face.dir
    };

    let should_mesh = if !is_fluid && !see_through && !is_opaque {
        true
    } else {
        let neighbor_id = if !needs_rotation {
            neighbors.get_voxel(dir[0], dir[1], dir[2])
        } else {
            let rotated_dir_in_cache =
                dir[0] >= -1 && dir[0] <= 1 && dir[1] >= -1 && dir[1] <= 1 && dir[2] >= -1 && dir[2] <= 1;
            if rotated_dir_in_cache {
                neighbors.get_voxel(dir[0], dir[1], dir[2])
            } else {
                extract_id(space.get_raw_voxel(vx + dir[0], vy + dir[1], vz + dir[2]))
            }
        };

        if !is_fluid {
            if !see_through {
                !registry.is_opaque_id(neighbor_id)
            } else if !is_opaque {
                if neighbor_id == voxel_id {
                    block.transparent_standalone
                } else {
                    let (neighbor_has_type, neighbor_is_opaque) =
                        registry.has_type_and_is_opaque(neighbor_id);
                    !neighbor_is_opaque && neighbor_has_type
                }
            } else {
                registry.is_empty_id(neighbor_id)
            }
        } else {
            if registry.is_empty_id(neighbor_id) {
                true
            } else {
                let n_block_type = match registry.get_block_by_id(neighbor_id) {
                    Some(b) => b,
                    None => return,
                };

                if !block.is_waterlogged && n_block_type.is_waterlogged {
                    return;
                }

                if n_block_type.occludes_fluid {
                    return;
                }

                (see_through
                    && !is_opaque
                    && !n_block_type.is_opaque
                    && (neighbor_id != voxel_id || n_block_type.transparent_standalone))
                    || (!see_through && (!is_opaque || !n_block_type.is_opaque))
                    || (n_block_type.is_opaque
                        && !n_block_type.is_fluid
                        && !cache.fluid_surface_above
                        && (!n_block_type.is_full_cube() || dir == [0, 1, 0]))
            }
        }
    };

    if !should_mesh {
        return;
    }

    let start_u = uv_range.start_u;
    let end_u = uv_range.end_u;
    let start_v = uv_range.start_v;
    let end_v = uv_range.end_v;
    let uv_span_u = end_u - start_u;
    let uv_span_v = end_v - start_v;

    let ndx = (positions.len() / 3) as i32;

    let block_min = cache.block_min;
    let block_min_y_eps = block_min[1] + 0.01;
    let skip_opaque_checks = see_through || is_all_transparent;
    let needs_opaque_checks = !skip_opaque_checks;
    let opaque_mask = if needs_opaque_checks {
        cache.opaque_mask.as_ref()
    } else {
        None
    };
    let fluid_surface_above = cache.fluid_surface_above;
    let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
    let apply_wave_bit = is_fluid && !fluid_surface_above;

    let is_diagonal = dir == [0, 0, 0];
    let has_diagonals = see_through
        && if block.cache_ready {
            block.has_diagonal_faces
        } else {
            block.has_diagonal_faces_cached()
        };
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
    let base_x = vx as f32 - min_x as f32 - dir[0] as f32 * face_inset + diag_x_offset;
    let base_y = vy as f32 - min_y as f32 - dir[1] as f32 * face_inset;
    let base_z = vz as f32 - min_z as f32 - dir[2] as f32 * face_inset + diag_z_offset;

    if skip_opaque_checks {
        let center_light_i32 = cache
            .center_light
            .expect("center light exists when opaque checks are skipped")
            as i32;
        let base_light_i32 = center_light_i32 | 3 << 16 | fluid_bit;
        for corner in &face.corners {
            let mut pos = corner.pos;

            if needs_rotation {
                rotation.rotate_node(&mut pos, y_rotatable, true);
            }

            positions.push(pos[0] + base_x);
            positions.push(pos[1] + base_y);
            positions.push(pos[2] + base_z);

            uvs.push(corner.uv[0] * uv_span_u + start_u);
            uvs.push(corner.uv[1] * uv_span_v + start_v);

            let wave_bit = if apply_wave_bit && pos[1] > block_min_y_eps {
                1 << 20
            } else {
                0
            };
            lights.push(base_light_i32 | wave_bit);
        }
    } else {
        let mut face_aos = [0i32; 4];
        let mut four_red_lights = [0u32; 4];
        let mut four_green_lights = [0u32; 4];
        let mut four_blue_lights = [0u32; 4];
        let mask = opaque_mask.expect("opaque mask exists when opaque checks are needed");
        let dir_is_x = dir[0].abs() == 1;
        let dir_is_y = dir[1].abs() == 1;
        let is_cardinal_dir = dir_is_x || dir_is_y || dir[2].abs() == 1;
        let center_opaque = neighbor_is_opaque(mask, 0, 0, 0);
        let block_min_x_eps = block_min[0] + 0.01;
        let block_min_z_eps = block_min[2] + 0.01;
        for (corner_index, corner) in face.corners.iter().enumerate() {
            let mut pos = corner.pos;

            if needs_rotation {
                rotation.rotate_node(&mut pos, y_rotatable, true);
            }

            positions.push(pos[0] + base_x);
            positions.push(pos[1] + base_y);
            positions.push(pos[2] + base_z);

            uvs.push(corner.uv[0] * uv_span_u + start_u);
            uvs.push(corner.uv[1] * uv_span_v + start_v);

            let dx = if pos[0] <= block_min_x_eps { -1 } else { 1 };
            let dy = if pos[1] <= block_min_y_eps { -1 } else { 1 };
            let dz = if pos[2] <= block_min_z_eps { -1 } else { 1 };

            let b011 = !neighbor_is_opaque(mask, 0, dy, dz);
            let b101 = !neighbor_is_opaque(mask, dx, 0, dz);
            let b110 = !neighbor_is_opaque(mask, dx, dy, 0);
            let b111 = !neighbor_is_opaque(mask, dx, dy, dz);
            let ao = if dir_is_x {
                vertex_ao(b110, b101, b111)
            } else if dir_is_y {
                vertex_ao(b110, b011, b111)
            } else {
                vertex_ao(b011, b101, b111)
            };
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

                        let diagonal4_opaque = neighbor_is_opaque(mask, ddx, ddy, ddz);

                        if diagonal4_opaque {
                            continue;
                        }

                        if is_cardinal_dir {
                            let is_face_plane_sample = if dir_is_x {
                                ddx == 0
                            } else if dir_is_y {
                                ddy == 0
                            } else {
                                ddz == 0
                            };
                            if is_face_plane_sample && center_opaque {
                                continue;
                            }
                        } else if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing_opaque =
                                neighbor_is_opaque(mask, ddx * dir[0], ddy * dir[1], ddz * dir[2]);

                            if facing_opaque {
                                continue;
                            }
                        }

                        if x + y + z == 3 {
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

                        let local_light = neighbors.get_raw_light(ddx, ddy, ddz);
                        if local_light == 0 {
                            continue;
                        }
                        let local_sunlight = (local_light >> 12) & 0xF;
                        let local_red_light = (local_light >> 8) & 0xF;
                        let local_green_light = (local_light >> 4) & 0xF;
                        let local_blue_light = local_light & 0xF;

                        sum_sunlights += local_sunlight;
                        sum_red_lights += local_red_light;
                        sum_green_lights += local_green_light;
                        sum_blue_lights += local_blue_light;
                        light_count += 1;
                    }
                }
            }

            let (sunlight, red_light, green_light, blue_light) = if light_count > 0 {
                (
                    sum_sunlights / light_count,
                    sum_red_lights / light_count,
                    sum_green_lights / light_count,
                    sum_blue_lights / light_count,
                )
            } else {
                (0, 0, 0, 0)
            };

            let light = pack_light_nibbles(sunlight, red_light, green_light, blue_light);
            let wave_bit = if apply_wave_bit && dy == 1 { 1 << 20 } else { 0 };
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

        let ao_diag_sum = face_aos[0] + face_aos[3];
        let ao_off_sum = face_aos[1] + face_aos[2];
        let should_flip = if ao_diag_sum > ao_off_sum {
            true
        } else {
            let one_tr0 = a_rt == 0 || b_rt == 0 || c_rt == 0 || d_rt == 0;
            let one_tg0 = a_gt == 0 || b_gt == 0 || c_gt == 0 || d_gt == 0;
            let one_tb0 = a_bt == 0 || b_bt == 0 || c_bt == 0 || d_bt == 0;

            let fequals = ao_diag_sum == ao_off_sum;
            let ozao_r = fequals && a_rt + d_rt < b_rt + c_rt;
            let ozao_g = fequals && a_gt + d_gt < b_gt + c_gt;
            let ozao_b = fequals && a_bt + d_bt < b_bt + c_bt;

            let anz_r = one_tr0 && has_channel_midpoint_anomaly(a_rt, b_rt, c_rt, d_rt);
            let anz_g = one_tg0 && has_channel_midpoint_anomaly(a_gt, b_gt, c_gt, d_gt);
            let anz_b = one_tb0 && has_channel_midpoint_anomaly(a_bt, b_bt, c_bt, d_bt);

            (ozao_r || ozao_g || ozao_b) || (anz_r || anz_g || anz_b)
        };

        indices.push(ndx);
        indices.push(ndx + 1);

        if should_flip {
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
        return;
    }

    indices.push(ndx);
    indices.push(ndx + 1);
    indices.push(ndx + 2);
    indices.push(ndx + 2);
    indices.push(ndx + 1);
    indices.push(ndx + 3);
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

                    let raw_voxel = space.get_raw_voxel(vx, vy, vz);
                    let voxel_id = extract_id(raw_voxel);
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

                    let is_non_greedy_block = !can_greedy_mesh_block(block);
                    if is_non_greedy_block && processed_non_greedy.contains(&(vx, vy, vz)) {
                        continue;
                    }

                    let cache_ready = block.cache_ready;
                    let is_fluid = block.is_fluid;
                    let is_see_through = block.is_see_through;
                    let block_needs_face_rotation = block.rotatable || block.y_rotatable;
                    let mut rotation = BlockRotation::PY(0.0);
                    if block_needs_face_rotation {
                        rotation = extract_rotation(raw_voxel);
                    }

                    let has_standard_six_faces = is_fluid
                        && if cache_ready {
                            block.has_standard_six_faces
                        } else {
                            block.has_standard_six_faces_cached()
                        };
                    let faces: Vec<(BlockFace, bool)> =
                        if has_standard_six_faces {
                            create_fluid_faces(vx, vy, vz, block.id, space, block, registry)
                                .into_iter()
                                .map(|f| (f, false))
                                .collect()
                        } else {
                            let has_dynamic_patterns = if cache_ready {
                                block.has_dynamic_patterns
                            } else {
                                block.has_dynamic_patterns_cached()
                            };
                            if has_dynamic_patterns {
                                let mut faces = Vec::with_capacity(8);
                                visit_dynamic_faces(
                                    block,
                                    [vx, vy, vz],
                                    space,
                                    &rotation,
                                    |face, world_space| {
                                    faces.push((face.clone(), world_space));
                                    },
                                );
                                faces
                            } else {
                                block.faces.iter().cloned().map(|f| (f, false)).collect()
                            }
                        };

                    if is_non_greedy_block {
                        processed_non_greedy.insert((vx, vy, vz));

                        for (face, world_space) in faces.iter() {
                            let uv_range = face.range;
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

                    let face_matches_direction = |face: &BlockFace, world_space: bool| {
                        if !block_needs_face_rotation || world_space {
                            return face.dir == dir;
                        }
                        let mut face_dir = [face.dir[0] as f32, face.dir[1] as f32, face.dir[2] as f32];
                        rotation.rotate_node(&mut face_dir, block.y_rotatable, false);
                        let effective_dir = [
                            face_dir[0].round() as i32,
                            face_dir[1].round() as i32,
                            face_dir[2].round() as i32,
                        ];
                        effective_dir == dir
                    };

                    if !faces
                        .iter()
                        .any(|(face, world_space)| face_matches_direction(face, *world_space))
                    {
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
                    );

                    if !should_render {
                        continue;
                    }

                    let mut cached_neighbors = None;
                    let mut cached_ao_light: Option<([i32; 4], [i32; 4])> = None;
                    for (face, world_space) in faces.iter() {
                        if !face_matches_direction(face, *world_space) {
                            continue;
                        }
                        let uv_range = face.range;

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

                        let (aos, lights) = *cached_ao_light.get_or_insert_with(|| {
                            let neighbors = cached_neighbors
                                .get_or_insert_with(|| NeighborCache::populate(vx, vy, vz, space));
                            compute_face_ao_and_light(dir, block, neighbors, registry)
                        });

                        let key = FaceKey {
                            block_id: block.id,
                            face_name: if face.independent {
                                Some(face_name_owned(face))
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

            let mut cached_quad_block_id = u32::MAX;
            let mut cached_quad_block: Option<&Block> = None;
            for quad in quads {
                let block_id = quad.data.key.block_id;
                let block = if cached_quad_block_id == block_id {
                    match cached_quad_block {
                        Some(block) => block,
                        None => continue,
                    }
                } else {
                    match registry.get_block_by_id(block_id) {
                        Some(block) => {
                            cached_quad_block_id = block_id;
                            cached_quad_block = Some(block);
                            block
                        }
                        None => {
                            cached_quad_block_id = block_id;
                            cached_quad_block = None;
                            continue;
                        }
                    }
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
                    &face_cache,
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
    let yz_span = y_span * z_span;
    let mut processed_non_greedy = vec![false; x_span * y_span * z_span];
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

    let mut greedy_mask: Vec<Option<FaceData>> = Vec::new();
    let identity_rotation = BlockRotation::PY(0.0);

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

        let mask_width = (u_range.1 - u_range.0) as usize;
        let mask_height = (v_range.1 - v_range.0) as usize;
        let mask_len = mask_width * mask_height;
        if greedy_mask.len() < mask_len {
            greedy_mask.resize(mask_len, None);
        }

        for slice in slice_range {
            for u in u_range.0..u_range.1 {
                for v in v_range.0..v_range.1 {
                    let (vx, vy, vz) = match (axis, u_axis, v_axis) {
                        (0, 2, 1) => (slice, v, u),
                        (1, 0, 2) => (u, slice, v),
                        (2, 0, 1) => (u, v, slice),
                        _ => continue,
                    };

                    let raw_voxel = space.get_raw_voxel(vx, vy, vz);
                    let voxel_id = extract_id(raw_voxel);
                    let block = match registry.get_block_by_id(voxel_id) {
                        Some(candidate) => candidate,
                        None => continue,
                    };

                    if block.is_empty {
                        continue;
                    }

                    let mut current_voxel_index = usize::MAX;
                    if block.is_opaque {
                        if current_voxel_index == usize::MAX {
                            current_voxel_index = ((vx - min_x) as usize) * yz_span
                                + ((vy - min_y) as usize) * z_span
                                + (vz - min_z) as usize;
                        }
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

                    let greedy_without_rotation = if block.cache_ready {
                        block.greedy_mesh_eligible_no_rotation
                    } else {
                        block.can_greedy_mesh_without_rotation()
                    };
                    let is_non_greedy_block = !greedy_without_rotation;
                    if is_non_greedy_block {
                        if current_voxel_index == usize::MAX {
                            current_voxel_index = ((vx - min_x) as usize) * yz_span
                                + ((vy - min_y) as usize) * z_span
                                + (vz - min_z) as usize;
                        }
                        if processed_non_greedy[current_voxel_index] {
                            continue;
                        }
                    }

                    let is_see_through = block.is_see_through;

                    if is_non_greedy_block {
                        let non_greedy_voxel_index = current_voxel_index;
                        let is_fluid = block.is_fluid;
                        let cache_ready = block.cache_ready;
                        let block_needs_rotation = block.rotatable || block.y_rotatable;
                        let mut rotation = BlockRotation::PY(0.0);
                        if block_needs_rotation {
                            rotation = extract_rotation(raw_voxel);
                        }
                        processed_non_greedy[non_greedy_voxel_index] = true;
                        let has_standard_six_faces = is_fluid
                            && if cache_ready {
                                block.has_standard_six_faces
                            } else {
                                block.has_standard_six_faces_cached()
                            };
                        if has_standard_six_faces {
                            let fluid_faces =
                                create_fluid_faces(vx, vy, vz, block.id, space, block, registry);
                            let neighbors = NeighborCache::populate(vx, vy, vz, space);
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
                            for face in fluid_faces {
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
                                process_face(
                                    vx,
                                    vy,
                                    vz,
                                    voxel_id,
                                    &rotation,
                                    &face,
                                    &face.range,
                                    block,
                                    registry,
                                    space,
                                    &neighbors,
                                    &face_cache,
                                    is_see_through,
                                    is_fluid,
                                    &mut geometry.positions,
                                    &mut geometry.indices,
                                    &mut geometry.uvs,
                                    &mut geometry.lights,
                                    min,
                                    false,
                                );
                            }
                        } else {
                            let has_dynamic_patterns = if cache_ready {
                                block.has_dynamic_patterns
                            } else {
                                block.has_dynamic_patterns_cached()
                            };
                            if has_dynamic_patterns {
                                let neighbors = NeighborCache::populate(vx, vy, vz, space);
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
                                visit_dynamic_faces(
                                    block,
                                    [vx, vy, vz],
                                    space,
                                    &rotation,
                                    |face, world_space| {
                                        let geo_key = geometry_key_for_face(block, face, vx, vy, vz);
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
                                        let needs_rotation =
                                            block_needs_rotation && !world_space;
                                        let face_rotation = if needs_rotation {
                                            &rotation
                                        } else {
                                            &identity_rotation
                                        };
                                        process_face(
                                            vx,
                                            vy,
                                            vz,
                                            voxel_id,
                                            face_rotation,
                                            face,
                                            &face.range,
                                            block,
                                            registry,
                                            space,
                                            &neighbors,
                                            &face_cache,
                                            is_see_through,
                                            is_fluid,
                                            &mut geometry.positions,
                                            &mut geometry.indices,
                                            &mut geometry.uvs,
                                            &mut geometry.lights,
                                            min,
                                            world_space,
                                        );
                                    },
                                );
                            } else {
                                if block.faces.is_empty() {
                                    continue;
                                }
                                let has_independent_or_isolated_faces = if cache_ready {
                                    block.has_independent_or_isolated_faces
                                } else {
                                    block.has_independent_or_isolated_faces_cached()
                                };
                                let neighbors = NeighborCache::populate(vx, vy, vz, space);
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
                                if !has_independent_or_isolated_faces {
                                    let geometry =
                                        map.entry(GeometryMapKey::Block(block.id)).or_insert_with(|| {
                                            let mut entry = GeometryProtocol::default();
                                            entry.voxel = block.id;
                                        entry
                                        });
                                    for face in &block.faces {
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
                                            &face_cache,
                                            is_see_through,
                                            is_fluid,
                                            &mut geometry.positions,
                                            &mut geometry.indices,
                                            &mut geometry.uvs,
                                            &mut geometry.lights,
                                            min,
                                            false,
                                        );
                                    }
                                } else {
                                    for face in &block.faces {
                                        let geo_key = geometry_key_for_face(block, face, vx, vy, vz);
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
                                            &face_cache,
                                            is_see_through,
                                            is_fluid,
                                            &mut geometry.positions,
                                            &mut geometry.indices,
                                            &mut geometry.uvs,
                                            &mut geometry.lights,
                                            min,
                                            false,
                                        );
                                    }
                                }
                            }
                        }
                        continue;
                    }
                    let face_index = block.greedy_face_indices[dir_index];
                    if face_index == -1 {
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
                    );

                    if !should_render {
                        continue;
                    }
                    let is_fluid = block.is_fluid;
                    let mut current_mask_index = usize::MAX;

                    let matched_face = if face_index >= 0 {
                        block.faces.get(face_index as usize)
                    } else {
                        None
                    };

                    if let Some(face) = matched_face {
                        if !face.independent && !face.isolated {
                            if current_mask_index == usize::MAX {
                                current_mask_index =
                                    (v - v_range.0) as usize * mask_width + (u - u_range.0) as usize;
                            }
                            let (aos, lights) = if is_see_through || block.is_all_transparent {
                                let (_, center_light) = space.get_raw_voxel_and_raw_light(vx, vy, vz);
                                let light = (center_light & 0xFFFF) as i32;
                                ([3, 3, 3, 3], [light; 4])
                            } else {
                                let neighbors = NeighborCache::populate(vx, vy, vz, space);
                                compute_face_ao_and_light_fast(dir, block, &neighbors, registry)
                            };
                            let uv_range = face.range;
                            greedy_mask[current_mask_index] = Some(FaceData {
                                key: FaceKey {
                                    block_id: block.id,
                                    face_name: None,
                                    independent: false,
                                    ao: aos,
                                    light: lights,
                                    uv_start_u: (uv_range.start_u * 1000000.0) as u32,
                                    uv_end_u: (uv_range.end_u * 1000000.0) as u32,
                                    uv_start_v: (uv_range.start_v * 1000000.0) as u32,
                                    uv_end_v: (uv_range.end_v * 1000000.0) as u32,
                                },
                                uv_range,
                                is_fluid,
                            });
                            continue;
                        }
                    }

                    let mut neighbors = None;
                    let mut cached_ao_light: Option<([i32; 4], [i32; 4])> = None;
                    let mut isolated_neighbors: Option<NeighborCache> = None;
                    let mut isolated_face_cache: Option<FaceProcessCache> = None;
                    let mut push_greedy_face = |face: &BlockFace| {
                        if face.isolated {
                            if isolated_neighbors.is_none() {
                                let neighbors = NeighborCache::populate(vx, vy, vz, space);
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
                                isolated_neighbors = Some(neighbors);
                                isolated_face_cache = Some(face_cache);
                            }
                            let geo_key = geometry_key_for_face(block, face, vx, vy, vz);
                            let geometry = map.entry(geo_key).or_insert_with(|| {
                                let mut entry = GeometryProtocol::default();
                                entry.voxel = voxel_id;
                                entry.face_name = Some(face.name.clone());
                                entry.at = Some([vx, vy, vz]);
                                entry
                            });
                            let neighbors = isolated_neighbors
                                .as_ref()
                                .expect("isolated neighbors cache must exist");
                            let face_cache = isolated_face_cache
                                .as_ref()
                                .expect("isolated face cache must exist");
                            process_face(
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                &identity_rotation,
                                face,
                                &face.range,
                                block,
                                registry,
                                space,
                                neighbors,
                                face_cache,
                                is_see_through,
                                is_fluid,
                                &mut geometry.positions,
                                &mut geometry.indices,
                                &mut geometry.uvs,
                                &mut geometry.lights,
                                min,
                                false,
                            );
                            return;
                        }

                        let (aos, lights) = *cached_ao_light.get_or_insert_with(|| {
                            if is_see_through || block.is_all_transparent {
                                let (_, center_light) = space.get_raw_voxel_and_raw_light(vx, vy, vz);
                                let light = (center_light & 0xFFFF) as i32;
                                ([3, 3, 3, 3], [light; 4])
                            } else {
                                let neighbors_ref = neighbors
                                    .get_or_insert_with(|| NeighborCache::populate(vx, vy, vz, space));
                                compute_face_ao_and_light_fast(dir, block, neighbors_ref, registry)
                            }
                        });
                        let uv_range = face.range;

                        let key = FaceKey {
                            block_id: block.id,
                            face_name: if face.independent {
                                Some(face_name_owned(face))
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
                        if current_mask_index == usize::MAX {
                            current_mask_index =
                                (v - v_range.0) as usize * mask_width + (u - u_range.0) as usize;
                        }

                        greedy_mask[current_mask_index] = Some(FaceData {
                            key,
                            uv_range,
                            is_fluid,
                        });
                    };

                    if let Some(face) = matched_face {
                        push_greedy_face(face);
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
                &mut greedy_mask[..mask_len],
                u_range.0,
                u_range.1,
                v_range.0,
                v_range.1,
            );

            let mut cached_quad_block_id = u32::MAX;
            let mut cached_quad_block: Option<&Block> = None;
            for quad in quads {
                let block_id = quad.data.key.block_id;
                let block = if cached_quad_block_id == block_id {
                    match cached_quad_block {
                        Some(block) => block,
                        None => continue,
                    }
                } else {
                    match registry.get_block_by_id(block_id) {
                        Some(block) => {
                            cached_quad_block_id = block_id;
                            cached_quad_block = Some(block);
                            block
                        }
                        None => {
                            cached_quad_block_id = block_id;
                            cached_quad_block = None;
                            continue;
                        }
                    }
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
                let raw_voxel = space.get_raw_voxel(vx, vy, vz);
                let voxel_id = extract_id(raw_voxel);
                let block = match registry.get_block_by_id(voxel_id) {
                    Some(b) => b,
                    None => continue,
                };

                let is_empty = block.is_empty;
                if is_empty {
                    continue;
                }
                let is_see_through = block.is_see_through;
                let is_opaque = block.is_opaque;
                let is_fluid = block.is_fluid;
                let cache_ready = block.cache_ready;
                let has_dynamic_patterns = if cache_ready {
                    block.has_dynamic_patterns
                } else {
                    block.has_dynamic_patterns_cached()
                };

                if !is_fluid && !has_dynamic_patterns && block.faces.is_empty() {
                    continue;
                }

                if is_opaque {
                    if is_surrounded_by_opaque_neighbors(vx, vy, vz, space, registry) {
                        continue;
                    }
                }

                let mut rotation = BlockRotation::PY(0.0);
                if block.rotatable || block.y_rotatable {
                    rotation = extract_rotation(raw_voxel);
                }
                let neighbors = NeighborCache::populate(vx, vy, vz, space);
                let is_all_transparent = block.is_all_transparent;
                let center_light = if is_see_through || is_all_transparent {
                    Some(neighbors.get_raw_light(0, 0, 0) & 0xFFFF)
                } else {
                    None
                };
                let face_cache = FaceProcessCache {
                    opaque_mask: if !(is_see_through || is_all_transparent) {
                        Some(build_neighbor_opaque_mask(&neighbors, registry))
                    } else {
                        None
                    },
                    center_light,
                    fluid_surface_above: is_fluid && has_fluid_above(vx, vy, vz, voxel_id, space),
                    block_min: block_min_corner(block),
                };

                let uses_main_geometry_only = if is_fluid || has_dynamic_patterns {
                    false
                } else {
                    let has_independent_or_isolated_faces = if cache_ready {
                        block.has_independent_or_isolated_faces
                    } else {
                        block.has_independent_or_isolated_faces_cached()
                    };
                    !has_independent_or_isolated_faces
                };
                if uses_main_geometry_only {
                    let geometry = map.entry(GeometryMapKey::Block(block.id)).or_insert_with(|| {
                        let mut entry = GeometryProtocol::default();
                        entry.voxel = block.id;
                        entry
                    });

                    for face in &block.faces {
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
                            &face_cache,
                            is_see_through,
                            is_fluid,
                            &mut geometry.positions,
                            &mut geometry.indices,
                            &mut geometry.uvs,
                            &mut geometry.lights,
                            min,
                            false,
                        );
                    }
                } else {
                    let mut process_single_face = |face: &BlockFace, world_space: bool| {
                        let key = geometry_key_for_face(block, face, vx, vy, vz);

                        let geometry = map.entry(key).or_insert_with(|| {
                            let mut entry = GeometryProtocol::default();
                            entry.voxel = block.id;
                            if face.independent || face.isolated {
                                entry.face_name = Some(face.name.clone());
                            }
                            if face.isolated {
                                entry.at = Some([vx, vy, vz]);
                            }
                            entry
                        });

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
                            &face_cache,
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

                    let has_standard_six_faces = is_fluid
                        && if cache_ready {
                            block.has_standard_six_faces
                        } else {
                            block.has_standard_six_faces_cached()
                        };

                    if has_standard_six_faces {
                        let fluid_faces =
                            create_fluid_faces(vx, vy, vz, block.id, space, block, registry);
                        for face in &fluid_faces {
                            process_single_face(face, false);
                        }
                    } else if has_dynamic_patterns {
                        visit_dynamic_faces(
                            block,
                            [vx, vy, vz],
                            space,
                            &rotation,
                            |face, world_space| {
                                process_single_face(face, world_space);
                            },
                        );
                    } else {
                        for face in &block.faces {
                            process_single_face(face, false);
                        }
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
