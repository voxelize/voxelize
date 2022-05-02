pub mod access;
pub mod block;
pub mod chunk;
pub mod chunks;
pub mod clients;
pub mod comps;
pub mod config;
pub mod lights;
pub mod mesher;
pub mod messages;
pub mod pipeline;
pub mod registry;
pub mod space;
pub mod stats;
pub mod sys;

use hashbrown::HashMap;
use log::info;
use message_io::{network::Endpoint, node::NodeHandler};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{
    shred::{Fetch, FetchMut, Resource},
    world::EntitiesRes,
    Builder, Component, DispatcherBuilder, Entity, Read, ReadStorage, World as ECSWorld, WorldExt,
    WriteStorage,
};

use crate::{
    common::BlockChanges,
    server::models::{encode_message, messages::Peer, Message, MessageType},
    vec::Vec2,
};

use super::common::ClientFilter;

pub use self::config::WorldConfig;
use self::{
    chunks::Chunks,
    clients::Clients,
    comps::{
        chunk_requests::ChunkRequestsComp,
        current_chunk::CurrentChunkComp,
        direction::DirectionComp,
        endpoint::EndpointComp,
        etype::ETypeComp,
        flags::{ClientFlag, EntityFlag},
        heading::HeadingComp,
        id::IDComp,
        metadata::MetadataComp,
        position::PositionComp,
        target::TargetComp,
    },
    mesher::Mesher,
    messages::MessageQueue,
    pipeline::Pipeline,
    registry::Registry,
    stats::Stats,
    sys::{
        broadcast::{entities::BroadcastEntitiesSystem, BroadcastSystem},
        chunk::{
            current::CurrentChunkSystem, meshing::ChunkMeshingSystem,
            pipelining::ChunkPipeliningSystem, requests::ChunkRequestsSystem,
            sending::ChunkSendingSystem,
        },
        entity_meta::EntityMetaSystem,
    },
};

pub type ModifyDispatch =
    fn(DispatcherBuilder<'static, 'static>) -> DispatcherBuilder<'static, 'static>;

/// A voxelize world.
#[derive(Default)]
pub struct World {
    /// ID of the world, generated from `nanoid!()`.
    pub id: String,

    /// Name of the world, used for connection.
    pub name: String,

    /// Entity component system world.
    ecs: ECSWorld,

    dispatcher: Option<ModifyDispatch>,
}

fn get_default_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder
}

#[derive(Serialize, Deserialize)]
struct OnLoadRequest {
    chunks: Vec<Vec2<i32>>,
}

#[derive(Serialize, Deserialize)]
struct OnUnloadRequest {
    chunks: Vec<Vec2<i32>>,
}

#[derive(Serialize, Deserialize)]
struct OnSignalRequest {
    id: String,
    signal: Value,
}

#[derive(Serialize, Deserialize)]
struct OnDebugRequest {
    method: String,
    data: Value,
}

impl World {
    /// Create a new voxelize world.
    pub fn new(name: &str, config: &WorldConfig) -> Self {
        let id = nanoid!();

        let mut ecs = ECSWorld::new();

        ecs.register::<ChunkRequestsComp>();
        ecs.register::<CurrentChunkComp>();
        ecs.register::<IDComp>();
        ecs.register::<EndpointComp>();
        ecs.register::<PositionComp>();
        ecs.register::<DirectionComp>();
        ecs.register::<ClientFlag>();
        ecs.register::<EntityFlag>();
        ecs.register::<ETypeComp>();
        ecs.register::<HeadingComp>();
        ecs.register::<MetadataComp>();
        ecs.register::<TargetComp>();

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());

        ecs.insert(Chunks::new(config));

        ecs.insert(Mesher::new());
        ecs.insert(Pipeline::new());
        ecs.insert(Registry::new());
        ecs.insert(Clients::new());
        ecs.insert(MessageQueue::new());
        ecs.insert(BlockChanges::new());
        ecs.insert(Stats::new());

        Self {
            id,
            name: name.to_owned(),

            ecs,

            dispatcher: Some(get_default_dispatcher),

            ..Default::default()
        }
    }

    /// Get ready to start the server.
    pub fn prepare(&mut self) {
        self.registry_mut().generate();
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
        self.clients().has(endpoint)
    }

    /// Add a client to the world, with ID generated with `nanoid!()`.
    pub fn add_client(&mut self, endpoint: &Endpoint) -> String {
        let id = nanoid!();

        let config = self.config().get_init_config();
        let mut json = HashMap::new();

        json.insert("id".to_owned(), json!(id));
        json.insert("blocks".to_owned(), json!(self.registry().blocks_by_name));
        json.insert("ranges".to_owned(), json!(self.registry().ranges));
        json.insert("params".to_owned(), json!(config));

        let peers = self.clients().id_list();

        let ent = self
            .ecs
            .create_entity()
            .with(ClientFlag::default())
            .with(IDComp::new(&id))
            .with(EndpointComp::new(endpoint))
            .with(ChunkRequestsComp::default())
            .with(CurrentChunkComp::default())
            .with(PositionComp::default())
            .with(DirectionComp::default())
            .build();

        self.clients_mut().add(endpoint, &id, &ent);

        let init_message = Message::new(&MessageType::Init)
            .json(&serde_json::to_string(&json).unwrap())
            .peers(&peers)
            .build();

        self.send(endpoint, &init_message);

        let join_message = Message::new(&MessageType::Join).text(&id).build();
        self.broadcast(join_message, ClientFilter::All);

        id
    }

    /// Remove a client from the world by endpoint.
    pub fn remove_client(&mut self, endpoint: &Endpoint) {
        let removed = self.clients_mut().remove(endpoint);

        if let Some(client) = removed {
            let entities = self.ecs.entities();

            entities.delete(client.entity).expect(&format!(
                "Something went wrong with deleting this client: {}",
                client.id,
            ));
        }
    }

    pub fn set_dispatcher(&mut self, dispatch: ModifyDispatch) {
        self.dispatcher = Some(dispatch);
    }

    /// Handler for protobuf requests from clients.
    pub fn on_request(&mut self, endpoint: &Endpoint, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(endpoint, data),
            MessageType::Load => self.on_load(endpoint, data),
            MessageType::Signal => self.on_signal(endpoint, data),
            MessageType::Unload => self.on_unload(endpoint, data),
            MessageType::Debug => self.on_debug(endpoint, data),
            _ => {
                info!("Received message of unknown type: {:?}", msg_type);
            }
        }
    }

    /// Broadcast a protobuf message to a subset or all of the clients in the world.
    pub fn broadcast(&mut self, data: Message, filter: ClientFilter) {
        self.write_resource::<MessageQueue>().push((data, filter));
    }

    /// Send a direct message to an endpoint
    pub fn send(&self, endpoint: &Endpoint, data: &Message) {
        let encoded = encode_message(data);
        self.handler().network().send(*endpoint, &encoded);
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

    /// Access pipeline management in the ECS world.
    pub fn pipeline(&self) -> Fetch<Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Access a mutable pipeline management in the ECS world.
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

    /// Check if this world is empty
    pub fn is_empty(&self) -> bool {
        let clients = self.read_resource::<Clients>();
        clients.is_empty()
    }

    /// Tick of the world, run every 16ms.
    pub fn tick(&mut self) {
        if self.is_empty() {
            return;
        }

        let builder = DispatcherBuilder::new()
            .with(EntityMetaSystem, "entity-meta", &[])
            .with(CurrentChunkSystem, "current-chunking", &[])
            .with(ChunkRequestsSystem, "chunk-requests", &["current-chunking"])
            .with(
                ChunkPipeliningSystem,
                "chunk-pipelining",
                &["chunk-requests"],
            )
            .with(ChunkMeshingSystem, "chunk-meshing", &["chunk-pipelining"])
            .with(ChunkSendingSystem, "chunk-sending", &["chunk-meshing"]);

        let builder = self.dispatcher.unwrap()(builder);

        let builder = builder
            .with(BroadcastEntitiesSystem, "broadcast-entities", &[])
            .with(BroadcastSystem, "broadcast", &["broadcast-entities"]);

        let mut dispatcher = builder.build();
        dispatcher.dispatch(&mut self.ecs);

        self.ecs.maintain();
    }

    /// Handler for `Peer` type messages.
    fn on_peer(&mut self, endpoint: &Endpoint, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(endpoint) {
            client.entity.to_owned()
        } else {
            return;
        };

        if let Some(Peer {
            direction,
            position,
            ..
        }) = data.peer
        {
            if let Some(position) = position {
                let mut positions = self.write_component::<PositionComp>();
                if let Some(p) = positions.get_mut(client_ent) {
                    p.0.set(position.x, position.y, position.z);
                }
            }

            if let Some(direction) = direction {
                let mut directions = self.write_component::<DirectionComp>();
                if let Some(d) = directions.get_mut(client_ent) {
                    d.0.set(direction.x, direction.y, direction.z);
                }
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

        if let Some(endpoint) = self.clients().id_to_endpoint(&id) {
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
            self.handler().network().send(endpoint.to_owned(), &encoded);
        }
    }

    /// Handler for `Load` type messages.
    fn on_load(&mut self, endpoint: &Endpoint, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(endpoint) {
            client.entity.to_owned()
        } else {
            return;
        };

        let json: OnLoadRequest =
            serde_json::from_str(&data.json).expect("`on_load` error. Could not read JSON string.");

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        let mut storage = self.write_component::<ChunkRequestsComp>();

        if let Some(requests) = storage.get_mut(client_ent) {
            chunks.into_iter().for_each(|coords| {
                requests.add(&coords);
            });
        }
    }

    /// Handler for `Unload` type messages.
    fn on_unload(&mut self, endpoint: &Endpoint, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(endpoint) {
            client.entity.to_owned()
        } else {
            return;
        };

        let json: OnUnloadRequest = serde_json::from_str(&data.json)
            .expect("`on_unload` error. Could not read JSON string.");

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        let mut storage = self.write_component::<ChunkRequestsComp>();

        if let Some(requests) = storage.get_mut(client_ent) {
            chunks.into_iter().for_each(|coords| {
                requests.unload(&coords);
            });
        }
    }

    /// Handler for `Debug` type messages.
    fn on_debug(&mut self, _: &Endpoint, data: Message) {
        let json: OnDebugRequest = serde_json::from_str(&data.json)
            .expect("`on_debug` error. Could not read JSON string.");

        let mut chunks = self.chunks_mut();

        if json.method.to_lowercase() == "remesh" {
            let x = json.data["cx"].as_i64().unwrap() as i32;
            let z = json.data["cz"].as_i64().unwrap() as i32;

            chunks.to_remesh.insert(Vec2(x, z));
        } else {
            info!("Received unknown debug method of {}", json.method);
        }
    }
}
