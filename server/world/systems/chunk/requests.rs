use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, Clients, IDComp, Mesher,
    Message, MessageQueues, MessageType, Pipeline, Vec2, WorldConfig, WorldTimingContext,
};

#[derive(Default)]
pub struct ChunkRequestsSystem {
    to_send_buffer: HashMap<String, HashSet<Vec2<i32>>>,
    to_send_touched_clients_buffer: Vec<String>,
    to_add_back_to_requested_buffer: Vec<Vec2<i32>>,
    chunk_models_buffer: Vec<crate::ChunkProtocol>,
}

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Clients>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, MessageQueues>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, ChunkRequestsComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            chunks,
            config,
            clients,
            mut interests,
            mut pipeline,
            mut mesher,
            mut queue,
            ids,
            mut requests,
            timing,
        ) = data;
        let _t = timing.timer("chunk-requests");

        let max_response_per_tick = config.max_response_per_tick;
        let can_send_responses = max_response_per_tick > 0;
        let initial_send_set_capacity = max_response_per_tick.min(8).max(1);
        let sub_chunks_u32 = if config.sub_chunks > u32::MAX as usize {
            u32::MAX
        } else {
            config.sub_chunks as u32
        };

        let to_send = &mut self.to_send_buffer;
        let to_send_touched_clients = &mut self.to_send_touched_clients_buffer;
        let to_add_back_to_requested = &mut self.to_add_back_to_requested_buffer;
        let chunk_models_buffer = &mut self.chunk_models_buffer;
        let client_count = clients.len();
        if to_send.capacity() < client_count {
            to_send.reserve(client_count - to_send.capacity());
        }
        to_send_touched_clients.clear();
        if to_send_touched_clients.capacity() < client_count {
            to_send_touched_clients.reserve(client_count - to_send_touched_clients.capacity());
        }
        if clients.is_empty() {
            to_send.clear();
        } else if !to_send.is_empty() && to_send.len() > clients.len() {
            to_send.retain(|client_id, _| clients.contains_key(client_id));
        }
        if !can_send_responses {
            to_send.clear();
        }

        for (id, requests) in (&ids, &mut requests).join() {
            let client_id = id.0.as_str();
            if requests.requests.is_empty() {
                continue;
            }
            to_add_back_to_requested.clear();
            if to_add_back_to_requested.capacity() < requests.requests.len() {
                to_add_back_to_requested
                    .reserve(requests.requests.len() - to_add_back_to_requested.capacity());
            }
            let mut touched_client = false;
            let mut clients_to_send: Option<&mut HashSet<Vec2<i32>>> = None;

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    if !can_send_responses {
                        to_add_back_to_requested.push(coords);
                        continue;
                    }

                    let clients_to_send = if let Some(clients_to_send) = clients_to_send.as_deref_mut()
                    {
                        clients_to_send
                    } else {
                        let fetched_clients_to_send =
                            match to_send.raw_entry_mut().from_key(client_id) {
                                RawEntryMut::Occupied(entry) => entry.into_mut(),
                                RawEntryMut::Vacant(entry) => {
                                    entry
                                        .insert(
                                            client_id.to_owned(),
                                            HashSet::with_capacity(initial_send_set_capacity),
                                        )
                                        .1
                                }
                            };
                        if !fetched_clients_to_send.is_empty() {
                            to_send_touched_clients.push(client_id.to_owned());
                            touched_client = true;
                        } else {
                            touched_client = false;
                        }
                        clients_to_send = Some(fetched_clients_to_send);
                        clients_to_send.as_deref_mut().unwrap()
                    };

                    if clients_to_send.len() >= max_response_per_tick {
                        to_add_back_to_requested.push(coords);
                        continue;
                    }
                    if !touched_client {
                        to_send_touched_clients.push(client_id.to_owned());
                        touched_client = true;
                    }

                    interests.add(client_id, &coords);
                    clients_to_send.insert(coords);
                } else {
                    if !interests.has_interests(&coords) {
                        if let Some((min_x, max_x, min_z, max_z)) =
                            chunks.light_traversed_bounds(&coords)
                        {
                            for x in min_x..=max_x {
                                for z in min_z..=max_z {
                                    let neighbor_coords = Vec2(x, z);
                                    match chunks.raw(&neighbor_coords) {
                                        Some(chunk)
                                            if matches!(chunk.status, ChunkStatus::Meshing) =>
                                        {
                                            mesher.add_chunk(&neighbor_coords, false);
                                        }
                                        None | Some(_) => {
                                            pipeline.add_chunk(&neighbor_coords, false);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    interests.add(client_id, &coords);
                }
            }

            if !to_add_back_to_requested.is_empty() {
                requests.requests.append(to_add_back_to_requested);
            }
        }

        if to_send_touched_clients.is_empty() {
            return;
        }
        for id in to_send_touched_clients.drain(..) {
            let Some(coords_to_send) = to_send.get_mut(&id) else {
                continue;
            };
            if coords_to_send.is_empty() {
                continue;
            }
            chunk_models_buffer.clear();
            if chunk_models_buffer.capacity() < coords_to_send.len() {
                chunk_models_buffer.reserve(coords_to_send.len() - chunk_models_buffer.capacity());
            }
            for coords in coords_to_send.drain() {
                if let Some(chunk) = chunks.get(&coords) {
                    chunk_models_buffer.push(chunk.to_model(true, true, 0..sub_chunks_u32));
                }
            }
            if chunk_models_buffer.is_empty() {
                continue;
            }
            let next_chunk_buffer_capacity = chunk_models_buffer.capacity();
            let chunk_models_to_send = std::mem::replace(
                chunk_models_buffer,
                Vec::with_capacity(next_chunk_buffer_capacity),
            );

            let message = Message::new(&MessageType::Load)
                .chunks_owned(chunk_models_to_send)
                .build();
            queue.push((message, ClientFilter::Direct(id)));
        }
    }
}
