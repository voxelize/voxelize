use std::collections::VecDeque;

use crate::{LightColor, Registry, Vec3, WorldConfig};
use voxelize_lighter::{
    can_enter as lighter_can_enter, can_enter_into as lighter_can_enter_into,
    flood_light as lighter_flood_light, flood_light_nodes as lighter_flood_light_nodes,
    propagate as lighter_propagate, propagate_nodes as lighter_propagate_nodes,
    remove_light as lighter_remove_light, remove_lights as lighter_remove_lights, LightBounds,
    LightConfig, LightNode as LighterNode, LightRegistry, LightVoxelAccess,
};

pub type LightNode = LighterNode;

#[inline]
fn clamp_usize_to_i32(value: usize) -> i32 {
    value.min(i32::MAX as usize) as i32
}

#[inline]
fn normalized_chunk_size(chunk_size: usize) -> usize {
    chunk_size.max(1)
}

#[inline]
fn clamp_i64_to_usize(value: i64) -> usize {
    if value <= 0 {
        return 0;
    }

    usize::try_from(value).unwrap_or(usize::MAX)
}

#[inline]
pub fn light_config(config: &WorldConfig) -> LightConfig {
    LightConfig {
        chunk_size: clamp_usize_to_i32(normalized_chunk_size(config.chunk_size)),
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
            let chunk_size = i64::from(config.chunk_size.max(1));

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

#[cfg(test)]
mod tests {
    use super::{convert_bounds, light_config, normalized_chunk_size};
    use crate::{Vec3, WorldConfig};

    #[test]
    fn convert_config_normalizes_zero_chunk_size() {
        let world_config = WorldConfig::new().chunk_size(0).build();
        let light_config = light_config(&world_config);
        assert_eq!(light_config.chunk_size, 1);
    }

    #[test]
    fn convert_bounds_uses_normalized_chunk_size_for_shape() {
        let world_config = WorldConfig::new()
            .chunk_size(0)
            .max_height(64)
            .min_chunk([0, 0])
            .max_chunk([0, 0])
            .build();
        let light_config = light_config(&world_config);

        let bounds = convert_bounds(Some(&Vec3(0, 0, 0)), None, &light_config)
            .expect("expected bounds for explicit min and inferred shape");
        assert_eq!(bounds.shape[0], 1);
        assert_eq!(bounds.shape[2], 1);
    }

    #[test]
    fn normalized_chunk_size_guards_zero() {
        assert_eq!(normalized_chunk_size(0), 1);
        assert_eq!(normalized_chunk_size(16), 16);
    }
}

pub struct Lights;

impl Lights {
    pub fn flood_light_with_light_config(
        space: &mut dyn LightVoxelAccess,
        queue: VecDeque<LightNode>,
        color: &LightColor,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        let bounds = convert_bounds(min, shape, light_config);
        lighter_flood_light(space, queue, color, light_config, bounds.as_ref(), light_registry);
    }

    pub fn flood_light_nodes_with_light_config(
        space: &mut dyn LightVoxelAccess,
        nodes: Vec<LightNode>,
        color: &LightColor,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        let bounds = convert_bounds(min, shape, light_config);
        lighter_flood_light_nodes(
            space,
            nodes,
            color,
            light_config,
            bounds.as_ref(),
            light_registry,
        );
    }

    pub fn flood_light_with_light_registry(
        space: &mut dyn LightVoxelAccess,
        queue: VecDeque<LightNode>,
        color: &LightColor,
        light_registry: &LightRegistry,
        config: &WorldConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        let light_config = light_config(config);
        Self::flood_light_with_light_config(
            space,
            queue,
            color,
            light_registry,
            &light_config,
            min,
            shape,
        );
    }

    pub fn flood_light(
        space: &mut dyn LightVoxelAccess,
        queue: VecDeque<LightNode>,
        color: &LightColor,
        registry: &Registry,
        config: &WorldConfig,
        min: Option<&Vec3<i32>>,
        shape: Option<&Vec3<usize>>,
    ) {
        Self::flood_light_with_light_registry(
            space,
            queue,
            color,
            registry.lighter_registry_ref().as_ref(),
            config,
            min,
            shape,
        );
    }

    pub fn remove_light(
        space: &mut dyn LightVoxelAccess,
        voxel: &Vec3<i32>,
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let light_config = light_config(config);
        Self::remove_light_with_light_config(
            space,
            voxel,
            color,
            registry.lighter_registry_ref().as_ref(),
            &light_config,
        );
    }

    pub fn remove_light_with_light_config(
        space: &mut dyn LightVoxelAccess,
        voxel: &Vec3<i32>,
        color: &LightColor,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
    ) {
        lighter_remove_light(
            space,
            [voxel.0, voxel.1, voxel.2],
            color,
            light_config,
            light_registry,
        );
    }

    pub fn remove_lights(
        space: &mut dyn LightVoxelAccess,
        voxels: &[Vec3<i32>],
        color: &LightColor,
        config: &WorldConfig,
        registry: &Registry,
    ) {
        let light_config = light_config(config);
        Self::remove_lights_with_light_config(
            space,
            voxels,
            color,
            registry.lighter_registry_ref().as_ref(),
            &light_config,
        );
    }

    pub fn remove_lights_with_light_config(
        space: &mut dyn LightVoxelAccess,
        voxels: &[Vec3<i32>],
        color: &LightColor,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
    ) {
        lighter_remove_lights(
            space,
            voxels.iter().map(|v| [v.0, v.1, v.2]),
            color,
            light_config,
            light_registry,
        );
    }

    pub fn propagate(
        space: &mut dyn LightVoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        registry: &Registry,
        config: &WorldConfig,
    ) -> [VecDeque<LightNode>; 4] {
        Self::propagate_with_light_registry(
            space,
            min,
            shape,
            registry.lighter_registry_ref().as_ref(),
            config,
        )
    }

    pub fn propagate_with_light_registry(
        space: &mut dyn LightVoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        light_registry: &LightRegistry,
        config: &WorldConfig,
    ) -> [VecDeque<LightNode>; 4] {
        let light_config = light_config(config);
        Self::propagate_with_light_config(space, min, shape, light_registry, &light_config)
    }

    pub fn propagate_with_light_config(
        space: &mut dyn LightVoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
    ) -> [VecDeque<LightNode>; 4] {
        lighter_propagate(
            space,
            [min.0, min.1, min.2],
            [shape.0, shape.1, shape.2],
            light_registry,
            light_config,
        )
    }

    pub fn propagate_nodes_with_light_config(
        space: &mut dyn LightVoxelAccess,
        min: &Vec3<i32>,
        shape: &Vec3<usize>,
        light_registry: &LightRegistry,
        light_config: &LightConfig,
    ) -> [Vec<LightNode>; 4] {
        lighter_propagate_nodes(
            space,
            [min.0, min.1, min.2],
            [shape.0, shape.1, shape.2],
            light_registry,
            light_config,
        )
    }

    pub fn can_enter_into(target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        lighter_can_enter_into(target, dx, dy, dz)
    }

    pub fn can_enter(source: &[bool; 6], target: &[bool; 6], dx: i32, dy: i32, dz: i32) -> bool {
        lighter_can_enter(source, target, dx, dy, dz)
    }
}
