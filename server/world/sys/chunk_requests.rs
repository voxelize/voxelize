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
        let (chunks, config, mut pipeline, mut queue, mut ids, mut requests) = data;

        let mut to_send: HashMap<String, Vec<Vec2<i32>>> = HashMap::new();

        for (id, request) in (&ids, &mut requests).join() {
            let mut leftover = vec![];

            request
                .0
                .drain(..config.max_response_per_tick.min(request.0.len()))
                .for_each(|coords| {
                    // Send the chunk to client if it's done.
                    if let Some(chunk) = chunks.get_chunk(&coords) {
                        if !to_send.contains_key(&id.0) {
                            to_send.insert(id.0.to_owned(), vec![]);
                        }

                        to_send
                            .get_mut(&id.0)
                            .unwrap()
                            .push(chunk.coords.to_owned());

                        return;
                    }

                    // Otherwise, add to pipeline.
                    leftover.push(coords.to_owned());

                    if !pipeline.has(&coords) {
                        pipeline.push((coords, 0));
                    }
                });

            request.0.append(&mut leftover);
        }

        // Add the chunk sending to message queue.
        to_send.into_iter().for_each(|(id, coords)| {
            let chunks: Vec<ChunkModel> = coords
                .into_iter()
                .map(|coords| {
                    let chunk = chunks.get_chunk(&coords).unwrap();
                    ChunkModel {
                        x: chunk.coords.0,
                        z: chunk.coords.1,
                        id: chunk.id.clone(),
                        mesh: chunk.mesh.to_owned(),
                        // voxels: None,
                        // lights: None,
                        // height_map: None
                        voxels: Some(chunk.voxels.to_owned()),
                        lights: Some(chunk.lights.to_owned()),
                        height_map: Some(chunk.height_map.to_owned()),
                    }
                })
                .collect();

            let message = Message::new(&MessageType::Chunk).chunks(&chunks).build();
            queue.push((message, ClientFilter::Direct(id)));
        })
    }
}
