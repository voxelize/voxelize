use std::collections::VecDeque;

use voxelize_core::{LightColor, LightUtils};

use crate::types::{
    LightBlock, LightBounds, LightConfig, LightNode, LightRegistry, LightVoxelAccess,
};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

const ALL_TRANSPARENT: [bool; 6] = [true, true, true, true, true, true];
const ALL_TORCH_COLOR_MASK: u8 = (1 << 0) | (1 << 1) | (1 << 2);
const SOURCE_FACE_BY_DIR: [usize; 6] = [0, 3, 2, 5, 1, 4];
const TARGET_FACE_BY_DIR: [usize; 6] = [3, 0, 5, 2, 4, 1];
const MAX_I64_USIZE: usize = i64::MAX as usize;

#[inline]
fn direction_to_index(dx: i32, dy: i32, dz: i32) -> Option<usize> {
    match (dx, dy, dz) {
        (1, 0, 0) => Some(0),
        (-1, 0, 0) => Some(1),
        (0, 0, 1) => Some(2),
        (0, 0, -1) => Some(3),
        (0, 1, 0) => Some(4),
        (0, -1, 0) => Some(5),
        _ => None,
    }
}

#[inline]
fn resolve_chunk_shift(chunk_size: i32) -> Option<u32> {
    if chunk_size > 0 && (chunk_size as u32).is_power_of_two() {
        Some(chunk_size.trailing_zeros())
    } else {
        None
    }
}

#[inline]
fn map_voxel_to_chunk_with_shift(
    vx: i32,
    vz: i32,
    chunk_size: i32,
    chunk_shift: Option<u32>,
) -> (i32, i32) {
    if let Some(shift) = chunk_shift {
        (vx >> shift, vz >> shift)
    } else {
        let normalized_chunk_size = chunk_size.max(1);
        (
            vx.div_euclid(normalized_chunk_size),
            vz.div_euclid(normalized_chunk_size),
        )
    }
}

#[inline]
fn get_light_level(
    space: &dyn LightVoxelAccess,
    vx: i32,
    vy: i32,
    vz: i32,
    color: &LightColor,
    is_sunlight: bool,
) -> u32 {
    let raw = space.get_raw_light(vx, vy, vz);
    if is_sunlight {
        LightUtils::extract_sunlight(raw)
    } else {
        match color {
            LightColor::Red => LightUtils::extract_red_light(raw),
            LightColor::Green => LightUtils::extract_green_light(raw),
            LightColor::Blue => LightUtils::extract_blue_light(raw),
            LightColor::Sunlight => panic!("Getting torch light for sunlight channel."),
        }
    }
}

#[inline]
fn set_light_level(
    space: &mut dyn LightVoxelAccess,
    vx: i32,
    vy: i32,
    vz: i32,
    level: u32,
    color: &LightColor,
    is_sunlight: bool,
) {
    let raw = space.get_raw_light(vx, vy, vz);
    if is_sunlight {
        let inserted = LightUtils::insert_sunlight(raw, level);
        if inserted != raw {
            space.set_raw_light(vx, vy, vz, inserted);
        }
    } else {
        let inserted = match color {
            LightColor::Red => LightUtils::insert_red_light(raw, level),
            LightColor::Green => LightUtils::insert_green_light(raw, level),
            LightColor::Blue => LightUtils::insert_blue_light(raw, level),
            LightColor::Sunlight => panic!("Setting torch light for sunlight channel."),
        };
        if inserted != raw {
            space.set_raw_light(vx, vy, vz, inserted);
        }
    }
}

#[inline]
fn torch_color_mask(color: &LightColor) -> u8 {
    match color {
        LightColor::Red => 1 << 0,
        LightColor::Green => 1 << 1,
        LightColor::Blue => 1 << 2,
        LightColor::Sunlight => 0,
    }
}

#[inline]
fn block_emits_torch_at(
    block: &LightBlock,
    vx: i32,
    vy: i32,
    vz: i32,
    space: &dyn LightVoxelAccess,
    color: &LightColor,
    color_mask: u8,
) -> bool {
    if block.has_static_torch_mask(color_mask) {
        return true;
    }

    if !block.has_dynamic_torch_mask(color_mask) {
        return false;
    }

    block.get_torch_light_level_at_xyz(vx, vy, vz, space, color) > 0
}

pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let Some(index) = direction_to_index(dx, dy, dz) else {
        return false;
    };
    can_enter_into_direction(target, index)
}

pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let Some(index) = direction_to_index(dx, dy, dz) else {
        return false;
    };
    can_enter_direction(source, target, index)
}

#[inline]
fn can_enter_into_direction(target: &[bool; 6], direction_index: usize) -> bool {
    target[TARGET_FACE_BY_DIR[direction_index]]
}

#[inline]
fn can_enter_direction(source: &[bool; 6], target: &[bool; 6], direction_index: usize) -> bool {
    source[SOURCE_FACE_BY_DIR[direction_index]] && target[TARGET_FACE_BY_DIR[direction_index]]
}

fn flood_light_from_nodes(
    space: &mut dyn LightVoxelAccess,
    mut nodes: Vec<LightNode>,
    color: &LightColor,
    config: &LightConfig,
    bounds: Option<&LightBounds>,
    registry: &LightRegistry,
) {
    let is_sunlight = *color == LightColor::Sunlight;
    let color_mask = if is_sunlight { 0 } else { torch_color_mask(color) };
    let max_height = config.max_height;
    let max_light_level = config.max_light_level;
    let chunk_size = config.chunk_size.max(1);
    let chunk_shift = resolve_chunk_shift(chunk_size);
    let [start_cx, start_cz] = config.min_chunk;
    let [end_cx, end_cz] = config.max_chunk;
    let mut has_bounds_xz = false;
    let mut bounds_start_x = 0i64;
    let mut bounds_start_z = 0i64;
    let mut bounds_end_x = 0i64;
    let mut bounds_end_z = 0i64;
    if let Some(limit) = bounds {
        has_bounds_xz = true;
        bounds_start_x = i64::from(limit.min[0]);
        bounds_start_z = i64::from(limit.min[2]);
        let shape_x = if limit.shape[0] > MAX_I64_USIZE {
            i64::MAX
        } else {
            limit.shape[0] as i64
        };
        let shape_z = if limit.shape[2] > MAX_I64_USIZE {
            i64::MAX
        } else {
            limit.shape[2] as i64
        };
        bounds_end_x = bounds_start_x.saturating_add(shape_x);
        bounds_end_z = bounds_start_z.saturating_add(shape_z);
    }
    let mut head = 0usize;

    while head < nodes.len() {
        let LightNode { voxel, level } = nodes[head];
        head += 1;

        if level == 0 {
            continue;
        }

        let [vx, vy, vz] = voxel;
        let source_raw_voxel = space.get_raw_voxel(vx, vy, vz);
        let source_block = registry.get_block_by_id(source_raw_voxel & 0xFFFF);
        let source_transparency = if !is_sunlight
            && block_emits_torch_at(source_block, vx, vy, vz, space, color, color_mask)
        {
            ALL_TRANSPARENT
        } else {
            source_block.get_transparency_from_raw_voxel(source_raw_voxel)
        };
        let keeps_max_sunlight = is_sunlight && level == max_light_level;
        let decremented_level = level.saturating_sub(1);
        if !keeps_max_sunlight && decremented_level == 0 {
            continue;
        }

        for (direction_index, [ox, oy, oz]) in VOXEL_NEIGHBORS.iter().copied().enumerate() {
            let Some(nvx) = vx.checked_add(ox) else {
                continue;
            };
            let Some(nvy) = vy.checked_add(oy) else {
                continue;
            };
            let Some(nvz) = vz.checked_add(oz) else {
                continue;
            };

            if nvy < 0 || nvy >= max_height {
                continue;
            }

            let (ncx, ncz) = map_voxel_to_chunk_with_shift(nvx, nvz, chunk_size, chunk_shift);
            if ncx < start_cx || ncz < start_cz || ncx > end_cx || ncz > end_cz {
                continue;
            }

            if has_bounds_xz {
                let nvx_i64 = i64::from(nvx);
                let nvz_i64 = i64::from(nvz);
                if nvx_i64 < bounds_start_x
                    || nvx_i64 >= bounds_end_x
                    || nvz_i64 < bounds_start_z
                    || nvz_i64 >= bounds_end_z
                {
                    continue;
                }
            }

            let current_neighbor = get_light_level(space, nvx, nvy, nvz, color, is_sunlight);
            let (n_raw_voxel, n_block, next_level) = if keeps_max_sunlight && oy == -1 {
                let n_raw_voxel = space.get_raw_voxel(nvx, nvy, nvz);
                let n_block = registry.get_block_by_id(n_raw_voxel & 0xFFFF);
                let next_level = if !n_block.light_reduce {
                    level
                } else {
                    decremented_level
                };
                if current_neighbor >= next_level {
                    continue;
                }
                (n_raw_voxel, n_block, next_level)
            } else {
                let next_level = decremented_level;
                if current_neighbor >= next_level {
                    continue;
                }
                let n_raw_voxel = space.get_raw_voxel(nvx, nvy, nvz);
                let n_block = registry.get_block_by_id(n_raw_voxel & 0xFFFF);
                (n_raw_voxel, n_block, next_level)
            };

            let n_transparency = n_block.get_transparency_from_raw_voxel(n_raw_voxel);
            if !can_enter_direction(&source_transparency, &n_transparency, direction_index) {
                continue;
            }

            set_light_level(space, nvx, nvy, nvz, next_level, color, is_sunlight);
            nodes.push(LightNode {
                voxel: [nvx, nvy, nvz],
                level: next_level,
            });
        }
    }
}

pub fn flood_light(
    space: &mut dyn LightVoxelAccess,
    queue: VecDeque<LightNode>,
    color: &LightColor,
    config: &LightConfig,
    bounds: Option<&LightBounds>,
    registry: &LightRegistry,
) {
    if queue.is_empty() {
        return;
    }
    flood_light_from_nodes(space, queue.into(), color, config, bounds, registry);
}

pub fn flood_light_nodes(
    space: &mut dyn LightVoxelAccess,
    nodes: Vec<LightNode>,
    color: &LightColor,
    config: &LightConfig,
    bounds: Option<&LightBounds>,
    registry: &LightRegistry,
) {
    if nodes.is_empty() {
        return;
    }
    flood_light_from_nodes(space, nodes, color, config, bounds, registry);
}

pub fn remove_light(
    space: &mut dyn LightVoxelAccess,
    voxel: [i32; 3],
    color: &LightColor,
    config: &LightConfig,
    registry: &LightRegistry,
) {
    let is_sunlight = *color == LightColor::Sunlight;
    let [vx, vy, vz] = voxel;
    let source_level = get_light_level(space, vx, vy, vz, color, is_sunlight);
    if source_level == 0 {
        return;
    }

    let remove = vec![LightNode {
        voxel,
        level: source_level,
    }];

    set_light_level(space, vx, vy, vz, 0, color, is_sunlight);

    let fill = collect_refill_nodes_after_removals(
        space,
        remove,
        color,
        config,
        registry,
        is_sunlight,
    );
    if fill.is_empty() {
        return;
    }

    flood_light_from_nodes(space, fill, color, config, None, registry);
}

fn collect_refill_nodes_after_removals(
    space: &mut dyn LightVoxelAccess,
    mut remove: Vec<LightNode>,
    color: &LightColor,
    config: &LightConfig,
    registry: &LightRegistry,
    is_sunlight: bool,
) -> Vec<LightNode> {
    let mut fill = Vec::<LightNode>::with_capacity(remove.len());
    let mut head = 0usize;
    let color_mask = if is_sunlight { 0 } else { torch_color_mask(color) };
    let max_height = config.max_height;
    let max_light_level = config.max_light_level;

    while head < remove.len() {
        let LightNode { voxel, level } = remove[head];
        head += 1;

        let [svx, svy, svz] = voxel;

        for (direction_index, [ox, oy, oz]) in VOXEL_NEIGHBORS.iter().copied().enumerate() {
            let Some(nvx) = svx.checked_add(ox) else {
                continue;
            };
            let Some(nvy) = svy.checked_add(oy) else {
                continue;
            };
            let Some(nvz) = svz.checked_add(oz) else {
                continue;
            };

            if nvy < 0 || nvy >= max_height {
                continue;
            }

            let n_level = get_light_level(space, nvx, nvy, nvz, color, is_sunlight);
            if n_level == 0 {
                continue;
            }
            if is_sunlight && oy == -1 && n_level == level && level != max_light_level {
                continue;
            }

            let n_raw_voxel = space.get_raw_voxel(nvx, nvy, nvz);
            let n_block = registry.get_block_by_id(n_raw_voxel & 0xFFFF);
            let n_transparency = n_block.get_transparency_from_raw_voxel(n_raw_voxel);
            if !can_enter_into_direction(&n_transparency, direction_index)
                && (is_sunlight
                    || !block_emits_torch_at(n_block, nvx, nvy, nvz, space, color, color_mask))
            {
                continue;
            }

            if n_level < level
                || (is_sunlight
                    && oy == -1
                    && level == max_light_level
                    && n_level == max_light_level)
            {
                remove.push(LightNode {
                    voxel: [nvx, nvy, nvz],
                    level: n_level,
                });
                set_light_level(space, nvx, nvy, nvz, 0, color, is_sunlight);
            } else if if is_sunlight && oy == -1 {
                n_level > level
            } else {
                n_level >= level
            } {
                fill.push(LightNode {
                    voxel: [nvx, nvy, nvz],
                    level: n_level,
                });
            }
        }
    }

    fill
}

pub fn remove_lights<I>(
    space: &mut dyn LightVoxelAccess,
    voxels: I,
    color: &LightColor,
    config: &LightConfig,
    registry: &LightRegistry,
) where
    I: IntoIterator<Item = [i32; 3]>,
{
    let is_sunlight = *color == LightColor::Sunlight;
    let voxels = voxels.into_iter();
    let (voxel_count_lower, voxel_count_upper) = voxels.size_hint();
    if voxel_count_upper == Some(0) {
        return;
    }
    let voxel_capacity = voxel_count_upper.unwrap_or(voxel_count_lower);
    let mut remove = Vec::<LightNode>::with_capacity(voxel_capacity);

    for voxel in voxels {
        let [vx, vy, vz] = voxel;
        let level = get_light_level(space, vx, vy, vz, color, is_sunlight);
        if level == 0 {
            continue;
        }

        remove.push(LightNode {
            voxel,
            level,
        });
        set_light_level(space, vx, vy, vz, 0, color, is_sunlight);
    }

    if remove.is_empty() {
        return;
    }

    let fill =
        collect_refill_nodes_after_removals(space, remove, color, config, registry, is_sunlight);
    if fill.is_empty() {
        return;
    }
    flood_light_from_nodes(space, fill, color, config, None, registry);
}

pub fn propagate(
    space: &mut dyn LightVoxelAccess,
    min: [i32; 3],
    shape: [usize; 3],
    registry: &LightRegistry,
    config: &LightConfig,
) -> [VecDeque<LightNode>; 4] {
    let [start_x, _, start_z] = min;
    let [shape_x, _, shape_z] = shape;
    let max_height = config.max_height;
    let max_light_level = config.max_light_level;
    if shape_x == 0 || shape_z == 0 || max_height <= 0 {
        return [
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
        ];
    }
    let shape_x_i64 = if shape_x > MAX_I64_USIZE {
        i64::MAX
    } else {
        shape_x as i64
    };
    let shape_z_i64 = if shape_z > MAX_I64_USIZE {
        i64::MAX
    } else {
        shape_z as i64
    };
    if i64::from(start_x).saturating_add(shape_x_i64) > i64::from(i32::MAX) + 1
        || i64::from(start_z).saturating_add(shape_z_i64) > i64::from(i32::MAX) + 1
    {
        return [
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
        ];
    }
    let Some(mask_len) = shape_x.checked_mul(shape_z) else {
        return [
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
            VecDeque::new(),
        ];
    };

    let mut red_light_queue = Vec::<LightNode>::new();
    let mut green_light_queue = Vec::<LightNode>::new();
    let mut blue_light_queue = Vec::<LightNode>::new();
    let mut sunlight_queue = Vec::<LightNode>::new();

    let mut mask = vec![max_light_level; mask_len];

    for y in (0..max_height).rev() {
        for x in 0..shape_x {
            let vx = start_x + x as i32;
            let mut mask_index = x;
            for z in 0..shape_z {
                let vz = start_z + z as i32;
                let current_mask_index = mask_index;
                mask_index += shape_x;

                let raw_voxel = space.get_raw_voxel(vx, y, vz);
                let block = registry.get_block_by_id(raw_voxel & 0xFFFF);
                if block.is_light {
                    let (red_level, green_level, blue_level) =
                        if block.has_dynamic_torch_mask(ALL_TORCH_COLOR_MASK) {
                            block.get_torch_light_levels_at_xyz(vx, y, vz, space)
                        } else {
                            (
                                block.red_light_level,
                                block.green_light_level,
                                block.blue_light_level,
                            )
                        };

                    if red_level > 0 {
                        space.set_red_light(vx, y, vz, red_level);
                        red_light_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: red_level,
                        });
                    }

                    if green_level > 0 {
                        space.set_green_light(vx, y, vz, green_level);
                        green_light_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: green_level,
                        });
                    }

                    if blue_level > 0 {
                        space.set_blue_light(vx, y, vz, blue_level);
                        blue_light_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: blue_level,
                        });
                    }
                }

                let [px, py, pz, nx, ny, nz] =
                    block.get_transparency_from_raw_voxel(raw_voxel);

                if block.is_opaque {
                    mask[current_mask_index] = 0;
                    continue;
                }

                if !py || !ny {
                    mask[current_mask_index] = 0;
                    continue;
                }

                let current_mask = mask[current_mask_index];
                if block.light_reduce {
                    if current_mask != 0 {
                        let sunlight = current_mask - 1;
                        space.set_sunlight(vx, y, vz, sunlight);
                        if sunlight > 0 {
                            sunlight_queue.push(LightNode {
                                voxel: [vx, y, vz],
                                level: sunlight,
                            });
                        }
                        mask[current_mask_index] = 0;
                    }
                    continue;
                }

                space.set_sunlight(vx, y, vz, current_mask);

                if current_mask == max_light_level {
                    let should_add_max =
                        (x + 1 < shape_x && mask[current_mask_index + 1] == 0 && px)
                            || (x > 0 && mask[current_mask_index - 1] == 0 && nx)
                            || (z + 1 < shape_z
                                && mask[current_mask_index + shape_x] == 0
                                && pz)
                            || (z > 0 && mask[current_mask_index - shape_x] == 0 && nz);

                    if should_add_max {
                        sunlight_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: max_light_level,
                        });
                    }
                }
            }
        }
    }

    [
        sunlight_queue.into(),
        red_light_queue.into(),
        green_light_queue.into(),
        blue_light_queue.into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use voxelize_core::{BlockRotation, LightUtils};

    #[derive(Clone)]
    struct TestSpace {
        min: [i32; 3],
        shape: [usize; 3],
        voxels: Vec<u32>,
        lights: Vec<u32>,
    }

    impl TestSpace {
        fn new(min: [i32; 3], shape: [usize; 3]) -> Self {
            let size = shape[0] * shape[1] * shape[2];
            Self {
                min,
                shape,
                voxels: vec![0; size],
                lights: vec![0; size],
            }
        }

        fn index(&self, vx: i32, vy: i32, vz: i32) -> Option<usize> {
            let lx = vx - self.min[0];
            let ly = vy - self.min[1];
            let lz = vz - self.min[2];

            if lx < 0
                || ly < 0
                || lz < 0
                || lx >= self.shape[0] as i32
                || ly >= self.shape[1] as i32
                || lz >= self.shape[2] as i32
            {
                return None;
            }

            Some(
                lx as usize * self.shape[1] * self.shape[2]
                    + ly as usize * self.shape[2]
                    + lz as usize,
            )
        }

        fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
            if let Some(index) = self.index(vx, vy, vz) {
                self.voxels[index] = id;
                return true;
            }

            false
        }
    }

    impl LightVoxelAccess for TestSpace {
        fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            self.index(vx, vy, vz).map_or(0, |index| self.voxels[index])
        }

        fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
            BlockRotation::default()
        }

        fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
            self.index(vx, vy, vz).map_or(0, |index| self.lights[index])
        }

        fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
            if let Some(index) = self.index(vx, vy, vz) {
                self.lights[index] = level;
                return true;
            }

            false
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            self.shape[1] as u32
        }

        fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
            self.index(vx, vy, vz).is_some()
        }
    }

    struct ZeroSpace;

    impl LightVoxelAccess for ZeroSpace {
        fn get_raw_voxel(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
            BlockRotation::default()
        }

        fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn get_raw_light(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
            0
        }

        fn set_raw_light(&mut self, _vx: i32, _vy: i32, _vz: i32, _level: u32) -> bool {
            false
        }

        fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
            0
        }

        fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
            true
        }
    }

    fn test_registry() -> LightRegistry {
        let mut air = LightBlock::default_air();
        air.id = 0;

        let mut stone = LightBlock::default_air();
        stone.id = 1;
        stone.is_transparent = [false, false, false, false, false, false];
        stone.light_reduce = true;
        stone.recompute_flags();

        let mut torch = LightBlock::default_air();
        torch.id = 2;
        torch.red_light_level = 15;
        torch.recompute_flags();

        LightRegistry::new(vec![(0, air), (1, stone), (2, torch)])
    }

    fn test_config() -> LightConfig {
        LightConfig {
            chunk_size: 16,
            max_height: 64,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
        }
    }

    #[test]
    fn can_enter_helpers_work() {
        let source = [true, true, true, true, true, true];
        let target = [true, true, true, true, true, true];
        let opaque = [false, false, false, false, false, false];

        assert!(can_enter(&source, &target, 1, 0, 0));
        assert!(can_enter(&source, &target, -1, 0, 0));
        assert!(can_enter(&source, &target, 0, 1, 0));
        assert!(can_enter(&source, &target, 0, -1, 0));
        assert!(!can_enter(&source, &opaque, 1, 0, 0));

        assert!(can_enter_into(&target, 1, 0, 0));
        assert!(can_enter_into(&target, -1, 0, 0));
        assert!(!can_enter_into(&opaque, 0, 1, 0));
        assert!(!can_enter(&source, &target, 1, 1, 0));
        assert!(!can_enter_into(&target, 0, 0, 0));
    }

    #[test]
    fn map_voxel_to_chunk_matches_div_euclid_for_negative_coords() {
        let samples = [
            (-33, -17),
            (-16, -1),
            (-15, -15),
            (-1, -33),
            (0, 0),
            (1, 15),
            (16, 16),
            (33, 47),
        ];

        for (vx, vz) in samples {
            assert_eq!(
                map_voxel_to_chunk_with_shift(vx, vz, 16, resolve_chunk_shift(16)),
                (vx.div_euclid(16), vz.div_euclid(16))
            );
            assert_eq!(
                map_voxel_to_chunk_with_shift(vx, vz, 18, resolve_chunk_shift(18)),
                (vx.div_euclid(18), vz.div_euclid(18))
            );
        }
    }

    #[test]
    fn map_voxel_to_chunk_handles_zero_chunk_size() {
        let samples = [(-33, -17), (-1, -1), (0, 0), (15, 31)];

        for (vx, vz) in samples {
            assert_eq!(map_voxel_to_chunk_with_shift(vx, vz, 0, None), (vx, vz));
        }
    }

    #[test]
    fn flood_and_remove_torch_light_roundtrip() {
        let registry = test_registry();
        let config = test_config();
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        assert!(space.set_voxel(8, 32, 8, 2));
        space.set_raw_light(8, 32, 8, LightUtils::insert_red_light(0, 15));

        flood_light(
            &mut space,
            VecDeque::from(vec![LightNode {
                voxel: [8, 32, 8],
                level: 15,
            }]),
            &LightColor::Red,
            &config,
            None,
            &registry,
        );

        let neighbor = space.get_red_light(9, 32, 8);
        assert!(neighbor > 0);

        remove_light(&mut space, [8, 32, 8], &LightColor::Red, &config, &registry);
        assert_eq!(space.get_red_light(8, 32, 8), 0);
    }

    #[test]
    fn remove_lights_batch_clears_multiple_sources() {
        let registry = test_registry();
        let config = test_config();
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        let source_a = [6, 32, 8];
        let source_b = [10, 32, 8];
        assert!(space.set_voxel(source_a[0], source_a[1], source_a[2], 2));
        assert!(space.set_voxel(source_b[0], source_b[1], source_b[2], 2));

        space.set_red_light(source_a[0], source_a[1], source_a[2], 15);
        space.set_red_light(source_b[0], source_b[1], source_b[2], 15);

        flood_light(
            &mut space,
            VecDeque::from(vec![
                LightNode {
                    voxel: source_a,
                    level: 15,
                },
                LightNode {
                    voxel: source_b,
                    level: 15,
                },
            ]),
            &LightColor::Red,
            &config,
            None,
            &registry,
        );

        assert!(space.get_red_light(8, 32, 8) > 0);

        remove_lights(
            &mut space,
            [source_a, source_b],
            &LightColor::Red,
            &config,
            &registry,
        );

        assert_eq!(space.get_red_light(source_a[0], source_a[1], source_a[2]), 0);
        assert_eq!(space.get_red_light(source_b[0], source_b[1], source_b[2]), 0);
        assert_eq!(space.get_red_light(8, 32, 8), 0);
    }

    #[test]
    fn sunlight_downward_max_level_and_light_reduce_behavior() {
        let mut air = LightBlock::default_air();
        air.id = 0;

        let mut reducer = LightBlock::default_air();
        reducer.id = 3;
        reducer.light_reduce = true;
        reducer.recompute_flags();

        let registry = LightRegistry::new(vec![(0, air), (3, reducer)]);
        let config = test_config();
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        assert!(space.set_voxel(8, 48, 8, 3));

        space.set_sunlight(8, 50, 8, 15);
        flood_light(
            &mut space,
            VecDeque::from(vec![LightNode {
                voxel: [8, 50, 8],
                level: 15,
            }]),
            &LightColor::Sunlight,
            &config,
            None,
            &registry,
        );

        assert_eq!(space.get_sunlight(8, 49, 8), 15);
        assert_eq!(space.get_sunlight(8, 48, 8), 14);
        assert_eq!(space.get_sunlight(8, 47, 8), 13);
        assert_eq!(space.get_sunlight(9, 50, 8), 14);
    }

    #[test]
    fn propagate_skips_zero_level_sunlight_nodes_for_light_reducers() {
        let mut air = LightBlock::default_air();
        air.id = 0;

        let mut reducer = LightBlock::default_air();
        reducer.id = 3;
        reducer.light_reduce = true;
        reducer.recompute_flags();

        let registry = LightRegistry::new(vec![(0, air), (3, reducer)]);
        let config = LightConfig {
            chunk_size: 16,
            max_height: 2,
            max_light_level: 1,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
        };
        let mut space = TestSpace::new([0, 0, 0], [1, 2, 1]);
        assert!(space.set_voxel(0, 0, 0, 3));

        let [sunlight_queue, _, _, _] =
            propagate(&mut space, [0, 0, 0], [1, 2, 1], &registry, &config);

        assert!(sunlight_queue.is_empty());
        assert_eq!(space.get_sunlight(0, 1, 0), 1);
        assert_eq!(space.get_sunlight(0, 0, 0), 0);
    }

    #[test]
    fn propagate_returns_empty_queues_when_mask_len_overflows() {
        let registry = test_registry();
        let config = LightConfig {
            chunk_size: 16,
            max_height: 1,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
        };
        let mut space = ZeroSpace;

        let queues = propagate(&mut space, [0, 0, 0], [usize::MAX, 1, 2], &registry, &config);

        assert!(queues[0].is_empty());
        assert!(queues[1].is_empty());
        assert!(queues[2].is_empty());
        assert!(queues[3].is_empty());
    }

    #[test]
    fn propagate_returns_empty_queues_when_xz_ranges_overflow_i32() {
        let registry = test_registry();
        let config = LightConfig {
            chunk_size: 16,
            max_height: 1,
            max_light_level: 15,
            min_chunk: [0, 0],
            max_chunk: [0, 0],
        };
        let mut space = ZeroSpace;

        let queues = propagate(&mut space, [i32::MAX, 0, 0], [2, 1, 1], &registry, &config);
        assert!(queues[0].is_empty());
        assert!(queues[1].is_empty());
        assert!(queues[2].is_empty());
        assert!(queues[3].is_empty());

        let queues = propagate(&mut space, [0, 0, i32::MAX], [1, 1, 2], &registry, &config);
        assert!(queues[0].is_empty());
        assert!(queues[1].is_empty());
        assert!(queues[2].is_empty());
        assert!(queues[3].is_empty());
    }

    #[test]
    fn flood_light_handles_large_bounds_shapes_without_wrapping() {
        let registry = test_registry();
        let config = test_config();
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        assert!(space.set_voxel(8, 32, 8, 2));
        space.set_red_light(8, 32, 8, 15);

        let bounds = LightBounds {
            min: [0, 0, 0],
            shape: [usize::MAX, 1, usize::MAX],
        };

        flood_light(
            &mut space,
            VecDeque::from(vec![LightNode {
                voxel: [8, 32, 8],
                level: 15,
            }]),
            &LightColor::Red,
            &config,
            Some(&bounds),
            &registry,
        );

        assert!(space.get_red_light(9, 32, 8) > 0);
    }

    #[test]
    fn flood_light_handles_zero_chunk_size_without_panicking() {
        let registry = test_registry();
        let mut config = test_config();
        config.chunk_size = 0;
        config.min_chunk = [-16, -16];
        config.max_chunk = [16, 16];
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        assert!(space.set_voxel(8, 32, 8, 2));
        space.set_red_light(8, 32, 8, 15);

        flood_light(
            &mut space,
            VecDeque::from(vec![LightNode {
                voxel: [8, 32, 8],
                level: 15,
            }]),
            &LightColor::Red,
            &config,
            None,
            &registry,
        );

        assert!(space.get_red_light(9, 32, 8) > 0);
    }

    #[test]
    fn flood_light_skips_overflowing_neighbor_coordinates() {
        let registry = test_registry();
        let source_chunk_x = i32::MAX.div_euclid(16);
        let config = LightConfig {
            chunk_size: 16,
            max_height: 2,
            max_light_level: 15,
            min_chunk: [source_chunk_x, 0],
            max_chunk: [source_chunk_x, 0],
        };
        let mut space = TestSpace::new([i32::MAX, 0, 0], [1, 2, 1]);

        assert!(space.set_voxel(i32::MAX, 1, 0, 2));
        space.set_red_light(i32::MAX, 1, 0, 15);

        flood_light(
            &mut space,
            VecDeque::from(vec![LightNode {
                voxel: [i32::MAX, 1, 0],
                level: 15,
            }]),
            &LightColor::Red,
            &config,
            None,
            &registry,
        );

        assert_eq!(space.get_red_light(i32::MAX, 1, 0), 15);
    }

    #[test]
    fn remove_light_skips_overflowing_neighbor_coordinates() {
        let registry = test_registry();
        let source_chunk_x = i32::MAX.div_euclid(16);
        let config = LightConfig {
            chunk_size: 16,
            max_height: 2,
            max_light_level: 15,
            min_chunk: [source_chunk_x, 0],
            max_chunk: [source_chunk_x, 0],
        };
        let mut space = TestSpace::new([i32::MAX, 0, 0], [1, 2, 1]);

        assert!(space.set_voxel(i32::MAX, 1, 0, 2));
        space.set_red_light(i32::MAX, 1, 0, 15);

        remove_light(
            &mut space,
            [i32::MAX, 1, 0],
            &LightColor::Red,
            &config,
            &registry,
        );

        assert_eq!(space.get_red_light(i32::MAX, 1, 0), 0);
    }

    #[test]
    fn light_bounds_contains_xz_handles_large_shapes_safely() {
        let bounds = LightBounds {
            min: [10, 0, 20],
            shape: [usize::MAX, 1, usize::MAX],
        };

        assert!(bounds.contains_xz(10, 20));
        assert!(bounds.contains_xz(10_000, 20_000));
        assert!(!bounds.contains_xz(9, 20));
        assert!(!bounds.contains_xz(10, 19));
    }

    #[test]
    fn light_bounds_contains_xz_returns_false_for_empty_shapes() {
        let empty_x_bounds = LightBounds {
            min: [10, 0, 20],
            shape: [0, 1, 10],
        };
        let empty_z_bounds = LightBounds {
            min: [10, 0, 20],
            shape: [10, 1, 0],
        };

        assert!(!empty_x_bounds.contains_xz(10, 20));
        assert!(!empty_z_bounds.contains_xz(10, 20));
    }

    #[test]
    fn light_bounds_contains_xz_handles_i32_edge_ranges() {
        let bounds = LightBounds {
            min: [i32::MAX - 2, 0, i32::MAX - 2],
            shape: [3, 1, 3],
        };

        assert!(bounds.contains_xz(i32::MAX - 2, i32::MAX - 2));
        assert!(bounds.contains_xz(i32::MAX - 1, i32::MAX - 1));
        assert!(bounds.contains_xz(i32::MAX, i32::MAX));
    }
}
