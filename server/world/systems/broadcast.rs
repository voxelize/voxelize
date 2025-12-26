use hashbrown::HashMap;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    fragment_message,
    server::Message,
    world::{metadata::WorldMetadata, profiler::Profiler, system_profiler::SystemTimer, Clients, MessageQueue},
    EncodedMessageQueue, MessageType, RtcSenders, Transports,
};

pub struct BroadcastSystem;

fn filter_key(filter: &ClientFilter) -> String {
    match filter {
        ClientFilter::All => "all".to_string(),
        ClientFilter::Direct(id) => format!("direct:{}", id),
        ClientFilter::Include(ids) => {
            let mut sorted = ids.clone();
            sorted.sort();
            format!("include:{}", sorted.join(","))
        }
        ClientFilter::Exclude(ids) => {
            let mut sorted = ids.clone();
            sorted.sort();
            format!("exclude:{}", sorted.join(","))
        }
    }
}

fn can_batch(msg_type: i32) -> bool {
    matches!(
        MessageType::try_from(msg_type),
        Ok(MessageType::Peer)
            | Ok(MessageType::Entity)
            | Ok(MessageType::Update)
            | Ok(MessageType::Event)
    )
}

fn merge_messages(base: &mut Message, other: Message) {
    base.peers.extend(other.peers);
    base.entities.extend(other.entities);
    base.updates.extend(other.updates);
    base.events.extend(other.events);
}

fn batch_messages(messages: Vec<(Message, ClientFilter)>) -> Vec<(Message, ClientFilter)> {
    let mut batched: HashMap<(i32, String), (Message, ClientFilter)> = HashMap::new();
    let mut unbatched: Vec<(Message, ClientFilter)> = Vec::new();

    for (message, filter) in messages {
        let msg_type = message.r#type;

        if can_batch(msg_type) {
            let key = (msg_type, filter_key(&filter));

            if let Some((existing, _)) = batched.get_mut(&key) {
                merge_messages(existing, message);
            } else {
                batched.insert(key, (message, filter));
            }
        } else {
            unbatched.push((message, filter));
        }
    }

    let mut result: Vec<(Message, ClientFilter)> = batched.into_values().collect();
    result.extend(unbatched);
    result
}

impl<'a> System<'a> for BroadcastSystem {
    type SystemData = (
        ReadExpect<'a, Transports>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, WorldMetadata>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, EncodedMessageQueue>,
        WriteExpect<'a, Profiler>,
        Option<ReadExpect<'a, RtcSenders>>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let _t = SystemTimer::new("broadcast");
        let (transports, clients, world_metadata, mut queue, mut encoded_queue, _profiler, rtc_senders_opt) = data;

        let messages_with_world_name: Vec<(Message, ClientFilter)> = queue
            .drain(..)
            .map(|m| {
                let mut message = m.0;
                message.world_name = world_metadata.world_name.clone();
                (message, m.1)
            })
            .collect();

        let batched_messages = batch_messages(messages_with_world_name);

        encoded_queue.append(batched_messages);
        encoded_queue.process();

        let done_messages = encoded_queue.receive();

        if done_messages.is_empty() {
            return;
        }

        let rtc_map = rtc_senders_opt.as_ref().and_then(|rtc| rtc.try_lock().ok());

        for (encoded, filter) in done_messages {
            let use_rtc = matches!(
                MessageType::try_from(encoded.msg_type),
                Ok(MessageType::Peer) | Ok(MessageType::Entity)
            );

            transports.values().for_each(|sender| {
                let _ = sender.send(encoded.data.clone());
            });

            if let ClientFilter::Direct(id) = &filter {
                if let Some(client) = clients.get(id) {
                    if use_rtc {
                        if let Some(ref rtc_map) = rtc_map {
                            if let Some(rtc_sender) = rtc_map.get(id) {
                                for fragment in fragment_message(&encoded.data) {
                                    if rtc_sender.send(fragment).is_err() {
                                        break;
                                    }
                                }
                                continue;
                            }
                        }
                    }
                    let _ = client.sender.send(encoded.data.clone());
                }
                continue;
            }

            clients.iter().for_each(|(id, client)| {
                match &filter {
                    ClientFilter::All => {}
                    ClientFilter::Include(ids) => {
                        if !ids.iter().any(|i| *i == *id) {
                            return;
                        }
                    }
                    ClientFilter::Exclude(ids) => {
                        if ids.iter().any(|i| *i == *id) {
                            return;
                        }
                    }
                    _ => {}
                };

                if use_rtc {
                    if let Some(ref rtc_map) = rtc_map {
                        if let Some(rtc_sender) = rtc_map.get(id) {
                            for fragment in fragment_message(&encoded.data) {
                                if rtc_sender.send(fragment).is_err() {
                                    break;
                                }
                            }
                            return;
                        }
                    }
                }

                let _ = client.sender.send(encoded.data.clone());
            })
        }
    }
}

// use log::info;
// use specs::{ReadExpect, System, WriteExpect};

// use crate::{
//     common::ClientFilter,
//     server::encode_message,
//     world::{profiler::Profiler, Clients, MessageQueue},
//     EncodedMessage, EncodedMessageQueue, MessageType, Transports,
// };

// pub struct BroadcastSystem;

// impl<'a> System<'a> for BroadcastSystem {
//     type SystemData = (
//         ReadExpect<'a, Transports>,
//         ReadExpect<'a, Clients>,
//         WriteExpect<'a, MessageQueue>,
//         WriteExpect<'a, EncodedMessageQueue>,
//         WriteExpect<'a, Profiler>,
//     );

//     fn run(&mut self, data: Self::SystemData) {
//         let (transports, clients, mut queue, mut encoded_queue, mut profiler) = data;

//         profiler.time("broadcast");

//         let all_messages: Vec<_> = queue.drain(..).collect();

//         let (chunk_messages, other_messages): (Vec<_>, Vec<_>) = all_messages
//             .into_iter()
//             .partition(|message| !message.0.chunks.is_empty());

//         encoded_queue.append(chunk_messages);
//         encoded_queue.process();

//         let done_messages = encoded_queue.receive();

//         let other_messages_encoded: Vec<_> = other_messages
//             .into_iter()
//             .map(|(message, filter)| (EncodedMessage(encode_message(&message)), filter))
//             .collect();

//         let all_messages: Vec<_> = done_messages
//             .into_iter()
//             .chain(other_messages_encoded.into_iter())
//             .collect();

//         if all_messages.is_empty() {
//             return;
//         }

//         for (encoded, filter) in all_messages {
//             transports.values().for_each(|recipient| {
//                 recipient.do_send(encoded.to_owned());
//             });

//             match &filter {
//                 ClientFilter::Direct(id) => {
//                     if let Some(client) = clients.get(id) {
//                         client.addr.do_send(encoded);
//                     }
//                 }
//                 ClientFilter::All => {
//                     clients.values().for_each(|client| {
//                         client.addr.do_send(encoded.to_owned());
//                     });
//                 }
//                 ClientFilter::Include(ids) => {
//                     clients.iter().for_each(|(id, client)| {
//                         if ids.contains(id) {
//                             client.addr.do_send(encoded.to_owned());
//                         }
//                     });
//                 }
//                 ClientFilter::Exclude(ids) => {
//                     clients.iter().for_each(|(id, client)| {
//                         if !ids.contains(id) {
//                             client.addr.do_send(encoded.to_owned());
//                         }
//                     });
//                 }
//             }
//         }

//         profiler.time_end("broadcast");
//     }
// }
