mod bookkeeping;
mod clients;
mod components;
mod config;
pub mod cpu_profiler;
mod entities;
mod entity_ids;
mod events;
mod generators;
mod interests;
mod messages;
mod metadata;
mod physics;
mod profiler;
mod registry;
mod stats;
pub mod system_profiler;
mod systems;
mod types;
mod utils;
mod voxels;

use actix::{
    Actor, AsyncContext, Context, Handler, Message as ActixMessage, MessageResult, SyncContext,
};
use actix::{Addr, SyncArbiter};
use hashbrown::HashMap;
use log::{error, info, warn};
use metadata::WorldMetadata;
use nanoid::nanoid;
use profiler::Profiler;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{
    shred::{Fetch, FetchMut, Resource},
    Builder, Component, DispatcherBuilder, Entity, EntityBuilder, Join, ReadStorage, SystemData,
    World as ECSWorld, WorldExt, WriteStorage,
};
use std::f64::consts::E;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};
use std::{env, sync::Arc};
use std::{
    fs::{self, File},
    time::Duration,
};
use system_profiler::{record_timing, SystemTimer, WorldTimingContext};

use crate::{
    encode_message,
    protocols::Peer,
    server::{Message, MessageType, WsSender},
    EntityOperation, EntityProtocol, PeerProtocol, Server, Vec2, Vec3,
};

use super::common::ClientFilter;

pub use bookkeeping::*;
pub use clients::*;
pub use components::*;
pub use config::*;
pub use cpu_profiler::*;
pub use entities::*;
pub use entity_ids::*;
pub use events::*;
pub use generators::*;
pub use interests::*;
pub use messages::*;
pub use physics::*;
pub use registry::*;
pub use stats::*;
pub use system_profiler::*;
pub use systems::*;
pub use types::*;
pub use utils::*;
pub use voxels::*;

pub type Transports = HashMap<String, WsSender>;

/// The default client metadata parser, parses PositionComp and DirectionComp, and updates RigidBodyComp.
pub fn default_client_parser(world: &mut World, metadata: &str, client_ent: Entity) {
    let metadata: PeerUpdate = match serde_json::from_str(metadata) {
        Ok(metadata) => metadata,
        Err(e) => {
            warn!("Could not parse peer update: {}", metadata);
            return;
        }
    };

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

/// Wrapper to make a non-Send/Sync type safely usable in contexts that require it.
/// This is safe because the World is only ever accessed from a single SyncWorld actor thread.
struct UnsafeSendSync<T>(T);

unsafe impl<T> Send for UnsafeSendSync<T> {}
unsafe impl<T> Sync for UnsafeSendSync<T> {}

impl<T> UnsafeSendSync<T> {
    fn new(value: T) -> Self {
        Self(value)
    }

    fn get_mut(&mut self) -> &mut T {
        &mut self.0
    }
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

    /// The modifier of the ECS dispatcher (builder factory).
    dispatcher: Arc<dyn Fn() -> DispatcherBuilder<'static, 'static> + Send + Sync>,

    /// Cached built dispatcher (built once, reused every tick).
    /// Uses UnsafeSendSync wrapper because Dispatcher isn't Send+Sync,
    /// but we only access it from the SyncWorld actor's single thread.
    built_dispatcher: Arc<Mutex<Option<UnsafeSendSync<specs::Dispatcher<'static, 'static>>>>>,

    /// The modifier of any new client.
    client_modifier: Option<Arc<dyn Fn(&mut World, Entity) + Send + Sync>>,

    /// The metadata parser for clients.
    client_parser: Arc<dyn Fn(&mut World, &str, Entity) + Send + Sync>,

    /// The handler for `Method`s.
    method_handles: HashMap<String, Arc<dyn Fn(&mut World, &str, &str) + Send + Sync>>,

    /// The handlers for `Event`s.
    event_handles: HashMap<String, Arc<dyn Fn(&mut World, &str, &str) + Send + Sync>>,

    /// The handler for `Transport`s.
    transport_handle: Option<Arc<dyn Fn(&mut World, Value) + Send + Sync>>,

    /// The handler for commands.
    command_handle: Option<Arc<dyn Fn(&mut World, &str, &str) + Send + Sync>>,

    /// A map to spawn and create entities.
    entity_loaders:
        HashMap<String, Arc<dyn Fn(&mut World, MetadataComp) -> EntityBuilder + Send + Sync>>,

    addr: Option<Addr<SyncWorld>>,

    server_addr: Option<Addr<Server>>,
}

// Define messages for the World actor
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct Tick;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct Prepare;

#[derive(ActixMessage)]
#[rtype(result = "WorldConfig")]
pub(crate) struct GetConfig;

pub struct WorldInfo {
    pub name: String,
    pub config: WorldConfig,
    pub preloading: bool,
    pub preload_progress: f32,
}

#[derive(ActixMessage)]
#[rtype(result = "WorldInfo")]
pub(crate) struct GetInfo;

#[derive(Serialize, Clone)]
pub struct WorldStatsResponse {
    pub name: String,
    pub client_count: usize,
    pub entity_count: usize,
    pub message_queue_critical: usize,
    pub message_queue_normal: usize,
    pub message_queue_bulk: usize,
    pub encoded_pending: usize,
    pub encoded_processed: usize,
}

#[derive(ActixMessage)]
#[rtype(result = "WorldStatsResponse")]
pub(crate) struct GetWorldStats;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct Preload;

pub struct PreloadProgressResponse {
    pub preloading: bool,
    pub progress: f32,
}

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct ClientRequest {
    pub client_id: String,
    pub data: Message,
}

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct ClientJoinRequest {
    pub id: String,
    pub username: String,
    pub sender: WsSender,
}

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct ClientLeaveRequest {
    pub id: String,
}

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct TransportJoinRequest {
    pub id: String,
    pub sender: WsSender,
}

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct TransportLeaveRequest {
    pub id: String,
}

// Create a new struct that will be the actual actor
pub struct SyncWorld(Arc<std::sync::RwLock<World>>);

impl Actor for SyncWorld {
    type Context = SyncContext<Self>;
}

// Implement handler for Tick message
impl Handler<Tick> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Tick, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().tick();
    }
}

impl Handler<Prepare> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Prepare, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().prepare();
    }
}

impl Handler<GetConfig> for SyncWorld {
    type Result = MessageResult<GetConfig>;

    fn handle(&mut self, _: GetConfig, _: &mut SyncContext<Self>) -> Self::Result {
        MessageResult(self.0.read().unwrap().config().make_copy())
    }
}

impl Handler<GetInfo> for SyncWorld {
    type Result = MessageResult<GetInfo>;

    fn handle(&mut self, _: GetInfo, _: &mut SyncContext<Self>) -> Self::Result {
        let world = self.0.read().unwrap();
        let config = world.config().make_copy();
        MessageResult(WorldInfo {
            name: world.name.clone(),
            config,
            preloading: world.preloading,
            preload_progress: world.preload_progress,
        })
    }
}

impl Handler<GetWorldStats> for SyncWorld {
    type Result = MessageResult<GetWorldStats>;

    fn handle(&mut self, _: GetWorldStats, _: &mut SyncContext<Self>) -> Self::Result {
        let world = self.0.read().unwrap();
        MessageResult(world.get_stats())
    }
}

impl Handler<Preload> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Preload, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().preload();
    }
}

// Implement handler for ClientRequest message
impl Handler<ClientRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().on_request(&msg.client_id, msg.data);
    }
}

impl Handler<ClientJoinRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientJoinRequest, _: &mut SyncContext<Self>) {
        self.0
            .write()
            .unwrap()
            .add_client(&msg.id, &msg.username, &msg.sender);
    }
}

impl Handler<ClientLeaveRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientLeaveRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().remove_client(&msg.id);
    }
}

impl Handler<TransportJoinRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: TransportJoinRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().add_transport(&msg.id, &msg.sender);
    }
}

impl Handler<TransportLeaveRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: TransportLeaveRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().remove_transport(&msg.id);
    }
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
            "chunk-generation",
            &["chunk-requests"],
        )
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-generation"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-generation"])
        .with(
            PhysicsSystem,
            "physics",
            &["current-chunk", "update-stats", "chunk-updating"],
        )
        .with(DataSavingSystem, "entities-saving", &["entities-meta"])
        .with(
            EntitiesSendingSystem::default(),
            "entities-sending",
            &["entities-meta"],
        )
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["chunk-sending", "entities-sending", "peers-sending"],
        )
        .with(
            CleanupSystem,
            "cleanup",
            &["entities-sending", "peers-sending"],
        )
        .with(EventsSystem, "events", &["broadcast"])
        .with(EntityObserveSystem, "entity-observe", &[])
        .with(PathFindingSystem, "path-finding", &["entity-observe"])
        .with(TargetMetadataSystem, "target-meta", &[])
        .with(PathMetadataSystem, "path-meta", &[])
        .with(EntityTreeSystem, "entity-tree", &[])
        .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
}

#[derive(Serialize, Deserialize)]
struct OnLoadRequest {
    center: Vec2<i32>,
    direction: Vec2<f32>,
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

#[derive(Serialize, Deserialize)]
struct BuiltInSetTimeMethodPayload {
    time: f32,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct BuiltInUpdateBlockEntityMethodPayload {
    id: String,
    json: String,
    is_partial: Option<bool>,
}

impl World {
    /// Create a new voxelize world.
    pub fn new(name: &str, config: &WorldConfig) -> Self {
        let id = nanoid!();

        if config.saving {
            let folder = PathBuf::from(&config.save_dir);

            // If folder doesn't exist, create it.
            if !folder.exists() {
                if let Err(e) = fs::create_dir_all(&folder) {
                    panic!("Could not create world folder: {}", e);
                }
            }
        }

        let world_metadata = WorldMetadata {
            world_name: name.to_owned(),
        };
        let timing_context = WorldTimingContext::new(name);

        let mut ecs = ECSWorld::new();

        ecs.register::<AddrComp>();
        ecs.register::<BrainComp>();
        ecs.register::<ChunkRequestsComp>();
        ecs.register::<ClientFlag>();
        ecs.register::<CollisionsComp>();
        ecs.register::<CurrentChunkComp>();
        ecs.register::<DirectionComp>();
        ecs.register::<EntityFlag>();
        ecs.register::<ETypeComp>();
        ecs.register::<IDComp>();
        ecs.register::<InteractorComp>();
        ecs.register::<JsonComp>();
        ecs.register::<MetadataComp>();
        ecs.register::<NameComp>();
        ecs.register::<PathComp>();
        ecs.register::<PositionComp>();
        ecs.register::<RigidBodyComp>();
        ecs.register::<TargetComp>();
        ecs.register::<VoxelComp>();
        ecs.register::<DoNotPersistComp>();

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());
        ecs.insert(world_metadata);
        ecs.insert(timing_context);

        ecs.insert(Chunks::new(config));
        ecs.insert(EntitiesSaver::new(&config));
        ecs.insert(Stats::new(
            config.saving,
            &config.save_dir,
            config.default_time,
        ));

        ecs.insert(Mesher::new());
        ecs.insert(Pipeline::new());
        ecs.insert(Clients::new());
        ecs.insert(MessageQueues::new());
        ecs.insert(Physics::new());
        ecs.insert(Events::new());
        ecs.insert(Transports::new());
        ecs.insert(ChunkInterests::new());
        ecs.insert(Bookkeeping::new());
        ecs.insert(KdTree::new());
        ecs.insert(EncodedMessageQueue::new());
        ecs.insert(Profiler::new(Duration::from_secs_f64(0.001)));
        ecs.insert(EntityIDs::new());

        let mut world = Self {
            id,
            name: name.to_owned(),
            started: false,
            preloading: false,
            preload_progress: 0.0,

            ecs,

            dispatcher: Arc::new(dispatcher),
            built_dispatcher: Arc::new(Mutex::new(None)),
            method_handles: HashMap::default(),
            event_handles: HashMap::default(),
            entity_loaders: HashMap::default(),
            client_parser: Arc::new(default_client_parser),
            client_modifier: None,
            transport_handle: None,
            command_handle: None,
            addr: None,
            server_addr: None,
        };

        world.set_method_handle("vox-builtin:get-stats", |world, client_id, _| {
            let stats_json = world.stats().get_stats();
            world.write_resource::<MessageQueues>().push((
                Message::new(&MessageType::Stats)
                    .json(&serde_json::to_string(&stats_json).unwrap())
                    .build(),
                ClientFilter::Direct(client_id.to_owned()),
            ));
        });

        world.set_method_handle("vox-builtin:set-time", |world, _, payload| {
            let payload: BuiltInSetTimeMethodPayload = serde_json::from_str(payload)
                .expect("Could not parse vox-builtin:set-time payload.");
            let time_per_day = world.config().time_per_day as f32;
            world.stats_mut().set_time(payload.time % time_per_day);
        });

        world.set_method_handle("vox-builtin:update-block-entity", |world, _, payload| {
            let payload: BuiltInUpdateBlockEntityMethodPayload = match serde_json::from_str(payload)
            {
                Ok(p) => p,
                Err(e) => {
                    log::error!(
                        "Could not parse vox-builtin:update-block-entity payload: {}",
                        e
                    );
                    return;
                }
            };

            // Validate payload JSON before proceeding
            if let Err(e) = serde_json::from_str::<serde_json::Value>(&payload.json) {
                log::error!("Payload JSON is invalid: {}", e);
                return;
            }

            let entities = world.ecs().entities();
            let ids = world.ecs().read_storage::<IDComp>();

            let mut to_update = vec![];

            for (entity, id_comp) in (&entities, &ids).join() {
                if id_comp.0 == payload.id {
                    to_update.push(entity);
                    break;
                }
            }

            drop((entities, ids));

            if to_update.is_empty() {
                log::warn!("No entity found with ID: {}", payload.id);
                return;
            }

            for entity in to_update {
                let mut storage = world.ecs_mut().write_storage::<JsonComp>();

                // Check if this is a partial update
                if !payload.is_partial.unwrap_or(false) {
                    // For full updates, just use the new JSON directly
                    if let Err(e) = storage.insert(entity, JsonComp::new(&payload.json)) {
                        log::error!("Failed to update block entity JSON: {}", e);
                    }
                    continue;
                }

                // Handle partial updates with careful JSON merging
                let current_json = match storage.get(entity) {
                    Some(comp) => &comp.0,
                    None => {
                        // If there's no current JSON, just use the new JSON
                        if let Err(e) = storage.insert(entity, JsonComp::new(&payload.json)) {
                            log::error!("Failed to update block entity JSON: {}", e);
                        }
                        continue;
                    }
                };

                // Try to parse current JSON
                let current_obj: serde_json::Value = match serde_json::from_str(current_json) {
                    Ok(obj) => obj,
                    Err(e) => {
                        // If current JSON is invalid, use payload JSON only
                        log::error!(
                            "Failed to parse current JSON: {} - using payload JSON only",
                            e
                        );
                        if let Err(e) = storage.insert(entity, JsonComp::new(&payload.json)) {
                            log::error!("Failed to update block entity JSON: {}", e);
                        }
                        continue;
                    }
                };

                // Parse payload JSON (we already validated it above)
                let payload_obj: serde_json::Value = serde_json::from_str(&payload.json).unwrap();

                // Merge the objects if both are objects
                if let (
                    serde_json::Value::Object(mut current_map),
                    serde_json::Value::Object(payload_map),
                ) = (current_obj, payload_obj)
                {
                    // Merge payload map into current map
                    for (key, value) in payload_map {
                        current_map.insert(key, value);
                    }

                    // Convert back to string
                    match serde_json::to_string(&serde_json::Value::Object(current_map)) {
                        Ok(merged) => {
                            if let Err(e) = storage.insert(entity, JsonComp::new(&merged)) {
                                log::error!("Failed to serialize merged JSON: {}", e);
                            }
                        }
                        Err(e) => {
                            log::error!("Failed to serialize merged JSON: {}", e);
                            if let Err(e) = storage.insert(entity, JsonComp::new(&payload.json)) {
                                log::error!("Failed to update block entity JSON: {}", e);
                            }
                        }
                    }
                } else {
                    // If either isn't an object, fall back to payload
                    if let Err(e) = storage.insert(entity, JsonComp::new(&payload.json)) {
                        log::error!("Failed to update block entity JSON: {}", e);
                    }
                }
            }
        });

        world
    }

    pub fn start(mut self) -> Addr<SyncWorld> {
        // self.prepare();
        // self.preload();

        let world = Arc::new(RwLock::new(self));
        let addr = SyncArbiter::start(1, move || SyncWorld(world.clone()));

        addr
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

    /// Add a transport sender to this world.
    pub(crate) fn add_transport(&mut self, id: &str, sender: &WsSender) {
        let init_message = self.generate_init_message(id);
        self.send(sender, &init_message);
        self.write_resource::<Transports>()
            .insert(id.to_owned(), sender.clone());
    }

    /// Remove a transport address from this world.
    pub(crate) fn remove_transport(&mut self, id: &str) {
        self.write_resource::<Transports>().remove(id);
    }

    /// Add a client to the world by an ID and a WebSocket sender.
    pub(crate) fn add_client(&mut self, id: &str, username: &str, sender: &WsSender) {
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
            .with(AddrComp::new(sender))
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
                sender: sender.clone(),
            },
        );

        self.entity_ids_mut().insert(id.to_owned(), ent.id());

        self.send(sender, &init_message);

        let join_message = Message::new(&MessageType::Join).text(id).build();
        self.broadcast(join_message, ClientFilter::All);

        info!("Client at {} joined the server to world: {}", id, self.name);
    }

    /// Remove a client from the world by endpoint.
    pub(crate) fn remove_client(&mut self, id: &str) {
        let removed = self.clients_mut().remove(id);
        self.entity_ids_mut().remove(id);
        self.chunk_interest_mut().remove_client(id);
        self.bookkeeping_mut().remove_client(id);

        if let Some(client) = removed {
            // Use a flag to track if we need to delete the entity
            let mut should_delete_entity = true;

            {
                // Remove rapier physics body.
                let interactors = self.ecs.read_storage::<InteractorComp>();

                // Safely get the interactor component, with error handling
                let interactor_result = interactors
                    .get(client.entity)
                    .map(|interactor| interactor.to_owned());

                if let Some(interactor) = interactor_result {
                    let body_handle = interactor.body_handle().to_owned();
                    let collider_handle = interactor.collider_handle().to_owned();

                    drop(interactors);

                    {
                        let mut physics = self.physics_mut();
                        physics.unregister(&body_handle, &collider_handle);
                    }

                    {
                        let mut interactors = self.ecs.write_storage::<InteractorComp>();
                        interactors.remove(client.entity);
                    }

                    {
                        let mut collisions = self.ecs.write_storage::<CollisionsComp>();
                        collisions.remove(client.entity);
                    }

                    {
                        let mut rigid_bodies = self.ecs.write_storage::<RigidBodyComp>();
                        rigid_bodies.remove(client.entity);
                    }

                    {
                        let mut clients = self.ecs.write_storage::<ClientFlag>();
                        clients.remove(client.entity);
                    }
                } else {
                    // If we can't find the interactor, the entity might already be deleted or invalid
                    should_delete_entity = false;
                    log::warn!(
                        "Client entity for {} not found or already removed",
                        client.id
                    );
                }
            }

            if should_delete_entity {
                let entities = self.ecs.entities();

                // Safe deletion with error handling
                if let Err(e) = entities.delete(client.entity) {
                    log::warn!("Error deleting client entity {}: {:?}", client.id, e);
                }
            }

            self.ecs.maintain();

            let leave_message = Message::new(&MessageType::Leave).text(&client.id).build();
            self.broadcast(leave_message, ClientFilter::All);
            info!("Client at {} left the world: {}", id, self.name);
        }
    }

    pub fn set_dispatcher<
        F: Fn() -> DispatcherBuilder<'static, 'static> + Send + Sync + 'static,
    >(
        &mut self,
        dispatch: F,
    ) {
        self.dispatcher = Arc::new(dispatch);
    }

    pub fn set_client_modifier<F: Fn(&mut World, Entity) + Send + Sync + 'static>(
        &mut self,
        modifier: F,
    ) {
        self.client_modifier = Some(Arc::new(modifier));
    }

    pub fn set_client_parser<F: Fn(&mut World, &str, Entity) + Send + Sync + 'static>(
        &mut self,
        parser: F,
    ) {
        self.client_parser = Arc::new(parser);
    }

    pub fn set_method_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        method: &str,
        handle: F,
    ) {
        self.method_handles
            .insert(method.to_lowercase(), Arc::new(handle));
    }

    pub fn set_event_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        event: &str,
        handle: F,
    ) {
        self.event_handles
            .insert(event.to_lowercase(), Arc::new(handle));
    }

    pub fn set_transport_handle<F: Fn(&mut World, Value) + Send + Sync + 'static>(
        &mut self,
        handle: F,
    ) {
        self.transport_handle = Some(Arc::new(handle));
    }

    pub fn set_command_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        handle: F,
    ) {
        self.command_handle = Some(Arc::new(handle));
    }

    pub fn set_entity_loader<
        F: Fn(&mut World, MetadataComp) -> EntityBuilder + Send + Sync + 'static,
    >(
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
        self.write_resource::<MessageQueues>().push((data, filter));
    }

    /// Send a direct message to an endpoint
    pub fn send(&self, sender: &WsSender, data: &Message) {
        let _ = sender.send(encode_message(data));
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

    /// Get world statistics for observability.
    pub fn get_stats(&self) -> WorldStatsResponse {
        let clients = self.read_resource::<Clients>();
        let entity_ids = self.read_resource::<EntityIDs>();
        let message_queues = self.read_resource::<MessageQueues>();
        let encoded_queue = self.read_resource::<EncodedMessageQueue>();

        let (critical, normal, bulk) = message_queues.queue_stats();
        let (pending, processed) = encoded_queue.queue_stats();

        WorldStatsResponse {
            name: self.name.clone(),
            client_count: clients.len(),
            entity_count: entity_ids.len(),
            message_queue_critical: critical,
            message_queue_normal: normal,
            message_queue_bulk: bulk,
            encoded_pending: pending,
            encoded_processed: processed,
        }
    }

    /// Access all entity IDs in the ECS world.
    pub fn entity_ids(&self) -> Fetch<EntityIDs> {
        self.read_resource::<EntityIDs>()
    }

    /// Access a mutable entity IDs map in the ECS world.
    pub fn entity_ids_mut(&mut self) -> FetchMut<EntityIDs> {
        self.write_resource::<EntityIDs>()
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

    /// Access the chunk interests manager in the ECS world.
    pub fn chunk_interest(&self) -> Fetch<ChunkInterests> {
        self.read_resource::<ChunkInterests>()
    }

    /// Access the mutable chunk interest manager in the ECS world.
    pub fn chunk_interest_mut(&mut self) -> FetchMut<ChunkInterests> {
        self.write_resource::<ChunkInterests>()
    }

    /// Access the bookkeeping in the ECS world.
    pub fn bookkeeping(&self) -> Fetch<Bookkeeping> {
        self.read_resource::<Bookkeeping>()
    }

    /// Access the mutable bookkeeping in the ECS world.
    pub fn bookkeeping_mut(&mut self) -> FetchMut<Bookkeeping> {
        self.write_resource::<Bookkeeping>()
    }

    /// Access the event queue in the ECS world.
    pub fn events(&self) -> Fetch<Events> {
        self.read_resource::<Events>()
    }

    /// Access the mutable events queue in the ECS world.
    pub fn events_mut(&mut self) -> FetchMut<Events> {
        self.write_resource::<Events>()
    }

    /// Access the stats manager in the ECS world.
    pub fn stats(&self) -> Fetch<Stats> {
        self.read_resource::<Stats>()
    }

    /// Access the mutable stats manager in the ECS world.
    pub fn stats_mut(&mut self) -> FetchMut<Stats> {
        self.write_resource::<Stats>()
    }

    /// Access pipeline management in the ECS world.
    pub fn pipeline(&self) -> Fetch<Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Access a mutable pipeline management in the ECS world.
    pub fn pipeline_mut(&mut self) -> FetchMut<Pipeline> {
        self.write_resource::<Pipeline>()
    }

    /// Access the mesher in the ECS world.
    pub fn mesher(&self) -> Fetch<Mesher> {
        self.read_resource::<Mesher>()
    }

    /// Access a mutable mesher in the ECS world.
    pub fn mesher_mut(&mut self) -> FetchMut<Mesher> {
        self.write_resource::<Mesher>()
    }

    /// Create a basic entity ready to be added more.
    pub fn create_base_entity(&mut self, id: &str, etype: &str) -> EntityBuilder {
        self.ecs_mut()
            .create_entity()
            .with(IDComp::new(id))
            .with(EntityFlag::default())
            .with(CurrentChunkComp::default())
    }

    /// Create a basic entity ready to be added more.
    pub fn create_entity(&mut self, id: &str, etype: &str) -> EntityBuilder {
        self.create_base_entity(id, etype)
            .with(ETypeComp::new(etype, false))
            .with(MetadataComp::new())
            .with(CollisionsComp::new())
    }

    /// Create a basic entity ready to be added more.
    pub fn create_block_entity(&mut self, id: &str, etype: &str) -> EntityBuilder {
        self.create_base_entity(id, etype)
            .with(ETypeComp::new(etype, true))
    }

    /// Spawn an entity of type at a location.
    pub fn spawn_entity_at(&mut self, etype: &str, position: &Vec3<f32>) -> Option<Entity> {
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

    /// Spawn an entity of type with metadata at a location.
    pub fn spawn_entity_with_metadata(
        &mut self,
        etype: &str,
        position: &Vec3<f32>,
        metadata: MetadataComp,
    ) -> Option<Entity> {
        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to spawn unknown entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        let ent = loader(self, metadata.clone()).build();
        self.populate_entity(ent, &nanoid!(), etype, metadata);

        set_position(self.ecs_mut(), ent, position.0, position.1, position.2);

        Some(ent)
    }

    pub fn revive_entity(
        &mut self,
        id: &str,
        etype: &str,
        metadata: MetadataComp,
    ) -> Option<Entity> {
        if etype.starts_with("block::") {
            let voxel_meta = metadata.get::<VoxelComp>("voxel").unwrap_or_default();
            let voxel = voxel_meta.0.clone();
            if self.chunks_mut().block_entities.contains_key(&voxel) {
                warn!("Block entity already exists at voxel: {:?}", voxel);
                self.read_resource::<EntitiesSaver>().remove(id);
                return None;
            }
            let entity = self
                .create_block_entity(id, etype)
                .with(
                    metadata
                        .get::<JsonComp>("json")
                        .unwrap_or(JsonComp::new("{}")),
                )
                .with(voxel_meta)
                .with(metadata)
                .build();
            self.chunks_mut().block_entities.insert(voxel, entity);
            return Some(entity);
        }

        if !self.entity_loaders.contains_key(&etype.to_lowercase()) {
            warn!("Tried to revive unknown entity type: {}", etype);
            return None;
        }

        let loader = self
            .entity_loaders
            .get(&etype.to_lowercase())
            .unwrap()
            .to_owned();

        // Wrap entity creation in panic handler to catch any errors
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            loader(self, metadata.to_owned()).build()
        })) {
            Ok(ent) => {
                self.populate_entity(ent, id, etype, metadata);
                Some(ent)
            }
            Err(e) => {
                error!(
                    "Panic while creating entity {} of type {}: {:?}",
                    id, etype, e
                );
                None
            }
        }
    }

    pub fn populate_entity(&mut self, ent: Entity, id: &str, etype: &str, metadata: MetadataComp) {
        self.ecs_mut()
            .write_storage::<IDComp>()
            .insert(ent, IDComp::new(id))
            .expect("Failed to insert ID component");

        let (entity_type, is_block) = if etype.starts_with("block::") {
            (etype, true)
        } else {
            (etype, false)
        };

        self.ecs_mut()
            .write_storage::<ETypeComp>()
            .insert(ent, ETypeComp::new(entity_type, is_block))
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

        let ent_id = ent.id();

        self.entity_ids_mut().insert(id.to_owned(), ent_id);
    }

    /// Check if this world is empty.
    pub fn is_empty(&self) -> bool {
        self.read_resource::<Clients>().is_empty()
    }

    /// Prepare to start.
    pub(crate) fn prepare(&mut self) {
        // Merge consecutive chunk stages that don't require spaces together.
        self.pipeline_mut().merge_stages();
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

        // Reset the stats timing to avoid an unusually large delta on the very first tick caused
        // by world setup and preloading delays. This ensures physics (e.g., rapier) receives a
        // sensible time step and prevents entities such as boids from being launched away at
        // server startup.
        {
            use std::time::SystemTime;
            let mut stats = self.stats_mut();
            stats.prev_time = SystemTime::now();
            stats.delta = 0.0;
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
                    }
                }
            }

            self.preload_progress = (total as f32 / supposed as f32).min(1.0);

            if total >= supposed {
                self.preloading = false;
            }
        }

        self.stats_mut().preloading = self.preloading;

        let tick_timer = SystemTimer::new("tick-total");

        let dispatch_time = {
            let mut dispatcher_guard = self.built_dispatcher.lock().unwrap();
            if dispatcher_guard.is_none() {
                let build_timer = SystemTimer::new("dispatcher-build");
                let dispatcher = (self.dispatcher)().build();
                *dispatcher_guard = Some(UnsafeSendSync::new(dispatcher));
                record_timing(&self.name, "dispatcher-build", build_timer.elapsed_ms());
            }

            let dispatch_timer = SystemTimer::new("dispatcher-dispatch");
            dispatcher_guard.as_mut().unwrap().get_mut().dispatch(&self.ecs);
            dispatch_timer.elapsed_ms()
        };

        self.write_resource::<Profiler>().summarize();

        let maintain_time = {
            let maintain_timer = SystemTimer::new("ecs-maintain");
            self.ecs.maintain();
            maintain_timer.elapsed_ms()
        };

        let total_time = tick_timer.elapsed_ms();

        record_timing(&self.name, "tick-total", total_time);
        record_timing(&self.name, "dispatcher-dispatch", dispatch_time);
        record_timing(&self.name, "ecs-maintain", maintain_time);
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

        let json: OnLoadRequest = match serde_json::from_str(&data.json) {
            Ok(json) => json,
            Err(e) => {
                warn!("`on_load` error. Could not read JSON string: {}", data.json);
                return;
            }
        };

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        {
            let mut storage = self.write_component::<ChunkRequestsComp>();

            // Check for component existence
            if let Some(requests) = storage.get_mut(client_ent) {
                chunks.iter().for_each(|coords| {
                    requests.add(coords);
                });

                requests.set_center(&json.center);
                requests.set_direction(&json.direction);
                requests.sort();
            } else {
                warn!(
                    "Client entity doesn't have ChunkRequestsComp component: {}",
                    client_id
                );
                //TODO: We could re-add the component here, server doesn't panic now though
            }
        }
    }

    /// Handler for `Unload` type messages.
    fn on_unload(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        let json: OnUnloadRequest = match serde_json::from_str(&data.json) {
            Ok(json) => json,
            Err(e) => {
                warn!(
                    "`on_unload` error. Could not read JSON string: {}",
                    data.json
                );
                return;
            }
        };

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        {
            let mut storage = self.write_component::<ChunkRequestsComp>();

            if let Some(requests) = storage.get_mut(client_ent) {
                chunks.iter().for_each(|coords| {
                    requests.remove(coords);
                });
            }
        }

        {
            let mut interests = self.chunk_interest_mut();

            let mut to_remove = Vec::new();

            chunks.iter().for_each(|coords| {
                interests.remove(client_id, coords);

                if !interests.has_interests(coords) {
                    to_remove.push(coords);
                }
            });

            drop(interests);

            to_remove.into_iter().for_each(|coords| {
                self.pipeline_mut().remove_chunk(coords);
                self.mesher_mut().remove_chunk(coords);
            })
        }
    }

    /// Handler for `Update` type messages.
    fn on_update(&mut self, _: &str, data: Message) {
        let chunk_size = self.config().chunk_size;
        let mut chunks = self.chunks_mut();

        if let Some(bulk) = data.bulk_update {
            for i in 0..bulk.vx.len() {
                let vx = bulk.vx[i];
                let vy = bulk.vy[i];
                let vz = bulk.vz[i];
                let voxel = bulk.voxels[i];

                let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);

                if !chunks.is_within_world(&coords) {
                    continue;
                }

                chunks.update_voxel(&Vec3(vx, vy, vz), voxel);
            }
        } else {
            data.updates.into_iter().for_each(|update| {
                let coords =
                    ChunkUtils::map_voxel_to_chunk(update.vx, update.vy, update.vz, chunk_size);

                if !chunks.is_within_world(&coords) {
                    return;
                }

                chunks.update_voxel(&Vec3(update.vx, update.vy, update.vz), update.voxel);
            });
        }
    }

    /// Handler for `Method` type messages.
    fn on_method(&mut self, client_id: &str, data: Message) {
        if let Some(method) = data.method {
            if !self
                .method_handles
                .contains_key(&method.name.to_lowercase())
            {
                warn!(
                    "`Method` type messages received of name {}, but no method handler set.",
                    method.name
                );
                return;
            }

            let handle = self.method_handles.get(&method.name).unwrap().to_owned();

            handle(self, client_id, &method.payload);
        }
    }

    /// Handler for `Event` type messages.
    fn on_event(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        data.events.into_iter().for_each(|event| {
            if !self.event_handles.contains_key(&event.name.to_lowercase()) {
                let curr_chunk = self
                    .read_component::<CurrentChunkComp>()
                    .get(client_ent)
                    .unwrap()
                    .coords
                    .clone();

                self.events_mut().dispatch(
                    Event::new(&event.name)
                        .payload(event.payload)
                        .location(curr_chunk)
                        .build(),
                );
                return;
            }

            let handle = self.event_handles.get(&event.name).unwrap().to_owned();
            handle(self, client_id, &event.payload);
        });
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

            let folder = self.read_resource::<EntitiesSaver>().folder.clone();
            fs::create_dir_all(&folder).ok();
            let paths = fs::read_dir(folder).unwrap();
            let mut loaded_entities = HashMap::new();

            for path in paths {
                let path = path.unwrap().path();

                if let Ok(entity_data) = File::open(&path) {
                    let id = path.file_stem().unwrap().to_str().unwrap().to_owned();
                    let mut data: HashMap<String, Value> =
                        match serde_json::from_reader(entity_data) {
                            Ok(data) => data,
                            Err(e) => {
                                info!(
                                    "Could not load entity file: {:?}. Error: {}, removing...",
                                    path, e
                                );
                                // remove the file
                                fs::remove_file(path).unwrap();
                                continue;
                            }
                        };
                    let etype: String = serde_json::from_value(data.remove("etype").unwrap())
                        .unwrap_or_else(|_| {
                            panic!("EType filed does not exist on file: {:?}", path)
                        });
                    let metadata: MetadataComp =
                        serde_json::from_value(data.remove("metadata").unwrap()).unwrap_or_else(
                            |_| panic!("Metadata field does not exist on file: {:?}", path),
                        );

                    if let Some(ent) = self.revive_entity(&id, &etype, metadata.to_owned()) {
                        loaded_entities.insert(id.to_owned(), (etype, ent, metadata, true));
                    } else {
                        // Use error! instead of info! for better visibility
                        error!(
                            "Failed to revive entity {:?} of type {}. Metadata: {:?}. File will be removed.",
                            id, etype, metadata
                        );
                        // remove the file
                        if let Err(e) = fs::remove_file(path) {
                            warn!("Failed to remove file {:?}", e);
                        }
                    }
                }
            }

            if !loaded_entities.is_empty() {
                let name = self.name.to_owned();
                let mut bookkeeping = self.write_resource::<Bookkeeping>();
                info!(
                    "World {:?} loaded {} entities from disk.",
                    name,
                    loaded_entities.len()
                );
                bookkeeping.entities = loaded_entities;
            }
        }
    }

    fn generate_init_message(&self, id: &str) -> Message {
        let config = (*self.config()).to_owned();
        let mut json = HashMap::new();

        json.insert("id".to_owned(), json!(id));
        json.insert("blocks".to_owned(), json!(self.registry().blocks_by_name));
        json.insert("options".to_owned(), json!(config));
        json.insert(
            "stats".to_owned(),
            json!(self.read_resource::<Stats>().get_stats()),
        );

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
            if (!etype.0.starts_with("block::") && metadata.is_empty()) {
                continue;
            }

            let j_str = metadata.to_string();

            entities.push(EntityProtocol {
                // Intentionally not using the `EntityOperation::Create` variant here
                // because the entity is already technically created.
                operation: EntityOperation::Update,
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(j_str),
            });
        }

        drop(ids);
        drop(etypes);
        drop(metadatas);

        Message::new(&MessageType::Init)
            .world_name(&self.name)
            .json(&serde_json::to_string(&json).unwrap())
            .peers(&peers)
            .entities(&entities)
            .build()
    }
}
