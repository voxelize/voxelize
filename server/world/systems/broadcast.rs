use hashbrown::{hash_map::Entry, HashMap};
use bytes::Bytes;
use specs::{ReadExpect, System, WriteExpect};
use tokio::sync::mpsc;

use crate::{
    common::ClientFilter,
    encode_message, fragment_message,
    server::Message,
    world::{profiler::Profiler, system_profiler::WorldTimingContext, Client, Clients, MessageQueues},
    EncodedMessage, EncodedMessageQueue, MessageType, RtcSenders, Transports,
};

pub struct BroadcastSystem;
const SMALL_FILTER_LINEAR_SCAN_LIMIT: usize = 8;

#[inline]
fn ids_are_strictly_sorted(ids: &[String]) -> bool {
    if ids.len() < 2 {
        return true;
    }
    let mut prev = ids[0].as_str();
    for index in 1..ids.len() {
        let id = ids[index].as_str();
        if id <= prev {
            return false;
        }
        prev = id;
    }
    true
}

#[inline]
fn sorted_ids_contains(ids: &[String], target: &str) -> bool {
    ids.binary_search_by(|probe| probe.as_str().cmp(target))
        .is_ok()
}

#[inline]
fn ids_contains_target(ids: &[String], target: &str) -> bool {
    if ids.len() > SMALL_FILTER_LINEAR_SCAN_LIMIT {
        debug_assert!(ids_are_strictly_sorted(ids));
        return sorted_ids_contains(ids, target);
    }
    match ids {
        [] => false,
        [id] => id.as_str() == target,
        [first, second] => first.as_str() == target || second.as_str() == target,
        _ => ids.iter().any(|id| id.as_str() == target),
    }
}

#[inline]
fn include_single_target(ids: &[String]) -> Option<&str> {
    if ids.len() > SMALL_FILTER_LINEAR_SCAN_LIMIT {
        return None;
    }
    match ids {
        [] => None,
        [id] => Some(id.as_str()),
        [first, second] if first == second => Some(first.as_str()),
        [first, rest @ ..] => {
            let first_id = first.as_str();
            if rest.iter().all(|id| id.as_str() == first_id) {
                Some(first_id)
            } else {
                None
            }
        }
    }
}

#[inline]
fn normalize_filter_for_dispatch(filter: &mut ClientFilter) {
    let ids = match filter {
        ClientFilter::Include(ids) | ClientFilter::Exclude(ids) => ids,
        _ => return,
    };
    if ids.len() <= SMALL_FILTER_LINEAR_SCAN_LIMIT || ids_are_strictly_sorted(ids) {
        return;
    }
    ids.sort_unstable();
    ids.dedup();
}

#[inline]
fn for_each_unique_id<F: FnMut(&str)>(ids: &[String], mut visit: F) {
    for index in 0..ids.len() {
        let id = ids[index].as_str();
        let mut duplicate = false;
        for prev_index in 0..index {
            if ids[prev_index].as_str() == id {
                duplicate = true;
                break;
            }
        }
        if duplicate {
            continue;
        }
        visit(id);
    }
}

fn normalize_filter_for_batching(filter: &mut ClientFilter) {
    let ids = match filter {
        ClientFilter::Include(ids) | ClientFilter::Exclude(ids) => ids,
        _ => return,
    };
    if ids.len() < 2 || ids_are_strictly_sorted(ids) {
        return;
    }
    ids.sort_unstable();
    ids.dedup();
}

#[inline]
fn can_batch(msg_type: i32) -> bool {
    msg_type == MessageType::Peer as i32
        || msg_type == MessageType::Entity as i32
        || msg_type == MessageType::Update as i32
        || msg_type == MessageType::Event as i32
}

#[inline]
fn is_immediate(msg_type: i32) -> bool {
    msg_type == MessageType::Chat as i32 || msg_type == MessageType::Method as i32
}

#[inline]
fn should_send_to_transport(msg_type: i32) -> bool {
    msg_type == MessageType::Entity as i32 || msg_type == MessageType::Peer as i32
}

#[inline]
fn targets_all_clients(filter: &ClientFilter) -> bool {
    match filter {
        ClientFilter::All => true,
        ClientFilter::Exclude(ids) => ids.is_empty(),
        _ => false,
    }
}

#[inline]
fn send_fragmented_rtc_payload(rtc_sender: &mpsc::UnboundedSender<Bytes>, payload: &[u8]) {
    for fragment in fragment_message(payload) {
        if rtc_sender.send(Bytes::from(fragment)).is_err() {
            break;
        }
    }
}

#[inline]
fn send_to_transports(transports: &Transports, payload: Bytes) {
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
    let mut batched: Option<HashMap<(i32, ClientFilter), Message>> = None;
    let mut unbatched: Option<Vec<(Message, ClientFilter)>> = None;

    for (message, mut filter) in messages {
        let msg_type = message.r#type;

        if can_batch(msg_type) {
            normalize_filter_for_batching(&mut filter);
            let batched = batched
                .get_or_insert_with(|| HashMap::with_capacity(total_messages));

            match batched.entry((msg_type, filter)) {
                Entry::Occupied(mut entry) => {
                    merge_messages(entry.get_mut(), message);
                }
                Entry::Vacant(entry) => {
                    entry.insert(message);
                }
            }
        } else {
            unbatched
                .get_or_insert_with(|| Vec::with_capacity(total_messages))
                .push((message, filter));
        }
    }

    let Some(batched) = batched else {
        return unbatched.unwrap_or_default();
    };
    let unbatched_len = unbatched.as_ref().map_or(0, Vec::len);
    let mut result: Vec<(Message, ClientFilter)> =
        Vec::with_capacity(batched.len() + unbatched_len);
    for ((_, filter), message) in batched {
        result.push((message, filter));
    }
    if let Some(unbatched) = unbatched {
        result.extend(unbatched);
    }
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
        let mut immediate_encoded: Option<Vec<(EncodedMessage, ClientFilter)>> = None;
        let mut deferred_messages: Option<Vec<(Message, ClientFilter)>> = None;
        for (mut message, filter) in pending_messages {
            message.world_name.clear();
            message.world_name.push_str(world_name);
            if is_immediate(message.r#type) {
                let msg_type = message.r#type;
                let encoded = EncodedMessage {
                    data: Bytes::from(encode_message(&message)),
                    is_rtc_eligible: false,
                    is_transport_eligible: should_send_to_transport(msg_type),
                };
                immediate_encoded
                    .get_or_insert_with(|| Vec::with_capacity(pending_messages_count))
                    .push((encoded, filter));
            } else {
                deferred_messages
                    .get_or_insert_with(|| Vec::with_capacity(pending_messages_count))
                    .push((message, filter));
            }
        }

        if let Some(deferred_messages) = deferred_messages {
            let batched_messages = batch_messages(deferred_messages);
            encoded_queue.append(batched_messages);
            encoded_queue.process();
        }

        let mut async_messages = encoded_queue.receive();
        let done_messages = if let Some(immediate_encoded) = immediate_encoded {
            if async_messages.is_empty() {
                immediate_encoded
            } else {
                let mut done_messages = immediate_encoded;
                let remaining_capacity = done_messages.capacity() - done_messages.len();
                if remaining_capacity < async_messages.len() {
                    done_messages.reserve(async_messages.len() - remaining_capacity);
                }
                done_messages.append(&mut async_messages);
                done_messages
            }
        } else {
            async_messages
        };

        if done_messages.is_empty() {
            return;
        }

        let rtc_map = rtc_senders_opt.as_ref().and_then(|rtc| rtc.try_lock().ok());
        let client_count = clients.len();
        let has_transports = !transports.is_empty();
        let single_client = if client_count == 1 {
            clients.iter().next().map(|(id, client)| (id.as_str(), client))
        } else {
            None
        };
        if client_count == 0 {
            if has_transports {
                for (encoded, _) in done_messages {
                    if encoded.is_transport_eligible {
                        send_to_transports(&transports, encoded.data);
                    }
                }
            }
            return;
        }

        for (encoded, mut filter) in done_messages {
            normalize_filter_for_dispatch(&mut filter);
            let rtc_map_for_message = if encoded.is_rtc_eligible {
                rtc_map.as_ref()
            } else {
                None
            };
            let should_send_transport = has_transports && encoded.is_transport_eligible;
            let encoded_data = encoded.data;
            if let ClientFilter::Direct(id) = &filter {
                if let Some(client) = clients.get(id) {
                    if let Some(rtc_map) = rtc_map_for_message {
                        if let Some(rtc_sender) = rtc_map.get(id) {
                            send_fragmented_rtc_payload(rtc_sender, encoded_data.as_ref());
                            continue;
                        }
                    }
                    let _ = client.sender.send(encoded_data);
                }
                continue;
            }
            if let Some((single_id, single_client)) = single_client {
                let should_send = match &filter {
                    ClientFilter::All => true,
                    ClientFilter::Include(ids) => ids_contains_target(ids, single_id),
                    ClientFilter::Exclude(ids) => !ids_contains_target(ids, single_id),
                    _ => false,
                };
                let mut sent_with_rtc = false;
                if should_send {
                    if let Some(rtc_map) = rtc_map_for_message {
                        if let Some(rtc_sender) = rtc_map.get(single_id) {
                            send_fragmented_rtc_payload(rtc_sender, encoded_data.as_ref());
                            sent_with_rtc = true;
                        }
                    }
                    if !sent_with_rtc {
                        if !should_send_transport {
                            let _ = single_client.sender.send(encoded_data);
                            continue;
                        }
                        let _ = single_client.sender.send(encoded_data.clone());
                    }
                }
                if should_send_transport {
                    send_to_transports(&transports, encoded_data);
                }
                continue;
            }
            let include_single_target = if let ClientFilter::Include(ids) = &filter {
                include_single_target(ids)
            } else {
                None
            };
            if let Some(target_id) = include_single_target {
                let mut sent_with_rtc = false;
                if let Some(client) = clients.get(target_id) {
                    if let Some(rtc_map) = rtc_map_for_message {
                        if let Some(rtc_sender) = rtc_map.get(target_id) {
                            send_fragmented_rtc_payload(rtc_sender, encoded_data.as_ref());
                            sent_with_rtc = true;
                        }
                    }
                    if !sent_with_rtc {
                        if !should_send_transport {
                            let _ = client.sender.send(encoded_data);
                            continue;
                        }
                        let _ = client.sender.send(encoded_data.clone());
                    }
                }
                if should_send_transport {
                    send_to_transports(&transports, encoded_data);
                }
                continue;
            }
            if rtc_map_for_message.is_none() && targets_all_clients(&filter) {
                let mut clients_iter = clients.values();
                if let Some(first_client) = clients_iter.next() {
                    for client in clients_iter {
                        let _ = client.sender.send(encoded_data.clone());
                    }
                    if should_send_transport {
                        let _ = first_client.sender.send(encoded_data.clone());
                        send_to_transports(&transports, encoded_data);
                    } else {
                        let _ = first_client.sender.send(encoded_data);
                    }
                } else if should_send_transport {
                    send_to_transports(&transports, encoded_data);
                }
                continue;
            }
            let mut rtc_fragments_cache: Option<Vec<Bytes>> = None;
            let mut send_to_client = |id: &str, client: &Client| {
                if let Some(rtc_map) = rtc_map_for_message {
                    if let Some(rtc_sender) = rtc_map.get(id) {
                        let fragments = rtc_fragments_cache
                            .get_or_insert_with(|| {
                                fragment_message(encoded_data.as_ref())
                                    .into_iter()
                                    .map(Bytes::from)
                                    .collect()
                            });
                        for fragment in fragments.iter() {
                            if rtc_sender.send(fragment.clone()).is_err() {
                                break;
                            }
                        }
                        return;
                    }
                }

                let _ = client.sender.send(encoded_data.clone());
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
                        for_each_unique_id(ids, |include_id| send_to_id(include_id));
                    } else if ids.len() < client_count {
                        debug_assert!(ids_are_strictly_sorted(ids));
                        for include_id in ids.iter() {
                            send_to_id(include_id);
                        }
                    } else {
                        debug_assert!(ids_are_strictly_sorted(ids));
                        for (id, client) in clients.iter() {
                            if sorted_ids_contains(ids, id.as_str()) {
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
                            if !ids_contains_target(ids, id.as_str()) {
                                send_to_client(id, client);
                            }
                        }
                    } else {
                        debug_assert!(ids_are_strictly_sorted(ids));
                        for (id, client) in clients.iter() {
                            if !sorted_ids_contains(ids, id.as_str()) {
                                send_to_client(id, client);
                            }
                        }
                    }
                }
                _ => {}
            }

            if should_send_transport {
                send_to_transports(&transports, encoded_data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        batch_messages, ids_are_strictly_sorted, ids_contains_target, sorted_ids_contains,
        targets_all_clients,
    };
    use crate::{ClientFilter, Message, MessageType};

    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn ids_are_strictly_sorted_rejects_duplicates_and_descending() {
        assert!(ids_are_strictly_sorted(&ids(&["a", "b", "c"])));
        assert!(!ids_are_strictly_sorted(&ids(&["a", "a", "b"])));
        assert!(!ids_are_strictly_sorted(&ids(&["c", "b", "a"])));
    }

    #[test]
    fn ids_contains_target_supports_small_sorted_and_unsorted_inputs() {
        assert!(!ids_contains_target(&ids(&[]), "a"));
        assert!(ids_contains_target(&ids(&["a"]), "a"));
        assert!(ids_contains_target(&ids(&["a", "b"]), "b"));
        assert!(!ids_contains_target(&ids(&["a", "b"]), "z"));
        assert!(ids_contains_target(&ids(&["a", "c", "d"]), "c"));
        assert!(ids_contains_target(&ids(&["d", "a", "c"]), "c"));
    }

    #[test]
    fn targets_all_clients_detects_all_and_empty_exclude_filters() {
        assert!(targets_all_clients(&ClientFilter::All));
        assert!(targets_all_clients(&ClientFilter::Exclude(Vec::new())));
        assert!(!targets_all_clients(&ClientFilter::Exclude(ids(&["a"]))));
        assert!(!targets_all_clients(&ClientFilter::Include(ids(&["a"]))));
        assert!(!targets_all_clients(&ClientFilter::Direct("a".to_string())));
    }

    #[test]
    fn sorted_ids_contains_uses_binary_search_semantics() {
        let sorted = ids(&["aa", "bb", "cc", "dd"]);
        assert!(sorted_ids_contains(&sorted, "aa"));
        assert!(sorted_ids_contains(&sorted, "dd"));
        assert!(!sorted_ids_contains(&sorted, "ab"));
    }

    #[test]
    fn batch_messages_merges_unsorted_duplicate_include_filters() {
        let messages = vec![
            (
                Message::new(&MessageType::Event).build(),
                ClientFilter::Include(ids(&["b", "a", "a"])),
            ),
            (
                Message::new(&MessageType::Event).build(),
                ClientFilter::Include(ids(&["a", "b"])),
            ),
        ];

        let batched = batch_messages(messages);
        assert_eq!(batched.len(), 1);
        assert!(matches!(
            &batched[0].1,
            ClientFilter::Include(values) if values == &ids(&["a", "b"])
        ));
    }

    #[test]
    fn batch_messages_merges_unsorted_duplicate_exclude_filters() {
        let messages = vec![
            (
                Message::new(&MessageType::Event).build(),
                ClientFilter::Exclude(ids(&["x", "y", "x"])),
            ),
            (
                Message::new(&MessageType::Event).build(),
                ClientFilter::Exclude(ids(&["y", "x"])),
            ),
        ];

        let batched = batch_messages(messages);
        assert_eq!(batched.len(), 1);
        assert!(matches!(
            &batched[0].1,
            ClientFilter::Exclude(values) if values == &ids(&["x", "y"])
        ));
    }

    #[test]
    fn batch_messages_returns_unbatchable_messages_unchanged() {
        let messages = vec![
            (
                Message::new(&MessageType::Chat).build(),
                ClientFilter::Direct("a".to_string()),
            ),
            (
                Message::new(&MessageType::Method).build(),
                ClientFilter::Direct("b".to_string()),
            ),
        ];

        let batched = batch_messages(messages);
        assert_eq!(batched.len(), 2);
        assert_eq!(MessageType::try_from(batched[0].0.r#type), Ok(MessageType::Chat));
        assert_eq!(
            MessageType::try_from(batched[1].0.r#type),
            Ok(MessageType::Method)
        );
    }
}
