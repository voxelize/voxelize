use voxelize_core::{BlockRotation, BlockUtils, LightColor, VoxelAccess};

use super::*;

/// How far past the meshed range a [`Window`] reaches on every side. A face
/// reads one cell out, an inward copy two, a standalone mass its depth plus
/// one, a fluid surface a few down; four holds all of those for ordinary
/// blocks, and anything that reaches further is answered by the access
/// behind the window.
pub const WINDOW_PAD: i32 = 4;

/// The meshed range and a margin round it, read out of an access once into
/// flat arrays: each cell's raw voxel, its packed light, and the bits the
/// mesher keeps asking of its block (`F_*`). Meshing a section asks millions
/// of questions of a few tens of thousands of cells; answering them from here
/// costs an index, where asking the access costs a chunk lookup each time and
/// asking the registry a walk into a block.
///
/// It is a [`VoxelAccess`] itself, so every helper written against one reads
/// through it unchanged: inside the window from the arrays, outside it from
/// the access behind. What it answers is what that access would have: an
/// access that does not promise `decodes_raw_voxels` is still asked for the
/// fields it may compute its own way.
pub(super) struct Window<'a, S: VoxelAccess> {
    space: &'a S,
    decodes: bool,
    origin: [i32; 3],
    size: [u32; 3],
    /// Index steps along x and y; a step along z is 1.
    pub(super) step_x: usize,
    pub(super) step_y: usize,
    pub(super) raw: Vec<u32>,
    pub(super) light: Vec<u16>,
    pub(super) flags: Vec<u16>,
}

impl<'a, S: VoxelAccess> Window<'a, S> {
    pub(super) fn new(space: &'a S, min: &[i32; 3], max: &[i32; 3], tables: &BlockTables) -> Self {
        let origin = [
            min[0] - WINDOW_PAD,
            min[1] - WINDOW_PAD,
            min[2] - WINDOW_PAD,
        ];
        let size = [
            (max[0] - min[0]).max(0) as u32 + 2 * WINDOW_PAD as u32,
            (max[1] - min[1]).max(0) as u32 + 2 * WINDOW_PAD as u32,
            (max[2] - min[2]).max(0) as u32 + 2 * WINDOW_PAD as u32,
        ];
        let [sx, sy, sz] = size.map(|s| s as usize);
        let cells = sx * sy * sz;
        let decodes = space.decodes_raw_voxels();

        let mut raw = vec![0u32; cells];
        let mut light = vec![0u16; cells];
        let mut flags = vec![0u16; cells];
        let mut present = vec![false; sz];
        // What a raw word of zero is: block zero, dry, upright.
        let air_bits = tables.flags_of(0) | F_UPRIGHT;

        for x in 0..sx {
            let vx = origin[0] + x as i32;
            for y in 0..sy {
                let vy = origin[1] + y as i32;
                let base = (x * sy + y) * sz;
                space.read_row(
                    vx,
                    vy,
                    origin[2],
                    &mut raw[base..base + sz],
                    &mut light[base..base + sz],
                    &mut present,
                );
                // Most rows of most sections are air from end to end: one
                // answer for the whole row instead of a table read per cell.
                if decodes && raw[base..base + sz].iter().all(|&word| word == 0) {
                    for z in 0..sz {
                        flags[base + z] = air_bits | if present[z] { F_PRESENT } else { 0 };
                    }
                    continue;
                }
                for z in 0..sz {
                    let word = raw[base + z];
                    let mut bits = tables.flags_of(BlockUtils::extract_id(word));
                    if present[z] {
                        bits |= F_PRESENT;
                    }
                    if decodes {
                        if BlockUtils::extract_waterlogged(word) {
                            bits |= F_WATERLOGGED;
                        }
                        // `BlockRotation::encode` reads every axis value but
                        // one to five as upright.
                        let axis = (word >> 16) & 0xF;
                        if (axis == 0 || axis > 5) && (word >> 20) & 0xF == 0 {
                            bits |= F_UPRIGHT;
                        }
                    } else if space.get_voxel_waterlogged(vx, vy, origin[2] + z as i32) {
                        bits |= F_WATERLOGGED;
                    }
                    flags[base + z] = bits;
                }
            }
        }

        Self {
            space,
            decodes,
            origin,
            size,
            step_x: sy * sz,
            step_y: sz,
            raw,
            light,
            flags,
        }
    }

    /// The cell's place in the arrays, or `None` outside the window.
    #[inline(always)]
    pub(super) fn index(&self, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        let dx = vx.wrapping_sub(self.origin[0]) as u32;
        let dy = vy.wrapping_sub(self.origin[1]) as u32;
        let dz = vz.wrapping_sub(self.origin[2]) as u32;
        if dx < self.size[0] && dy < self.size[1] && dz < self.size[2] {
            Some((dx as usize * self.size[1] as usize + dy as usize) * self.size[2] as usize + dz as usize)
        } else {
            None
        }
    }

    /// The place of a cell known to be inside the window: anything within
    /// [`WINDOW_PAD`] of the meshed range.
    #[inline(always)]
    pub(super) fn index_inside(&self, vx: i32, vy: i32, vz: i32) -> usize {
        debug_assert!(self.index(vx, vy, vz).is_some());
        ((vx - self.origin[0]) as usize * self.size[1] as usize + (vy - self.origin[1]) as usize)
            * self.size[2] as usize
            + (vz - self.origin[2]) as usize
    }

    /// Whether the voxel in cell `i`, at `(vx, vy, vz)`, stands upright:
    /// `get_voxel_rotation` is `PY(0.0)`.
    #[inline]
    pub(super) fn is_upright(&self, i: usize, vx: i32, vy: i32, vz: i32) -> bool {
        if self.decodes {
            self.flags[i] & F_UPRIGHT != 0
        } else {
            matches!(self.space.get_voxel_rotation(vx, vy, vz), BlockRotation::PY(r) if r == 0.0)
        }
    }

    /// The 3x3x3 neighbourhood of a cell at least one cell inside the
    /// window, with which of its cells hold an opaque block.
    #[inline]
    pub(super) fn neighborhood(&self, i: usize) -> (NeighborCache, u32) {
        let mut data = [[0u32; 2]; 27];
        let mut opaque = 0u32;
        let mut slot = 0;
        // `NeighborCache::offset_to_index`: x fastest, then y, then z.
        for dz in [-1isize, 0, 1] {
            for dy in [-1isize, 0, 1] {
                for dx in [-1isize, 0, 1] {
                    let at = (i as isize
                        + dx * self.step_x as isize
                        + dy * self.step_y as isize
                        + dz) as usize;
                    data[slot] = [self.raw[at], self.light[at] as u32];
                    opaque |= (((self.flags[at] & F_OPAQUE) != 0) as u32) << slot;
                    slot += 1;
                }
            }
        }
        (NeighborCache { data }, opaque)
    }
}

impl<S: VoxelAccess> VoxelAccess for Window<'_, S> {
    #[inline]
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        match self.index(vx, vy, vz) {
            Some(i) => BlockUtils::extract_id(self.raw[i]),
            None => self.space.get_voxel(vx, vy, vz),
        }
    }

    #[inline]
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        match self.index(vx, vy, vz) {
            Some(i) => self.raw[i],
            None => self.space.get_raw_voxel(vx, vy, vz),
        }
    }

    #[inline]
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        match self.index(vx, vy, vz) {
            Some(i) if self.decodes => BlockUtils::extract_rotation(self.raw[i]),
            _ => self.space.get_voxel_rotation(vx, vy, vz),
        }
    }

    #[inline]
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        match self.index(vx, vy, vz) {
            Some(i) if self.decodes => BlockUtils::extract_stage(self.raw[i]),
            _ => self.space.get_voxel_stage(vx, vy, vz),
        }
    }

    #[inline]
    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        match self.index(vx, vy, vz) {
            Some(i) => self.flags[i] & F_WATERLOGGED != 0,
            None => self.space.get_voxel_waterlogged(vx, vy, vz),
        }
    }

    #[inline]
    fn get_voxel_fluid_level(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        match self.index(vx, vy, vz) {
            Some(i) if self.decodes => BlockUtils::extract_fluid_level(self.raw[i]),
            _ => self.space.get_voxel_fluid_level(vx, vy, vz),
        }
    }

    // The mesher lights from `get_all_lights`. The single-channel getters
    // are the access's own to answer: one may say something else of a cell
    // it does not hold (open sky over a missing chunk).
    #[inline]
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.space.get_sunlight(vx, vy, vz)
    }

    #[inline]
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32 {
        self.space.get_torch_light(vx, vy, vz, color)
    }

    #[inline]
    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32) {
        match self.index(vx, vy, vz) {
            Some(i) => {
                let light = self.light[i] as u32;
                (
                    (light >> 12) & 0xF,
                    (light >> 8) & 0xF,
                    (light >> 4) & 0xF,
                    light & 0xF,
                )
            }
            None => self.space.get_all_lights(vx, vy, vz),
        }
    }

    #[inline]
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        self.space.get_max_height(vx, vz)
    }

    #[inline]
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        match self.index(vx, vy, vz) {
            Some(i) => self.flags[i] & F_PRESENT != 0,
            None => self.space.contains(vx, vy, vz),
        }
    }

    fn decodes_raw_voxels(&self) -> bool {
        self.decodes
    }
}
