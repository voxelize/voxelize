use hashbrown::{hash_map::RawEntryMut, HashMap};
use bytes::Bytes;
use specs::{Entity, ReadExpect, ReadStorage, System, WriteExpect};
use tokio::sync::mpsc;

use crate::{
    encode_message, world::metadata::WorldMetadata, ChunkInterests, ChunkRequestsComp,
    ClientFilter, Clients, Event, EventProtocol, Events, IDComp, Message, MessageType, Transports,
    Vec2, WorldTimingContext,
};
use crate::world::systems::retain_active_client_batches_map;

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
        [first, second, third] => {
            first.as_str() == target || second.as_str() == target || third.as_str() == target
        }
        [first, second, third, fourth] => {
            first.as_str() == target
                || second.as_str() == target
                || third.as_str() == target
                || fourth.as_str() == target
        }
        [first, second, third, fourth, fifth] => {
            first.as_str() == target
                || second.as_str() == target
                || third.as_str() == target
                || fourth.as_str() == target
                || fifth.as_str() == target
        }
        [first, second, third, fourth, fifth, sixth] => {
            first.as_str() == target
                || second.as_str() == target
                || third.as_str() == target
                || fourth.as_str() == target
                || fifth.as_str() == target
                || sixth.as_str() == target
        }
        [first, second, third, fourth, fifth, sixth, seventh] => {
            first.as_str() == target
                || second.as_str() == target
                || third.as_str() == target
                || fourth.as_str() == target
                || fifth.as_str() == target
                || sixth.as_str() == target
                || seventh.as_str() == target
        }
        [first, second, third, fourth, fifth, sixth, seventh, eighth] => {
            first.as_str() == target
                || second.as_str() == target
                || third.as_str() == target
                || fourth.as_str() == target
                || fifth.as_str() == target
                || sixth.as_str() == target
                || seventh.as_str() == target
                || eighth.as_str() == target
        }
        _ => {
            for id in ids {
                if id.as_str() == target {
                    return true;
                }
            }
            false
        }
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
        [first, second, third] if first == second && first == third => Some(first.as_str()),
        [first, second, third, fourth]
            if first == second && first == third && first == fourth =>
        {
            Some(first.as_str())
        }
        [first, second, third, fourth, fifth]
            if first == second && first == third && first == fourth && first == fifth =>
        {
            Some(first.as_str())
        }
        [first, second, third, fourth, fifth, sixth]
            if first == second
                && first == third
                && first == fourth
                && first == fifth
                && first == sixth =>
        {
            Some(first.as_str())
        }
        [first, second, third, fourth, fifth, sixth, seventh]
            if first == second
                && first == third
                && first == fourth
                && first == fifth
                && first == sixth
                && first == seventh =>
        {
            Some(first.as_str())
        }
        [first, second, third, fourth, fifth, sixth, seventh, eighth]
            if first == second
                && first == third
                && first == fourth
                && first == fifth
                && first == sixth
                && first == seventh
                && first == eighth =>
        {
            Some(first.as_str())
        }
        [first, rest @ ..] => {
            let first_id = first.as_str();
            for id in rest {
                if id.as_str() != first_id {
                    return None;
                }
            }
            Some(first_id)
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
    match ids {
        [] => return,
        [first] => {
            visit(first.as_str());
            return;
        }
        [first, second] => {
            let first = first.as_str();
            let second = second.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            return;
        }
        [first, second, third] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            return;
        }
        [first, second, third, fourth] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            let fourth = fourth.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            if fourth != first && fourth != second && fourth != third {
                visit(fourth);
            }
            return;
        }
        [first, second, third, fourth, fifth] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            let fourth = fourth.as_str();
            let fifth = fifth.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            if fourth != first && fourth != second && fourth != third {
                visit(fourth);
            }
            if fifth != first && fifth != second && fifth != third && fifth != fourth {
                visit(fifth);
            }
            return;
        }
        [first, second, third, fourth, fifth, sixth] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            let fourth = fourth.as_str();
            let fifth = fifth.as_str();
            let sixth = sixth.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            if fourth != first && fourth != second && fourth != third {
                visit(fourth);
            }
            if fifth != first && fifth != second && fifth != third && fifth != fourth {
                visit(fifth);
            }
            if sixth != first
                && sixth != second
                && sixth != third
                && sixth != fourth
                && sixth != fifth
            {
                visit(sixth);
            }
            return;
        }
        [first, second, third, fourth, fifth, sixth, seventh] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            let fourth = fourth.as_str();
            let fifth = fifth.as_str();
            let sixth = sixth.as_str();
            let seventh = seventh.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            if fourth != first && fourth != second && fourth != third {
                visit(fourth);
            }
            if fifth != first && fifth != second && fifth != third && fifth != fourth {
                visit(fifth);
            }
            if sixth != first
                && sixth != second
                && sixth != third
                && sixth != fourth
                && sixth != fifth
            {
                visit(sixth);
            }
            if seventh != first
                && seventh != second
                && seventh != third
                && seventh != fourth
                && seventh != fifth
                && seventh != sixth
            {
                visit(seventh);
            }
            return;
        }
        [first, second, third, fourth, fifth, sixth, seventh, eighth] => {
            let first = first.as_str();
            let second = second.as_str();
            let third = third.as_str();
            let fourth = fourth.as_str();
            let fifth = fifth.as_str();
            let sixth = sixth.as_str();
            let seventh = seventh.as_str();
            let eighth = eighth.as_str();
            visit(first);
            if second != first {
                visit(second);
            }
            if third != first && third != second {
                visit(third);
            }
            if fourth != first && fourth != second && fourth != third {
                visit(fourth);
            }
            if fifth != first && fifth != second && fifth != third && fifth != fourth {
                visit(fifth);
            }
            if sixth != first
                && sixth != second
                && sixth != third
                && sixth != fourth
                && sixth != fifth
            {
                visit(sixth);
            }
            if seventh != first
                && seventh != second
                && seventh != third
                && seventh != fourth
                && seventh != fifth
                && seventh != sixth
            {
                visit(seventh);
            }
            if eighth != first
                && eighth != second
                && eighth != third
                && eighth != fourth
                && eighth != fifth
                && eighth != sixth
                && eighth != seventh
            {
                visit(eighth);
            }
            return;
        }
        _ => {}
    }
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
fn retain_active_dispatch_clients(
    dispatch_map: &mut HashMap<String, Vec<EventProtocol>>,
    clients: &Clients,
) {
    retain_active_client_batches_map(dispatch_map, clients);
}

#[inline]
fn next_transport_sender<'a, I>(senders: &mut I) -> &'a mpsc::UnboundedSender<Bytes>
where
    I: Iterator<Item = &'a mpsc::UnboundedSender<Bytes>>,
{
    let Some(sender) = senders.next() else {
        unreachable!("transport length matched branch");
    };
    sender
}

#[inline]
fn send_to_transports(transports: &Transports, payload: Bytes) {
    match transports.len() {
        0 => {}
        1 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let _ = first_sender.send(payload);
        }
        2 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        3 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        4 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let fourth_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = fourth_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        5 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let fourth_sender = next_transport_sender(&mut senders);
            let fifth_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = fourth_sender.send(payload.clone());
            let _ = fifth_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        6 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let fourth_sender = next_transport_sender(&mut senders);
            let fifth_sender = next_transport_sender(&mut senders);
            let sixth_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = fourth_sender.send(payload.clone());
            let _ = fifth_sender.send(payload.clone());
            let _ = sixth_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        7 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let fourth_sender = next_transport_sender(&mut senders);
            let fifth_sender = next_transport_sender(&mut senders);
            let sixth_sender = next_transport_sender(&mut senders);
            let seventh_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = fourth_sender.send(payload.clone());
            let _ = fifth_sender.send(payload.clone());
            let _ = sixth_sender.send(payload.clone());
            let _ = seventh_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        8 => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            let second_sender = next_transport_sender(&mut senders);
            let third_sender = next_transport_sender(&mut senders);
            let fourth_sender = next_transport_sender(&mut senders);
            let fifth_sender = next_transport_sender(&mut senders);
            let sixth_sender = next_transport_sender(&mut senders);
            let seventh_sender = next_transport_sender(&mut senders);
            let eighth_sender = next_transport_sender(&mut senders);
            let _ = second_sender.send(payload.clone());
            let _ = third_sender.send(payload.clone());
            let _ = fourth_sender.send(payload.clone());
            let _ = fifth_sender.send(payload.clone());
            let _ = sixth_sender.send(payload.clone());
            let _ = seventh_sender.send(payload.clone());
            let _ = eighth_sender.send(payload.clone());
            let _ = first_sender.send(payload);
        }
        _ => {
            let mut senders = transports.values();
            let first_sender = next_transport_sender(&mut senders);
            for sender in senders {
                let _ = sender.send(payload.clone());
            }
            let _ = first_sender.send(payload);
        }
    }
}

#[inline]
fn take_vec_with_capacity<T>(buffer: &mut Vec<T>) -> Vec<T> {
    let capacity = buffer.capacity();
    std::mem::replace(buffer, Vec::with_capacity(capacity))
}

#[inline]
fn build_transport_events_message(
    world_name: &str,
    transports_map: &mut Vec<EventProtocol>,
) -> Option<Message> {
    if transports_map.is_empty() {
        return None;
    }
    if transports_map.len() == 1 {
        let Some(single_event) = transports_map.pop() else {
            unreachable!("single transport event length matched branch");
        };
        return Some(
            Message::new(&MessageType::Event)
                .world_name(world_name)
                .event_owned(single_event)
                .build(),
        );
    }
    let next_transport_event_capacity = transports_map.capacity();
    let transports_events_to_send = std::mem::replace(
        transports_map,
        Vec::with_capacity(next_transport_event_capacity),
    );
    Some(
        Message::new(&MessageType::Event)
            .world_name(world_name)
            .events_owned(transports_events_to_send)
            .build(),
    )
}

#[inline]
fn take_client_events_to_send(
    client_events: &mut Vec<EventProtocol>,
) -> Option<Result<Vec<EventProtocol>, EventProtocol>> {
    if client_events.is_empty() {
        return None;
    }
    if client_events.len() == 1 {
        let Some(single_event) = client_events.pop() else {
            unreachable!("single client event length matched branch");
        };
        return Some(Err(single_event));
    }
    let next_client_event_capacity = client_events.capacity();
    Some(Ok(std::mem::replace(
        client_events,
        Vec::with_capacity(next_client_event_capacity),
    )))
}

#[inline]
fn flush_events_for_client(
    dispatch_map: &mut HashMap<String, Vec<EventProtocol>>,
    clients: &Clients,
    client_id: String,
) {
    let Some(client_events) = dispatch_map.get_mut(&client_id) else {
        return;
    };
    let Some(client_events_to_send) = take_client_events_to_send(client_events) else {
        return;
    };
    let Some(client) = clients.get(&client_id) else {
        return;
    };
    let message = match client_events_to_send {
        Ok(events_to_send) => Message::new(&MessageType::Event)
            .events_owned(events_to_send)
            .build(),
        Err(single_event) => Message::new(&MessageType::Event)
            .event_owned(single_event)
            .build(),
    };
    let encoded = Bytes::from(encode_message(&message));
    let _ = client.sender.send(encoded);
}

#[inline]
fn pop_touched_client_id(touched_clients: &mut Vec<String>) -> String {
    let Some(client_id) = touched_clients.pop() else {
        unreachable!("touched-client length matched branch");
    };
    client_id
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
        } else {
            retain_active_dispatch_clients(dispatch_map, &clients);
        }
        if dispatch_map.capacity() < client_count && dispatch_map.len() < client_count {
            dispatch_map.reserve(client_count - dispatch_map.len());
        }
        let touched_clients = &mut self.touched_clients_buffer;
        touched_clients.clear();
        if touched_clients.capacity() < client_count {
            touched_clients.reserve(client_count - touched_clients.len());
        }
        let single_client = if client_count == 1 {
            let (single_client_id, single_client) = {
                let Some(client) = clients.iter().next() else {
                    unreachable!("single client length matched branch");
                };
                client
            };
            Some((single_client_id.as_str(), single_client.entity))
        } else {
            None
        };
        let transports_map = &mut self.transports_map_buffer;
        if has_transports {
            transports_map.clear();
            if transports_map.capacity() < queued_events_count {
                transports_map.reserve(queued_events_count - transports_map.len());
            }
        }
        let queued_events = take_vec_with_capacity(&mut events.queue);
        if client_count == 0 {
            for event in queued_events {
                let Event { name, payload, .. } = event;
                transports_map.push(EventProtocol {
                    name,
                    payload: payload.unwrap_or_else(|| String::from("{}")),
                });
            }
            let Some(message) =
                build_transport_events_message(&world_metadata.world_name, transports_map)
            else {
                return;
            };
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

        for event in queued_events {
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
                            match ids.as_slice() {
                                [first_id, second_id, third_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id && id != second_id && id != third_id {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                [first_id, second_id, third_id, fourth_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    let fourth_id = fourth_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id
                                            && id != second_id
                                            && id != third_id
                                            && id != fourth_id
                                        {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                [first_id, second_id, third_id, fourth_id, fifth_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    let fourth_id = fourth_id.as_str();
                                    let fifth_id = fifth_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id
                                            && id != second_id
                                            && id != third_id
                                            && id != fourth_id
                                            && id != fifth_id
                                        {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                [first_id, second_id, third_id, fourth_id, fifth_id, sixth_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    let fourth_id = fourth_id.as_str();
                                    let fifth_id = fifth_id.as_str();
                                    let sixth_id = sixth_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id
                                            && id != second_id
                                            && id != third_id
                                            && id != fourth_id
                                            && id != fifth_id
                                            && id != sixth_id
                                        {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                [first_id, second_id, third_id, fourth_id, fifth_id, sixth_id, seventh_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    let fourth_id = fourth_id.as_str();
                                    let fifth_id = fifth_id.as_str();
                                    let sixth_id = sixth_id.as_str();
                                    let seventh_id = seventh_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id
                                            && id != second_id
                                            && id != third_id
                                            && id != fourth_id
                                            && id != fifth_id
                                            && id != sixth_id
                                            && id != seventh_id
                                        {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                [first_id, second_id, third_id, fourth_id, fifth_id, sixth_id, seventh_id, eighth_id] => {
                                    let first_id = first_id.as_str();
                                    let second_id = second_id.as_str();
                                    let third_id = third_id.as_str();
                                    let fourth_id = fourth_id.as_str();
                                    let fifth_id = fifth_id.as_str();
                                    let sixth_id = sixth_id.as_str();
                                    let seventh_id = seventh_id.as_str();
                                    let eighth_id = eighth_id.as_str();
                                    for (id, client) in clients.iter() {
                                        let id = id.as_str();
                                        if id != first_id
                                            && id != second_id
                                            && id != third_id
                                            && id != fourth_id
                                            && id != fifth_id
                                            && id != sixth_id
                                            && id != seventh_id
                                            && id != eighth_id
                                        {
                                            send_to_client(id, client.entity);
                                        }
                                    }
                                }
                                _ => {
                                    for (id, client) in clients.iter() {
                                        if !ids_contains_target(ids, id.as_str()) {
                                            send_to_client(id, client.entity);
                                        }
                                    }
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
        if touched_clients.is_empty() && (!has_transports || transports_map.is_empty()) {
            return;
        }

        // Process the dispatch map, sending them directly for fastest event responses.
        match touched_clients.len() {
            1 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
            }
            2 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
            }
            3 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
            }
            4 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                let fourth_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
                flush_events_for_client(dispatch_map, &clients, fourth_client_id);
            }
            5 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                let fourth_client_id = pop_touched_client_id(touched_clients);
                let fifth_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
                flush_events_for_client(dispatch_map, &clients, fourth_client_id);
                flush_events_for_client(dispatch_map, &clients, fifth_client_id);
            }
            6 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                let fourth_client_id = pop_touched_client_id(touched_clients);
                let fifth_client_id = pop_touched_client_id(touched_clients);
                let sixth_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
                flush_events_for_client(dispatch_map, &clients, fourth_client_id);
                flush_events_for_client(dispatch_map, &clients, fifth_client_id);
                flush_events_for_client(dispatch_map, &clients, sixth_client_id);
            }
            7 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                let fourth_client_id = pop_touched_client_id(touched_clients);
                let fifth_client_id = pop_touched_client_id(touched_clients);
                let sixth_client_id = pop_touched_client_id(touched_clients);
                let seventh_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
                flush_events_for_client(dispatch_map, &clients, fourth_client_id);
                flush_events_for_client(dispatch_map, &clients, fifth_client_id);
                flush_events_for_client(dispatch_map, &clients, sixth_client_id);
                flush_events_for_client(dispatch_map, &clients, seventh_client_id);
            }
            8 => {
                let first_client_id = pop_touched_client_id(touched_clients);
                let second_client_id = pop_touched_client_id(touched_clients);
                let third_client_id = pop_touched_client_id(touched_clients);
                let fourth_client_id = pop_touched_client_id(touched_clients);
                let fifth_client_id = pop_touched_client_id(touched_clients);
                let sixth_client_id = pop_touched_client_id(touched_clients);
                let seventh_client_id = pop_touched_client_id(touched_clients);
                let eighth_client_id = pop_touched_client_id(touched_clients);
                flush_events_for_client(dispatch_map, &clients, first_client_id);
                flush_events_for_client(dispatch_map, &clients, second_client_id);
                flush_events_for_client(dispatch_map, &clients, third_client_id);
                flush_events_for_client(dispatch_map, &clients, fourth_client_id);
                flush_events_for_client(dispatch_map, &clients, fifth_client_id);
                flush_events_for_client(dispatch_map, &clients, sixth_client_id);
                flush_events_for_client(dispatch_map, &clients, seventh_client_id);
                flush_events_for_client(dispatch_map, &clients, eighth_client_id);
            }
            _ => {
                while let Some(client_id) = touched_clients.pop() {
                    flush_events_for_client(dispatch_map, &clients, client_id);
                }
            }
        }

        if has_transports {
            if let Some(message) =
                build_transport_events_message(&world_metadata.world_name, transports_map)
            {
                let encoded = Bytes::from(encode_message(&message));
                send_to_transports(&transports, encoded);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        filter_targets_all_clients, ids_are_strictly_sorted, ids_contains_target,
        include_single_target, sorted_ids_contains,
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
        assert!(ids_contains_target(&ids(&["e", "d", "c", "b", "a"]), "c"));
        assert!(!ids_contains_target(&ids(&["e", "d", "c", "b", "a"]), "z"));
        assert!(ids_contains_target(
            &ids(&["f", "e", "d", "c", "b", "a"]),
            "c"
        ));
        assert!(!ids_contains_target(
            &ids(&["f", "e", "d", "c", "b", "a"]),
            "z"
        ));
        assert!(ids_contains_target(
            &ids(&["h", "g", "f", "e", "d", "c", "b", "a"]),
            "d"
        ));
        assert!(!ids_contains_target(
            &ids(&["h", "g", "f", "e", "d", "c", "b", "a"]),
            "z"
        ));
    }

    #[test]
    fn include_single_target_detects_uniform_five_item_filters() {
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "k"])),
            Some("k")
        );
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "z"])),
            None
        );
    }

    #[test]
    fn include_single_target_detects_uniform_six_item_filters() {
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "k", "k"])),
            Some("k")
        );
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "k", "z"])),
            None
        );
    }

    #[test]
    fn include_single_target_detects_uniform_eight_item_filters() {
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "k", "k", "k", "k"])),
            Some("k")
        );
        assert_eq!(
            include_single_target(&ids(&["k", "k", "k", "k", "k", "k", "k", "z"])),
            None
        );
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
