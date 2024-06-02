use std::{collections::VecDeque, sync::Arc, time::Instant};

use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::{HashMap, HashSet};
use log::info;
use rayon::{iter::IntoParallelIterator, prelude::ParallelIterator, ThreadPool, ThreadPoolBuilder};

use crate::{
    world::generators::lights::VOXEL_NEIGHBORS, Block, BlockFace, BlockRotation, Chunk, CornerData,
    GeometryProtocol, LightColor, LightUtils, MeshProtocol, MessageType, Neighbors, Registry,
    Space, Vec2, Vec3, VoxelAccess, WorldConfig, AABB, UV,
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
    ox: i32,
    oy: i32,
    oz: i32,
    neighbors: &Neighbors,
    registry: &'a Registry,
) -> &'a Block {
    registry.get_block_by_id(neighbors.get_voxel(&Vec3(ox, oy, oz)))
}

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;

/// A meshing helper to mesh chunks.
pub struct Mesher {
    /// A queue of chunks to be meshed.
    pub(crate) queue: VecDeque<Vec2<i32>>,

    /// A map to keep track of all the chunks that are being meshed.
    pub(crate) map: HashSet<Vec2<i32>>,

    /// A map to keep track of the processes that should be skipped.
    pub(crate) skips: HashMap<Vec2<i32>, usize>,

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
            queue: VecDeque::new(),
            map: HashSet::new(),
            skips: HashMap::new(),
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("chunk-meshing-{index}"))
                .num_threads(64)
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
        self.skips.remove(coords);
        self.queue.retain(|c| c != coords);
    }

    pub fn has_chunk(&self, coords: &Vec2<i32>) -> bool {
        self.map.contains(coords)
    }

    /// Pop the first chunk coordinate in the queue.
    pub fn get(&mut self) -> Option<Vec2<i32>> {
        self.queue.pop_front()
    }

    /// Mesh a set of chunks.
    pub fn process(
        &mut self,
        processes: Vec<(Chunk, Space)>,
        r#type: &MessageType,
        registry: &Registry,
        config: &WorldConfig,
    ) {
        processes.iter().for_each(|(chunk, _)| {
            if self.map.contains(&chunk.coords) {
                let curr_count = self.skips.remove(&chunk.coords).unwrap_or(0);
                self.skips.insert(chunk.coords.to_owned(), curr_count + 1);
            }

            self.map.insert(chunk.coords.to_owned());
        });

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
                                        - if dz == 0 && dz == 0 { 1 } else { 0 },
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

                        chunk.lights = space.get_lights(coords.0, coords.1).unwrap().clone();
                    }

                    for level in sub_chunks {
                        let level = level as i32;

                        let min = Vec3(min_x, min_y + level * blocks_per_sub_chunk, min_z);
                        let max = Vec3(max_x, min_y + (level + 1) * blocks_per_sub_chunk, max_z);

                        let geometries = Mesher::mesh_space(&min, &max, &space, &registry);

                        chunk
                            .meshes
                            .get_or_insert_with(HashMap::new)
                            .insert(level as u32, MeshProtocol { level, geometries });
                    }

                    sender.send((chunk, r#type.clone())).unwrap();
                });
        });
    }

    /// Attempt to retrieve the results from `mesher.process`
    pub fn results(&mut self) -> Vec<(Chunk, MessageType)> {
        let mut results = Vec::new();

        while let Ok(result) = self.receiver.try_recv() {
            if !self.map.contains(&result.0.coords) {
                continue;
            }

            if let Some(count) = self.skips.remove(&result.0.coords) {
                if count > 0 {
                    self.skips.insert(result.0.coords.to_owned(), count - 1);
                    continue;
                }
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

                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = registry.get_block_by_id(voxel_id);

                    let Block {
                        id,
                        is_see_through,
                        is_empty,
                        is_opaque,
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

                                let block = registry.get_block_by_id(id);

                                !block.is_opaque
                            })
                            .is_some())
                        {
                            continue;
                        }
                    }

                    let faces = block.get_faces(&Vec3(vx, vy, vz), space, registry);
                    let uv_map = registry.get_uv_map(block);

                    faces.iter().enumerate().for_each(|(idx, face)| {
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

                // calculating the 8 voxels around this vertex
                let dx = pos[0].round() as i32;
                let dy = pos[1].round() as i32;
                let dz = pos[2].round() as i32;

                let dx = if dx == 0 { -1 } else { 1 };
                let dy = if dy == 0 { -1 } else { 1 };
                let dz = if dz == 0 { -1 } else { 1 };

                let mut sum_sunlights = vec![];
                let mut sum_red_lights = vec![];
                let mut sum_green_lights = vec![];
                let mut sum_blue_lights = vec![];

                let neighbors = Neighbors::populate(Vec3(vx, vy, vz), space);

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

                    sunlight = (sum_sunlights.iter().sum::<u32>() as f32
                        / sum_sunlights.len() as f32) as u32;

                    red_light = (sum_red_lights.iter().sum::<u32>() as f32
                        / sum_red_lights.len() as f32) as u32;

                    green_light = (sum_green_lights.iter().sum::<u32>() as f32
                        / sum_green_lights.len() as f32) as u32;

                    blue_light = (sum_blue_lights.iter().sum::<u32>() as f32
                        / sum_blue_lights.len() as f32) as u32;
                }

                let mut light = 0;
                light = LightUtils::insert_red_light(light, red_light);
                light = LightUtils::insert_green_light(light, green_light);
                light = LightUtils::insert_blue_light(light, blue_light);
                light = LightUtils::insert_sunlight(light, sunlight);
                lights.push(light as i32 | ao << 16);

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
