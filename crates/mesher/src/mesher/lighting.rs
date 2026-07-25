use hashbrown::{HashMap, HashSet};
use serde::{Deserialize, Serialize};

use voxelize_core::{
    BlockDynamicPattern, BlockFace, BlockRotation, BlockRule, BlockRuleLogic, CornerData,
    LightColor, LightUtils, VoxelAccess, AABB, UV,
};

use super::*;

pub(super) fn vertex_ao(side1: bool, side2: bool, corner: bool) -> i32 {
    let num_s1 = !side1 as i32;
    let num_s2 = !side2 as i32;
    let num_c = !corner as i32;

    if num_s1 == 1 && num_s2 == 1 {
        0
    } else {
        3 - (num_s1 + num_s2 + num_c)
    }
}

pub(super) fn should_skip_opaque_light_sample(
    dir: [i32; 3],
    ddx: i32,
    ddy: i32,
    ddz: i32,
    is_opaque: bool,
) -> bool {
    if !is_opaque {
        return false;
    }
    let outward = dir[0] * ddx + dir[1] * ddy + dir[2] * ddz;
    outward <= 0
}

pub(super) fn fallback_face_light(neighbors: &NeighborCache, dir: [i32; 3]) -> (u32, u32, u32, u32) {
    neighbors.get_all_lights(dir[0], dir[1], dir[2])
}

pub(super) fn uses_center_voxel_light(block: &Block) -> bool {
    let is_all_transparent = block.is_transparent.iter().all(|&face| face);
    block.is_see_through || (is_all_transparent && block.aabbs.len() <= 1)
}

pub(super) fn should_apply_stair_self_ao(face_dir: [i32; 3], corner_pos: [f32; 3]) -> bool {
    !(face_dir[1] == 1 && corner_pos[1] > 0.75)
}

pub(super) fn self_ao_probe(local_pos: [f32; 3], ox: f32, oy: f32, oz: f32, aabbs: &[AABB]) -> bool {
    let eps: f32 = 0.05;
    let margin: f32 = 0.001;
    let px = local_pos[0] + ox * eps;
    let py = local_pos[1] + oy * eps;
    let pz = local_pos[2] + oz * eps;
    aabbs.iter().any(|aabb| {
        px >= aabb.min_x - margin
            && px <= aabb.max_x + margin
            && py >= aabb.min_y - margin
            && py <= aabb.max_y + margin
            && pz >= aabb.min_z - margin
            && pz <= aabb.max_z + margin
    })
}

pub(super) fn compute_self_ao(
    local_pos: [f32; 3],
    face_dir: [i32; 3],
    face_bbox_min: [f32; 3],
    aabbs: &[AABB],
) -> (bool, bool, bool, bool) {
    let ldx = if face_dir[0] != 0 {
        face_dir[0]
    } else if local_pos[0] <= face_bbox_min[0] + 0.01 {
        -1
    } else {
        1
    };
    let ldy = if face_dir[1] != 0 {
        face_dir[1]
    } else if local_pos[1] <= face_bbox_min[1] + 0.01 {
        -1
    } else {
        1
    };
    let ldz = if face_dir[2] != 0 {
        face_dir[2]
    } else if local_pos[2] <= face_bbox_min[2] + 0.01 {
        -1
    } else {
        1
    };

    let s011 = self_ao_probe(local_pos, 0.0, ldy as f32, ldz as f32, aabbs);
    let s101 = self_ao_probe(local_pos, ldx as f32, 0.0, ldz as f32, aabbs);
    let s110 = self_ao_probe(local_pos, ldx as f32, ldy as f32, 0.0, aabbs);
    let s111 = self_ao_probe(local_pos, ldx as f32, ldy as f32, ldz as f32, aabbs);

    (s011, s101, s110, s111)
}

pub(super) fn compute_face_ao_and_light(
    dir: [i32; 3],
    block: &Block,
    neighbors: &NeighborCache,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let block_aabb = AABB::union_all(&block.aabbs);

    let is_see_through = block.is_see_through;
    let is_all_transparent = block.is_transparent[0]
        && block.is_transparent[1]
        && block.is_transparent[2]
        && block.is_transparent[3]
        && block.is_transparent[4]
        && block.is_transparent[5];

    let corner_positions: [[f32; 3]; 4] = match dir {
        [1, 0, 0] => [
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
        ],
        [-1, 0, 0] => [
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 1.0],
            [0.0, 0.0, 1.0],
        ],
        [0, 1, 0] => [
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
        ],
        [0, -1, 0] => [
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
        ],
        [0, 0, 1] => [
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
        ],
        [0, 0, -1] => [
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
        _ => return ([3, 3, 3, 3], [0, 0, 0, 0]),
    };

    let mut aos = [0i32; 4];
    let mut lights = [0i32; 4];

    for (i, pos) in corner_positions.iter().enumerate() {
        let dx = if pos[0] <= block_aabb.min_x + 0.01 {
            -1
        } else {
            1
        };
        let dy = if pos[1] <= block_aabb.min_y + 0.01 {
            -1
        } else {
            1
        };
        let dz = if pos[2] <= block_aabb.min_z + 0.01 {
            -1
        } else {
            1
        };

        let get_block_opaque = |ox: i32, oy: i32, oz: i32| -> bool {
            let id = neighbors.get_voxel(ox, oy, oz);
            registry
                .get_block_by_id(id)
                .map(|b| b.is_opaque)
                .unwrap_or(false)
        };

        let b011 = !get_block_opaque(0, dy, dz);
        let b101 = !get_block_opaque(dx, 0, dz);
        let b110 = !get_block_opaque(dx, dy, 0);
        let b111 = !get_block_opaque(dx, dy, dz);

        let ao = if is_see_through || is_all_transparent {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let (sunlight, red_light, green_light, blue_light) = if uses_center_voxel_light(block) {
            neighbors.get_all_lights(0, 0, 0)
        } else {
            let mut sum_sunlight = 0;
            let mut sum_red_light = 0;
            let mut sum_green_light = 0;
            let mut sum_blue_light = 0;
            let mut light_count = 0;

            for x in 0..=1 {
                for y in 0..=1 {
                    for z in 0..=1 {
                        let ddx = x * dx;
                        let ddy = y * dy;
                        let ddz = z * dz;

                        let (local_sunlight, local_red_light, local_green_light, local_blue_light) =
                            neighbors.get_all_lights(ddx, ddy, ddz);

                        if local_sunlight == 0
                            && local_red_light == 0
                            && local_green_light == 0
                            && local_blue_light == 0
                        {
                            continue;
                        }

                        let diagonal4_id = neighbors.get_voxel(ddx, ddy, ddz);
                        let diagonal4_opaque = registry
                            .get_block_by_id(diagonal4_id)
                            .map(|b| b.is_opaque)
                            .unwrap_or(false);

                        if should_skip_opaque_light_sample(dir, ddx, ddy, ddz, diagonal4_opaque) {
                            continue;
                        }

                        if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing_id =
                                neighbors.get_voxel(ddx * dir[0], ddy * dir[1], ddz * dir[2]);
                            let facing_opaque = registry
                                .get_block_by_id(facing_id)
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);

                            if facing_opaque {
                                continue;
                            }
                        }

                        if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                            let diagonal_yz_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(0, ddy, ddz))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);
                            let diagonal_xz_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(ddx, 0, ddz))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);
                            let diagonal_xy_opaque = registry
                                .get_block_by_id(neighbors.get_voxel(ddx, ddy, 0))
                                .map(|b| b.is_opaque)
                                .unwrap_or(false);

                            if diagonal_yz_opaque && diagonal_xz_opaque && diagonal_xy_opaque {
                                continue;
                            }

                            if diagonal_xy_opaque && diagonal_xz_opaque {
                                let neighbor_y_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, ddy, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_z_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, 0, ddz))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_y_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(ddx, 0, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_z_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, 0, ddz))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_x_opaque && neighbor_z_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz_opaque && diagonal_yz_opaque {
                                let neighbor_x_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(ddx, 0, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                let neighbor_y_opaque = registry
                                    .get_block_by_id(neighbors.get_voxel(0, ddy, 0))
                                    .map(|b| b.is_opaque)
                                    .unwrap_or(false);
                                if neighbor_x_opaque && neighbor_y_opaque {
                                    continue;
                                }
                            }
                        }

                        sum_sunlight += local_sunlight;
                        sum_red_light += local_red_light;
                        sum_green_light += local_green_light;
                        sum_blue_light += local_blue_light;
                        light_count += 1;
                    }
                }
            }

            if light_count > 0 {
                let light_count_f32 = light_count as f32;
                (
                    (sum_sunlight as f32 / light_count_f32) as u32,
                    (sum_red_light as f32 / light_count_f32) as u32,
                    (sum_green_light as f32 / light_count_f32) as u32,
                    (sum_blue_light as f32 / light_count_f32) as u32,
                )
            } else {
                fallback_face_light(neighbors, dir)
            }
        };

        aos[i] = ao;
        let mut light = 0u32;
        light = LightUtils::insert_red_light(light, red_light);
        light = LightUtils::insert_green_light(light, green_light);
        light = LightUtils::insert_blue_light(light, blue_light);
        light = LightUtils::insert_sunlight(light, sunlight);
        lights[i] = light as i32;
    }

    (aos, lights)
}
