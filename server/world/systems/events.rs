use hashbrown::HashMap;
use serde_json::Value;
use specs::{Entity, ReadExpect, ReadStorage, System, WriteExpect};

use crate::{
    encode_message,
    world::metadata::WorldMetadata,
    ChunkInterests, ChunkRequestsComp, ClientFilter, Clients, Event, EventProtocol,
    Events, IDComp, Message, MessageType, Transports, Vec2, WorldTimingContext,
};

pub struct EventsSystem;

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
        let (transports, clients, interests, world_metadata, mut events, ids, requests, timing) = data;
        let _t = timing.timer("events");

        if events.queue.is_empty() {
            return;
        }

        let is_interested = |coords: &Vec2<i32>, entity: Entity| {
            if let Some(id) = ids.get(entity) {
                return interests.is_interested(&id.0, coords);
            }

            false
        };

        let serialize_payload = |name: String, payload: Option<String>| EventProtocol {
            name,
            payload: if payload.is_none() {
                String::from("{}")
            } else {
                payload.unwrap()
            },
        };

        // ID to a set of events, serialized.
        let mut dispatch_map: HashMap<String, Vec<EventProtocol>> = HashMap::new();
        let mut transports_map: Vec<EventProtocol> = vec![];

        events.queue.drain(..).for_each(|event| {
            let Event {
                name,
                payload,
                filter,
                location,
            } = event;

            let serialized = serialize_payload(name, payload);

            if !transports.is_empty() {
                transports_map.push(serialized.to_owned());
            }

            // Checks if location is required, otherwise just sends.
            let mut send_to_id = |id: &str| {
                if let Some(client) = clients.get(id) {
                    let mut queue = dispatch_map.remove(id).unwrap_or_default();
                    if let Some(location) = &location {
                        if is_interested(location, client.entity.to_owned()) {
                            queue.push(serialized.to_owned());
                        }
                    } else {
                        queue.push(serialized.to_owned());
                    }
                    dispatch_map.insert(id.to_owned(), queue);
                }
            };

            if let Some(filter) = filter {
                if let ClientFilter::Direct(id) = &filter {
                    send_to_id(id);
                    return;
                }

                for (id, _) in clients.iter() {
                    match &filter {
                        ClientFilter::All => {}
                        ClientFilter::Include(ids) => {
                            if !ids.iter().any(|i| *i == *id) {
                                continue;
                            }
                        }
                        ClientFilter::Exclude(ids) => {
                            if ids.iter().any(|i| *i == *id) {
                                continue;
                            }
                        }
                        _ => {}
                    };

                    send_to_id(id);
                }
            }
            // No filter, but a location is set.
            else if let Some(location) = &location {
                for (id, _) in clients.iter() {
                    if interests.is_interested(id, location) {
                        let mut queue = dispatch_map.remove(id).unwrap_or_default();
                        queue.push(serialized.clone());
                        dispatch_map.insert(id.to_owned(), queue);
                    }
                }
            } else {
                clients.iter().for_each(|(id, _)| {
                    let mut queue = dispatch_map.remove(id).unwrap_or_default();
                    queue.push(serialized.clone());
                    dispatch_map.insert(id.to_owned(), queue);
                });
            }
        });

        // Process the dispatch map, sending them directly for fastest event responses.
        dispatch_map.into_iter().for_each(|(id, events)| {
            if events.is_empty() {
                return;
            }

            let client = clients.get(&id);

            if client.is_none() {
                return;
            }

            let client = client.unwrap();
            let message = Message::new(&MessageType::Event).events(&events).build();
            let encoded = encode_message(&message);

            let _ = client.sender.send(encoded);
        });

        if !transports.is_empty() {
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
