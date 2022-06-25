use log::info;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    common::ClientFilter,
    server::{Message, MessageType},
    world::{ChunkRequestsComp, Chunks, IDComp, MessageQueue, WorldConfig},
};

pub struct ChunkSendingSystem;

impl<'a> System<'a> for ChunkSendingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut chunks, mut queue, ids, requests) = data;

        if chunks.to_send.is_empty() {
            return;
        }

        let mut count = 0;

        while count < config.max_response_per_tick {
            count += 1;

            if let Some((coords, r#type)) = chunks.to_send.pop_front() {
                if let Some(chunk) = chunks.get(&coords) {
                    [[true, false], [false, true]]
                        .into_iter()
                        .for_each(|[mesh, data]| {
                            let mut messages = vec![];

                            if mesh {
                                (0..(config.sub_chunks as u32)).for_each(|level| {
                                    messages.push(
                                        Message::new(&r#type)
                                            .chunks(&[chunk.to_model(
                                                mesh,
                                                data,
                                                if r#type == MessageType::Load {
                                                    0..(config.sub_chunks as u32)
                                                } else {
                                                    let level = level as u32;
                                                    level..(level + 1)
                                                },
                                            )])
                                            .build(),
                                    );
                                })
                            }

                            // See if each request is interested in this chunk update.
                            for (id, request) in (&ids, &requests).join() {
                                if request.loaded.contains(&coords) {
                                    messages.iter().for_each(|message| {
                                        queue.push((
                                            message.clone(),
                                            ClientFilter::Direct(id.0.to_owned()),
                                        ));
                                    });
                                }
                            }
                        });
                } else {
                    panic!("Something went wrong with sending chunks...");
                }
            } else {
                break;
            }
        }
    }
}
