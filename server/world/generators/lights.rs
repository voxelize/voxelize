use std::collections::VecDeque;

use crate::{LightColor, Registry, Vec3, WorldConfig};
use voxelize_lighter::{
    can_enter as lighter_can_enter, can_enter_into as lighter_can_enter_into,
    flood_light as lighter_flood_light, propagate as lighter_propagate,
    remove_light as lighter_remove_light, remove_lights as lighter_remove_lights, LightBounds,
    LightConfig, LightNode as LighterNode, LightVoxelAccess,
};

pub type LightNode = LighterNode;

#[inline]
fn clamp_usize_to_i32(value: usize) -> i32 {
    value.min(i32::MAX as usize) as i32
}

#[inline]
fn clamp_i64_to_usize(value: i64) -> usize {
    if value <= 0 {
        return 0;
    }

    usize::try_from(value).unwrap_or(usize::MAX)
}

#[inline]
fn convert_config(config: &WorldConfig) -> LightConfig {
    LightConfig {
        chunk_size: clamp_usize_to_i32(config.chunk_size),
        max_height: clamp_usize_to_i32(config.max_height),
        max_light_level: config.max_light_level,
        min_chunk: config.min_chunk,
        max_chunk: config.max_chunk,
    }
}

#[inline]
fn convert_bounds(
    min: Option<&Vec3<i32>>,
    shape: Option<&Vec3<usize>>,
    config: &LightConfig,
) -> Option<LightBounds> {
    match (min, shape) {
        (Some(&Vec3(start_x, start_y, start_z)), Some(&Vec3(shape_x, shape_y, shape_z))) => {
            Some(LightBounds {
                min: [start_x, start_y, start_z],
                shape: [shape_x, shape_y, shape_z],
            })
        }
        (Some(&Vec3(start_x, start_y, start_z)), None) => {
            let max_chunk_x_exclusive = i64::from(config.max_chunk[0]).saturating_add(1);
            let max_chunk_z_exclusive = i64::from(config.max_chunk[1]).saturating_add(1);
            let chunk_size = i64::from(config.chunk_size);

            let max_x_exclusive = max_chunk_x_exclusive.saturating_mul(chunk_size);
            let max_z_exclusive = max_chunk_z_exclusive.saturating_mul(chunk_size);

            let shape_x = clamp_i64_to_usize(max_x_exclusive.saturating_sub(i64::from(start_x)));
            let shape_z = clamp_i64_to_usize(max_z_exclusive.saturating_sub(i64::from(start_z)));

            Some(LightBounds {
                min: [start_x, start_y, start_z],
                shape: [shape_x, config.max_height as usize, shape_z],
            })
        }
        _ => None,
    }
}

pub struct Lights;

impl Lights {
    pub fn flood_light(
        space: &mut dyn LightVoxelAccess,
        queue: VecDeque<LightNode>,
        color: &LightColor,
        registry: &Registry,
        config: &WorldConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        let light_registry = registry.lighter_registry();
        let light_config = convert_config(config);
        let bounds = convert_bounds(min, shape, &light_config);
        lighter_flood_light(
            space,
            queue,
            color,
            &light_config,
            bounds.as_ref(),
            light_registry.as_ref(),
        );
    }

    pub fn remove_light(
        space: &mut dyn LightVoxelAccess,
        voxel: &Vec3<i32>,
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let light_registry = registry.lighter_registry();
        let light_config = convert_config(config);
        lighter_remove_light(
            space,
            [voxel.0, voxel.1, voxel.2],
            color,
            &light_config,
            light_registry.as_ref(),
        );
    }

    pub fn remove_lights(
        space: &mut dyn LightVoxelAccess,
        voxels: &[Vec3<i32>],
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let light_registry = registry.lighter_registry();
        let light_config = convert_config(config);
        let converted_voxels: Vec<[i32; 3]> = voxels.iter().map(|v| [v.0, v.1, v.2]).collect();
        lighter_remove_lights(
            space,
            &converted_voxels,
            color,
            &light_config,
            light_registry.as_ref(),
        );
    }

    pub fn propagate(
        space: &mut dyn LightVoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        registry: &Registry,
        config: &WorldConfig,
    ) -> [VecDeque<LightNode>; 4] {
        let light_registry = registry.lighter_registry();
        let light_config = convert_config(config);
        lighter_propagate(
            space,
            [min.0, min.1, min.2],
            [shape.0, shape.1, shape.2],
            light_registry.as_ref(),
            &light_config,
        )
    }

    pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        lighter_can_enter_into(target, dx, dy, dz)
    }

    pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        lighter_can_enter(source, target, dx, dy, dz)
    }
}
