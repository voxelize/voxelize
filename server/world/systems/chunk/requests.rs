use hashbrown::HashMap;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    common::ClientFilter,
    server::models::{Chunk as ChunkModel, Message, MessageType},
    vec::Vec2,
    world::{
        components::{
            chunk_requests::ChunkRequestsComp, current_chunk::CurrentChunkComp, id::IDComp,
        },
        generators::pipeline::Pipeline,
        messages::MessageQueue,
        voxels::chunks::Chunks,
        WorldConfig,
    },
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, CurrentChunkComp>,
        WriteStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (chunks, config, mut pipeline, mut queue, ids, curr_chunks, mut requests) = data;

        let mut to_send: HashMap<String, Vec<Vec2<i32>>> = HashMap::new();

        for (id, curr_chunk, request) in (&ids, &curr_chunks, &mut requests).join() {
            let mut count = 0;

            if !request.pending.is_empty() {
                request.sort_pending(&curr_chunk.coords);
            }

            while !request.pending.is_empty()
                && count < config.max_chunk_per_tick
                && to_send.len() < config.max_response_per_tick
            {
                count += 1;

                let coords = request.pending.pop_front().unwrap();

                if !chunks.is_within_world(&coords) {
                    continue;
                }

                if let Some(chunk) = chunks.get(&coords) {
                    if !to_send.contains_key(&id.0) {
                        to_send.insert(id.0.to_owned(), vec![]);
                    }

                    to_send
                        .get_mut(&id.0)
                        .unwrap()
                        .push(chunk.coords.to_owned());

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

                    request.pending.insert(coords);
                }
            }
        }

        // Add the chunk sending to message queue.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkModel> = coords
                .into_iter()
                .map(|coords| {
                    let chunk = chunks.get(&coords).unwrap();
                    chunk.to_model(true, true)
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        });
    }
}
