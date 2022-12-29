use hashbrown::{HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkProtocol, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, IDComp,
    Mesher, Message, MessageQueue, MessageType, Pipeline, Vec2, WorldConfig,
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, ChunkInterests>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Mesher>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        WriteStorage<'a, ChunkRequestsComp>,
    );

    // 1. Go through all chunk requests, specifically under the `requested` set.
    // 2. If chunk DNE, Add the chunks to be generated in the pipeline.
    // 3. Move the chunk from the `requested` set to the `processed` set.
    // 4. Otherwise, send directly to the client.
    fn run(&mut self, data: Self::SystemData) {
        let (chunks, config, mut interests, mut pipeline, mut mesher, mut queue, ids, mut requests) =
            data;

        let mut to_send: HashMap<String, HashSet<Vec2<i32>>> = HashMap::new();

        for (id, requests) in (&ids, &mut requests).join() {
            for coords in requests.requests.drain(..) {
                interests.add(&id.0, &coords);

                // If the chunk is actually ready, send to client.
                if chunks.is_chunk_ready(&coords) {
                    let mut clients_to_send = to_send.remove(&id.0).unwrap_or_default();

                    // Add the chunk to the list of chunks to send to the client.
                    clients_to_send.insert(coords.clone());

                    to_send.insert(id.0.clone(), clients_to_send);

                    continue;
                }

                if !interests.has_interests(&coords) {
                    chunks
                        .light_traversed_chunks(&coords)
                        .into_iter()
                        .for_each(|n_coords| {
                            // If this chunk is DNE or if this chunk is still in the pipeline, we re-add it to the pipeline.
                            if chunks.raw(&n_coords).is_none()
                                || matches!(
                                    chunks.raw(&n_coords).unwrap().status,
                                    ChunkStatus::Generating(_)
                                )
                            {
                                pipeline.add_chunk(&n_coords, false);
                            }
                            // If this chunk is in the meshing stage, we re-add it to the mesher.
                            else if let Some(chunk) = chunks.raw(&n_coords) {
                                if matches!(chunk.status, ChunkStatus::Meshing) {
                                    mesher.add_chunk(&n_coords, false);
                                }
                            }
                        });
                }
            }
        }

        // Send the chunks to the client.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkProtocol> = coords
                .into_iter()
                .map(|coords| {
                    let chunk = chunks.get(&coords).unwrap();

                    chunk.to_model(true, true, 0..config.sub_chunks as u32)
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)))
        })
    }
}
