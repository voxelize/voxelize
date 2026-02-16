use hashbrown::{hash_map::RawEntryMut, HashMap};
use bytes::Bytes;
use specs::{Entity, ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    encode_message, world::metadata::WorldMetadata, ChunkInterests, ChunkRequestsComp,
    ClientFilter, Clients, Event, EventProtocol, Events, IDComp, Message, MessageType, Transports,
    Vec2, WorldTimingContext,
};

#[derive(Default)]
pub struct EventsSystem {
    dispatch_map_buffer: HashMap<String, Vec<EventProtocol>>,
    touched_clients_buffer: Vec<String>,
    transports_map_buffer: Vec<EventProtocol>,
}
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
    ids.binary_search_by_key(&target, |probe| probe.as_str())
        .is_ok()
}

#[inline]
fn ids_contains_target(ids: &[String], target: &str) -> bool {
    match ids {
        [] => false,
        [id] => id.as_str() == target,
        [first, second] => first.as_str() == target || second.as_str() == target,
        _ => ids.iter().any(|id| id.as_str() == target),
    }
}

#[inline]
fn include_single_target(ids: &[String]) -> Option<&str> {
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
fn filter_targets_all_clients(filter: Option<&ClientFilter>) -> bool {
    match filter {
        None | Some(ClientFilter::All) => true,
        Some(ClientFilter::Exclude(ids)) => ids.is_empty(),
        _ => false,
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

#[inline]
fn push_dispatch_event(
    dispatch_map: &mut HashMap<String, Vec<EventProtocol>>,
    touched_clients: &mut Vec<String>,
    client_id: &str,
    event: EventProtocol,
) {
    match dispatch_map.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(mut entry) => {
            let events = entry.get_mut();
            if events.is_empty() {
                touched_clients.push(client_id.to_owned());
            }
            events.push(event);
        }
        RawEntryMut::Vacant(entry) => {
            touched_clients.push(client_id.to_owned());
            let mut events = Vec::with_capacity(1);
            events.push(event);
            entry.insert(client_id.to_owned(), events);
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

impl<'a> System<'a> for EventsSystem {
    type SystemData = (
        ReadExpect<'a, Transports>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, ChunkInterests>,
        ReadExpect<'a, WorldMetadata>,
        WriteExpect<'a, Events>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ChunkRequestsComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            transports,
            clients,
            interests,
            world_metadata,
            mut events,
            ids,
            _requests,
            timing,
        ) =
            data;
        let _t = timing.timer("events");

        if events.queue.is_empty() {
            return;
        }
        let client_count = clients.len();
        let has_transports = !transports.is_empty();
        let queued_events_count = events.queue.len();
        let dispatch_map = &mut self.dispatch_map_buffer;
        if client_count == 0 && !has_transports {
            events.queue.clear();
            dispatch_map.clear();
            self.touched_clients_buffer.clear();
            self.transports_map_buffer.clear();
            return;
        }
        if client_count == 0 {
            dispatch_map.clear();
        } else if dispatch_map.len() > client_count {
            dispatch_map.retain(|id, _| clients.contains_key(id));
        }
        let touched_clients = &mut self.touched_clients_buffer;
        touched_clients.clear();
        if touched_clients.capacity() < client_count {
            touched_clients.reserve(client_count - touched_clients.capacity());
        }
        let single_client = if client_count == 1 {
            clients
                .iter()
                .next()
                .map(|(id, client)| (id.as_str(), client.entity))
        } else {
            None
        };
        let transports_map = &mut self.transports_map_buffer;
        if has_transports {
            transports_map.clear();
            if transports_map.capacity() < queued_events_count {
                transports_map.reserve(queued_events_count - transports_map.capacity());
            }
        }
        if client_count == 0 {
            for event in events.queue.drain(..) {
                let Event { name, payload, .. } = event;
                transports_map.push(EventProtocol {
                    name,
                    payload: payload.unwrap_or_else(|| String::from("{}")),
                });
            }
            let next_transport_event_capacity = transports_map.capacity();
            let transports_events_to_send = std::mem::replace(
                transports_map,
                Vec::with_capacity(next_transport_event_capacity),
            );
            let message = Message::new(&MessageType::Event)
                .world_name(&world_metadata.world_name)
                .events_owned(transports_events_to_send)
                .build();
            let encoded = Bytes::from(encode_message(&message));
            send_to_transports(&transports, encoded);
            return;
        }

        let is_interested = |coords: &Vec2<i32>, entity: Entity| {
            if let Some(id) = ids.get(entity) {
                return interests.is_interested(&id.0, coords);
            }

            false
        };

        for event in events.queue.drain(..) {
            let Event {
                name,
                payload,
                mut filter,
                location,
            } = event;

            let serialized = EventProtocol {
                name,
                payload: payload.unwrap_or_else(|| String::from("{}")),
            };
            if let Some(filter) = filter.as_mut() {
                normalize_filter_for_dispatch(filter);
            }

            if has_transports {
                transports_map.push(serialized.clone());
            }
            if let Some(ClientFilter::Direct(id)) = filter.as_ref() {
                if let Some(client) = clients.get(id) {
                    let should_send = match location.as_ref() {
                        Some(location) => is_interested(location, client.entity),
                        None => true,
                    };
                    if should_send {
                        push_dispatch_event(dispatch_map, touched_clients, id, serialized);
                    }
                }
                continue;
            }
            if let Some((single_client_id, single_client_entity)) = single_client {
                let mut should_send = match filter.as_ref() {
                    None | Some(ClientFilter::All) => true,
                    Some(ClientFilter::Include(ids)) => ids_contains_target(ids, single_client_id),
                    Some(ClientFilter::Exclude(ids)) => !ids_contains_target(ids, single_client_id),
                    Some(_) => false,
                };
                if should_send {
                    if let Some(location) = location.as_ref() {
                        should_send = is_interested(location, single_client_entity);
                    }
                }
                if should_send {
                    push_dispatch_event(dispatch_map, touched_clients, single_client_id, serialized);
                }
                continue;
            }
            let include_single_target = if let Some(ClientFilter::Include(ids)) = filter.as_ref() {
                include_single_target(ids)
            } else {
                None
            };
            if let Some(target_id) = include_single_target {
                if let Some(client) = clients.get(target_id) {
                    let should_send = match location.as_ref() {
                        Some(location) => is_interested(location, client.entity),
                        None => true,
                    };
                    if should_send {
                        push_dispatch_event(dispatch_map, touched_clients, target_id, serialized);
                    }
                }
                continue;
            }
            if location.is_none() && filter_targets_all_clients(filter.as_ref()) {
                let mut client_ids = clients.keys();
                if let Some(first_client_id) = client_ids.next() {
                    for client_id in client_ids {
                        push_dispatch_event(
                            dispatch_map,
                            touched_clients,
                            client_id.as_str(),
                            serialized.clone(),
                        );
                    }
                    push_dispatch_event(
                        dispatch_map,
                        touched_clients,
                        first_client_id.as_str(),
                        serialized,
                    );
                }
                continue;
            }

            // Checks if location is required, otherwise just sends.
            let mut send_to_client = |id: &str, entity: Entity| {
                if let Some(location) = &location {
                    if !is_interested(location, entity) {
                        return;
                    }
                }
                push_dispatch_event(dispatch_map, touched_clients, id, serialized.clone());
            };

            let mut send_to_id = |id: &str| {
                if let Some(client) = clients.get(id) {
                    send_to_client(id, client.entity);
                }
            };

            if let Some(filter) = filter {
                match &filter {
                    ClientFilter::All => {
                        for (id, client) in clients.iter() {
                            send_to_client(id, client.entity);
                        }
                    }
                    ClientFilter::Include(ids) => {
                        if ids.is_empty() {
                            continue;
                        }
                        if ids.len() == 1 {
                            send_to_id(ids[0].as_str());
                            continue;
                        }
                        if ids.len() == 2 {
                            let first_id = ids[0].as_str();
                            let second_id = ids[1].as_str();
                            send_to_id(first_id);
                            if second_id != first_id {
                                send_to_id(second_id);
                            }
                            continue;
                        }
                        if ids.len() <= SMALL_FILTER_LINEAR_SCAN_LIMIT {
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
                                    send_to_client(id, client.entity);
                                }
                            }
                        }
                    }
                    ClientFilter::Exclude(ids) => {
                        if ids.is_empty() {
                            for (id, client) in clients.iter() {
                                send_to_client(id, client.entity);
                            }
                            continue;
                        }
                        if ids.len() == 1 {
                            let excluded_id = ids[0].as_str();
                            for (id, client) in clients.iter() {
                                if id.as_str() != excluded_id {
                                    send_to_client(id, client.entity);
                                }
                            }
                            continue;
                        }
                        if ids.len() == 2 {
                            let first_id = ids[0].as_str();
                            let second_id = ids[1].as_str();
                            if first_id == second_id {
                                for (id, client) in clients.iter() {
                                    if id.as_str() != first_id {
                                        send_to_client(id, client.entity);
                                    }
                                }
                            } else {
                                for (id, client) in clients.iter() {
                                    let id = id.as_str();
                                    if id != first_id && id != second_id {
                                        send_to_client(id, client.entity);
                                    }
                                }
                            }
                            continue;
                        }
                        if ids.len() <= SMALL_FILTER_LINEAR_SCAN_LIMIT {
                            for (id, client) in clients.iter() {
                                if !ids_contains_target(ids, id.as_str()) {
                                    send_to_client(id, client.entity);
                                }
                            }
                        } else {
                            debug_assert!(ids_are_strictly_sorted(ids));
                            for (id, client) in clients.iter() {
                                if !sorted_ids_contains(ids, id.as_str()) {
                                    send_to_client(id, client.entity);
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            // No filter, but a location is set.
            else if let Some(location) = &location {
                for (id, client) in clients.iter() {
                    if interests.is_interested(id, location) {
                        send_to_client(id, client.entity);
                    }
                }
            } else {
                for (id, client) in clients.iter() {
                    send_to_client(id, client.entity);
                }
            }
        }

        // Process the dispatch map, sending them directly for fastest event responses.
        for id in touched_clients.drain(..) {
            let client_events = match dispatch_map.get_mut(&id) {
                Some(events) => events,
                None => continue,
            };
            if let Some(client) = clients.get(&id) {
                let next_client_event_capacity = client_events.capacity();
                let client_events_to_send = std::mem::replace(
                    client_events,
                    Vec::with_capacity(next_client_event_capacity),
                );
                let message = Message::new(&MessageType::Event)
                    .events_owned(client_events_to_send)
                    .build();
                let encoded = Bytes::from(encode_message(&message));
                let _ = client.sender.send(encoded);
            }
        }

        if has_transports {
            let next_transport_event_capacity = transports_map.capacity();
            let transports_events_to_send = std::mem::replace(
                transports_map,
                Vec::with_capacity(next_transport_event_capacity),
            );
            let message = Message::new(&MessageType::Event)
                .world_name(&world_metadata.world_name)
                .events_owned(transports_events_to_send)
                .build();
            let encoded = Bytes::from(encode_message(&message));
            send_to_transports(&transports, encoded);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        filter_targets_all_clients, ids_are_strictly_sorted, ids_contains_target,
        sorted_ids_contains,
    };
    use crate::ClientFilter;

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
    fn filter_targets_all_clients_detects_none_all_and_empty_exclude() {
        assert!(filter_targets_all_clients(None));
        assert!(filter_targets_all_clients(Some(&ClientFilter::All)));
        assert!(filter_targets_all_clients(Some(&ClientFilter::Exclude(
            Vec::new()
        ))));
        assert!(!filter_targets_all_clients(Some(&ClientFilter::Exclude(ids(&[
            "a"
        ])))));
        assert!(!filter_targets_all_clients(Some(&ClientFilter::Include(ids(&[
            "a"
        ])))));
    }

    #[test]
    fn sorted_ids_contains_uses_binary_search_semantics() {
        let sorted = ids(&["aa", "bb", "cc", "dd"]);
        assert!(sorted_ids_contains(&sorted, "aa"));
        assert!(sorted_ids_contains(&sorted, "dd"));
        assert!(!sorted_ids_contains(&sorted, "ab"));
    }
}
