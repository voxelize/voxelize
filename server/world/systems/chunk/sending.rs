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
                    let messages = if r#type == MessageType::Load {
                        vec![Message::new(&r#type)
                            .chunks(&[chunk.to_model(
                                true,
                                true,
                                lod,
                                0..(config.sub_chunks as u32),
                            )])
                            .build()]
                    } else {
                        let mut temp_messages = Vec::new();
                        for mesh in [true, false] {
                            if mesh {
                                chunk
                                    .updated_levels
                                    .to_owned()
                                    .into_iter()
                                    .for_each(|level| {
                                        temp_messages.push(
                                            Message::new(&r#type)
                                                .chunks(&[chunk.to_model(
                                                    true,
                                                    false,
                                                    lod,
                                                    level as u32..(level as u32 + 1),
                                                )])
                                                .build(),
                                        );
                                    });
                                chunk.updated_levels.clear();
                            } else {
                                temp_messages.push(
                                    Message::new(&r#type)
                                        .chunks(&[chunk.to_model(
                                            false,
                                            true,
                                            lod,
                                            0..(config.sub_chunks as u32),
                                        )])
                                        .build(),
                                );
                            }
                        }
                        temp_messages
                    };

                    if let Some(chunk_interests) = interests.get_interests(&coords) {
                        for id in chunk_interests {
                            for message in &messages {
                                queue.push((message.clone(), ClientFilter::Direct(id.to_owned())));
                            }
                        }
                    }
                } else {
                    panic!("Something went wrong with sending chunks...");
                }
            } else {
                break;
            }
        }
    }
}
