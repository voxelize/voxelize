use serde::{Deserialize, Serialize};

use voxelize_core::{
    BlockDynamicPattern, BlockFace, LightUtils, VoxelAccess, AABB, UV,
};

use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub id: u32,
    pub name: String,
    #[serde(skip)]
    pub name_lower: String,
    pub rotatable: bool,
    pub y_rotatable: bool,
    pub is_empty: bool,
    pub is_fluid: bool,
    #[serde(default)]
    pub is_waterloggable: bool,
    #[serde(default)]
    pub is_waterlogging_fluid: bool,
    pub is_opaque: bool,
    pub is_see_through: bool,
    pub is_transparent: [bool; 6],
    pub transparent_standalone: bool,
    #[serde(default)]
    pub occludes_fluid: bool,
    #[serde(default)]
    pub is_plant: bool,
    /// Vertically contiguous voxels whose blocks share a non-zero group are
    /// shaded as one object: each vertex learns its index in the run and the
    /// run's length. The library assigns no groups itself — a game decides
    /// which of its blocks stack together, so a two-part door or a plant
    /// column can span more than one block id.
    #[serde(default)]
    pub stack_group: u16,
    pub faces: Vec<BlockFace>,
    pub aabbs: Vec<AABB>,
    pub dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
}

impl Block {
    pub fn compute_name_lower(&mut self) {
        self.name_lower = self.name.to_lowercase();
        for face in &mut self.faces {
            face.compute_name_lower();
        }
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
        self.aabbs.len() == 1
            && (self.aabbs[0].min_x - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].min_y - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].min_z - 0.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_x - 1.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_y - 1.0).abs() < f32::EPSILON
            && (self.aabbs[0].max_z - 1.0).abs() < f32::EPSILON
    }

    pub fn get_name_lower(&self) -> &str {
        if self.name_lower.is_empty() {
            &self.name
        } else {
            &self.name_lower
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub blocks_by_id: Vec<(u32, Block)>,
    #[serde(skip)]
    lookup_cache: Option<Vec<usize>>,
    #[serde(skip)]
    waterlogging_fluid_id: Option<u32>,
}

impl Registry {
    pub fn new(blocks_by_id: Vec<(u32, Block)>) -> Self {
        Self {
            blocks_by_id,
            lookup_cache: None,
            waterlogging_fluid_id: None,
        }
    }

    pub fn build_cache(&mut self) {
        let max_id = self
            .blocks_by_id
            .iter()
            .map(|(id, _)| *id as usize)
            .max()
            .unwrap_or(0);
        let mut cache = vec![usize::MAX; max_id + 1];
        for (idx, (id, block)) in self.blocks_by_id.iter_mut().enumerate() {
            cache[*id as usize] = idx;
            block.compute_name_lower();
        }
        self.lookup_cache = Some(cache);
        self.waterlogging_fluid_id = self
            .blocks_by_id
            .iter()
            .find(|(_, block)| block.is_waterlogging_fluid)
            .map(|(id, _)| *id);
    }

    /// The block waterlogged voxels are filled with, or `None` in a registry
    /// that never declared one — in which case waterlogging meshes nothing.
    pub fn waterlogging_fluid(&self) -> Option<(u32, &Block)> {
        let id = self.waterlogging_fluid_id?;
        self.get_block_by_id(id).map(|block| (id, block))
    }

    pub fn get_block_by_id(&self, id: u32) -> Option<&Block> {
        if let Some(cache) = &self.lookup_cache {
            cache
                .get(id as usize)
                .copied()
                .filter(|idx| *idx != usize::MAX)
                .map(|idx| &self.blocks_by_id[idx].1)
        } else {
            self.blocks_by_id
                .iter()
                .find(|(block_id, _)| *block_id == id)
                .map(|(_, block)| block)
        }
    }

    pub fn has_type(&self, id: u32) -> bool {
        if let Some(cache) = &self.lookup_cache {
            cache
                .get(id as usize)
                .copied()
                .is_some_and(|idx| idx != usize::MAX)
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
}

impl Default for MeshConfig {
    fn default() -> Self {
        Self { chunk_size: 16 }
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

pub(super) struct NeighborCache {
    pub(super) data: [[u32; 2]; 27],
}

impl NeighborCache {
    #[inline]
    pub(super) fn offset_to_index(x: i32, y: i32, z: i32) -> usize {
        // The cache holds the 3x3x3 neighborhood only, but face dirs on
        // custom blocks (authored or rotation-derived) can step further
        // out. Clamp to the nearest cached cell instead of indexing past
        // the array and trapping the whole wasm worker.
        let x = x.clamp(-1, 1);
        let y = y.clamp(-1, 1);
        let z = z.clamp(-1, 1);
        ((x + 1) + (y + 1) * 3 + (z + 1) * 9) as usize
    }

    pub(super) fn populate<S: VoxelAccess>(vx: i32, vy: i32, vz: i32, space: &S) -> Self {
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
    pub(super) fn get_raw_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][0]
    }

    #[inline]
    pub(super) fn get_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        extract_id(self.get_raw_voxel(dx, dy, dz))
    }

    #[inline]
    pub(super) fn get_raw_light(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][1]
    }

    #[inline]
    pub(super) fn get_all_lights(&self, dx: i32, dy: i32, dz: i32) -> (u32, u32, u32, u32) {
        let light = self.get_raw_light(dx, dy, dz);
        LightUtils::extract_all(light)
    }
}

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct FaceKey {
    pub(super) block_id: u32,
    pub(super) face_name: String,
    pub(super) independent: bool,
    pub(super) is_water_exposed: bool,
    pub(super) ao: [i32; 4],
    pub(super) light: [i32; 4],
    pub(super) uv_start_u: u32,
    pub(super) uv_end_u: u32,
    pub(super) uv_start_v: u32,
    pub(super) uv_end_v: u32,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub(super) struct FaceData {
    pub(super) key: FaceKey,
    pub(super) uv_range: UV,
    pub(super) is_see_through: bool,
    pub(super) is_fluid: bool,
}

#[derive(Clone, Debug)]
pub(super) struct GreedyQuad {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) w: i32,
    pub(super) h: i32,
    pub(super) data: FaceData,
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
    /// Packed unordered face-pair visibility for the meshed range; see
    /// `connectivity_pair_bit`. `CONNECTIVITY_FULL` when nothing opaque
    /// stands in the way (or the range was unknowable).
    pub connectivity: u32,
}
