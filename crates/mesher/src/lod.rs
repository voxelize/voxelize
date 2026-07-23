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

use voxelize_core::{BlockRotation, LightColor, LightUtils, VoxelAccess};

use crate::mesher::{
    mesh_space_greedy, ChunkData, GeometryProtocol, Registry, VoxelSpace, FLUID_BASE_HEIGHT,
    FLUID_STAGE_DROPOFF,
};

/// The isolated coarse space a LOD hull is meshed in, with the void treated
/// as a *continuation of the chunk's own edge* for everything the mesher
/// samples but does not build geometry from.
///
/// Occupancy is untouched — `contains` still reports the void, so hull
/// border walls emit and fluids skip their void faces exactly as before.
/// What changes is what out-of-chunk *samples* return:
///
/// - **Voxels** mirror the nearest in-chunk cell (clamp-to-edge), so ambient
///   occlusion at border cells darkens like the equivalent interior corner
///   instead of reading the void as permanently open air.
/// - **Light** returns the border column's *surface light* — the light
///   resting directly above the column's topmost solid cell. That is the
///   best single approximation of the neighbor's open-air light profile:
///   full sunlight over open land (exposed hull cliffs stay lit — the
///   original black-wall bug), attenuated water light over the sea floor,
///   and dim light in shaded valleys. A constant "sky" value here is what
///   painted a bright lattice along every LOD chunk seam wherever real
///   local light was below maximum (underwater, shaded slopes): border-face
///   corners averaged the constant into their samples and rendered brighter
///   than the interior one cell away.
struct EdgeLitLodSpace<'a> {
    inner: VoxelSpace<'a>,
    shape: [i32; 3],
    /// Per-column packed light (`shape.x * shape.z`, row-major x then z) of
    /// the cell sitting on the column's topmost solid cell.
    surface_lights: Vec<u32>,
}

impl<'a> EdgeLitLodSpace<'a> {
    fn new(inner: VoxelSpace<'a>, coarse: &ChunkData, registry: &Registry) -> Self {
        Self {
            inner,
            shape: [
                coarse.shape[0] as i32,
                coarse.shape[1] as i32,
                coarse.shape[2] as i32,
            ],
            surface_lights: compute_surface_lights(coarse, registry),
        }
    }

    #[inline]
    fn clamped(&self, vx: i32, vy: i32, vz: i32) -> (i32, i32, i32) {
        (
            vx.clamp(0, self.shape[0] - 1),
            vy.clamp(0, self.shape[1] - 1),
            vz.clamp(0, self.shape[2] - 1),
        )
    }

    #[inline]
    fn surface_light(&self, vx: i32, vz: i32) -> u32 {
        let x = vx.clamp(0, self.shape[0] - 1) as usize;
        let z = vz.clamp(0, self.shape[2] - 1) as usize;
        self.surface_lights[x * self.shape[2] as usize + z]
    }
}

impl<'a> VoxelAccess for EdgeLitLodSpace<'a> {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.inner.contains(vx, vy, vz) {
            return self.inner.get_voxel(vx, vy, vz);
        }
        let (cx, cy, cz) = self.clamped(vx, vy, vz);
        self.inner.get_voxel(cx, cy, cz)
    }

    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.inner.contains(vx, vy, vz) {
            return self.inner.get_raw_voxel(vx, vy, vz);
        }
        let (cx, cy, cz) = self.clamped(vx, vy, vz);
        self.inner.get_raw_voxel(cx, cy, cz)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        let (cx, cy, cz) = self.clamped(vx, vy, vz);
        self.inner.get_voxel_rotation(cx, cy, cz)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let (cx, cy, cz) = self.clamped(vx, vy, vz);
        self.inner.get_voxel_stage(cx, cy, cz)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if self.inner.contains(vx, vy, vz) {
            return self.inner.get_sunlight(vx, vy, vz);
        }
        LightUtils::extract_sunlight(self.surface_light(vx, vz))
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        if self.inner.contains(vx, vy, vz) {
            return self.inner.get_torch_light(vx, vy, vz, color);
        }
        let light = self.surface_light(vx, vz);
        match color {
            LightColor::Sunlight => LightUtils::extract_sunlight(light),
            LightColor::Red => LightUtils::extract_red_light(light),
            LightColor::Green => LightUtils::extract_green_light(light),
            LightColor::Blue => LightUtils::extract_blue_light(light),
        }
    }

    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        if self.inner.contains(vx, vy, vz) {
            return self.inner.get_all_lights(vx, vy, vz);
        }
        LightUtils::extract_all(self.surface_light(vx, vz))
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        self.inner.get_max_height(vx, vz)
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.inner.contains(vx, vy, vz)
    }
}

/// For every coarse column, the packed light of the cell resting on the
/// column's topmost solid (non-empty, non-fluid) cell: full sunlight over
/// open ground, attenuated water light over a submerged floor, dim light
/// under overhangs. Columns with no solid cell (or solid to the ceiling)
/// fall back to their topmost cell's light.
fn compute_surface_lights(coarse: &ChunkData, registry: &Registry) -> Vec<u32> {
    let [size_x, size_y, size_z] = coarse.shape;
    let mut surface_lights = vec![0u32; size_x * size_z];

    for x in 0..size_x {
        for z in 0..size_z {
            let column = x * size_y * size_z + z;
            let index_of = |y: usize| column + y * size_z;

            let mut surface_y = size_y - 1;
            for y in (0..size_y).rev() {
                let id = coarse.voxels[index_of(y)] & 0xFFFF;
                if id == 0 {
                    continue;
                }
                let is_solid = registry
                    .get_block_by_id(id)
                    .map(|block| !block.is_empty && !block.is_fluid)
                    .unwrap_or(false);
                if is_solid {
                    surface_y = (y + 1).min(size_y - 1);
                    break;
                }
            }

            surface_lights[x * size_z + z] = coarse.lights[index_of(surface_y)];
        }
    }

    surface_lights
}

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
    /// Topmost solid fine y in the cell, independent of representative
    /// preference — the fluid spill-up rule compares against this.
    top_solid_y: Option<u32>,
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
                    cell.top_solid_y = Some(cell.top_solid_y.map_or(fy as u32, |y| y.max(fy as u32)));
                } else if class & CLASS_SOLID != 0 {
                    upgrade_pick(&mut cell.solid, (preferred, fy as u32, id));
                    cell.top_solid_y = Some(cell.top_solid_y.map_or(fy as u32, |y| y.max(fy as u32)));
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

    // Fluid spill-up: a cell whose fine content is water OVER a floor
    // resolves solid (the seam invariant demands it), which would leave the
    // whole shallow area dry — coastlines and shoals then render as bands of
    // water separated by bare floor. Spill a thin fluid film into the cell
    // above (when it is otherwise air) so shallow water keeps a continuous
    // surface; the film sits at most one cell above the true level, which
    // reads as a gentle shore at LOD distance.
    for cx in 0..cs_x {
        for cz in 0..cs_z {
            for cy in 0..cs_y - 1 {
                let index = coarse_index(cx, cy, cz);
                let cell = &cells[index];

                let (Some(top_solid_y), Some((fluid_top_y, _, raw))) =
                    (cell.top_solid_y, cell.fluid)
                else {
                    continue;
                };
                if fluid_top_y <= top_solid_y {
                    continue;
                }

                let above = coarse_index(cx, cy + 1, cz);
                if coarse_voxels[above] == 0 {
                    coarse_voxels[above] = (raw & 0xFFFF) | (15 << 24);
                }
            }
        }
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
    // and the mesher emits the closed border walls (edge-lit, see
    // [`EdgeLitLodSpace`]).
    let mut chunks: Vec<Option<ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(ChunkData {
        voxels: coarse.voxels.clone(),
        lights: coarse.lights.clone(),
        shape: coarse.shape,
        min: [0, 0, 0],
    });

    let space = EdgeLitLodSpace::new(VoxelSpace::new(&chunks, cs_x as i32, [0, 0]), coarse, registry);

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

    /// Shallow water whose floor and surface share one coarse cell must not
    /// dry out: the cell resolves solid (the seam invariant requires it), so
    /// a thin fluid film spills into the air cell above. Without this,
    /// coastlines and shoals render as bands of water separated by bare
    /// floor at LOD distance.
    #[test]
    fn shallow_water_spills_a_surface_film_instead_of_drying_out() {
        let registry = test_registry();
        let factor = 4usize;
        let size = 4usize;
        let height = 16usize;

        let mut fine = FineChunk::new([size, height, size]);
        for x in 0..size {
            for z in 0..size {
                // Floor tops out at fine y=4 (inside coarse cell y1), water
                // fills y=5..=6 — the surface lives in the same cell as the
                // floor top.
                for y in 0..=4 {
                    fine.set(x, y, z, STONE);
                }
                for y in 5..=6 {
                    fine.set(x, y, z, WATER);
                }
            }
        }

        let coarse = fine.coarse(factor, &registry);

        assert_eq!(
            coarse_at(&coarse, 0, 1, 0),
            STONE,
            "the mixed floor/water cell must stay solid (seam invariant)"
        );

        let film = coarse_at(&coarse, 0, 2, 0);
        assert_eq!(film & 0xFFFF, WATER, "a fluid film must spill upward");
        assert_eq!(
            (film >> 24) & 0xF,
            15,
            "the film must use the minimum-height stage"
        );

        // The film must actually mesh into a water surface.
        let geometries = mesh_chunk_lod(&fine.voxels, &fine.lights, fine.shape, 2, &registry);
        assert!(
            geometries.iter().any(|geometry| geometry.voxel == WATER),
            "spilled film must produce water geometry"
        );
    }

    /// Cells fully underwater (fluid above and below within the column) must
    /// not receive spill films — only the true surface cell carries one.
    #[test]
    fn fluid_spill_does_not_stack_inside_deep_water() {
        let registry = test_registry();
        let mut fine = FineChunk::new([4, 16, 4]);
        for x in 0..4 {
            for z in 0..4 {
                fine.set(x, 0, z, STONE);
                for y in 1..=9 {
                    fine.set(x, y, z, WATER);
                }
            }
        }

        let coarse = fine.coarse(4, &registry);

        // Cell y0 mixes floor + water (solid, spills), cells y1 and y2 are
        // pure water and air above them stays air.
        assert_eq!(coarse_at(&coarse, 0, 0, 0), STONE);
        assert_eq!(coarse_at(&coarse, 0, 1, 0) & 0xFFFF, WATER);
        assert_eq!(coarse_at(&coarse, 0, 2, 0) & 0xFFFF, WATER);
        assert_eq!(
            coarse_at(&coarse, 0, 3, 0),
            AIR,
            "no film may stack above the true water surface"
        );
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

    /// Fluid faces must never be emitted against the void: between adjacent
    /// water hulls both sides would emit full-height interior walls that are
    /// all visible through the transparent surface (stacking into an opaque,
    /// dark mass), and at data horizons the opaque hull behind them already
    /// closes the silhouette.
    #[test]
    fn lod_water_emits_no_hull_border_walls() {
        let registry = test_registry();
        let size = 8usize;
        let height = 8usize;
        let factor = 2usize;

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
            .expect("water surface must still be meshed");

        let border = size as f32;
        for quad in 0..water_geometry.positions.len() / 12 {
            for axis in [0usize, 2usize] {
                for plane in [0.0f32, border] {
                    let is_wall_on_plane = (0..4).all(|corner| {
                        let value = water_geometry.positions[quad * 12 + corner * 3 + axis];
                        (value - plane).abs() < 0.01
                    });
                    assert!(
                        !is_wall_on_plane,
                        "water quad {quad} sits on the hull border plane (axis {axis} at \
                         {plane}) — fluid faces must not be emitted against the void"
                    );
                }
            }
        }

        let solid_geometry = geometries
            .iter()
            .find(|geometry| geometry.voxel == STONE)
            .expect("hull floor must be meshed");
        let has_border_wall = (0..solid_geometry.positions.len() / 12).any(|quad| {
            (0..4).all(|corner| {
                solid_geometry.positions[quad * 12 + corner * 3].abs() < 0.01
            })
        });
        assert!(
            has_border_wall,
            "opaque hull border walls must remain closed — only fluids skip the void"
        );
    }

    /// Border lighting must be continuous with the interior: with uniformly
    /// dim light (e.g. under water or in shade), border-face corners must
    /// not brighten from out-of-chunk samples. A constant "sky" void light
    /// did exactly that — averaging full sunlight into every border corner —
    /// which painted a bright lattice along every LOD chunk seam.
    #[test]
    fn lod_border_lighting_matches_interior_in_dim_light() {
        let registry = test_registry();
        let size = 8usize;
        let height = 8usize;

        let mut fine = FineChunk::new([size, height, size]);
        let mut dim = 0u32;
        dim = LightUtils::insert_sunlight(dim, 9);
        for x in 0..size {
            for z in 0..size {
                for y in 0..3 {
                    fine.set(x, y, z, STONE);
                }
                for y in 3..height {
                    fine.set_light(x, y, z, dim);
                }
            }
        }

        let geometries = mesh_chunk_lod(&fine.voxels, &fine.lights, fine.shape, 1, &registry);
        let geometry = geometries
            .iter()
            .find(|geometry| geometry.voxel == STONE)
            .expect("terrain must be meshed");

        let mut max_sunlight = 0;
        for packed in &geometry.lights {
            let sunlight = LightUtils::extract_sunlight(*packed as u32 & 0xFFFF);
            assert!(
                sunlight <= 9,
                "no vertex may exceed the ambient light level: border faces must \
                 light like the interior, got sunlight {sunlight}"
            );
            max_sunlight = max_sunlight.max(sunlight);
        }
        assert_eq!(
            max_sunlight, 9,
            "faces exposed to the dim air must carry its light level"
        );
    }

    /// Hull walls face the neighbor's open air at display time, so their
    /// baked light must come from the border column's surface light — full
    /// sunlight over open land — not from the chunk's dark underground
    /// cells, otherwise every exposed LOD cliff fades to black.
    #[test]
    fn lod_hull_walls_are_surface_lit() {
        let registry = test_registry();
        let size = 8usize;
        let height = 16usize;

        let mut fine = FineChunk::new([size, height, size]);
        let mut sunlit = 0u32;
        sunlit = LightUtils::insert_sunlight(sunlit, 15);
        for x in 0..size {
            for z in 0..size {
                for y in 0..6 {
                    fine.set(x, y, z, STONE);
                }
                for y in 6..height {
                    fine.set_light(x, y, z, sunlit);
                }
            }
        }

        let geometries = mesh_chunk_lod(&fine.voxels, &fine.lights, fine.shape, 1, &registry);
        let geometry = geometries
            .iter()
            .find(|geometry| geometry.voxel == STONE)
            .expect("terrain must be meshed");

        let mut wall_vertices = 0;
        for quad in 0..geometry.positions.len() / 12 {
            let is_border_wall = (0..4).all(|corner| {
                geometry.positions[quad * 12 + corner * 3].abs() < 0.01
            });
            if !is_border_wall {
                continue;
            }
            for corner in 0..4 {
                wall_vertices += 1;
                let packed = geometry.lights[quad * 4 + corner] as u32;
                let sunlight = LightUtils::extract_sunlight(packed & 0xFFFF);
                assert!(
                    sunlight >= 10,
                    "hull border wall vertex must be sky-lit, got sunlight {sunlight}"
                );
            }
        }

        assert!(
            wall_vertices > 0,
            "test terrain must produce hull border walls on the x=0 plane"
        );
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
