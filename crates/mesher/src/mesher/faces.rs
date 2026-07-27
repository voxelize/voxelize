use hashbrown::HashMap;

use voxelize_core::{
    BlockFace, BlockRotation, BlockRule, BlockRuleLogic, LightUtils, VoxelAccess, AABB, UV,
};

use super::*;

pub(super) fn has_diagonal_faces(block: &Block) -> bool {
    block.faces.iter().any(|f| f.dir == [0, 0, 0])
}

#[inline]
pub(super) fn diagonal_face_offsets(vx: i32, vy: i32, vz: i32) -> (f32, f32) {
    let h = (vx as u32).wrapping_mul(73856093)
        ^ (vy as u32).wrapping_mul(19349663)
        ^ (vz as u32).wrapping_mul(83492791);
    let h = h.wrapping_mul(2654435761);
    let ox = ((h >> 24) & 0xFF) as f32 / 255.0 * 0.04;
    let oz = ((h >> 16) & 0xFF) as f32 / 255.0 * 0.04;
    (ox, oz)
}

#[inline]
pub(super) fn plant_position_jitter(vx: i32, vy: i32, vz: i32) -> (f32, f32) {
    let h = (vx as u32).wrapping_mul(73856093)
        ^ (vy as u32).wrapping_mul(19349663)
        ^ (vz as u32).wrapping_mul(83492791);
    let h = h.wrapping_mul(2654435761);
    let ox = ((h >> 24) & 0xFF) as f32 / 255.0 * 0.2 - 0.1;
    let oz = ((h >> 16) & 0xFF) as f32 / 255.0 * 0.2 - 0.1;
    (ox, oz)
}

pub(super) fn can_greedy_mesh_block(block: &Block, rotation: &BlockRotation) -> bool {
    !block.is_fluid
        && !block.rotatable
        && !block.y_rotatable
        && block.dynamic_patterns.is_none()
        && matches!(rotation, BlockRotation::PY(r) if *r == 0.0)
        && block.is_full_cube()
        && block.faces.iter().all(|face| !face.isolated)
        && !has_diagonal_faces(block)
}

pub(super) fn should_render_face<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    dir: [i32; 3],
    block: &Block,
    space: &S,
    registry: &Registry,
    see_through: bool,
    is_fluid: bool,
) -> bool {
    let nvx = vx + dir[0];
    let nvy = vy + dir[1];
    let nvz = vz + dir[2];

    let neighbor_id = space.get_voxel(nvx, nvy, nvz);
    let n_is_void = !space.contains(nvx, nvy, nvz);

    if !n_is_void && !registry.has_type(neighbor_id) {
        return false;
    }

    let n_block_type = match registry.get_block_by_id(neighbor_id) {
        Some(b) => b,
        None => return n_is_void,
    };

    let is_opaque = block.is_opaque;
    let is_see_through = block.is_see_through;

    if is_fluid && space.get_voxel_waterlogged(nvx, nvy, nvz) {
        return false;
    }

    if is_fluid && n_block_type.occludes_fluid {
        return false;
    }

    (n_is_void || n_block_type.is_empty)
        || (see_through
            && !is_opaque
            && !n_block_type.is_opaque
            && ((is_see_through && neighbor_id == voxel_id && n_block_type.transparent_standalone)
                || (neighbor_id != voxel_id && (is_see_through || n_block_type.is_see_through))
                || ({
                    if is_see_through && !is_opaque && n_block_type.is_opaque {
                        let self_bounding = AABB::union_all(&block.aabbs);
                        let mut n_bounding = AABB::union_all(&n_block_type.aabbs);
                        n_bounding.translate(dir[0] as f32, dir[1] as f32, dir[2] as f32);
                        !(self_bounding.intersects(&n_bounding)
                            || self_bounding.touches(&n_bounding))
                    } else {
                        false
                    }
                })))
        || (!see_through && (!is_opaque || !n_block_type.is_opaque))
        || (is_fluid
            && n_block_type.is_opaque
            && !n_block_type.is_fluid
            && !has_fluid_above(vx, vy, vz, voxel_id, block.is_waterlogging_fluid, space)
            && (!n_block_type.is_full_cube() || dir == [0, 1, 0]))
}

pub(super) fn rotate_offset_y(offset: &mut [f32; 3], rotation: &BlockRotation) {
    let rot = match rotation {
        BlockRotation::PX(rot) => *rot,
        BlockRotation::NX(rot) => *rot,
        BlockRotation::PY(rot) => *rot,
        BlockRotation::NY(rot) => *rot,
        BlockRotation::PZ(rot) => *rot,
        BlockRotation::NZ(rot) => *rot,
    };

    if rot.abs() > f32::EPSILON {
        let cos_rot = rot.cos();
        let sin_rot = rot.sin();
        let x = offset[0];
        let z = offset[2];
        offset[0] = x * cos_rot - z * sin_rot;
        offset[2] = x * sin_rot + z * cos_rot;
    }
}

pub(super) fn evaluate_block_rule<S: VoxelAccess>(
    rule: &BlockRule,
    pos: [i32; 3],
    space: &S,
    rotation: &BlockRotation,
    y_rotatable: bool,
    world_space: bool,
) -> bool {
    match rule {
        BlockRule::None => true,
        BlockRule::Simple(simple) => {
            let mut offset = [
                simple.offset[0] as f32,
                simple.offset[1] as f32,
                simple.offset[2] as f32,
            ];

            if y_rotatable && !world_space {
                rotate_offset_y(&mut offset, rotation);
            }

            let check_pos = [
                pos[0] + offset[0].round() as i32,
                pos[1] + offset[1].round() as i32,
                pos[2] + offset[2].round() as i32,
            ];

            let mut rule_ok = true;
            let actual_id = space.get_voxel(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_id) = simple.id {
                if actual_id != expected_id {
                    rule_ok = false;
                }
            }

            let actual_rotation =
                space.get_voxel_rotation(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_rotation) = &simple.rotation {
                if actual_rotation != *expected_rotation {
                    rule_ok = false;
                }
            }

            let actual_stage = space.get_voxel_stage(check_pos[0], check_pos[1], check_pos[2]);
            if let Some(expected_stage) = simple.stage {
                if actual_stage != expected_stage {
                    rule_ok = false;
                }
            }

            rule_ok
        }
        BlockRule::Combination { logic, rules } => match logic {
            BlockRuleLogic::And => rules
                .iter()
                .all(|r| evaluate_block_rule(r, pos, space, rotation, y_rotatable, world_space)),
            BlockRuleLogic::Or => rules
                .iter()
                .any(|r| evaluate_block_rule(r, pos, space, rotation, y_rotatable, world_space)),
            BlockRuleLogic::Not => {
                if let Some(first) = rules.first() {
                    !evaluate_block_rule(first, pos, space, rotation, y_rotatable, world_space)
                } else {
                    true
                }
            }
        },
    }
}

pub(super) fn get_dynamic_faces<S: VoxelAccess>(
    block: &Block,
    pos: [i32; 3],
    space: &S,
    rotation: &BlockRotation,
) -> Vec<(BlockFace, bool)> {
    if let Some(dynamic_patterns) = &block.dynamic_patterns {
        for pattern in dynamic_patterns {
            let mut matched_faces: Vec<(BlockFace, bool)> = Vec::new();
            let mut any_matched = false;

            for part in &pattern.parts {
                let rule_result = evaluate_block_rule(
                    &part.rule,
                    pos,
                    space,
                    rotation,
                    block.y_rotatable,
                    part.world_space,
                );
                if rule_result {
                    any_matched = true;
                    matched_faces.extend(part.faces.iter().cloned().map(|f| (f, part.world_space)));
                }
            }

            if any_matched {
                return matched_faces;
            }
        }
    }

    block.faces.iter().cloned().map(|f| (f, false)).collect()
}

/// Where this voxel sits in the vertical run of blocks sharing its stack
/// group, as `(index from the bottom, length of the run)`.
///
/// The walk is bounded by the width of the packed field, so a run taller than
/// the field can hold reports a truncated window rather than scanning a
/// column of unbounded height.
fn stack_position<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    group: u16,
    registry: &Registry,
    space: &S,
) -> (u32, u32) {
    let shares_group = |y: i32| {
        registry
            .get_block_by_id(space.get_voxel(vx, y, vz))
            .map(|b| b.stack_group == group)
            .unwrap_or(false)
    };

    let mut below = 0u32;
    while below + 1 < STACK_MAX && shares_group(vy - below as i32 - 1) {
        below += 1;
    }

    let mut above = 0u32;
    while below + above + 1 < STACK_MAX && shares_group(vy + above as i32 + 1) {
        above += 1;
    }

    (below, below + above + 1)
}

pub(super) fn process_face<S: VoxelAccess>(
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    rotation: &BlockRotation,
    face: &BlockFace,
    block: &Block,
    uv_map: &HashMap<String, UV>,
    registry: &Registry,
    space: &S,
    neighbors: &NeighborCache,
    see_through: bool,
    is_fluid: bool,
    positions: &mut Vec<f32>,
    indices: &mut Vec<i32>,
    uvs: &mut Vec<f32>,
    lights: &mut Vec<i32>,
    min: &[i32; 3],
    world_space: bool,
) {
    let [min_x, min_y, min_z] = *min;

    let stack_bits = if block.stack_group == 0 {
        0
    } else {
        let (index, count) =
            stack_position(vx, vy, vz, block.stack_group, registry, space);
        with_stack(0, index, count)
    };

    let is_opaque = block.is_opaque;
    let is_see_through = block.is_see_through;
    let rotatable = block.rotatable;
    let y_rotatable = block.y_rotatable;

    let mut dir = [face.dir[0] as f32, face.dir[1] as f32, face.dir[2] as f32];
    if (rotatable || y_rotatable) && !world_space {
        rotation.rotate_node(&mut dir, y_rotatable, false);
    }

    let dir = [
        dir[0].round() as i32,
        dir[1].round() as i32,
        dir[2].round() as i32,
    ];

    let nvx = vx + dir[0];
    let nvy = vy + dir[1];
    let nvz = vz + dir[2];

    let neighbor_id = space.get_voxel(nvx, nvy, nvz);
    let n_is_void = !space.contains(nvx, nvy, nvz);

    if !n_is_void && !registry.has_type(neighbor_id) {
        return;
    }

    let n_block_type = match registry.get_block_by_id(neighbor_id) {
        Some(b) => b,
        None => return,
    };

    if is_fluid && space.get_voxel_waterlogged(nvx, nvy, nvz) {
        return;
    }

    if is_fluid && n_block_type.occludes_fluid {
        return;
    }

    let n_is_empty = n_is_void || n_block_type.is_empty;

    let should_mesh = n_is_empty
        || (see_through
            && !is_opaque
            && !n_block_type.is_opaque
            && ((is_see_through
                && neighbor_id == voxel_id
                && n_block_type.transparent_standalone)
                || (neighbor_id != voxel_id && (is_see_through || n_block_type.is_see_through))
                || ({
                    if is_see_through && !is_opaque && n_block_type.is_opaque {
                        let self_bounding = AABB::union_all(&block.aabbs);
                        let mut n_bounding = AABB::union_all(&n_block_type.aabbs);
                        n_bounding.translate(dir[0] as f32, dir[1] as f32, dir[2] as f32);
                        !(self_bounding.intersects(&n_bounding)
                            || self_bounding.touches(&n_bounding))
                    } else {
                        false
                    }
                })))
        || (!see_through && (!is_opaque || !n_block_type.is_opaque))
        || (is_fluid
            && n_block_type.is_opaque
            && !n_block_type.is_fluid
            && !has_fluid_above(vx, vy, vz, voxel_id, block.is_waterlogging_fluid, space)
            && (!n_block_type.is_full_cube() || dir == [0, 1, 0]));

    if !should_mesh {
        return;
    }

    // A face is water-exposed when water sits on either side of it: the
    // neighbour is fluid, this voxel is waterlogged, or the neighbour is. The
    // last case is what keeps the wall behind a submerged block reading as
    // underwater instead of as a dry patch cut out of the tank.
    let is_water_exposed = n_block_type.is_fluid
        || space.get_voxel_waterlogged(vx, vy, vz)
        || space.get_voxel_waterlogged(nvx, nvy, nvz);

    let UV {
        start_u,
        end_u,
        start_v,
        end_v,
    } = uv_map.get(&face.name).cloned().unwrap_or_default();

    let ndx = (positions.len() / 3) as i32;
    let mut face_aos = [0; 4];
    let mut four_red_lights = [0; 4];
    let mut four_green_lights = [0; 4];
    let mut four_blue_lights = [0; 4];

    let block_aabb = AABB::union_all(&block.aabbs);

    let has_multi_aabb = block.aabbs.len() > 1;
    let mut face_bbox_min = [f32::MAX; 3];
    let mut face_bbox_max = [f32::MIN; 3];
    if has_multi_aabb {
        for c in face.corners.iter() {
            for a in 0..3 {
                face_bbox_min[a] = face_bbox_min[a].min(c.pos[a]);
                face_bbox_max[a] = face_bbox_max[a].max(c.pos[a]);
            }
        }
    }

    let is_diagonal = dir == [0, 0, 0];
    let has_diagonals = is_see_through && has_diagonal_faces(block);
    let (hash_ox, _hash_oz) = if has_diagonals {
        diagonal_face_offsets(vx, vy, vz)
    } else {
        (0.0, 0.0)
    };
    let (diag_x_offset, diag_z_offset) = if is_diagonal && block.is_plant {
        plant_position_jitter(vx, vy, vz)
    } else {
        (0.0, 0.0)
    };
    let face_inset = if is_opaque {
        0.0
    } else if has_diagonals && !is_diagonal {
        0.0001 + hash_ox
    } else {
        0.0001
    };

    for (corner_idx, corner) in face.corners.iter().enumerate() {
        let mut pos = corner.pos;

        if (rotatable || y_rotatable) && !world_space {
            rotation.rotate_node(&mut pos, y_rotatable, true);
        }

        let pos_x = pos[0] + vx as f32;
        let pos_y = pos[1] + vy as f32;
        let pos_z = pos[2] + vz as f32;

        positions.push(pos_x - min_x as f32 - dir[0] as f32 * face_inset + diag_x_offset);
        positions.push(pos_y - min_y as f32 - dir[1] as f32 * face_inset);
        positions.push(pos_z - min_z as f32 - dir[2] as f32 * face_inset + diag_z_offset);

        uvs.push(corner.uv[0] * (end_u - start_u) + start_u);
        uvs.push(corner.uv[1] * (end_v - start_v) + start_v);

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

        let get_block_occluder = |ox: i32, oy: i32, oz: i32| -> bool {
            let id = neighbors.get_voxel(ox, oy, oz);
            registry
                .get_block_by_id(id)
                .map(|b| b.is_opaque)
                .unwrap_or(false)
        };

        let mut b011 = !get_block_occluder(0, dy, dz);
        let mut b101 = !get_block_occluder(dx, 0, dz);
        let mut b110 = !get_block_occluder(dx, dy, 0);
        let mut b111 = !get_block_occluder(dx, dy, dz);

        if has_multi_aabb && !is_see_through && should_apply_stair_self_ao(face.dir, corner.pos) {
            let (s011, s101, s110, s111) =
                compute_self_ao(corner.pos, face.dir, face_bbox_min, &block.aabbs);
            if s011 {
                b011 = false;
            }
            if s101 {
                b101 = false;
            }
            if s110 {
                b110 = false;
            }
            if s111 {
                b111 = false;
            }
        }

        let mut ao = if is_see_through {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        if has_multi_aabb && !is_see_through && ao < 2 {
            ao = 2;
        }

        let sunlight;
        let red_light;
        let green_light;
        let blue_light;

        if uses_center_voxel_light(block) {
            let (s, r, g, b) = neighbors.get_all_lights(0, 0, 0);
            sunlight = s;
            red_light = r;
            green_light = g;
            blue_light = b;
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
                sunlight = (sum_sunlight as f32 / light_count_f32) as u32;
                red_light = (sum_red_light as f32 / light_count_f32) as u32;
                green_light = (sum_green_light as f32 / light_count_f32) as u32;
                blue_light = (sum_blue_light as f32 / light_count_f32) as u32;
            } else {
                let fallback = fallback_face_light(neighbors, dir);
                sunlight = fallback.0;
                red_light = fallback.1;
                green_light = fallback.2;
                blue_light = fallback.3;
            }
        }

        let mut light = 0u32;
        light = LightUtils::insert_red_light(light, red_light);
        light = LightUtils::insert_green_light(light, green_light);
        light = LightUtils::insert_blue_light(light, blue_light);
        light = LightUtils::insert_sunlight(light, sunlight);
        let fluid_bit = if is_fluid { FLUID_BIT } else { 0 };
        let fluid_surface_above = is_fluid
            && has_fluid_above(vx, vy, vz, voxel_id, block.is_waterlogging_fluid, space);
        let wave_bit = if is_fluid && dy == 1 && !fluid_surface_above {
            WAVE_BIT
        } else {
            0
        };
        let water_exposed_bit = if is_water_exposed { WATER_EXPOSED_BIT } else { 0 };
        lights.push(
            light as i32
                | ao << AO_SHIFT
                | fluid_bit
                | wave_bit
                | water_exposed_bit
                | stack_bits,
        );

        four_red_lights[corner_idx] = red_light;
        four_green_lights[corner_idx] = green_light;
        four_blue_lights[corner_idx] = blue_light;
        face_aos[corner_idx] = ao;
    }

    let a_rt = four_red_lights[0];
    let b_rt = four_red_lights[1];
    let c_rt = four_red_lights[2];
    let d_rt = four_red_lights[3];

    let a_gt = four_green_lights[0];
    let b_gt = four_green_lights[1];
    let c_gt = four_green_lights[2];
    let d_gt = four_green_lights[3];

    let a_bt = four_blue_lights[0];
    let b_bt = four_blue_lights[1];
    let c_bt = four_blue_lights[2];
    let d_bt = four_blue_lights[3];

    let threshold = 0;

    let one_tr0 = a_rt <= threshold || b_rt <= threshold || c_rt <= threshold || d_rt <= threshold;
    let one_tg0 = a_gt <= threshold || b_gt <= threshold || c_gt <= threshold || d_gt <= threshold;
    let one_tb0 = a_bt <= threshold || b_bt <= threshold || c_bt <= threshold || d_bt <= threshold;

    let fequals = (face_aos[0] + face_aos[3]) == (face_aos[1] + face_aos[2]);
    let ozao_r = a_rt + d_rt < b_rt + c_rt && fequals;
    let ozao_g = a_gt + d_gt < b_gt + c_gt && fequals;
    let ozao_b = a_bt + d_bt < b_bt + c_bt && fequals;

    let anzp1_r = (b_rt as f32 > (a_rt + d_rt) as f32 / 2.0
        && (a_rt + d_rt) as f32 / 2.0 > c_rt as f32)
        || (c_rt as f32 > (a_rt + d_rt) as f32 / 2.0 && (a_rt + d_rt) as f32 / 2.0 > b_rt as f32);
    let anzp1_g = (b_gt as f32 > (a_gt + d_gt) as f32 / 2.0
        && (a_gt + d_gt) as f32 / 2.0 > c_gt as f32)
        || (c_gt as f32 > (a_gt + d_gt) as f32 / 2.0 && (a_gt + d_gt) as f32 / 2.0 > b_gt as f32);
    let anzp1_b = (b_bt as f32 > (a_bt + d_bt) as f32 / 2.0
        && (a_bt + d_bt) as f32 / 2.0 > c_bt as f32)
        || (c_bt as f32 > (a_bt + d_bt) as f32 / 2.0 && (a_bt + d_bt) as f32 / 2.0 > b_bt as f32);

    let anz_r = one_tr0 && anzp1_r;
    let anz_g = one_tg0 && anzp1_g;
    let anz_b = one_tb0 && anzp1_b;

    indices.push(ndx);
    indices.push(ndx + 1);

    if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
        || (ozao_r || ozao_g || ozao_b)
        || (anz_r || anz_g || anz_b)
    {
        indices.push(ndx + 3);
        indices.push(ndx + 3);
        indices.push(ndx + 2);
        indices.push(ndx);
    } else {
        indices.push(ndx + 2);
        indices.push(ndx + 2);
        indices.push(ndx + 1);
        indices.push(ndx + 3);
    }
}
