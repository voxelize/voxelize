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
            entry.insert(client_id.to_owned(), vec![event]);
        }
    }
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
        let has_transports = !transports.is_empty();
        let queued_events_count = events.queue.len();
        let dispatch_map = &mut self.dispatch_map_buffer;
        dispatch_map.retain(|id, _| clients.contains_key(id));
        let touched_clients = &mut self.touched_clients_buffer;
        touched_clients.clear();
        if touched_clients.capacity() < clients.len() {
            touched_clients.reserve(clients.len() - touched_clients.capacity());
        }
        let transports_map = &mut self.transports_map_buffer;
        transports_map.clear();
        if has_transports && transports_map.capacity() < queued_events_count {
            transports_map.reserve(queued_events_count - transports_map.capacity());
        }

        let is_interested = |coords: &Vec2<i32>, entity: Entity| {
            if let Some(id) = ids.get(entity) {
                return interests.is_interested(&id.0, coords);
            }

            false
        };

        let serialize_payload = |name: String, payload: Option<String>| EventProtocol {
            name,
            payload: payload.unwrap_or_else(|| String::from("{}")),
        };

        for event in events.queue.drain(..) {
            let Event {
                name,
                payload,
                filter,
                location,
            } = event;

            let serialized = serialize_payload(name, payload);

            if has_transports {
                transports_map.push(serialized.clone());
            }

            // Checks if location is required, otherwise just sends.
            let mut send_to_client = |id: &String, entity: Entity| {
                if let Some(location) = &location {
                    if !is_interested(location, entity) {
                        return;
                    }
                }
                push_dispatch_event(dispatch_map, touched_clients, id, serialized.clone());
            };

            let mut send_to_id = |id: &str| {
                if let Some(client) = clients.get(id) {
                    send_to_client(&client.id, client.entity);
                }
            };

            if let Some(filter) = filter {
                if let ClientFilter::Direct(id) = &filter {
                    send_to_id(id);
                    return;
                }

                match &filter {
                    ClientFilter::All => {
                        for (id, client) in clients.iter() {
                            send_to_client(id, client.entity);
                        }
                    }
                    ClientFilter::Include(ids) => {
                        if ids.len() <= 4 {
                            for (id, client) in clients.iter() {
                                if ids.iter().any(|included_id| included_id == id) {
                                    send_to_client(id, client.entity);
                                }
                            }
                        } else {
                            let include_ids: HashSet<&str> =
                                ids.iter().map(String::as_str).collect();
                            for (id, client) in clients.iter() {
                                if include_ids.contains(id.as_str()) {
                                    send_to_client(id, client.entity);
                                }
                            }
                        }
                    }
                    ClientFilter::Exclude(ids) => {
                        if ids.len() <= 4 {
                            for (id, client) in clients.iter() {
                                if !ids.iter().any(|excluded_id| excluded_id == id) {
                                    send_to_client(id, client.entity);
                                }
                            }
                        } else {
                            let exclude_ids: HashSet<&str> =
                                ids.iter().map(String::as_str).collect();
                            for (id, client) in clients.iter() {
                                if !exclude_ids.contains(id.as_str()) {
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
            transports.values().for_each(|sender| {
                let _ = sender.send(encoded.clone());
            });
        }
    }
}
