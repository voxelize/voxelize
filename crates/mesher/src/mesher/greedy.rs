use hashbrown::{HashMap, HashSet};

use voxelize_core::{
    BlockFace, BlockRotation, LightUtils, VoxelAccess, UV,
};

use super::*;

pub(super) fn extract_greedy_quads(
    mask: &mut HashMap<(i32, i32), FaceData>,
    min_u: i32,
    max_u: i32,
    min_v: i32,
    max_v: i32,
) -> Vec<GreedyQuad> {
    let mut quads = Vec::new();

    for v in min_v..max_v {
        for u in min_u..max_u {
            if let Some(data) = mask.remove(&(u, v)) {
                let mut width = 1;
                while u + width < max_u {
                    if let Some(neighbor) = mask.get(&(u + width, v)) {
                        if neighbor.key == data.key {
                            mask.remove(&(u + width, v));
                            width += 1;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                let mut height = 1;
                'height: while v + height < max_v {
                    for du in 0..width {
                        if let Some(neighbor) = mask.get(&(u + du, v + height)) {
                            if neighbor.key != data.key {
                                break 'height;
                            }
                        } else {
                            break 'height;
                        }
                    }
                    for du in 0..width {
                        mask.remove(&(u + du, v + height));
                    }
                    height += 1;
                }

                quads.push(GreedyQuad {
                    x: u,
                    y: v,
                    w: width,
                    h: height,
                    data,
                });
            }
        }
    }

    quads
}

pub(super) fn process_greedy_quad(
    quad: &GreedyQuad,
    axis: usize,
    slice: i32,
    dir: [i32; 3],
    min: &[i32; 3],
    block: &Block,
    geometry: &mut GeometryProtocol,
) {
    let [min_x, min_y, min_z] = *min;
    let is_opaque = block.is_opaque;
    let is_fluid = quad.data.is_fluid;

    let UV {
        start_u,
        end_u,
        start_v,
        end_v,
    } = quad.data.uv_range.clone();

    let scale = if is_opaque { 0.0 } else { 0.0001 };

    let u_min = quad.x as f32;
    let u_max = (quad.x + quad.w) as f32;
    let v_min = quad.y as f32;
    let v_max = (quad.y + quad.h) as f32;

    let slice_pos = slice as f32 + if dir[axis] > 0 { 1.0 } else { 0.0 };

    let (corners, uv_corners): ([[f32; 3]; 4], [[f32; 2]; 4]) = match (dir[0], dir[1], dir[2]) {
        (1, 0, 0) => (
            [
                [slice_pos, v_max, u_max],
                [slice_pos, v_min, u_max],
                [slice_pos, v_max, u_min],
                [slice_pos, v_min, u_min],
            ],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (-1, 0, 0) => (
            [
                [slice_pos, v_max, u_min],
                [slice_pos, v_min, u_min],
                [slice_pos, v_max, u_max],
                [slice_pos, v_min, u_max],
            ],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (0, 1, 0) => (
            [
                [u_min, slice_pos, v_max],
                [u_max, slice_pos, v_max],
                [u_min, slice_pos, v_min],
                [u_max, slice_pos, v_min],
            ],
            [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
        ),
        (0, -1, 0) => (
            [
                [u_max, slice_pos, v_max],
                [u_min, slice_pos, v_max],
                [u_max, slice_pos, v_min],
                [u_min, slice_pos, v_min],
            ],
            [[1.0, 0.0], [0.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ),
        (0, 0, 1) => (
            [
                [u_min, v_min, slice_pos],
                [u_max, v_min, slice_pos],
                [u_min, v_max, slice_pos],
                [u_max, v_max, slice_pos],
            ],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
        (0, 0, -1) => (
            [
                [u_max, v_min, slice_pos],
                [u_min, v_min, slice_pos],
                [u_max, v_max, slice_pos],
                [u_min, v_max, slice_pos],
            ],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
        _ => return,
    };

    let ndx = (geometry.positions.len() / 3) as i32;

    for i in 0..4 {
        let pos = corners[i];
        geometry
            .positions
            .push(pos[0] - min_x as f32 - dir[0] as f32 * scale);
        geometry
            .positions
            .push(pos[1] - min_y as f32 - dir[1] as f32 * scale);
        geometry
            .positions
            .push(pos[2] - min_z as f32 - dir[2] as f32 * scale);

        let u = uv_corners[i][0] * (end_u - start_u) + start_u;
        let v = uv_corners[i][1] * (end_v - start_v) + start_v;
        geometry.uvs.push(u);
        geometry.uvs.push(v);

        let ao = quad.data.key.ao[i];
        let light = quad.data.key.light[i];
        let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
        let greedy_bit = 1 << 19;
        let water_exposed_bit = if quad.data.key.is_water_exposed {
            1 << 21
        } else {
            0
        };
        geometry
            .lights
            .push(light | (ao << 16) | fluid_bit | greedy_bit | water_exposed_bit);
    }

    let face_aos = quad.data.key.ao;
    let face_lights = quad.data.key.light;

    let a_rt = LightUtils::extract_red_light(face_lights[0] as u32) as i32;
    let b_rt = LightUtils::extract_red_light(face_lights[1] as u32) as i32;
    let c_rt = LightUtils::extract_red_light(face_lights[2] as u32) as i32;
    let d_rt = LightUtils::extract_red_light(face_lights[3] as u32) as i32;

    let a_gt = LightUtils::extract_green_light(face_lights[0] as u32) as i32;
    let b_gt = LightUtils::extract_green_light(face_lights[1] as u32) as i32;
    let c_gt = LightUtils::extract_green_light(face_lights[2] as u32) as i32;
    let d_gt = LightUtils::extract_green_light(face_lights[3] as u32) as i32;

    let a_bt = LightUtils::extract_blue_light(face_lights[0] as u32) as i32;
    let b_bt = LightUtils::extract_blue_light(face_lights[1] as u32) as i32;
    let c_bt = LightUtils::extract_blue_light(face_lights[2] as u32) as i32;
    let d_bt = LightUtils::extract_blue_light(face_lights[3] as u32) as i32;

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

    if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
        || (ozao_r || ozao_g || ozao_b)
        || (anz_r || anz_g || anz_b)
    {
        geometry.indices.push(ndx);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 3);
        geometry.indices.push(ndx + 3);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx);
    } else {
        geometry.indices.push(ndx);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 2);
        geometry.indices.push(ndx + 1);
        geometry.indices.push(ndx + 3);
    }
}

pub fn mesh_space_greedy<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> Vec<GeometryProtocol> {
    let mut map: HashMap<String, GeometryProtocol> = HashMap::new();
    let mut processed_non_greedy: HashSet<(i32, i32, i32)> = HashSet::new();
    let mut processed_waterlogged: HashSet<(i32, i32, i32)> = HashSet::new();
    let waterlogging_fluid = registry.waterlogging_fluid();

    let [min_x, min_y, min_z] = *min;
    let [max_x, max_y, max_z] = *max;
    let (scan_min, scan_max) = match find_sparse_non_empty_bounds(min, max, space, registry) {
        ScanBounds::Empty => return Vec::new(),
        ScanBounds::Sparse { min, max } => (min, max),
        ScanBounds::Dense => (*min, *max),
    };
    let [scan_min_x, scan_min_y, scan_min_z] = scan_min;
    let [scan_max_x, scan_max_y, scan_max_z] = scan_max;

    let directions: [(i32, i32, i32); 6] = [
        (1, 0, 0),
        (-1, 0, 0),
        (0, 1, 0),
        (0, -1, 0),
        (0, 0, 1),
        (0, 0, -1),
    ];

    let slice_size = (max_x - min_x).max(max_y - min_y).max(max_z - min_z) as usize;
    let mut greedy_mask: HashMap<(i32, i32), FaceData> =
        HashMap::with_capacity(slice_size * slice_size);
    let mut non_greedy_faces: Vec<(
        i32,
        i32,
        i32,
        u32,
        BlockRotation,
        Block,
        BlockFace,
        UV,
        bool,
        bool,
        bool,
    )> = Vec::new();

    for (dx, dy, dz) in directions {
        let dir = [dx, dy, dz];

        let (axis, u_axis, v_axis) = if dx != 0 {
            (0, 2, 1)
        } else if dy != 0 {
            (1, 0, 2)
        } else {
            (2, 0, 1)
        };

        let slice_range = match axis {
            0 => scan_min_x..scan_max_x,
            1 => scan_min_y..scan_max_y,
            _ => scan_min_z..scan_max_z,
        };

        let u_range = match u_axis {
            0 => (scan_min_x, scan_max_x),
            1 => (scan_min_y, scan_max_y),
            _ => (scan_min_z, scan_max_z),
        };

        let v_range = match v_axis {
            0 => (scan_min_x, scan_max_x),
            1 => (scan_min_y, scan_max_y),
            _ => (scan_min_z, scan_max_z),
        };

        for slice in slice_range {
            greedy_mask.clear();
            non_greedy_faces.clear();

            for u in u_range.0..u_range.1 {
                for v in v_range.0..v_range.1 {
                    let (vx, vy, vz) = match (axis, u_axis, v_axis) {
                        (0, 2, 1) => (slice, v, u),
                        (1, 0, 2) => (u, slice, v),
                        (2, 0, 1) => (u, v, slice),
                        _ => continue,
                    };

                    let voxel_id = space.get_voxel(vx, vy, vz);
                    if !registry.has_type(voxel_id) {
                        continue;
                    }

                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = match registry.get_block_by_id(voxel_id) {
                        Some(b) => b,
                        None => continue,
                    };

                    if block.is_empty {
                        continue;
                    }

                    // A waterlogged voxel draws its block *and* the fluid it
                    // holds. Without the fluid pass the surrounding water,
                    // which culls its faces against this voxel, would leave a
                    // block-shaped hole in the tank.
                    if let Some((fluid_id, fluid_block)) = waterlogging_fluid {
                        if space.get_voxel_waterlogged(vx, vy, vz)
                            && has_standard_six_faces(&fluid_block.faces)
                            && processed_waterlogged.insert((vx, vy, vz))
                        {
                            for face in create_fluid_faces(
                                vx,
                                vy,
                                vz,
                                fluid_id,
                                space,
                                &fluid_block.faces,
                                registry,
                            ) {
                                let uv_range = face.range.clone();
                                non_greedy_faces.push((
                                    vx,
                                    vy,
                                    vz,
                                    fluid_id,
                                    BlockRotation::PY(0.0),
                                    fluid_block.clone(),
                                    face,
                                    uv_range,
                                    fluid_block.is_see_through,
                                    true,
                                    false,
                                ));
                            }
                        }
                    }

                    if block.is_opaque {
                        let all_neighbors_opaque = VOXEL_NEIGHBORS.iter().all(|&[nx, ny, nz]| {
                            let id = space.get_voxel(vx + nx, vy + ny, vz + nz);
                            registry
                                .get_block_by_id(id)
                                .map(|b| b.is_opaque)
                                .unwrap_or(false)
                        });
                        if all_neighbors_opaque {
                            continue;
                        }
                    }

                    let is_fluid = block.is_fluid;
                    let is_see_through = block.is_see_through;
                    let is_non_greedy_block = !can_greedy_mesh_block(block, &rotation);

                    if !is_non_greedy_block {
                        let Some(face) = block.faces.iter().find(|face| face.dir == dir) else {
                            continue;
                        };

                        let should_render = should_render_face(
                            vx,
                            vy,
                            vz,
                            voxel_id,
                            dir,
                            block,
                            space,
                            registry,
                            is_see_through,
                            is_fluid,
                        );

                        if !should_render {
                            continue;
                        }

                        let uv_range = face.range.clone();
                        let neighbors = NeighborCache::populate(vx, vy, vz, space);
                        let (aos, lights) =
                            compute_face_ao_and_light(dir, block, &neighbors, registry);
                        let is_water_exposed = space.get_voxel_waterlogged(vx, vy, vz)
                            || space.get_voxel_waterlogged(
                                vx + dir[0],
                                vy + dir[1],
                                vz + dir[2],
                            )
                            || registry
                                .get_block_by_id(space.get_voxel(
                                    vx + dir[0],
                                    vy + dir[1],
                                    vz + dir[2],
                                ))
                                .map(|b| b.is_fluid)
                                .unwrap_or(false);

                        let key = FaceKey {
                            block_id: block.id,
                            face_name: face.name.clone(),
                            independent: face.independent,
                            is_water_exposed,
                            ao: aos,
                            light: lights,
                            uv_start_u: (uv_range.start_u * 1000000.0) as u32,
                            uv_end_u: (uv_range.end_u * 1000000.0) as u32,
                            uv_start_v: (uv_range.start_v * 1000000.0) as u32,
                            uv_end_v: (uv_range.end_v * 1000000.0) as u32,
                        };

                        greedy_mask.insert(
                            (u, v),
                            FaceData {
                                key,
                                uv_range,
                                is_see_through,
                                is_fluid,
                            },
                        );
                        continue;
                    }

                    let faces: Vec<(BlockFace, bool)> =
                        if is_fluid && has_standard_six_faces(&block.faces) {
                            create_fluid_faces(vx, vy, vz, block.id, space, &block.faces, registry)
                                .into_iter()
                                .map(|f| (f, false))
                                .collect()
                        } else if block.dynamic_patterns.is_some() {
                            get_dynamic_faces(block, [vx, vy, vz], space, &rotation)
                        } else {
                            block.faces.iter().cloned().map(|f| (f, false)).collect()
                        };

                    if processed_non_greedy.contains(&(vx, vy, vz)) {
                        continue;
                    }
                    processed_non_greedy.insert((vx, vy, vz));

                    for (face, world_space) in faces.iter() {
                        let uv_range = face.range.clone();
                        non_greedy_faces.push((
                            vx,
                            vy,
                            vz,
                            voxel_id,
                            rotation.clone(),
                            block.clone(),
                            face.clone(),
                            uv_range,
                            is_see_through,
                            is_fluid,
                            *world_space,
                        ));
                    }
                    continue;
                }
            }

            let quads =
                extract_greedy_quads(&mut greedy_mask, u_range.0, u_range.1, v_range.0, v_range.1);

            for quad in quads {
                let block = match registry.get_block_by_id(quad.data.key.block_id) {
                    Some(b) => b,
                    None => continue,
                };
                let geo_key = if quad.data.key.independent {
                    format!(
                        "{}::{}",
                        block.get_name_lower(),
                        quad.data.key.face_name.to_lowercase()
                    )
                } else {
                    block.get_name_lower().to_string()
                };

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut g = GeometryProtocol::default();
                    g.voxel = quad.data.key.block_id;
                    if quad.data.key.independent {
                        g.face_name = Some(quad.data.key.face_name.clone());
                    }
                    g
                });

                process_greedy_quad(&quad, axis, slice, dir, min, block, geometry);
            }

            for (
                vx,
                vy,
                vz,
                voxel_id,
                rotation,
                block,
                face,
                uv_range,
                is_see_through,
                is_fluid,
                world_space,
            ) in non_greedy_faces.drain(..)
            {
                let geo_key = if face.isolated {
                    format!(
                        "{}::{}::{}-{}-{}",
                        block.get_name_lower(),
                        face.get_name_lower(),
                        vx,
                        vy,
                        vz
                    )
                } else if face.independent {
                    format!("{}::{}", block.get_name_lower(), face.get_name_lower())
                } else {
                    block.get_name_lower().to_string()
                };

                let geometry = map.entry(geo_key).or_insert_with(|| {
                    let mut g = GeometryProtocol::default();
                    g.voxel = voxel_id;
                    if face.independent || face.isolated {
                        g.face_name = Some(face.name.clone());
                    }
                    if face.isolated {
                        g.at = Some([vx, vy, vz]);
                    }
                    g
                });

                let mut uv_map = HashMap::new();
                uv_map.insert(face.name.clone(), uv_range);

                let neighbors = NeighborCache::populate(vx, vy, vz, space);
                process_face(
                    vx,
                    vy,
                    vz,
                    voxel_id,
                    &rotation,
                    &face,
                    &block,
                    &uv_map,
                    registry,
                    space,
                    &neighbors,
                    is_see_through,
                    is_fluid,
                    &mut geometry.positions,
                    &mut geometry.indices,
                    &mut geometry.uvs,
                    &mut geometry.lights,
                    min,
                    world_space,
                );
            }
        }
    }

    map.into_iter()
        .map(|(_, geometry)| geometry)
        .filter(|geometry| !geometry.indices.is_empty())
        .collect()
}
