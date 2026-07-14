use std::collections::VecDeque;

use crate::{
    ChunkUtils, LightColor, LightPassInfo, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

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

/// Per optical-density unit transmittance ≈ e^(-0.143) ≈ 0.867.
/// Matches Beer-Lambert I' = I * e^(-μd) with μ≈0.143 per density unit per block.
const BEER_LAMBERT_TRANSMITTANCE_NUM: u32 = 222;
const BEER_LAMBERT_TRANSMITTANCE_DEN: u32 = 256;

/// Apply Beer-Lambert transmission through a medium with the given optical density.
/// `optical_density` is block `light_attenuation` (leaves=1, water=2).
pub fn beer_lambert_transmit(level: u32, optical_density: u8) -> u32 {
    if level == 0 || optical_density == 0 {
        return level;
    }

    let mut next = level;
    for _ in 0..optical_density {
        next = (next * BEER_LAMBERT_TRANSMITTANCE_NUM) / BEER_LAMBERT_TRANSMITTANCE_DEN;
    }

    // Integer rounding can stall at 1; force progress so light eventually dies out.
    if next >= level {
        level.saturating_sub(1)
    } else {
        next
    }
}

fn flood_light_next_level(
    is_sunlight: bool,
    light_attenuation: u8,
    oy: i32,
    level: u32,
    max_light_level: u32,
) -> u32 {
    if level == 0 {
        return 0;
    }

    // Open-air sunlight column does not attenuate downward at full strength.
    if is_sunlight && light_attenuation == 0 && oy == -1 && level == max_light_level {
        return level;
    }

    if light_attenuation > 0 {
        beer_lambert_transmit(level, light_attenuation)
    } else {
        level.saturating_sub(1)
    }
}

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
            let source_id = space.get_voxel(vx, vy, vz);
            let source_info = registry.light_pass_info(source_id);
            let source_transparency = if !is_sunlight
                && source_info.emits_torch_light
                && Lights::torch_level_of(
                    registry,
                    source_id,
                    &source_info,
                    vx,
                    vy,
                    vz,
                    space,
                    color,
                ) > 0
            {
                ALL_TRANSPARENT
            } else if source_info.is_rotation_dependent {
                registry
                    .get_block_by_id(source_id)
                    .get_rotated_transparency(&space.get_voxel_rotation(vx, vy, vz))
            } else {
                source_info.is_transparent
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
                let n_id = space.get_voxel(nvx, nvy, nvz);
                let n_info = registry.light_pass_info(n_id);
                let n_transparency = if n_info.is_rotation_dependent {
                    registry
                        .get_block_by_id(n_id)
                        .get_rotated_transparency(&space.get_voxel_rotation(nvx, nvy, nvz))
                } else {
                    n_info.is_transparent
                };
                let next_level = flood_light_next_level(
                    is_sunlight,
                    n_info.light_attenuation,
                    *oy,
                    level,
                    *max_light_level,
                );

                if next_level == 0 {
                    continue;
                }

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
                    if is_sunlight {
                        fill.push_back(LightNode {
                            voxel: n_voxel,
                            level: nl,
                        });
                        continue;
                    }

                    let emission_level =
                        n_block.get_torch_light_level_at(&n_voxel_pos, space, color);

                    if emission_level == 0 {
                        queue.push_back(LightNode {
                            voxel: n_voxel,
                            level: nl,
                        });
                        space.set_torch_light(nvx, nvy, nvz, 0, color);
                        continue;
                    }

                    if nl == emission_level {
                        fill.push_back(LightNode {
                            voxel: n_voxel,
                            level: emission_level,
                        });
                        continue;
                    }

                    queue.push_back(LightNode {
                        voxel: n_voxel,
                        level: nl,
                    });
                    space.set_torch_light(nvx, nvy, nvz, 0, color);
                }
            }
        }

        let fill = Lights::retain_live_fill_nodes(space, fill, color);
        Lights::flood_light(space, fill, color, registry, config, None, None);
    }

    fn retain_live_fill_nodes(
        space: &dyn VoxelAccess,
        fill: VecDeque<LightNode>,
        color: &LightColor,
    ) -> VecDeque<LightNode> {
        // A node is collected as fill the moment the removal front sees it,
        // but a later, stronger front can still zero it; flooding from that
        // dead snapshot would resurrect light the removal just proved stale.
        let is_sunlight = *color == LightColor::Sunlight;

        fill.into_iter()
            .filter(|node| {
                let [vx, vy, vz] = node.voxel;
                let current = if is_sunlight {
                    space.get_sunlight(vx, vy, vz)
                } else {
                    space.get_torch_light(vx, vy, vz, color)
                };
                current == node.level
            })
            .collect()
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

        let max_y = max_height as i32 - 1;

        // Everything strictly above the tallest column in the footprint is guaranteed
        // open-sky air, so it always resolves to `max_light_level`. Find that ceiling
        // from the height map and bulk-fill the sky instead of scanning every empty row.
        let mut region_top = 0;
        for x in 0..shape.0 {
            for z in 0..shape.2 {
                let height = space.get_max_height(x + start_x, z + start_z) as i32;
                if height > region_top {
                    region_top = height;
                }
            }
        }
        region_top = region_top.min(max_y);

        if region_top < max_y {
            for x in 0..shape.0 {
                for z in 0..shape.2 {
                    space.fill_sunlight_column(
                        x + start_x,
                        z + start_z,
                        region_top + 1,
                        max_y,
                        max_light_level,
                    );
                }
            }
        }

        for y in (0..=region_top).rev() {
            for x in 0..shape.0 {
                for z in 0..shape.2 {
                    let id = space.get_voxel(x + start_x, y, z + start_z);
                    let info = registry.light_pass_info(id);

                    if info.emits_torch_light {
                        Lights::seed_torch_queues(
                            space,
                            registry,
                            id,
                            &info,
                            x + start_x,
                            y,
                            z + start_z,
                            &mut red_light_queue,
                            &mut green_light_queue,
                            &mut blue_light_queue,
                        );
                    }

                    let index = (x + z * shape.0) as usize;

                    if info.is_opaque {
                        mask[index] = 0;
                    } else {
                        let [px, py, pz, nx, ny, nz] = if info.is_rotation_dependent {
                            registry.get_block_by_id(id).get_rotated_transparency(
                                &space.get_voxel_rotation(x + start_x, y, z + start_z),
                            )
                        } else {
                            info.is_transparent
                        };

                        if !py || !ny {
                            mask[index] = 0;

                            continue;
                        }

                        // Beer-Lambert attenuation through light-filtering blocks (water, leaves).
                        if info.light_attenuation > 0 {
                            if mask[index] != 0 {
                                let next_level =
                                    beer_lambert_transmit(mask[index], info.light_attenuation);
                                space.set_sunlight(x + start_x, y, z + start_z, next_level);

                                if next_level > 0 {
                                    sunlight_queue.push_back(LightNode {
                                        level: next_level,
                                        voxel: [start_x + x, y, start_z + z],
                                    });
                                }

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

    #[allow(clippy::too_many_arguments)]
    fn seed_torch_queues(
        space: &mut dyn VoxelAccess,
        registry: &Registry,
        id: u32,
        info: &LightPassInfo,
        vx: i32,
        vy: i32,
        vz: i32,
        red_queue: &mut VecDeque<LightNode>,
        green_queue: &mut VecDeque<LightNode>,
        blue_queue: &mut VecDeque<LightNode>,
    ) {
        // Emitters are rare, so this only runs for a handful of voxels per
        // chunk. Static-level blocks read straight from the LUT; dynamic
        // pattern blocks take the original slow path.
        let (red, green, blue) = if info.has_dynamic_light {
            let block = registry.get_block_by_id(id);
            let pos = Vec3(vx, vy, vz);
            (
                block.get_torch_light_level_at(&pos, space, &RED),
                block.get_torch_light_level_at(&pos, space, &GREEN),
                block.get_torch_light_level_at(&pos, space, &BLUE),
            )
        } else {
            (
                info.red_light_level,
                info.green_light_level,
                info.blue_light_level,
            )
        };

        if red > 0 {
            space.set_red_light(vx, vy, vz, red);
            red_queue.push_back(LightNode {
                voxel: [vx, vy, vz],
                level: red,
            });
        }
        if green > 0 {
            space.set_green_light(vx, vy, vz, green);
            green_queue.push_back(LightNode {
                voxel: [vx, vy, vz],
                level: green,
            });
        }
        if blue > 0 {
            space.set_blue_light(vx, vy, vz, blue);
            blue_queue.push_back(LightNode {
                voxel: [vx, vy, vz],
                level: blue,
            });
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn torch_level_of(
        registry: &Registry,
        id: u32,
        info: &LightPassInfo,
        vx: i32,
        vy: i32,
        vz: i32,
        space: &dyn VoxelAccess,
        color: &LightColor,
    ) -> u32 {
        if info.has_dynamic_light {
            return registry.get_block_by_id(id).get_torch_light_level_at(
                &Vec3(vx, vy, vz),
                space,
                color,
            );
        }

        match *color {
            LightColor::Red => info.red_light_level,
            LightColor::Green => info.green_light_level,
            LightColor::Blue => info.blue_light_level,
            LightColor::Sunlight => 0,
        }
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
                    if is_sunlight {
                        fill.push_back(LightNode {
                            voxel: [nvx, nvy, nvz],
                            level: nl,
                        });
                        continue;
                    }

                    let emission_level =
                        n_block.get_torch_light_level_at(&n_voxel_pos, space, color);

                    if emission_level == 0 {
                        queue.push_back(LightNode {
                            voxel: [nvx, nvy, nvz],
                            level: nl,
                        });
                        space.set_torch_light(nvx, nvy, nvz, 0, color);
                        continue;
                    }

                    if nl == emission_level {
                        fill.push_back(LightNode {
                            voxel: [nvx, nvy, nvz],
                            level: emission_level,
                        });
                        continue;
                    }

                    queue.push_back(LightNode {
                        voxel: [nvx, nvy, nvz],
                        level: nl,
                    });
                    space.set_torch_light(nvx, nvy, nvz, 0, color);
                }
            }
        }

        let fill = Lights::retain_live_fill_nodes(space, fill, color);
        Lights::flood_light(space, fill, color, registry, config, None, None);
    }
}
