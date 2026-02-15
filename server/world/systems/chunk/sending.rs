use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
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

#[inline]
fn take_updated_level_range(updated_levels: &mut HashSet<u32>) -> Option<(u32, u32)> {
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

#[inline]
fn flush_chunk_batches(
    queue: &mut MessageQueues,
    message_type: &MessageType,
    batches: HashMap<String, Vec<ChunkProtocol>>,
) {
    for (client_id, chunk_models) in batches {
        if chunk_models.is_empty() {
            continue;
        }
        queue.push((
            Message::new(message_type).chunks(&chunk_models).build(),
            ClientFilter::Direct(client_id),
        ));
    }
}

#[inline]
fn push_chunk_batch(
    batches: &mut HashMap<String, Vec<ChunkProtocol>>,
    client_id: &str,
    chunk_model: &ChunkProtocol,
) {
    match batches.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(mut entry) => {
            entry.get_mut().push(chunk_model.clone());
        }
        RawEntryMut::Vacant(entry) => {
            entry.insert(client_id.to_owned(), vec![chunk_model.clone()]);
        }
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
        let sub_chunks_u32 = if config.sub_chunks > u32::MAX as usize {
            u32::MAX
        } else {
            config.sub_chunks as u32
        };

        if chunks.to_send.is_empty() {
            return;
        }

        let mut to_send = std::mem::take(&mut chunks.to_send);
        let send_batch_estimate = to_send.len();

        let mut client_load_mesh: HashMap<String, Vec<ChunkProtocol>> =
            HashMap::with_capacity(send_batch_estimate);
        let mut client_load_data: HashMap<String, Vec<ChunkProtocol>> =
            HashMap::with_capacity(send_batch_estimate);
        let mut client_update_mesh: HashMap<String, Vec<ChunkProtocol>> =
            HashMap::with_capacity(send_batch_estimate);
        let mut client_update_data: HashMap<String, Vec<ChunkProtocol>> =
            HashMap::with_capacity(send_batch_estimate);

        while let Some((coords, msg_type)) = to_send.pop_front() {
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

                for client_id in interested_clients {
                    push_chunk_batch(&mut client_load_mesh, client_id, &mesh_model);
                    push_chunk_batch(&mut client_load_data, client_id, &data_model);
                }
            } else {
                if let Some((min_level, max_level_exclusive)) =
                    take_updated_level_range(&mut chunk.updated_levels)
                {
                    let mesh_model = chunk.to_model(true, false, min_level..max_level_exclusive);

                    for client_id in interested_clients {
                        push_chunk_batch(&mut client_update_mesh, client_id, &mesh_model);
                    }
                }

                let data_model = chunk.to_model(false, true, 0..0);
                for client_id in interested_clients {
                    push_chunk_batch(&mut client_update_data, client_id, &data_model);
                }
            }
        }

        flush_chunk_batches(&mut queue, &MessageType::Load, client_load_mesh);
        flush_chunk_batches(&mut queue, &MessageType::Load, client_load_data);
        flush_chunk_batches(&mut queue, &MessageType::Update, client_update_mesh);
        flush_chunk_batches(&mut queue, &MessageType::Update, client_update_data);
    }
}

#[cfg(test)]
mod tests {
    use hashbrown::HashMap;
    use hashbrown::HashSet;

    use crate::{ChunkProtocol, ClientFilter, MessageQueues, MessageType};

    use super::{flush_chunk_batches, take_updated_level_range};

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
}
