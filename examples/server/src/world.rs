use hashbrown::HashMap;
use serde::Serialize;
use voxelize::{
    vertex_ao, BlockAccess, BlockIdentity, BlockRegistry, Chunk, ChunkManager, ChunkOptions,
    ChunkStage, CornerData, Face, LightUtils, Mesher, MesherRegistry, SixFacesBuilder, Space,
    TextureAtlas, Vec3, World, BLUE, GREEN, RED, UV,
};
use voxelize_protocol::{GeometryData, Packet, PacketType};

use crate::block::{self, Block};

pub struct TestStage;

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test Stage".to_string()
    }

    fn process(&self, mut chunk: Chunk) -> Chunk {
        let Vec3(x, y, z) = chunk.min;
        let chunk_size = chunk.options.chunk_size;

        println!("Going through test stage: {:?}", chunk.coords);

        for vx in x..x + chunk_size as i32 {
            for vz in z..z + chunk_size as i32 {
                chunk.set_block_id(vx, 0, vz, 1);
            }
        }

        chunk
    }
}

#[derive(Clone, Serialize)]
pub struct TestWorldInitData {
    name: String,
    atlas: Vec<(String, Vec<Face>)>,
}

pub struct TestWorld<T: BlockIdentity + Clone> {
    clients: Vec<String>,
    id: String,
    atlas: TextureAtlas,
    pub chunk_manager: ChunkManager<T>,
    pub packets: Vec<(String, Vec<Packet>)>,
}

pub struct BlockMesher;

impl Mesher<Block> for BlockMesher {
    fn is_applicable(&self, block_id: u32) -> bool {
        block_id != 0
    }

    fn mesh(
        &self,
        min: &Vec3<i32>,
        max: &Vec3<i32>,
        voxel: &Vec3<i32>,
        block_access: &dyn BlockAccess,
        registry: &BlockRegistry<Block>,
        texture_atlas: &TextureAtlas,
    ) -> Vec<GeometryData> {
        let &Vec3(min_x, min_y, min_z) = min;
        let &Vec3(max_x, max_y, max_z) = max;
        let &Vec3(vx, vy, vz) = voxel;

        let block_id: u32 = block_access.get_block_id(vx, vy, vz);
        let rotation = block_access.get_block_rotation(vx, vy, vz);

        let block = registry.get_block_by_id(block_id);
        let mut geometries = vec![];

        if let Some(faces) = texture_atlas.get_faces(&block.name) {
            let mut geometry = GeometryData::new(block_id).block_id(block_id).build();

            for face in faces {
                let Face {
                    dir,
                    corners,
                    range,
                    independent,
                    name,
                } = face.clone();

                // Do rotations here

                let nvx = vx + dir[0];
                let nvy = vy + dir[1];
                let nvz = vz + dir[2];

                let neighbor_id = block_access.get_block_id(nvx, nvy, nvz);

                if neighbor_id != 0 {
                    continue;
                }

                let UV {
                    start_u,
                    start_v,
                    end_u,
                    end_v,
                } = range;

                let ndx = (geometry.positions.len() as f32 / 3.0).floor() as i32;

                let mut face_aos = vec![];

                let mut four_sunlights = vec![];
                let mut four_red_lights = vec![];
                let mut four_green_lights = vec![];
                let mut four_blue_lights = vec![];

                for CornerData { mut pos, uv } in corners.iter() {
                    // Rotate

                    let pos_x = pos[0] + vx as f32;
                    let pos_y = pos[1] + vy as f32;
                    let pos_z = pos[2] + vz as f32;

                    let scale = 0.0;
                    geometry
                        .positions
                        .push(pos_x - min_x as f32 - dir[0] as f32 * scale);
                    geometry
                        .positions
                        .push(pos_y - min_y as f32 - dir[1] as f32 * scale);
                    geometry
                        .positions
                        .push(pos_z - min_z as f32 - dir[2] as f32 * scale);

                    geometry.uvs.push(uv[0] * (end_u - start_u) + start_u);
                    geometry.uvs.push(uv[1] * (end_v - start_v) + start_v);

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

                    let b011 = block_access.get_block_id(vx, vy + dy, vz + dz) == 0;
                    let b101 = block_access.get_block_id(vx + dx, vy, vz + dz) == 0;
                    let b110 = block_access.get_block_id(vx + dx, vy + dy, vz) == 0;
                    let b111 = block_access.get_block_id(vx + dx, vy + dy, vz + dz) == 0;

                    let ao = if block.is_transparent {
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

                    if block.is_transparent {
                        sunlight = block_access.get_sunlight(vx, vy, vz);
                        red_light = block_access.get_torch_light(vx, vy, vz, &RED);
                        green_light = block_access.get_torch_light(vx, vy, vz, &GREEN);
                        blue_light = block_access.get_torch_light(vx, vy, vz, &BLUE);
                    } else {
                        // Loop through all 9 neighbors (including self) of this vertex.
                        for ddx in if dx > 0 { 0..=dx } else { dx..=0 } {
                            for ddy in if dy > 0 { 0..=dy } else { dy..=0 } {
                                for ddz in if dz > 0 { 0..=dz } else { dz..=0 } {
                                    let local_sunlight =
                                        block_access.get_sunlight(vx + ddx, vy + ddy, vz + ddz);
                                    let local_red_light = block_access.get_torch_light(
                                        vx + ddx,
                                        vy + ddy,
                                        vz + ddz,
                                        &RED,
                                    );
                                    let local_green_light = block_access.get_torch_light(
                                        vx + ddx,
                                        vy + ddy,
                                        vz + ddz,
                                        &GREEN,
                                    );
                                    let local_blue_light = block_access.get_torch_light(
                                        vx + ddx,
                                        vy + ddy,
                                        vz + ddz,
                                        &BLUE,
                                    );

                                    if local_sunlight == 0
                                        && local_red_light == 0
                                        && local_green_light == 0
                                        && local_blue_light == 0
                                    {
                                        continue;
                                    }

                                    let diagonal4_id =
                                        block_access.get_block_id(vx + ddx, vy + ddy, vz + ddz);
                                    let diagonal4_block = registry.get_block_by_id(diagonal4_id);

                                    let is_transparent = diagonal4_block.is_transparent;

                                    if !is_transparent {
                                        continue;
                                    }

                                    // The block that we're checking is on the side that the face is facing, so
                                    // check if the diagonal block would be blocking this block's potential light.
                                    // Perpendicular check done by crossing the vectors.
                                    if dir[0] * ddx + dir[1] * ddy + dir[2] * ddz == 0 {
                                        let facing_id = block_access.get_block_id(
                                            vx + ddx * dir[0],
                                            vy + ddy * dir[1],
                                            vz + ddz * dir[2],
                                        );
                                        let facing_block = registry.get_block_by_id(facing_id);

                                        if !facing_block.is_transparent {
                                            continue;
                                        }
                                    }

                                    // Diagonal light leaking fix.
                                    if ddx.abs() + ddy.abs() + ddz.abs() == 3 {
                                        let neighbor_ids = [
                                            block_access.get_block_id(vx + ddx, vy, vz),
                                            block_access.get_block_id(vx, vy + ddy, vz),
                                            block_access.get_block_id(vx, vy, vz + ddz),
                                        ];
                                        let neighbors = [
                                            registry.get_block_by_id(neighbor_ids[0]),
                                            registry.get_block_by_id(neighbor_ids[1]),
                                            registry.get_block_by_id(neighbor_ids[2]),
                                        ];

                                        let diagonal_yz = neighbors[0];
                                        let diagonal_xz = neighbors[1];
                                        let diagonal_xy = neighbors[2];

                                        // Three corners all blocked
                                        if diagonal_yz.is_solid
                                            && diagonal_xz.is_solid
                                            && diagonal_xy.is_solid
                                        {
                                            continue;
                                        }

                                        // Two corners blocked
                                        if diagonal_xy.is_solid && diagonal_xz.is_solid {
                                            let neighbor_y_id =
                                                block_access.get_block_id(vx, vy + ddy, vz);
                                            let neighbor_z_id =
                                                block_access.get_block_id(vx, vy, vz + ddz);

                                            let neighbor_y =
                                                registry.get_block_by_id(neighbor_y_id);
                                            let neighbor_z =
                                                registry.get_block_by_id(neighbor_z_id);

                                            if neighbor_y.is_solid && neighbor_z.is_solid {
                                                continue;
                                            }
                                        }

                                        // XZ
                                        if diagonal_yz.is_solid && diagonal_xy.is_solid {
                                            let neighbor_x_id =
                                                block_access.get_block_id(vx + ddx, vy, vz);
                                            let neighbor_z_id =
                                                block_access.get_block_id(vx, vy, vz + ddz);

                                            let neighbor_x =
                                                registry.get_block_by_id(neighbor_x_id);
                                            let neighbor_z =
                                                registry.get_block_by_id(neighbor_z_id);

                                            if neighbor_x.is_solid && neighbor_z.is_solid {
                                                continue;
                                            }
                                        }

                                        // XY
                                        if diagonal_yz.is_solid && diagonal_xz.is_solid {
                                            let neighbor_x_id =
                                                block_access.get_block_id(vx + ddx, vy, vz);
                                            let neighbor_y_id =
                                                block_access.get_block_id(vx, vy + ddy, vz);

                                            let neighbor_x =
                                                registry.get_block_by_id(neighbor_x_id);
                                            let neighbor_y =
                                                registry.get_block_by_id(neighbor_y_id);

                                            if neighbor_x.is_solid && neighbor_y.is_solid {
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
                            / sum_red_lights.len() as f32)
                            as u32;

                        green_light = (sum_green_lights.iter().sum::<u32>() as f32
                            / sum_green_lights.len() as f32)
                            as u32;

                        blue_light = (sum_blue_lights.iter().sum::<u32>() as f32
                            / sum_blue_lights.len() as f32)
                            as u32;
                    }

                    let mut light = 0;
                    light = LightUtils::insert_red_light(light, red_light);
                    light = LightUtils::insert_green_light(light, green_light);
                    light = LightUtils::insert_blue_light(light, blue_light);
                    light = LightUtils::insert_sunlight(light, sunlight);
                    geometry.lights.push(light as i32 | ao << 16);

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
                geometry.indices.push(ndx);
                geometry.indices.push(ndx + 1);

                if face_aos[0] + face_aos[3] > face_aos[1] + face_aos[2]
                    || (ozao_r || ozao_g || ozao_b)
                    || (anz_r || anz_g || anz_b)
                {
                    // generate flipped quad
                    geometry.indices.push(ndx + 3);
                    geometry.indices.push(ndx + 3);
                    geometry.indices.push(ndx + 2);
                    geometry.indices.push(ndx);
                } else {
                    geometry.indices.push(ndx + 2);
                    geometry.indices.push(ndx + 2);
                    geometry.indices.push(ndx + 1);
                    geometry.indices.push(ndx + 3);
                }
            }
        }

        geometries
    }
}

impl Default for TestWorld<Block> {
    fn default() -> Self {
        let chunk_options = ChunkOptions::new(16, 256, 4, 16);

        let air = Block::new(0, "air").build();
        let stone = Block::new(1, "stone").build();
        let dirt = Block::new(2, "dirt").build();

        let block_registry = BlockRegistry::with_blocks(vec![air, stone, dirt]);

        let mut mesher_registry = MesherRegistry::new();
        mesher_registry.register(BlockMesher);

        let six_faces = SixFacesBuilder::new().build();

        let mut texture_atlas = TextureAtlas::new();
        texture_atlas.add_faces("stone", &six_faces);
        texture_atlas.add_faces("dirt", &six_faces);
        texture_atlas.generate();

        let mut chunk_manager = ChunkManager::new(
            block_registry,
            mesher_registry,
            texture_atlas.clone(),
            &chunk_options,
        );

        chunk_manager.start_job_processor(8);
        chunk_manager.add_stage(TestStage);

        Self {
            clients: vec![],
            id: "test".to_string(),
            atlas: texture_atlas,
            chunk_manager,
            packets: vec![],
        }
    }
}

impl World for TestWorld<Block> {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        "Test World"
    }

    fn clients(&self) -> Vec<&str> {
        self.clients.iter().map(|s| s.as_str()).collect()
    }

    fn add_client(&mut self, client_id: &str) {
        self.clients.push(client_id.to_string());

        // Send the init packet to the client
        self.packets.push((
            client_id.to_string(),
            vec![Packet::new(PacketType::Init)
                .json(TestWorldInitData {
                    name: self.name().to_string(),
                    atlas: self
                        .atlas
                        .groups
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect(),
                })
                .build()],
        ))
    }

    fn remove_client(&mut self, client_id: &str) {
        self.clients.retain(|s| s != client_id);
    }

    fn packets(&mut self) -> Vec<(String, Vec<Packet>)> {
        self.packets.drain(..).collect()
    }

    fn on_packet(&mut self, client_id: &str, packet: Packet) {
        println!("{}: {:?}", client_id, packet);
    }

    fn update(&mut self) {
        self.chunk_manager.update();

        let done_jobs = self.chunk_manager.get_done_jobs();

        for job in done_jobs {
            let coords = job.coords;
            let chunk = self.chunk_manager.chunks.get(&coords);

            if let Some(chunk) = chunk {
                println!("Chunk status: {:?}", chunk.status);

                let Vec3(x, y, z) = chunk.min;
                println!("Block at 0, 0, 0: {}", chunk.get_block_id(x, y, z));
            }
        }
    }
}
