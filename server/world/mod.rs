pub mod block;
pub mod chunk;
pub mod chunks;
pub mod client;
pub mod comps;
pub mod config;
pub mod lights;
pub mod mesher;
pub mod messages;
pub mod pipeline;
pub mod registry;
pub mod space;
pub mod sys;

use hashbrown::HashMap;
use message_io::{network::Endpoint, node::NodeHandler};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specs::{
    shred::{Fetch, FetchMut, Resource},
    world::EntitiesRes,
    Builder, Component, DispatcherBuilder, Entity, Read, ReadStorage, World as ECSWorld, WorldExt,
    WriteStorage,
};

use crate::{
    server::models::{encode_message, messages::Peer, Message, MessageType},
    vec::Vec2,
};

use super::common::ClientFilter;

pub use self::config::WorldConfig;
use self::{
    chunks::Chunks,
    client::Client,
    comps::{
        chunk_requests::ChunkRequestsComp, direction::DirectionComp, endpoint::EndpointComp,
        id::IDComp, position::PositionComp,
    },
    pipeline::Pipeline,
    registry::Registry,
};

pub type Clients = HashMap<Endpoint, Client>;

/// A voxelize world.
#[derive(Default)]
pub struct World {
    /// ID of the world, generated from `nanoid!()`.
    pub id: String,

    /// Name of the world, used for connection.
    pub name: String,

    /// Entity component system world.
    ecs: ECSWorld,

    dispatcher: Option<fn(&mut DispatcherBuilder)>,
}

fn get_default_dispatcher(_: &mut DispatcherBuilder) {}

#[derive(Serialize, Deserialize)]
struct OnChunkRequest {
    chunks: Vec<Vec2<i32>>,
}

#[derive(Serialize, Deserialize)]
struct OnSignalRequest {
    id: String,
    signal: Value,
}

impl World {
    /// Create a new voxelize world.
    pub fn new(name: &str, config: &WorldConfig) -> Self {
        let id = nanoid!();

        let mut ecs = ECSWorld::new();

        ecs.register::<ChunkRequestsComp>();
        ecs.register::<IDComp>();
        ecs.register::<EndpointComp>();
        ecs.register::<PositionComp>();
        ecs.register::<DirectionComp>();

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());

        ecs.insert(Chunks::new());
        ecs.insert(Pipeline::new());
        ecs.insert(Registry::new());
        ecs.insert(Clients::new());

        Self {
            id,
            name: name.to_owned(),

            ecs,

            dispatcher: Some(get_default_dispatcher),

            ..Default::default()
        }
    }

    /// Get a reference to the ECS world..
    pub fn ecs(&self) -> &ECSWorld {
        &self.ecs
    }

    /// Get a mutable reference to the ECS world.
    pub fn ecs_mut(&mut self) -> &mut ECSWorld {
        &mut self.ecs
    }

    /// Read an ECS resource generically.
    pub fn read_resource<T: Resource>(&self) -> Fetch<T> {
        self.ecs.read_resource::<T>()
    }

    /// Write an ECS resource generically.
    pub fn write_resource<T: Resource>(&mut self) -> FetchMut<T> {
        self.ecs.write_resource::<T>()
    }

    /// Read an ECS component storage.
    pub fn read_component<T: Component>(&self) -> ReadStorage<T> {
        self.ecs.read_component::<T>()
    }

    /// Write an ECS component storage.
    pub fn write_component<T: Component>(&mut self) -> WriteStorage<T> {
        self.ecs.write_component::<T>()
    }

    /// Read an entity by ID in the ECS world.
    pub fn get_entity(&self, ent_id: u32) -> Entity {
        self.entities().entity(ent_id)
    }

    /// Check if the world has a specific client at endpoint.
    pub fn has_client(&self, endpoint: &Endpoint) -> bool {
        self.clients().contains_key(endpoint)
    }

    /// Add a client to the world, with ID generated with `nanoid!()`.
    pub fn add_client(&mut self, endpoint: &Endpoint) -> String {
        let id = nanoid!();

        let ent = self
            .ecs
            .create_entity()
            .with(ChunkRequestsComp::default())
            .with(IDComp::new(&id))
            .with(EndpointComp::new(endpoint))
            .build();

        self.clients_mut().insert(
            endpoint.clone(),
            Client {
                id: id.to_owned(),
                ent_id: ent.id(),
            },
        );

        id
    }

    /// Remove a client from the world by endpoint.
    pub fn remove_client(&mut self, endpoint: &Endpoint) {
        let removed = self.clients_mut().remove(endpoint);

        if let Some(client) = removed {
            let entities = self.ecs.entities();
            let client_ent = entities.entity(client.ent_id);

            entities.delete(client_ent).expect(&format!(
                "Something went wrong with deleting this client: {}",
                client.id,
            ));
        }
    }

    pub fn set_dispatcher(&mut self, dispatch: fn(&mut DispatcherBuilder)) {
        self.dispatcher = Some(dispatch);
    }

    /// Handler for protobuf requests from clients.
    pub fn on_request(&mut self, endpoint: &Endpoint, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(endpoint, data),
            MessageType::Chunk => self.on_chunk(endpoint, data),
            MessageType::Signal => self.on_signal(endpoint, data),
            _ => {}
        }
    }

    /// Broadcast a protobuf message to a subset or all of the clients in the world.
    pub fn broadcast(&self, data: Message, filter: ClientFilter) {
        let encoded = encode_message(&data);

        self.clients().iter().for_each(|(endpoint, client)| {
            match &filter {
                ClientFilter::All => {}
                ClientFilter::Include(ids) => {
                    if !ids.iter().any(|i| *i == *client.id) {
                        return;
                    }
                }
                ClientFilter::Exclude(ids) => {
                    if ids.iter().any(|i| *i == *client.id) {
                        return;
                    }
                }
            };

            // TODO: check if is error
            self.handler().network().send(*endpoint, &encoded);
        });
    }

    /// Send a protobuf message directly to a client endpoint in the world.
    pub fn send(&self, data: Message, endpoint: &Endpoint) {
        let encoded = encode_message(&data);
        self.handler().network().send(*endpoint, &encoded);
    }

    /// Tick of the world, run every 16ms.
    pub fn tick(&mut self) {
        if self.is_empty() {
            return;
        }

        let mut builder = DispatcherBuilder::new();
        self.dispatcher.unwrap()(&mut builder);
        let mut dispatcher = builder.build();
        dispatcher.dispatch(&self.ecs);

        self.ecs.maintain();
    }

    /// Access to the network handler.
    pub fn handler(&self) -> Fetch<NodeHandler<()>> {
        self.read_resource::<NodeHandler<()>>()
    }

    /// Access to the world's config.
    pub fn config(&self) -> Fetch<WorldConfig> {
        self.read_resource::<WorldConfig>()
    }

    /// Access all clients in the ECS world.
    pub fn clients(&self) -> Fetch<Clients> {
        self.read_resource::<Clients>()
    }

    /// Access a mutable clients map in the ECS world.
    pub fn clients_mut(&mut self) -> FetchMut<Clients> {
        self.write_resource::<Clients>()
    }

    /// Access the registry in the ECS world.
    pub fn registry(&self) -> Fetch<Registry> {
        self.read_resource::<Registry>()
    }

    /// Access a mutable registry in the ECS world.
    pub fn registry_mut(&mut self) -> FetchMut<Registry> {
        self.write_resource::<Registry>()
    }

    /// Access chunks management in the ECS world.
    pub fn chunks(&self) -> Fetch<Chunks> {
        self.read_resource::<Chunks>()
    }

    /// Access a mutable chunk manager in the ECS world.
    pub fn chunks_mut(&mut self) -> FetchMut<Chunks> {
        self.write_resource::<Chunks>()
    }

    /// Access the chunking pipeline.
    pub fn pipeline(&self) -> Fetch<Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Accessing a mutable reference to the chunking pipeline.
    pub fn pipeline_mut(&mut self) -> FetchMut<Pipeline> {
        self.write_resource::<Pipeline>()
    }

    /// Access all entities in this ECS world.
    pub fn entities(&self) -> Read<EntitiesRes> {
        self.ecs.entities()
    }

    /// Access and mutate all entities in this ECS world.
    pub fn entities_mut(&mut self) -> FetchMut<EntitiesRes> {
        self.ecs.entities_mut()
    }

    /// Get a client's endpoint from ID
    pub fn id_to_endpoint(&self, id: &str) -> Option<Endpoint> {
        if let Some((endpoint, _)) = self.clients().iter().find(|(_, client)| client.id == id) {
            return Some(endpoint.clone());
        }

        None
    }

    /// Check if this world is empty
    pub fn is_empty(&self) -> bool {
        let clients = self.read_resource::<Clients>();
        clients.is_empty()
    }

    /// Handler for `Peer` type messages.
    fn on_peer(&mut self, endpoint: &Endpoint, data: Message) {
        let ent_id = if let Some(client) = self.clients().get(endpoint) {
            client.ent_id.to_owned()
        } else {
            return;
        };

        let client_ent = self.get_entity(ent_id);

        if let Some(Peer {
            direction,
            position,
            ..
        }) = data.peer
        {
            if let Some(position) = position {
                let mut positions = self.write_component::<PositionComp>();
                let p = positions.get_mut(client_ent).unwrap();
                p.0.set(position.x, position.y, position.z);
            }

            if let Some(direction) = direction {
                let mut directions = self.write_component::<DirectionComp>();
                let d = directions.get_mut(client_ent).unwrap();
                d.0.set(direction.x, direction.y, direction.z);
            }
        }
    }

    /// Handler for `Signal` type messages.
    fn on_signal(&mut self, endpoint: &Endpoint, data: Message) {
        let client_id = if let Some(client) = self.clients().get(endpoint) {
            client.id.to_owned()
        } else {
            return;
        };

        let json: OnSignalRequest = serde_json::from_str(&data.json)
            .expect("`on_signal` error. Could not read JSON string.");

        let id = json.id;
        let signal = json.signal;

        if let Some(endpoint) = self.id_to_endpoint(&id) {
            let json = OnSignalRequest {
                id: client_id,
                signal,
            };
            let message = Message::new(&MessageType::Signal)
                .json(
                    &serde_json::to_string(&json).expect("Unable to serialize `OnSignalRequest`."),
                )
                .build();
            let encoded = encode_message(&message);
            self.handler().network().send(endpoint, &encoded);
        }
    }

    /// Handler for `Chunk` type messages.
    fn on_chunk(&mut self, endpoint: &Endpoint, data: Message) {
        let ent_id = if let Some(client) = self.clients().get(endpoint) {
            client.ent_id.to_owned()
        } else {
            return;
        };

        let json: OnChunkRequest = serde_json::from_str(&data.json)
            .expect("`on_chunk` error. Could not read JSON string.");

        let mut chunks = json.chunks;
        let client_ent = self.get_entity(ent_id);

        let mut storage = self.write_component::<ChunkRequestsComp>();

        if let Some(requests) = storage.get_mut(client_ent) {
            requests.0.append(&mut chunks);
        }
    }
}
