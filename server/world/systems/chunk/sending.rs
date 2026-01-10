use hashbrown::HashMap;
use specs::{ReadExpect, System, WriteExpect};
use std::collections::VecDeque;

use crate::{
    ChunkInterests, ChunkProtocol, Chunks, ClientFilter, Message, MessageQueues, MessageType,
    WorldConfig, WorldTimingContext,
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
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, interests, mut chunks, mut queue, timing) = data;
        let _t = timing.timer("chunk-sending");

        if chunks.to_send.is_empty() {
            return;
        }

        let mut to_send = VecDeque::new();
        std::mem::swap(&mut chunks.to_send, &mut to_send);

        let mut client_load_mesh: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_load_data: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_update_mesh: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut client_update_data: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();

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

            if msg_type == MessageType::Load {
                let mesh_model =
                    chunk.to_model(true, false, 0..(config.sub_chunks as u32));
                let data_model =
                    chunk.to_model(false, true, 0..(config.sub_chunks as u32));

                for client_id in &interested_clients {
                    client_load_mesh
                        .entry(client_id.clone())
                        .or_default()
                        .push(mesh_model.clone());
                    client_load_data
                        .entry(client_id.clone())
                        .or_default()
                        .push(data_model.clone());
                }
            } else {
                let updated_levels: Vec<u32> = chunk.updated_levels.drain().collect();

                if !updated_levels.is_empty() {
                    let min_level = *updated_levels.iter().min().unwrap();
                    let max_level = *updated_levels.iter().max().unwrap();
                    let mesh_model = chunk.to_model(true, false, min_level..(max_level + 1));

                    for client_id in &interested_clients {
                        client_update_mesh
                            .entry(client_id.clone())
                            .or_default()
                            .push(mesh_model.clone());
                    }
                }

                let data_model = chunk.to_model(false, true, 0..0);
                for client_id in &interested_clients {
                    client_update_data
                        .entry(client_id.clone())
                        .or_default()
                        .push(data_model.clone());
                }
            }
        }

        for (client_id, chunk_models) in client_load_mesh {
            if !chunk_models.is_empty() {
                queue.push((
                    Message::new(&MessageType::Load)
                        .chunks(&chunk_models)
                        .build(),
                    ClientFilter::Direct(client_id),
                ));
            }
        }

        for (client_id, chunk_models) in client_load_data {
            if !chunk_models.is_empty() {
                queue.push((
                    Message::new(&MessageType::Load)
                        .chunks(&chunk_models)
                        .build(),
                    ClientFilter::Direct(client_id),
                ));
            }
        }

        for (client_id, chunk_models) in client_update_mesh {
            if !chunk_models.is_empty() {
                queue.push((
                    Message::new(&MessageType::Update)
                        .chunks(&chunk_models)
                        .build(),
                    ClientFilter::Direct(client_id),
                ));
            }
        }

        for (client_id, chunk_models) in client_update_data {
            if !chunk_models.is_empty() {
                queue.push((
                    Message::new(&MessageType::Update)
                        .chunks(&chunk_models)
                        .build(),
                    ClientFilter::Direct(client_id),
                ));
            }
        }
    }
}
