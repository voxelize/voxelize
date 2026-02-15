use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, IDComp, Mesher, Message,
    MessageQueues, MessageType, Pipeline, Vec2, WorldConfig, WorldTimingContext,
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, WorldConfig>,
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
        let sub_chunks_u32 = if config.sub_chunks > u32::MAX as usize {
            u32::MAX
        } else {
            config.sub_chunks as u32
        };

        let mut to_send: HashMap<String, HashSet<Vec2<i32>>> = HashMap::new();

        for (id, requests) in (&ids, &mut requests).join() {
            let mut to_add_back_to_requested: Option<HashSet<Vec2<i32>>> = None;

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    if !can_send_responses {
                        to_add_back_to_requested
                            .get_or_insert_with(HashSet::new)
                            .insert(coords);
                        continue;
                    }
                    let clients_to_send = match to_send.raw_entry_mut().from_key(id.0.as_str()) {
                        RawEntryMut::Occupied(entry) => entry.into_mut(),
                        RawEntryMut::Vacant(entry) => {
                            entry.insert(id.0.clone(), HashSet::new()).1
                        }
                    };

                    if clients_to_send.len() >= max_response_per_tick {
                        to_add_back_to_requested
                            .get_or_insert_with(HashSet::new)
                            .insert(coords);
                        continue;
                    }

                    interests.add(&id.0, &coords);
                    clients_to_send.insert(coords);
                } else {
                    if !interests.has_interests(&coords) {
                        for coords in chunks.light_traversed_chunks(&coords) {
                            match chunks.raw(&coords) {
                                Some(chunk) if matches!(chunk.status, ChunkStatus::Meshing) => {
                                    mesher.add_chunk(&coords, false);
                                }
                                None | Some(_) => {
                                    pipeline.add_chunk(&coords, false);
                                }
                            }
                        }
                    }
                    interests.add(&id.0, &coords);
                }
            }

            if let Some(to_add_back_to_requested) = to_add_back_to_requested {
                requests.requests.extend(to_add_back_to_requested);
            }
        }

        for (id, coords) in to_send {
            let mut chunk_models = Vec::with_capacity(coords.len());
            for coords in coords {
                if let Some(chunk) = chunks.get(&coords) {
                    chunk_models.push(chunk.to_model(true, true, 0..sub_chunks_u32));
                }
            }
            if chunk_models.is_empty() {
                continue;
            }

            let message = Message::new(&MessageType::Load).chunks(&chunk_models).build();
            queue.push((message, ClientFilter::Direct(id)));
        }
    }
}
