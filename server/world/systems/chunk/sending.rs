use log::info;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    ChunkInterests, ChunkRequestsComp, Chunks, ClientFilter, IDComp, Message, MessageQueue,
    MessageType, WorldConfig,
};

#[derive(Default)]
pub struct ChunkSendingSystem;

impl ChunkSendingSystem {
    pub fn new() -> Self {
        ChunkSendingSystem
    }
}

impl<'a> System<'a> for ChunkSendingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, ChunkInterests>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ChunkRequestsComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, interests, mut chunks, mut queue, ids, requests) = data;

        if chunks.to_send.is_empty() {
            return;
        }

        while !chunks.to_send.is_empty() {
            if let Some((coords, lod, r#type)) = chunks.to_send.pop_front() {
                if let Some(chunk) = chunks.get_mut(&coords, lod) {
                    [[true, false], [false, true]]
                        .into_iter()
                        .for_each(|[mesh, data]| {
                            let mut messages = vec![];

                            if r#type == MessageType::Load {
                                messages.push(
                                    Message::new(&r#type)
                                        .chunks(&[chunk.to_model(
                                            mesh,
                                            data,
                                            0..(config.sub_chunks as u32),
                                        )])
                                        .build(),
                                )
                            } else {
                                if mesh {
                                    chunk
                                        .updated_levels
                                        .to_owned()
                                        .into_iter()
                                        .for_each(|level| {
                                            messages.push(
                                                Message::new(&r#type)
                                                    .chunks(&[chunk.to_model(mesh, data, {
                                                        let level = level as u32;
                                                        level..(level + 1)
                                                    })])
                                                    .build(),
                                            );
                                        });

                                    chunk.updated_levels.clear();
                                } else {
                                    messages.push(
                                        Message::new(&r#type)
                                            .chunks(&[chunk.to_model(false, true, 0..0)])
                                            .build(),
                                    )
                                }
                            }

                            if let Some(chunk_interests) = interests.get_interests(&coords) {
                                chunk_interests.iter().for_each(|id| {
                                    messages.iter().for_each(|message| {
                                        queue.push((
                                            message.clone(),
                                            ClientFilter::Direct(id.to_owned()),
                                        ));
                                    });
                                });
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
