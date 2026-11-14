use serde::{Deserialize, Serialize};

use voxelize_core::{
    BlockDynamicPattern, BlockFace, BlockRotation, LightUtils, VoxelAccess, AABB,
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
    /// With `transparent_standalone`, how many voxels in from either side of
    /// a mass of this block a face between two of its voxels is still meshed,
    /// counted along the face's axis. A deeper face sits behind that many
    /// layers of the block, which a cutout hides; 0 meshes every layer. A
    /// depth also makes a see-through cube a cutout mass, drawn single-sided
    /// with inward copies of its surface (`is_cutout_mass`).
    #[serde(default)]
    pub standalone_face_depth: u32,
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
    /// Every voxel of this block gets a geometry of its own (keyed by its
    /// position, reported through `GeometryProtocol::at`) instead of joining
    /// the block's shared buffer, so the client can transform one voxel's
    /// faces without touching the rest of the chunk. Never greedy-meshed.
    #[serde(default)]
    pub is_animated: bool,
    pub faces: Vec<BlockFace>,
    pub aabbs: Vec<AABB>,
    pub dynamic_patterns: Option<Vec<BlockDynamicPattern>>,
    /// Joins this block's faces with coplanar faces of neighbours that share
    /// the key, so the frame in its texture border is drawn only around the
    /// outline of the joined sheet. Never greedy-meshed. See `connected`.
    #[serde(default)]
    pub connected: Option<ConnectedFrame>,
    /// Draws every voxel of this block as a branch of the radius its stage
    /// holds, joined to its neighbours. Never greedy-meshed. See `branch`.
    #[serde(default)]
    pub branch: Option<BranchShape>,
    /// The branches this block takes without being one.
    #[serde(default)]
    pub branch_sockets: Vec<BranchSocket>,
    /// Draws every voxel of this block as a cell of a wide branch section:
    /// its slice of the tube of the core its raw bits point at, wearing that
    /// core's faces. Never greedy-meshed. See `branch`.
    #[serde(default)]
    pub branch_shell: bool,
    /// The faces a voxel wears instead of `faces` while its stage holds any
    /// of the mask's bits. See [`Block::faces_at`].
    #[serde(default)]
    pub stage_faces: Option<StageFaces>,
    /// Loose quads a voxel of this block wears where it meets the open air,
    /// on top of its cube. See [`Tufts`].
    #[serde(default)]
    pub tufts: Option<Tufts>,
}

/// Loose quads drawn over a cube where it meets the open air: a mass of
/// them reads as a soft, ragged outline instead of a stack of boxes. A voxel
/// wears them only while one of its six neighbours is empty, so a buried
/// voxel costs nothing, and its cube faces still greedy-mesh. Each voxel's
/// set is turned about the vertical through its centre, leant by up to
/// `tilt` radians about a level axis, and nudged by up to `jitter` blocks
/// along each axis, all picked from its position, so no two neighbours
/// repeat. Laid apart from the cube, in a geometry named
/// [`TUFTS_FACE_NAME`] the client draws from both sides; lit by the voxel's
/// own light and tinted as the block's first face is.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tufts {
    /// Quads in the voxel's frame; corners may reach past the cell.
    pub faces: Vec<BlockFace>,
    /// Worn instead of `faces` while the voxel's stage picks the block's
    /// stage faces, one per face. Empty keeps `faces` in every look.
    #[serde(default)]
    pub stage_faces: Vec<BlockFace>,
    /// Largest nudge of a voxel's set from its cell, in blocks per axis.
    #[serde(default)]
    pub jitter: f32,
    /// Largest lean of a voxel's set from upright, in radians.
    #[serde(default)]
    pub tilt: f32,
}

impl Tufts {
    /// The quads a voxel at `stage` wears on a block with `stage_mask`.
    pub fn faces_at(&self, stage: u32, stage_mask: Option<u32>) -> &[BlockFace] {
        match stage_mask {
            Some(mask) if stage & mask != 0 && !self.stage_faces.is_empty() => &self.stage_faces,
            _ => &self.faces,
        }
    }
}

/// Faces a block wears in place of its own on a voxel whose stage holds any
/// of `mask`'s bits: the same cube in another look, each face standing in
/// for the block's face toward the same side.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageFaces {
    pub mask: u32,
    pub faces: Vec<BlockFace>,
}

/// A frame baked into the border of a block's face texture, drawn only where
/// the face is not joined to the face of a neighbour sharing `key`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedFrame {
    /// Blocks sharing a key join; different glass kinds keep their frames.
    pub key: u32,
    /// Width of the frame in the texture border, in texels.
    pub frame_texels: u32,
    /// How far into each end of a frame band the texture shades toward its
    /// corner. A band carried across a join samples past these texels, so a
    /// long frame reads as one line instead of a row of block-long dashes.
    #[serde(default)]
    pub corner_texels: u32,
    /// Texels per block the face texture is drawn at.
    pub texels_per_block: u32,
    /// The texture is clear inside its frame, so a joined border is left
    /// undrawn instead of reflecting the glass beside it: a face joined on
    /// every side is one quad rather than nine.
    #[serde(default)]
    pub clear_interior: bool,
    /// With a clear interior, one joined face in this many keeps what its
    /// texture draws inside the frame (glass glints), picked by world
    /// position so a large sheet is not the same speck on every block. 1
    /// keeps every face's, the default; 0 keeps none, so a sheet is clear
    /// inside its outline. A face nothing joins always keeps its own.
    #[serde(default = "every_interior")]
    pub interior_one_in: u32,
}

fn every_interior() -> u32 {
    1
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
        if let Some(alternate) = &mut self.stage_faces {
            for face in &mut alternate.faces {
                face.compute_name_lower();
            }
        }
        if let Some(tufts) = &mut self.tufts {
            for face in tufts.faces.iter_mut().chain(tufts.stage_faces.iter_mut()) {
                face.compute_name_lower();
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

    /// The faces a voxel of this block at `stage` wears: its stage faces
    /// while the stage holds any of their bits, its own otherwise.
    pub fn faces_at(&self, stage: u32) -> &[BlockFace] {
        match &self.stage_faces {
            Some(alternate) if stage & alternate.mask != 0 => &alternate.faces,
            _ => &self.faces,
        }
    }
}

/// What the mesher asks of a block for every voxel it visits, as one bit
/// each, so the question is a table read instead of a walk into the block.
/// A [`Window`](super::window::Window) keeps a copy per cell and adds the
/// three bits that belong to the voxel rather than its block.
pub(super) const F_KNOWN: u16 = 1 << 0;
pub(super) const F_EMPTY: u16 = 1 << 1;
pub(super) const F_OPAQUE: u16 = 1 << 2;
pub(super) const F_FLUID: u16 = 1 << 3;
pub(super) const F_SEE_THROUGH: u16 = 1 << 4;
/// `branch_shell`: whether it stands in the way depends on its core.
pub(super) const F_SHELL: u16 = 1 << 5;
/// Greedy-meshes while its voxel stands upright (`can_greedy_mesh_block`).
pub(super) const F_GREEDY: u16 = 1 << 6;
pub(super) const F_CUTOUT_MASS: u16 = 1 << 7;
/// Every corner of every face takes the voxel's own light, unshaded: a
/// see-through block, or one transparent on all six sides with at most one
/// box (`uses_center_voxel_light`, and the `ao = 3` rule beside it).
pub(super) const F_FLAT_LIT: u16 = 1 << 8;
/// The access holds this cell (`VoxelAccess::contains`).
pub(super) const F_PRESENT: u16 = 1 << 12;
pub(super) const F_WATERLOGGED: u16 = 1 << 13;
/// The voxel's rotation is `PY(0.0)`; only set from a raw-decoding access.
pub(super) const F_UPRIGHT: u16 = 1 << 14;

/// Per-block answers the mesher would otherwise work out per voxel, built
/// once with the registry's cache.
#[derive(Clone, Default)]
pub(super) struct BlockTables {
    /// By block id: the block's `F_*` bits, 0 for an id the registry lacks.
    flags: Vec<u16>,
    /// By block id: its place in `blocks_by_id`, `u32::MAX` when absent.
    index: Vec<u32>,
    /// By place in `blocks_by_id`, then by face (the block's own, then its
    /// stage faces): the first face of that block that merges with this one
    /// in a greedy quad, i.e. shares its name, `independent` and texture
    /// range. Two faces of one block in the same class key the same.
    face_classes: Vec<Vec<u8>>,
}

impl BlockTables {
    pub(super) fn build(registry: &Registry) -> Self {
        let max_id = registry
            .blocks_by_id
            .iter()
            .map(|(id, _)| *id as usize)
            .max()
            .unwrap_or(0);
        let mut flags = vec![0u16; max_id + 1];
        let mut index = vec![u32::MAX; max_id + 1];
        let mut face_classes = Vec::with_capacity(registry.blocks_by_id.len());
        let upright = BlockRotation::PY(0.0);

        for (at, (id, block)) in registry.blocks_by_id.iter().enumerate() {
            let mut bits = F_KNOWN;
            if block.is_empty {
                bits |= F_EMPTY;
            }
            if block.is_opaque {
                bits |= F_OPAQUE;
            }
            if block.is_fluid {
                bits |= F_FLUID;
            }
            if block.is_see_through {
                bits |= F_SEE_THROUGH;
            }
            if block.branch_shell {
                bits |= F_SHELL;
            }
            if can_greedy_mesh_block(block, &upright) {
                bits |= F_GREEDY;
            }
            if is_cutout_mass(block) {
                bits |= F_CUTOUT_MASS;
            }
            let is_all_transparent = block.is_transparent.iter().all(|&face| face);
            if uses_center_voxel_light(block) && (block.is_see_through || is_all_transparent) {
                bits |= F_FLAT_LIT;
            }
            // As in `build_cache`: of two entries under one id, the later.
            flags[*id as usize] = bits;
            index[*id as usize] = at as u32;

            let faces: Vec<&BlockFace> = block
                .faces
                .iter()
                .chain(block.stage_faces.iter().flat_map(|stage| stage.faces.iter()))
                .collect();
            fn merge_key(face: &BlockFace) -> (&str, bool, [u32; 4]) {
                (
                    face.name.as_str(),
                    face.independent,
                    [
                        (face.range.start_u * 1000000.0) as u32,
                        (face.range.end_u * 1000000.0) as u32,
                        (face.range.start_v * 1000000.0) as u32,
                        (face.range.end_v * 1000000.0) as u32,
                    ],
                )
            }
            face_classes.push(
                faces
                    .iter()
                    .enumerate()
                    .map(|(j, face)| {
                        let first = faces[..j]
                            .iter()
                            .position(|other| merge_key(other) == merge_key(face))
                            .unwrap_or(j);
                        first.min(u8::MAX as usize) as u8
                    })
                    .collect(),
            );
        }

        Self {
            flags,
            index,
            face_classes,
        }
    }

    #[inline(always)]
    pub(super) fn flags_of(&self, id: u32) -> u16 {
        match self.flags.get(id as usize) {
            Some(bits) => *bits,
            None => 0,
        }
    }

    /// The block's place in `blocks_by_id`.
    #[inline(always)]
    pub(super) fn index_of(&self, id: u32) -> Option<usize> {
        match self.index.get(id as usize) {
            Some(&at) if at != u32::MAX => Some(at as usize),
            _ => None,
        }
    }

    /// The merge class of face `slot` of the block at `block_index`, counting
    /// its own faces first and its stage faces after.
    #[inline(always)]
    pub(super) fn face_class(&self, block_index: usize, slot: usize) -> u8 {
        self.face_classes[block_index]
            .get(slot)
            .copied()
            .unwrap_or(slot.min(u8::MAX as usize) as u8)
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
    #[serde(skip)]
    tables: Option<BlockTables>,
}

impl Registry {
    pub fn new(blocks_by_id: Vec<(u32, Block)>) -> Self {
        Self {
            blocks_by_id,
            lookup_cache: None,
            waterlogging_fluid_id: None,
            tables: None,
        }
    }

    /// The tables `build_cache` made, if it has run.
    pub(super) fn tables(&self) -> Option<&BlockTables> {
        self.tables.as_ref()
    }

    /// Whether `id` names an opaque block.
    #[cfg(test)]
    #[inline]
    pub(super) fn is_opaque_id(&self, id: u32) -> bool {
        match &self.tables {
            Some(tables) => tables.flags_of(id) & F_OPAQUE != 0,
            None => self.get_block_by_id(id).is_some_and(|b| b.is_opaque),
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
        self.tables = Some(BlockTables::build(self));
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

    /// The neighbourhood read cell by cell from any access; the mesher takes
    /// its own from a `Window`.
    #[cfg(test)]
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

    /// One bit per cached cell, in `offset_to_index` order: whether it holds
    /// an opaque block.
    #[cfg(test)]
    pub(super) fn opaque_mask(&self, registry: &Registry) -> u32 {
        let mut mask = 0u32;
        for (slot, cell) in self.data.iter().enumerate() {
            mask |= (registry.is_opaque_id(extract_id(cell[0])) as u32) << slot;
        }
        mask
    }

    #[cfg(test)]
    #[inline]
    pub(super) fn get_raw_voxel(&self, dx: i32, dy: i32, dz: i32) -> u32 {
        let idx = Self::offset_to_index(dx, dy, dz);
        self.data[idx][0]
    }

    #[cfg(test)]
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
