use std::sync::Arc;

use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use itertools::izip;
use rayon::{ThreadPool, ThreadPoolBuilder};

use crate::{
    chunk::Chunk,
    server::models::{Geometry, Mesh},
    utils::{light_utils::LightUtils, vec::Vec3},
};

use super::{
    access::VoxelAccess,
    block::{Block, BlockFaces},
    lights::Lights,
    registry::{Registry, UV},
    space::Space,
    WorldConfig,
};

struct CornerData {
    pub pos: [i32; 3],
    pub uv: [i32; 2],
}

struct BlockFace {
    pub dir: [i32; 3],
    pub side: BlockFaces,
    pub corners: [CornerData; 4],
}

struct PlantFace<'a> {
    pub mat: &'a str,
    pub corners: [CornerData; 4],
}

const BLOCK_FACES: [BlockFace; 6] = [
    // viewing from -x to +x (head towards +y) (indices):
    // 0 1 2
    // 3 i 4 (i for irrelevant)
    // 5 6 7

    // corners:
    // 0,1,1  0,1,0
    // 0,0,1  0,0,0

    // left
    BlockFace {
        dir: [-1, 0, 0],
        side: BlockFaces::Nx,
        corners: [
            CornerData {
                pos: [0, 1, 0],
                uv: [0, 1],
            },
            CornerData {
                pos: [0, 0, 0],
                uv: [0, 0],
            },
            CornerData {
                pos: [0, 1, 1],
                uv: [1, 1],
            },
            CornerData {
                pos: [0, 0, 1],
                uv: [1, 0],
            },
        ],
    },
    // viewing from +x to -x (head towards +y) (indices):
    // 2 1 0
    // 4 i 3 (i for irrelevant)
    // 7 6 5

    // corners:
    // 1,1,1  1,1,0
    // 1,0,1  1,0,0

    // right
    BlockFace {
        dir: [1, 0, 0],
        side: BlockFaces::Px,
        corners: [
            CornerData {
                pos: [1, 1, 1],
                uv: [0, 1],
            },
            CornerData {
                pos: [1, 0, 1],
                uv: [0, 0],
            },
            CornerData {
                pos: [1, 1, 0],
                uv: [1, 1],
            },
            CornerData {
                pos: [1, 0, 0],
                uv: [1, 0],
            },
        ],
    },
    // viewing from -y to +y (head towards +z) (indices):
    // 0 1 2
    // 3 i 4 (i for irrelevant)
    // 5 6 7

    // corners:
    // 0,0,1  1,0,1
    // 0,0,0  1,0,0

    // bottom
    BlockFace {
        dir: [0, -1, 0],
        side: BlockFaces::Ny,
        corners: [
            CornerData {
                pos: [1, 0, 1],
                uv: [1, 0],
            },
            CornerData {
                pos: [0, 0, 1],
                uv: [0, 0],
            },
            CornerData {
                pos: [1, 0, 0],
                uv: [1, 1],
            },
            CornerData {
                pos: [0, 0, 0],
                uv: [0, 1],
            },
        ],
    },
    // viewing from -y to +y (head towards +z) (indices):
    // 0 1 2
    // 3 i 4 (i for irrelevant)
    // 5 6 7

    // corners:
    // 0,0,1  1,0,1
    // 0,0,0  1,0,0

    // bottom
    BlockFace {
        dir: [0, 1, 0],
        side: BlockFaces::Py,
        corners: [
            CornerData {
                pos: [0, 1, 1],
                uv: [1, 1],
            },
            CornerData {
                pos: [1, 1, 1],
                uv: [0, 1],
            },
            CornerData {
                pos: [0, 1, 0],
                uv: [1, 0],
            },
            CornerData {
                pos: [1, 1, 0],
                uv: [0, 0],
            },
        ],
    },
    // viewing from -z to +z (head towards +y) (indices):
    // 0 1 2
    // 3 i 4 (i for irrelevant)
    // 5 6 7

    // corners:
    // 1,1,0  0,1,0
    // 1,0,0  0,0,0

    // back
    BlockFace {
        dir: [0, 0, -1],
        side: BlockFaces::Nz,
        corners: [
            CornerData {
                pos: [1, 0, 0],
                uv: [0, 0],
            },
            CornerData {
                pos: [0, 0, 0],
                uv: [1, 0],
            },
            CornerData {
                pos: [1, 1, 0],
                uv: [0, 1],
            },
            CornerData {
                pos: [0, 1, 0],
                uv: [1, 1],
            },
        ],
    },
    // viewing from +z to -z (head towards +y) (indices):
    // 2 1 0
    // 4 i 3 (i for irrelevant)
    // 7 6 5

    // corners:
    // 0,1,1  1,1,1
    // 0,0,1  1,0,1

    // front
    BlockFace {
        dir: [0, 0, 1],
        side: BlockFaces::Pz,
        corners: [
            CornerData {
                pos: [0, 0, 1],
                uv: [0, 0],
            },
            CornerData {
                pos: [1, 0, 1],
                uv: [1, 0],
            },
            CornerData {
                pos: [0, 1, 1],
                uv: [0, 1],
            },
            CornerData {
                pos: [1, 1, 1],
                uv: [1, 1],
            },
        ],
    },
];

const PLANT_FACES: [PlantFace; 2] = [
    PlantFace {
        // diagonal 1
        mat: "one",
        corners: [
            CornerData {
                pos: [0, 1, 0],
                uv: [0, 1],
            },
            CornerData {
                pos: [0, 0, 0],
                uv: [0, 0],
            },
            CornerData {
                pos: [1, 1, 1],
                uv: [1, 1],
            },
            CornerData {
                pos: [1, 0, 1],
                uv: [1, 0],
            },
        ],
    },
    PlantFace {
        // diagonal 2
        mat: "two",
        corners: [
            CornerData {
                pos: [1, 1, 0],
                uv: [0, 1],
            },
            CornerData {
                pos: [1, 0, 0],
                uv: [0, 0],
            },
            CornerData {
                pos: [0, 1, 1],
                uv: [1, 1],
            },
            CornerData {
                pos: [0, 0, 1],
                uv: [1, 0],
            },
        ],
    },
];

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
    pool: ThreadPool,
}

impl Mesher {
    /// Create a new chunk meshing system.
    pub fn new() -> Self {
        let (sender, receiver) = unbounded();

        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            pool: ThreadPoolBuilder::new()
                .thread_name(|index| format!("chunk-meshing-{index}"))
                .build()
                .unwrap(),
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

        self.pool.spawn(move || {
            let chunks: Vec<Chunk> = processes
                .into_iter()
                .map(|(mut chunk, mut space)| {
                    if chunk.mesh.is_none() {
                        let min = space.min.to_owned();
                        let coords = space.coords.to_owned();
                        let shape = space.shape.to_owned();

                        chunk.lights = Lights::propagate(
                            &mut space, &min, &coords, &shape, &registry, &config,
                        );
                    }

                    let opaque = Self::mesh_space(&chunk.min, &chunk.max, &space, &registry, false);
                    let transparent =
                        Self::mesh_space(&chunk.min, &chunk.max, &space, &registry, true);

                    chunk.mesh = Some(Mesh {
                        opaque,
                        transparent,
                    });

                    chunk
                })
                .collect();

            sender.send(chunks).unwrap();
        })
    }

    /// Attempt to retrieve the results from `pipeline.process`
    pub fn results(&self) -> Result<Vec<Chunk>, TryRecvError> {
        self.receiver.try_recv()
    }

    /// Mesh a Space struct from specified voxel coordinates, generating the 3D data needed
    /// to render a chunk/space.
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
        let mut aos = Vec::<i32>::new();
        let mut lights = Vec::<i32>::new();

        let &Vec3(min_x, _, min_z) = min;
        let &Vec3(max_x, _, max_z) = max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                let height = space.get_max_height(vx, vz);

                for vy in (0..=height as i32).rev() {
                    let voxel_id = space.get_voxel(vx, vy, vz);
                    let rotation = space.get_voxel_rotation(vx, vy, vz);
                    let block = registry.get_block_by_id(voxel_id);

                    let Block {
                        rotatable,
                        is_solid,
                        is_transparent,
                        is_block,
                        is_plant,
                        is_fluid,
                        faces,
                        ..
                    } = block.to_owned();

                    if (is_solid || is_plant)
                        && (if transparent {
                            is_transparent
                        } else {
                            !is_transparent
                        })
                    {
                        let uv_map = registry.get_uv_map(block);
                        let face_map = Registry::get_faces_map(&faces);

                        if is_block {
                            for BlockFace { dir, side, corners } in BLOCK_FACES.iter() {
                                let mut dir = [dir[0] as f32, dir[1] as f32, dir[2] as f32];

                                if rotatable {
                                    rotation.rotate(&mut dir, false);
                                }

                                let dir = [
                                    dir[0].round() as i32,
                                    dir[1].round() as i32,
                                    dir[2].round() as i32,
                                ];

                                let nvx = vx + dir[0];
                                let nvy = vy + dir[1];
                                let nvz = vz + dir[2];

                                let is_void = !space.contains(nvx, nvy, nvz);
                                let neighbor_id = space.get_voxel(nvx, nvy, nvz);
                                let n_block_type = registry.get_block_by_id(neighbor_id);

                                if is_void
                                    || ((n_block_type.is_transparent && !n_block_type.is_fluid)
                                        || (n_block_type.is_fluid && !is_fluid))
                                        && (!transparent
                                            || n_block_type.is_empty
                                            || neighbor_id != voxel_id
                                            || (n_block_type.transparent_standalone
                                                && (dir[0] + dir[1] + dir[2]) as i32 >= 1))
                                {
                                    let UV {
                                        start_u,
                                        end_u,
                                        start_v,
                                        end_v,
                                    } = uv_map.get(face_map.get(&side).unwrap()).unwrap();

                                    let ndx = (positions.len() as f32 / 3.0).floor() as i32;
                                    let mut face_aos = vec![];

                                    let mut four_sunlights = vec![];
                                    let mut four_red_lights = vec![];
                                    let mut four_green_lights = vec![];
                                    let mut four_blue_lights = vec![];

                                    for CornerData { pos, uv } in corners.iter() {
                                        let mut position =
                                            [pos[0] as f32, pos[1] as f32, pos[2] as f32];

                                        if rotatable {
                                            rotation.rotate(&mut position, true);
                                        }

                                        let pos_x = position[0] + vx as f32;
                                        let pos_y = position[1] + vy as f32;
                                        let pos_z = position[2] + vz as f32;

                                        positions.push(pos_x - min_x as f32);
                                        positions.push(pos_y);
                                        positions.push(pos_z - min_z as f32);

                                        uvs.push(uv[0] as f32 * (end_u - start_u) + start_u);
                                        uvs.push(uv[1] as f32 * (start_v - end_v) + end_v);

                                        // calculating the 8 voxels around this vertex
                                        let dx = position[0].round() as i32;
                                        let dy = position[1].round() as i32;
                                        let dz = position[2].round() as i32;

                                        let dx = if dx == 0 { -1 } else { 1 };
                                        let dy = if dy == 0 { -1 } else { 1 };
                                        let dz = if dz == 0 { -1 } else { 1 };

                                        let mut sum_sunlight = vec![];
                                        let mut sum_red_lights = vec![];
                                        let mut sum_green_lights = vec![];
                                        let mut sum_blue_lights = vec![];

                                        let b000 = get_block_by_voxel(vx, vy, vz, space, registry)
                                            .is_transparent;
                                        let b001 =
                                            get_block_by_voxel(vx, vy, vz + dz, space, registry)
                                                .is_transparent;
                                        let b010 =
                                            get_block_by_voxel(vx, vy + dy, vz, space, registry)
                                                .is_transparent;
                                        let b011 = get_block_by_voxel(
                                            vx,
                                            vy + dy,
                                            vz + dz,
                                            space,
                                            registry,
                                        )
                                        .is_transparent;
                                        let b100 =
                                            get_block_by_voxel(vx + dx, vy, vz, space, registry)
                                                .is_transparent;
                                        let b101 = get_block_by_voxel(
                                            vx + dx,
                                            vy,
                                            vz + dz,
                                            space,
                                            registry,
                                        )
                                        .is_transparent;
                                        let b110 = get_block_by_voxel(
                                            vx + dx,
                                            vy + dy,
                                            vz,
                                            space,
                                            registry,
                                        )
                                        .is_transparent;
                                        let b111 = get_block_by_voxel(
                                            vx + dx,
                                            vy + dy,
                                            vz + dz,
                                            space,
                                            registry,
                                        )
                                        .is_transparent;

                                        if dir[0].abs() == 1 {
                                            face_aos.push(vertex_ao(b110, b101, b111));
                                        } else if dir[1].abs() == 1 {
                                            face_aos.push(vertex_ao(b110, b011, b111));
                                        } else {
                                            face_aos.push(vertex_ao(b011, b101, b111));
                                        }

                                        // TODO: light be leaking

                                        if b000 {
                                            sum_sunlight.push(space.get_sunlight(vx, vy, vz));
                                            sum_red_lights.push(space.get_red_light(vx, vy, vz));
                                            sum_green_lights
                                                .push(space.get_green_light(vx, vy, vz));
                                            sum_blue_lights.push(space.get_blue_light(vx, vy, vz));
                                        }

                                        if b001 {
                                            sum_sunlight.push(space.get_sunlight(vx, vy, vz + dz));
                                            sum_red_lights.push(space.get_red_light(
                                                vx,
                                                vy,
                                                vz + dz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx,
                                                vy,
                                                vz + dz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx,
                                                vy,
                                                vz + dz,
                                            ));
                                        }

                                        if b010 {
                                            sum_sunlight.push(space.get_sunlight(vx, vy + dy, vz));
                                            sum_red_lights.push(space.get_red_light(
                                                vx,
                                                vy + dy,
                                                vz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx,
                                                vy + dy,
                                                vz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx,
                                                vy + dy,
                                                vz,
                                            ));
                                        }

                                        if b011 {
                                            sum_sunlight.push(space.get_sunlight(
                                                vx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_red_lights.push(space.get_red_light(
                                                vx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                        }

                                        if b100 {
                                            sum_sunlight.push(space.get_sunlight(vx + dx, vy, vz));
                                            sum_red_lights.push(space.get_red_light(
                                                vx + dx,
                                                vy,
                                                vz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx + dx,
                                                vy,
                                                vz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx + dx,
                                                vy,
                                                vz,
                                            ));
                                        }

                                        if b101 {
                                            sum_sunlight.push(space.get_sunlight(
                                                vx + dx,
                                                vy,
                                                vz + dz,
                                            ));
                                            sum_red_lights.push(space.get_red_light(
                                                vx + dx,
                                                vy,
                                                vz + dz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx + dx,
                                                vy,
                                                vz + dz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx + dx,
                                                vy,
                                                vz + dz,
                                            ));
                                        }

                                        if b110 {
                                            sum_sunlight.push(space.get_sunlight(
                                                vx + dx,
                                                vy + dy,
                                                vz,
                                            ));
                                            sum_red_lights.push(space.get_red_light(
                                                vx + dx,
                                                vy + dy,
                                                vz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx + dx,
                                                vy + dy,
                                                vz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx + dx,
                                                vy + dy,
                                                vz,
                                            ));
                                        }

                                        if b111 {
                                            sum_sunlight.push(space.get_sunlight(
                                                vx + dx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_red_lights.push(space.get_red_light(
                                                vx + dx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_green_lights.push(space.get_green_light(
                                                vx + dx,
                                                vy + dy,
                                                vz + dz,
                                            ));
                                            sum_blue_lights.push(space.get_blue_light(
                                                vx + dx,
                                                vy + dy,
                                                vz + dz,
                                            ));
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

                                    aos.append(&mut face_aos);

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
                                        lights.push(light as i32);
                                    }
                                }
                            }
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
            aos,
            lights,
        })
    }
}
