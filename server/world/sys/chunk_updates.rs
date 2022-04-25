use hashbrown::HashMap;
use log::info;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    chunks::Chunks,
    common::{ClientFilter, UpdatedChunks},
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
        WriteExpect<'a, UpdatedChunks>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (chunks, mut updated, mut queue, ids, requests) = data;

        updated.drain().for_each(|coords| {
            if let Some(chunk) = chunks.get_chunk(&coords) {
                for (id, request) in (&ids, &requests).join() {
                    if request.has(&coords) {
                        let message = Message::new(&MessageType::Load)
                            .chunks(&[chunk.to_model()])
                            .build();
                        queue.push((message, ClientFilter::Direct(id.0.to_owned())));
                    }
                }
            }
        });
    }
}
