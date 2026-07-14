use hashbrown::HashMap;
use serde_json::{json, Map, Value};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    encode_message, fragment_message,
    perf::{self, OutboundPerfKind},
    server::{Message, WsSender},
    world::{
        profiler::Profiler, system_profiler::WorldTimingContext, Clients, MessageQueues, Stats,
    },
    EncodedMessage, EncodedMessageQueue, EntityOperation, MessageType, RtcSenders, Transports,
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

fn is_immediate(message: &Message) -> bool {
    match MessageType::try_from(message.r#type) {
        Ok(MessageType::Chat) | Ok(MessageType::Method) => true,
        // Messages carrying an entity CREATE encode synchronously so a
        // freshly spawned entity reaches nearby clients on the tick it first
        // streams, instead of losing a tick to the async encode round-trip.
        Ok(MessageType::Entity) => message
            .entities
            .iter()
            .any(|e| EntityOperation::try_from(e.operation) == Ok(EntityOperation::Create)),
        _ => false,
    }
}

fn should_send_to_transport(msg_type: i32) -> bool {
    matches!(
        MessageType::try_from(msg_type),
        Ok(MessageType::Entity) | Ok(MessageType::Peer)
    )
}

fn send_encoded(sender: &WsSender, encoded: &EncodedMessage) {
    if encoded.is_entity_update {
        let _ = sender.send_entity(encoded.data.clone());
    } else {
        let _ = sender.send(encoded.data.clone());
    }
}

fn is_recipient(id: &str, filter: &ClientFilter) -> bool {
    match filter {
        ClientFilter::All => true,
        ClientFilter::Direct(direct_id) => direct_id == id,
        ClientFilter::Include(ids) => ids.iter().any(|included_id| included_id == id),
        ClientFilter::Exclude(ids) => !ids.iter().any(|excluded_id| excluded_id == id),
    }
}

fn connection_queue_depths(clients: &Clients, filter: &ClientFilter) -> Map<String, Value> {
    clients
        .iter()
        .filter(|(id, _)| is_recipient(id, filter))
        .map(|(id, client)| (id.clone(), json!(client.sender.len())))
        .collect()
}

fn log_outbound_perf(
    encoded: &EncodedMessage,
    world: &str,
    tick: u64,
    queue_depths: Map<String, Value>,
) {
    let Some(outbound) = encoded.perf.as_ref() else {
        return;
    };
    let outbound_queue_depth = queue_depths.values().filter_map(Value::as_u64).sum::<u64>();
    match &outbound.kind {
        OutboundPerfKind::Chat {
            body_preview,
            t_send_ms,
        } => perf::log(
            "chat_core_broadcast",
            world,
            json!({
                "traceId": outbound.trace_id,
                "tSendMs": t_send_ms,
                "bodyPreview": body_preview,
                "tick": tick,
                "byteSize": encoded.data.len(),
                "outboundQueueDepth": outbound_queue_depth,
                "connectionOutboundQueueDepths": queue_depths,
            }),
        ),
        OutboundPerfKind::Entity { item_count } => perf::log(
            "entity_batch_send",
            world,
            json!({
                "traceId": outbound.trace_id,
                "tick": tick,
                "itemCount": item_count,
                "byteSize": encoded.data.len(),
                "outboundQueueDepth": outbound_queue_depth,
                "connectionOutboundQueueDepths": queue_depths,
            }),
        ),
    }
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
        ReadExpect<'a, Stats>,
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
            stats,
            mut queues,
            mut encoded_queue,
            _profiler,
            rtc_senders_opt,
        ) = data;
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
            .partition(|(msg, _)| is_immediate(msg));

        let immediate_encoded: Vec<(EncodedMessage, ClientFilter)> = immediate_messages
            .into_iter()
            .map(|(message, filter)| {
                let msg_type = message.r#type;
                let outbound_perf = perf::outbound(&message);
                let encoded = EncodedMessage {
                    data: encode_message(&message),
                    msg_type,
                    is_rtc_eligible: false,
                    is_entity_update: false,
                    perf: outbound_perf,
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

        for (encoded, filter) in done_messages {
            let use_rtc = encoded.is_rtc_eligible;

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
                    send_encoded(&client.sender, &encoded);
                }
                let queue_depths = connection_queue_depths(&clients, &filter);
                log_outbound_perf(&encoded, world_name, stats.tick, queue_depths);
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

                send_encoded(&client.sender, &encoded);
            });

            if !transports.is_empty() && should_send_to_transport(encoded.msg_type) {
                transports.values().for_each(|sender| {
                    send_encoded(sender, &encoded);
                });
            }
            let queue_depths = connection_queue_depths(&clients, &filter);
            log_outbound_perf(&encoded, world_name, stats.tick, queue_depths);
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
