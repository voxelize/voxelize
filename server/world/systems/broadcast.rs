use hashbrown::{hash_map::Entry, HashMap, HashSet};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    common::ClientFilter,
    encode_message, fragment_message,
    server::Message,
    world::{profiler::Profiler, system_profiler::WorldTimingContext, Client, Clients, MessageQueues},
    EncodedMessage, EncodedMessageQueue, MessageType, RtcSenders, Transports,
};

pub struct BroadcastSystem;
const SMALL_FILTER_LINEAR_SCAN_LIMIT: usize = 8;

#[derive(Hash, Eq, PartialEq)]
enum BatchFilterKey {
    All,
    Direct(String),
    IncludeNone,
    IncludeOne(String),
    IncludePair(String, String),
    IncludeMany(Vec<String>),
    ExcludeNone,
    ExcludeOne(String),
    ExcludePair(String, String),
    ExcludeMany(Vec<String>),
}

#[inline]
fn ids_are_strictly_sorted(ids: &[String]) -> bool {
    if ids.len() < 2 {
        return true;
    }
    let mut prev = ids[0].as_str();
    for id in ids.iter().skip(1) {
        let id = id.as_str();
        if id <= prev {
            return false;
        }
        prev = id;
    }
    true
}

fn filter_key(filter: &ClientFilter) -> BatchFilterKey {
    match filter {
        ClientFilter::All => BatchFilterKey::All,
        ClientFilter::Direct(id) => BatchFilterKey::Direct(id.clone()),
        ClientFilter::Include(ids) => {
            if ids.is_empty() {
                return BatchFilterKey::IncludeNone;
            }
            if ids.len() == 1 {
                return BatchFilterKey::IncludeOne(ids[0].clone());
            }
            if ids.len() == 2 {
                let (first, second) = if ids[0] <= ids[1] {
                    (&ids[0], &ids[1])
                } else {
                    (&ids[1], &ids[0])
                };
                if first == second {
                    return BatchFilterKey::IncludeOne(first.clone());
                }
                return BatchFilterKey::IncludePair(first.clone(), second.clone());
            }
            if ids_are_strictly_sorted(ids) {
                return BatchFilterKey::IncludeMany(ids.clone());
            }
            let mut sorted = ids.clone();
            sorted.sort_unstable();
            sorted.dedup();
            if sorted.len() == 1 {
                return BatchFilterKey::IncludeOne(sorted.swap_remove(0));
            }
            BatchFilterKey::IncludeMany(sorted)
        }
        ClientFilter::Exclude(ids) => {
            if ids.is_empty() {
                return BatchFilterKey::ExcludeNone;
            }
            if ids.len() == 1 {
                return BatchFilterKey::ExcludeOne(ids[0].clone());
            }
            if ids.len() == 2 {
                let (first, second) = if ids[0] <= ids[1] {
                    (&ids[0], &ids[1])
                } else {
                    (&ids[1], &ids[0])
                };
                if first == second {
                    return BatchFilterKey::ExcludeOne(first.clone());
                }
                return BatchFilterKey::ExcludePair(first.clone(), second.clone());
            }
            if ids_are_strictly_sorted(ids) {
                return BatchFilterKey::ExcludeMany(ids.clone());
            }
            let mut sorted = ids.clone();
            sorted.sort_unstable();
            sorted.dedup();
            if sorted.len() == 1 {
                return BatchFilterKey::ExcludeOne(sorted.swap_remove(0));
            }
            BatchFilterKey::ExcludeMany(sorted)
        }
    }
}

fn can_batch(msg_type: i32) -> bool {
    msg_type == MessageType::Peer as i32
        || msg_type == MessageType::Entity as i32
        || msg_type == MessageType::Update as i32
        || msg_type == MessageType::Event as i32
}

fn is_immediate(msg_type: i32) -> bool {
    msg_type == MessageType::Chat as i32 || msg_type == MessageType::Method as i32
}

fn should_send_to_transport(msg_type: i32) -> bool {
    msg_type == MessageType::Entity as i32 || msg_type == MessageType::Peer as i32
}

#[inline]
fn send_to_transports(transports: &Transports, payload: Vec<u8>) {
    let mut senders = transports.values();
    let Some(first_sender) = senders.next() else {
        return;
    };
    for sender in senders {
        let _ = sender.send(payload.clone());
    }
    let _ = first_sender.send(payload);
}

fn merge_messages(base: &mut Message, other: Message) {
    base.peers.extend(other.peers);
    base.entities.extend(other.entities);
    base.updates.extend(other.updates);
    base.events.extend(other.events);
}

fn batch_messages(messages: Vec<(Message, ClientFilter)>) -> Vec<(Message, ClientFilter)> {
    if messages.len() <= 1 {
        return messages;
    }
    let total_messages = messages.len();
    let mut batched: HashMap<(i32, BatchFilterKey), (Message, ClientFilter)> =
        HashMap::with_capacity(total_messages);
    let mut unbatched: Vec<(Message, ClientFilter)> = Vec::with_capacity(total_messages);

    for (message, filter) in messages {
        let msg_type = message.r#type;

        if can_batch(msg_type) {
            let key = (msg_type, filter_key(&filter));

            match batched.entry(key) {
                Entry::Occupied(mut entry) => {
                    let (existing, _) = entry.get_mut();
                    merge_messages(existing, message);
                }
                Entry::Vacant(entry) => {
                    entry.insert((message, filter));
                }
            }
        } else {
            unbatched.push((message, filter));
        }
    }

    let mut result: Vec<(Message, ClientFilter)> =
        Vec::with_capacity(batched.len() + unbatched.len());
    result.extend(batched.into_values());
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

        let pending_messages = queues.drain_prioritized();
        if pending_messages.is_empty() {
            return;
        }
        let pending_messages_count = pending_messages.len();
        let mut immediate_encoded: Vec<(EncodedMessage, ClientFilter)> =
            Vec::with_capacity(pending_messages_count);
        let mut deferred_messages = Vec::with_capacity(pending_messages_count);
        for (mut message, filter) in pending_messages {
            message.world_name = world_name.clone();
            if is_immediate(message.r#type) {
                let msg_type = message.r#type;
                let encoded = EncodedMessage {
                    data: encode_message(&message),
                    msg_type,
                    is_rtc_eligible: false,
                };
                immediate_encoded.push((encoded, filter));
            } else {
                deferred_messages.push((message, filter));
            }
        }

        if !deferred_messages.is_empty() {
            let batched_messages = batch_messages(deferred_messages);
            encoded_queue.append(batched_messages);
            encoded_queue.process();
        }

        let mut async_messages = encoded_queue.receive();
        let mut done_messages = immediate_encoded;
        if done_messages.capacity() - done_messages.len() < async_messages.len() {
            done_messages.reserve(async_messages.len());
        }
        done_messages.append(&mut async_messages);

        if done_messages.is_empty() {
            return;
        }

        let rtc_map = rtc_senders_opt.as_ref().and_then(|rtc| rtc.try_lock().ok());
        let client_count = clients.len();
        let has_transports = !transports.is_empty();
        if client_count == 0 {
            if has_transports {
                for (encoded, _) in done_messages {
                    if should_send_to_transport(encoded.msg_type) {
                        send_to_transports(&transports, encoded.data);
                    }
                }
            }
            return;
        }

        for (encoded, filter) in done_messages {
            let use_rtc = encoded.is_rtc_eligible;
            if let ClientFilter::Direct(id) = &filter {
                if let Some(client) = clients.get(id) {
                    if use_rtc {
                        if let Some(ref rtc_map) = rtc_map {
                            if let Some(rtc_sender) = rtc_map.get(id) {
                                let rtc_fragments = fragment_message(&encoded.data);
                                for fragment in rtc_fragments {
                                    if rtc_sender.send(fragment).is_err() {
                                        break;
                                    }
                                }
                                continue;
                            }
                        }
                    }
                    let _ = client.sender.send(encoded.data);
                }
                continue;
            }
            if client_count == 1 {
                let (single_id, single_client) = clients.iter().next().unwrap();
                let should_send = match &filter {
                    ClientFilter::All => true,
                    ClientFilter::Include(ids) => ids.iter().any(|id| id == single_id),
                    ClientFilter::Exclude(ids) => !ids.iter().any(|id| id == single_id),
                    _ => false,
                };
                let should_send_transport =
                    has_transports && should_send_to_transport(encoded.msg_type);
                let mut sent_with_rtc = false;
                if should_send {
                    if use_rtc {
                        if let Some(ref rtc_map) = rtc_map {
                            if let Some(rtc_sender) = rtc_map.get(single_id) {
                                for fragment in fragment_message(&encoded.data) {
                                    if rtc_sender.send(fragment).is_err() {
                                        break;
                                    }
                                }
                                sent_with_rtc = true;
                            }
                        }
                    }
                    if !sent_with_rtc {
                        if !should_send_transport {
                            let _ = single_client.sender.send(encoded.data);
                            continue;
                        }
                        let _ = single_client.sender.send(encoded.data.clone());
                    }
                }
                if should_send_transport {
                    send_to_transports(&transports, encoded.data);
                }
                continue;
            }
            let include_single_target = if let ClientFilter::Include(ids) = &filter {
                match ids.len() {
                    0 => None,
                    1 => Some(ids[0].as_str()),
                    2 if ids[0] == ids[1] => Some(ids[0].as_str()),
                    _ => {
                        let first_id = ids[0].as_str();
                        if ids.iter().all(|id| id.as_str() == first_id) {
                            Some(first_id)
                        } else {
                            None
                        }
                    }
                }
            } else {
                None
            };
            if let Some(target_id) = include_single_target {
                let should_send_transport =
                    has_transports && should_send_to_transport(encoded.msg_type);
                let mut sent_with_rtc = false;
                if let Some(client) = clients.get(target_id) {
                    if use_rtc {
                        if let Some(ref rtc_map) = rtc_map {
                            if let Some(rtc_sender) = rtc_map.get(target_id) {
                                for fragment in fragment_message(&encoded.data) {
                                    if rtc_sender.send(fragment).is_err() {
                                        break;
                                    }
                                }
                                sent_with_rtc = true;
                            }
                        }
                    }
                    if !sent_with_rtc {
                        if !should_send_transport {
                            let _ = client.sender.send(encoded.data);
                            continue;
                        }
                        let _ = client.sender.send(encoded.data.clone());
                    }
                }
                if should_send_transport {
                    send_to_transports(&transports, encoded.data);
                }
                continue;
            }
            if !use_rtc && matches!(&filter, ClientFilter::All) {
                let should_send_transport =
                    has_transports && should_send_to_transport(encoded.msg_type);
                let mut clients_iter = clients.values();
                if let Some(first_client) = clients_iter.next() {
                    for client in clients_iter {
                        let _ = client.sender.send(encoded.data.clone());
                    }
                    if should_send_transport {
                        let _ = first_client.sender.send(encoded.data.clone());
                        send_to_transports(&transports, encoded.data);
                    } else {
                        let _ = first_client.sender.send(encoded.data);
                    }
                } else if should_send_transport {
                    send_to_transports(&transports, encoded.data);
                }
                continue;
            }
            let mut rtc_fragments_cache: Option<Vec<Vec<u8>>> = None;
            let mut send_to_client = |id: &str, client: &Client| {
                if use_rtc {
                    if let Some(ref rtc_map) = rtc_map {
                        if let Some(rtc_sender) = rtc_map.get(id) {
                            let fragments = rtc_fragments_cache
                                .get_or_insert_with(|| fragment_message(&encoded.data));
                            for fragment in fragments.iter() {
                                if rtc_sender.send(fragment.clone()).is_err() {
                                    break;
                                }
                            }
                            return;
                        }
                    }
                }

                let _ = client.sender.send(encoded.data.clone());
            };
            let mut send_to_id = |id: &str| {
                if let Some(client) = clients.get(id) {
                    send_to_client(id, client);
                }
            };

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
                    } else if ids.len() == 2 {
                        let first_id = ids[0].as_str();
                        let second_id = ids[1].as_str();
                        send_to_id(first_id);
                        if second_id != first_id {
                            send_to_id(second_id);
                        }
                    } else if ids.len() <= SMALL_FILTER_LINEAR_SCAN_LIMIT {
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
                    } else if ids.len() == 2 {
                        let first_id = ids[0].as_str();
                        let second_id = ids[1].as_str();
                        if first_id == second_id {
                            for (id, client) in clients.iter() {
                                if id.as_str() != first_id {
                                    send_to_client(id, client);
                                }
                            }
                        } else {
                            for (id, client) in clients.iter() {
                                let id = id.as_str();
                                if id != first_id && id != second_id {
                                    send_to_client(id, client);
                                }
                            }
                        }
                    } else if ids.len() <= SMALL_FILTER_LINEAR_SCAN_LIMIT {
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

            if has_transports && should_send_to_transport(encoded.msg_type) {
                send_to_transports(&transports, encoded.data);
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
