use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, Clients, IDComp, Mesher,
    Message, MessageQueues, MessageType, Pipeline, Vec2, WorldConfig, WorldTimingContext,
};
use crate::world::systems::retain_active_client_batches_map;

#[derive(Default)]
pub struct ChunkRequestsSystem {
    to_send_buffer: HashMap<String, HashSet<Vec2<i32>>>,
    to_send_touched_clients_buffer: Vec<String>,
    to_add_back_to_requested_buffer: Vec<Vec2<i32>>,
    chunk_models_buffer: Vec<crate::ChunkProtocol>,
}

#[inline]
fn enqueue_chunk_models_for_client(
    queue: &mut MessageQueues,
    chunk_models_buffer: &mut Vec<crate::ChunkProtocol>,
    client_id: String,
) {
    if chunk_models_buffer.is_empty() {
        return;
    }
    if chunk_models_buffer.len() == 1 {
        if let Some(single_model) = chunk_models_buffer.pop() {
            queue.push((
                Message::new(&MessageType::Load)
                    .chunk_owned(single_model)
                    .build(),
                ClientFilter::Direct(client_id),
            ));
        }
        return;
    }
    let next_chunk_buffer_capacity = chunk_models_buffer.capacity();
    let chunk_models_to_send = std::mem::replace(
        chunk_models_buffer,
        Vec::with_capacity(next_chunk_buffer_capacity),
    );

    let message = Message::new(&MessageType::Load)
        .chunks_owned(chunk_models_to_send)
        .build();
    queue.push((message, ClientFilter::Direct(client_id)));
}

#[inline]
fn flush_chunk_requests_for_client(
    queue: &mut MessageQueues,
    chunks: &Chunks,
    chunk_models_buffer: &mut Vec<crate::ChunkProtocol>,
    client_id: String,
    coords_to_send: &mut HashSet<Vec2<i32>>,
    sub_chunks_u32: u32,
) {
    if coords_to_send.is_empty() {
        return;
    }
    if coords_to_send.len() == 1 {
        if let Some(coords) = coords_to_send.iter().next().copied() {
            coords_to_send.clear();
            if let Some(chunk) = chunks.get(&coords) {
                chunk_models_buffer.clear();
                chunk_models_buffer.push(chunk.to_model(true, true, 0..sub_chunks_u32));
                enqueue_chunk_models_for_client(queue, chunk_models_buffer, client_id);
            }
        }
        return;
    }
    chunk_models_buffer.clear();
    if chunk_models_buffer.capacity() < coords_to_send.len() {
        chunk_models_buffer.reserve(coords_to_send.len() - chunk_models_buffer.len());
    }
    for coords in coords_to_send.drain() {
        if let Some(chunk) = chunks.get(&coords) {
            chunk_models_buffer.push(chunk.to_model(true, true, 0..sub_chunks_u32));
        }
    }
    enqueue_chunk_models_for_client(queue, chunk_models_buffer, client_id);
}

#[inline]
fn retain_active_request_batches(
    to_send: &mut HashMap<String, HashSet<Vec2<i32>>>,
    clients: &Clients,
) {
    retain_active_client_batches_map(to_send, clients);
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
        if client_count == 0 {
            to_send.clear();
            to_send_touched_clients.clear();
            return;
        }
        if (&requests).join().next().is_none() {
            to_send_touched_clients.clear();
            if !can_send_responses {
                to_send.clear();
            }
            return;
        }
        if can_send_responses {
            if to_send.capacity() < client_count && to_send.len() < client_count {
                to_send.reserve(client_count - to_send.len());
            }
            to_send_touched_clients.clear();
            if to_send_touched_clients.capacity() < client_count {
                to_send_touched_clients.reserve(client_count - to_send_touched_clients.len());
            }
            if !to_send.is_empty() {
                retain_active_request_batches(to_send, &clients);
            }
        } else {
            to_send.clear();
            to_send_touched_clients.clear();
        }

        for (id, requests) in (&ids, &mut requests).join() {
            let client_id = id.0.as_str();
            if requests.requests.is_empty() {
                continue;
            }
            to_add_back_to_requested.clear();
            if to_add_back_to_requested.capacity() < requests.requests.len() {
                to_add_back_to_requested
                    .reserve(requests.requests.len() - to_add_back_to_requested.len());
            }
            let mut touched_client = false;
            let mut clients_to_send: Option<&mut HashSet<Vec2<i32>>> = None;

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    if !can_send_responses {
                        to_add_back_to_requested.push(coords);
                        continue;
                    }

                    if clients_to_send.is_none() {
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
                    }
                    let Some(clients_to_send) = clients_to_send.as_deref_mut() else {
                        continue;
                    };

                    if clients_to_send.len() >= max_response_per_tick {
                        if clients_to_send.contains(&coords) {
                            continue;
                        }
                        to_add_back_to_requested.push(coords);
                        continue;
                    }
                    if !clients_to_send.insert(coords) {
                        continue;
                    }
                    if !touched_client {
                        to_send_touched_clients.push(client_id.to_owned());
                        touched_client = true;
                    }

                    interests.add(client_id, &coords);
                } else {
                    let chunk_was_uninterested =
                        interests.add_with_vacancy(client_id, &coords);
                    if chunk_was_uninterested {
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
                }
            }

            if !to_add_back_to_requested.is_empty() {
                requests.requests.append(to_add_back_to_requested);
            }
        }

        if to_send_touched_clients.is_empty() {
            return;
        }
        match to_send_touched_clients.len() {
            1 => {
                let Some(id) = to_send_touched_clients.pop() else {
                    return;
                };
                if let Some(coords_to_send) = to_send.get_mut(&id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
            }
            2 => {
                let Some(first_id) = to_send_touched_clients.pop() else {
                    return;
                };
                let Some(second_id) = to_send_touched_clients.pop() else {
                    if let Some(coords_to_send) = to_send.get_mut(&first_id) {
                        flush_chunk_requests_for_client(
                            &mut queue,
                            &chunks,
                            chunk_models_buffer,
                            first_id,
                            coords_to_send,
                            sub_chunks_u32,
                        );
                    }
                    return;
                };
                if let Some(coords_to_send) = to_send.get_mut(&first_id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        first_id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
                if let Some(coords_to_send) = to_send.get_mut(&second_id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        second_id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
            }
            3 => {
                let Some(first_id) = to_send_touched_clients.pop() else {
                    return;
                };
                let Some(second_id) = to_send_touched_clients.pop() else {
                    if let Some(coords_to_send) = to_send.get_mut(&first_id) {
                        flush_chunk_requests_for_client(
                            &mut queue,
                            &chunks,
                            chunk_models_buffer,
                            first_id,
                            coords_to_send,
                            sub_chunks_u32,
                        );
                    }
                    return;
                };
                let Some(third_id) = to_send_touched_clients.pop() else {
                    if let Some(coords_to_send) = to_send.get_mut(&first_id) {
                        flush_chunk_requests_for_client(
                            &mut queue,
                            &chunks,
                            chunk_models_buffer,
                            first_id,
                            coords_to_send,
                            sub_chunks_u32,
                        );
                    }
                    if let Some(coords_to_send) = to_send.get_mut(&second_id) {
                        flush_chunk_requests_for_client(
                            &mut queue,
                            &chunks,
                            chunk_models_buffer,
                            second_id,
                            coords_to_send,
                            sub_chunks_u32,
                        );
                    }
                    return;
                };
                if let Some(coords_to_send) = to_send.get_mut(&first_id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        first_id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
                if let Some(coords_to_send) = to_send.get_mut(&second_id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        second_id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
                if let Some(coords_to_send) = to_send.get_mut(&third_id) {
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        third_id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
            }
            _ => {
                for id in to_send_touched_clients.drain(..) {
                    let Some(coords_to_send) = to_send.get_mut(&id) else {
                        continue;
                    };
                    flush_chunk_requests_for_client(
                        &mut queue,
                        &chunks,
                        chunk_models_buffer,
                        id,
                        coords_to_send,
                        sub_chunks_u32,
                    );
                }
            }
        }
    }
}
