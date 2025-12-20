use std::collections::VecDeque;

use crate::{Block, ChunkUtils, LightColor, Registry, Vec2, Vec3, VoxelAccess, WorldConfig};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

/// Node of a light propagation queue.
#[derive(Debug, Clone)]
pub struct LightNode {
    pub voxel: [i32; 3],
    pub level: u32,
}

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;
const SUNLIGHT: LightColor = LightColor::Sunlight;
const ALL_TRANSPARENT: [bool; 6] = [true, true, true, true, true, true];

/// A set of utility functions to simulate global illumination in a Voxelize world.
pub struct Lights;

// TODO: RIGHT NOW, A TOP SLAB WILL STILL LET LIGHT TRAVEL INTO A BOTTOM SLAB...

impl Lights {
    /// Propagate a specific queue of `LightNode`s in a breadth-first-search fashion. If the propagation
    /// is for sunlight, light value does not decrease going downwards to simulate sunshine.
    pub fn flood_light(
        space: &mut dyn VoxelAccess,
        mut queue: VecDeque<LightNode>,
        color: &LightColor,
        registry: &Registry,
        config: &WorldConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        let WorldConfig {
            max_height,
            min_chunk,
            max_chunk,
            max_light_level,
            ..
        } = config;

        let [start_cx, start_cz] = *min_chunk;
        let [end_cx, end_cz] = *max_chunk;

        let max_height = *max_height as i32;
        let is_sunlight = *color == LightColor::Sunlight;

        while let Some(LightNode { voxel, level }) = queue.pop_front() {
            if level == 0 {
                continue;
            }

            let [vx, vy, vz] = voxel;
            let source_block = registry.get_block_by_id(space.get_voxel(vx, vy, vz));
            let voxel_pos = Vec3(vx, vy, vz);
            let source_transparency = if !is_sunlight
                && source_block.get_torch_light_level_at(&voxel_pos, space, color) > 0
            {
                ALL_TRANSPARENT
            } else {
                source_block.get_rotated_transparency(&space.get_voxel_rotation(vx, vy, vz))
            };

            for [ox, oy, oz] in &VOXEL_NEIGHBORS {
                let nvy = vy + oy;

                if nvy < 0 || nvy >= max_height {
                    continue;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;

                let Vec2(ncx, ncz) =
                    ChunkUtils::map_voxel_to_chunk(nvx, nvy, nvz, config.chunk_size);

                // If neighbor is out of this chunk, or if voxel is out of the specified range, continue to next neighbor.
                if ncx < start_cx
                    || ncz < start_cz
                    || ncx > end_cx
                    || ncz > end_cz
                    || if let Some(&Vec3(start_x, _, start_z)) = min {
                        nvx < start_x
                            || nvz < start_z
                            || if let Some(&Vec3(shape0, _, shape2)) = shape {
                                nvx >= start_x + shape0 as i32 || nvz >= start_z + shape2 as i32
                            } else {
                                false
                            }
                    } else {
                        false
                    }
                {
                    continue;
                }

                let next_voxel = [nvx, nvy, nvz];
                let n_block = registry.get_block_by_id(space.get_voxel(nvx, nvy, nvz));
                let rotation = space.get_voxel_rotation(nvx, nvy, nvz);
                let n_transparency = n_block.get_rotated_transparency(&rotation);
                let reduce = if is_sunlight
                    && !n_block.light_reduce
                    && *oy == -1
                    && level == *max_light_level
                {
                    0
                } else {
                    1
                };
                let next_level = level.saturating_sub(reduce);

                // To not continue:
                // (1) Light cannot be flooded from source block to neighbor.
                // (2) Neighbor light level is greater or equal to self.
                if !Lights::can_enter(&source_transparency, &n_transparency, *ox, *oy, *oz)
                    || (if is_sunlight {
                        space.get_sunlight(nvx, nvy, nvz)
                    } else {
                        space.get_torch_light(nvx, nvy, nvz, color)
                    } >= next_level)
                {
                    continue;
                }

                if is_sunlight {
                    space.set_sunlight(nvx, nvy, nvz, next_level);
                } else {
                    space.set_torch_light(nvx, nvy, nvz, next_level, color);
                }

                queue.push_back(LightNode {
                    voxel: next_voxel,
                    level: next_level,
                });
            }
        }
    }

    pub fn remove_light(
        space: &mut dyn VoxelAccess,
        voxel: &Vec3<i32>,
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let max_height = config.max_height as i32;
        let max_light_level = config.max_light_level;

        let mut fill = VecDeque::<LightNode>::new();
        let mut queue = VecDeque::<LightNode>::new();

        let is_sunlight = *color == LightColor::Sunlight;
        let &Vec3(vx, vy, vz) = voxel;

        queue.push_back(LightNode {
            voxel: [vx, vy, vz],
            level: if is_sunlight {
                space.get_sunlight(vx, vy, vz)
            } else {
                space.get_torch_light(vx, vy, vz, color)
            },
        });

        if is_sunlight {
            space.set_sunlight(vx, vy, vz, 0);
        } else {
            space.set_torch_light(vx, vy, vz, 0, color);
        }

        while let Some(LightNode { voxel, level }) = queue.pop_front() {
            let [vx, vy, vz] = voxel;

            for [ox, oy, oz] in &VOXEL_NEIGHBORS {
                let nvy = vy + oy;

                if nvy < 0 || nvy >= max_height {
                    continue;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;
                let n_block = registry.get_block_by_id(space.get_voxel(nvx, nvy, nvz));
                let n_voxel_pos = Vec3(nvx, nvy, nvz);
                let rotation = space.get_voxel_rotation(nvx, nvy, nvz);
                let n_transparency = n_block.get_rotated_transparency(&rotation);

                // if the neighboring block doesn't allow light, then it wouldn't be a potential light entrance.
                if if is_sunlight {
                    true
                } else {
                    n_block.get_torch_light_level_at(&n_voxel_pos, space, color) == 0
                } && !Lights::can_enter_into(&n_transparency, *ox, *oy, *oz)
                {
                    continue;
                }

                let n_voxel = [nvx, nvy, nvz];
                let nl = if is_sunlight {
                    space.get_sunlight(nvx, nvy, nvz)
                } else {
                    space.get_torch_light(nvx, nvy, nvz, color)
                };

                if nl == 0 {
                    continue;
                }

                if nl < level
                    || (is_sunlight
                        && *oy == -1
                        && level == max_light_level
                        && nl == max_light_level)
                {
                    queue.push_back(LightNode {
                        voxel: n_voxel,
                        level: nl,
                    });

                    if is_sunlight {
                        space.set_sunlight(nvx, nvy, nvz, 0);
                    } else {
                        space.set_torch_light(nvx, nvy, nvz, 0, color);
                    }
                } else if if is_sunlight && *oy == -1 {
                    nl > level
                } else {
                    nl >= level
                } {
                    fill.push_back(LightNode {
                        voxel: n_voxel,
                        level: nl,
                    })
                }
            }
        }

        Lights::flood_light(space, fill, color, registry, config, None, None);
    }

    pub fn propagate(
        space: &mut dyn VoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        registry: &Registry,
        config: &WorldConfig,
    ) -> [VecDeque<LightNode>; 4] {
        let &WorldConfig {
            max_height,
            max_light_level,
            ..
        } = config;

        let mut red_light_queue = VecDeque::<LightNode>::new();
        let mut green_light_queue = VecDeque::<LightNode>::new();
        let mut blue_light_queue = VecDeque::<LightNode>::new();
        let mut sunlight_queue = VecDeque::<LightNode>::new();

        let Vec3(start_x, _, start_z) = min;
        let shape = Vec3(shape.0 as i32, shape.1 as i32, shape.2 as i32);

        let mut mask = vec![max_light_level; (shape.0 * shape.2) as usize];

        for y in (0..max_height as i32).rev() {
            for x in 0..shape.0 {
                for z in 0..shape.2 {
                    let id = space.get_voxel(x + start_x, y, z + start_z);
                    let block = registry.get_block_by_id(id);
                    let voxel_pos = Vec3(x + start_x, y, z + start_z);

                    let &Block {
                        is_transparent,
                        is_opaque,
                        is_light,
                        light_reduce,
                        ..
                    } = block;

                    // Get dynamic light levels
                    let red_light_level =
                        block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Red);
                    let green_light_level =
                        block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Green);
                    let blue_light_level =
                        block.get_torch_light_level_at(&voxel_pos, space, &LightColor::Blue);

                    if is_light
                        || red_light_level > 0
                        || green_light_level > 0
                        || blue_light_level > 0
                    {
                        if red_light_level > 0 {
                            space.set_red_light(x + start_x, y, z + start_z, red_light_level);
                            red_light_queue.push_back(LightNode {
                                voxel: [x + start_x, y, z + start_z],
                                level: red_light_level,
                            });
                        }
                        if green_light_level > 0 {
                            space.set_green_light(x + start_x, y, z + start_z, green_light_level);
                            green_light_queue.push_back(LightNode {
                                voxel: [x + start_x, y, z + start_z],
                                level: green_light_level,
                            });
                        }
                        if blue_light_level > 0 {
                            space.set_blue_light(x + start_x, y, z + start_z, blue_light_level);
                            blue_light_queue.push_back(LightNode {
                                voxel: [x + start_x, y, z + start_z],
                                level: blue_light_level,
                            });
                        }
                    }

                    let index = (x + z * shape.0) as usize;

                    let [px, py, pz, nx, ny, nz] = space
                        .get_voxel_rotation(x + start_x, y, z + start_z)
                        .rotate_transparency(is_transparent);

                    if is_opaque {
                        mask[index] = 0;
                    } else {
                        if !py || !ny {
                            mask[index] = 0;

                            continue;
                        }

                        // Let sunlight pass through if it can.
                        if light_reduce {
                            if mask[index] != 0 {
                                space.set_sunlight(x + start_x, y, z + start_z, mask[index] - 1);

                                sunlight_queue.push_back(LightNode {
                                    level: mask[index] - 1,
                                    voxel: [start_x + x, y, start_z + z],
                                });

                                mask[index] = 0;
                            }
                        }
                        // If the voxel is transparent, then it can pass sunlight through.
                        else {
                            space.set_sunlight(x + start_x, y, z + start_z, mask[index]);

                            if mask[index] == max_light_level {
                                if (x < shape.0 - 1
                                    && mask[(x + 1 + z * shape.0) as usize] == 0
                                    && px)
                                    || (x > 0 && mask[(x - 1 + z * shape.0) as usize] == 0 && nx)
                                    || (z < shape.2 - 1
                                        && mask[(x + (z + 1) * shape.0) as usize] == 0
                                        && pz)
                                    || (z > 0 && mask[(x + (z - 1) * shape.0) as usize] == 0 && nz)
                                {
                                    space.set_sunlight(
                                        x + start_x,
                                        y,
                                        z + start_z,
                                        max_light_level,
                                    );
                                    sunlight_queue.push_back(LightNode {
                                        level: max_light_level,
                                        voxel: [start_x + x, y, start_z + z],
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        [
            sunlight_queue,
            red_light_queue,
            green_light_queue,
            blue_light_queue,
        ]
    }

    /// Check to see if light can go "into" one block, disregarding the source.
    pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        if (dx + dy + dz).abs() != 1 {
            panic!("This isn't supposed to happen. Light neighboring direction should be on 1 axis only.");
        }

        let &[px, py, pz, nx, ny, nz] = target;

        // Going into the NX of the target.
        if dx == 1 {
            return nx;
        }

        // Going into the PX of the target.
        if dx == -1 {
            return px;
        }

        // Going into the NY of the target.
        if dy == 1 {
            return ny;
        }

        // Going into the PY of the target.
        if dy == -1 {
            return py;
        }

        // Going into the NZ of the target.
        if dz == 1 {
            return nz;
        }

        // Going into the PZ of the target.
        pz
    }

    /// Check to see if light can enter from one block to another.
    pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        if (dx + dy + dz).abs() != 1 {
            panic!("This isn't supposed to happen. Light neighboring direction should be on 1 axis only.");
        }

        let &[spx, spy, spz, snx, sny, snz] = source;
        let &[tpx, tpy, tpz, tnx, tny, tnz] = target;

        // Going from PX of source to NX of target
        if dx == 1 {
            return spx && tnx;
        }

        // Going from NX of source to PX of target
        if dx == -1 {
            return snx && tpx;
        }

        // Going from PY of source to NY of target
        if dy == 1 {
            return spy && tny;
        }

        // Going from NY of source to PY of target
        if dy == -1 {
            return sny && tpy;
        }

        // Going from PZ of source to NZ of target
        if dz == 1 {
            return spz && tnz;
        }

        // Going from NZ of source to PZ of target
        snz && tpz
    }

    pub fn remove_lights(
        space: &mut dyn VoxelAccess,
        voxels: &[Vec3<i32>],
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        if voxels.is_empty() {
            return;
        }

        let max_height = config.max_height as i32;
        let max_light_level = config.max_light_level;

        let mut fill = VecDeque::<LightNode>::new();
        let mut queue = VecDeque::<LightNode>::new();

        let is_sunlight = *color == LightColor::Sunlight;

        // Initialize queue with all voxels to remove
        for &Vec3(vx, vy, vz) in voxels {
            let level = if is_sunlight {
                space.get_sunlight(vx, vy, vz)
            } else {
                space.get_torch_light(vx, vy, vz, color)
            };
            if level == 0 {
                continue;
            }
            queue.push_back(LightNode {
                voxel: [vx, vy, vz],
                level,
            });

            if is_sunlight {
                space.set_sunlight(vx, vy, vz, 0);
            } else {
                space.set_torch_light(vx, vy, vz, 0, color);
            }
        }

        while let Some(LightNode { voxel, level }) = queue.pop_front() {
            let [vx, vy, vz] = voxel;

            for [ox, oy, oz] in &VOXEL_NEIGHBORS {
                let nvy = vy + oy;

                if nvy < 0 || nvy >= max_height {
                    continue;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;
                let n_block = registry.get_block_by_id(space.get_voxel(nvx, nvy, nvz));
                let n_voxel_pos = Vec3(nvx, nvy, nvz);
                let rotation = space.get_voxel_rotation(nvx, nvy, nvz);
                let n_transparency = n_block.get_rotated_transparency(&rotation);

                // if the neighboring block doesn't allow light, then it wouldn't be a potential light entrance.
                if if is_sunlight {
                    true
                } else {
                    n_block.get_torch_light_level_at(&n_voxel_pos, space, color) == 0
                } && !Lights::can_enter_into(&n_transparency, *ox, *oy, *oz)
                {
                    continue;
                }

                let nl = if is_sunlight {
                    space.get_sunlight(nvx, nvy, nvz)
                } else {
                    space.get_torch_light(nvx, nvy, nvz, color)
                };

                if nl == 0 {
                    continue;
                }

                if nl < level
                    || (is_sunlight
                        && *oy == -1
                        && level == max_light_level
                        && nl == max_light_level)
                {
                    queue.push_back(LightNode {
                        voxel: [nvx, nvy, nvz],
                        level: nl,
                    });

                    if is_sunlight {
                        space.set_sunlight(nvx, nvy, nvz, 0);
                    } else {
                        space.set_torch_light(nvx, nvy, nvz, 0, color);
                    }
                } else if if is_sunlight && *oy == -1 {
                    nl > level
                } else {
                    nl >= level
                } {
                    fill.push_back(LightNode {
                        voxel: [nvx, nvy, nvz],
                        level: nl,
                    });
                }
            }
        }

        Lights::flood_light(space, fill, color, registry, config, None, None);
    }
}
