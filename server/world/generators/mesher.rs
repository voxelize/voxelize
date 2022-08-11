use std::sync::Arc;

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use hashbrown::HashMap;
use itertools::izip;
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator};
use std::thread::spawn;

use crate::{
    Block, BlockFace, BlockRotation, Chunk, CornerData, Geometry, LightUtils, MeshProtocol,
    Registry, Space, Vec3, VoxelAccess, WorldConfig, UV,
};

use super::lights::Lights;

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
    vx: i32,
    vy: i32,
    vz: i32,
    space: &Space,
    registry: &'a Registry,
) -> &'a Block {
    registry.get_block_by_id(space.get_voxel(vx, vy, vz))
}

/// A meshing helper to mesh chunks.
pub struct Mesher {
    sender: Arc<Sender<Vec<Chunk>>>,
    receiver: Arc<Receiver<Vec<Chunk>>>,
}

impl Mesher {
    /// Create a new chunk meshing system.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
        }
    }

    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Space)>,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        let sender = Arc::clone(&self.sender);

        let registry = registry.to_owned();
        let config = config.to_owned();

        spawn(move || {
            let chunks: Vec<Chunk> = processes
                .into_par_iter()
                .map(|(mut chunk, mut space)| {
                    if chunk.meshes.is_none() {
                        let min = space.min.to_owned();
                        let coords = space.coords.to_owned();
                        let shape = space.shape.to_owned();

                        chunk.lights = Lights::propagate(
                            &mut space, &min, &coords, &shape, &registry, &config,
                        );
                    }

                    let sub_chunks = chunk.updated_levels.to_owned();

                    space.updated_levels.clear();
                    chunk.updated_levels.clear();

                    let Vec3(min_x, min_y, min_z) = chunk.min;
                    let Vec3(max_x, _, max_z) = chunk.max;

                    let blocks_per_sub_chunk =
                        (space.params.max_height / space.params.sub_chunks) as i32;

                    let sub_chunks: Vec<_> = sub_chunks.into_iter().collect();

                    sub_chunks
                        .into_par_iter()
                        .map(|level| {
                            let level = level as i32;

                            let min = Vec3(min_x, min_y + level * blocks_per_sub_chunk, min_z);
                            let max =
                                Vec3(max_x, min_y + (level + 1) * blocks_per_sub_chunk, max_z);

                            let opaque = Self::mesh_space(&min, &max, &space, &registry, false);
                            let transparent = Self::mesh_space(&min, &max, &space, &registry, true);

                            (opaque, transparent, level)
                        })
                        .collect::<Vec<(Option<Geometry>, Option<Geometry>, i32)>>()
                        .into_iter()
                        .for_each(|(opaque, transparent, level)| {
                            if chunk.meshes.is_none() {
                                chunk.meshes = Some(HashMap::new());
                            }

                            chunk.meshes.as_mut().unwrap().insert(
                                level as u32,
                                MeshProtocol {
                                    level,
                                    opaque,
                                    transparent,
                                },
                            );
                        });

                    chunk
                })
                .collect();

            sender.send(chunks).unwrap();
        });
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&self) -> Result<Vec<Chunk>, TryRecvError> {
        self.receiver.try_recv()
    }

    /// Mesh a Space struct from specified voxel coordinates, generating the 3D data needed
    /// to render a chunk/space.
    // #[allow(clippy::all)]
    pub fn mesh_space(
        min: &Vec3<i32>,
        max: &Vec3<i32>,
        space: &Space,
        registry: &Registry,
        transparent: bool,
    ) -> Option<Geometry> {
        let mut positions = Vec::<f32>::new();
        let mut indices = Vec::<i32>::new();
        let mut uvs = Vec::<f32>::new();
        let mut lights = Vec::<i32>::new();

        let &Vec3(min_x, min_y, min_z) = min;
        let &Vec3(max_x, max_y, max_z) = max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = space.get_max_height(vx, vz) as i32;

                if min_y > height {
                    continue;
                }

                let mut process_face =
                    |vx: i32,
                     vy: i32,
                     vz: i32,
                     voxel_id: u32,
                     rotation: &BlockRotation,
                     face: &BlockFace,
                     block: &Block,
                     uv_map: &HashMap<String, &UV>| {
                        let &Block {
                            is_opaque,
                            is_see_through,
                            rotatable,
                            ..
                        } = block;
                        let BlockFace { dir, corners, .. } = face;

                        let mut dir = [dir[0] as f32, dir[1] as f32, dir[2] as f32];

                        if rotatable {
                            rotation.rotate_node(&mut dir, false);
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
                        let n_block_type = registry.get_block_by_id(neighbor_id);

                        // To mesh the face, we need to match these conditions:
                        // a. general
                        //    1. the neighbor is void or empty (air or DNE)
                        // b. transparent mode
                        //    1. itself is see-through (water & leaves)
                        //       - if the neighbor is the same, then mesh if standalone (leaves).
                        //       - not the same, don't mesh.
                        // c. opaque mode
                        //    1. ignore all see-through blocks (transparent)
                        //    2. if one of them is not opaque, mesh.
                        if (n_is_void || n_block_type.is_empty)
                            || (transparent
                                && (is_see_through
                                    && neighbor_id == voxel_id
                                    && n_block_type.transparent_standalone))
                            || (!transparent && (!is_opaque || !n_block_type.is_opaque))
                        {
                            let UV {
                                start_u,
                                end_u,
                                start_v,
                                end_v,
                            } = uv_map.get(&face.name).unwrap();

                            let ndx = (positions.len() as f32 / 3.0).floor() as i32;
                            let mut face_aos = vec![];

                            let mut four_sunlights = vec![];
                            let mut four_red_lights = vec![];
                            let mut four_green_lights = vec![];
                            let mut four_blue_lights = vec![];

                            for CornerData { mut pos, uv } in corners.iter() {
                                if rotatable {
                                    rotation.rotate_node(&mut pos, true);
                                }

                                let pos_x = pos[0] + vx as f32;
                                let pos_y = pos[1] + vy as f32;
                                let pos_z = pos[2] + vz as f32;

                                let scale = if is_opaque { 0.0 } else { 0.0001 };
                                positions.push(pos_x as f32 - dir[0] as f32 * scale);
                                positions.push(pos_y - dir[1] as f32 * scale);
                                positions.push(pos_z as f32 - dir[2] as f32 * scale);

                                uvs.push(uv[0] * (end_u - start_u) + start_u);
                                uvs.push(uv[1] * (end_v - start_v) + start_v);

                                // calculating the 8 voxels around this vertex
                                let dx = pos[0].round() as i32;
                                let dy = pos[1].round() as i32;
                                let dz = pos[2].round() as i32;

                                let dx = if dx == 0 { -1 } else { 1 };
                                let dy = if dy == 0 { -1 } else { 1 };
                                let dz = if dz == 0 { -1 } else { 1 };

                                let mut sum_sunlight = vec![];
                                let mut sum_red_lights = vec![];
                                let mut sum_green_lights = vec![];
                                let mut sum_blue_lights = vec![];

                                let b011 =
                                    get_block_by_voxel(vx, vy + dy, vz + dz, space, registry);
                                let b011 = !b011.is_opaque;
                                let b101 =
                                    get_block_by_voxel(vx + dx, vy, vz + dz, space, registry);
                                let b101 = !b101.is_opaque;
                                let b110 =
                                    get_block_by_voxel(vx + dx, vy + dy, vz, space, registry);
                                let b110 = !b110.is_opaque;
                                let b111 =
                                    get_block_by_voxel(vx + dx, vy + dy, vz + dz, space, registry);
                                let b111 = !b111.is_opaque;

                                if is_see_through {
                                    face_aos.push(3);
                                } else if dir[0].abs() == 1 {
                                    face_aos.push(vertex_ao(b110, b101, b111));
                                } else if dir[1].abs() == 1 {
                                    face_aos.push(vertex_ao(b110, b011, b111));
                                } else {
                                    face_aos.push(vertex_ao(b011, b101, b111));
                                }

                                if is_see_through {
                                    four_sunlights.push(space.get_sunlight(vx, vy, vz) as i32);
                                    four_red_lights.push(space.get_red_light(vx, vy, vz) as i32);
                                    four_green_lights
                                        .push(space.get_green_light(vx, vy, vz) as i32);
                                    four_blue_lights.push(space.get_blue_light(vx, vy, vz) as i32);
                                } else {
                                    // Loop through all 8 neighbors of this vertex.
                                    for ddx in if dx > 0 { 0..=dx } else { dx..=0 } {
                                        for ddy in if dy > 0 { 0..=dy } else { dy..=0 } {
                                            for ddz in if dz > 0 { 0..=dz } else { dz..=0 } {
                                                // The block that we're checking is on the side that the face is facing, so
                                                // check if the diagonal block would be blocking this block's potential light.
                                                // Perpendicular check done by crossing the vectors.
                                                if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                                                    let facing = get_block_by_voxel(
                                                        vx + ddx * dir[0],
                                                        vy + ddy * dir[1],
                                                        vz + ddz * dir[2],
                                                        space,
                                                        registry,
                                                    );

                                                    if facing.is_opaque {
                                                        continue;
                                                    }
                                                }

                                                // Diagonal light leaking fix.
                                                if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                                                    let diagonal_yz = get_block_by_voxel(
                                                        vx,
                                                        vy + ddy,
                                                        vz + ddz,
                                                        space,
                                                        registry,
                                                    );
                                                    let diagonal_xz = get_block_by_voxel(
                                                        vx + ddx,
                                                        vy,
                                                        vz + ddz,
                                                        space,
                                                        registry,
                                                    );
                                                    let diagonal_xy = get_block_by_voxel(
                                                        vx + ddx,
                                                        vy + ddy,
                                                        vz,
                                                        space,
                                                        registry,
                                                    );

                                                    if diagonal_yz.is_opaque
                                                        && diagonal_xz.is_opaque
                                                        && diagonal_xy.is_opaque
                                                    {
                                                        continue;
                                                    }
                                                }

                                                let diagonal4 = get_block_by_voxel(
                                                    vx + ddx,
                                                    vy + ddy,
                                                    vz + ddz,
                                                    space,
                                                    registry,
                                                );

                                                let is_transparent = !diagonal4.is_opaque;

                                                if is_transparent {
                                                    sum_sunlight.push(space.get_sunlight(
                                                        vx + ddx,
                                                        vy + ddy,
                                                        vz + ddz,
                                                    ));
                                                    sum_red_lights.push(space.get_red_light(
                                                        vx + ddx,
                                                        vy + ddy,
                                                        vz + ddz,
                                                    ));
                                                    sum_green_lights.push(space.get_green_light(
                                                        vx + ddx,
                                                        vy + ddy,
                                                        vz + ddz,
                                                    ));
                                                    sum_blue_lights.push(space.get_blue_light(
                                                        vx + ddx,
                                                        vy + ddy,
                                                        vz + ddz,
                                                    ));
                                                }
                                            }
                                        }
                                    }

                                    four_sunlights.push(
                                        (sum_sunlight.iter().sum::<u32>() as f32
                                            / sum_sunlight.len() as f32)
                                            as i32,
                                    );

                                    four_red_lights.push(
                                        (sum_red_lights.iter().sum::<u32>() as f32
                                            / sum_red_lights.len() as f32)
                                            as i32,
                                    );

                                    four_green_lights.push(
                                        (sum_green_lights.iter().sum::<u32>() as f32
                                            / sum_green_lights.len() as f32)
                                            as i32,
                                    );

                                    four_blue_lights.push(
                                        (sum_blue_lights.iter().sum::<u32>() as f32
                                            / sum_blue_lights.len() as f32)
                                            as i32,
                                    );
                                }
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
                            let one_tr0 = a_rt <= threshold
                                || b_rt <= threshold
                                || c_rt <= threshold
                                || d_rt <= threshold;
                            let one_tg0 = a_gt <= threshold
                                || b_gt <= threshold
                                || c_gt <= threshold
                                || d_gt <= threshold;
                            let one_tb0 = a_bt <= threshold
                                || b_bt <= threshold
                                || c_bt <= threshold
                                || d_bt <= threshold;
                            // one is zero, and ao rule, but only for zero AO's
                            let fequals =
                                (face_aos[0] + face_aos[3]) == (face_aos[1] + face_aos[2]);
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

                            let mut ao_i = 0;
                            for (s, r, g, b) in izip!(
                                &four_sunlights,
                                &four_red_lights,
                                &four_green_lights,
                                &four_blue_lights
                            ) {
                                let mut light = 0;
                                light = LightUtils::insert_red_light(light, *r as u32);
                                light = LightUtils::insert_green_light(light, *g as u32);
                                light = LightUtils::insert_blue_light(light, *b as u32);
                                light = LightUtils::insert_sunlight(light, *s as u32);
                                lights.push(light as i32 | face_aos[ao_i] << 16);
                                ao_i += 1;
                            }
                        }
                    };

                for vy in (min_y..=(max_y - 1).min(height) as i32).rev() {
                    let voxel_id = space.get_voxel(vx, vy, vz);
                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = registry.get_block_by_id(voxel_id);

                    let Block {
                        is_see_through,
                        is_block,
                        ..
                    } = block.to_owned();

                    if if transparent {
                        is_see_through
                    } else {
                        !is_see_through
                    } {
                        if is_block {
                            let Block { faces, .. } = block.to_owned();

                            let uv_map = registry.get_uv_map(block);

                            faces.iter().for_each(|face| {
                                process_face(vx, vy, vz, voxel_id, &rotation, face, block, &uv_map)
                            });
                        }
                    }
                }
            }
        }

        if indices.is_empty() {
            return None;
        }

        Some(Geometry {
            positions,
            indices,
            uvs,
            lights,
        })
    }
}
