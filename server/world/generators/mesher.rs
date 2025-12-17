use std::{collections::VecDeque, sync::Arc};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    world::generators::lights::VOXEL_NEIGHBORS, Block, BlockFace, BlockRotation, Chunk, CornerData,
    GeometryProtocol, LightColor, LightUtils, MeshProtocol, MessageType, Neighbors, Registry,
    Space, Vec2, Vec3, VoxelAccess, WorldConfig, AABB, UV,
};

use super::lights::Lights;

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
struct FaceKey {
    block_id: u32,
    face_name: String,
    independent: bool,
    ao: [i32; 4],
    light: [i32; 4],
    uv_start_u: u32,
    uv_end_u: u32,
    uv_start_v: u32,
    uv_end_v: u32,
}

#[derive(Clone, Debug)]
struct FaceData {
    key: FaceKey,
    uv_range: UV,
    is_see_through: bool,
    is_fluid: bool,
}

#[derive(Clone, Debug)]
struct GreedyQuad {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    data: FaceData,
}

fn vertex_ao(side1: bool, side2: bool, corner: bool) -> i32 {
    let num_s1 = !side1 as i32;
    let num_s2 = !side2 as i32;
    let num_c = !corner as i32;

    if num_s1 == 1 && num_s2 == 1 {
        0
    } else {
        3 - (num_s1 + num_s2 + num_c)
    }
}

fn get_block_by_voxel<'a>(
    ox: i32,
    oy: i32,
    oz: i32,
    neighbors: &Neighbors,
    registry: &'a Registry,
) -> &'a Block {
    let voxel_id = neighbors.get_voxel(&Vec3(ox, oy, oz));
    if registry.has_type(voxel_id) {
        registry.get_block_by_id(voxel_id)
    } else {
        // Return air block for unknown block IDs
        registry.get_block_by_id(0)
    }
}

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;

const FLUID_BASE_HEIGHT: f32 = 0.875;
const FLUID_STAGE_DROPOFF: f32 = 0.1;

fn get_fluid_effective_height(stage: u32) -> f32 {
    (FLUID_BASE_HEIGHT - (stage as f32 * FLUID_STAGE_DROPOFF)).max(0.1)
}

fn has_fluid_above(vx: i32, vy: i32, vz: i32, fluid_id: u32, space: &dyn VoxelAccess) -> bool {
    space.get_voxel(vx, vy + 1, vz) == fluid_id
}

fn get_fluid_height_at(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &dyn VoxelAccess,
) -> Option<f32> {
    if space.get_voxel(vx, vy, vz) == fluid_id {
        let stage = space.get_voxel_stage(vx, vy, vz);
        Some(get_fluid_effective_height(stage))
    } else {
        None
    }
}

fn calculate_fluid_corner_height(
    vx: i32,
    vy: i32,
    vz: i32,
    corner_x: i32,
    corner_z: i32,
    corner_offsets: &[[i32; 2]; 3],
    fluid_id: u32,
    space: &dyn VoxelAccess,
    registry: &Registry,
) -> f32 {
    let upper_check_offsets: [[i32; 2]; 4] = [
        [corner_x - 1, corner_z - 1],
        [corner_x - 1, corner_z],
        [corner_x, corner_z - 1],
        [corner_x, corner_z],
    ];

    for [dx, dz] in upper_check_offsets {
        if space.get_voxel(vx + dx, vy + 1, vz + dz) == fluid_id {
            return 1.0;
        }
    }

    let self_stage = space.get_voxel_stage(vx, vy, vz);
    let self_height = get_fluid_effective_height(self_stage);

    let mut total_height = self_height;
    let mut count = 1.0;
    let mut has_air_neighbor = false;

    for [dx, dz] in corner_offsets {
        let nx = vx + dx;
        let nz = vz + dz;

        if has_fluid_above(nx, vy, nz, fluid_id, space) {
            total_height += 1.0;
            count += 1.0;
        } else if let Some(h) = get_fluid_height_at(nx, vy, nz, fluid_id, space) {
            total_height += h;
            count += 1.0;
        } else {
            let neighbor_id = space.get_voxel(nx, vy, nz);
            if registry.has_type(neighbor_id) {
                let neighbor_block = registry.get_block_by_id(neighbor_id);
                if neighbor_block.is_empty {
                    has_air_neighbor = true;
                }
            }
        }
    }

    if count == 1.0 && has_air_neighbor {
        return 0.1;
    }
    total_height / count
}

fn create_fluid_faces(
    vx: i32,
    vy: i32,
    vz: i32,
    fluid_id: u32,
    space: &dyn VoxelAccess,
    original_faces: &[BlockFace],
    registry: &Registry,
) -> (Vec<BlockFace>, AABB) {
    let corner_nxnz: [[i32; 2]; 3] = [[-1, 0], [0, -1], [-1, -1]];
    let corner_pxnz: [[i32; 2]; 3] = [[1, 0], [0, -1], [1, -1]];
    let corner_nxpz: [[i32; 2]; 3] = [[-1, 0], [0, 1], [-1, 1]];
    let corner_pxpz: [[i32; 2]; 3] = [[1, 0], [0, 1], [1, 1]];

    let h_nxnz =
        calculate_fluid_corner_height(vx, vy, vz, 0, 0, &corner_nxnz, fluid_id, space, registry);
    let h_pxnz =
        calculate_fluid_corner_height(vx, vy, vz, 1, 0, &corner_pxnz, fluid_id, space, registry);
    let h_nxpz =
        calculate_fluid_corner_height(vx, vy, vz, 0, 1, &corner_nxpz, fluid_id, space, registry);
    let h_pxpz =
        calculate_fluid_corner_height(vx, vy, vz, 1, 1, &corner_pxpz, fluid_id, space, registry);

    let mut uv_map: HashMap<String, UV> = HashMap::new();
    for face in original_faces {
        uv_map.insert(face.name.clone(), face.range.clone());
    }
    let get_range = |name: &str| uv_map.get(name).cloned().unwrap_or_default();

    let faces = vec![
        BlockFace {
            name: "py".to_string(),
            dir: [0, 1, 0],
            independent: true,
            isolated: false,
            range: get_range("py"),
            corners: [
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, 1.0],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "ny".to_string(),
            dir: [0, -1, 0],
            independent: false,
            isolated: false,
            range: get_range("ny"),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 1.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 1.0],
                },
            ],
        },
        BlockFace {
            name: "px".to_string(),
            dir: [1, 0, 0],
            independent: true,
            isolated: false,
            range: get_range("px"),
            corners: [
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [0.0, h_pxpz],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [1.0, h_pxnz],
                },
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "nx".to_string(),
            dir: [-1, 0, 0],
            independent: true,
            isolated: false,
            range: get_range("nx"),
            corners: [
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [0.0, h_nxnz],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [1.0, h_nxpz],
                },
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
            ],
        },
        BlockFace {
            name: "pz".to_string(),
            dir: [0, 0, 1],
            independent: true,
            isolated: false,
            range: get_range("pz"),
            corners: [
                CornerData {
                    pos: [0.0, 0.0, 1.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [1.0, 0.0, 1.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [0.0, h_nxpz, 1.0],
                    uv: [0.0, h_nxpz],
                },
                CornerData {
                    pos: [1.0, h_pxpz, 1.0],
                    uv: [1.0, h_pxpz],
                },
            ],
        },
        BlockFace {
            name: "nz".to_string(),
            dir: [0, 0, -1],
            independent: true,
            isolated: false,
            range: get_range("nz"),
            corners: [
                CornerData {
                    pos: [1.0, 0.0, 0.0],
                    uv: [0.0, 0.0],
                },
                CornerData {
                    pos: [0.0, 0.0, 0.0],
                    uv: [1.0, 0.0],
                },
                CornerData {
                    pos: [1.0, h_pxnz, 0.0],
                    uv: [0.0, h_pxnz],
                },
                CornerData {
                    pos: [0.0, h_nxnz, 0.0],
                    uv: [1.0, h_nxnz],
                },
            ],
        },
    ];

    let max_height = h_nxnz.max(h_pxnz).max(h_nxpz).max(h_pxpz);
    let aabb = AABB::new().scale_y(max_height).build();

    (faces, aabb)
}

fn should_render_face(
    vx: i32,
    vy: i32,
    vz: i32,
    voxel_id: u32,
    dir: [i32; 3],
    block: &Block,
    space: &dyn VoxelAccess,
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

    let n_block_type = registry.get_block_by_id(neighbor_id);

    let is_opaque = block.is_opaque;
    let is_see_through = block.is_see_through;

    (n_is_void || n_block_type.is_empty)
        || (see_through
            && !is_opaque
            && !n_block_type.is_opaque
            && ((is_see_through
                && neighbor_id == voxel_id
                && n_block_type.transparent_standalone)
                || (neighbor_id != voxel_id && (is_see_through || n_block_type.is_see_through))
                || ({
                    if is_see_through && !is_opaque && n_block_type.is_opaque {
                        let block_aabbs = block.get_aabbs(&Vec3(vx, vy, vz), space, registry);
                        let self_bounding = AABB::union(&block_aabbs);
                        let mut n_bounding = AABB::union(&n_block_type.aabbs);
                        n_bounding.translate(dir[0] as f32, dir[1] as f32, dir[2] as f32);
                        !(self_bounding.intersects(&n_bounding) || self_bounding.touches(&n_bounding))
                    } else {
                        false
                    }
                })))
        || (!see_through && (!is_opaque || !n_block_type.is_opaque))
        || (is_fluid
            && n_block_type.is_opaque
            && !n_block_type.is_fluid
            && !has_fluid_above(vx, vy, vz, voxel_id, space)
            && !is_full_cube_block(n_block_type))
}

fn compute_face_ao_and_light(
    vx: i32,
    vy: i32,
    vz: i32,
    dir: [i32; 3],
    block: &Block,
    space: &dyn VoxelAccess,
    registry: &Registry,
) -> ([i32; 4], [i32; 4]) {
    let neighbors = Neighbors::populate(Vec3(vx, vy, vz), space);
    let block_aabb = AABB::union(&block.aabbs);

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

        let b011 = !get_block_by_voxel(0, dy, dz, &neighbors, registry).is_opaque;
        let b101 = !get_block_by_voxel(dx, 0, dz, &neighbors, registry).is_opaque;
        let b110 = !get_block_by_voxel(dx, dy, 0, &neighbors, registry).is_opaque;
        let b111 = !get_block_by_voxel(dx, dy, dz, &neighbors, registry).is_opaque;

        let ao = if is_see_through || is_all_transparent {
            3
        } else if dir[0].abs() == 1 {
            vertex_ao(b110, b101, b111)
        } else if dir[1].abs() == 1 {
            vertex_ao(b110, b011, b111)
        } else {
            vertex_ao(b011, b101, b111)
        };

        let (sunlight, red_light, green_light, blue_light) = if is_see_through || is_all_transparent
        {
            let center = Vec3(0, 0, 0);
            (
                neighbors.get_sunlight(&center),
                neighbors.get_torch_light(&center, &RED),
                neighbors.get_torch_light(&center, &GREEN),
                neighbors.get_torch_light(&center, &BLUE),
            )
        } else {
            let mut sum_sunlights = Vec::with_capacity(8);
            let mut sum_red_lights = Vec::with_capacity(8);
            let mut sum_green_lights = Vec::with_capacity(8);
            let mut sum_blue_lights = Vec::with_capacity(8);

            for x in 0..=1 {
                for y in 0..=1 {
                    for z in 0..=1 {
                        let ddx = x * dx;
                        let ddy = y * dy;
                        let ddz = z * dz;

                        let offset = Vec3(ddx, ddy, ddz);

                        let local_sunlight = neighbors.get_sunlight(&offset);
                        let local_red_light = neighbors.get_torch_light(&offset, &RED);
                        let local_green_light = neighbors.get_torch_light(&offset, &GREEN);
                        let local_blue_light = neighbors.get_torch_light(&offset, &BLUE);

                        if local_sunlight == 0
                            && local_red_light == 0
                            && local_green_light == 0
                            && local_blue_light == 0
                        {
                            continue;
                        }

                        let diagonal4 = get_block_by_voxel(ddx, ddy, ddz, &neighbors, registry);

                        if diagonal4.is_opaque {
                            continue;
                        }

                        if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                            let facing = get_block_by_voxel(
                                ddx * dir[0],
                                ddy * dir[1],
                                ddz * dir[2],
                                &neighbors,
                                registry,
                            );

                            if facing.is_opaque {
                                continue;
                            }
                        }

                        if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                            let diagonal_yz = get_block_by_voxel(0, ddy, ddz, &neighbors, registry);
                            let diagonal_xz = get_block_by_voxel(ddx, 0, ddz, &neighbors, registry);
                            let diagonal_xy = get_block_by_voxel(ddx, ddy, 0, &neighbors, registry);

                            if diagonal_yz.is_opaque
                                && diagonal_xz.is_opaque
                                && diagonal_xy.is_opaque
                            {
                                continue;
                            }

                            if diagonal_xy.is_opaque && diagonal_xz.is_opaque {
                                let neighbor_y = get_block_by_voxel(0, ddy, 0, &neighbors, registry);
                                let neighbor_z = get_block_by_voxel(0, 0, ddz, &neighbors, registry);
                                if neighbor_y.is_opaque && neighbor_z.is_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xy.is_opaque && diagonal_yz.is_opaque {
                                let neighbor_x = get_block_by_voxel(ddx, 0, 0, &neighbors, registry);
                                let neighbor_z = get_block_by_voxel(0, 0, ddz, &neighbors, registry);
                                if neighbor_x.is_opaque && neighbor_z.is_opaque {
                                    continue;
                                }
                            }

                            if diagonal_xz.is_opaque && diagonal_yz.is_opaque {
                                let neighbor_x = get_block_by_voxel(ddx, 0, 0, &neighbors, registry);
                                let neighbor_y = get_block_by_voxel(0, ddy, 0, &neighbors, registry);
                                if neighbor_x.is_opaque && neighbor_y.is_opaque {
                                    continue;
                                }
                            }
                        }

                        sum_sunlights.push(local_sunlight);
                        sum_red_lights.push(local_red_light);
                        sum_green_lights.push(local_green_light);
                        sum_blue_lights.push(local_blue_light);
                    }
                }
            }

            let len = sum_sunlights.len();
            if len > 0 {
                let len_f32 = len as f32;
                (
                    (sum_sunlights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_red_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_green_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                    (sum_blue_lights.iter().sum::<u32>() as f32 / len_f32) as u32,
                )
            } else {
                (0, 0, 0, 0)
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

fn is_full_cube_block(block: &Block) -> bool {
    block.aabbs.len() == 1
        && (block.aabbs[0].min_x - 0.0).abs() < f32::EPSILON
        && (block.aabbs[0].min_y - 0.0).abs() < f32::EPSILON
        && (block.aabbs[0].min_z - 0.0).abs() < f32::EPSILON
        && (block.aabbs[0].max_x - 1.0).abs() < f32::EPSILON
        && (block.aabbs[0].max_y - 1.0).abs() < f32::EPSILON
        && (block.aabbs[0].max_z - 1.0).abs() < f32::EPSILON
}

fn can_greedy_mesh_block(block: &Block, rotation: &BlockRotation) -> bool {
    !block.is_fluid
        && !block.rotatable
        && !block.y_rotatable
        && block.dynamic_patterns.is_none()
        && matches!(rotation, BlockRotation::PY(r) if *r == 0.0)
        && is_full_cube_block(block)
}

fn extract_greedy_quads(
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

/// A meshing helper to mesh chunks.
pub struct Mesher {
    /// A queue of chunks to be meshed.
    pub(crate) queue: std::collections::VecDeque<Vec2<i32>>,

    /// A map to keep track of all the chunks that are being meshed.
    pub(crate) map: HashSet<Vec2<i32>>,

    /// Chunks that received updates while being meshed - need remeshing after current mesh completes.
    pub(crate) pending_remesh: HashSet<Vec2<i32>>,

    /// Sender of processed chunks from other threads to the main thread.
    sender: Arc<Sender<(Chunk, MessageType)>>,

    /// Receiver of processed chunks from other threads to the main thread.
    receiver: Arc<Receiver<(Chunk, MessageType)>>,

    /// The thread pool for meshing.
    pool: ThreadPool,
}

impl Mesher {
    /// Create a new chunk meshing system.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            queue: std::collections::VecDeque::new(),
            map: HashSet::new(),
            pending_remesh: HashSet::new(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("chunk-meshing-{index}"))
                .num_threads(
                    std::thread::available_parallelism()
                        .map(|p| p.get())
                        .unwrap_or(4),
                )
                .build()
                .unwrap(),
        }
    }

    /// Add a chunk to be meshed.
    pub fn add_chunk(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if self.map.contains(coords) {
            return;
        }

        self.remove_chunk(coords);

        if prioritized {
            self.queue.push_front(coords.to_owned());
        } else {
            self.queue.push_back(coords.to_owned());
        }
    }

    /// Remove a chunk coordinate from the pipeline.
    pub fn remove_chunk(&mut self, coords: &Vec2<i32>) {
        self.map.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains(coords)
    }

    /// Pop the first chunk coordinate in the queue.
    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    pub fn mark_for_remesh(&mut self, coords: &Vec2<i32>) {
        if self.map.contains(coords) {
            self.pending_remesh.insert(coords.to_owned());
        }
    }

    pub fn drain_pending_remesh(&mut self) -> Vec<Vec2<i32>> {
        self.pending_remesh.drain().collect()
    }

    /// Mesh a set of chunks.
    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Space)>,
        r#type: &MessageType,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let processes: Vec<(Chunk, Space)> = processes
            .into_iter()
            .filter(|(chunk, _)| {
                if self.map.contains(&chunk.coords) {
                    false
                } else {
                    self.map.insert(chunk.coords.to_owned());
                    true
                }
            })
            .collect();

        if processes.is_empty() {
            return;
        }

        let sender = Arc::clone(&self.sender);
        let r#type = r#type.clone();
        let registry = Arc::new(registry.clone());
        let config = Arc::new(config.clone());

        self.pool.spawn(move || {
            processes
                .into_par_iter()
                .for_each(|(mut chunk, mut space)| {
                    let chunk_size = config.chunk_size as i32;
                    let coords = space.coords.to_owned();
                    let min = space.min.to_owned();
                    let shape = space.shape.to_owned();

                    let light_colors = [
                        LightColor::Sunlight,
                        LightColor::Red,
                        LightColor::Green,
                        LightColor::Blue,
                    ];

                    let sub_chunks = chunk.updated_levels.clone();
                    let Vec3(min_x, min_y, min_z) = chunk.min;
                    let Vec3(max_x, _, max_z) = chunk.max;
                    let blocks_per_sub_chunk =
                        (space.options.max_height / space.options.sub_chunks) as i32;

                    if chunk.meshes.is_none() {
                        let mut light_queues = vec![VecDeque::new(); 4];

                        for dx in -1..=1 {
                            for dz in -1..=1 {
                                let min = Vec3(
                                    (coords.0 + dx) * chunk_size
                                        - if dx == 0 && dz == 0 { 1 } else { 0 },
                                    0,
                                    (coords.1 + dz) * chunk_size
                                        - if dx == 0 && dz == 0 { 1 } else { 0 },
                                );
                                let shape = Vec3(
                                    chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
                                    space.options.max_height as usize,
                                    chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
                                );

                                let light_subqueues =
                                    Lights::propagate(&mut space, &min, &shape, &registry, &config);

                                for (queue, subqueue) in
                                    light_queues.iter_mut().zip(light_subqueues.into_iter())
                                {
                                    queue.extend(subqueue);
                                }
                            }
                        }

                        for (queue, color) in light_queues.into_iter().zip(light_colors.iter()) {
                            if !queue.is_empty() {
                                Lights::flood_light(
                                    &mut space,
                                    queue,
                                    color,
                                    &registry,
                                    &config,
                                    Some(&min),
                                    Some(&shape),
                                );
                            }
                        }

                        chunk.lights =
                            Arc::new(space.get_lights(coords.0, coords.1).unwrap().clone());
                    }

                    for level in sub_chunks {
                        let level = level as i32;

                        let min = Vec3(min_x, min_y + level * blocks_per_sub_chunk, min_z);
                        let max = Vec3(max_x, min_y + (level + 1) * blocks_per_sub_chunk, max_z);

                        let geometries = if config.greedy_meshing {
                            Mesher::mesh_space_greedy(&min, &max, &space, &registry)
                        } else {
                            Mesher::mesh_space(&min, &max, &space, &registry)
                        };

                        chunk
                            .meshes
                            .get_or_insert_with(HashMap::new)
                            .insert(level as u32, MeshProtocol { level, geometries });
                    }

                    sender.send((chunk, r#type.clone())).unwrap();
                });
        });
    }

    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if !self.map.contains(&result.0.coords) {
                continue;
            }

            self.remove_chunk(&result.0.coords);
            results.push(result);
        }

        results
    }

    /// Mesh this space and separate individual block types into their own meshes.
    pub fn mesh_space(
        min: &Vec3<i32>,
        max: &Vec3<i32>,
        space: &dyn VoxelAccess,
        registry: &Registry,
    ) -> Vec<GeometryProtocol> {
        let mut map: HashMap<String, GeometryProtocol> = HashMap::new();

        let &Vec3(min_x, min_y, min_z) = min;
        let &Vec3(max_x, max_y, max_z) = max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = space.get_max_height(vx, vz) as i32;

                if min_y > height {
                    continue;
                }

                for vy in (min_y..=(max_y - 1).min(height) as i32).rev() {
                    let voxel_id = space.get_voxel(vx, vy, vz);

                    // Skip if block doesn't exist in registry (old/unknown blocks)
                    if !registry.has_type(voxel_id) {
                        continue;
                    }

                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = registry.get_block_by_id(voxel_id);

                    let Block {
                        id,
                        is_see_through,
                        is_empty,
                        is_opaque,
                        is_fluid,
                        name,
                        ..
                    } = block.to_owned();

                    if is_empty {
                        continue;
                    }

                    // Skip blocks that are completely covered with opaque blocks.
                    if is_opaque {
                        if !(VOXEL_NEIGHBORS
                            .into_iter()
                            .find(|&[x, y, z]| {
                                let x = vx + x;
                                let y = vy + y;
                                let z = vz + z;

                                let id = space.get_voxel(x, y, z);

                                // Skip if block doesn't exist, treat as non-opaque
                                if !registry.has_type(id) {
                                    return true;
                                }

                                let block = registry.get_block_by_id(id);

                                !block.is_opaque
                            })
                            .is_some())
                        {
                            continue;
                        }
                    }

                    let faces = if is_fluid {
                        let (fluid_faces, _) =
                            create_fluid_faces(vx, vy, vz, id, space, &block.faces, registry);
                        fluid_faces
                    } else {
                        block.get_faces(&Vec3(vx, vy, vz), space, registry)
                    };

                    // Build UV map from the actual faces (including dynamic patterns)
                    let mut uv_map = HashMap::new();
                    for face in &faces {
                        uv_map.insert(face.name.clone(), face.range.clone());
                    }

                    faces.iter().for_each(|face| {
                        let key = if face.isolated {
                            format!(
                                "{}::{}::{}-{}-{}",
                                name.to_lowercase(),
                                face.name.to_lowercase(),
                                vx,
                                vy,
                                vz
                            )
                        } else if face.independent {
                            format!("{}::{}", name.to_lowercase(), face.name.to_lowercase())
                        } else {
                            name.to_lowercase()
                        };

                        let mut geometry = map.remove(&key).unwrap_or_default();

                        geometry.voxel = id;

                        if face.independent || face.isolated {
                            geometry.face_name = Some(face.name.to_owned());
                        }

                        if face.isolated {
                            geometry.at = vec![vx, vy, vz];
                        }

                        Mesher::process_face(
                            vx,
                            vy,
                            vz,
                            voxel_id,
                            &rotation,
                            face,
                            block,
                            &uv_map,
                            &registry,
                            space,
                            is_see_through,
                            is_fluid,
                            &mut geometry.positions,
                            &mut geometry.indices,
                            &mut geometry.uvs,
                            &mut geometry.lights,
                            min,
                        );

                        map.insert(key, geometry);
                    });
                }
            }
        }

        map.into_iter()
            .map(|(_, geometry)| geometry)
            .filter(|geometry| !geometry.indices.is_empty())
            .collect()
    }

    pub fn mesh_space_greedy(
        min: &Vec3<i32>,
        max: &Vec3<i32>,
        space: &dyn VoxelAccess,
        registry: &Registry,
    ) -> Vec<GeometryProtocol> {
        let mut map: HashMap<String, GeometryProtocol> = HashMap::new();
        let mut processed_non_greedy: HashSet<(i32, i32, i32)> = HashSet::new();

        let &Vec3(min_x, min_y, min_z) = min;
        let &Vec3(max_x, max_y, max_z) = max;

        let directions: [(i32, i32, i32, &str); 6] = [
            (1, 0, 0, "px"),
            (-1, 0, 0, "nx"),
            (0, 1, 0, "py"),
            (0, -1, 0, "ny"),
            (0, 0, 1, "pz"),
            (0, 0, -1, "nz"),
        ];

        for (dx, dy, dz, face_name) in directions {
            let dir = [dx, dy, dz];

            let (axis, u_axis, v_axis) = if dx != 0 {
                (0, 2, 1)
            } else if dy != 0 {
                (1, 0, 2)
            } else {
                (2, 0, 1)
            };

            let slice_range = match axis {
                0 => min_x..max_x,
                1 => min_y..max_y,
                _ => min_z..max_z,
            };

            let u_range = match u_axis {
                0 => (min_x, max_x),
                1 => (min_y, max_y),
                _ => (min_z, max_z),
            };

            let v_range = match v_axis {
                0 => (min_x, max_x),
                1 => (min_y, max_y),
                _ => (min_z, max_z),
            };

            for slice in slice_range {
                let mut greedy_mask: HashMap<(i32, i32), FaceData> = HashMap::new();
                let mut non_greedy_faces: Vec<(i32, i32, i32, u32, BlockRotation, Block, BlockFace, UV, bool, bool)> = Vec::new();

                for u in u_range.0..u_range.1 {
                    for v in v_range.0..v_range.1 {
                        let (vx, vy, vz) = match (axis, u_axis, v_axis) {
                            (0, 2, 1) => (slice, v, u),
                            (1, 0, 2) => (u, slice, v),
                            (2, 0, 1) => (u, v, slice),
                            _ => continue,
                        };

                        let height = space.get_max_height(vx, vz) as i32;
                        
                        if vy > height {
                            continue;
                        }

                        let voxel_id = space.get_voxel(vx, vy, vz);
                        if !registry.has_type(voxel_id) {
                            continue;
                        }

                        let rotation = space.get_voxel_rotation(vx, vy, vz);
                        let block = registry.get_block_by_id(voxel_id);

                        if block.is_empty {
                            continue;
                        }

                        if block.is_opaque {
                            let all_neighbors_opaque = VOXEL_NEIGHBORS.iter().all(|&[nx, ny, nz]| {
                                let id = space.get_voxel(vx + nx, vy + ny, vz + nz);
                                registry.has_type(id) && registry.get_block_by_id(id).is_opaque
                            });
                            if all_neighbors_opaque {
                                continue;
                            }
                        }

                        let is_fluid = block.is_fluid;
                        let is_see_through = block.is_see_through;

                        let faces = if is_fluid {
                            let (fluid_faces, _) = create_fluid_faces(
                                vx, vy, vz, block.id, space, &block.faces, registry,
                            );
                            fluid_faces
                        } else {
                            block.get_faces(&Vec3(vx, vy, vz), space, registry)
                        };

                        let is_non_greedy_block = !can_greedy_mesh_block(block, &rotation);

                        if is_non_greedy_block {
                            if processed_non_greedy.contains(&(vx, vy, vz)) {
                                continue;
                            }
                            processed_non_greedy.insert((vx, vy, vz));

                            for face in faces.iter() {
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
                                ));
                            }
                            continue;
                        }

                        let matching_faces: Vec<_> = faces.iter().filter(|f| {
                            let mut face_dir = [f.dir[0] as f32, f.dir[1] as f32, f.dir[2] as f32];
                            if block.rotatable || block.y_rotatable {
                                rotation.rotate_node(&mut face_dir, block.y_rotatable, false);
                            }
                            let effective_dir = [
                                face_dir[0].round() as i32,
                                face_dir[1].round() as i32,
                                face_dir[2].round() as i32,
                            ];
                            effective_dir == dir
                        }).collect();

                        if matching_faces.is_empty() {
                            continue;
                        }

                        let should_render = should_render_face(
                            vx, vy, vz, voxel_id, dir, block, space, registry, is_see_through, is_fluid,
                        );

                        if !should_render {
                            continue;
                        }

                        for face in matching_faces {
                            let uv_range = face.range.clone();

                            if face.isolated {
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
                                ));
                                continue;
                            }

                            let (aos, lights) = compute_face_ao_and_light(vx, vy, vz, dir, block, space, registry);

                            let key = FaceKey {
                                block_id: block.id,
                                face_name: face.name.clone(),
                                independent: face.independent,
                                ao: aos,
                                light: lights,
                                uv_start_u: (uv_range.start_u * 1000000.0) as u32,
                                uv_end_u: (uv_range.end_u * 1000000.0) as u32,
                                uv_start_v: (uv_range.start_v * 1000000.0) as u32,
                                uv_end_v: (uv_range.end_v * 1000000.0) as u32,
                            };

                            let data = FaceData {
                                key,
                                uv_range,
                                is_see_through,
                                is_fluid,
                            };

                            greedy_mask.insert((u, v), data);
                        }
                    }
                }

                let quads = extract_greedy_quads(&mut greedy_mask, u_range.0, u_range.1, v_range.0, v_range.1);

                for quad in quads {
                    let block = registry.get_block_by_id(quad.data.key.block_id);
                    let geo_key = if quad.data.key.independent {
                        format!(
                            "{}::{}",
                            block.name.to_lowercase(),
                            quad.data.key.face_name.to_lowercase()
                        )
                    } else {
                        block.name.to_lowercase()
                    };

                    let geometry = map.entry(geo_key).or_insert_with(|| {
                        let mut g = GeometryProtocol::default();
                        g.voxel = quad.data.key.block_id;
                        if quad.data.key.independent {
                            g.face_name = Some(quad.data.key.face_name.clone());
                        }
                        g
                    });

                    Mesher::process_greedy_quad(
                        &quad,
                        axis,
                        u_axis,
                        v_axis,
                        slice,
                        dir,
                        min,
                        block,
                        geometry,
                    );
                }

                for (vx, vy, vz, voxel_id, rotation, block, face, uv_range, is_see_through, is_fluid) in non_greedy_faces {
                    let geo_key = if face.isolated {
                        format!(
                            "{}::{}::{}-{}-{}",
                            block.name.to_lowercase(),
                            face.name.to_lowercase(),
                            vx,
                            vy,
                            vz
                        )
                    } else if face.independent {
                        format!("{}::{}", block.name.to_lowercase(), face.name.to_lowercase())
                    } else {
                        block.name.to_lowercase()
                    };

                    let geometry = map.entry(geo_key).or_insert_with(|| {
                        let mut g = GeometryProtocol::default();
                        g.voxel = voxel_id;
                        if face.independent || face.isolated {
                            g.face_name = Some(face.name.clone());
                        }
                        if face.isolated {
                            g.at = vec![vx, vy, vz];
                        }
                        g
                    });

                    let mut uv_map = HashMap::new();
                    uv_map.insert(face.name.clone(), uv_range);

                    Mesher::process_face(
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
                        is_see_through,
                        is_fluid,
                        &mut geometry.positions,
                        &mut geometry.indices,
                        &mut geometry.uvs,
                        &mut geometry.lights,
                        min,
                    );
                }
            }
        }

        map.into_iter()
            .map(|(_, geometry)| geometry)
            .filter(|geometry| !geometry.indices.is_empty())
            .collect()
    }

    fn process_greedy_quad(
        quad: &GreedyQuad,
        axis: usize,
        u_axis: usize,
        v_axis: usize,
        slice: i32,
        dir: [i32; 3],
        min: &Vec3<i32>,
        block: &Block,
        geometry: &mut GeometryProtocol,
    ) {
        let &Vec3(min_x, min_y, min_z) = min;
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

        let w = quad.w as f32;
        let h = quad.h as f32;

        let slice_pos = slice as f32 + if dir[axis] > 0 { 1.0 } else { 0.0 };

        let (corners, uv_corners): ([[f32; 3]; 4], [[f32; 2]; 4]) = match (dir[0], dir[1], dir[2]) {
            (1, 0, 0) => (
                [
                    [slice_pos, v_max, u_max],
                    [slice_pos, v_min, u_max],
                    [slice_pos, v_max, u_min],
                    [slice_pos, v_min, u_min],
                ],
                [
                    [0.0, 1.0],
                    [0.0, 0.0],
                    [1.0, 1.0],
                    [1.0, 0.0],
                ],
            ),
            (-1, 0, 0) => (
                [
                    [slice_pos, v_max, u_min],
                    [slice_pos, v_min, u_min],
                    [slice_pos, v_max, u_max],
                    [slice_pos, v_min, u_max],
                ],
                [
                    [0.0, 1.0],
                    [0.0, 0.0],
                    [1.0, 1.0],
                    [1.0, 0.0],
                ],
            ),
            (0, 1, 0) => (
                [
                    [u_min, slice_pos, v_max],
                    [u_max, slice_pos, v_max],
                    [u_min, slice_pos, v_min],
                    [u_max, slice_pos, v_min],
                ],
                [
                    [1.0, 1.0],
                    [0.0, 1.0],
                    [1.0, 0.0],
                    [0.0, 0.0],
                ],
            ),
            (0, -1, 0) => (
                [
                    [u_max, slice_pos, v_max],
                    [u_min, slice_pos, v_max],
                    [u_max, slice_pos, v_min],
                    [u_min, slice_pos, v_min],
                ],
                [
                    [1.0, 0.0],
                    [0.0, 0.0],
                    [1.0, 1.0],
                    [0.0, 1.0],
                ],
            ),
            (0, 0, 1) => (
                [
                    [u_min, v_min, slice_pos],
                    [u_max, v_min, slice_pos],
                    [u_min, v_max, slice_pos],
                    [u_max, v_max, slice_pos],
                ],
                [
                    [0.0, 0.0],
                    [1.0, 0.0],
                    [0.0, 1.0],
                    [1.0, 1.0],
                ],
            ),
            (0, 0, -1) => (
                [
                    [u_max, v_min, slice_pos],
                    [u_min, v_min, slice_pos],
                    [u_max, v_max, slice_pos],
                    [u_min, v_max, slice_pos],
                ],
                [
                    [0.0, 0.0],
                    [1.0, 0.0],
                    [0.0, 1.0],
                    [1.0, 1.0],
                ],
            ),
            _ => return,
        };

        let ndx = (geometry.positions.len() / 3) as i32;

        for i in 0..4 {
            let pos = corners[i];
            geometry.positions.push(pos[0] - min_x as f32 - dir[0] as f32 * scale);
            geometry.positions.push(pos[1] - min_y as f32 - dir[1] as f32 * scale);
            geometry.positions.push(pos[2] - min_z as f32 - dir[2] as f32 * scale);

            let u = uv_corners[i][0] * (end_u - start_u) + start_u;
            let v = uv_corners[i][1] * (end_v - start_v) + start_v;
            geometry.uvs.push(u);
            geometry.uvs.push(v);

            let ao = quad.data.key.ao[i];
            let light = quad.data.key.light[i];
            let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
            let greedy_bit = 1 << 19;
            geometry.lights.push(light | (ao << 16) | fluid_bit | greedy_bit);
        }

        let face_aos = quad.data.key.ao;

        if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2] {
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

    #[inline]
    fn process_face(
        vx: i32,
        vy: i32,
        vz: i32,
        voxel_id: u32,
        rotation: &BlockRotation,
        face: &BlockFace,
        block: &Block,
        uv_map: &HashMap<String, UV>,
        registry: &Registry,
        space: &dyn VoxelAccess,
        see_through: bool,
        is_fluid: bool,
        positions: &mut Vec<f32>,
        indices: &mut Vec<i32>,
        uvs: &mut Vec<f32>,
        lights: &mut Vec<i32>,
        min: &Vec3<i32>,
    ) {
        let &Vec3(min_x, min_y, min_z) = min;

        let &Block {
            is_opaque,
            is_see_through,
            rotatable,
            y_rotatable,
            is_transparent,
            ..
        } = block;
        let BlockFace { dir, corners, .. } = face;

        let mut dir = [dir[0] as f32, dir[1] as f32, dir[2] as f32];
        let is_all_transparent = is_transparent[0]
            && is_transparent[1]
            && is_transparent[2]
            && is_transparent[3]
            && is_transparent[4]
            && is_transparent[5];

        if rotatable || y_rotatable {
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

        // Skip if neighbor block doesn't exist in registry
        if !n_is_void && !registry.has_type(neighbor_id) {
            return;
        }

        let n_block_type = registry.get_block_by_id(neighbor_id);

        // To mesh the face, we need to match these conditions:
        // a. general
        //    1. the neighbor is void or empty (air or DNE)
        // b. see_through mode
        //    1. itself is see-through (water & leaves)
        //       - if the neighbor is the same, then mesh if standalone (leaves).
        //       - not the same, and one is see-through, then mesh (leaves + water or leaves + stick).
        //       - not the same, and the bounding boxes do not intersect, then mesh.
        // c. opaque mode
        //    1. ignore all see-through blocks (see_through)
        //    2. if one of them is not opaque, mesh.
        // d. fluid mode
        //    1. fluids render faces against opaque blocks (but not against same fluid)
        if (n_is_void || n_block_type.is_empty)
            || (see_through
                && !is_opaque
                && !n_block_type.is_opaque
                && ((is_see_through
                    && neighbor_id == voxel_id
                    && n_block_type.transparent_standalone)
                    || (neighbor_id != voxel_id
                        && (is_see_through || n_block_type.is_see_through))
                    || ({
                        if is_see_through && !is_opaque && n_block_type.is_opaque {
                            let block_aabbs = block.get_aabbs(&Vec3(vx, vy, vz), space, registry);
                            let self_bounding = AABB::union(&block_aabbs);
                            let mut n_bounding = AABB::union(&n_block_type.aabbs);
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
                && !has_fluid_above(vx, vy, vz, voxel_id, space)
                && !is_full_cube_block(n_block_type))
        {
            let UV {
                start_u,
                end_u,
                start_v,
                end_v,
            } = uv_map.get(&face.name).cloned().unwrap_or_default();

            let ndx = (positions.len() / 3) as i32;
            let mut face_aos = Vec::with_capacity(4);

            let mut four_sunlights = Vec::with_capacity(4);
            let mut four_red_lights = Vec::with_capacity(4);
            let mut four_green_lights = Vec::with_capacity(4);
            let mut four_blue_lights = Vec::with_capacity(4);

            let neighbors = Neighbors::populate(Vec3(vx, vy, vz), space);
            let block_aabb = AABB::union(&block.aabbs);

            for CornerData { mut pos, uv } in corners.iter() {
                if rotatable || y_rotatable {
                    rotation.rotate_node(&mut pos, y_rotatable, true);
                }

                let pos_x = pos[0] + vx as f32;
                let pos_y = pos[1] + vy as f32;
                let pos_z = pos[2] + vz as f32;

                let scale = if is_opaque { 0.0 } else { 0.0001 };
                positions.push(pos_x - min_x as f32 - dir[0] as f32 * scale);
                positions.push(pos_y - min_y as f32 - dir[1] as f32 * scale);
                positions.push(pos_z - min_z as f32 - dir[2] as f32 * scale);

                uvs.push(uv[0] * (end_u - start_u) + start_u);
                uvs.push(uv[1] * (end_v - start_v) + start_v);

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

                let mut sum_sunlights = Vec::with_capacity(8);
                let mut sum_red_lights = Vec::with_capacity(8);
                let mut sum_green_lights = Vec::with_capacity(8);
                let mut sum_blue_lights = Vec::with_capacity(8);

                let b011 = !get_block_by_voxel(0, dy, dz, &neighbors, registry).is_opaque;
                let b101 = !get_block_by_voxel(dx, 0, dz, &neighbors, registry).is_opaque;
                let b110 = !get_block_by_voxel(dx, dy, 0, &neighbors, registry).is_opaque;
                let b111 = !get_block_by_voxel(dx, dy, dz, &neighbors, registry).is_opaque;

                let ao = if is_see_through || is_all_transparent {
                    3
                } else if dir[0].abs() == 1 {
                    vertex_ao(b110, b101, b111)
                } else if dir[1].abs() == 1 {
                    vertex_ao(b110, b011, b111)
                } else {
                    vertex_ao(b011, b101, b111)
                };

                let sunlight;
                let red_light;
                let green_light;
                let blue_light;

                if is_see_through || is_all_transparent {
                    let center = Vec3(0, 0, 0);
                    sunlight = neighbors.get_sunlight(&center);
                    red_light = neighbors.get_torch_light(&center, &RED);
                    green_light = neighbors.get_torch_light(&center, &GREEN);
                    blue_light = neighbors.get_torch_light(&center, &BLUE);
                } else {
                    // Loop through all 9 neighbors (including self) of this vertex.
                    for x in 0..=1 {
                        for y in 0..=1 {
                            for z in 0..=1 {
                                let ddx = x * dx;
                                let ddy = y * dy;
                                let ddz = z * dz;

                                let offset = Vec3(ddx, ddy, ddz);

                                let local_sunlight = neighbors.get_sunlight(&offset);
                                let local_red_light = neighbors.get_torch_light(&offset, &RED);
                                let local_green_light = neighbors.get_torch_light(&offset, &GREEN);
                                let local_blue_light = neighbors.get_torch_light(&offset, &BLUE);

                                if local_sunlight == 0
                                    && local_red_light == 0
                                    && local_green_light == 0
                                    && local_blue_light == 0
                                {
                                    continue;
                                }

                                let diagonal4 =
                                    get_block_by_voxel(ddx, ddy, ddz, &neighbors, registry);

                                if diagonal4.is_opaque {
                                    continue;
                                }

                                // The block that we're checking is on the side that the face is facing, so
                                // check if the diagonal block would be blocking this block's potential light.
                                // Perpendicular check done by crossing the vectors.
                                if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                                    let facing = get_block_by_voxel(
                                        ddx * dir[0],
                                        ddy * dir[1],
                                        ddz * dir[2],
                                        &neighbors,
                                        registry,
                                    );

                                    if facing.is_opaque {
                                        continue;
                                    }
                                }

                                // Diagonal light leaking fix.
                                if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                                    let diagonal_yz =
                                        get_block_by_voxel(0, ddy, ddz, &neighbors, registry);
                                    let diagonal_xz =
                                        get_block_by_voxel(ddx, 0, ddz, &neighbors, registry);
                                    let diagonal_xy =
                                        get_block_by_voxel(ddx, ddy, 0, &neighbors, registry);

                                    // Three corners all blocked
                                    if diagonal_yz.is_opaque
                                        && diagonal_xz.is_opaque
                                        && diagonal_xy.is_opaque
                                    {
                                        continue;
                                    }

                                    // Two corners blocked
                                    if diagonal_xy.is_opaque && diagonal_xz.is_opaque {
                                        let neighbor_y =
                                            get_block_by_voxel(0, ddy, 0, &neighbors, registry);
                                        let neighbor_z =
                                            get_block_by_voxel(0, 0, ddz, &neighbors, registry);
                                        if neighbor_y.is_opaque && neighbor_z.is_opaque {
                                            continue;
                                        }
                                    }

                                    if diagonal_xy.is_opaque && diagonal_yz.is_opaque {
                                        let neighbor_x =
                                            get_block_by_voxel(ddx, 0, 0, &neighbors, registry);
                                        let neighbor_z =
                                            get_block_by_voxel(0, 0, ddz, &neighbors, registry);
                                        if neighbor_x.is_opaque && neighbor_z.is_opaque {
                                            continue;
                                        }
                                    }

                                    if diagonal_xz.is_opaque && diagonal_yz.is_opaque {
                                        let neighbor_x =
                                            get_block_by_voxel(ddx, 0, 0, &neighbors, registry);
                                        let neighbor_y =
                                            get_block_by_voxel(0, ddy, 0, &neighbors, registry);
                                        if neighbor_x.is_opaque && neighbor_y.is_opaque {
                                            continue;
                                        }
                                    }
                                }

                                sum_sunlights.push(local_sunlight);
                                sum_red_lights.push(local_red_light);
                                sum_green_lights.push(local_green_light);
                                sum_blue_lights.push(local_blue_light);
                            }
                        }
                    }

                    let len = sum_sunlights.len();
                    if len > 0 {
                        let len_f32 = len as f32;
                        sunlight = (sum_sunlights.iter().sum::<u32>() as f32 / len_f32) as u32;
                        red_light = (sum_red_lights.iter().sum::<u32>() as f32 / len_f32) as u32;
                        green_light =
                            (sum_green_lights.iter().sum::<u32>() as f32 / len_f32) as u32;
                        blue_light = (sum_blue_lights.iter().sum::<u32>() as f32 / len_f32) as u32;
                    } else {
                        sunlight = 0;
                        red_light = 0;
                        green_light = 0;
                        blue_light = 0;
                    }
                }

                let mut light = 0;
                light = LightUtils::insert_red_light(light, red_light);
                light = LightUtils::insert_green_light(light, green_light);
                light = LightUtils::insert_blue_light(light, blue_light);
                light = LightUtils::insert_sunlight(light, sunlight);
                let fluid_bit = if is_fluid { 1 << 18 } else { 0 };
                lights.push(light as i32 | ao << 16 | fluid_bit);

                four_sunlights.push(sunlight);
                four_red_lights.push(red_light);
                four_green_lights.push(green_light);
                four_blue_lights.push(blue_light);
                face_aos.push(ao);
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

            /* -------------------------------------------------------------------------- */
            /*                     I KNOW THIS IS UGLY, BUT IT WORKS!                     */
            /* -------------------------------------------------------------------------- */
            // at least one zero
            let one_tr0 =
                a_rt <= threshold || b_rt <= threshold || c_rt <= threshold || d_rt <= threshold;
            let one_tg0 =
                a_gt <= threshold || b_gt <= threshold || c_gt <= threshold || d_gt <= threshold;
            let one_tb0 =
                a_bt <= threshold || b_bt <= threshold || c_bt <= threshold || d_bt <= threshold;
            // one is zero, and ao rule, but only for zero AO's
            let fequals = (face_aos[0] + face_aos[3]) == (face_aos[1] + face_aos[2]);
            let ozao_r = a_rt + d_rt < b_rt + c_rt && fequals;
            let ozao_g = a_gt + d_gt < b_gt + c_gt && fequals;
            let ozao_b = a_bt + d_bt < b_bt + c_bt && fequals;
            // all not zero, 4 parts
            let anzp1_r = (b_rt as f32 > (a_rt + d_rt) as f32 / 2.0
                && (a_rt + d_rt) as f32 / 2.0 > c_rt as f32)
                || (c_rt as f32 > (a_rt + d_rt) as f32 / 2.0
                    && (a_rt + d_rt) as f32 / 2.0 > b_rt as f32);
            let anzp1_g = (b_gt as f32 > (a_gt + d_gt) as f32 / 2.0
                && (a_gt + d_gt) as f32 / 2.0 > c_gt as f32)
                || (c_gt as f32 > (a_gt + d_gt) as f32 / 2.0
                    && (a_gt + d_gt) as f32 / 2.0 > b_gt as f32);
            let anzp1_b = (b_bt as f32 > (a_bt + d_bt) as f32 / 2.0
                && (a_bt + d_bt) as f32 / 2.0 > c_bt as f32)
                || (c_bt as f32 > (a_bt + d_bt) as f32 / 2.0
                    && (a_bt + d_bt) as f32 / 2.0 > b_bt as f32);
            // fixed two light sources colliding
            let anz_r = one_tr0 && anzp1_r;
            let anz_g = one_tg0 && anzp1_g;
            let anz_b = one_tb0 && anzp1_b;

            // common starting indices
            indices.push(ndx);
            indices.push(ndx + 1);

            if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
                || (ozao_r || ozao_g || ozao_b)
                || (anz_r || anz_g || anz_b)
            {
                // generate flipped quad
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
    }
}
