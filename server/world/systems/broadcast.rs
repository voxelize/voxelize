use hashbrown::{HashMap, HashSet};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    encode_message, fragment_message,
    server::Message,
    world::{profiler::Profiler, system_profiler::WorldTimingContext, Client, Clients, MessageQueues},
    EncodedMessage, EncodedMessageQueue, MessageType, RtcSenders, Transports,
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

fn is_immediate(msg_type: i32) -> bool {
    matches!(
        MessageType::try_from(msg_type),
        Ok(MessageType::Chat) | Ok(MessageType::Method)
    )
}

fn should_send_to_transport(msg_type: i32) -> bool {
    matches!(
        MessageType::try_from(msg_type),
        Ok(MessageType::Entity) | Ok(MessageType::Peer)
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
        ReadExpect<'a, WorldTimingContext>,
        WriteExpect<'a, MessageQueues>,
        WriteExpect<'a, EncodedMessageQueue>,
        WriteExpect<'a, Profiler>,
        Option<ReadExpect<'a, RtcSenders>>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            transports,
            clients,
            timing,
            mut queues,
            mut encoded_queue,
            _profiler,
            rtc_senders_opt,
        ) = data;
        let _t = timing.timer("broadcast");
        let world_name = &*timing.world_name;

        let messages_with_world_name: Vec<(Message, ClientFilter)> = queues
            .drain_prioritized()
            .into_iter()
            .map(|(mut message, filter)| {
                message.world_name = world_name.clone();
                (message, filter)
            })
            .collect();

        let (immediate_messages, deferred_messages): (Vec<_>, Vec<_>) = messages_with_world_name
            .into_iter()
            .partition(|(msg, _)| is_immediate(msg.r#type));

        let immediate_encoded: Vec<(EncodedMessage, ClientFilter)> = immediate_messages
            .into_iter()
            .map(|(message, filter)| {
                let msg_type = message.r#type;
                let encoded = EncodedMessage {
                    data: encode_message(&message),
                    msg_type,
                    is_rtc_eligible: false,
                };
                (encoded, filter)
            })
            .collect();

        let batched_messages = batch_messages(deferred_messages);

        encoded_queue.append(batched_messages);
        encoded_queue.process();

        let async_messages = encoded_queue.receive();
        let mut done_messages = immediate_encoded;
        done_messages.extend(async_messages);

        if done_messages.is_empty() {
            return;
        }

        let rtc_map = rtc_senders_opt.as_ref().and_then(|rtc| rtc.try_lock().ok());
        let client_count = clients.len();

        for (encoded, filter) in done_messages {
            let use_rtc = encoded.is_rtc_eligible;
            let send_to_client = |id: &str, client: &Client| {
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
            };
            let send_to_id = |id: &str| {
                if let Some(client) = clients.get(id) {
                    send_to_client(id, client);
                }
            };

            if let ClientFilter::Direct(id) = &filter {
                send_to_id(id);
                continue;
            }

            match &filter {
                ClientFilter::All => {
                    for (id, client) in clients.iter() {
                        send_to_client(id, client);
                    }
                }
                ClientFilter::Include(ids) => {
                    if ids.is_empty() {
                    } else if ids.len() == 1 {
                        send_to_id(ids[0].as_str());
                    } else if ids.len() <= 4 {
                        for include_index in 0..ids.len() {
                            let include_id = ids[include_index].as_str();
                            let mut duplicate = false;
                            for prev_index in 0..include_index {
                                if ids[prev_index].as_str() == include_id {
                                    duplicate = true;
                                    break;
                                }
                            }
                            if duplicate {
                                continue;
                            }
                            send_to_id(include_id);
                        }
                    } else if ids.len() < client_count {
                        let mut seen_ids: HashSet<&str> = HashSet::with_capacity(ids.len());
                        for include_id in ids.iter() {
                            let include_id = include_id.as_str();
                            if seen_ids.insert(include_id) {
                                send_to_id(include_id);
                            }
                        }
                    } else {
                        let mut include_ids: HashSet<&str> = HashSet::with_capacity(ids.len());
                        for include_id in ids.iter() {
                            include_ids.insert(include_id.as_str());
                        }
                        for (id, client) in clients.iter() {
                            if include_ids.contains(id.as_str()) {
                                send_to_client(id, client);
                            }
                        }
                    }
                }
                ClientFilter::Exclude(ids) => {
                    if ids.is_empty() {
                        for (id, client) in clients.iter() {
                            send_to_client(id, client);
                        }
                    } else if ids.len() == 1 {
                        let excluded_id = ids[0].as_str();
                        for (id, client) in clients.iter() {
                            if id.as_str() != excluded_id {
                                send_to_client(id, client);
                            }
                        }
                    } else if ids.len() <= 4 {
                        for (id, client) in clients.iter() {
                            let id = id.as_str();
                            let mut excluded = false;
                            for excluded_id in ids.iter() {
                                if excluded_id.as_str() == id {
                                    excluded = true;
                                    break;
                                }
                            }
                            if !excluded {
                                send_to_client(id, client);
                            }
                        }
                    } else {
                        let mut exclude_ids: HashSet<&str> = HashSet::with_capacity(ids.len());
                        for exclude_id in ids.iter() {
                            exclude_ids.insert(exclude_id.as_str());
                        }
                        for (id, client) in clients.iter() {
                            if !exclude_ids.contains(id.as_str()) {
                                send_to_client(id, client);
                            }
                        }
                    }
                }
                _ => {}
            }

            if !transports.is_empty() && should_send_to_transport(encoded.msg_type) {
                transports.values().for_each(|sender| {
                    let _ = sender.send(encoded.data.clone());
                });
            }
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
