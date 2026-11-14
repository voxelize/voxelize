use std::borrow::Cow;

use hashbrown::HashMap;

use voxelize_core::{BlockFace, BlockRotation, LightUtils, VoxelAccess, UV};

use super::*;

/// One cell of a sweep's face mask: everything two faces must share to merge
/// into one quad, in plain words that compare as words. `block` is the
/// block's place in the registry plus one, zero for no face; `class` stands
/// for the face's name, `independent` and texture range (`BlockTables`).
#[derive(Clone, Copy, Default)]
struct MaskCell {
    /// The four corners' light, sixteen bits each.
    light: u64,
    block: u32,
    tint_bits: i32,
    class: u8,
    /// The four corners' occlusion, two bits each.
    ao: u8,
    is_water_exposed: bool,
    /// Which of the block's faces (its own, then its stage faces) this is.
    /// Not compared: equal classes draw alike, and a quad is drawn with the
    /// face of the cell it starts at.
    face_slot: u8,
}

impl MaskCell {
    #[inline(always)]
    fn merges_with(&self, other: &MaskCell) -> bool {
        self.block == other.block
            && self.light == other.light
            && self.tint_bits == other.tint_bits
            && self.class == other.class
            && self.ao == other.ao
            && self.is_water_exposed == other.is_water_exposed
    }

    #[inline(always)]
    fn ao(&self) -> [i32; 4] {
        [0, 2, 4, 6].map(|shift| ((self.ao >> shift) & 0x3) as i32)
    }

    #[inline(always)]
    fn light(&self) -> [i32; 4] {
        [0, 16, 32, 48].map(|shift| ((self.light >> shift) & 0xFFFF) as i32)
    }
}

/// The faces of one slice that may merge, as a `width` x `height` grid, with
/// the box of cells written since it was last emptied so an empty or nearly
/// empty slice costs nothing to read back.
struct FaceMask {
    cells: Vec<MaskCell>,
    width: usize,
    height: usize,
    lo: [usize; 2],
    hi: [usize; 2],
}

struct MaskQuad {
    u: usize,
    v: usize,
    w: usize,
    h: usize,
    cell: MaskCell,
}

impl FaceMask {
    fn new() -> Self {
        Self {
            cells: Vec::new(),
            width: 0,
            height: 0,
            lo: [usize::MAX; 2],
            hi: [0; 2],
        }
    }

    fn resize(&mut self, width: usize, height: usize) {
        self.cells.clear();
        self.cells.resize(width * height, MaskCell::default());
        self.width = width;
        self.height = height;
        self.lo = [usize::MAX; 2];
        self.hi = [0; 2];
    }

    #[inline(always)]
    fn set(&mut self, u: usize, v: usize, cell: MaskCell) {
        self.cells[v * self.width + u] = cell;
        self.lo = [self.lo[0].min(u), self.lo[1].min(v)];
        self.hi = [self.hi[0].max(u + 1), self.hi[1].max(v + 1)];
    }

    /// Takes every face out as the largest quads that grow first along u,
    /// then along v, rows first: the order a client's buffers are laid in.
    fn drain_quads(&mut self, quads: &mut Vec<MaskQuad>) {
        if self.lo[0] == usize::MAX {
            return;
        }
        let [u_lo, v_lo] = self.lo;
        let [u_hi, v_hi] = self.hi;
        for v in v_lo..v_hi {
            let row = v * self.width;
            let mut u = u_lo;
            while u < u_hi {
                let cell = self.cells[row + u];
                if cell.block == 0 {
                    u += 1;
                    continue;
                }

                let mut w = 1;
                while u + w < u_hi && self.cells[row + u + w].merges_with(&cell) {
                    w += 1;
                }

                let mut h = 1;
                'grow: while v + h < v_hi {
                    let above = (v + h) * self.width + u;
                    for du in 0..w {
                        if !self.cells[above + du].merges_with(&cell) {
                            break 'grow;
                        }
                    }
                    h += 1;
                }

                for dv in 0..h {
                    let start = (v + dv) * self.width + u;
                    for taken in &mut self.cells[start..start + w] {
                        taken.block = 0;
                    }
                }

                quads.push(MaskQuad { u, v, w, h, cell });
                u += w;
            }
        }
        self.lo = [usize::MAX; 2];
        self.hi = [0; 2];
    }
}

/// The geometries a mesh is built into, in the order they were first written
/// to, found again by the same key a client finds their material by.
#[derive(Default)]
pub(super) struct Buckets {
    geometries: Vec<GeometryProtocol>,
    by_key: HashMap<String, usize>,
}

impl Buckets {
    /// The place of the geometry keyed `key`, made by `init` the first time.
    pub(super) fn slot(&mut self, key: &str, init: impl FnOnce() -> GeometryProtocol) -> usize {
        if let Some(&slot) = self.by_key.get(key) {
            return slot;
        }
        let slot = self.geometries.len();
        self.geometries.push(init());
        self.by_key.insert(key.to_string(), slot);
        slot
    }

    #[inline(always)]
    pub(super) fn at(&mut self, slot: usize) -> &mut GeometryProtocol {
        &mut self.geometries[slot]
    }

    fn finish(self) -> Vec<GeometryProtocol> {
        self.geometries
            .into_iter()
            .filter(|geometry| !geometry.indices.is_empty())
            .collect()
    }
}

/// A face drawn on its own instead of through the mask.
struct LooseFace<'a> {
    voxel: [i32; 3],
    voxel_id: u32,
    block_index: usize,
    rotation: BlockRotation,
    block: &'a Block,
    face: Cow<'a, BlockFace>,
    is_see_through: bool,
    is_fluid: bool,
    world_space: bool,
}

fn emit_greedy_quad(
    quad: &MaskQuad,
    origin: [i32; 2],
    axis: usize,
    slice: i32,
    dir: [i32; 3],
    min: &[i32; 3],
    block: &Block,
    face: &BlockFace,
    geometry: &mut GeometryProtocol,
) {
    let [min_x, min_y, min_z] = *min;
    let is_opaque = block.is_opaque;
    let is_fluid = block.is_fluid;

    let UV {
        start_u,
        end_u,
        start_v,
        end_v,
    } = face.range.clone();

    let scale = if is_opaque { 0.0 } else { 0.0001 };

    let u_min = (origin[0] + quad.u as i32) as f32;
    let u_max = (origin[0] + (quad.u + quad.w) as i32) as f32;
    let v_min = (origin[1] + quad.v as i32) as f32;
    let v_max = (origin[1] + (quad.v + quad.h) as i32) as f32;

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
    let aos = quad.cell.ao();
    let lights = quad.cell.light();
    let emissive_bits = ao_or_emissive_bits(0, face.emissive);
    let fluid_bit = if is_fluid { FLUID_BIT } else { 0 };
    let water_exposed_bit = if quad.cell.is_water_exposed {
        WATER_EXPOSED_BIT
    } else {
        0
    };

    let mut positions = [0.0f32; 12];
    let mut uvs = [0.0f32; 8];
    let mut packed = [0i32; 4];
    for i in 0..4 {
        let pos = corners[i];
        positions[i * 3] = pos[0] - min_x as f32 - dir[0] as f32 * scale;
        positions[i * 3 + 1] = pos[1] - min_y as f32 - dir[1] as f32 * scale;
        positions[i * 3 + 2] = pos[2] - min_z as f32 - dir[2] as f32 * scale;

        uvs[i * 2] = uv_corners[i][0] * (end_u - start_u) + start_u;
        uvs[i * 2 + 1] = uv_corners[i][1] * (end_v - start_v) + start_v;

        let ao_bits = if emissive_bits != 0 {
            emissive_bits
        } else {
            aos[i] << AO_SHIFT
        };
        packed[i] = lights[i]
            | ao_bits
            | fluid_bit
            | GREEDY_BIT
            | water_exposed_bit
            | quad.cell.tint_bits;
    }
    geometry.positions.extend_from_slice(&positions);
    geometry.uvs.extend_from_slice(&uvs);
    geometry.lights.extend_from_slice(&packed);

    if quad_flips(&aos, &lights) {
        geometry
            .indices
            .extend_from_slice(&[ndx, ndx + 1, ndx + 3, ndx + 3, ndx + 2, ndx]);
    } else {
        geometry
            .indices
            .extend_from_slice(&[ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3]);
    }
}

/// Whether a quad's four corners (in emission order) split along their
/// `1-2` diagonal rather than `0-3`, so occlusion and light gradients
/// interpolate across the darker pair instead of smearing over it.
pub(super) fn quad_flips(face_aos: &[i32; 4], face_lights: &[i32; 4]) -> bool {
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

    face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
        || (ozao_r || ozao_g || ozao_b)
        || (anz_r || anz_g || anz_b)
}

/// The stage that picks `block`'s faces at `voxel` (see [`Block::faces_at`]);
/// read only for a block that has stage faces.
fn voxel_stage_for_faces<S: VoxelAccess>(block: &Block, [x, y, z]: [i32; 3], space: &S) -> u32 {
    if block.stage_faces.is_some() {
        space.get_voxel_stage(x, y, z)
    } else {
        0
    }
}

/// `block`'s face toward `dir` on a voxel at `stage`, and which of the
/// block's faces it is, its own counted before its stage faces.
#[inline]
fn face_toward(block: &Block, stage: u32, dir: [i32; 3]) -> Option<(&BlockFace, usize)> {
    let (faces, first) = match &block.stage_faces {
        Some(alternate) if stage & alternate.mask != 0 => (&alternate.faces, block.faces.len()),
        _ => (&block.faces, 0),
    };
    faces
        .iter()
        .position(|face| face.dir == dir)
        .map(|at| (&faces[at], first + at))
}

/// Which way each corner of a cube's face lies from the voxel's centre, per
/// sweep direction, in the order the corners are emitted: the signs
/// `face_ao_and_light` reads off a full cube's corner positions.
const CORNER_SIGNS: [[[isize; 3]; 4]; 6] = [
    [[1, 1, 1], [1, -1, 1], [1, 1, -1], [1, -1, -1]],
    [[-1, 1, -1], [-1, -1, -1], [-1, 1, 1], [-1, -1, 1]],
    [[-1, 1, 1], [1, 1, 1], [-1, 1, -1], [1, 1, -1]],
    [[1, -1, 1], [-1, -1, 1], [1, -1, -1], [-1, -1, -1]],
    [[-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]],
    [[1, -1, -1], [-1, -1, -1], [1, 1, -1], [-1, 1, -1]],
];

/// [`face_ao_and_light`] for an opaque full cube, read straight off the
/// window: the same rule with what an opaque cube makes of it worked out
/// ahead. The cube hides its own cell and every cell level with it from the
/// face (`corner_light`'s first two exclusions), so a corner is lit by the
/// four cells that meet at it one step out along the face's normal, and
/// shaded by the three of those that are not straight ahead. That is nine
/// lights and eighteen opaque bits a face instead of the whole
/// neighbourhood, and no walk through the eight samples per corner.
#[inline]
fn opaque_cube_ao_and_light<S: VoxelAccess>(
    center: usize,
    sweep: usize,
    window: &Window<S>,
) -> ([i32; 4], [i32; 4]) {
    let axis = sweep / 2;
    let steps = [window.step_x as isize, window.step_y as isize, 1isize];
    let (p_axis, q_axis) = match axis {
        0 => (1, 2),
        1 => (0, 2),
        _ => (0, 1),
    };
    let is_opaque = |delta: isize| window.flags[(center as isize + delta) as usize] & F_OPAQUE != 0;
    let light_at = |delta: isize| window.light[(center as isize + delta) as usize] as u32;

    let mut aos = [0i32; 4];
    let mut lights = [0i32; 4];
    for (corner, signs) in CORNER_SIGNS[sweep].iter().enumerate() {
        let a = signs[axis] * steps[axis];
        let p = signs[p_axis] * steps[p_axis];
        let q = signs[q_axis] * steps[q_axis];

        let ahead_p = is_opaque(a + p);
        let ahead_q = is_opaque(a + q);
        aos[corner] = if ahead_p && ahead_q {
            0
        } else {
            3 - (ahead_p as i32 + ahead_q as i32 + is_opaque(a + p + q) as i32)
        };

        let mut sums = [0u32; 4];
        let mut count = 0u32;
        let mut add = |word: u32| {
            sums[0] += (word >> 12) & 0xF;
            sums[1] += (word >> 8) & 0xF;
            sums[2] += (word >> 4) & 0xF;
            sums[3] += word & 0xF;
            count += 1;
        };
        for delta in [a, a + p, a + q] {
            let word = light_at(delta);
            if word != 0 {
                add(word);
            }
        }
        let far = light_at(a + p + q);
        if far != 0 {
            // The far diagonal lights the corner unless opaque blocks close
            // every way round to it.
            let level = is_opaque(p + q);
            let is_shut = (level && ahead_q && ahead_p)
                || (ahead_p && ahead_q && is_opaque(p) && is_opaque(q))
                || (ahead_p && level && is_opaque(a) && is_opaque(q))
                || (ahead_q && level && is_opaque(a) && is_opaque(p));
            if !is_shut {
                add(far);
            }
        }

        lights[corner] = if count > 0 {
            let count = count as f32;
            let [sun, red, green, blue] = sums.map(|sum| ((sum as f32 / count) as u32) & 0xF);
            ((sun << 12) | (red << 8) | (green << 4) | blue) as i32
        } else {
            // Nothing lit meets the corner, the cell ahead included.
            light_at(a) as i32
        };
    }

    (aos, lights)
}

/// The mask entry for `block`'s face toward `dir` from the window cell
/// `center`: lit and occluded from the cells round it, exposed to water on
/// either side, tinted by the stage of `stage_voxel`.
#[allow(clippy::too_many_arguments)]
#[inline]
fn face_cell<S: VoxelAccess>(
    center: usize,
    toward: isize,
    stage_voxel: [i32; 3],
    sweep: usize,
    block: &Block,
    block_bits: u16,
    block_index: usize,
    face: &BlockFace,
    face_slot: usize,
    window: &Window<S>,
    tables: &BlockTables,
) -> MaskCell {
    let dir = DIRECTIONS[sweep];
    let (aos, lights) = if block_bits & F_FLAT_LIT != 0 {
        ([3; 4], [window.light[center] as i32; 4])
    } else if block_bits & F_OPAQUE != 0 && window.flags[center] & F_OPAQUE != 0 {
        opaque_cube_ao_and_light(center, sweep, window)
    } else {
        let (neighbors, opaque) = window.neighborhood(center);
        face_ao_and_light(dir, block, &neighbors, opaque)
    };
    let ahead = window.flags[(center as isize + toward) as usize];
    let is_water_exposed =
        window.flags[center] & F_WATERLOGGED != 0 || ahead & (F_WATERLOGGED | F_FLUID) != 0;

    let is_fluid = block.is_fluid;
    // Only a tinted face reads its voxel's stage.
    let stage = if face.pigment_mask != 0 || face.stage_tint_mask != 0 {
        window.get_voxel_stage(stage_voxel[0], stage_voxel[1], stage_voxel[2])
    } else {
        0
    };
    let tint_bits = match face_pigment(stage, face.pigment_mask) {
        Some(pigment) if !is_fluid => pigment_bits(pigment),
        _ if face.stage_tint_mask != 0 && !is_fluid && block.stack_group == 0 => {
            stage_tint_bits(stage & face.stage_tint_mask)
        }
        _ if face.regional_tint && !is_fluid && block.stack_group == 0 => stage_tint_bits(0),
        _ => 0,
    };

    MaskCell {
        light: (lights[0] as u16 as u64)
            | (lights[1] as u16 as u64) << 16
            | (lights[2] as u16 as u64) << 32
            | (lights[3] as u16 as u64) << 48,
        block: block_index as u32 + 1,
        tint_bits,
        class: tables.face_class(block_index, face_slot),
        ao: (aos[0] | aos[1] << 2 | aos[2] << 4 | aos[3] << 6) as u8,
        is_water_exposed,
        face_slot: face_slot as u8,
    }
}

/// What a sweep does with a cell, decided once for all six: nothing, a face
/// in the mask, or (on the first sweep) all its faces drawn on their own.
const CELL_SKIP: u8 = 0;
const CELL_GREEDY: u8 = 1;
const CELL_LOOSE: u8 = 2;
const CELL_KIND: u8 = 3;
/// The voxel is waterlogged, and draws the fluid it holds beside its block.
const CELL_HOLDS_FLUID: u8 = 4;

const DIRECTIONS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
];

pub fn mesh_space_greedy<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let built;
    let tables = match registry.tables() {
        Some(tables) => tables,
        None => {
            built = BlockTables::build(registry);
            &built
        }
    };
    let window = Window::new(space, min, max, tables);
    mesh_window(min, max, &window, registry, tables)
}

/// A section's mesh and its connectivity (`compute_section_connectivity`)
/// off one read of the voxels: what a caller that wants both should ask for.
pub fn mesh_section<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> (Vec<GeometryProtocol>, u32) {
    let built;
    let tables = match registry.tables() {
        Some(tables) => tables,
        None => {
            built = BlockTables::build(registry);
            &built
        }
    };
    let window = Window::new(space, min, max, tables);
    (
        mesh_window(min, max, &window, registry, tables),
        window_connectivity(min, max, &window),
    )
}

pub(super) fn mesh_window<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    window: &Window<S>,
    registry: &Registry,
    tables: &BlockTables,
) -> Vec<GeometryProtocol> {
    let waterlogging_fluid = registry
        .waterlogging_fluid()
        .filter(|(_, fluid_block)| has_standard_six_faces(&fluid_block.faces))
        .and_then(|(id, fluid_block)| Some((id, fluid_block, tables.index_of(id)?)));

    let (scan_min, scan_max) = match find_sparse_non_empty_bounds(min, max, window) {
        ScanBounds::Empty => return Vec::new(),
        ScanBounds::Sparse { min, max } => (min, max),
        ScanBounds::Dense => (*min, *max),
    };

    // What each cell in the scanned box is to the sweeps. Not a property of
    // the direction, so it is settled once: six sweeps then pass over air,
    // buried stone and loose blocks on one byte each.
    let mut kinds = vec![CELL_SKIP; window.flags.len()];
    let steps = [window.step_x as isize, window.step_y as isize, 1isize];
    for vx in scan_min[0]..scan_max[0] {
        for vy in scan_min[1]..scan_max[1] {
            let row = window.index_inside(vx, vy, scan_min[2]);
            for (i, vz) in (row..).zip(scan_min[2]..scan_max[2]) {
                let bits = window.flags[i];
                if bits & F_KNOWN == 0 || bits & F_EMPTY != 0 {
                    continue;
                }
                let mut kind = CELL_SKIP;
                if waterlogging_fluid.is_some() && bits & F_WATERLOGGED != 0 {
                    kind |= CELL_HOLDS_FLUID;
                }
                // An opaque voxel shut in by six that cover it draws nothing.
                let is_buried = bits & F_OPAQUE != 0
                    && VOXEL_NEIGHBORS.iter().all(|&[nx, ny, nz]| {
                        let at = (i as isize + nx as isize * steps[0] + ny as isize * steps[1] + nz as isize)
                            as usize;
                        let beside = window.flags[at];
                        beside & F_OPAQUE != 0
                            && beside & F_FLUID == 0
                            && (beside & F_SHELL == 0
                                || !registry
                                    .get_block_by_id(window.get_voxel(vx + nx, vy + ny, vz + nz))
                                    .is_some_and(|b| {
                                        is_hollow_shell(b, [vx + nx, vy + ny, vz + nz], window, registry)
                                    }))
                    });
                if !is_buried {
                    kind |= if bits & F_GREEDY != 0 && window.is_upright(i, vx, vy, vz) {
                        CELL_GREEDY
                    } else {
                        CELL_LOOSE
                    };
                }
                kinds[i] = kind;
            }
        }
    }

    let mut buckets = Buckets::default();
    // Where each block's own geometry is, by its place in the registry (plus
    // one; zero for not yet): the bucket nearly every quad goes to.
    let mut plain_slots = vec![0u32; registry.blocks_by_id.len()];
    // The other buckets a face can be found by without spelling its key: a
    // block's tufts, an independent face by its class, a face by where the
    // registry keeps it.
    let mut keyed_slots: HashMap<(u32, usize), usize> = HashMap::new();
    const KEY_TUFTS: usize = usize::MAX;

    let mut mask = FaceMask::new();
    // Inward copies of cutout-mass surface faces (see `is_cutout_mass`),
    // gathered while their voxels are visited; each lies on the next plane
    // back along the sweep.
    let mut inward_mask = FaceMask::new();
    let mut quads: Vec<MaskQuad> = Vec::new();
    let mut inward_quads: Vec<MaskQuad> = Vec::new();
    // The block is borrowed from the registry, not cloned: a `Block` owns
    // several strings and vectors, and cloning one per face put tens of heap
    // allocations behind every water voxel.
    let mut loose_faces: Vec<LooseFace> = Vec::new();
    // Branch faces wait here for the faces beside them on their plane, so
    // runs of them are drawn as single quads once every voxel has drawn.
    let mut coplanar = CoplanarQuads::default();
    let mut scratch = GeometryProtocol::default();

    for (sweep, dir) in DIRECTIONS.into_iter().enumerate() {
        let (axis, u_axis, v_axis) = if dir[0] != 0 {
            (0, 2, 1)
        } else if dir[1] != 0 {
            (1, 0, 2)
        } else {
            (2, 0, 1)
        };
        let is_first_sweep = sweep == 0;
        let toward = dir[axis] as isize * steps[axis];
        let (u_min, u_max) = (scan_min[u_axis], scan_max[u_axis]);
        let (v_min, v_max) = (scan_min[v_axis], scan_max[v_axis]);
        let (u_len, v_len) = ((u_max - u_min) as usize, (v_max - v_min) as usize);
        mask.resize(u_len, v_len);
        inward_mask.resize(u_len, v_len);

        for slice in scan_min[axis]..scan_max[axis] {
            loose_faces.clear();

            for u in u_min..u_max {
                let mut voxel = [0i32; 3];
                voxel[axis] = slice;
                voxel[u_axis] = u;
                voxel[v_axis] = v_min;
                let column = window.index_inside(voxel[0], voxel[1], voxel[2]);

                for v in v_min..v_max {
                    let i = (column as isize + (v - v_min) as isize * steps[v_axis]) as usize;
                    let kind = kinds[i];
                    if kind == CELL_SKIP || (!is_first_sweep && kind & CELL_KIND != CELL_GREEDY) {
                        continue;
                    }
                    voxel[v_axis] = v;
                    let [vx, vy, vz] = voxel;
                    let bits = window.flags[i];

                    // A waterlogged voxel draws its block *and* the fluid it
                    // holds. Without the fluid pass the surrounding water,
                    // which culls its faces against this voxel, would leave a
                    // block-shaped hole in the tank.
                    if is_first_sweep && kind & CELL_HOLDS_FLUID != 0 {
                        if let Some((fluid_id, fluid_block, fluid_index)) = waterlogging_fluid {
                            for face in create_fluid_faces(
                                vx,
                                vy,
                                vz,
                                fluid_id,
                                window,
                                &fluid_block.faces,
                                registry,
                            ) {
                                loose_faces.push(LooseFace {
                                    voxel,
                                    voxel_id: fluid_id,
                                    block_index: fluid_index,
                                    rotation: BlockRotation::PY(0.0),
                                    block: fluid_block,
                                    face: Cow::Owned(face),
                                    is_see_through: fluid_block.is_see_through,
                                    is_fluid: true,
                                    world_space: false,
                                });
                            }
                        }
                    }

                    let voxel_id = extract_id(window.raw[i]);
                    let Some(block_index) = tables.index_of(voxel_id) else {
                        continue;
                    };
                    let block = &registry.blocks_by_id[block_index].1;
                    let is_fluid = block.is_fluid;
                    let is_see_through = block.is_see_through;

                    if kind & CELL_KIND == CELL_GREEDY {
                        // Tufts are not faces of the cube: each voxel lays
                        // its own once, on the first of the six sweeps, into a
                        // geometry of their own (`TUFTS_FACE_NAME`) that the
                        // client draws double-sided and can hide.
                        if is_first_sweep && block.tufts.is_some() {
                            let slot = *keyed_slots
                                .entry((block_index as u32, KEY_TUFTS))
                                .or_insert_with(|| {
                                    buckets.slot(
                                        &format!("{}::{}", block.get_name_lower(), TUFTS_FACE_NAME),
                                        || GeometryProtocol {
                                            voxel: voxel_id,
                                            face_name: Some(TUFTS_FACE_NAME.to_string()),
                                            ..Default::default()
                                        },
                                    )
                                });
                            emit_tufts(voxel, block, window, registry, min, buckets.at(slot));
                        }

                        let stage = voxel_stage_for_faces(block, voxel, window);
                        let Some((face, face_slot)) = face_toward(block, stage, dir) else {
                            continue;
                        };
                        let (mu, mv) = ((u - u_min) as usize, (v - v_min) as usize);

                        // A cutout mass's face toward the empty voxel behind
                        // it, seen from inside: on that face's plane, turned
                        // back toward this voxel and lit by it.
                        if bits & F_CUTOUT_MASS != 0 {
                            let behind = (i as isize - toward) as usize;
                            let behind_bits = window.flags[behind];
                            if behind_bits & F_KNOWN != 0 && behind_bits & F_EMPTY != 0 {
                                inward_mask.set(
                                    mu,
                                    mv,
                                    face_cell(
                                        behind,
                                        toward,
                                        voxel,
                                        sweep,
                                        block,
                                        bits,
                                        block_index,
                                        face,
                                        face_slot,
                                        window,
                                        tables,
                                    ),
                                );
                            }
                        }

                        // An opaque cube against a neighbour that is not a
                        // branch shell is the whole of `should_render_face`
                        // in four bits; anything else asks it.
                        let ahead_at = (i as isize + toward) as usize;
                        let ahead = window.flags[ahead_at];
                        let shape = bits & (F_OPAQUE | F_SEE_THROUGH | F_FLUID);
                        let should_render = if ahead & F_SHELL != 0 {
                            should_render_face(
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                dir,
                                block,
                                window,
                                registry,
                                is_see_through,
                                is_fluid,
                            )
                        } else if ahead & F_PRESENT == 0
                            || ahead & F_KNOWN == 0
                            || ahead & (F_EMPTY | F_FLUID) != 0
                        {
                            // Open space, a block nobody can vouch for, or a
                            // fluid's lowered surface: every cube shows here.
                            true
                        } else if shape == F_OPAQUE {
                            ahead & F_OPAQUE == 0
                        } else if shape == F_SEE_THROUGH {
                            // A see-through cube shows against anything that
                            // is not opaque and not itself; against itself
                            // only near the surface of a standalone mass.
                            ahead & F_OPAQUE == 0
                                && (extract_id(window.raw[ahead_at]) != voxel_id
                                    || (block.transparent_standalone
                                        && is_standalone_face_within_depth(
                                            vx,
                                            vy,
                                            vz,
                                            dir,
                                            voxel_id,
                                            block.standalone_face_depth,
                                            window,
                                        )))
                        } else {
                            should_render_face(
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                dir,
                                block,
                                window,
                                registry,
                                is_see_through,
                                is_fluid,
                            )
                        };

                        if !should_render {
                            continue;
                        }

                        // Pressed to a face its neighbour draws back across
                        // the boundary: wholly covered it goes, partly
                        // covered it is drawn on its own, less the cover.
                        let pressed = if is_see_through && bits & (F_FLUID | F_CUTOUT_MASS) == 0 {
                            uncovered_by_neighbor_faces(
                                voxel,
                                voxel_id,
                                block,
                                dir,
                                [0.0, 0.0, 1.0, 1.0],
                                window,
                                registry,
                            )
                        } else {
                            None
                        };
                        if let Some(open) = pressed {
                            if !open.is_empty() {
                                loose_faces.push(LooseFace {
                                    voxel,
                                    voxel_id,
                                    block_index,
                                    rotation: window.get_voxel_rotation(vx, vy, vz),
                                    block,
                                    face: Cow::Borrowed(face),
                                    is_see_through,
                                    is_fluid,
                                    world_space: false,
                                });
                            }
                            continue;
                        }

                        mask.set(
                            mu,
                            mv,
                            face_cell(
                                i,
                                toward,
                                voxel,
                                sweep,
                                block,
                                bits,
                                block_index,
                                face,
                                face_slot,
                                window,
                                tables,
                            ),
                        );
                        continue;
                    }

                    // A voxel that does not greedy-mesh emits all its faces
                    // here, on the first of the six sweeps; the other five
                    // pass over it.
                    if kind & CELL_KIND != CELL_LOOSE {
                        continue;
                    }
                    let rotation = window.get_voxel_rotation(vx, vy, vz);

                    // Fluids never rotate and always carry the six axis
                    // faces, so their culling can run before a face is
                    // built, with the same rule `process_face` applies. A
                    // submerged voxel — most of a sea — then emits nothing
                    // and costs nothing; building its corner heights and six
                    // faces only to drop every one of them in `process_face`
                    // was most of what an ocean chunk cost to mesh.
                    let is_standard_fluid = is_fluid && has_standard_six_faces(&block.faces);
                    let fluid_face_renders: Option<[bool; 6]> = if is_standard_fluid {
                        let renders = DIRECTIONS.map(|toward| {
                            should_render_face(
                                vx,
                                vy,
                                vz,
                                voxel_id,
                                toward,
                                block,
                                window,
                                registry,
                                is_see_through,
                                is_fluid,
                            )
                        });
                        if !renders.iter().any(|r| *r) {
                            continue;
                        }
                        Some(renders)
                    } else {
                        None
                    };

                    let is_plain = !is_standard_fluid
                        && block.branch.is_none()
                        && !block.branch_shell
                        && block.dynamic_patterns.is_none()
                        && block.connected.is_none();
                    if is_plain {
                        // The block's own faces as they stand in the
                        // registry: nothing to build, so nothing to copy.
                        let stage = voxel_stage_for_faces(block, voxel, window);
                        for face in block.faces_at(stage) {
                            loose_faces.push(LooseFace {
                                voxel,
                                voxel_id,
                                block_index,
                                rotation: rotation.clone(),
                                block,
                                face: Cow::Borrowed(face),
                                is_see_through,
                                is_fluid,
                                world_space: false,
                            });
                        }
                        continue;
                    }

                    let faces: Vec<(BlockFace, bool)> = if is_standard_fluid {
                        create_fluid_faces(vx, vy, vz, block.id, window, &block.faces, registry)
                            .into_iter()
                            .filter(|face| {
                                fluid_face_renders.is_none_or(|renders| {
                                    DIRECTIONS
                                        .iter()
                                        .position(|toward| face.dir == *toward)
                                        .is_none_or(|i| renders[i])
                                })
                            })
                            .map(|f| (f, false))
                            .collect()
                    } else if block.branch.is_some() || block.branch_shell {
                        branch_faces(voxel, window, registry)
                    } else if block.dynamic_patterns.is_some() {
                        get_dynamic_faces(block, voxel, window, &rotation)
                    } else {
                        block
                            .faces_at(voxel_stage_for_faces(block, voxel, window))
                            .iter()
                            .cloned()
                            .map(|f| (f, false))
                            .collect()
                    };
                    let faces = match &block.connected {
                        Some(frame) => connect_faces(frame, voxel, faces, window, registry),
                        None => faces,
                    };

                    for (face, world_space) in faces.into_iter() {
                        loose_faces.push(LooseFace {
                            voxel,
                            voxel_id,
                            block_index,
                            rotation: rotation.clone(),
                            block,
                            face: Cow::Owned(face),
                            is_see_through,
                            is_fluid,
                            world_space,
                        });
                    }
                }
            }

            mask.drain_quads(&mut quads);
            inward_mask.drain_quads(&mut inward_quads);
            let inward_slice = slice - dir[axis];

            for (quad, quad_slice) in quads
                .drain(..)
                .map(|quad| (quad, slice))
                .chain(inward_quads.drain(..).map(|quad| (quad, inward_slice)))
            {
                let block_index = quad.cell.block as usize - 1;
                let (block_id, block) = &registry.blocks_by_id[block_index];
                let face_slot = quad.cell.face_slot as usize;
                let face = match &block.stage_faces {
                    Some(alternate) if face_slot >= block.faces.len() => {
                        &alternate.faces[face_slot - block.faces.len()]
                    }
                    _ => &block.faces[face_slot],
                };

                let slot = if face.independent {
                    *keyed_slots
                        .entry((block_index as u32, quad.cell.class as usize))
                        .or_insert_with(|| {
                            buckets.slot(
                                &format!("{}::{}", block.get_name_lower(), face.name.to_lowercase()),
                                || GeometryProtocol {
                                    voxel: *block_id,
                                    face_name: Some(face.name.clone()),
                                    ..Default::default()
                                },
                            )
                        })
                } else {
                    if plain_slots[block_index] == 0 {
                        plain_slots[block_index] = 1 + buckets.slot(block.get_name_lower(), || {
                            GeometryProtocol {
                                voxel: *block_id,
                                ..Default::default()
                            }
                        }) as u32;
                    }
                    plain_slots[block_index] as usize - 1
                };

                emit_greedy_quad(
                    &quad,
                    [u_min, v_min],
                    axis,
                    quad_slice,
                    dir,
                    min,
                    block,
                    face,
                    buckets.at(slot),
                );
            }

            // Faces of one voxel arrive together and read one neighbourhood.
            let mut around: Option<([i32; 3], NeighborCache, u32)> = None;
            for LooseFace {
                voxel,
                voxel_id,
                block_index,
                rotation,
                block,
                face,
                is_see_through,
                is_fluid,
                world_space,
            } in loose_faces.drain(..)
            {
                let [vx, vy, vz] = voxel;
                let uv_range = &face.range;
                if around.as_ref().is_none_or(|(at, _, _)| *at != voxel) {
                    let (neighbors, opaque) =
                        window.neighborhood(window.index_inside(vx, vy, vz));
                    around = Some((voxel, neighbors, opaque));
                }
                let Some((_, neighbors, opaque)) = around.as_ref() else {
                    continue;
                };
                // An own-texture face (isolated per voxel, independent per
                // block) keeps its face-keyed geometry so the client can find
                // its material by face name. An animated block's faces are
                // split per voxel on top of that: every voxel of it is a
                // geometry the client can transform on its own, which is
                // what lets a door leaf swing without the rest of the chunk.
                let is_per_voxel = face.isolated || block.is_animated;
                let is_per_face = face.isolated || face.independent;
                let slot = match (is_per_voxel, is_per_face) {
                    (false, false) => {
                        if plain_slots[block_index] == 0 {
                            plain_slots[block_index] = 1 + buckets.slot(block.get_name_lower(), || {
                                GeometryProtocol {
                                    voxel: voxel_id,
                                    ..Default::default()
                                }
                            }) as u32;
                        }
                        plain_slots[block_index] as usize - 1
                    }
                    _ => {
                        let make = |buckets: &mut Buckets| {
                            let key = match (is_per_voxel, is_per_face) {
                                (true, true) => format!(
                                    "{}::{}::{}-{}-{}",
                                    block.get_name_lower(),
                                    face.get_name_lower(),
                                    vx,
                                    vy,
                                    vz
                                ),
                                (true, false) => {
                                    format!("{}::{}-{}-{}", block.get_name_lower(), vx, vy, vz)
                                }
                                _ => format!("{}::{}", block.get_name_lower(), face.get_name_lower()),
                            };
                            buckets.slot(&key, || GeometryProtocol {
                                voxel: voxel_id,
                                face_name: is_per_face.then(|| face.name.clone()),
                                at: is_per_voxel.then_some(voxel),
                                ..Default::default()
                            })
                        };
                        match &face {
                            // One of the registry's own faces on a block that
                            // shares its geometry: found again by where the
                            // registry keeps it.
                            Cow::Borrowed(kept) if !is_per_voxel => {
                                let at = *kept as *const BlockFace as usize;
                                match keyed_slots.get(&(block_index as u32, at)) {
                                    Some(&slot) => slot,
                                    None => {
                                        let slot = make(&mut buckets);
                                        keyed_slots.insert((block_index as u32, at), slot);
                                        slot
                                    }
                                }
                            }
                            _ => make(&mut buckets),
                        }
                    }
                };

                if world_space
                    && (block.branch.is_some() || block.branch_shell)
                    && !is_per_voxel
                    && !is_per_face
                    && uv_follows_world(&face)
                {
                    scratch.positions.clear();
                    scratch.indices.clear();
                    scratch.uvs.clear();
                    scratch.lights.clear();
                    process_face_in(
                        vx,
                        vy,
                        vz,
                        voxel_id,
                        &rotation,
                        &face,
                        block,
                        uv_range,
                        registry,
                        window,
                        neighbors,
                        *opaque,
                        is_see_through,
                        is_fluid,
                        &mut scratch.positions,
                        &mut scratch.indices,
                        &mut scratch.uvs,
                        &mut scratch.lights,
                        min,
                        world_space,
                    );
                    if scratch.positions.is_empty()
                        || coplanar.hold(
                            voxel_id,
                            face.dir,
                            uv_range,
                            &scratch.positions,
                            &scratch.uvs,
                            &scratch.lights,
                            &scratch.indices,
                        )
                    {
                        continue;
                    }
                    let geometry = buckets.at(slot);
                    let base = (geometry.positions.len() / 3) as i32;
                    geometry.positions.extend_from_slice(&scratch.positions);
                    geometry.uvs.extend_from_slice(&scratch.uvs);
                    geometry.lights.extend_from_slice(&scratch.lights);
                    geometry
                        .indices
                        .extend(scratch.indices.iter().map(|&index| base + index));
                    continue;
                }

                let geometry = buckets.at(slot);
                process_face_in(
                    vx,
                    vy,
                    vz,
                    voxel_id,
                    &rotation,
                    &face,
                    block,
                    uv_range,
                    registry,
                    window,
                    neighbors,
                    *opaque,
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

    coplanar.emit(registry, &mut buckets);

    buckets.finish()
}
