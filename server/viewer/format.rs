//! The files the backend hands the viewer, written once and read straight
//! into typed arrays by `@voxelize/viewer` (`src/formats.ts` mirrors both).
//! Little-endian; every section starts on a four-byte boundary.
//!
//! Chunk mesh (`VXVM`):
//!
//! ```text
//! "VXVM" u32 version
//! i32 cx, i32 cz (the chunk it was meshed for: every chunk whose 3x3
//!   neighbourhood holds the same voxels and tints shares the file),
//! u32 chunk size, u32 max height, u32 level height
//! u32 has tints, u8[12] biome tints (corners, x-fast RGB)
//! column summary, size*size entries indexed z * size + x, five u16 each:
//!   top (y + 1 of the highest non-empty voxel, 0 = empty column), top id,
//!   ground (y + 1 of the highest opaque non-plant non-fluid voxel), ground id,
//!   water (y + 1 of the highest fluid voxel, 0 = none)
//! padding to four bytes
//! u32 geometry count, then per geometry:
//!   u32 level, u32 block id, u32 face name length, name bytes padded to four,
//!   u32 has voxel, i32 x, y, z (the voxel an isolated face belongs to),
//!   u32 vertex count, u32 index count,
//!   f32 positions[3n] (chunk-local x and z, y relative to the level's base),
//!   f32 uvs[2n], i32 lights[n] (the mesher's packed light words), u32 indices
//! ```
//!
//! Far tile (`VXVF`):
//!
//! ```text
//! "VXVF" u32 version
//! i32 x0, i32 z0, u32 step, u32 size, u32 layer count
//! u16 heights[size^2], u16 materials[size^2], u16 water[size^2], each padded to four
//! per layer: u32 byte length, bytes padded to four
//! ```
use voxelize_mesher::GeometryProtocol;

use crate::{BlockUtils, Chunk, Registry, Vec3, VoxelAccess};

use super::source::{FarTile, FarTileSpec};

pub const CHUNK_MESH_MAGIC: &[u8; 4] = b"VXVM";
pub const FAR_TILE_MAGIC: &[u8; 4] = b"VXVF";
pub const FORMAT_VERSION: u32 = 1;

/// Per-block flags the column summary reads, indexed by block id.
pub struct BlockClasses {
    empty: Vec<bool>,
    ground: Vec<bool>,
    fluid: Vec<bool>,
}

impl BlockClasses {
    pub fn new(registry: &Registry) -> Self {
        let len = registry
            .blocks_by_id
            .keys()
            .max()
            .map_or(1, |max| *max as usize + 1);
        let mut classes = Self {
            empty: vec![true; len],
            ground: vec![false; len],
            fluid: vec![false; len],
        };
        for (id, block) in &registry.blocks_by_id {
            let i = *id as usize;
            classes.empty[i] = block.is_empty;
            classes.fluid[i] = block.is_fluid;
            classes.ground[i] =
                !block.is_empty && block.is_opaque && !block.is_plant && !block.is_fluid;
        }
        classes
    }

    fn get(list: &[bool], id: u32, otherwise: bool) -> bool {
        list.get(id as usize).copied().unwrap_or(otherwise)
    }

    pub fn is_empty(&self, id: u32) -> bool {
        Self::get(&self.empty, id, false)
    }

    pub fn is_ground(&self, id: u32) -> bool {
        Self::get(&self.ground, id, false)
    }

    pub fn is_fluid(&self, id: u32) -> bool {
        Self::get(&self.fluid, id, false)
    }
}

/// What a column shows from straight above.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ColumnTop {
    pub top: u16,
    pub top_id: u16,
    pub ground: u16,
    pub ground_id: u16,
    pub water: u16,
}

/// The column summary of a chunk, indexed `z * size + x` (chunk-local).
pub fn summarize(chunk: &Chunk, classes: &BlockClasses) -> Vec<ColumnTop> {
    let size = chunk.options.size as i32;
    let Vec3(min_x, _, min_z) = chunk.min;
    let scan_top = chunk
        .top_filled_y
        .unwrap_or(chunk.options.max_height as i32 - 1)
        .min(chunk.options.max_height as i32 - 1);
    let mut out = vec![ColumnTop::default(); (size * size) as usize];
    for lz in 0..size {
        for lx in 0..size {
            let (x, z) = (min_x + lx, min_z + lz);
            let entry = &mut out[(lz * size + lx) as usize];
            for y in (0..=scan_top).rev() {
                let id = BlockUtils::extract_id(chunk.get_raw_voxel(x, y, z));
                if classes.is_empty(id) {
                    continue;
                }
                let at = (y + 1) as u16;
                if entry.top == 0 {
                    entry.top = at;
                    entry.top_id = id as u16;
                }
                if entry.water == 0 && classes.is_fluid(id) {
                    entry.water = at;
                }
                if classes.is_ground(id) {
                    entry.ground = at;
                    entry.ground_id = id as u16;
                    break;
                }
            }
        }
    }
    out
}

fn pad(out: &mut Vec<u8>) {
    while out.len() % 4 != 0 {
        out.push(0);
    }
}

fn u32s(out: &mut Vec<u8>, values: &[u32]) {
    for v in values {
        out.extend_from_slice(&v.to_le_bytes());
    }
}

/// One meshed level's geometries, as the mesher returned them.
pub struct LevelGeometry {
    pub level: u32,
    pub geometries: Vec<GeometryProtocol>,
}

pub fn encode_chunk_mesh(
    chunk: &Chunk,
    level_height: u32,
    summary: &[ColumnTop],
    levels: &[LevelGeometry],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(64 * 1024);
    out.extend_from_slice(CHUNK_MESH_MAGIC);
    u32s(&mut out, &[FORMAT_VERSION]);
    out.extend_from_slice(&chunk.coords.0.to_le_bytes());
    out.extend_from_slice(&chunk.coords.1.to_le_bytes());
    u32s(
        &mut out,
        &[
            chunk.options.size as u32,
            chunk.options.max_height as u32,
            level_height,
        ],
    );
    match chunk.biome_tints {
        Some(tints) => {
            u32s(&mut out, &[1]);
            out.extend_from_slice(&tints);
        }
        None => {
            u32s(&mut out, &[0]);
            out.extend_from_slice(&[0; 12]);
        }
    }
    for column in summary {
        for v in [
            column.top,
            column.top_id,
            column.ground,
            column.ground_id,
            column.water,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    pad(&mut out);
    let count: usize = levels.iter().map(|l| l.geometries.len()).sum();
    u32s(&mut out, &[count as u32]);
    for level in levels {
        for g in &level.geometries {
            u32s(&mut out, &[level.level, g.voxel]);
            let name = g.face_name.as_deref().unwrap_or("");
            u32s(&mut out, &[name.len() as u32]);
            out.extend_from_slice(name.as_bytes());
            pad(&mut out);
            match g.at {
                Some([x, y, z]) => {
                    u32s(&mut out, &[1]);
                    for v in [x, y, z] {
                        out.extend_from_slice(&v.to_le_bytes());
                    }
                }
                None => u32s(&mut out, &[0, 0, 0, 0]),
            }
            let vertices = g.positions.len() / 3;
            u32s(&mut out, &[vertices as u32, g.indices.len() as u32]);
            for v in &g.positions {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for v in &g.uvs {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for v in &g.lights {
                out.extend_from_slice(&v.to_le_bytes());
            }
            for v in &g.indices {
                out.extend_from_slice(&(*v as u32).to_le_bytes());
            }
        }
    }
    out
}

pub fn encode_far_tile(spec: &FarTileSpec, tile: &FarTile) -> Vec<u8> {
    let samples = spec.samples();
    let mut out = Vec::with_capacity(samples * 8 + 64);
    out.extend_from_slice(FAR_TILE_MAGIC);
    u32s(&mut out, &[FORMAT_VERSION]);
    out.extend_from_slice(&spec.x0.to_le_bytes());
    out.extend_from_slice(&spec.z0.to_le_bytes());
    u32s(
        &mut out,
        &[spec.step as u32, spec.size as u32, tile.layers.len() as u32],
    );
    for list in [&tile.heights, &tile.materials, &tile.water] {
        for i in 0..samples {
            out.extend_from_slice(&list.get(i).copied().unwrap_or(0).to_le_bytes());
        }
        pad(&mut out);
    }
    for layer in &tile.layers {
        u32s(&mut out, &[layer.len() as u32]);
        out.extend_from_slice(layer);
        pad(&mut out);
    }
    out
}

/// A 64-bit hash of a chunk's voxel words, stable across processes and
/// platforms (the mesh cache is keyed by it).
pub fn hash_words(words: &[u32]) -> u64 {
    let mut h: u64 = 0x9e37_79b9_7f4a_7c15 ^ (words.len() as u64);
    for (i, w) in words.iter().enumerate() {
        if *w == 0 {
            continue;
        }
        let mut k = (*w as u64) | ((i as u64) << 32);
        k = k.wrapping_mul(0xbf58_476d_1ce4_e5b9);
        k ^= k >> 31;
        k = k.wrapping_mul(0x94d0_49bb_1331_11eb);
        h = (h ^ k).rotate_left(27).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
    mix(h)
}

pub fn mix(mut h: u64) -> u64 {
    h ^= h >> 33;
    h = h.wrapping_mul(0xff51_afd7_ed55_8ccd);
    h ^= h >> 33;
    h = h.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^ (h >> 33)
}

/// Folds `parts` into one hash, order-sensitive.
pub fn combine(parts: impl IntoIterator<Item = u64>) -> u64 {
    let mut h: u64 = 0x243f_6a88_85a3_08d3;
    for p in parts {
        h = mix(h ^ p.wrapping_add(0x9e37_79b9_7f4a_7c15));
    }
    h
}

pub fn hash_str(text: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    mix(h)
}
