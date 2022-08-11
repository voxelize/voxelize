use hashbrown::HashMap;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkProtocol, ChunkRequestsComp, Chunks, ClientFilter, IDComp, Message, MessageQueue,
    MessageType, Pipeline, Vec2, WorldConfig,
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut pipeline, chunks, mut queue, ids, mut requests) = data;

        let mut to_send: HashMap<String, Vec<Vec2<i32>>> = HashMap::new();

        for (id, request) in (&ids, &mut requests).join() {
            let mut count = 0;

            // Process the chunks that this request is waiting on.
            while !request.waiting.is_empty() && count < config.max_chunks_per_tick {
                count += 1;

                let coords = request.waiting.pop_front().unwrap();

                if let Some(_) = chunks.get(&coords) {
                    if !to_send.contains_key(&id.0) {
                        to_send.insert(id.0.clone(), vec![]);
                    }

                    to_send.get_mut(&id.0).unwrap().push(coords.to_owned());

                    // Add coordinate to the "finished" list.
                    request.mark_finish(&coords);
                } else {
                    // Add coordinate to the "waiting" list.
                    request.wait(&coords);
                }
            }

            let mut count = 0;
            // Process the pending requests, either send them if chunk is ready, or add them to the pipeline if not.
            while !request.pending.is_empty()
                && count < config.max_chunks_per_tick
                && to_send.len() < config.max_response_per_tick
            {
                let coords = request.pending.pop_front().unwrap();

                if !chunks.is_within_world(&coords) {
                    continue;
                }

                if let Some(_) = chunks.get(&coords) {
                    if !to_send.contains_key(&id.0) {
                        to_send.insert(id.0.to_owned(), vec![]);
                    }

                    to_send.get_mut(&id.0).unwrap().push(coords.to_owned());

                    // Add coordinate to the "finished" pile.
                    request.mark_finish(&coords);
                } else {
                    chunks
                        .light_traversed_chunks(&coords)
                        .into_iter()
                        .for_each(|n_coords| {
                            if !chunks.is_within_world(&n_coords) {
                                return;
                            }

                            // Make sure the chunk isn't stuck in the meshing stage.
                            // In the meshing stage, the chunk's stage would be None, but mesh would also be None.
                            if let Some(chunk) = chunks.raw(&n_coords) {
                                if chunk.stage.is_none() {
                                    return;
                                }
                            }

                            pipeline.push(&n_coords, 0);
                        });

                    request.wait(&coords);
                }

                count += 1;
            }
        }

        // Add the chunk sending to message queue.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkProtocol> = coords
                .into_iter()
                .map(|coords| {
                    let chunk = chunks.get(&coords).unwrap();
                    chunk.to_model(true, true, 0..config.sub_chunks as u32)
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        });
    }
}
