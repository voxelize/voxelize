use std::collections::VecDeque;

use voxelize_core::LightColor;

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
    if dx.abs() + dy.abs() + dz.abs() != 1 {
        panic!("Light neighboring direction should be on exactly one axis.");
    }

    if dx == 1 {
        0
    } else if dx == -1 {
        1
    } else if dz == 1 {
        2
    } else if dz == -1 {
        3
    } else if dy == 1 {
        4
    } else {
        5
    }
}

#[inline]
fn map_voxel_to_chunk(vx: i32, vz: i32, chunk_size: i32) -> [i32; 2] {
    [vx.div_euclid(chunk_size), vz.div_euclid(chunk_size)]
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
    if is_sunlight {
        space.get_sunlight(vx, vy, vz)
    } else {
        space.get_torch_light(vx, vy, vz, color)
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
    if is_sunlight {
        space.set_sunlight(vx, vy, vz, level);
    } else {
        space.set_torch_light(vx, vy, vz, level, color);
    }
}

#[inline]
fn block_at<'a>(
    registry: &'a LightRegistry,
    space: &dyn LightVoxelAccess,
    vx: i32,
    vy: i32,
    vz: i32,
) -> &'a LightBlock {
    registry.get_block_by_id(space.get_voxel(vx, vy, vz))
}

pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let index = direction_to_index(dx, dy, dz);
    target[TARGET_FACE_BY_DIR[index]]
}

pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
    let index = direction_to_index(dx, dy, dz);
    source[SOURCE_FACE_BY_DIR[index]] && target[TARGET_FACE_BY_DIR[index]]
}

pub fn flood_light(
    space: &mut dyn LightVoxelAccess,
    queue: VecDeque<LightNode>,
    color: &LightColor,
    config: &LightConfig,
    bounds: Option<&LightBounds>,
    registry: &LightRegistry,
) {
    let is_sunlight = *color == LightColor::Sunlight;
    let [start_cx, start_cz] = config.min_chunk;
    let [end_cx, end_cz] = config.max_chunk;

    let mut nodes: Vec<LightNode> = queue.into_iter().collect();
    let mut head = 0usize;

    while head < nodes.len() {
        let LightNode { voxel, level } = nodes[head];
        head += 1;

        if level == 0 {
            continue;
        }

        let [vx, vy, vz] = voxel;
        let source_block = block_at(registry, space, vx, vy, vz);
        let source_transparency = if !is_sunlight
            && source_block.get_torch_light_level_at(&voxel, space, color) > 0
        {
            ALL_TRANSPARENT
        } else {
            source_block.get_rotated_transparency(&space.get_voxel_rotation(vx, vy, vz))
        };

        for [ox, oy, oz] in VOXEL_NEIGHBORS {
            let nvx = vx + ox;
            let nvy = vy + oy;
            let nvz = vz + oz;

            if nvy < 0 || nvy >= config.max_height {
                continue;
            }

            let [ncx, ncz] = map_voxel_to_chunk(nvx, nvz, config.chunk_size);
            if ncx < start_cx || ncz < start_cz || ncx > end_cx || ncz > end_cz {
                continue;
            }

            if let Some(limit) = bounds {
                if !limit.contains_xz(nvx, nvz) {
                    continue;
                }
            }

            let n_block = block_at(registry, space, nvx, nvy, nvz);
            let n_rotation = space.get_voxel_rotation(nvx, nvy, nvz);
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

            if next_level == 0 || !can_enter(&source_transparency, &n_transparency, ox, oy, oz) {
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

pub fn remove_light(
    space: &mut dyn LightVoxelAccess,
    voxel: [i32; 3],
    color: &LightColor,
    config: &LightConfig,
    registry: &LightRegistry,
) {
    let is_sunlight = *color == LightColor::Sunlight;
    let [vx, vy, vz] = voxel;

    let mut fill = Vec::<LightNode>::new();
    let mut remove = vec![LightNode {
        voxel,
        level: get_light_level(space, vx, vy, vz, color, is_sunlight),
    }];
    let mut head = 0usize;

    set_light_level(space, vx, vy, vz, 0, color, is_sunlight);

    while head < remove.len() {
        let LightNode { voxel, level } = remove[head];
        head += 1;

        let [svx, svy, svz] = voxel;

        for [ox, oy, oz] in VOXEL_NEIGHBORS {
            let nvx = svx + ox;
            let nvy = svy + oy;
            let nvz = svz + oz;

            if nvy < 0 || nvy >= config.max_height {
                continue;
            }

            let n_block = block_at(registry, space, nvx, nvy, nvz);
            let n_transparency =
                n_block.get_rotated_transparency(&space.get_voxel_rotation(nvx, nvy, nvz));

            if (is_sunlight
                || n_block.get_torch_light_level_at(&[nvx, nvy, nvz], space, color) == 0)
                && !can_enter_into(&n_transparency, ox, oy, oz)
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

    flood_light(
        space,
        VecDeque::from(fill),
        color,
        config,
        None,
        registry,
    );
}

pub fn remove_lights(
    space: &mut dyn LightVoxelAccess,
    voxels: &[[i32; 3]],
    color: &LightColor,
    config: &LightConfig,
    registry: &LightRegistry,
) {
    if voxels.is_empty() {
        return;
    }

    let is_sunlight = *color == LightColor::Sunlight;
    let mut fill = Vec::<LightNode>::new();
    let mut remove = Vec::<LightNode>::new();

    for voxel in voxels {
        let [vx, vy, vz] = *voxel;
        let level = get_light_level(space, vx, vy, vz, color, is_sunlight);
        if level == 0 {
            continue;
        }

        remove.push(LightNode {
            voxel: *voxel,
            level,
        });
        set_light_level(space, vx, vy, vz, 0, color, is_sunlight);
    }

    let mut head = 0usize;
    while head < remove.len() {
        let LightNode { voxel, level } = remove[head];
        head += 1;

        let [svx, svy, svz] = voxel;

        for [ox, oy, oz] in VOXEL_NEIGHBORS {
            let nvx = svx + ox;
            let nvy = svy + oy;
            let nvz = svz + oz;

            if nvy < 0 || nvy >= config.max_height {
                continue;
            }

            let n_block = block_at(registry, space, nvx, nvy, nvz);
            let n_transparency =
                n_block.get_rotated_transparency(&space.get_voxel_rotation(nvx, nvy, nvz));

            if (is_sunlight
                || n_block.get_torch_light_level_at(&[nvx, nvy, nvz], space, color) == 0)
                && !can_enter_into(&n_transparency, ox, oy, oz)
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

    flood_light(
        space,
        VecDeque::from(fill),
        color,
        config,
        None,
        registry,
    );
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

    let shape_x_i32 = shape_x as i32;
    let shape_z_i32 = shape_z as i32;

    let mut red_light_queue = Vec::<LightNode>::new();
    let mut green_light_queue = Vec::<LightNode>::new();
    let mut blue_light_queue = Vec::<LightNode>::new();
    let mut sunlight_queue = Vec::<LightNode>::new();

    let mut mask = vec![config.max_light_level; shape_x * shape_z];

    for y in (0..config.max_height).rev() {
        for x in 0..shape_x_i32 {
            for z in 0..shape_z_i32 {
                let vx = x + start_x;
                let vz = z + start_z;
                let voxel_pos = [vx, y, vz];

                let block = block_at(registry, space, vx, y, vz);
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

                let mask_index = (x + z * shape_x_i32) as usize;
                let [px, py, pz, nx, ny, nz] = space
                    .get_voxel_rotation(vx, y, vz)
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
                    let should_add_max = (x < shape_x_i32 - 1
                        && mask[(x + 1 + z * shape_x_i32) as usize] == 0
                        && px)
                        || (x > 0 && mask[(x - 1 + z * shape_x_i32) as usize] == 0 && nx)
                        || (z < shape_z_i32 - 1
                            && mask[(x + (z + 1) * shape_x_i32) as usize] == 0
                            && pz)
                        || (z > 0 && mask[(x + (z - 1) * shape_x_i32) as usize] == 0 && nz);

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
    fn flood_and_remove_torch_light_roundtrip() {
        let registry = test_registry();
        let config = test_config();
        let mut space = TestSpace::new([0, 0, 0], [16, 64, 16]);

        space.voxels[8 * 64 * 16 + 32 * 16 + 8] = 2;
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
}
