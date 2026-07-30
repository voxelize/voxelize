mod bookkeeping;
mod clients;
mod components;
mod config;
pub mod cpu_profiler;
mod entities;
mod entity_ids;
mod events;
mod fixed_step;
mod generators;
mod interests;
pub mod items;
mod lag_comp;
mod messages;
mod metadata;
mod physics;
mod profiler;
mod registry;
mod replication;
pub(crate) mod shared_pools;
mod stats;
pub mod system_profiler;
mod systems;
mod types;
mod utils;
mod voxels;

use actix::{
    Actor, ActorContext, AsyncContext, Handler, Message as ActixMessage, MessageResult, SyncContext,
};
use actix::{Addr, SyncArbiter};
use hashbrown::HashMap;
use log::{debug, error, info, warn};
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
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::{Mutex, RwLock};
use std::{
    fs::{self, File},
    time::{Duration, Instant},
};
use system_profiler::{record_timing, SystemTimer, TimedDispatcherBuilder, WorldTimingContext};

use crate::{
    encode_message,
    perf::{self, WorldPerfMetrics},
    protocols::Peer,
    server::{Message, MessageType, WsSender},
    EntityOperation, EntityProtocol, MethodProtocol, PeerProtocol, Server, Vec2, Vec3,
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
pub use fixed_step::*;
pub use generators::*;
pub use interests::*;
pub use items::*;
pub use lag_comp::*;
pub use messages::*;
pub use physics::*;
pub use registry::*;
pub use replication::*;
pub use stats::*;
pub use system_profiler::*;
pub use systems::*;
pub use types::*;
pub use utils::*;
pub use voxels::*;

pub type Transports = HashMap<String, WsSender>;

mod accessors;
mod client_body;
mod dispatcher;
mod handles;
mod inbound;
#[cfg(test)]
mod lag_comp_wiring_tests;
mod lifecycle;
mod sessions;
mod spawning;
mod sync;

pub use client_body::*;
use dispatcher::dispatcher;
pub use sync::*;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerUpdate {
    position: Option<Vec3<f32>>,
    direction: Option<Vec3<f32>>,
    is_crouching: Option<bool>,
    is_flying: Option<bool>,
    is_ghost: Option<bool>,
    is_swimming: Option<bool>,
    is_swim_pose_active: Option<bool>,
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

    /// The modifier for each new client.
    client_modifier: Option<Arc<dyn Fn(&mut World, Entity) + Send + Sync>>,

    /// Called before a client entity is removed from the world.
    client_leave_modifier: Option<Arc<dyn Fn(&mut World, Entity) + Send + Sync>>,

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

    extra_init_data: HashMap<String, serde_json::Value>,

    items: Option<ItemRegistry>,

    addr: Option<Addr<SyncWorld>>,

    server_addr: Option<Addr<Server>>,

    /// Inbound half of the state replication channel: peer position packets
    /// staged by the network layer and applied at the start of every tick,
    /// before the system dispatch, so systems read current-tick positions.
    /// Shared with the [`Server`] actor, which pushes into it directly.
    inbound_state: Arc<InboundStateBuffer>,

    /// Wall-clock instant of the previous delivered tick, used *only* by the
    /// fixed-step accumulator to measure real elapsed time between deliveries.
    /// This is the tick-delivery boundary (how many fixed steps to run), never
    /// a sim-state input: the sim's time is `step_count * DT`. `None` until the
    /// first tick, and unused entirely when `fixed_timestep` is `None`.
    last_fixed_tick_at: Option<Instant>,
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
    pub preferences: ClientPreferencesPatch,
    pub motion_protocol: MotionProtocol,
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

/// Runtime teardown of a world (see `Server` lifecycle, §3.2). Sent to the
/// world actor so it frees ECS / sessions and stops on its own single thread,
/// FIFO *after* any in-flight `Tick` — never mid-borrow. This is why teardown
/// is a message to the world and never an external `RwLock` write grab.
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct Teardown;

/// Reset a warm pooled world for reuse under a new name (see `Server`
/// `ResetPolicy::ReuseWarm`). Runs on the world thread FIFO after any in-flight
/// `Tick`, clearing ECS / inbound state so no state leaks across reuse.
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub(crate) struct ResetWorld {
    pub name: String,
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
    voxel: Option<[i32; 3]>,
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
        ecs.register::<ClientPreferencesComp>();
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
        ecs.register::<RewindEligibleComp>();
        ecs.register::<RigidBodyComp>();
        ecs.register::<TargetComp>();
        ecs.register::<VoxelComp>();
        ecs.register::<DoNotPersistComp>();

        ecs.insert(name.to_owned());
        ecs.insert(config.clone());
        ecs.insert(world_metadata);
        ecs.insert(timing_context);

        ecs.insert(Chunks::new(config));
        ecs.insert(BackgroundEntitiesSaver::new(&config));
        let chunk_folder = {
            let chunks = ecs.read_resource::<Chunks>();
            chunks.folder().cloned()
        };
        ecs.insert(BackgroundChunkSaver::new(chunk_folder));
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
        ecs.insert(ReplicatedStateBuffer::new());
        ecs.insert(Profiler::new(Duration::from_secs_f64(0.001)));
        ecs.insert(EntityIDs::new());
        ecs.insert(WorldPerfMetrics::new());

        // Deterministic worlds carry their fixed-step clock + seeded PRNG as a
        // resource so every sim system reads sim time and randomness from one
        // place. Non-deterministic worlds never insert it and pay nothing.
        if let Some(fixed_timestep) = config.fixed_timestep {
            ecs.insert(FixedStepState::new(fixed_timestep));
        }

        // Opt-in lag-compensation carries its position-history ring and the
        // server-measured RTT trackers as a resource. It requires the fixed
        // step (validated at config build), so `fixed_timestep` is always set
        // here when `lag_comp` is. Worlds without it never insert the resource
        // and pay nothing.
        if let (Some(lag_comp), Some(fixed_timestep)) = (config.lag_comp, config.fixed_timestep) {
            ecs.insert(LagComp::new(
                lag_comp,
                fixed_timestep.hz,
                DEFAULT_RTT_EWMA_ALPHA,
            ));
        }

        let mut world = Self {
            id,
            name: name.to_owned(),
            started: false,
            preloading: false,
            preload_progress: 0.0,

            ecs,

            dispatcher: Arc::new(|| dispatcher().into_inner()),
            built_dispatcher: Arc::new(Mutex::new(None)),
            method_handles: HashMap::default(),
            event_handles: HashMap::default(),
            entity_loaders: HashMap::default(),
            client_parser: Arc::new(default_client_parser),
            client_modifier: None,
            client_leave_modifier: None,
            transport_handle: None,
            command_handle: None,
            extra_init_data: HashMap::default(),
            items: None,
            addr: None,
            server_addr: None,
            inbound_state: Arc::new(InboundStateBuffer::new()),
            last_fixed_tick_at: None,
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

        world.set_method_handle("vox-builtin:ping", |world, client_id, payload| {
            world.write_resource::<MessageQueues>().push((
                Message::new(&MessageType::Method)
                    .method(MethodProtocol {
                        name: "vox-builtin:pong".to_string(),
                        payload: payload.to_string(),
                    })
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
                if let Some(voxel) = payload.voxel {
                    let voxel_key = Vec3(voxel[0], voxel[1], voxel[2]);
                    if let Some(&entity) = world.chunks().block_entities.get(&voxel_key) {
                        to_update.push(entity);
                    }
                }
            }

            if to_update.is_empty() {
                log::warn!(
                    "No entity found with ID: {} or voxel: {:?}",
                    payload.id,
                    payload.voxel
                );
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

    pub fn start(self) -> Addr<SyncWorld> {
        // self.prepare();
        // self.preload();

        let world = Arc::new(RwLock::new(self));
        let addr = SyncArbiter::start(1, move || SyncWorld(world.clone()));

        addr
    }
}
