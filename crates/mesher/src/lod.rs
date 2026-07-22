//! Level-of-detail (LOD) chunk meshing.
//!
//! A chunk at LOD level `L` is rendered from a grid downsampled by
//! `factor = 2^L`: every `factor^3` block cell collapses into one cell that is
//! meshed as a `factor`-sized cube. The coarse grid is fed through the exact
//! same greedy mesher as full-resolution chunks ([`mesh_space_greedy`]), so
//! materials, texture atlas ranges, ambient occlusion, fluids, and
//! transparency all behave identically — the only post-processing is scaling
//! the output positions by `factor`.
//!
//! # Seam strategy: closed hulls + conservative downsampling
//!
//! LOD meshes are built *per chunk in isolation*: everything outside the
//! chunk is treated as void, so every solid coarse cell on the chunk border
//! emits its border face. Each LOD chunk is therefore a closed (watertight)
//! hull on its side boundaries, and the union of closed hulls cannot have
//! cracks no matter which LOD levels end up adjacent — correctness never
//! depends on what level a neighbor is displayed at, and no chunk needs
//! remeshing when a neighbor changes level.
//!
//! The boundary between the full-detail region and the first LOD ring is
//! covered by a conservative downsampling rule: a coarse cell's
//! representative is *opaque* whenever the cell contains at least one opaque
//! block. A full-detail chunk only suppresses a border face when the true
//! neighbor voxel is opaque, and that voxel forces the neighboring coarse
//! cell — and thus the coarse chunk's closed border wall in the very same
//! plane — to be opaque. Every suppressed full-detail face is covered.
//!
//! Coplanar walls from both sides of a border face in opposite directions,
//! so backface culling shows at most one of them from any viewpoint (no
//! z-fighting). Non-opaque faces keep the mesher's existing sub-voxel inset
//! and are never exactly coplanar.
//!
//! The cost of the closed hull is hidden interior wall geometry at chunk
//! borders. Greedy meshing collapses those walls to a handful of quads, and
//! LOD chunks are distant by definition, so the overdraw is negligible next
//! to the correctness guarantee.

use voxelize_core::LightUtils;

use crate::mesher::{
    mesh_space_greedy, ChunkData, GeometryProtocol, Registry, VoxelSpace, FLUID_BASE_HEIGHT,
    FLUID_STAGE_DROPOFF,
};

/// Downsampled stand-in for one coarse cell, chosen from the fine voxels the
/// cell contains.
///
/// Picks are `(preference rank, fine y, id)` tuples compared
/// lexicographically: representatives are surface-biased (topmost wins, so
/// grass hills stay grass at distance), with ids that carry no per-position
/// state ranked above ones that do, and the id as a deterministic tiebreak.
#[derive(Default, Clone, Copy)]
struct CellAccumulator {
    /// Best opaque pick — mandatory representative when present (seam
    /// safety, see module docs).
    opaque: Option<(u8, u32, u32)>,
    /// Best non-opaque solid pick (leaves, glass) — used only when the cell
    /// holds no opaque block.
    solid: Option<(u8, u32, u32)>,
    /// Topmost fluid pick `(fine y, local y within the cell, raw voxel)` —
    /// used only when the cell holds no solid block at all.
    fluid: Option<(u32, u32, u32)>,
    /// Per-channel maxima over the cell (sun, red, green, blue). Max — not
    /// average — so lit surfaces stay as bright as the adjacent full-detail
    /// ring and no dark seams appear at LOD boundaries.
    light_max: [u32; 4],
}

#[inline]
fn upgrade_pick(slot: &mut Option<(u8, u32, u32)>, candidate: (u8, u32, u32)) {
    if slot.map_or(true, |current| candidate > current) {
        *slot = Some(candidate);
    }
}

const CLASS_OPAQUE: u8 = 1 << 0;
const CLASS_SOLID: u8 = 1 << 1;
const CLASS_FLUID: u8 = 1 << 2;
const CLASS_PREFERRED: u8 = 1 << 3;

/// Per-block-id classification lookup table for the downsampling hot loop.
///
/// - `OPAQUE`: occludes neighbors at full detail, therefore *must* solidify
///   its coarse cell — this is the invariant that keeps the full-detail /
///   LOD boundary watertight (see module docs).
/// - `SOLID`: substantial enough to contribute mass even though it does not
///   occlude (full-cube see-through blocks such as leaves and glass). Plants,
///   fences, torches and other partial shapes are ignored: at distance they
///   are subpixel, and turning them into full cells would bloat terrain.
/// - `FLUID`: contributes a water surface when the cell has no solid mass.
/// - `PREFERRED`: an id safe to use as a representative without dragging in
///   per-position state (no isolated faces, no dynamic patterns).
struct LodClassifier {
    classes: Vec<u8>,
}

impl LodClassifier {
    fn new(registry: &Registry) -> Self {
        let max_id = registry
            .blocks_by_id
            .iter()
            .map(|(id, _)| *id as usize)
            .max()
            .unwrap_or(0);
        let mut classes = vec![0u8; max_id + 1];

        for (id, block) in &registry.blocks_by_id {
            let mut class = 0u8;

            if block.is_fluid {
                class |= CLASS_FLUID;
            } else if !block.is_empty && !block.is_plant {
                if block.is_opaque {
                    class |= CLASS_OPAQUE | CLASS_SOLID;
                } else if block.is_full_cube() {
                    class |= CLASS_SOLID;
                }
            }

            let has_isolated_faces = block.faces.iter().any(|face| face.isolated);
            if class & CLASS_SOLID != 0 && !has_isolated_faces && block.dynamic_patterns.is_none()
            {
                class |= CLASS_PREFERRED;
            }

            classes[*id as usize] = class;
        }

        Self { classes }
    }

    #[inline]
    fn class_of(&self, id: u32) -> u8 {
        self.classes.get(id as usize).copied().unwrap_or(0)
    }
}

/// Encode a fluid surface height (fraction of a coarse cell, in `(0, 1]`)
/// into the voxel stage bits so the unmodified mesher reproduces it.
///
/// The mesher computes a fluid cell's surface as
/// `FLUID_BASE_HEIGHT - stage * FLUID_STAGE_DROPOFF` in cell units. Scaling a
/// coarse cell by `factor` would multiply that height by `factor` and float
/// distant water a block or more above the true surface, so the downsampler
/// solves for the stage whose decoded height, times `factor`, lands closest
/// to the true fine-grid water level. Heights above `FLUID_BASE_HEIGHT`
/// clamp to stage 0 — a hair low, which reads fine and never poke through
/// the adjacent full-detail water.
fn encode_fluid_stage_for_height(target_height: f32) -> u32 {
    if target_height >= FLUID_BASE_HEIGHT {
        return 0;
    }
    let stage = ((FLUID_BASE_HEIGHT - target_height) / FLUID_STAGE_DROPOFF).round() as i32;
    stage.clamp(0, 15) as u32
}

/// Downsample a full-resolution chunk into a coarse [`ChunkData`] whose every
/// cell covers `factor^3` fine voxels.
///
/// `voxels` and `lights` are the chunk's raw arrays with `shape`
/// `[size, height, size]` in the engine's `x -> y -> z` (row-major) layout.
/// `shape` dimensions must be divisible by `factor`.
///
/// Representative selection per cell, in priority order:
/// 1. topmost opaque block (preferring ids without isolated faces or dynamic
///    patterns) — mandatory for seam safety, see [`LodClassifier`],
/// 2. topmost non-opaque solid (leaves, glass),
/// 3. topmost fluid, with its stage re-encoded so the scaled surface height
///    matches the true water level,
/// 4. air.
///
/// Rotation and stage bits of solid representatives are stripped: coarse
/// cells are plain axis-aligned cubes.
pub fn downsample_chunk(
    voxels: &[u32],
    lights: &[u32],
    shape: [usize; 3],
    factor: usize,
    registry: &Registry,
) -> ChunkData {
    assert!(factor >= 2, "LOD factor must be at least 2");
    assert!(
        shape[0] % factor == 0 && shape[1] % factor == 0 && shape[2] % factor == 0,
        "chunk shape {shape:?} must be divisible by LOD factor {factor}"
    );

    let [size_x, size_y, size_z] = shape;
    let coarse_shape = [size_x / factor, size_y / factor, size_z / factor];
    let [cs_x, cs_y, cs_z] = coarse_shape;

    let classifier = LodClassifier::new(registry);
    let mut cells = vec![CellAccumulator::default(); cs_x * cs_y * cs_z];

    let coarse_index =
        |cx: usize, cy: usize, cz: usize| -> usize { cx * cs_y * cs_z + cy * cs_z + cz };

    for fx in 0..size_x {
        let cx = fx / factor;
        for fy in 0..size_y {
            let cy = fy / factor;
            let local_y = (fy % factor) as u32;
            let row = fx * size_y * size_z + fy * size_z;
            for fz in 0..size_z {
                let cz = fz / factor;
                let fine_index = row + fz;

                let cell = &mut cells[coarse_index(cx, cy, cz)];

                let light = lights[fine_index];
                if light != 0 {
                    let (sun, red, green, blue) = LightUtils::extract_all(light);
                    cell.light_max[0] = cell.light_max[0].max(sun);
                    cell.light_max[1] = cell.light_max[1].max(red);
                    cell.light_max[2] = cell.light_max[2].max(green);
                    cell.light_max[3] = cell.light_max[3].max(blue);
                }

                let raw = voxels[fine_index];
                let id = raw & 0xFFFF;
                if id == 0 {
                    continue;
                }
                let class = classifier.class_of(id);
                if class == 0 {
                    continue;
                }

                let preferred = (class & CLASS_PREFERRED != 0) as u8;
                if class & CLASS_OPAQUE != 0 {
                    upgrade_pick(&mut cell.opaque, (preferred, fy as u32, id));
                } else if class & CLASS_SOLID != 0 {
                    upgrade_pick(&mut cell.solid, (preferred, fy as u32, id));
                } else if class & CLASS_FLUID != 0 {
                    if cell.fluid.map_or(true, |(top_y, ..)| fy as u32 >= top_y) {
                        cell.fluid = Some((fy as u32, local_y, raw));
                    }
                }
            }
        }
    }

    let mut coarse_voxels = vec![0u32; cells.len()];
    let mut coarse_lights = vec![0u32; cells.len()];

    for (index, cell) in cells.iter().enumerate() {
        coarse_voxels[index] = if let Some((.., id)) = cell.opaque {
            id
        } else if let Some((.., id)) = cell.solid {
            id
        } else if let Some((_, local_y, raw)) = cell.fluid {
            let id = raw & 0xFFFF;
            let fine_stage = (raw >> 24) & 0xF;
            let fine_height =
                (FLUID_BASE_HEIGHT - fine_stage as f32 * FLUID_STAGE_DROPOFF).max(0.1);
            let target_height = (local_y as f32 + fine_height) / factor as f32;
            id | (encode_fluid_stage_for_height(target_height) << 24)
        } else {
            0
        };

        let mut light = 0u32;
        light = LightUtils::insert_sunlight(light, cell.light_max[0]);
        light = LightUtils::insert_red_light(light, cell.light_max[1]);
        light = LightUtils::insert_green_light(light, cell.light_max[2]);
        light = LightUtils::insert_blue_light(light, cell.light_max[3]);
        coarse_lights[index] = light;
    }

    ChunkData {
        voxels: coarse_voxels,
        lights: coarse_lights,
        shape: coarse_shape,
        min: [0, 0, 0],
    }
}

/// Mesh one chunk at LOD `level` (downsample factor `2^level`).
///
/// The coarse grid is meshed in isolation — everything outside the chunk is
/// void — which produces the closed hull described in the module docs. The
/// mesher runs in coarse cell units and the resulting positions are scaled
/// by the factor, so the returned geometry is in block units relative to the
/// chunk's min corner, exactly like a full-resolution chunk mesh.
pub fn mesh_chunk_lod(
    voxels: &[u32],
    lights: &[u32],
    shape: [usize; 3],
    level: u32,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    assert!(level >= 1, "LOD level must be at least 1");
    let factor = 1usize << level;

    let coarse = downsample_chunk(voxels, lights, shape, factor, registry);
    mesh_coarse_chunk(&coarse, factor, registry)
}

/// Mesh an already-downsampled chunk as a closed hull and scale the output
/// back to block units.
pub fn mesh_coarse_chunk(
    coarse: &ChunkData,
    factor: usize,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let [cs_x, cs_y, cs_z] = coarse.shape;

    // A single-chunk neighborhood: only the center slot is populated, so the
    // space reports `contains() == false` for every out-of-chunk coordinate
    // and the mesher emits the closed border walls.
    let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(ChunkData {
        voxels: coarse.voxels.clone(),
        lights: coarse.lights.clone(),
        shape: coarse.shape,
        min: [0, 0, 0],
    });

    let space = VoxelSpace::new(&chunks, cs_x as i32, [0, 0]);

    let min = [0, 0, 0];
    let max = [cs_x as i32, cs_y as i32, cs_z as i32];

    let mut geometries = mesh_space_greedy(&min, &max, &space, registry);

    let scale = factor as f32;
    for geometry in &mut geometries {
        for position in &mut geometry.positions {
            *position *= scale;
        }
        if let Some(at) = &mut geometry.at {
            at[0] *= factor as i32;
            at[1] *= factor as i32;
            at[2] *= factor as i32;
        }
    }

    geometries
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesher::{Block, MeshConfig};
    use voxelize_core::{BlockFace, CornerData, AABB, UV};

    const AIR: u32 = 0;
    const STONE: u32 = 1;
    const GRASS: u32 = 2;
    const WATER: u32 = 3;
    const LEAVES: u32 = 4;
    const PLANT: u32 = 5;
    const SIGN: u32 = 6;

    fn six_faces() -> Vec<BlockFace> {
        let corner = |x: f32, y: f32, z: f32, u: f32, v: f32| CornerData {
            pos: [x, y, z],
            uv: [u, v],
        };
        let face = |name: &str, dir: [i32; 3], corners: [CornerData; 4]| BlockFace {
            name: name.to_string(),
            name_lower: name.to_string(),
            dir,
            independent: false,
            isolated: false,
            texture_group: None,
            range: UV::default(),
            corners,
        };

        vec![
            face(
                "px",
                [1, 0, 0],
                [
                    corner(1.0, 1.0, 1.0, 0.0, 1.0),
                    corner(1.0, 0.0, 1.0, 0.0, 0.0),
                    corner(1.0, 1.0, 0.0, 1.0, 1.0),
                    corner(1.0, 0.0, 0.0, 1.0, 0.0),
                ],
            ),
            face(
                "py",
                [0, 1, 0],
                [
                    corner(0.0, 1.0, 1.0, 1.0, 1.0),
                    corner(1.0, 1.0, 1.0, 0.0, 1.0),
                    corner(0.0, 1.0, 0.0, 1.0, 0.0),
                    corner(1.0, 1.0, 0.0, 0.0, 0.0),
                ],
            ),
            face(
                "pz",
                [0, 0, 1],
                [
                    corner(0.0, 0.0, 1.0, 0.0, 0.0),
                    corner(1.0, 0.0, 1.0, 1.0, 0.0),
                    corner(0.0, 1.0, 1.0, 0.0, 1.0),
                    corner(1.0, 1.0, 1.0, 1.0, 1.0),
                ],
            ),
            face(
                "nx",
                [-1, 0, 0],
                [
                    corner(0.0, 1.0, 0.0, 0.0, 1.0),
                    corner(0.0, 0.0, 0.0, 0.0, 0.0),
                    corner(0.0, 1.0, 1.0, 1.0, 1.0),
                    corner(0.0, 0.0, 1.0, 1.0, 0.0),
                ],
            ),
            face(
                "ny",
                [0, -1, 0],
                [
                    corner(1.0, 0.0, 1.0, 1.0, 0.0),
                    corner(0.0, 0.0, 1.0, 0.0, 0.0),
                    corner(1.0, 0.0, 0.0, 1.0, 1.0),
                    corner(0.0, 0.0, 0.0, 0.0, 1.0),
                ],
            ),
            face(
                "nz",
                [0, 0, -1],
                [
                    corner(1.0, 0.0, 0.0, 0.0, 0.0),
                    corner(0.0, 0.0, 0.0, 1.0, 0.0),
                    corner(1.0, 1.0, 0.0, 0.0, 1.0),
                    corner(0.0, 1.0, 0.0, 1.0, 1.0),
                ],
            ),
        ]
    }

    fn full_cube_aabb() -> Vec<AABB> {
        vec![AABB {
            min_x: 0.0,
            min_y: 0.0,
            min_z: 0.0,
            max_x: 1.0,
            max_y: 1.0,
            max_z: 1.0,
        }]
    }

    fn base_block(id: u32, name: &str) -> Block {
        Block {
            id,
            name: name.to_string(),
            name_lower: name.to_lowercase(),
            rotatable: false,
            y_rotatable: false,
            is_empty: false,
            is_fluid: false,
            is_waterlogged: false,
            is_opaque: true,
            is_see_through: false,
            is_transparent: [false; 6],
            transparent_standalone: false,
            occludes_fluid: false,
            is_plant: false,
            faces: six_faces(),
            aabbs: full_cube_aabb(),
            dynamic_patterns: None,
        }
    }

    fn test_registry() -> Registry {
        let mut air = base_block(AIR, "Air");
        air.is_empty = true;
        air.is_opaque = false;
        air.is_transparent = [true; 6];
        air.faces = vec![];
        air.aabbs = vec![];

        let stone = base_block(STONE, "Stone");
        let grass = base_block(GRASS, "Grass Block");

        let mut water = base_block(WATER, "Water");
        water.is_fluid = true;
        water.is_opaque = false;
        water.is_see_through = true;
        water.is_transparent = [true; 6];

        let mut leaves = base_block(LEAVES, "Leaves");
        leaves.is_opaque = false;
        leaves.is_see_through = true;
        leaves.is_transparent = [true; 6];
        leaves.transparent_standalone = true;

        let mut plant = base_block(PLANT, "Plant");
        plant.is_opaque = false;
        plant.is_see_through = true;
        plant.is_transparent = [true; 6];
        plant.is_plant = true;
        plant.aabbs = vec![];

        let mut sign = base_block(SIGN, "Sign");
        for face in &mut sign.faces {
            if face.name == "pz" {
                face.isolated = true;
            }
        }

        let mut registry = Registry::new(vec![
            (AIR, air),
            (STONE, stone),
            (GRASS, grass),
            (WATER, water),
            (LEAVES, leaves),
            (PLANT, plant),
            (SIGN, sign),
        ]);
        registry.build_cache();
        registry
    }

    struct FineChunk {
        voxels: Vec<u32>,
        lights: Vec<u32>,
        shape: [usize; 3],
    }

    impl FineChunk {
        fn new(shape: [usize; 3]) -> Self {
            let volume = shape[0] * shape[1] * shape[2];
            Self {
                voxels: vec![0; volume],
                lights: vec![0; volume],
                shape,
            }
        }

        fn index(&self, x: usize, y: usize, z: usize) -> usize {
            x * self.shape[1] * self.shape[2] + y * self.shape[2] + z
        }

        fn set(&mut self, x: usize, y: usize, z: usize, raw: u32) {
            let index = self.index(x, y, z);
            self.voxels[index] = raw;
        }

        fn set_light(&mut self, x: usize, y: usize, z: usize, light: u32) {
            let index = self.index(x, y, z);
            self.lights[index] = light;
        }

        fn coarse(&self, factor: usize, registry: &Registry) -> ChunkData {
            downsample_chunk(&self.voxels, &self.lights, self.shape, factor, registry)
        }
    }

    fn coarse_at(coarse: &ChunkData, x: usize, y: usize, z: usize) -> u32 {
        coarse.voxels[x * coarse.shape[1] * coarse.shape[2] + y * coarse.shape[2] + z]
    }

    /// Deterministic pseudo-random heightmap for structural tests.
    fn test_height(x: i32, z: i32) -> usize {
        let h = (x as u32).wrapping_mul(2654435761) ^ (z as u32).wrapping_mul(40503);
        4 + (h % 9) as usize
    }

    #[test]
    fn cell_with_any_opaque_voxel_becomes_opaque() {
        let mut fine = FineChunk::new([4, 4, 4]);
        fine.set(3, 1, 2, STONE);

        let coarse = fine.coarse(2, &test_registry());

        assert_eq!(coarse.shape, [2, 2, 2]);
        assert_eq!(
            coarse_at(&coarse, 1, 0, 1),
            STONE,
            "one opaque voxel out of eight must solidify the coarse cell (seam invariant)"
        );
        assert_eq!(coarse_at(&coarse, 0, 0, 0), AIR);
    }

    #[test]
    fn representative_is_topmost_opaque_block() {
        let mut fine = FineChunk::new([4, 4, 4]);
        fine.set(0, 0, 0, STONE);
        fine.set(0, 1, 0, STONE);
        fine.set(0, 2, 0, STONE);
        fine.set(0, 3, 0, GRASS);

        let coarse = fine.coarse(4, &test_registry());

        assert_eq!(coarse.shape, [1, 1, 1]);
        assert_eq!(
            coarse_at(&coarse, 0, 0, 0),
            GRASS,
            "surface block must win so distant hills keep their surface texture"
        );
    }

    #[test]
    fn representative_prefers_blocks_without_isolated_faces() {
        let mut fine = FineChunk::new([2, 2, 2]);
        fine.set(0, 0, 0, STONE);
        fine.set(0, 1, 0, SIGN);

        let coarse = fine.coarse(2, &test_registry());

        assert_eq!(
            coarse_at(&coarse, 0, 0, 0),
            STONE,
            "blocks with isolated faces must not represent a cell when a plain block exists"
        );
    }

    #[test]
    fn representative_strips_rotation_and_stage_bits() {
        let mut fine = FineChunk::new([2, 2, 2]);
        fine.set(0, 0, 0, STONE | (3 << 16) | (5 << 20) | (7 << 24));

        let coarse = fine.coarse(2, &test_registry());

        assert_eq!(coarse_at(&coarse, 0, 0, 0), STONE);
    }

    #[test]
    fn plants_do_not_solidify_cells() {
        let mut fine = FineChunk::new([2, 2, 2]);
        fine.set(0, 0, 0, PLANT);
        fine.set(1, 1, 1, PLANT);

        let coarse = fine.coarse(2, &test_registry());

        assert_eq!(
            coarse_at(&coarse, 0, 0, 0),
            AIR,
            "plants are subpixel at LOD distance and must not become full cells"
        );
    }

    #[test]
    fn leaves_solidify_cells_without_outranking_opaque() {
        let mut fine = FineChunk::new([4, 4, 4]);
        fine.set(0, 0, 0, STONE);
        fine.set(0, 3, 0, LEAVES);

        let coarse = fine.coarse(4, &test_registry());
        assert_eq!(
            coarse_at(&coarse, 0, 0, 0),
            STONE,
            "opaque blocks must outrank see-through solids even below them (seam invariant)"
        );

        let mut canopy = FineChunk::new([2, 2, 2]);
        canopy.set(0, 0, 0, LEAVES);
        let coarse = canopy.coarse(2, &test_registry());
        assert_eq!(coarse_at(&coarse, 0, 0, 0), LEAVES);
    }

    #[test]
    fn lights_downsample_to_channel_maxima() {
        let mut fine = FineChunk::new([2, 2, 2]);
        let mut a = 0u32;
        a = LightUtils::insert_sunlight(a, 15);
        a = LightUtils::insert_red_light(a, 2);
        let mut b = 0u32;
        b = LightUtils::insert_red_light(b, 9);
        b = LightUtils::insert_blue_light(b, 4);
        fine.set_light(0, 1, 0, a);
        fine.set_light(1, 0, 1, b);

        let coarse = fine.coarse(2, &test_registry());

        let light = coarse.lights[0];
        assert_eq!(LightUtils::extract_sunlight(light), 15);
        assert_eq!(LightUtils::extract_red_light(light), 9);
        assert_eq!(LightUtils::extract_green_light(light), 0);
        assert_eq!(LightUtils::extract_blue_light(light), 4);
    }

    #[test]
    fn fluid_cells_encode_surface_height_in_stage_bits() {
        let registry = test_registry();
        let factor = 4usize;

        // Water fills fine y in 0..=2 of a 4-tall cell: the true surface sits
        // at 2 + 0.875 blocks, i.e. 0.71875 of the coarse cell.
        let mut fine = FineChunk::new([4, 4, 4]);
        for x in 0..4 {
            for z in 0..4 {
                for y in 0..3 {
                    fine.set(x, y, z, WATER);
                }
            }
        }

        let coarse = fine.coarse(factor, &registry);
        let raw = coarse_at(&coarse, 0, 0, 0);

        assert_eq!(raw & 0xFFFF, WATER);
        let stage = (raw >> 24) & 0xF;
        let decoded_height = (FLUID_BASE_HEIGHT - stage as f32 * FLUID_STAGE_DROPOFF).max(0.1);
        let target = (2.0 + FLUID_BASE_HEIGHT) / factor as f32;
        assert!(
            (decoded_height - target).abs() <= FLUID_STAGE_DROPOFF / 2.0 + 1e-4,
            "decoded fluid height {decoded_height} must approximate the true fractional \
             surface {target} so scaled water lines up with the full-detail water level"
        );
    }

    #[test]
    fn solid_cells_hide_contained_fluid() {
        let mut fine = FineChunk::new([2, 2, 2]);
        fine.set(0, 0, 0, WATER);
        fine.set(1, 1, 1, STONE);

        let coarse = fine.coarse(2, &test_registry());
        assert_eq!(coarse_at(&coarse, 0, 0, 0), STONE);
    }

    /// Solidity must be monotonic across levels: a solid cell at level L maps
    /// into a solid cell at level L+1. The full-detail seam proof relies on
    /// this for opaque voxels, and it keeps LOD ring boundaries hole-free.
    #[test]
    fn downsampling_is_monotonic_across_levels() {
        let registry = test_registry();
        let mut fine = FineChunk::new([16, 32, 16]);
        for x in 0..16i32 {
            for z in 0..16i32 {
                let height = test_height(x, z);
                for y in 0..height {
                    fine.set(x as usize, y, z as usize, STONE);
                }
                fine.set(x as usize, height, z as usize, GRASS);
            }
        }

        let coarse_1 = fine.coarse(2, &registry);
        let coarse_2 = fine.coarse(4, &registry);

        for x in 0..coarse_1.shape[0] {
            for y in 0..coarse_1.shape[1] {
                for z in 0..coarse_1.shape[2] {
                    if coarse_at(&coarse_1, x, y, z) != AIR {
                        assert_ne!(
                            coarse_at(&coarse_2, x / 2, y / 2, z / 2),
                            AIR,
                            "solid L1 cell ({x},{y},{z}) must stay solid at L2"
                        );
                    }
                }
            }
        }
    }

    /// Axis-aligned rectangle coverage tracker over a fine-resolution grid on
    /// one boundary plane. Quads are rasterized at block resolution.
    struct PlaneCoverage {
        cells: Vec<bool>,
        height: usize,
        depth: usize,
    }

    impl PlaneCoverage {
        fn new(height: usize, depth: usize) -> Self {
            Self {
                cells: vec![false; height * depth],
                height,
                depth,
            }
        }

        /// Rasterize the quads of `geometries` that lie exactly on the plane
        /// `x == plane_x` (world coordinates, geometry offset by `offset`).
        fn cover_from(&mut self, geometries: &[GeometryProtocol], offset: [f32; 3], plane_x: f32) {
            for geometry in geometries {
                let positions = &geometry.positions;
                for quad in 0..positions.len() / 12 {
                    let base = quad * 12;
                    let corners: Vec<[f32; 3]> = (0..4)
                        .map(|i| {
                            [
                                positions[base + i * 3] + offset[0],
                                positions[base + i * 3 + 1] + offset[1],
                                positions[base + i * 3 + 2] + offset[2],
                            ]
                        })
                        .collect();

                    if corners.iter().any(|c| (c[0] - plane_x).abs() > 1e-4) {
                        continue;
                    }

                    let min_y = corners.iter().map(|c| c[1]).fold(f32::MAX, f32::min);
                    let max_y = corners.iter().map(|c| c[1]).fold(f32::MIN, f32::max);
                    let min_z = corners.iter().map(|c| c[2]).fold(f32::MAX, f32::min);
                    let max_z = corners.iter().map(|c| c[2]).fold(f32::MIN, f32::max);

                    for y in (min_y.round() as usize)..(max_y.round() as usize) {
                        for z in (min_z.round() as usize)..(max_z.round() as usize) {
                            if y < self.height && z < self.depth {
                                self.cells[y * self.depth + z] = true;
                            }
                        }
                    }
                }
            }
        }

        fn is_covered(&self, y: usize, z: usize) -> bool {
            self.cells[y * self.depth + z]
        }
    }

    /// The closed-hull property: every solid border cell of a LOD chunk emits
    /// its border wall, so the mesh is watertight regardless of neighbors.
    #[test]
    fn lod_mesh_is_a_closed_hull_at_chunk_borders() {
        let registry = test_registry();
        let size = 16usize;
        let height = 32usize;
        let factor = 2usize;

        let mut fine = FineChunk::new([size, height, size]);
        for x in 0..size as i32 {
            for z in 0..size as i32 {
                let column = test_height(x, z);
                for y in 0..column {
                    fine.set(x as usize, y, z as usize, STONE);
                }
                fine.set(x as usize, column, z as usize, GRASS);
            }
        }

        let coarse = fine.coarse(factor, &registry);
        let geometries = mesh_coarse_chunk(&coarse, factor, &registry);

        let mut coverage = PlaneCoverage::new(height, size);
        coverage.cover_from(&geometries, [0.0, 0.0, 0.0], 0.0);

        for cy in 0..coarse.shape[1] {
            for cz in 0..coarse.shape[2] {
                if coarse_at(&coarse, 0, cy, cz) == AIR {
                    continue;
                }
                for y in cy * factor..(cy + 1) * factor {
                    for z in cz * factor..(cz + 1) * factor {
                        assert!(
                            coverage.is_covered(y, z),
                            "solid border cell (0,{cy},{cz}) leaves fine cell (y={y},z={z}) \
                             uncovered on the x=0 border wall — hull is not closed"
                        );
                    }
                }
            }
        }
    }

    /// THE seam test: a full-detail chunk meshed against its true neighbor,
    /// next to that neighbor rendered as a LOD-1 closed hull. Every fine cell
    /// of the shared boundary plane where the displayed occupancy flips
    /// (full-detail solid on one side XOR displayed-coarse solid on the
    /// other) must be covered by geometry from at least one side; otherwise
    /// a viewer could see into a solid volume's interior — a crack.
    #[test]
    fn full_detail_to_lod_boundary_is_watertight() {
        let registry = test_registry();
        let size = 16usize;
        let height = 32usize;
        let factor = 2usize;

        // Chunk A occupies x in 0..16, chunk B x in 16..32. The terrain
        // crosses the boundary with height discontinuities in both
        // directions, plus a water pond and a tree canopy near the border on
        // the B side to exercise non-opaque paths.
        let mut a = FineChunk::new([size, height, size]);
        let mut b = FineChunk::new([size, height, size]);

        for x in 0..(2 * size) as i32 {
            for z in 0..size as i32 {
                let column = test_height(x, z);
                let (chunk, lx) = if (x as usize) < size {
                    (&mut a, x as usize)
                } else {
                    (&mut b, x as usize - size)
                };
                for y in 0..column {
                    chunk.set(lx, y, z as usize, STONE);
                }
                chunk.set(lx, column, z as usize, GRASS);
            }
        }

        for z in 4..8usize {
            b.set(0, test_height(16, z as i32) + 1, z, WATER);
        }
        for z in 10..13usize {
            b.set(1, 14, z, LEAVES);
            b.set(0, 15, z, LEAVES);
        }

        // Full-detail mesh of A against B's true voxels (exactly what the
        // engine produces for the outermost full-detail ring's inner chunks).
        let a_data = ChunkData {
            voxels: a.voxels.clone(),
            lights: a.lights.clone(),
            shape: a.shape,
            min: [0, 0, 0],
        };
        let b_data = ChunkData {
            voxels: b.voxels.clone(),
            lights: b.lights.clone(),
            shape: b.shape,
            min: [size as i32, 0, 0],
        };

        let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
        chunks[4] = Some(a_data);
        chunks[5] = Some(b_data);
        let space = VoxelSpace::new(&chunks, size as i32, [0, 0]);
        let a_geometries = mesh_space_greedy(
            &[0, 0, 0],
            &[size as i32, height as i32, size as i32],
            &space,
            &registry,
        );

        // LOD-1 closed hull of B.
        let b_coarse = b.coarse(factor, &registry);
        let b_geometries = mesh_coarse_chunk(&b_coarse, factor, &registry);

        let plane_x = size as f32;
        let mut coverage = PlaneCoverage::new(height, size);
        coverage.cover_from(&a_geometries, [0.0, 0.0, 0.0], plane_x);
        coverage.cover_from(&b_geometries, [size as f32, 0.0, 0.0], plane_x);

        let opaque = |id: u32| -> bool {
            registry
                .get_block_by_id(id)
                .map(|block| block.is_opaque)
                .unwrap_or(false)
        };

        let mut checked = 0;
        for y in 0..height {
            for z in 0..size {
                let a_solid = opaque(a.voxels[a.index(size - 1, y, z)] & 0xFFFF);
                let b_display_solid = opaque(
                    coarse_at(&b_coarse, 0, y / factor, z / factor) & 0xFFFF,
                );

                if a_solid != b_display_solid {
                    checked += 1;
                    assert!(
                        coverage.is_covered(y, z),
                        "boundary cell (y={y},z={z}) transitions solid<->air across the \
                         full-detail/LOD seam but no geometry covers it — this is a crack"
                    );
                }
            }
        }

        assert!(
            checked > 20,
            "expected a meaningful number of occupancy transitions on the test seam, got {checked}"
        );
    }

    /// A second seam direction: LOD-1 chunk next to LOD-2 chunk. Both are
    /// closed hulls; the coarser side's occupancy is a superset of the finer
    /// side's (monotonicity), so every transition must again be covered.
    #[test]
    fn lod_to_lod_boundary_is_watertight() {
        let registry = test_registry();
        let size = 16usize;
        let height = 32usize;

        let mut a = FineChunk::new([size, height, size]);
        let mut b = FineChunk::new([size, height, size]);
        for x in 0..(2 * size) as i32 {
            for z in 0..size as i32 {
                let column = test_height(x, z);
                let (chunk, lx) = if (x as usize) < size {
                    (&mut a, x as usize)
                } else {
                    (&mut b, x as usize - size)
                };
                for y in 0..=column {
                    chunk.set(lx, y, z as usize, STONE);
                }
            }
        }

        let a_coarse = a.coarse(2, &registry);
        let b_coarse = b.coarse(4, &registry);
        let a_geometries = mesh_coarse_chunk(&a_coarse, 2, &registry);
        let b_geometries = mesh_coarse_chunk(&b_coarse, 4, &registry);

        let plane_x = size as f32;
        let mut coverage = PlaneCoverage::new(height, size);
        coverage.cover_from(&a_geometries, [0.0, 0.0, 0.0], plane_x);
        coverage.cover_from(&b_geometries, [size as f32, 0.0, 0.0], plane_x);

        let mut checked = 0;
        for y in 0..height {
            for z in 0..size {
                let a_solid = coarse_at(&a_coarse, size / 2 - 1, y / 2, z / 2) != AIR;
                let b_solid = coarse_at(&b_coarse, 0, y / 4, z / 4) != AIR;
                if a_solid != b_solid {
                    checked += 1;
                    assert!(
                        coverage.is_covered(y, z),
                        "boundary cell (y={y},z={z}) transitions across the LOD1/LOD2 seam \
                         but no geometry covers it — this is a crack"
                    );
                }
            }
        }
        assert!(checked > 0, "test terrain must produce seam transitions");
    }

    #[test]
    fn lod_positions_are_scaled_to_block_units() {
        let registry = test_registry();
        let mut fine = FineChunk::new([4, 4, 4]);
        for x in 0..2 {
            for y in 0..2 {
                for z in 0..2 {
                    fine.set(x, y, z, STONE);
                }
            }
        }

        let geometries = mesh_chunk_lod(&fine.voxels, &fine.lights, fine.shape, 1, &registry);

        assert_eq!(geometries.len(), 1);
        let positions = &geometries[0].positions;
        assert!(!positions.is_empty());

        let mut max_coord = f32::MIN;
        let mut min_coord = f32::MAX;
        for value in positions {
            max_coord = max_coord.max(*value);
            min_coord = min_coord.min(*value);
        }
        assert_eq!(min_coord, 0.0);
        assert_eq!(
            max_coord, 2.0,
            "a single coarse cell at LOD 1 must span exactly 2 blocks"
        );
        assert_eq!(geometries[0].voxel, STONE);
    }

    /// Water surfaces must stay flat at chunk borders in closed hulls: the
    /// void outside the chunk is a continuation, not air, so corner heights
    /// must not droop toward the border.
    #[test]
    fn lod_water_surface_stays_flat_at_chunk_borders() {
        let registry = test_registry();
        let size = 8usize;
        let height = 8usize;

        let mut fine = FineChunk::new([size, height, size]);
        for x in 0..size {
            for z in 0..size {
                fine.set(x, 0, z, STONE);
                for y in 1..4 {
                    fine.set(x, y, z, WATER);
                }
            }
        }

        let geometries = mesh_chunk_lod(&fine.voxels, &fine.lights, fine.shape, 1, &registry);

        let water_geometry = geometries
            .iter()
            .find(|geometry| geometry.voxel == WATER)
            .expect("LOD mesh must contain water geometry");

        // Collect the highest vertex of every water column: the top surface.
        // All of them — including the chunk-border ones — must sit near the
        // encoded surface height, with no 0.1-cell droop at borders.
        let mut top_heights: Vec<f32> = Vec::new();
        for quad in 0..water_geometry.positions.len() / 12 {
            for corner in 0..4 {
                let y = water_geometry.positions[quad * 12 + corner * 3 + 1];
                if y > 3.0 {
                    top_heights.push(y);
                }
            }
        }

        assert!(!top_heights.is_empty(), "water surface must be meshed");
        let min_top = top_heights.iter().fold(f32::MAX, |a, &b| a.min(b));
        let max_top = top_heights.iter().fold(f32::MIN, |a, &b| a.max(b));
        assert!(
            max_top - min_top < 0.05,
            "water surface must be flat across the whole LOD chunk including borders, \
             got min {min_top} max {max_top}"
        );
    }

    #[test]
    fn mesh_config_default_unchanged() {
        assert_eq!(MeshConfig::default().chunk_size, 16);
    }
}
