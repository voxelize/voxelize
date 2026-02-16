use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    ChunkInterests, ChunkProtocol, Chunks, ClientFilter, Clients, Message, MessageQueues,
    MessageType, WorldConfig, WorldTimingContext,
};
use crate::world::systems::retain_active_client_batches_map;

#[derive(Default)]
pub struct ChunkSendingSystem {
    client_load_mesh_buffer: HashMap<String, Vec<ChunkProtocol>>,
    client_load_data_buffer: HashMap<String, Vec<ChunkProtocol>>,
    client_update_mesh_buffer: HashMap<String, Vec<ChunkProtocol>>,
    client_update_data_buffer: HashMap<String, Vec<ChunkProtocol>>,
    client_load_mesh_touched: Vec<String>,
    client_load_data_touched: Vec<String>,
    client_update_mesh_touched: Vec<String>,
    client_update_data_touched: Vec<String>,
}

impl ChunkSendingSystem {
    pub fn new() -> Self {
        Self::default()
    }
}

#[inline]
fn take_updated_level_range(updated_levels: &mut HashSet<u32>) -> Option<(u32, u32)> {
    if updated_levels.is_empty() {
        return None;
    }
    if updated_levels.len() == 1 {
        let Some(level) = updated_levels.iter().next().copied() else {
            return None;
        };
        updated_levels.clear();
        let max_level_exclusive = level.saturating_add(1);
        if max_level_exclusive <= level {
            return None;
        }
        return Some((level, max_level_exclusive));
    }

    let mut iter = updated_levels.drain();
    let first = iter.next()?;
    let mut min_level = first;
    let mut max_level = first;
    for level in iter {
        min_level = min_level.min(level);
        max_level = max_level.max(level);
    }
    let max_level_exclusive = max_level.saturating_add(1);
    if max_level_exclusive <= min_level {
        return None;
    }
    Some((min_level, max_level_exclusive))
}

#[cfg(test)]
#[inline]
fn flush_chunk_batches_in_place(
    queue: &mut MessageQueues,
    message_type: &MessageType,
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
) {
    for (client_id, chunk_models) in batches.iter_mut() {
        let Some(chunk_models_to_send) = take_chunk_models_to_send(chunk_models) else {
            continue;
        };
        queue.push((
            match chunk_models_to_send {
                Ok(many_models) => Message::new(message_type).chunks_owned(many_models).build(),
                Err(single_model) => Message::new(message_type).chunk_owned(single_model).build(),
            },
            ClientFilter::Direct(client_id.clone()),
        ));
    }
}

#[inline]
fn push_chunk_batch(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    touched_clients: &mut Vec<String>,
    client_id: &str,
    chunk_model: &ChunkProtocol,
) {
    match batches.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(mut entry) => {
            let chunk_models = entry.get_mut();
            if chunk_models.is_empty() {
                touched_clients.push(client_id.to_owned());
            }
            chunk_models.push(chunk_model.clone());
        }
        RawEntryMut::Vacant(entry) => {
            touched_clients.push(client_id.to_owned());
            let mut chunk_models = Vec::with_capacity(1);
            chunk_models.push(chunk_model.clone());
            entry.insert(client_id.to_owned(), chunk_models);
        }
    }
}

#[inline]
fn push_chunk_batch_owned(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    touched_clients: &mut Vec<String>,
    client_id: &str,
    chunk_model: ChunkProtocol,
) {
    match batches.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(mut entry) => {
            let chunk_models = entry.get_mut();
            if chunk_models.is_empty() {
                touched_clients.push(client_id.to_owned());
            }
            chunk_models.push(chunk_model);
        }
        RawEntryMut::Vacant(entry) => {
            touched_clients.push(client_id.to_owned());
            let mut chunk_models = Vec::with_capacity(1);
            chunk_models.push(chunk_model);
            entry.insert(client_id.to_owned(), chunk_models);
        }
    }
}

#[inline]
fn next_interested_client_id<'a, I>(interested_iter: &mut I) -> &'a str
where
    I: Iterator<Item = &'a String>,
{
    let Some(client_id) = interested_iter.next() else {
        unreachable!("interested client count matched branch");
    };
    client_id.as_str()
}

#[inline]
fn fanout_chunk_model(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    touched_clients: &mut Vec<String>,
    interested_clients: &HashSet<String>,
    chunk_model: ChunkProtocol,
) {
    match interested_clients.len() {
        0 => return,
        1 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        2 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        3 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        4 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            let fourth_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fourth_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        5 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            let fourth_client_id = next_interested_client_id(&mut interested_iter);
            let fifth_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fourth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fifth_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        6 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            let fourth_client_id = next_interested_client_id(&mut interested_iter);
            let fifth_client_id = next_interested_client_id(&mut interested_iter);
            let sixth_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fourth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fifth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, sixth_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        7 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            let fourth_client_id = next_interested_client_id(&mut interested_iter);
            let fifth_client_id = next_interested_client_id(&mut interested_iter);
            let sixth_client_id = next_interested_client_id(&mut interested_iter);
            let seventh_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fourth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fifth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, sixth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, seventh_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        8 => {
            let mut interested_iter = interested_clients.iter();
            let first_client_id = next_interested_client_id(&mut interested_iter);
            let second_client_id = next_interested_client_id(&mut interested_iter);
            let third_client_id = next_interested_client_id(&mut interested_iter);
            let fourth_client_id = next_interested_client_id(&mut interested_iter);
            let fifth_client_id = next_interested_client_id(&mut interested_iter);
            let sixth_client_id = next_interested_client_id(&mut interested_iter);
            let seventh_client_id = next_interested_client_id(&mut interested_iter);
            let eighth_client_id = next_interested_client_id(&mut interested_iter);
            push_chunk_batch(batches, touched_clients, second_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, third_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fourth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, fifth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, sixth_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, seventh_client_id, &chunk_model);
            push_chunk_batch(batches, touched_clients, eighth_client_id, &chunk_model);
            push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
            return;
        }
        _ => {}
    }

    let mut interested_iter = interested_clients.iter();
    let first_client_id = next_interested_client_id(&mut interested_iter);

    for client_id in interested_iter {
        push_chunk_batch(batches, touched_clients, client_id, &chunk_model);
    }

    push_chunk_batch_owned(batches, touched_clients, first_client_id, chunk_model);
}

#[inline]
fn prepare_chunk_batch_buffer(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    touched_clients: &mut Vec<String>,
    client_capacity_hint: usize,
) {
    if batches.capacity() < client_capacity_hint && batches.len() < client_capacity_hint {
        batches.reserve(client_capacity_hint - batches.len());
    }
    touched_clients.clear();
    if touched_clients.capacity() < client_capacity_hint {
        touched_clients.reserve(client_capacity_hint - touched_clients.len());
    }
}

#[inline]
fn retain_active_client_batches(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    clients: &Clients,
) {
    retain_active_client_batches_map(batches, clients);
}

#[inline]
fn take_chunk_models_to_send(
    chunk_models: &mut Vec<ChunkProtocol>,
) -> Option<Result<Vec<ChunkProtocol>, ChunkProtocol>> {
    if chunk_models.is_empty() {
        return None;
    }
    if chunk_models.len() == 1 {
        let Some(single_model) = chunk_models.pop() else {
            unreachable!("single chunk model length matched branch");
        };
        return Some(Err(single_model));
    }
    let next_chunk_capacity = chunk_models.capacity();
    Some(Ok(std::mem::replace(
        chunk_models,
        Vec::with_capacity(next_chunk_capacity),
    )))
}

#[inline]
fn flush_chunk_batch_for_client(
    queue: &mut MessageQueues,
    message_type: &MessageType,
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    client_id: String,
) {
    let Some(chunk_models) = batches.get_mut(&client_id) else {
        return;
    };
    let Some(chunk_models_to_send) = take_chunk_models_to_send(chunk_models) else {
        return;
    };
    let message = match chunk_models_to_send {
        Ok(many_models) => Message::new(message_type).chunks_owned(many_models).build(),
        Err(single_model) => Message::new(message_type).chunk_owned(single_model).build(),
    };
    queue.push((message, ClientFilter::Direct(client_id)));
}

#[inline]
fn pop_touched_client_id(touched_clients: &mut Vec<String>) -> String {
    let Some(client_id) = touched_clients.pop() else {
        unreachable!("touched-client length matched branch");
    };
    client_id
}

#[inline]
fn flush_chunk_batches_touched(
    queue: &mut MessageQueues,
    message_type: &MessageType,
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    touched_clients: &mut Vec<String>,
) {
    if touched_clients.is_empty() {
        return;
    }
    match touched_clients.len() {
        1 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
        }
        2 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
        }
        3 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
        }
        4 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            let fourth_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fourth_client_id);
        }
        5 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            let fourth_client_id = pop_touched_client_id(touched_clients);
            let fifth_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fourth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fifth_client_id);
        }
        6 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            let fourth_client_id = pop_touched_client_id(touched_clients);
            let fifth_client_id = pop_touched_client_id(touched_clients);
            let sixth_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fourth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fifth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, sixth_client_id);
        }
        7 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            let fourth_client_id = pop_touched_client_id(touched_clients);
            let fifth_client_id = pop_touched_client_id(touched_clients);
            let sixth_client_id = pop_touched_client_id(touched_clients);
            let seventh_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fourth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fifth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, sixth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, seventh_client_id);
        }
        8 => {
            let first_client_id = pop_touched_client_id(touched_clients);
            let second_client_id = pop_touched_client_id(touched_clients);
            let third_client_id = pop_touched_client_id(touched_clients);
            let fourth_client_id = pop_touched_client_id(touched_clients);
            let fifth_client_id = pop_touched_client_id(touched_clients);
            let sixth_client_id = pop_touched_client_id(touched_clients);
            let seventh_client_id = pop_touched_client_id(touched_clients);
            let eighth_client_id = pop_touched_client_id(touched_clients);
            flush_chunk_batch_for_client(queue, message_type, batches, first_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, second_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, third_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fourth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, fifth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, sixth_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, seventh_client_id);
            flush_chunk_batch_for_client(queue, message_type, batches, eighth_client_id);
        }
        _ => {
            while let Some(client_id) = touched_clients.pop() {
                flush_chunk_batch_for_client(queue, message_type, batches, client_id);
            }
        }
    }
}

#[cfg(test)]
#[inline]
fn flush_chunk_batches(
    queue: &mut MessageQueues,
    message_type: &MessageType,
    mut batches: HashMap<String, Vec<ChunkProtocol>>,
) {
    flush_chunk_batches_in_place(queue, message_type, &mut batches);
}

impl<'a> System<'a> for ChunkSendingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, ChunkInterests>,
        ReadExpect<'a, Clients>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueues>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, interests, clients, mut chunks, mut queue, timing) = data;
        let _t = timing.timer("chunk-sending");
        let sub_chunks_u32 = if config.sub_chunks > u32::MAX as usize {
            u32::MAX
        } else {
            config.sub_chunks as u32
        };

        if chunks.to_send.is_empty() {
            chunks.to_send_lookup.clear();
            if clients.is_empty() {
                self.client_load_mesh_buffer.clear();
                self.client_load_data_buffer.clear();
                self.client_update_mesh_buffer.clear();
                self.client_update_data_buffer.clear();
                self.client_load_mesh_touched.clear();
                self.client_load_data_touched.clear();
                self.client_update_mesh_touched.clear();
                self.client_update_data_touched.clear();
            }
            return;
        }

        let to_send_capacity = chunks.to_send.capacity();
        let to_send = std::mem::replace(
            &mut chunks.to_send,
            std::collections::VecDeque::with_capacity(to_send_capacity),
        );
        chunks.to_send_lookup.clear();
        if clients.is_empty() {
            self.client_load_mesh_buffer.clear();
            self.client_load_data_buffer.clear();
            self.client_update_mesh_buffer.clear();
            self.client_update_data_buffer.clear();
            self.client_load_mesh_touched.clear();
            self.client_load_data_touched.clear();
            self.client_update_mesh_touched.clear();
            self.client_update_data_touched.clear();

            for (coords, msg_type) in to_send {
                if msg_type == MessageType::Update {
                    if let Some(chunk) = chunks.get_mut(&coords) {
                        chunk.updated_levels.clear();
                    }
                }
            }
            return;
        }

        let client_load_mesh = &mut self.client_load_mesh_buffer;
        let client_load_data = &mut self.client_load_data_buffer;
        let client_update_mesh = &mut self.client_update_mesh_buffer;
        let client_update_data = &mut self.client_update_data_buffer;
        let client_count = clients.len();
        retain_active_client_batches(client_load_mesh, &clients);
        retain_active_client_batches(client_load_data, &clients);
        retain_active_client_batches(client_update_mesh, &clients);
        retain_active_client_batches(client_update_data, &clients);
        let client_load_mesh_touched = &mut self.client_load_mesh_touched;
        let client_load_data_touched = &mut self.client_load_data_touched;
        let client_update_mesh_touched = &mut self.client_update_mesh_touched;
        let client_update_data_touched = &mut self.client_update_data_touched;
        prepare_chunk_batch_buffer(client_load_mesh, client_load_mesh_touched, client_count);
        prepare_chunk_batch_buffer(client_load_data, client_load_data_touched, client_count);
        prepare_chunk_batch_buffer(
            client_update_mesh,
            client_update_mesh_touched,
            client_count,
        );
        prepare_chunk_batch_buffer(
            client_update_data,
            client_update_data_touched,
            client_count,
        );

        for (coords, msg_type) in to_send {
            let Some(chunk) = chunks.get_mut(&coords) else {
                continue;
            };

            let Some(interested_clients) = interests.get_interests(&coords) else {
                continue;
            };
            if interested_clients.is_empty() {
                continue;
            }

            if msg_type == MessageType::Load {
                let mesh_model = chunk.to_model(true, false, 0..sub_chunks_u32);
                let data_model = chunk.to_model(false, true, 0..sub_chunks_u32);

                fanout_chunk_model(
                    client_load_mesh,
                    client_load_mesh_touched,
                    interested_clients,
                    mesh_model,
                );
                fanout_chunk_model(
                    client_load_data,
                    client_load_data_touched,
                    interested_clients,
                    data_model,
                );
            } else {
                if let Some((min_level, max_level_exclusive)) =
                    take_updated_level_range(&mut chunk.updated_levels)
                {
                    let mesh_model = chunk.to_model(true, false, min_level..max_level_exclusive);

                    fanout_chunk_model(
                        client_update_mesh,
                        client_update_mesh_touched,
                        interested_clients,
                        mesh_model,
                    );
                }

                let data_model = chunk.to_model(false, true, 0..0);
                fanout_chunk_model(
                    client_update_data,
                    client_update_data_touched,
                    interested_clients,
                    data_model,
                );
            }
        }

        flush_chunk_batches_touched(
            &mut queue,
            &MessageType::Load,
            client_load_mesh,
            client_load_mesh_touched,
        );
        flush_chunk_batches_touched(
            &mut queue,
            &MessageType::Load,
            client_load_data,
            client_load_data_touched,
        );
        flush_chunk_batches_touched(
            &mut queue,
            &MessageType::Update,
            client_update_mesh,
            client_update_mesh_touched,
        );
        flush_chunk_batches_touched(
            &mut queue,
            &MessageType::Update,
            client_update_data,
            client_update_data_touched,
        );
    }
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;
    use hashbrown::HashSet;

    use crate::{ChunkProtocol, ClientFilter, MessageQueues, MessageType};

    use super::{fanout_chunk_model, flush_chunk_batches, take_updated_level_range};

    #[test]
    fn take_updated_level_range_returns_none_for_empty_sets() {
        let mut levels = HashSet::new();
        assert_eq!(take_updated_level_range(&mut levels), None);
    }

    #[test]
    fn take_updated_level_range_returns_min_and_exclusive_max() {
        let mut levels = HashSet::new();
        levels.insert(7);
        levels.insert(3);
        levels.insert(5);

        assert_eq!(take_updated_level_range(&mut levels), Some((3, 8)));
        assert!(levels.is_empty());
    }

    #[test]
    fn take_updated_level_range_handles_single_level() {
        let mut levels = HashSet::new();
        levels.insert(4);

        assert_eq!(take_updated_level_range(&mut levels), Some((4, 5)));
        assert!(levels.is_empty());
    }

    #[test]
    fn take_updated_level_range_saturates_exclusive_max() {
        let mut levels = HashSet::new();
        levels.insert(u32::MAX);
        assert_eq!(take_updated_level_range(&mut levels), None);
    }

    #[test]
    fn flush_chunk_batches_emits_only_non_empty_payloads() {
        let mut queue = MessageQueues::new();
        let mut batches = HashMap::new();
        batches.insert("a".to_string(), Vec::new());
        batches.insert(
            "b".to_string(),
            vec![ChunkProtocol {
                x: 0,
                z: 0,
                id: "chunk-0-0".to_string(),
                meshes: Vec::new(),
                voxels: None,
                lights: None,
            }],
        );

        flush_chunk_batches(&mut queue, &MessageType::Load, batches);

        assert_eq!(queue.queue_stats(), (0, 0, 1));
        let mut drained = queue.drain_prioritized();
        assert_eq!(drained.len(), 1);
        let (_, filter) = drained.pop().expect("expected one queued message");
        match filter {
            ClientFilter::Direct(id) => assert_eq!(id, "b"),
            _ => panic!("expected direct client filter"),
        }
    }

    #[test]
    fn fanout_chunk_model_populates_all_six_recipients() {
        let mut batches: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut touched_clients = Vec::new();
        let interested_clients: HashSet<String> =
            ["a", "b", "c", "d", "e", "f"]
                .into_iter()
                .map(str::to_string)
                .collect();
        let chunk_model = ChunkProtocol {
            x: 7,
            z: -3,
            id: "chunk-7--3".to_string(),
            meshes: Vec::new(),
            voxels: None,
            lights: None,
        };

        fanout_chunk_model(
            &mut batches,
            &mut touched_clients,
            &interested_clients,
            chunk_model,
        );

        assert_eq!(batches.len(), interested_clients.len());
        let touched_ids: HashSet<_> = touched_clients.into_iter().collect();
        assert_eq!(touched_ids, interested_clients);
        for client_id in ["a", "b", "c", "d", "e", "f"] {
            let client_chunks = batches
                .get(client_id)
                .expect("chunk fanout missing expected recipient");
            assert_eq!(client_chunks.len(), 1);
            assert_eq!(client_chunks[0].id, "chunk-7--3");
        }
    }

    #[test]
    fn fanout_chunk_model_populates_all_eight_recipients() {
        let mut batches: HashMap<String, Vec<ChunkProtocol>> = HashMap::new();
        let mut touched_clients = Vec::new();
        let interested_clients: HashSet<String> = ["a", "b", "c", "d", "e", "f", "g", "h"]
            .into_iter()
            .map(str::to_string)
            .collect();
        let chunk_model = ChunkProtocol {
            x: 9,
            z: -4,
            id: "chunk-9--4".to_string(),
            meshes: Vec::new(),
            voxels: None,
            lights: None,
        };

        fanout_chunk_model(
            &mut batches,
            &mut touched_clients,
            &interested_clients,
            chunk_model,
        );

        assert_eq!(batches.len(), interested_clients.len());
        let touched_ids: HashSet<_> = touched_clients.into_iter().collect();
        assert_eq!(touched_ids, interested_clients);
        for client_id in ["a", "b", "c", "d", "e", "f", "g", "h"] {
            let client_chunks = batches
                .get(client_id)
                .expect("chunk fanout missing expected recipient");
            assert_eq!(client_chunks.len(), 1);
            assert_eq!(client_chunks[0].id, "chunk-9--4");
        }
    }
}
