use std::collections::VecDeque;

use crate::{
    utils::{light::LightColor, vec::Vec3},
    WorldConfig,
};

use super::{registry::Registry, space::Space};

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
    pub voxel: Vec3<i32>,
    pub level: u32,
}

pub struct Lights;

impl Lights {
    pub fn flood_light(
        queue: &mut VecDeque<LightNode>,
        is_sunlight: bool,
        color: LightColor,
        space: &mut Space,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let &WorldConfig {
            max_height,
            max_light_level,
            ..
        } = config;

        let Vec3(shape0, _, shape2) = space.shape;
        let Vec3(start_x, _, start_z) = space.min;

        let shape0 = shape0 as i32;
        let shape2 = shape2 as i32;

        let max_height = max_height as i32;

        while !queue.is_empty() {
            let LightNode { voxel, level } = queue.pop_front().unwrap();
            let Vec3(vx, vy, vz) = voxel;

            for [ox, oy, oz] in VOXEL_NEIGHBORS.iter() {
                let nvy = vy + oy;

                if nvy < 0 || nvy >= max_height {
                    continue;
                }

                let nvx = vx + ox;
                let nvz = vz + oz;

                if nvx < 0 || nvz < 0 || nvx >= shape0 || nvz >= shape2 {
                    continue;
                }

                let sun_down = is_sunlight && *oy == -1 && level == max_light_level;
                let next_level = level - if sun_down { 0 } else { 1 };
                let next_voxel = Vec3(nvx, nvy, nvz);
                let block_type =
                    registry.get_block_by_id(space.get_voxel(nvx + start_x, nvy, nvz + start_z));

                if !block_type.is_transparent
                    || (if is_sunlight {
                        space.get_sunlight(nvx, nvy, nvz)
                    } else {
                        space.get_torch_light(nvx, nvy, nvz, &color)
                    } >= next_level)
                {}
            }
        }
    }
}
