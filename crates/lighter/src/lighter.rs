use std::collections::VecDeque;

use voxelize_core::{BlockRotation, LightColor, LightUtils};

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
const SOURCE_FACE_BY_DIR: [usize; 6] = [0, 3, 2, 5, 1, 4];
const TARGET_FACE_BY_DIR: [usize; 6] = [3, 0, 5, 2, 4, 1];

#[inline]
fn direction_to_index(dx: i32, dy: i32, dz: i32) -> usize {
    match (dx, dy, dz) {
        (1, 0, 0) => 0,
        (-1, 0, 0) => 1,
        (0, 0, 1) => 2,
        (0, 0, -1) => 3,
        (0, 1, 0) => 4,
        (0, -1, 0) => 5,
        _ => panic!("Light neighboring direction should be on exactly one axis."),
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
) -> [i32; 2] {
    if let Some(shift) = chunk_shift {
        [vx >> shift, vz >> shift]
    } else {
        [vx.div_euclid(chunk_size), vz.div_euclid(chunk_size)]
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
        space.set_raw_light(vx, vy, vz, LightUtils::insert_sunlight(raw, level));
    } else {
        let inserted = match color {
            LightColor::Red => LightUtils::insert_red_light(raw, level),
            LightColor::Green => LightUtils::insert_green_light(raw, level),
            LightColor::Blue => LightUtils::insert_blue_light(raw, level),
            LightColor::Sunlight => panic!("Setting torch light for sunlight channel."),
        };
        space.set_raw_light(vx, vy, vz, inserted);
    }
}

#[inline]
fn voxel_rotation_from_raw(raw_voxel: u32) -> BlockRotation {
    BlockRotation::encode((raw_voxel >> 16) & 0xF, (raw_voxel >> 20) & 0xF)
}

#[inline]
fn block_and_rotation_at<'a>(
    registry: &'a LightRegistry,
    space: &dyn LightVoxelAccess,
    vx: i32,
    vy: i32,
    vz: i32,
) -> (&'a LightBlock, BlockRotation) {
    let raw_voxel = space.get_raw_voxel(vx, vy, vz);
    (
        registry.get_block_by_id(raw_voxel & 0xFFFF),
        voxel_rotation_from_raw(raw_voxel),
    )
}

#[inline]
fn block_emits_torch_at(
    block: &LightBlock,
    vx: i32,
    vy: i32,
    vz: i32,
    space: &dyn LightVoxelAccess,
    color: &LightColor,
) -> bool {
    if block.get_torch_light_level(color) > 0 {
        return true;
    }

    let has_dynamic_color = block
        .dynamic_patterns
        .as_ref()
        .is_some_and(|patterns| {
            for pattern in patterns {
                for part in &pattern.parts {
                    let has_color = match color {
                        LightColor::Red => part.red_light_level.unwrap_or(0) > 0,
                        LightColor::Green => part.green_light_level.unwrap_or(0) > 0,
                        LightColor::Blue => part.blue_light_level.unwrap_or(0) > 0,
                        LightColor::Sunlight => false,
                    };
                    if has_color {
                        return true;
                    }
                }
            }
            false
        });
    if !has_dynamic_color {
        return false;
    }

    block.get_torch_light_level_at(&[vx, vy, vz], space, color) > 0
}

pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let index = direction_to_index(dx, dy, dz);
    can_enter_into_direction(target, index)
}

pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let index = direction_to_index(dx, dy, dz);
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
    let chunk_size = config.chunk_size;
    let chunk_shift = resolve_chunk_shift(chunk_size);
    let [start_cx, start_cz] = config.min_chunk;
    let [end_cx, end_cz] = config.max_chunk;
    let bounds_xz = bounds.map(|limit| {
        let start_x = i64::from(limit.min[0]);
        let start_z = i64::from(limit.min[2]);
        let end_x = start_x.saturating_add(i64::try_from(limit.shape[0]).unwrap_or(i64::MAX));
        let end_z = start_z.saturating_add(i64::try_from(limit.shape[2]).unwrap_or(i64::MAX));
        (start_x, start_z, end_x, end_z)
    });
    let mut head = 0usize;

    while head < nodes.len() {
        let LightNode { voxel, level } = nodes[head];
        head += 1;

        if level == 0 {
            continue;
        }

        let [vx, vy, vz] = voxel;
        let (source_block, source_rotation) = block_and_rotation_at(registry, space, vx, vy, vz);
        let source_transparency = if !is_sunlight
            && block_emits_torch_at(source_block, vx, vy, vz, space, color)
        {
            ALL_TRANSPARENT
        } else {
            source_block.get_rotated_transparency(&source_rotation)
        };

        for (direction_index, [ox, oy, oz]) in VOXEL_NEIGHBORS.iter().copied().enumerate() {
            let nvx = vx + ox;
            let nvy = vy + oy;
            let nvz = vz + oz;

            if nvy < 0 || nvy >= config.max_height {
                continue;
            }

            let [ncx, ncz] = map_voxel_to_chunk_with_shift(nvx, nvz, chunk_size, chunk_shift);
            if ncx < start_cx || ncz < start_cz || ncx > end_cx || ncz > end_cz {
                continue;
            }

            if let Some((start_x, start_z, end_x, end_z)) = bounds_xz {
                let nvx_i64 = i64::from(nvx);
                let nvz_i64 = i64::from(nvz);
                if nvx_i64 < start_x || nvx_i64 >= end_x || nvz_i64 < start_z || nvz_i64 >= end_z
                {
                    continue;
                }
            }

            let (n_block, n_rotation) = block_and_rotation_at(registry, space, nvx, nvy, nvz);
            let n_transparency = n_block.get_rotated_transparency(&n_rotation);

            let reduce = if is_sunlight
                && !n_block.light_reduce
                && oy == -1
                && level == config.max_light_level
            {
                0
            } else {
                1
            };
            let next_level = level.saturating_sub(reduce);

            if next_level == 0
                || !can_enter_direction(&source_transparency, &n_transparency, direction_index)
            {
                continue;
            }

            let current_neighbor = get_light_level(space, nvx, nvy, nvz, color, is_sunlight);
            if current_neighbor >= next_level {
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
    flood_light_from_nodes(space, queue.into_iter().collect(), color, config, bounds, registry);
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

    while head < remove.len() {
        let LightNode { voxel, level } = remove[head];
        head += 1;

        let [svx, svy, svz] = voxel;

        for (direction_index, [ox, oy, oz]) in VOXEL_NEIGHBORS.iter().copied().enumerate() {
            let nvx = svx + ox;
            let nvy = svy + oy;
            let nvz = svz + oz;

            if nvy < 0 || nvy >= config.max_height {
                continue;
            }

            let (n_block, n_rotation) = block_and_rotation_at(registry, space, nvx, nvy, nvz);
            let n_transparency = n_block.get_rotated_transparency(&n_rotation);

            if (is_sunlight
                || !block_emits_torch_at(n_block, nvx, nvy, nvz, space, color))
                && !can_enter_into_direction(&n_transparency, direction_index)
            {
                continue;
            }

            let n_level = get_light_level(space, nvx, nvy, nvz, color, is_sunlight);
            if n_level == 0 {
                continue;
            }

            if n_level < level
                || (is_sunlight
                    && oy == -1
                    && level == config.max_light_level
                    && n_level == config.max_light_level)
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
    let (voxel_count, _) = voxels.size_hint();
    let mut remove = Vec::<LightNode>::with_capacity(voxel_count);

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

    let mut red_light_queue = Vec::<LightNode>::new();
    let mut green_light_queue = Vec::<LightNode>::new();
    let mut blue_light_queue = Vec::<LightNode>::new();
    let mut sunlight_queue = Vec::<LightNode>::new();

    let mut mask = vec![config.max_light_level; shape_x * shape_z];

    for y in (0..config.max_height).rev() {
        for x in 0..shape_x {
            let vx = start_x + x as i32;
            for z in 0..shape_z {
                let vz = start_z + z as i32;
                let voxel_pos = [vx, y, vz];

                let raw_voxel = space.get_raw_voxel(vx, y, vz);
                let block = registry.get_block_by_id(raw_voxel & 0xFFFF);
                let red_level = block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Red);
                let green_level =
                    block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Green);
                let blue_level = block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Blue);

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

                let mask_index = x + z * shape_x;
                let [px, py, pz, nx, ny, nz] = voxel_rotation_from_raw(raw_voxel)
                    .rotate_transparency(block.is_transparent);

                if block.is_opaque {
                    mask[mask_index] = 0;
                    continue;
                }

                if !py || !ny {
                    mask[mask_index] = 0;
                    continue;
                }

                if block.light_reduce {
                    if mask[mask_index] != 0 {
                        let sunlight = mask[mask_index] - 1;
                        space.set_sunlight(vx, y, vz, sunlight);
                        sunlight_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: sunlight,
                        });
                        mask[mask_index] = 0;
                    }
                    continue;
                }

                space.set_sunlight(vx, y, vz, mask[mask_index]);

                if mask[mask_index] == config.max_light_level {
                    let should_add_max = (x + 1 < shape_x && mask[mask_index + 1] == 0 && px)
                        || (x > 0 && mask[mask_index - 1] == 0 && nx)
                        || (z + 1 < shape_z && mask[mask_index + shape_x] == 0 && pz)
                        || (z > 0 && mask[mask_index - shape_x] == 0 && nz);

                    if should_add_max {
                        space.set_sunlight(vx, y, vz, config.max_light_level);
                        sunlight_queue.push(LightNode {
                            voxel: [vx, y, vz],
                            level: config.max_light_level,
                        });
                    }
                }
            }
        }
    }

    [
        VecDeque::from(sunlight_queue),
        VecDeque::from(red_light_queue),
        VecDeque::from(green_light_queue),
        VecDeque::from(blue_light_queue),
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

    fn test_registry() -> LightRegistry {
        let mut air = LightBlock::default_air();
        air.id = 0;

        let mut stone = LightBlock {
            id: 1,
            is_transparent: [false, false, false, false, false, false],
            is_opaque: true,
            is_light: false,
            light_reduce: true,
            red_light_level: 0,
            green_light_level: 0,
            blue_light_level: 0,
            dynamic_patterns: None,
        };
        stone.recompute_flags();

        let mut torch = LightBlock {
            id: 2,
            is_transparent: [true, true, true, true, true, true],
            is_opaque: false,
            is_light: true,
            light_reduce: false,
            red_light_level: 15,
            green_light_level: 0,
            blue_light_level: 0,
            dynamic_patterns: None,
        };
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
                [vx.div_euclid(16), vz.div_euclid(16)]
            );
            assert_eq!(
                map_voxel_to_chunk_with_shift(vx, vz, 18, resolve_chunk_shift(18)),
                [vx.div_euclid(18), vz.div_euclid(18)]
            );
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

        let mut reducer = LightBlock {
            id: 3,
            is_transparent: [true, true, true, true, true, true],
            is_opaque: false,
            is_light: false,
            light_reduce: true,
            red_light_level: 0,
            green_light_level: 0,
            blue_light_level: 0,
            dynamic_patterns: None,
        };
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
}
