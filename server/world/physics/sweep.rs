use crate::{approx_equals, between, Registry, Vec3, VoxelAccess};

use super::aabb::AABB;

fn line_to_plane(unit: &Vec3<f32>, vector: &[f32; 3], normal: &[f32; 3]) -> f32 {
    let n_dot_u = normal[0] * unit[0] + normal[1] * unit[1] + normal[2] * unit[2];
    if approx_equals(n_dot_u, 0.0) {
        return f32::INFINITY;
    }

    (normal[0] * vector[0] + normal[1] * vector[1] + normal[2] * vector[2]) / n_dot_u
}

#[derive(Debug)]
struct SweepResults {
    h: f32,
    nx: f32,
    ny: f32,
    nz: f32,
}

fn sweep_aabb(target: &AABB, other: &AABB, vector: &Vec3<f32>) -> SweepResults {
    let mx = other.min_x - target.max_x;
    let my = other.min_y - target.max_y;
    let mz = other.min_z - target.max_z;
    let mhx = target.width() + other.width();
    let mhy = target.height() + other.height();
    let mhz = target.depth() + other.depth();

    let &Vec3(dx, dy, dz) = vector;

    let mut h = 1.0;
    let mut nx = 0.0;
    let mut ny = 0.0;
    let mut nz = 0.0;

    // X min
    let s = line_to_plane(vector, &[mx, my, mz], &[-1.0, 0.0, 0.0]);
    if s >= 0.0
        && dx > 0.0
        && s < h
        && between(s * dy, my, my + mhy)
        && between(s * dz, mz, mz + mhz)
    {
        h = s;
        nx = -1.0;
        ny = 0.0;
        nz = 0.0;
    }

    // X max
    let s = line_to_plane(vector, &[mx + mhx, my, mz], &[1.0, 0.0, 0.0]);
    if s >= 0.0
        && dx < 0.0
        && s < h
        && between(s * dy, my, my + mhy)
        && between(s * dz, mz, mz + mhz)
    {
        h = s;
        nx = 1.0;
        ny = 0.0;
        nz = 0.0;
    }

    // Y min
    let s = line_to_plane(vector, &[mx, my, mz], &[0.0, -1.0, 0.0]);
    if s >= 0.0
        && dy > 0.0
        && s < h
        && between(s * dx, mx, mx + mhx)
        && between(s * dz, mz, mz + mhz)
    {
        h = s;
        nx = 0.0;
        ny = -1.0;
        nz = 0.0;
    }

    // Y max
    let s = line_to_plane(vector, &[mx, my + mhy, mz], &[0.0, 1.0, 0.0]);
    if s >= 0.0
        && dy < 0.0
        && s < h
        && between(s * dx, mx, mx + mhx)
        && between(s * dz, mz, mz + mhz)
    {
        h = s;
        nx = 0.0;
        ny = 1.0;
        nz = 0.0;
    }

    // Z min
    let s = line_to_plane(vector, &[mx, my, mz], &[0.0, 0.0, -1.0]);
    if s >= 0.0
        && dz > 0.0
        && s < h
        && between(s * dx, mx, mx + mhx)
        && between(s * dy, my, my + mhy)
    {
        h = s;
        nx = 0.0;
        ny = 0.0;
        nz = -1.0;
    }

    // Z max
    let s = line_to_plane(vector, &[mx, my, mz + mhz], &[0.0, 0.0, 1.0]);
    if s >= 0.0
        && dz < 0.0
        && s < h
        && between(s * dx, mx, mx + mhx)
        && between(s * dy, my, my + mhy)
    {
        h = s;
        nx = 0.0;
        ny = 0.0;
        nz = 1.0;
    }

    SweepResults { h, nx, ny, nz }
}

pub fn sweep(
    space: &dyn VoxelAccess,
    registry: &Registry,
    target: &mut AABB,
    velocity: &Vec3<f32>,
    callback: &mut dyn FnMut(f32, usize, i32, &mut [f32; 3]) -> bool,
    translate: bool,
    max_iterations: usize,
) {
    if max_iterations == 0 {
        return;
    }

    let &Vec3(vx, vy, vz) = velocity;
    let mag = (vx * vx + vy * vy + vz * vz).sqrt();

    // Calculate the broadphase of the target
    let min_x = (if vx > 0.0 {
        target.min_x
    } else {
        target.min_x + vx
    })
    .floor();
    let min_y = (if vy > 0.0 {
        target.min_y
    } else {
        target.min_y + vy
    })
    .floor();
    let min_z = (if vz > 0.0 {
        target.min_z
    } else {
        target.min_z + vz
    })
    .floor();
    let max_x = (if vx > 0.0 {
        target.max_x + vx
    } else {
        target.max_x
    })
    .floor();
    let max_y = (if vy > 0.0 {
        target.max_y + vy
    } else {
        target.max_y
    })
    .floor();
    let max_z = (if vz > 0.0 {
        target.max_z + vz
    } else {
        target.max_z
    })
    .floor();

    let mut closest = SweepResults {
        h: 1.0,
        nx: 0.0,
        ny: 0.0,
        nz: 0.0,
    };

    for vx in (min_x as i32)..=(max_x as i32) {
        for vz in (min_z as i32)..=(max_z as i32) {
            for vy in (min_y as i32)..=(max_y as i32) {
                let id = space.get_voxel(vx, vy, vz);
                let rotation = space.get_voxel_rotation(vx, vy, vz);
                let block = registry.get_block_by_id(id);

                if block.is_fluid || block.is_empty || block.is_passable {
                    continue;
                }

                let aabbs = block.get_aabbs(&Vec3(vx, vy, vz), space, registry);

                if aabbs.is_empty() {
                    continue;
                }

                aabbs.iter().for_each(|aabb| {
                    let mut block_aabb = rotation.rotate_aabb(aabb, true, true);
                    block_aabb.translate(vx as f32, vy as f32, vz as f32);
                    let result = sweep_aabb(target, &block_aabb, &velocity);

                    // Check if this collision is closer than the closest so far
                    if result.h < closest.h {
                        closest = result;
                    }
                })
            }
        }
    }

    // We move the entity slightly away from the block in order to miss seams.
    let epsilon = 1e-4_f32;
    let dx = closest.h * vx + epsilon * closest.nx;
    let dy = closest.h * vy + epsilon * closest.ny;
    let dz = closest.h * vz + epsilon * closest.nz;

    if translate {
        target.translate(dx, dy, dz);
    }

    // No collision
    if approx_equals(closest.h, 1.0) {
        return;
    }

    let axis = if closest.nx != 0.0 {
        0
    } else if closest.ny != 0.0 {
        1
    } else {
        2
    };
    let dir = -(closest.nx + closest.ny + closest.nz) as i32;
    let mut leftover = [
        (1.0 - closest.h) * vx,
        (1.0 - closest.h) * vy,
        (1.0 - closest.h) * vz,
    ];

    if dir != 0 && callback(mag * closest.h, axis, dir, &mut leftover) {
        return;
    }

    // More to go
    if !approx_equals(
        leftover[0] * leftover[0] + leftover[1] * leftover[1] + leftover[2] * leftover[2],
        0.0,
    ) {
        sweep(
            space,
            registry,
            target,
            &Vec3::from(&leftover),
            callback,
            translate,
            max_iterations - 1,
        );
    }
}
