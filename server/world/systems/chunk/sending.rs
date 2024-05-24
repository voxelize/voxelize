use log::info;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect};
use std::collections::VecDeque;

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

        let mut to_send = VecDeque::new();
        std::mem::swap(&mut chunks.to_send, &mut to_send);

        while let Some((coords, r#type)) = to_send.pop_front() {
            if let Some(chunk) = chunks.get_mut(&coords) {
                for [mesh, data] in [[true, false], [false, true]] {
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
                        );
                    } else if mesh {
                        let updated_levels = chunk.updated_levels.drain().collect::<Vec<_>>();
                        for level in updated_levels {
                            messages.push(
                                Message::new(&r#type)
                                    .chunks(&[chunk.to_model(mesh, data, {
                                        let level = level as u32;
                                        level..(level + 1)
                                    })])
                                    .build(),
                            );
                        }
                    } else {
                        messages.push(
                            Message::new(&r#type)
                                .chunks(&[chunk.to_model(false, true, 0..0)])
                                .build(),
                        );
                    }

                    if let Some(chunk_interests) = interests.get_interests(&coords) {
                        for id in chunk_interests {
                            for message in &messages {
                                queue.push((message.clone(), ClientFilter::Direct(id.to_owned())));
                            }
                        }
                    }
                }
            } else {
                panic!("Something went wrong with sending chunks...");
            }
        }
    }
}
