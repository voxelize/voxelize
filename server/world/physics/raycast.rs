#![allow(dead_code)]

// HELP FROM https://github.com/andyhall/fast-voxel-raycast/blob/master/index.js

use std::cell::Cell;

use crate::{approx_equals, Registry, Vec3, VoxelAccess, AABB};

pub type GetVoxel<'a> = &'a dyn Fn(i32, i32, i32) -> bool;

#[allow(clippy::too_many_arguments)]
fn trace_ray(
    get_voxel: GetVoxel,
    px: f32,
    py: f32,
    pz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    max_d: f32,
    hit_pos: &mut Vec3<f32>,
    hit_norm: &mut Vec3<i32>,
) -> bool {
    let mut t = 0.0;

    let mut ix = px.floor() as i32;
    let mut iy = py.floor() as i32;
    let mut iz = pz.floor() as i32;

    let step_x = if dx > 0.0 { 1 } else { -1 };
    let step_y = if dy > 0.0 { 1 } else { -1 };
    let step_z = if dz > 0.0 { 1 } else { -1 };

    let tx_delta = (1.0 / dx).abs();
    let ty_delta = (1.0 / dy).abs();
    let tz_delta = (1.0 / dz).abs();

    let x_dist = if step_x > 0 {
        ix as f32 + 1.0 - px
    } else {
        px - ix as f32
    };
    let y_dist = if step_y > 0 {
        iy as f32 + 1.0 - py
    } else {
        py - iy as f32
    };
    let z_dist = if step_z > 0 {
        iz as f32 + 1.0 - pz
    } else {
        pz - iz as f32
    };

    let mut tx_max = if tx_delta < f32::MAX {
        tx_delta * x_dist
    } else {
        f32::MAX
    };
    let mut ty_max = if ty_delta < f32::MAX {
        ty_delta * y_dist
    } else {
        f32::MAX
    };
    let mut tz_max = if tz_delta < f32::MAX {
        tz_delta * z_dist
    } else {
        f32::MAX
    };

    let mut stepped_index = -1;

    #[allow(clippy::while_immutable_condition, clippy::collapsible_else_if)]
    while t <= max_d {
        // exit check
        let v = get_voxel(ix, iy, iz);
        if v {
            hit_pos.0 = px + t as f32 * dx;
            hit_pos.1 = py + t as f32 * dy;
            hit_pos.2 = pz + t as f32 * dz;

            hit_norm.0 = 0;
            hit_norm.1 = 0;
            hit_norm.2 = 0;

            if stepped_index == 0 {
                hit_norm.0 = -step_x;
            } else if stepped_index == 1 {
                hit_norm.1 = -step_y;
            } else if stepped_index == 2 {
                hit_norm.2 = -step_z;
            }

            return v;
        }

        if tx_max < ty_max {
            if tx_max < tz_max {
                ix += step_x;
                t = tx_max;
                tx_max += tx_delta;
                stepped_index = 0;
            } else {
                iz += step_z;
                t = tz_max;
                tz_max += tz_delta;
                stepped_index = 2;
            }
        } else {
            if ty_max < tz_max {
                iy += step_y;
                t = ty_max;
                ty_max += ty_delta;
                stepped_index = 1;
            } else {
                iz += step_z;
                t = tz_max;
                tz_max += tz_delta;
                stepped_index = 2;
            }
        }
    }

    // no voxel hit found
    hit_pos.0 = px + t * dx;
    hit_pos.1 = py + t * dy;
    hit_pos.2 = pz + t * dz;

    hit_norm.0 = 0;
    hit_norm.1 = 0;
    hit_norm.2 = 0;

    false
}

pub fn trace(
    max_d: f32,
    get_voxel: GetVoxel,
    origin: &mut Vec3<f32>,
    direction: &mut Vec3<f32>,
    hit_pos: &mut Vec3<f32>,
    hit_norm: &mut Vec3<i32>,
) -> bool {
    let Vec3(px, py, pz) = origin;
    let Vec3(dx, dy, dz) = direction;
    let ds = (*dx * *dx + *dy * *dy + *dz * *dz).sqrt();

    if approx_equals(ds, 0.0) {
        // ?should return an error?
        panic!("Can't raycast along a zero vector");
    }

    *dx /= ds;
    *dy /= ds;
    *dz /= ds;

    trace_ray(
        get_voxel, *px, *py, *pz, *dx, *dy, *dz, max_d, hit_pos, hit_norm,
    )
}

/// Distance along `direction` to the first face of anything a swept body
/// collides with, or `None` when `max_d` of open space lies ahead. The cell
/// filter is [`sweep`](super::sweep::sweep)'s own — fluid, empty, and
/// passable blocks never collide — and inside a surviving cell the ray is
/// tested against the block's actual rotated AABBs. Cell flags alone cannot
/// answer this question: the water beside a waterlogged wave-maker housing
/// or between coral pillar columns is open to a body while the furniture
/// itself is not, and both truths live in one cell. Panics on a zero
/// direction, like [`trace`].
pub fn trace_solids(
    space: &dyn VoxelAccess,
    registry: &Registry,
    origin: &Vec3<f32>,
    direction: &Vec3<f32>,
    max_d: f32,
) -> Option<f32> {
    let Vec3(dx, dy, dz) = direction;
    let ds = (dx * dx + dy * dy + dz * dz).sqrt();

    if approx_equals(ds, 0.0) {
        panic!("Can't raycast along a zero vector");
    }

    let unit = Vec3(dx / ds, dy / ds, dz / ds);

    // Written by the cell test, read after the walk: per-cell AABB entry
    // distances travel out of the `Fn` callback through interior
    // mutability. Boxes stay inside their own cell, so the first cell that
    // reports a hit holds the globally nearest one.
    let nearest_t = Cell::new(f32::MAX);

    let test_cell = |vx: i32, vy: i32, vz: i32| -> bool {
        let block = registry.get_block_by_id(space.get_voxel(vx, vy, vz));
        if block.is_fluid || block.is_empty || block.is_passable {
            return false;
        }

        let aabbs = block.get_aabbs(&Vec3(vx, vy, vz), space, registry);
        if aabbs.is_empty() {
            return false;
        }

        let rotation = space.get_voxel_rotation(vx, vy, vz);
        let mut cell_nearest = f32::MAX;
        for aabb in &aabbs {
            let mut solid = rotation.rotate_aabb(aabb, true, true);
            solid.translate(vx as f32, vy as f32, vz as f32);
            if let Some(t) = ray_box_entry(origin, &unit, &solid, max_d) {
                cell_nearest = cell_nearest.min(t);
            }
        }

        if cell_nearest == f32::MAX {
            return false;
        }
        nearest_t.set(cell_nearest);
        true
    };

    let mut trace_origin = origin.clone();
    let mut trace_direction = unit.clone();
    let mut hit_pos = Vec3(0.0, 0.0, 0.0);
    let mut hit_norm = Vec3(0, 0, 0);

    trace(
        max_d,
        &test_cell,
        &mut trace_origin,
        &mut trace_direction,
        &mut hit_pos,
        &mut hit_norm,
    )
    .then(|| nearest_t.get())
}

/// Entry distance of a unit-direction ray into a box within `[0, max_d]`,
/// `0.0` when the origin already sits inside. `None` when the ray misses
/// within the reach.
fn ray_box_entry(origin: &Vec3<f32>, unit: &Vec3<f32>, solid: &AABB, max_d: f32) -> Option<f32> {
    let mut t_enter = 0.0_f32;
    let mut t_exit = max_d;

    for (o, d, min, max) in [
        (origin.0, unit.0, solid.min_x, solid.max_x),
        (origin.1, unit.1, solid.min_y, solid.max_y),
        (origin.2, unit.2, solid.min_z, solid.max_z),
    ] {
        if d == 0.0 {
            if o < min || o > max {
                return None;
            }
            continue;
        }

        let (t0, t1) = ((min - o) / d, (max - o) / d);
        let (near, far) = if t0 <= t1 { (t0, t1) } else { (t1, t0) };
        t_enter = t_enter.max(near);
        t_exit = t_exit.min(far);
        if t_enter > t_exit {
            return None;
        }
    }

    Some(t_enter)
}

#[cfg(test)]
mod trace_solids_tests {
    use super::*;
    use crate::{Block, Chunk, ChunkOptions, Registry};

    // One full cube at (12, 12, 8), one sub-voxel column filling only the
    // low-x/low-z corner of (8, 12, 8), and passable decor at (4, 12, 8).
    fn decorated_chunk() -> (Chunk, Registry) {
        let mut registry = Registry::new();
        registry.register_block(&Block::new("Stone").id(5).build());
        registry.register_block(
            &Block::new("Column")
                .id(6)
                .aabbs(&[AABB::new()
                    .scale_x(0.3)
                    .scale_z(0.3)
                    .offset_x(0.1)
                    .offset_z(0.1)
                    .build()])
                .build(),
        );
        registry.register_block(&Block::new("Weed").id(7).is_passable(true).build());
        let opts = ChunkOptions {
            size: 16,
            max_height: 64,
            sub_chunks: 4,
        };
        let mut chunk = Chunk::new("trace-solids", 0, 0, &opts);
        chunk.set_voxel(12, 12, 8, 5);
        chunk.set_voxel(8, 12, 8, 6);
        chunk.set_voxel(4, 12, 8, 7);
        (chunk, registry)
    }

    #[test]
    fn full_cube_stops_the_ray_at_its_face() {
        let (chunk, registry) = decorated_chunk();
        let hit = trace_solids(
            &chunk,
            &registry,
            &Vec3(10.5, 12.5, 8.5),
            &Vec3(1.0, 0.0, 0.0),
            5.0,
        );
        assert!(
            hit.is_some_and(|t| (t - 1.5).abs() < 1e-4),
            "face at x=12 sits 1.5 from origin, hit={hit:?}"
        );
    }

    #[test]
    fn ray_through_the_open_side_of_a_furniture_cell_passes() {
        let (chunk, registry) = decorated_chunk();
        // The column spans x 8.1..8.4, z 8.1..8.4; z=8.7 crosses the cell
        // through its open half.
        let hit = trace_solids(
            &chunk,
            &registry,
            &Vec3(10.5, 12.5, 8.7),
            &Vec3(-1.0, 0.0, 0.0),
            4.0,
        );
        assert_eq!(hit, None, "the water beside the column is open");
    }

    #[test]
    fn ray_into_the_furniture_itself_stops_at_its_face() {
        let (chunk, registry) = decorated_chunk();
        let hit = trace_solids(
            &chunk,
            &registry,
            &Vec3(10.5, 12.5, 8.25),
            &Vec3(-1.0, 0.0, 0.0),
            4.0,
        );
        assert!(
            hit.is_some_and(|t| (t - 2.1).abs() < 1e-4),
            "column face at x=8.4 sits 2.1 from origin, hit={hit:?}"
        );
    }

    #[test]
    fn origin_inside_furniture_reports_an_immediate_hit() {
        let (chunk, registry) = decorated_chunk();
        let hit = trace_solids(
            &chunk,
            &registry,
            &Vec3(8.25, 12.5, 8.25),
            &Vec3(1.0, 0.0, 0.0),
            4.0,
        );
        assert_eq!(hit, Some(0.0), "a body inside a solid is blocked now");
    }

    #[test]
    fn passable_decor_never_blocks() {
        let (chunk, registry) = decorated_chunk();
        let hit = trace_solids(
            &chunk,
            &registry,
            &Vec3(6.5, 12.5, 8.5),
            &Vec3(-1.0, 0.0, 0.0),
            4.0,
        );
        assert_eq!(hit, None, "passable blocks are not collision geometry");
    }
}
