use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
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
    for id in ids.iter().skip(1) {
        let id = id.as_str();
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
    match ids.len() {
        0 => false,
        1 => ids[0] == target,
        2 => ids[0] == target || ids[1] == target,
        _ if ids_are_strictly_sorted(ids) => sorted_ids_contains(ids, target),
        _ => ids.iter().any(|id| id.as_str() == target),
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
            let message = Message::new(&MessageType::Event)
                .world_name(&world_metadata.world_name)
                .events(&transports_map)
                .build();
            let encoded = encode_message(&message);
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
                filter,
                location,
            } = event;

            let serialized = EventProtocol {
                name,
                payload: payload.unwrap_or_else(|| String::from("{}")),
            };

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
            if location.is_none() && matches!(filter.as_ref(), None | Some(ClientFilter::All)) {
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
                            if ids_are_strictly_sorted(ids) {
                                for include_id in ids.iter() {
                                    send_to_id(include_id);
                                }
                            } else {
                                let mut seen_ids: HashSet<&str> =
                                    HashSet::with_capacity(ids.len());
                                for include_id in ids.iter() {
                                    let include_id = include_id.as_str();
                                    if seen_ids.insert(include_id) {
                                        send_to_id(include_id);
                                    }
                                }
                            }
                        } else {
                            if ids_are_strictly_sorted(ids) {
                                for (id, client) in clients.iter() {
                                    if sorted_ids_contains(ids, id.as_str()) {
                                        send_to_client(id, client.entity);
                                    }
                                }
                            } else {
                                let mut include_ids: HashSet<&str> =
                                    HashSet::with_capacity(ids.len());
                                for include_id in ids.iter() {
                                    include_ids.insert(include_id.as_str());
                                }
                                for (id, client) in clients.iter() {
                                    if include_ids.contains(id.as_str()) {
                                        send_to_client(id, client.entity);
                                    }
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
                                let id = id.as_str();
                                let mut excluded = false;
                                for excluded_id in ids.iter() {
                                    if excluded_id.as_str() == id {
                                        excluded = true;
                                        break;
                                    }
                                }
                                if !excluded {
                                    send_to_client(id, client.entity);
                                }
                            }
                        } else {
                            if ids_are_strictly_sorted(ids) {
                                for (id, client) in clients.iter() {
                                    if !sorted_ids_contains(ids, id.as_str()) {
                                        send_to_client(id, client.entity);
                                    }
                                }
                            } else {
                                let mut exclude_ids: HashSet<&str> =
                                    HashSet::with_capacity(ids.len());
                                for exclude_id in ids.iter() {
                                    exclude_ids.insert(exclude_id.as_str());
                                }
                                for (id, client) in clients.iter() {
                                    if !exclude_ids.contains(id.as_str()) {
                                        send_to_client(id, client.entity);
                                    }
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
                clients.iter().for_each(|(id, client)| {
                    send_to_client(id, client.entity);
                });
            }
        }

        // Process the dispatch map, sending them directly for fastest event responses.
        for id in touched_clients.drain(..) {
            let client_events = match dispatch_map.get_mut(&id) {
                Some(events) => events,
                None => continue,
            };
            if let Some(client) = clients.get(&id) {
                let message = Message::new(&MessageType::Event)
                    .events(client_events)
                    .build();
                let encoded = encode_message(&message);
                let _ = client.sender.send(encoded);
            }
            client_events.clear();
        }

        if has_transports {
            let message = Message::new(&MessageType::Event)
                .world_name(&world_metadata.world_name)
                .events(&transports_map)
                .build();
            let encoded = encode_message(&message);
            send_to_transports(&transports, encoded);
        }
    }
}
