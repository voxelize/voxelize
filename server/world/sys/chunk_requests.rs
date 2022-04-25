use hashbrown::HashMap;
use log::info;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    chunks::Chunks,
    common::ClientFilter,
    pipeline::Pipeline,
    server::models::{Chunk as ChunkModel, Message, MessageType},
    vec::Vec2,
    world::{
        comps::{chunk_requests::ChunkRequestsComp, id::IDComp},
        messages::MessageQueue,
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
        WriteStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (chunks, config, mut pipeline, mut queue, ids, mut requests) = data;

        let mut to_send: HashMap<String, Vec<Vec2<i32>>> = HashMap::new();

        for (id, request) in (&ids, &mut requests).join() {
            let mut leftover = vec![];
            let mut count = 0;

            while !request.pending.is_empty() && count < config.max_chunk_per_tick {
                count += 1;

                let coords = request.pending.pop_front().unwrap();

                // Send the chunk to client if it's done.
                if let Some(chunk) = chunks.get_chunk(&coords) {
                    if !to_send.contains_key(&id.0) {
                        to_send.insert(id.0.to_owned(), vec![]);
                    }

                    // Add coordinate to the "finished" pile.
                    request.mark_finish(&coords);

                    to_send
                        .get_mut(&id.0)
                        .unwrap()
                        .push(chunk.coords.to_owned());

                    continue;
                }

                if !chunks.is_within_world(&coords) {
                    continue;
                }

                // Otherwise, add to pipeline.
                leftover.push(coords.to_owned());

                [
                    [-1, -1],
                    [-1, 0],
                    [-1, 1],
                    [0, -1],
                    [0, 0],
                    [0, 1],
                    [1, -1],
                    [1, 0],
                    [1, 1],
                ]
                .iter()
                .for_each(|[ox, oz]| {
                    let new_coords = Vec2(coords.0 + ox, coords.1 + oz);

                    if !chunks.is_within_world(&new_coords) {
                        return;
                    }

                    pipeline.push(&new_coords, 0);
                });
            }

            leftover.into_iter().for_each(|coords| {
                request.add(&coords);
            });
        }

        // Add the chunk sending to message queue.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkModel> = coords
                .into_iter()
                .map(|coords| {
                    let chunk = chunks.get_chunk(&coords).unwrap();
                    chunk.to_model()
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        });
    }
}
