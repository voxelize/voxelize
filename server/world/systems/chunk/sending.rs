use hashbrown::HashMap;
use specs::{ReadExpect, System, WriteExpect};
use std::collections::VecDeque;

use crate::{
    ChunkInterests, ChunkProtocol, Chunks, ClientFilter, Message, MessageQueues, MessageType,
    WorldConfig,
};

#[derive(Default)]
pub struct ChunkSendingSystem;

impl ChunkSendingSystem {
    pub fn new() -> Self {
        ChunkSendingSystem
    }
}

impl<'a> System<'a> for ChunkSendingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, ChunkInterests>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueues>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, interests, mut chunks, mut queue) = data;

        if chunks.to_send.is_empty() {
            return;
        }

        let mut to_send = VecDeque::new();
        std::mem::swap(&mut chunks.to_send, &mut to_send);

        let mut client_load_mesh: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_load_data: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_update_mesh: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_update_data: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_load_lod: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_update_lod: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();

        while let Some((coords, msg_type)) = to_send.pop_front() {
            let chunk = match chunks.get_mut(&coords) {
                Some(c) => c,
                None => panic!("Something went wrong with sending chunks..."),
            };

            let interested_clients: Vec<String> = interests
                .get_interests(&coords)
                .map(|set| set.iter().cloned().collect())
                .unwrap_or_default();

            if interested_clients.is_empty() {
                continue;
            }

            // Clients interested in the chunk as a reduced-detail mesh get
            // only the compact LOD model for their level — never voxel or
            // light data — on both the load and the update path.
            let mut full_clients: Vec<&String> = Vec::with_capacity(interested_clients.len());
            {
                let lod_bucket = if msg_type == MessageType::Load {
                    &mut client_load_lod
                } else {
                    &mut client_update_lod
                };

                for client_id in &interested_clients {
                    match interests.get_lod(client_id, &coords) {
                        Some(level) => {
                            if let Some(lod_model) = chunk.to_lod_model(level) {
                                lod_bucket
                                    .entry(client_id.clone())
                                    .or_default()
                                    .push(lod_model);
                            }
                        }
                        None => full_clients.push(client_id),
                    }
                }
            }

            if msg_type == MessageType::Load {
                if full_clients.is_empty() {
                    continue;
                }

                let mesh_model = chunk.to_model(true, false, 0..(config.sub_chunks as u32));
                let data_model = chunk.to_model(false, true, 0..(config.sub_chunks as u32));

                for client_id in &full_clients {
                    if !config.client_only_meshing {
                        client_load_mesh
                            .entry((*client_id).clone())
                            .or_default()
                            .push(mesh_model.clone());
                    }
                    client_load_data
                        .entry((*client_id).clone())
                        .or_default()
                        .push(data_model.clone());
                }
            } else {
                let updated_levels: Vec<u32> = chunk.updated_levels.drain().collect();

                if full_clients.is_empty() {
                    continue;
                }

                if !updated_levels.is_empty() {
                    let min_level = *updated_levels.iter().min().unwrap();
                    let max_level = *updated_levels.iter().max().unwrap();
                    let mesh_model = chunk.to_model(true, false, min_level..(max_level + 1));

                    for client_id in &full_clients {
                        if !config.client_only_meshing {
                            client_update_mesh
                                .entry((*client_id).clone())
                                .or_default()
                                .push(mesh_model.clone());
                        }
                    }
                }

                let data_model = chunk.to_model(false, true, 0..0);
                for client_id in &full_clients {
                    client_update_data
                        .entry((*client_id).clone())
                        .or_default()
                        .push(data_model.clone());
                }
            }
        }

        let mut flush = |batches: HashMap<String, Vec<ChunkProtocol>>, msg_type: &MessageType| {
            for (client_id, chunk_models) in batches {
                if !chunk_models.is_empty() {
                    queue.push((
                        Message::new(msg_type).chunks(&chunk_models).build(),
                        ClientFilter::Direct(client_id),
                    ));
                }
            }
        };

        flush(client_load_mesh, &MessageType::Load);
        flush(client_load_data, &MessageType::Load);
        flush(client_load_lod, &MessageType::Load);
        flush(client_update_mesh, &MessageType::Update);
        flush(client_update_data, &MessageType::Update);
        flush(client_update_lod, &MessageType::Update);
    }
}
