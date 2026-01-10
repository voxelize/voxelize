use hashbrown::{HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkProtocol, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, IDComp,
    Mesher, Message, MessageQueues, MessageType, Pipeline, Vec2, WorldConfig, WorldTimingContext,
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
        let (chunks, config, mut interests, mut pipeline, mut mesher, mut queue, ids, mut requests, timing) =
            data;
        let _t = timing.timer("chunk-requests");

        let max_response_per_tick = config.max_response_per_tick;

        let mut to_send: HashMap<String, HashSet<Vec2<i32>>> = HashMap::new();

        for (id, requests) in (&ids, &mut requests).join() {
            let mut to_add_back_to_requested = HashSet::new();

            for coords in requests.requests.drain(..) {
                if chunks.is_chunk_ready(&coords) {
                    let clients_to_send = to_send.entry(id.0.clone()).or_default();

                    if clients_to_send.len() >= max_response_per_tick {
                        to_add_back_to_requested.insert(coords);
                        continue;
                    }

                    clients_to_send.insert(coords.clone());
                    interests.add(&id.0, &coords);
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

            requests.requests.extend(to_add_back_to_requested);
        }

        for (id, coords) in to_send {
            let chunks: Vec<ChunkProtocol> = coords
                .into_iter()
                .filter_map(|coords| {
                    chunks
                        .get(&coords)
                        .map(|chunk| chunk.to_model(true, true, 0..config.sub_chunks as u32))
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        }
    }
}
