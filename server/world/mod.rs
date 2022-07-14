mod clients;
mod components;
mod config;
mod entities;
mod events;
mod generators;
mod messages;
mod physics;
mod registry;
mod search;
mod stats;
mod systems;
mod types;
mod utils;
mod voxels;

use actix::Recipient;
use hashbrown::HashMap;
use log::{info, warn};
use nanoid::nanoid;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{
    shred::{Fetch, FetchMut, Resource},
    Builder, Component, DispatcherBuilder, Entity, EntityBuilder, Join, ReadStorage, SystemData,
    World as ECSWorld, WorldExt, WriteStorage,
};
use std::fs::{self, File};
use std::path::PathBuf;
use std::{env, hash::Hash};

use crate::{
    encode_message,
    protocols::Peer,
    server::{Message, MessageType},
    EncodedMessage, EntityProtocol, PeerProtocol, Vec2, Vec3,
};

use super::common::ClientFilter;

use self::systems::{
    AnimationMetaSystem, BroadcastSystem, ChunkMeshingSystem, ChunkPipeliningSystem,
    ChunkRequestsSystem, ChunkSavingSystem, ChunkSendingSystem, ChunkUpdatingSystem,
    ClearCollisionsSystem, CurrentChunkSystem, EntitiesSavingSystem, EntitiesSendingSystem,
    EntityMetaSystem, EventsBroadcastSystem, PeersMetaSystem, PeersSendingSystem, PhysicsSystem,
    SearchSystem, UpdateStatsSystem,
};

pub use clients::*;
pub use components::*;
pub use config::*;
pub use entities::*;
pub use events::*;
pub use generators::*;
pub use messages::*;
pub use physics::*;
pub use registry::*;
pub use search::*;
pub use stats::*;
pub use types::*;
pub use utils::*;
pub use voxels::*;

pub type ModifyDispatch =
    fn(DispatcherBuilder<'static, 'static>) -> DispatcherBuilder<'static, 'static>;

pub type CustomFunction<T> = fn(T, &mut World);

pub type ClientParser = fn(&str, Entity, &mut World);

pub type Transports = HashMap<String, Recipient<EncodedMessage>>;

/// The default client metadata parser, parses PositionComp and DirectionComp, and updates RigidBodyComp.
pub fn default_client_parser(metadata: &str, client_ent: Entity, world: &mut World) {
    let metadata: PeerUpdate =
        serde_json::from_str(metadata).expect("Could not parse peer update.");

    if let Some(position) = metadata.position {
        {
            let mut positions = world.write_component::<PositionComp>();
            if let Some(p) = positions.get_mut(client_ent) {
                p.0.set(position.0, position.1, position.2);
            }
        }

        {
            let mut bodies = world.write_component::<RigidBodyComp>();
            if let Some(b) = bodies.get_mut(client_ent) {
                b.0.set_position(position.0, position.1, position.2);
            }
        }
    }

    if let Some(direction) = metadata.direction {
        let mut directions = world.write_component::<DirectionComp>();
        if let Some(d) = directions.get_mut(client_ent) {
            d.0.set(direction.0, direction.1, direction.2);
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerUpdate {
    position: Option<Vec3<f32>>,
    direction: Option<Vec3<f32>>,
}

/// A voxelize world.
#[derive(Default)]
pub struct World {
    /// ID of the world, generated from `nanoid!()`.
    pub id: String,

    /// Name of the world, used for connection.
    pub name: String,

    /// Whether if the world has started.
    pub started: bool,

    /// Entity component system world.
    ecs: ECSWorld,

    /// The modifier of the ECS dispatcher.
    dispatcher: Option<ModifyDispatch>,

    /// The modifier of any new client.
    client_modifier: Option<CustomFunction<Entity>>,

    /// The metadata parser for clients.
    client_parser: Option<ClientParser>,

    /// The handler for `Method`s.
    method_handles: HashMap<String, CustomFunction<Value>>,

    /// The handler for `Transport`s.
    transport_handle: Option<CustomFunction<Value>>,
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
struct OnMethodRequest {
    method: String,
    data: Value,
}

impl World {
    /// Create a new voxelize world.
    pub fn new(name: &str, config: &WorldConfig) -> Self {
        let id = nanoid!();

        if config.saving {
            let folder = PathBuf::from(&config.save_dir);

            if !folder.exists() {
                panic!(
                    "World folder not created at: '{}'",
                    if folder.is_absolute() {
                        folder.to_path_buf()
                    } else {
                        if let Ok(curr_dir) = env::current_dir() {
                            curr_dir.join(folder)
                        } else {
                            folder
                        }
                    }
                    .to_string_lossy()
                );
            }

            info!("Storage for world '{}' is at '{}'", name, config.save_dir);
        } else {
            info!("World '{}' is temporarily saved in memory.", name);
        }

        let mut ecs = ECSWorld::new();

        ecs.register::<ChunkRequestsComp>();
        ecs.register::<CurrentChunkComp>();
        ecs.register::<IDComp>();
        ecs.register::<NameComp>();
        ecs.register::<PositionComp>();
        ecs.register::<DirectionComp>();
        ecs.register::<ClientFlag>();
        ecs.register::<EntityFlag>();
        ecs.register::<ETypeComp>();
        ecs.register::<MetadataComp>();
        ecs.register::<RigidBodyComp>();
        ecs.register::<AddrComp>();
        ecs.register::<InteractorComp>();
        ecs.register::<CollisionsComp>();
        ecs.register::<AnimationComp>();

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());

        ecs.insert(Chunks::new(config));
        ecs.insert(SeededNoise::new(config.seed));
        ecs.insert(SeededTerrain::new(config.seed, &config.terrain));
        ecs.insert(Entities::new(config.saving, &config.save_dir));
        ecs.insert(Search::new());

        ecs.insert(Mesher::new());
        ecs.insert(Pipeline::new());
        ecs.insert(Clients::new());
        ecs.insert(MessageQueue::new());
        ecs.insert(Stats::new());
        ecs.insert(Physics::new());
        ecs.insert(Events::new());
        ecs.insert(Transports::new());

        Self {
            id,
            name: name.to_owned(),
            started: false,

            ecs,

            dispatcher: Some(get_default_dispatcher),
            method_handles: HashMap::default(),
            client_parser: Some(default_client_parser),
            client_modifier: None,
            transport_handle: None,
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

    /// Insert a component into an entity.
    pub fn add<T: Component>(&mut self, e: Entity, c: T) {
        let mut storage: WriteStorage<T> = SystemData::fetch(self.ecs());
        storage.insert(e, c).unwrap();
    }

    /// Remove a component type from an entity.
    pub fn remove<T: Component>(&mut self, e: Entity) {
        let mut storage: WriteStorage<T> = SystemData::fetch(self.ecs());
        storage.remove(e);
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

    /// Get an ID from IDComp from an entity
    pub fn get_id(&self, entity: Entity) -> String {
        if let Some(id) = self.read_component::<IDComp>().get(entity) {
            id.0.to_owned()
        } else {
            panic!("Something went wrong! An entity does not have an `IDComp` attached!");
        }
    }

    /// Add a transport address to this world.
    pub fn add_transport(&mut self, id: &str, addr: &Recipient<EncodedMessage>) {
        let init_message = self.generate_init_message(id);
        self.send(addr, &init_message);
        self.write_resource::<Transports>()
            .insert(id.to_owned(), addr.to_owned());
    }

    /// Remove a transport address from this world.
    pub fn remove_transport(&mut self, id: &str) {
        self.write_resource::<Transports>().remove(id);
    }

    /// Add a client to the world by an ID and an Actix actor address.
    pub fn add_client(&mut self, id: &str, username: &str, addr: &Recipient<EncodedMessage>) {
        let init_message = self.generate_init_message(id);

        let body =
            RigidBody::new(&AABB::new().scale_x(0.8).scale_y(1.8).scale_z(0.8).build()).build();

        let interactor = self.physics_mut().register(&body);

        let ent = self
            .ecs
            .create_entity()
            .with(ClientFlag::default())
            .with(IDComp::new(id))
            .with(NameComp::new(username))
            .with(AddrComp::new(addr))
            .with(ChunkRequestsComp::default())
            .with(CurrentChunkComp::default())
            .with(MetadataComp::default())
            .with(PositionComp::default())
            .with(DirectionComp::default())
            .with(RigidBodyComp::new(&body))
            .with(InteractorComp::new(interactor))
            .with(CollisionsComp::new())
            .build();

        if let Some(modifier) = self.client_modifier.to_owned() {
            modifier(ent, self);
        }

        self.clients_mut().insert(
            id.to_owned(),
            Client {
                id: id.to_owned(),
                entity: ent,
                username: username.to_owned(),
                addr: addr.to_owned(),
            },
        );

        self.send(addr, &init_message);

        let join_message = Message::new(&MessageType::Join).text(id).build();
        self.broadcast(join_message, ClientFilter::All);

        info!("Client at {} joined the server to world: {}", id, self.name);
    }

    /// Remove a client from the world by endpoint.
    pub fn remove_client(&mut self, id: &str) {
        let removed = self.clients_mut().remove(id);

        if let Some(client) = removed {
            {
                let entities = self.ecs.entities();

                entities.delete(client.entity).unwrap_or_else(|_| {
                    panic!(
                        "Something went wrong with deleting this client: {}",
                        client.id
                    )
                });
            }

            self.ecs.maintain();

            let leave_message = Message::new(&MessageType::Leave).text(&client.id).build();
            self.broadcast(leave_message, ClientFilter::All);
            info!("Client at {} left the world: {}", id, self.name);
        }
    }

    pub fn set_dispatcher(&mut self, dispatch: ModifyDispatch) {
        self.dispatcher = Some(dispatch);
    }

    pub fn set_client_modifier(&mut self, modifier: CustomFunction<Entity>) {
        self.client_modifier = Some(modifier);
    }

    pub fn set_client_parser(&mut self, parser: ClientParser) {
        self.client_parser = Some(parser);
    }

    pub fn set_method_handle(&mut self, method: &str, handle: CustomFunction<Value>) {
        self.method_handles.insert(method.to_lowercase(), handle);
    }

    pub fn set_transport_handle(&mut self, handle: CustomFunction<Value>) {
        self.transport_handle = Some(handle);
    }

    pub fn generate_init_message(&self, id: &str) -> Message {
        let config = self.config().get_init_config();
        let mut json = HashMap::new();

        json.insert("id".to_owned(), json!(id));
        json.insert("blocks".to_owned(), json!(self.registry().blocks_by_name));
        json.insert("ranges".to_owned(), json!(self.registry().ranges));
        json.insert("params".to_owned(), json!(config));

        /* ------------------------ Loading other the clients ----------------------- */
        let ids = self.read_component::<IDComp>();
        let flags = self.read_component::<ClientFlag>();
        let names = self.read_component::<NameComp>();
        let metadatas = self.read_component::<MetadataComp>();

        let mut peers = vec![];

        for (pid, name, metadata, _) in (&ids, &names, &metadatas, &flags).join() {
            peers.push(PeerProtocol {
                id: pid.0.to_owned(),
                username: name.0.to_owned(),
                metadata: metadata.to_string(),
            })
        }

        /* -------------------------- Loading all entities -------------------------- */
        let etypes = self.read_component::<ETypeComp>();
        let metadatas = self.read_component::<MetadataComp>();

        let mut entities = vec![];

        for (id, etype, metadata) in (&ids, &etypes, &metadatas).join() {
            if metadata.is_empty() {
                continue;
            }

            let j_str = metadata.to_string();

            entities.push(EntityProtocol {
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(j_str),
            });
        }

        drop(ids);
        drop(etypes);
        drop(metadatas);

        Message::new(&MessageType::Init)
            .json(&serde_json::to_string(&json).unwrap())
            .peers(&peers)
            .entities(&entities)
            .build()
    }

    /// Handler for protobuf requests from clients.
    pub fn on_request(&mut self, client_id: &str, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(client_id, data),
            MessageType::Load => self.on_load(client_id, data),
            MessageType::Unload => self.on_unload(client_id, data),
            MessageType::Method => self.on_method(client_id, data),
            MessageType::Chat => self.on_chat(client_id, data),
            MessageType::Update => self.on_update(client_id, data),
            MessageType::Transport => {
                if let Some(transport_handle) = self.transport_handle {
                    transport_handle(
                        serde_json::from_str(&data.json)
                            .expect("Something went wrong with the transport JSON value."),
                        self,
                    );
                } else {
                    warn!("Transport calls are being called, but no transport handlers set!");
                }
            }
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
    pub fn send(&self, addr: &Recipient<EncodedMessage>, data: &Message) {
        addr.do_send(EncodedMessage(encode_message(data)));
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

    /// Access all entities metadata save-load manager.
    pub fn entities(&self) -> Fetch<Entities> {
        self.read_resource::<Entities>()
    }

    /// Access a mutable entities metadata save-load manager.
    pub fn entities_mut(&mut self) -> FetchMut<Entities> {
        self.write_resource::<Entities>()
    }

    /// Access the registry in the ECS world.
    pub fn registry(&self) -> Fetch<Registry> {
        self.read_resource::<Registry>()
    }

    /// Access chunks management in the ECS world.
    pub fn chunks(&self) -> Fetch<Chunks> {
        self.read_resource::<Chunks>()
    }

    /// Access a mutable chunk manager in the ECS world.
    pub fn chunks_mut(&mut self) -> FetchMut<Chunks> {
        self.write_resource::<Chunks>()
    }

    /// Access physics management in the ECS world.
    pub fn physics(&self) -> Fetch<Physics> {
        self.read_resource::<Physics>()
    }

    /// Access a mutable physics manager in the ECS world.
    pub fn physics_mut(&mut self) -> FetchMut<Physics> {
        self.write_resource::<Physics>()
    }

    /// Access the event queue in the ECS world.
    pub fn events(&self) -> Fetch<Events> {
        self.read_resource::<Events>()
    }

    /// Access the mutable events queue in the ECS world.
    pub fn events_mut(&mut self) -> FetchMut<Events> {
        self.write_resource::<Events>()
    }

    /// Access the search tree in the ECS world.
    pub fn search(&self) -> Fetch<Search> {
        self.read_resource::<Search>()
    }

    /// Access the mutable search tree in the ECS world.
    pub fn search_mut(&mut self) -> FetchMut<Search> {
        self.write_resource::<Search>()
    }

    /// Access the terrain of the ECS world.
    pub fn terrain(&self) -> Fetch<SeededTerrain> {
        self.read_resource::<SeededTerrain>()
    }

    /// Access a mutable terrain of the ECS world.
    pub fn terrain_mut(&mut self) -> FetchMut<SeededTerrain> {
        assert!(
            !self.started,
            "Cannot change terrain after world has started."
        );
        self.write_resource::<SeededTerrain>()
    }

    /// Access pipeline management in the ECS world.
    pub fn pipeline(&self) -> Fetch<Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Access a mutable pipeline management in the ECS world.
    pub fn pipeline_mut(&mut self) -> FetchMut<Pipeline> {
        assert!(
            !self.started,
            "Cannot change pipeline after world has started."
        );
        self.write_resource::<Pipeline>()
    }

    /// Create a basic entity ready to be added more.
    pub fn create_entity(&mut self, id: &str, etype: &str) -> EntityBuilder {
        self.ecs_mut()
            .create_entity()
            .with(IDComp::new(id))
            .with(EntityFlag::default())
            .with(ETypeComp::new(etype))
            .with(MetadataComp::new())
            .with(CurrentChunkComp::default())
            .with(CollisionsComp::new())
    }

    /// Spawn an entity of type at a location.
    pub fn spawn_entity(&mut self, etype: &str, position: &Vec3<f32>) -> Option<Entity> {
        let loader = if let Some(loader) = self.entities_mut().get_loader(etype) {
            loader
        } else {
            return None;
        };

        let ent = loader(nanoid!(), etype.to_owned(), MetadataComp::default(), self).build();
        set_position(self.ecs_mut(), ent, position.0, position.1, position.2);

        Some(ent)
    }

    /// Check if this world is empty.
    pub fn is_empty(&self) -> bool {
        let clients = self.read_resource::<Clients>();
        clients.is_empty()
    }

    /// Prepare to start.
    pub fn prepare(&mut self) {
        for (position, body) in (
            &self.ecs.read_storage::<PositionComp>(),
            &mut self.ecs.write_storage::<RigidBodyComp>(),
        )
            .join()
        {
            body.0
                .set_position(position.0 .0, position.0 .1, position.0 .2);
        }

        self.load_entities();
        // self.preload();
    }

    /// Tick of the world, run every 16ms.
    pub fn tick(&mut self) {
        if !self.started {
            self.started = true;
        }

        if self.is_empty() {
            return;
        }

        let builder = DispatcherBuilder::new()
            .with(UpdateStatsSystem, "update-stats", &[])
            .with(EntityMetaSystem, "entity-meta", &[])
            .with(PeersMetaSystem, "peers-meta", &[])
            .with(AnimationMetaSystem, "animation-meta", &[])
            .with(SearchSystem, "search", &["entity-meta", "peers-meta"])
            .with(CurrentChunkSystem, "current-chunking", &[])
            .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunking"])
            .with(ChunkRequestsSystem, "chunk-requests", &["current-chunking"])
            .with(
                ChunkPipeliningSystem,
                "chunk-pipelining",
                &["chunk-requests"],
            )
            .with(ChunkMeshingSystem, "chunk-meshing", &["chunk-pipelining"])
            .with(ChunkSendingSystem, "chunk-sending", &["chunk-meshing"])
            .with(ChunkSavingSystem, "chunk-saving", &["chunk-pipelining"])
            .with(PhysicsSystem, "physics", &["update-stats"]);

        let builder = self.dispatcher.unwrap()(builder);

        let builder = builder
            .with(
                EntitiesSavingSystem,
                "entities-saving",
                &["entity-meta", "animation-meta"],
            )
            .with(
                EntitiesSendingSystem,
                "entities-sending",
                &["entities-saving"],
            )
            .with(
                PeersSendingSystem,
                "peers-sending",
                &["peers-meta", "animation-meta"],
            )
            .with(
                BroadcastSystem,
                "broadcast",
                &["entities-sending", "peers-sending", "chunk-sending"],
            )
            .with(
                ClearCollisionsSystem,
                "clear-collisions",
                &["entities-sending"],
            )
            .with(
                EventsBroadcastSystem,
                "events-broadcasting",
                &["chunk-requests", "broadcast"],
            );

        let mut dispatcher = builder.build();
        dispatcher.dispatch(&self.ecs);

        self.ecs.maintain();
    }

    /// Handler for `Peer` type messages.
    fn on_peer(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        data.peers.into_iter().for_each(|peer| {
            let Peer {
                metadata, username, ..
            } = peer;

            {
                let mut names = self.write_component::<NameComp>();
                if let Some(n) = names.get_mut(client_ent) {
                    n.0 = username.to_owned();
                }
            }

            self.client_parser.unwrap()(&metadata, client_ent, self);

            if let Some(client) = self.clients_mut().get_mut(client_id) {
                client.username = username;
            }
        })
    }

    /// Handler for `Load` type messages.
    fn on_load(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
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
    fn on_unload(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
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

    /// Handler for `Update` type messages.
    fn on_update(&mut self, _: &str, data: Message) {
        let chunk_size = self.config().chunk_size;
        let mut chunks = self.chunks_mut();

        data.updates.into_iter().for_each(|update| {
            let coords =
                ChunkUtils::map_voxel_to_chunk(update.vx, update.vy, update.vz, chunk_size);

            if !chunks.is_within_world(&coords) {
                return;
            }

            chunks
                .to_update
                .push_front((Vec3(update.vx, update.vy, update.vz), update.voxel));
        });
    }

    /// Handler for `Method` type messages.
    fn on_method(&mut self, _: &str, data: Message) {
        let json: OnMethodRequest = serde_json::from_str(&data.json)
            .expect("`on_method` error. Could not read JSON string.");
        let method = json.method.to_lowercase();

        if !self.method_handles.contains_key(&method) {
            warn!("`Method` type messages received, but no method handler set.");
            return;
        }

        let handle = self.method_handles.get(&method).unwrap().to_owned();

        handle(json.data, self);
    }

    /// Handler for `Chat` type messages.
    fn on_chat(&mut self, _: &str, data: Message) {
        if let Some(chat) = data.chat.clone() {
            let sender = chat.sender;
            let body = chat.body;

            info!("{}: {}", sender, body);

            if body.starts_with('/') {
                let body = body
                    .strip_prefix('/')
                    .unwrap()
                    .split_whitespace()
                    .collect::<Vec<_>>();

                // let mut msgs = vec![];
            } else {
                self.broadcast(data, ClientFilter::All);
            }
        }
    }

    /// Load existing entities.
    fn load_entities(&mut self) {
        if self.config().saving {
            // TODO: THIS FEELS HACKY

            let paths = fs::read_dir(self.entities().folder.clone()).unwrap();
            let loaders = self.entities().loaders.to_owned();

            for path in paths {
                let path = path.unwrap().path();

                if let Ok(entity_data) = File::open(&path) {
                    let id = path.file_stem().unwrap().to_str().unwrap().to_owned();
                    let mut data: HashMap<String, Value> = serde_json::from_reader(entity_data)
                        .unwrap_or_else(|_| panic!("Could not load entity file: {:?}", path));
                    let etype: String = serde_json::from_value(data.remove("etype").unwrap())
                        .unwrap_or_else(|_| {
                            panic!("EType filed does not exist on file: {:?}", path)
                        });
                    let metadata: MetadataComp =
                        serde_json::from_value(data.remove("metadata").unwrap()).unwrap_or_else(
                            |_| panic!("Metadata filed does not exist on file: {:?}", path),
                        );

                    if let Some(loader) = loaders.get(&etype) {
                        loader(id, etype, metadata, self).build();
                    } else {
                        fs::remove_file(path).expect("Unable to remove entity file...");
                    }
                }
            }
        }
    }

    fn preload(&mut self) {
        let config = (*self.config()).to_owned();
        let radius = config.preload_radius as i32;

        let mut count = 0;
        for cx in -radius..=radius {
            for cz in -radius..=radius {
                if !self.chunks().is_within_world(&Vec2(cx, cz)) {
                    continue;
                }

                let new_chunk = Chunk::new(
                    &nanoid!(),
                    cx,
                    cz,
                    &ChunkParams {
                        max_height: config.max_height,
                        sub_chunks: config.sub_chunks,
                        size: config.chunk_size,
                    },
                );

                count += 1;

                self.pipeline_mut().postpone(&new_chunk.coords, 0);
                self.chunks_mut().add(new_chunk);
            }
        }

        info!("Preloaded {:?} chunks for world \"{}\"", count, self.name);
    }
}
