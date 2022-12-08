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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{
    shred::{Fetch, FetchMut, Resource},
    Builder, Component, DispatcherBuilder, Entity, EntityBuilder, Join, ReadStorage, SystemData,
    World as ECSWorld, WorldExt, WriteStorage,
};
use std::fs::{self, File};
use std::path::PathBuf;
use std::{env, sync::Arc};

use crate::{
    encode_message,
    protocols::Peer,
    server::{Message, MessageType},
    EncodedMessage, EntityProtocol, PeerProtocol, Vec2, Vec3,
};

use super::common::ClientFilter;

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
pub use systems::*;
pub use types::*;
pub use utils::*;
pub use voxels::*;

pub type Transports = HashMap<String, Recipient<EncodedMessage>>;

/// The default client metadata parser, parses PositionComp and DirectionComp, and updates RigidBodyComp.
pub fn default_client_parser(world: &mut World, metadata: &str, client_ent: Entity) {
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
pub struct World {
    /// ID of the world, generated from `nanoid!()`.
    pub id: String,

    /// Name of the world, used for connection.
    pub name: String,

    /// Whether if the world has started.
    pub started: bool,

    /// Whether if the world is preloading.
    pub preloading: bool,

    /// The progress of preloading.
    pub preload_progress: f32,

    /// Entity component system world.
    ecs: ECSWorld,

    /// The modifier of the ECS dispatcher.
    dispatcher: Arc<dyn Fn() -> DispatcherBuilder<'static, 'static>>,

    /// The modifier of any new client.
    client_modifier: Option<Arc<dyn Fn(&mut World, Entity)>>,

    /// The metadata parser for clients.
    client_parser: Arc<dyn Fn(&mut World, &str, Entity)>,

    /// The handler for `Method`s.
    method_handles: HashMap<String, Arc<dyn Fn(&mut World, &str, &str)>>,

    /// The handlers for `Event`s.
    event_handles: HashMap<String, Arc<dyn Fn(&mut World, &str, &str)>>,

    /// The handler for `Transport`s.
    transport_handle: Option<Arc<dyn Fn(&mut World, Value)>>,

    /// The handler for commands.
    command_handle: Option<Arc<dyn Fn(&mut World, &str, &str)>>,

    /// A map to spawn and create entities.
    entity_loaders: HashMap<String, Arc<dyn Fn(&mut World, MetadataComp) -> EntityBuilder>>,
}

fn dispatcher() -> DispatcherBuilder<'static, 'static> {
    DispatcherBuilder::new()
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(EntitiesMetaSystem, "entities-meta", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
        .with(CurrentChunkSystem, "current-chunk", &[])
        .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunk"])
        .with(ChunkRequestsSystem, "chunk-requests", &["current-chunk"])
        .with(
            ChunkGeneratingSystem,
            "chunk-generating",
            &["chunk-requests"],
        )
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-generating"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-generating"])
        .with(PhysicsSystem, "physics", &["current-chunk", "update-stats"])
        .with(EntitiesSavingSystem, "entities-saving", &["entities-meta"])
        .with(
            EntitiesSendingSystem,
            "entities-sending",
            &["entities-meta"],
        )
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["entities-sending", "peers-sending"],
        )
        .with(
            ClearCollisionsSystem,
            "clear-collisions",
            &["entities-sending", "peers-sending"],
        )
        .with(EventsSystem, "events", &["broadcast"])
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
struct OnEventRequest {
    name: String,
    payload: Value,
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

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());

        ecs.insert(Chunks::new(config));
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
            preloading: false,
            preload_progress: 0.0,

            ecs,

            dispatcher: Arc::new(dispatcher),
            method_handles: HashMap::default(),
            event_handles: HashMap::default(),
            entity_loaders: HashMap::default(),
            client_parser: Arc::new(default_client_parser),
            client_modifier: None,
            transport_handle: None,
            command_handle: None,
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
    pub(crate) fn add_transport(&mut self, id: &str, addr: &Recipient<EncodedMessage>) {
        let init_message = self.generate_init_message(id);
        self.send(addr, &init_message);
        self.write_resource::<Transports>()
            .insert(id.to_owned(), addr.to_owned());
    }

    /// Remove a transport address from this world.
    pub(crate) fn remove_transport(&mut self, id: &str) {
        self.write_resource::<Transports>().remove(id);
    }

    /// Add a client to the world by an ID and an Actix actor address.
    pub(crate) fn add_client(
        &mut self,
        id: &str,
        username: &str,
        addr: &Recipient<EncodedMessage>,
    ) {
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
            .with(InteractorComp::new(&interactor))
            .with(CollisionsComp::new())
            .build();

        if let Some(modifier) = self.client_modifier.to_owned() {
            modifier(self, ent);
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
    pub(crate) fn remove_client(&mut self, id: &str) {
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

    pub fn set_dispatcher<F: Fn() -> DispatcherBuilder<'static, 'static> + 'static>(
        &mut self,
        dispatch: F,
    ) {
        self.dispatcher = Arc::new(dispatch);
    }

    pub fn set_client_modifier<F: Fn(&mut World, Entity) + 'static>(&mut self, modifier: F) {
        self.client_modifier = Some(Arc::new(modifier));
    }

    pub fn set_client_parser<F: Fn(&mut World, &str, Entity) + 'static>(&mut self, parser: F) {
        self.client_parser = Arc::new(parser);
    }

    pub fn set_method_handle<F: Fn(&mut World, &str, &str) + 'static>(
        &mut self,
        method: &str,
        handle: F,
    ) {
        self.method_handles
            .insert(method.to_lowercase(), Arc::new(handle));
    }

    pub fn set_event_handle<F: Fn(&mut World, &str, &str) + 'static>(
        &mut self,
        event: &str,
        handle: F,
    ) {
        self.event_handles
            .insert(event.to_lowercase(), Arc::new(handle));
    }

    pub fn set_transport_handle<F: Fn(&mut World, Value) + 'static>(&mut self, handle: F) {
        self.transport_handle = Some(Arc::new(handle));
    }

    pub fn set_command_handle<F: Fn(&mut World, &str, &str) + 'static>(&mut self, handle: F) {
        self.command_handle = Some(Arc::new(handle));
    }

    pub fn set_entity_loader<F: Fn(&mut World, MetadataComp) -> EntityBuilder + 'static>(
        &mut self,
        etype: &str,
        loader: F,
    ) {
        self.entity_loaders
            .insert(etype.to_lowercase(), Arc::new(loader));
    }

    /// Handler for protobuf requests from clients.
    pub(crate) fn on_request(&mut self, client_id: &str, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(client_id, data),
            MessageType::Load => self.on_load(client_id, data),
            MessageType::Unload => self.on_unload(client_id, data),
            MessageType::Method => self.on_method(client_id, data),
            MessageType::Chat => self.on_chat(client_id, data),
            MessageType::Update => self.on_update(client_id, data),
            MessageType::Event => self.on_event(client_id, data),
            MessageType::Transport => {
                if self.transport_handle.is_none() {
                    warn!("Transport calls are being called, but no transport handlers set!");
                } else {
                    let handle = self.transport_handle.as_ref().unwrap().to_owned();

                    handle(
                        self,
                        serde_json::from_str(&data.json)
                            .expect("Something went wrong with the transport JSON value."),
                    );
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

    /// Access pipeline management in the ECS world.
    pub fn pipeline(&self) -> Fetch<Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Access a mutable pipeline management in the ECS world.
    pub fn pipeline_mut(&mut self) -> FetchMut<Pipeline> {
        assert!(
            !self.started || self.preloading,
            "Cannot change pipeline after world has started and preloaded."
        );
        self.write_resource::<Pipeline>()
    }

    /// Access the mesher in the ECS world.
    pub fn mesher(&self) -> Fetch<Mesher> {
        self.read_resource::<Mesher>()
    }

    /// Access a mutable mesher in the ECS world.
    pub fn mesher_mut(&mut self) -> FetchMut<Mesher> {
        assert!(
            !self.started || self.preloading,
            "Cannot change mesher after world has started and preloaded."
        );
        self.write_resource::<Mesher>()
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
        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to spawn unknown entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        let ent = loader(self, MetadataComp::default()).build();
        self.populate_entity(ent, &nanoid!(), etype, MetadataComp::default());

        set_position(self.ecs_mut(), ent, position.0, position.1, position.2);

        Some(ent)
    }

    pub fn revive_entity(
        &mut self,
        id: &str,
        etype: &str,
        metadata: MetadataComp,
    ) -> Option<Entity> {
        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to revive unknown entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        let ent = loader(self, metadata.to_owned()).build();
        self.populate_entity(ent, id, etype, metadata);

        info!("{:?}", self.ecs().read_component::<PositionComp>().get(ent));

        Some(ent)
    }

    pub fn populate_entity(&mut self, ent: Entity, id: &str, etype: &str, metadata: MetadataComp) {
        self.ecs_mut()
            .write_storage::<IDComp>()
            .insert(ent, IDComp::new(id))
            .expect("Failed to insert ID component");

        self.ecs_mut()
            .write_storage::<ETypeComp>()
            .insert(ent, ETypeComp::new(etype))
            .expect("Failed to insert entity type component");

        self.ecs_mut()
            .write_storage::<EntityFlag>()
            .insert(ent, EntityFlag::default())
            .expect("Failed to insert entity flag");

        self.ecs_mut()
            .write_storage::<CurrentChunkComp>()
            .insert(ent, CurrentChunkComp::default())
            .expect("Failed to insert current chunk component");

        self.ecs_mut()
            .write_storage::<CollisionsComp>()
            .insert(ent, CollisionsComp::new())
            .expect("Failed to insert collisions component");

        self.ecs_mut()
            .write_storage::<MetadataComp>()
            .insert(ent, metadata)
            .expect("Failed to insert metadata component");
    }

    /// Check if this world is empty.
    pub fn is_empty(&self) -> bool {
        self.read_resource::<Clients>().is_empty()
    }

    /// Prepare to start.
    pub(crate) fn prepare(&mut self) {
        // Merge consecutive chunk stages that don't require spaces together.
        self.pipeline_mut().merge_stages();

        self.preload();
        self.load_entities();

        for (position, body) in (
            &self.ecs.read_storage::<PositionComp>(),
            &mut self.ecs.write_storage::<RigidBodyComp>(),
        )
            .join()
        {
            body.0
                .set_position(position.0 .0, position.0 .1, position.0 .2);
        }
    }

    /// Preload the chunks in the world.
    pub(crate) fn preload(&mut self) {
        let radius = self.config().preload_radius as i32;

        {
            for x in -radius..=radius {
                for z in -radius..=radius {
                    let coords = Vec2(x, z);
                    let neighbors = self.chunks().light_traversed_chunks(&coords);

                    neighbors.into_iter().for_each(|coords| {
                        let is_within = {
                            let chunks = self.chunks();
                            chunks.is_within_world(&coords)
                        };

                        let mut pipeline = self.pipeline_mut();
                        if is_within {
                            pipeline.add_chunk(&coords, false);
                        }
                    });
                }
            }
        }

        self.preloading = true;
    }

    /// Tick of the world, run every 16ms.
    pub(crate) fn tick(&mut self) {
        if !self.started {
            self.started = true;
        }

        if self.preloading {
            let light_padding = (self.config().max_light_level as f32
                / self.config().chunk_size as f32)
                .ceil() as usize;
            let check_radius = (self.config().preload_radius - light_padding) as i32;

            let mut total = 0;
            let supposed = (check_radius * 2).pow(2);

            for x in -check_radius..=check_radius {
                for z in -check_radius..=check_radius {
                    let chunks = self.chunks();
                    let coords = Vec2(x, z);

                    if chunks.is_chunk_ready(&coords) {
                        total += 1;
                    } else {
                        if let Some(chunk) = chunks.raw(&coords) {
                            if chunk.status == ChunkStatus::Meshing
                                && !self.mesher().map.contains(&coords)
                            {
                                // Add the chunk back to meshing queue.
                                drop(chunks);
                                self.mesher_mut().add_chunk(&coords, false);
                            }
                        }

                        // drop(chunks);

                        // let is_in_pipeline = self.pipeline().has_chunk(&coords);
                        // let is_in_mesher = self.mesher().map.contains(&coords);

                        // info!(
                        //     "Chunk {:?} is not ready. In pipeline: {}, in mesher: {}, status: {:?}",
                        //     coords, is_in_pipeline, is_in_mesher, status
                        // );
                    }
                }
            }

            self.preload_progress = (total as f32 / supposed as f32).min(1.0);

            if total >= supposed {
                self.preloading = false;
            }
        }

        if !self.preloading && self.is_empty() {
            return;
        }

        let mut dispatcher = (self.dispatcher)().build();
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

            self.client_parser.clone()(self, &metadata, client_ent);

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
        let requests = storage.get_mut(client_ent).unwrap();

        chunks.into_iter().for_each(|coords| {
            requests.add(&coords);
        });
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
                requests.remove(&coords);
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

            chunks.update_voxel(&Vec3(update.vx, update.vy, update.vz), update.voxel);
        });
    }

    /// Handler for `Method` type messages.
    fn on_method(&mut self, client_id: &str, data: Message) {
        if let Some(method) = data.method {
            if !self
                .method_handles
                .contains_key(&method.name.to_lowercase())
            {
                warn!("`Method` type messages received, but no method handler set.");
                return;
            }

            let handle = self.method_handles.get(&method.name).unwrap().to_owned();

            handle(self, client_id, &method.payload);
        }
    }

    /// Handler for `Event` type messages.
    fn on_event(&mut self, client_id: &str, data: Message) {
        let mut events = vec![];

        data.events.into_iter().for_each(|event| {
            if !self.event_handles.contains_key(&event.name.to_lowercase()) {
                events.push(event);
                return;
            }

            let handle = self.event_handles.get(&event.name).unwrap().to_owned();

            handle(self, client_id, &event.payload);
        });

        let mut message = Message::new(&MessageType::Event).build();
        message.events = events;

        self.write_resource::<MessageQueue>()
            .push((message, ClientFilter::All));
    }

    /// Handler for `Chat` type messages.
    fn on_chat(&mut self, id: &str, data: Message) {
        if let Some(chat) = data.chat.clone() {
            let sender = chat.sender;
            let body = chat.body;

            info!("{}: {}", sender, body);

            let command_symbol = self.config().command_symbol.to_owned();

            if body.starts_with(&command_symbol) {
                if let Some(handle) = self.command_handle.to_owned() {
                    handle(self, id, body.strip_prefix(&command_symbol).unwrap());
                } else {
                    warn!("Clients are sending commands, but no command handler set.");
                }
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

                    self.revive_entity(&id, &etype, metadata);
                }
            }
        }
    }

    fn generate_init_message(&self, id: &str) -> Message {
        let config = (*self.config()).to_owned();
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
}
