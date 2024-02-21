use hashbrown::{HashMap, HashSet};
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ChunkInterests, ChunkProtocol, ChunkRequestsComp, ChunkStatus, Chunks, ClientFilter, IDComp,
    Mesher, Message, MessageQueue, MessageType, Pipeline, Vec2, WorldConfig,
};

pub struct ChunkRequestsSystem;

impl<'a> System<'a> for ChunkRequestsSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
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
        let (
            config,
            mut chunks,
            mut interests,
            mut pipeline,
            mut mesher,
            mut queue,
            ids,
            mut requests,
        ) = data;

        let max_response_per_tick = config.max_response_per_tick;

        let mut to_send: HashMap<String, HashSet<(Vec2<i32>, usize)>> = HashMap::new();

        for (id, requests) in (&ids, &mut requests).join() {
            let mut to_add_back_to_requested = HashSet::new();
            let mut user_max_lod_mesher_requests: HashMap<Vec2<i32>, usize> = HashMap::new();

            for (coords, lod) in requests.requests.drain(..) {
                // If the chunk is actually ready, send to client.
                if chunks.is_chunk_ready(&coords, lod) {
                    let mut clients_to_send = to_send.remove(&id.0).unwrap_or_default();

                    if clients_to_send.len() >= max_response_per_tick {
                        to_send.insert(id.0.clone(), clients_to_send);
                        to_add_back_to_requested.insert((coords, lod));
                        continue;
                    }

                    // Add the chunk to the list of chunks to send to the client.
                    clients_to_send.insert((coords.clone(), lod));

                    to_send.insert(id.0.clone(), clients_to_send);

                    interests.add(&id.0, &coords);

                    continue;
                }

                // if nobody has interest in this coordinate yet
                if !interests.has_interests(&coords) {
                    chunks
                        .light_traversed_chunks(&coords)
                        .into_iter()
                        .for_each(|coords| {
                            // If this chunk is DNE or if this chunk is still in the pipeline, we re-add it to the pipeline.
                            if chunks.raw(&coords).is_none()
                                || matches!(
                                    chunks.raw(&coords).unwrap().status,
                                    ChunkStatus::Generating(_)
                                )
                            {
                                pipeline.add_chunk(&coords, false);
                                let mut original_lods = chunks
                                    .postgen_target_lods
                                    .get(&coords)
                                    .cloned()
                                    .unwrap_or_default();
                                original_lods.insert(lod);
                                chunks.postgen_target_lods.insert(coords, original_lods);
                            }
                            // If this chunk is in the meshing stage, we re-add it to the mesher.
                            else if let Some(chunk) = chunks.raw(&coords) {
                                let should_add_lod = matches!(chunk.status, ChunkStatus::Meshing)
                                    || if let ChunkStatus::Ready(lods) = &chunk.status {
                                        !lods.contains(&lod)
                                    } else {
                                        false
                                    };

                                if should_add_lod {
                                    if let Some(user_lod) =
                                        user_max_lod_mesher_requests.get(&chunk.coords)
                                    {
                                        if lod < *user_lod {
                                            user_max_lod_mesher_requests
                                                .insert(chunk.coords.clone(), lod);
                                        }
                                    } else {
                                        user_max_lod_mesher_requests
                                            .insert(chunk.coords.clone(), lod);
                                    }
                                }
                            }
                        });
                }

                for (coords, lod) in user_max_lod_mesher_requests.iter() {
                    mesher.add_chunk(coords, *lod, false);
                }

                interests.add(&id.0, &coords);
            }

            // Add the chunks back to the requested set.
            requests.requests.extend(to_add_back_to_requested);
        }

        // Send the chunks to the client.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkProtocol> = coords
                .into_iter()
                .map(|(coords, lod)| {
                    let chunk = chunks.get(&coords, lod).unwrap();

                    chunk.to_model(true, true, lod, 0..config.sub_chunks as u32)
                })
                .collect();

            let message = Message::new(&MessageType::Load).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)))
        })
    }
}
