use std::collections::VecDeque;

use log::info;

use crate::{
    utils::{chunk_utils::ChunkUtils, light_utils::LightColor, ndarray::Ndarray, vec::Vec3},
    vec::Vec2,
    world::block::Block,
};

use super::{registry::Registry, space::Space, WorldConfig};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

/// Node of a light propagation queue.
#[derive(Debug)]
pub struct LightNode {
    pub voxel: [i32; 3],
    pub level: u32,
}

/// A set of utility functions to simulate global illumination in a Voxelize world.
pub struct Lights;

impl Lights {
    /// Propagate a specific queue of `LightNode`s in a depth-first-search fashion. If the propagation
    /// is for sunlight, light value does not decrease going downwards to simulate sunshine.
    pub fn flood_light(
        mut queue: VecDeque<LightNode>,
        is_sunlight: bool,
        color: &LightColor,
        space: &mut Space,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let &WorldConfig {
            max_height,
            chunk_size,
            min_chunk,
            max_chunk,
            ..
        } = config;

        let Vec3(shape0, _, shape2) = space.shape;
        let Vec3(start_x, _, start_z) = space.min;

        let [start_cx, start_cz] = min_chunk;
        let [end_cx, end_cz] = max_chunk;

        let chunk_size = chunk_size as i32;

        let shape0 = shape0 as i32;
        let shape2 = shape2 as i32;

        let max_height = max_height as i32;

        while !queue.is_empty() {
            let LightNode { voxel, level } = queue.pop_front().unwrap();
            let [vx, vy, vz] = voxel;

            if level == 0 {
                break;
            }

            for [ox, oy, oz] in VOXEL_NEIGHBORS.iter() {
                let nvy = vy + oy;

                if nvy < 0 || nvy >= max_height {
                    continue;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;

                let Vec2(ncx, ncz) =
                    ChunkUtils::map_voxel_to_chunk(nvx, nvy, nvz, config.chunk_size);

                if ncx < start_cx
                    || ncz < start_cz
                    || ncx > end_cx
                    || ncz > end_cz
                    || nvx < start_x
                    || nvz < start_z
                    || nvx >= start_x + shape0
                    || nvz >= start_z + shape2
                {
                    continue;
                }

                let next_level = level - 1;
                let next_voxel = [nvx, nvy, nvz];
                let block_type = registry.get_block_by_id(space.get_voxel(nvx, nvy, nvz));

                if !block_type.is_transparent
                    || (if is_sunlight {
                        space.get_sunlight(nvx, nvy, nvz)
                    } else {
                        space.get_torch_light(nvx, nvy, nvz, &color)
                    } >= next_level)
                {
                    continue;
                }

                if is_sunlight {
                    space.set_sunlight(nvx, nvy, nvz, next_level);
                } else {
                    space.set_torch_light(nvx, nvy, nvz, next_level, &color);
                }

                queue.push_back(LightNode {
                    voxel: next_voxel,
                    level: next_level,
                });
            }
        }
    }

    /// Propagate a space and return the light data of the center chunk.
    pub fn propagate(space: &mut Space, registry: &Registry, config: &WorldConfig) -> Ndarray<u32> {
        let Space { width, min, .. } = space;
        let &WorldConfig {
            max_height,
            max_light_level,
            ..
        } = config;

        let mut red_light_queue = VecDeque::<LightNode>::new();
        let mut green_light_queue = VecDeque::<LightNode>::new();
        let mut blue_light_queue = VecDeque::<LightNode>::new();
        let mut sunlight_queue = VecDeque::<LightNode>::new();

        const RED: LightColor = LightColor::Red;
        const GREEN: LightColor = LightColor::Green;
        const BLUE: LightColor = LightColor::Blue;
        const SUNLIGHT: LightColor = LightColor::Sunlight;

        let &mut Vec3(start_x, _, start_z) = min;

        let width = *width as i32;

        let mut mask = vec![];
        for _ in 0..(width * width) {
            mask.push(max_light_level);
        }

        for y in (0..max_height as i32).rev() {
            for x in 0..width {
                for z in 0..width {
                    let index = (x + z * width) as usize;

                    let id = space.get_voxel(x + start_x, y, z + start_z);
                    let &Block {
                        is_transparent,
                        is_light,
                        red_light_level,
                        green_light_level,
                        blue_light_level,
                        ..
                    } = registry.get_block_by_id(id);

                    if is_transparent {
                        space.set_sunlight(x + start_x, y, z + start_z, mask[index]);

                        if mask[index] == 0 {
                            if (x > 0 && mask[(x - 1 + z * width) as usize] == max_light_level)
                                || (x < width - 1
                                    && mask[(x + 1 + z * width) as usize] == max_light_level)
                                || (z > 0
                                    && mask[(x + (z - 1) * width) as usize] == max_light_level)
                                || (z < width - 1
                                    && mask[(x + (z + 1) * width) as usize] == max_light_level)
                            {
                                space.set_sunlight(
                                    x + start_x,
                                    y,
                                    z + start_z,
                                    max_light_level - 1,
                                );
                                sunlight_queue.push_back(LightNode {
                                    level: max_light_level - 1,
                                    voxel: [start_x + x, y, start_z + z],
                                });
                            }
                        }
                    } else {
                        mask[index] = 0;
                    }

                    if is_light {
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
                }
            }
        }

        if !red_light_queue.is_empty() {
            Lights::flood_light(red_light_queue, false, &RED, space, registry, config);
        }

        if !green_light_queue.is_empty() {
            Lights::flood_light(green_light_queue, false, &GREEN, space, registry, config);
        }

        if !blue_light_queue.is_empty() {
            Lights::flood_light(blue_light_queue, false, &BLUE, space, registry, config);
        }

        if !sunlight_queue.is_empty() {
            Lights::flood_light(sunlight_queue, true, &SUNLIGHT, space, registry, config);
        }

        space
            .get_lights(space.coords.0, space.coords.1)
            .unwrap()
            .to_owned()
    }
}
