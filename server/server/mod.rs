mod lifecycle;
mod models;

use std::time::{Duration, Instant};

use actix::{
    fut::wrap_future, Actor, ActorFutureExt, Addr, AsyncContext, Context, Handler,
    Message as ActixMessage, MessageResult, ResponseActFuture,
};
use fern::colors::{Color, ColoredLevelConfig};
use futures_util::future::join_all;
use hashbrown::{HashMap, HashSet};
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::mpsc;

use crate::{
    errors::AddWorldError,
    perf,
    world::{
        ClientPreferencesPatch, InboundStateBuffer, MotionProtocol, Registry, World, WorldConfig,
    },
    ChunkStatus, ClientJoinRequest, ClientLeaveRequest, ClientRequest, GetConfig, GetInfo,
    GetWorldStats, Mesher, MessageQueues, Preload, Prepare, RtcSenders, Stats, SyncWorld, Tick,
    TransportJoinRequest, TransportLeaveRequest, WorldStatsResponse,
};

pub use lifecycle::*;
pub use models::*;

use lifecycle::{PoolConfig, PooledSlot, WorldEntry, WorldLifecycleMetrics};

/// A per-connection sender with two priority lanes.
///
/// - The CONTROL lane carries session control-plane and small ordered traffic
///   (INIT, JOIN/LEAVE, errors, chat, methods, events, entity lifecycle, and
///   coalesced state snapshots). It is drained *first* by the connection's
///   write loop, so lifecycle and live state can never be starved behind
///   megabytes of queued chunk data.
/// - The BULK lane carries world-data-plane traffic (chunk loads/unloads and
///   voxel updates, which must stay ordered relative to each other).
///
/// Depths count messages pushed but not yet *written to the socket* (one
/// relaxed atomic per message). The state replication layer gates its
/// per-client flush on the control-lane depth: a truly dead socket stalls
/// writes, the control depth climbs, and state coalesces in its slots instead
/// of piling up as stale frames. See `world::replication`.
#[derive(Clone)]
pub struct WsSender {
    control: mpsc::UnboundedSender<Vec<u8>>,
    bulk: mpsc::UnboundedSender<Vec<u8>>,
    control_depth: Arc<AtomicUsize>,
    bulk_depth: Arc<AtomicUsize>,
}

impl WsSender {
    pub fn new(
        control: mpsc::UnboundedSender<Vec<u8>>,
        bulk: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Self {
        Self {
            control,
            bulk,
            control_depth: Arc::new(AtomicUsize::new(0)),
            bulk_depth: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Send on the control lane (default). Reliable-ordered within the lane.
    pub fn send(&self, data: Vec<u8>) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.control_depth.fetch_add(1, Ordering::Relaxed);
        if let Err(error) = self.control.send(data) {
            self.control_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(error);
        }
        Ok(())
    }

    /// Send on the bulk lane (chunk data, voxel updates). Reliable-ordered
    /// within the lane, but drained only when the control lane is empty.
    pub fn send_bulk(&self, data: Vec<u8>) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.bulk_depth.fetch_add(1, Ordering::Relaxed);
        if let Err(error) = self.bulk.send(data) {
            self.bulk_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(error);
        }
        Ok(())
    }

    pub fn mark_control_written(&self) {
        self.control_depth.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn mark_bulk_written(&self) {
        self.bulk_depth.fetch_sub(1, Ordering::Relaxed);
    }

    /// Control-lane backlog only: the signal the state-flush gate uses. Bulk
    /// chunk streaming must not block live state — that starvation is exactly
    /// what made peer visibility asymmetric for clients loading chunks.
    pub fn control_len(&self) -> usize {
        self.control_depth.load(Ordering::Relaxed)
    }

    /// Total unwritten messages across both lanes (observability).
    pub fn len(&self) -> usize {
        self.control_depth.load(Ordering::Relaxed) + self.bulk_depth.load(Ordering::Relaxed)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnJoinRequest {
    world: String,
    username: String,
    #[serde(default, flatten)]
    flat_preferences: ClientPreferencesPatch,
    #[serde(default)]
    preferences: Option<ClientPreferencesPatch>,
    /// Optional protocol capabilities this client supports (e.g.
    /// "motion.v1" for the compact entity motion path). Absent for pinned
    /// legacy clients, which keeps them on the JSON wire shape.
    #[serde(default)]
    capabilities: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct OnActionRequest {
    action: String,
    data: Value,
}

type ServerInfoHandle = fn(&Server) -> Value;

fn default_info_handle(server: &Server) -> Value {
    let mut info = HashMap::new();

    info.insert(
        "lost_sessions".to_owned(),
        json!(server.lost_sessions.len()),
    );

    let mut connections = HashMap::new();

    for (id, (_, world, _)) in server.connections.iter() {
        connections.insert(id.to_owned(), json!(world));
    }

    info.insert("connections".to_owned(), json!(connections));

    let mut transports = vec![];

    for (id, _) in server.transport_sessions.iter() {
        transports.push(id.to_owned());
    }

    info.insert("transports".to_owned(), json!(transports));

    // for (name, world) in server.worlds.iter() {
    //     let mut world_info = HashMap::new();

    //     {
    //         let clients = world.clients();
    //         world_info.insert(
    //             "clients".to_owned(),
    //             json!(clients
    //                 .values()
    //                 .map(|client| json!({
    //                     "id": client.id.to_owned(),
    //                     "username": client.username.to_owned(),
    //                 }))
    //                 .collect::<Vec<_>>()),
    //         );
    //     }

    //     {
    //         let config = world.config();
    //         world_info.insert("config".to_owned(), json!(*config));
    //     }

    //     {
    //         let stats = world.read_resource::<Stats>();
    //         let mut stats_info = HashMap::new();

    //         stats_info.insert("tick".to_owned(), json!(stats.tick));
    //         stats_info.insert("delta".to_owned(), json!(stats.delta));

    //         world_info.insert("stats".to_owned(), json!(stats_info));
    //     }

    //     {
    //         let chunks = world.chunks();
    //         let pipeline = world.pipeline();
    //         let mesher = world.read_resource::<Mesher>();

    //         let mut generating: i32 = 0;
    //         let mut meshing: i32 = 0;
    //         let mut ready: i32 = 0;

    //         for chunk in chunks.map.values() {
    //             match chunk.status {
    //                 ChunkStatus::Generating(_) => generating += 1,
    //                 ChunkStatus::Meshing => meshing += 1,
    //                 ChunkStatus::Ready => ready += 1,
    //             }
    //         }

    //         world_info.insert(
    //             "chunks".to_owned(),
    //             json!({
    //                 "count": chunks.map.len(),
    //                 "generating": generating,
    //                 "meshing": meshing,
    //                 "ready": ready,
    //                 "pipeline_chunks": pipeline.chunks,
    //                 "pipeline_queue": pipeline.queue,
    //                 "mesher_chunks": mesher.map,
    //                 "mesher_queue": mesher.queue,
    //                 "active_voxels": chunks.active_voxels.len()
    //             }),
    //         );
    //     }

    //     {
    //         let pipeline = world.pipeline();

    //         let pipeline_info = json!({
    //             "count": json!(pipeline.chunks.len()),
    //             "stages": json!(
    //                 pipeline
    //                     .stages
    //                     .iter()
    //                     .map(|stage| json!(stage.name()))
    //                     .collect::<Vec<_>>()
    //             )
    //         });

    //         world_info.insert("pipeline".to_owned(), pipeline_info);
    //     }

    //     worlds.insert(name.to_owned(), json!(world_info));
    // }

    // info.insert("worlds".to_owned(), json!(worlds));

    serde_json::to_value(info).unwrap()
}

/// A websocket server for Voxelize, holds all worlds data, and runs as a background
/// system service.
pub struct Server {
    /// The port that this voxelize server is running on.
    pub port: u16,

    /// The address that this voxelize server is running on.
    pub addr: String,

    /// Whether or not if the socket server has started as a system service.
    pub started: bool,

    /// Static folder to serve from.
    pub serve: String,

    /// Whether the server should show debug information.
    pub debug: bool,

    /// Interval to tick the server at.
    pub interval: u64,

    /// A secret to join the server.
    pub secret: Option<String>,

    /// A map of all the worlds.
    pub worlds: HashMap<String, Addr<SyncWorld>>,

    /// Per-world inbound state buffers. Peer position packets are pushed here
    /// directly instead of through the world's actor mailbox, so the world can
    /// apply them at the start of its next tick — before the system dispatch —
    /// regardless of how Tick and request messages interleave in mailboxes.
    world_inbound_state: HashMap<String, Arc<InboundStateBuffer>>,

    /// Registry of the server.
    pub registry: Registry,

    /// Session IDs and senders who haven't connected to a world.
    /// Value: (sender, connection_token)
    pub lost_sessions: HashMap<String, (WsSender, String)>,

    /// Transport sessions, not connected to any particular world.
    pub transport_sessions: HashMap<String, WsSender>,

    /// What world each client ID is connected to, client ID <-> world ID.
    /// Value: (sender, world_name, connection_token)
    pub connections: HashMap<String, (WsSender, String, String)>,

    /// Worlds with a tick already queued or running.
    pending_world_ticks: HashSet<String>,

    /// When the most recent world tick completed successfully.
    /// Used by `/health` to detect a wedged-but-bound server.
    last_tick_at: Option<Instant>,

    /// When the server actor started its tick interval.
    actor_started_at: Option<Instant>,

    /// When true, the tick interval skips dispatching world ticks (test/debug).
    debug_pause_ticks: bool,

    /// Optional delay after actor start before ticks are paused (test/debug).
    debug_pause_ticks_after: Option<Duration>,

    /// The information sent to the client when requested.
    info_handle: ServerInfoHandle,

    /// The handler for `Action`s.
    action_handles: HashMap<String, Arc<dyn Fn(Value, &mut Server)>>,

    /// WebRTC senders for hybrid networking.
    rtc_senders: Option<RtcSenders>,

    /// Hard ceiling on total live worlds (static + dynamic). `None` = unbounded
    /// (today's behavior). Enforced by `CreateWorld`.
    max_worlds: Option<usize>,

    /// Warm world pool configuration. `None` = no pool (today's behavior).
    world_pool: Option<PoolConfig>,

    /// Warm, dormant worlds retained for reuse when pooling is enabled.
    world_pool_slots: Vec<PooledSlot>,

    /// Server-side lifecycle bookkeeping per live world (created_at, gc_policy,
    /// per-world cap, peak, armed GC timer, config fingerprint).
    world_entries: HashMap<String, WorldEntry>,

    /// Lifecycle observability counters.
    lifecycle_metrics: WorldLifecycleMetrics,
}

/// Default max age of the last completed world tick before `/health` is unhealthy.
pub const DEFAULT_TICK_STALL_THRESHOLD_MS: u64 = 5_000;

/// Delay between preload progress polls. Each poll also ticks the preloading
/// worlds (and the server actor's own tick interval keeps ticking them during
/// boot preload), so polling hotter than the tick cadence makes preload no
/// faster — it only burns CPU and starves the arbiter that concurrently
/// serves `/health` while chunks generate.
const PRELOAD_POLL_INTERVAL: Duration = Duration::from_millis(10);

fn tick_stall_threshold_ms() -> u64 {
    std::env::var("VOXELIZE_TICK_STALL_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_TICK_STALL_THRESHOLD_MS)
}

fn debug_pause_ticks_from_env() -> bool {
    matches!(
        std::env::var("VOXELIZE_DEBUG_PAUSE_TICKS").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    )
}

fn debug_pause_ticks_after_from_env() -> Option<Duration> {
    std::env::var("VOXELIZE_DEBUG_PAUSE_TICKS_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
}

/// Build a `/health` JSON payload from live server + world preload state.
pub fn build_health_value(
    started: bool,
    last_tick_age_ms: Option<u64>,
    worlds: &[(String, bool, f32)],
    stall_threshold_ms: u64,
) -> Value {
    let preloading = worlds.iter().any(|(_, preloading, _)| *preloading);
    let preload_progress = if worlds.is_empty() {
        0.0
    } else {
        worlds
            .iter()
            .map(|(_, _, progress)| *progress)
            .sum::<f32>()
            / worlds.len() as f32
    };
    let tick_ok = match last_tick_age_ms {
        Some(age) => age <= stall_threshold_ms,
        None => false,
    };
    let ready = started && !preloading && tick_ok;
    let ok = ready;
    json!({
        "ok": ok,
        "ready": ready,
        "started": started,
        "preloading": preloading,
        "preloadProgress": preload_progress,
        "lastTickAgeMs": last_tick_age_ms,
        "tickStallThresholdMs": stall_threshold_ms,
        "worlds": worlds.iter().map(|(name, preloading, progress)| json!({
            "name": name,
            "preloading": preloading,
            "preloadProgress": progress,
        })).collect::<Vec<_>>(),
    })
}

impl Server {
    /// Create a new Voxelize server instance used to host all the worlds.
    pub fn new() -> ServerBuilder {
        ServerBuilder::new()
    }

    /// Set the RTC senders for hybrid WebSocket/WebRTC networking.
    pub fn set_rtc_senders(&mut self, rtc_senders: RtcSenders) {
        self.rtc_senders = Some(rtc_senders);
    }

    /// Get the RTC senders reference.
    pub fn rtc_senders(&self) -> Option<&RtcSenders> {
        self.rtc_senders.as_ref()
    }

    /// Add a world instance to the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn add_world(&mut self, mut world: World) -> Result<&mut Addr<SyncWorld>, AddWorldError> {
        let name = world.name.clone();
        let saving = world.config().saving;
        let save_dir = world.config().save_dir.clone();
        world.ecs_mut().insert(self.registry.clone());

        if let Some(rtc_senders) = &self.rtc_senders {
            world.ecs_mut().insert(rtc_senders.clone());
        }

        self.world_inbound_state
            .insert(name.clone(), world.inbound_state_handle());

        let entry = WorldEntry::static_world(&world.config().make_copy());

        let addr = world.start();

        if self.worlds.insert(name.clone(), addr).is_some() {
            return Err(AddWorldError);
        }
        self.world_entries.insert(name.clone(), entry);

        info!(
            "World created: {} ({})",
            name,
            if saving {
                format!("on-disk @ {}", save_dir)
            } else {
                "in-memory".to_owned()
            }
        );

        Ok(self.worlds.get_mut(&name).unwrap())
    }

    // /// Create a world in the server. Different worlds have different configurations, and can hold
    // /// their own set of clients within. If the server has already started, the added world will be
    // /// started right away.
    // pub fn create_world(
    //     &mut self,
    //     name: &str,
    //     config: &WorldConfig,
    // ) -> Result<&mut Addr<SyncWorld>, AddWorldError> {
    //     let mut world = World::new(name, config);
    //     world.ecs_mut().insert(self.registry.clone());
    //     self.add_world(world)
    // }

    /// Get a world reference by name.
    pub fn get_world(&self, world_name: &str) -> Option<&Addr<SyncWorld>> {
        self.worlds.get(world_name)
    }

    /// Get a mutable world reference by name.
    pub fn get_world_mut(&mut self, world_name: &str) -> Option<&mut Addr<SyncWorld>> {
        self.worlds.get_mut(world_name)
    }

    /// Get the information of the server
    pub fn get_info(&mut self) -> Value {
        (self.info_handle)(self)
    }

    /// Handler for client's message.
    pub(crate) fn on_request(
        &mut self,
        id: &str,
        mut data: Message,
        received_monotonic_ms: Option<f64>,
        wire_bytes: usize,
        session_token: Option<&str>,
    ) -> Option<String> {
        // Session identity: reject traffic from a socket that has been
        // superseded by a newer connection with the same client id. Without
        // this check, a zombie socket's JOIN retry could move the *new*
        // session's registration around and cross-wire the two connections.
        // `None` tokens come from secondary channels (WebRTC data channel)
        // that ride on an already-validated session.
        if let Some(session_token) = session_token {
            let current_token = self
                .connections
                .get(id)
                .map(|(_, _, token)| token)
                .or_else(|| self.lost_sessions.get(id).map(|(_, token)| token));
            if let Some(current_token) = current_token {
                if current_token != session_token {
                    perf::log(
                        "session_superseded",
                        "server",
                        json!({ "clientId": id }),
                    );
                    return Some(
                        "Session superseded by a newer connection with the same client id."
                            .to_owned(),
                    );
                }
            }
        }

        if perf::is_enabled() && data.r#type == MessageType::Chat as i32 {
            if let Some(chat) = data.chat.as_mut() {
                if chat.trace_id.is_empty() {
                    chat.trace_id = perf::next_trace_id("chat");
                }
            }
        }
        if data.r#type == MessageType::Join as i32 {
            let json: OnJoinRequest = match serde_json::from_str(&data.json) {
                Ok(json) => json,
                Err(error) => return Some(format!("Malformed JOIN payload: {}", error)),
            };

            return self.on_join(id, json);
        } else if data.r#type == MessageType::Leave as i32 {
            if let Some(world) = self.worlds.get_mut(&data.text) {
                if let Some((sender, _, token)) = self.connections.remove(id) {
                    self.lost_sessions.insert(id.to_owned(), (sender, token));

                    world.do_send(ClientLeaveRequest { id: id.to_owned() });
                }
            }

            return None;
        } else if data.r#type == MessageType::Action as i32 {
            self.on_action(id, &data);

            return None;
        } else if data.r#type == MessageType::Transport as i32
            || self.transport_sessions.contains_key(id)
        {
            if !self.transport_sessions.contains_key(id) {
                return Some(
                    "Someone who isn't a transport server is attempting to transport.".to_owned(),
                );
            }

            if data.text.is_empty() {
                return Some(format!(
                    "Transport message missing world name (text field empty). Message type: {:?}",
                    MessageType::try_from(data.r#type)
                        .map(|t| format!("{:?}", t))
                        .unwrap_or_else(|_| data.r#type.to_string())
                ));
            }

            if let Some(world) = self.get_world_mut(&data.text) {
                let world_name = data.text.clone();
                if data.r#type == MessageType::Chat as i32 {
                    if let Some(mut fields) = perf::chat_fields(&data) {
                        if let Value::Object(ref mut values) = fields {
                            values.insert("clientId".to_owned(), json!(id));
                            values.insert("wireBytes".to_owned(), json!(wire_bytes));
                        }
                        perf::log_at(
                            "chat_core_recv",
                            &world_name,
                            received_monotonic_ms.unwrap_or_else(perf::monotonic_ms),
                            fields,
                        );
                    }
                }
                perf::increment_inbound(&world_name);
                if world
                    .try_send(ClientRequest {
                        client_id: id.to_owned(),
                        data,
                    })
                    .is_err()
                {
                    perf::decrement_inbound(&world_name);
                    return Some("World is busy, please reconnect.".to_owned());
                }

                return None;
            } else {
                return Some(format!(
                    "Transport message for unknown world '{}'. Message type: {:?}",
                    data.text,
                    MessageType::try_from(data.r#type)
                        .map(|t| format!("{:?}", t))
                        .unwrap_or_else(|_| data.r#type.to_string())
                ));
            }
        }

        let connection = self.connections.get(id);
        if connection.is_none() {
            return Some("You are not connected to a world!".to_owned());
        }

        let (_, world_name, _) = connection.unwrap().to_owned();

        // Peer packets are latest-wins STATE, not events: stage them in the
        // world's inbound state buffer instead of its actor mailbox. The world
        // drains the buffer at the start of its next tick, before the system
        // dispatch, so a Tick message can never overtake a position packet
        // that arrived before it (which is what made AI systems read a
        // player's previous position).
        if data.r#type == MessageType::Peer as i32 {
            if let Some(inbound) = self.world_inbound_state.get(&world_name) {
                inbound.push(id, data);
                return None;
            }
        }

        if let Some(world) = self.get_world_mut(&world_name) {
            if data.r#type == MessageType::Chat as i32 {
                if let Some(mut fields) = perf::chat_fields(&data) {
                    if let Value::Object(ref mut values) = fields {
                        values.insert("clientId".to_owned(), json!(id));
                        values.insert("wireBytes".to_owned(), json!(wire_bytes));
                    }
                    perf::log_at(
                        "chat_core_recv",
                        &world_name,
                        received_monotonic_ms.unwrap_or_else(perf::monotonic_ms),
                        fields,
                    );
                }
            }
            perf::increment_inbound(&world_name);
            if world
                .try_send(ClientRequest {
                    client_id: id.to_owned(),
                    data,
                })
                .is_err()
            {
                perf::decrement_inbound(&world_name);
                return Some("World is busy, please reconnect.".to_owned());
            }
        }

        None
    }

    /// Handle a JOIN request. JOIN is reliable control-plane (see
    /// `world::replication`) and must be IDEMPOTENT: the acknowledgement (the
    /// INIT message) can be delayed or lost, and clients retry. A retry from
    /// the current session must replay the acknowledgement, never produce a
    /// fatal error — a fatal error here is what caused live
    /// join -> ack unanswered -> retry -> "already in world" -> disconnect
    /// loops on staging.
    fn on_join(&mut self, id: &str, json: OnJoinRequest) -> Option<String> {
        let preferences = json
            .flat_preferences
            .merge(json.preferences.unwrap_or_default());
        let motion_protocol = MotionProtocol::negotiate(&json.capabilities);

        if !self.worlds.contains_key(&json.world) {
            return Some(format!(
                "ID {} is attempting to connect to a non-existent world!",
                id
            ));
        }

        // Per-world join cap. An idempotent replay of an existing membership is
        // not a new occupant, so it is exempt; a fresh join or a switch into a
        // full world is rejected with typed backpressure before any world-side
        // state changes.
        let is_replay = self
            .connections
            .get(id)
            .map(|(_, world_name, _)| world_name == &json.world)
            .unwrap_or(false);
        if !is_replay {
            let live = self.world_player_count(&json.world);
            let cap = self.world_max_clients(&json.world);
            if live >= cap {
                perf::log(
                    "client_join_rejected",
                    &json.world,
                    json!({ "clientId": id, "reason": "capacity", "live": live, "cap": cap }),
                );
                return Some(format!(
                    "World {} is at capacity ({}/{})",
                    json.world, live, cap
                ));
            }
        }

        if let Some((sender, world_name, _)) = self.connections.get(id) {
            if *world_name == json.world {
                // Idempotent replay: this session already joined this world.
                // Re-issue the join; the world-side handler replays the INIT
                // ack without creating a duplicate entity.
                let sender = sender.clone();
                perf::log(
                    "client_join_replayed",
                    &json.world,
                    json!({ "clientId": id }),
                );
                info!("Replaying JOIN ack for {} in world {}", id, json.world);
                let world = self.worlds.get_mut(&json.world).unwrap();
                world.do_send(ClientJoinRequest {
                    id: id.to_owned(),
                    username: json.username,
                    sender,
                    preferences,
                    motion_protocol,
                });
                return None;
            }

            // Session is in a different world: switch atomically — leave the
            // old world, then fall through to a fresh join below. The two
            // messages share the target/source world mailboxes, so ordering
            // per world is preserved.
            let (sender, old_world, token) = self.connections.remove(id).unwrap();
            if let Some(old) = self.worlds.get_mut(&old_world) {
                old.do_send(ClientLeaveRequest { id: id.to_owned() });
            }
            self.lost_sessions.insert(id.to_owned(), (sender, token));
            info!(
                "Client {} switching worlds: {} -> {}",
                id, old_world, json.world
            );
        }

        if let Some((sender, token)) = self.lost_sessions.remove(id) {
            let world = self.worlds.get_mut(&json.world).unwrap();
            world.do_send(ClientJoinRequest {
                id: id.to_owned(),
                username: json.username,
                sender: sender.clone(),
                preferences,
                motion_protocol,
            });
            self.connections
                .insert(id.to_owned(), (sender, json.world, token));
            return None;
        }

        Some(format!(
            "Client {} has no registered session; reconnect before joining.",
            id
        ))
    }

    /// Register a new session, kicking any previous session with the same
    /// client id (its world membership is released so the new session can
    /// join cleanly). Returns (client_id, connection_token); the token
    /// authenticates this specific socket for the rest of its life so a
    /// superseded socket cannot act on the new session's registration.
    pub(crate) fn register_session(
        &mut self,
        id: Option<String>,
        is_transport: bool,
        sender: WsSender,
    ) -> (String, String) {
        let id = id.unwrap_or_else(|| nanoid!());
        let token = nanoid!();

        if is_transport {
            self.worlds.values_mut().for_each(|world| {
                world.do_send(TransportJoinRequest {
                    id: id.clone(),
                    sender: sender.clone(),
                })
            });

            self.transport_sessions.insert(id.to_owned(), sender);

            return (id, token);
        }

        let kick_msg = encode_message(
            &Message::new(&MessageType::Error)
                .text("Another session connected with your account.")
                .build(),
        );

        if let Some((old_sender, _old_token)) = self.lost_sessions.remove(&id) {
            info!("Kicking duplicate pre-join session: {}", id);
            let _ = old_sender.send(kick_msg.clone());
        }

        if let Some((old_sender, world_name, _old_token)) = self.connections.remove(&id) {
            info!("Kicking duplicate in-world session: {}", id);
            let _ = old_sender.send(kick_msg);
            if let Some(world) = self.worlds.get_mut(&world_name) {
                world.do_send(ClientLeaveRequest { id: id.clone() });
            }
            perf::log("session_replaced", &world_name, json!({ "clientId": id }));
        }

        self.lost_sessions
            .insert(id.to_owned(), (sender, token.clone()));

        (id, token)
    }

    /// Deterministically release a disconnected session's registration and
    /// world membership. Token-checked so a stale disconnect from a kicked
    /// socket cannot remove its replacement's state.
    pub(crate) fn unregister_session(&mut self, id: &str, token: &str) {
        if let Some((_, _, current_token)) = self.connections.get(id) {
            if current_token == token {
                let (_, world_name, _) = self.connections.remove(id).unwrap();
                if let Some(world) = self.worlds.get_mut(&world_name) {
                    world.do_send(ClientLeaveRequest { id: id.to_owned() });
                }
            } else {
                info!("Ignoring stale disconnect for {} (token mismatch)", id);
            }
        }

        if self.transport_sessions.remove(id).is_some() {
            self.worlds.values_mut().for_each(|world| {
                world.do_send(TransportLeaveRequest { id: id.to_owned() });
            });

            info!("A transport server connection has ended.")
        }

        if let Some((_, current_token)) = self.lost_sessions.get(id) {
            if current_token == token {
                self.lost_sessions.remove(id);
            }
        }
    }

    /// Prepare all worlds on the server to start.
    pub async fn prepare(&mut self) {
        for world in self.worlds.values_mut() {
            world.do_send(Prepare);
        }
    }

    /// Preload all the worlds (blocking until complete).
    ///
    /// Prefer sending [`RunPreload`] after the server actor has started so HTTP
    /// can serve `/health` during preload (`Voxelize::run` does this).
    pub async fn preload(&mut self) {
        Self::preload_worlds(&self.worlds).await;
    }

    /// Drive world preload via world actor addresses (used by [`RunPreload`]).
    async fn preload_worlds(worlds: &HashMap<String, Addr<SyncWorld>>) {
        let m = MultiProgress::new();
        let sty = ProgressStyle::with_template(
            "[{elapsed_precise}] [{bar:40.cyan/blue}] {msg} {spinner:.green} {percent:>7}%",
        )
        .unwrap()
        .progress_chars("#>-");

        let world_list: Vec<(String, Addr<SyncWorld>)> = worlds
            .iter()
            .map(|(name, addr)| (name.clone(), addr.clone()))
            .collect();

        let infos: Vec<_> = join_all(world_list.iter().map(|(_, world)| world.send(GetInfo)))
            .await
            .into_iter()
            .map(|r| r.unwrap())
            .collect();

        let mut bars = vec![];
        for ((_, world), info) in world_list.iter().zip(infos.iter()) {
            if !info.config.preload {
                bars.push(None);
                continue;
            }

            world.do_send(Preload);

            let bar = m.insert_from_back(0, ProgressBar::new(100));
            bar.set_message(info.name.clone());
            bar.set_style(sty.clone());
            bar.set_position(0);
            bars.push(Some(bar));
        }

        let start = Instant::now();

        loop {
            let infos: Vec<_> = join_all(world_list.iter().map(|(_, world)| world.send(GetInfo)))
                .await
                .into_iter()
                .map(|r| r.unwrap())
                .collect();

            let mut done = true;

            for (i, ((_, world), info)) in world_list.iter().zip(infos.iter()).enumerate() {
                if bars[i].is_none() || !info.config.preload {
                    continue;
                }

                let bar = bars[i].as_mut().unwrap();

                if !info.preloading || info.preload_progress >= 1.0 {
                    bar.finish_and_clear();
                    continue;
                }

                let _ = world.try_send(Tick);

                let at = (info.preload_progress * 100.0) as u64;

                done = false;
                bar.set_position(at);
            }

            if done {
                m.clear().unwrap();
                break;
            }

            tokio::time::sleep(PRELOAD_POLL_INTERVAL).await;
        }

        let preload_len = infos.iter().filter(|info| info.config.preload).count();

        info!(
            "✅ Total of {} world{} preloaded in {}s",
            preload_len,
            if preload_len == 1 { "" } else { "s" },
            (Instant::now() - start).as_millis() as f64 / 1000.0
        );
    }

    /// Tick every world on this server.
    pub(crate) fn tick(&mut self) {
        for world in self.worlds.values_mut() {
            let _ = world.try_send(Tick);
        }
    }

    /// Setup Fern for debug logging.
    fn setup_logger() {
        fern::Dispatch::new()
            .format(|out, message, record| {
                let colors = ColoredLevelConfig::new().info(Color::Green);

                out.finish(format_args!(
                    "{} [{}] [{}]: {}",
                    chrono::Local::now().format("[%H:%M:%S]"),
                    colors.color(record.level()),
                    record.target(),
                    message
                ))
            })
            .level(log::LevelFilter::Debug)
            .level_for("tungstenite", log::LevelFilter::Info)
            .level_for("webrtc", log::LevelFilter::Warn)
            .level_for("webrtc_ice", log::LevelFilter::Warn)
            .level_for("webrtc_sctp", log::LevelFilter::Warn)
            .level_for("webrtc_dtls", log::LevelFilter::Warn)
            .level_for("webrtc_srtp", log::LevelFilter::Warn)
            .level_for("webrtc_data", log::LevelFilter::Warn)
            .level_for("webrtc_mdns", log::LevelFilter::Warn)
            .level_for("webrtc_util", log::LevelFilter::Warn)
            .chain(std::io::stdout())
            .apply()
            .expect("Fern did not run successfully");
    }

    pub fn set_action_handle<F: Fn(Value, &mut Server) + 'static>(
        &mut self,
        action: &str,
        handle: F,
    ) {
        self.action_handles
            .insert(action.to_lowercase(), Arc::new(handle));
    }

    /// Handler for `Action` type messages.
    fn on_action(&mut self, _: &str, data: &Message) {
        let json: OnActionRequest = serde_json::from_str(&data.json)
            .expect("`on_action` error. Could not read JSON string.");
        let action = json.action.to_lowercase();

        info!("{:?}", &self.action_handles.keys());
        info!("{:?}", &action);

        if !self.action_handles.contains_key(&action) {
            warn!(
                "`Action` type messages received of type {}, but no action handler set.",
                action
            );
            return;
        }

        let handle = self.action_handles.get(&action).unwrap().to_owned();

        handle(json.data, self);
    }
}

/// New chat session is created. Returns (client_id, connection_token).
#[derive(ActixMessage)]
#[rtype(result = "(String, String)")]
pub struct Connect {
    pub id: Option<String>,
    pub is_transport: bool,
    pub sender: WsSender,
}

/// Session is disconnected
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct Disconnect {
    pub id: String,
    /// The connection token assigned when this session was created.
    /// Used to distinguish stale disconnects from kicked sessions.
    pub token: String,
}

#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Info;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct RunPreload;

#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct SetStarted(pub bool);

#[derive(ActixMessage)]
#[rtype(result = "Vec<WorldStatsResponse>")]
pub struct GetAllWorldStats;

/// Send message to specific world
#[derive(ActixMessage)]
#[rtype(result = "Option<String>")]
pub struct ClientMessage {
    /// Id of the client session
    pub id: String,

    /// Protobuf message
    pub data: Message,

    /// Connection token of the socket that produced this message. `None` for
    /// secondary channels (WebRTC data channel) riding on a validated
    /// session. When set, messages from superseded sockets are rejected.
    pub session_token: Option<String>,

    pub received_monotonic_ms: Option<f64>,
    pub wire_bytes: usize,
}

impl ClientMessage {
    pub fn new(
        id: String,
        data: Message,
        wire_bytes: usize,
        session_token: Option<String>,
    ) -> Self {
        Self {
            id,
            data,
            session_token,
            received_monotonic_ms: perf::is_enabled().then(perf::monotonic_ms),
            wire_bytes,
        }
    }
}

/// Make actor from `ChatServer`
impl Actor for Server {
    /// We are going to use simple Context, we just need ability to communicate
    /// with other actors.
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.actor_started_at = Some(Instant::now());
        if debug_pause_ticks_from_env() {
            self.debug_pause_ticks = true;
        }
        if let Some(after) = debug_pause_ticks_after_from_env() {
            self.debug_pause_ticks_after = Some(after);
        }

        ctx.run_interval(Duration::from_millis(self.interval), |act, ctx| {
            if let Some(after) = act.debug_pause_ticks_after {
                if let Some(started_at) = act.actor_started_at {
                    if started_at.elapsed() >= after {
                        act.debug_pause_ticks = true;
                    }
                }
            }
            if act.debug_pause_ticks {
                return;
            }

            let worlds_to_tick: Vec<_> = act
                .worlds
                .iter()
                .filter_map(|(name, world)| {
                    if act.pending_world_ticks.contains(name) {
                        None
                    } else {
                        Some((name.clone(), world.clone()))
                    }
                })
                .collect();

            for (world_name, world) in worlds_to_tick {
                act.pending_world_ticks.insert(world_name.clone());
                ctx.spawn(
                    wrap_future(world.send(Tick)).map(move |result, act: &mut Server, _| {
                        act.pending_world_ticks.remove(&world_name);
                        match result {
                            Ok(()) => {
                                act.last_tick_at = Some(Instant::now());
                            }
                            Err(error) => {
                                warn!("World tick failed for {}: {:?}", world_name, error);
                            }
                        }
                    }),
                );
            }
        });
    }
}

/// Handler for Connect message.
///
/// Register new session and assign unique id to this session.
/// Returns (client_id, connection_token).
impl Handler<Connect> for Server {
    type Result = MessageResult<Connect>;

    fn handle(&mut self, msg: Connect, ctx: &mut Context<Self>) -> Self::Result {
        let result = self.register_session(msg.id, msg.is_transport, msg.sender);
        self.reconcile_gc(ctx);
        MessageResult(result)
    }
}

/// Handler for Disconnect message.
/// Only cleans up session state if the connection token matches the currently
/// registered token, preventing stale disconnects from kicked sessions from
/// removing the new session's state.
impl Handler<Disconnect> for Server {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, ctx: &mut Context<Self>) {
        self.unregister_session(&msg.id, &msg.token);
        self.reconcile_gc(ctx);
    }
}

/// Handler for server info request.
impl Handler<Info> for Server {
    type Result = MessageResult<Info>;

    fn handle(&mut self, _: Info, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.get_info())
    }
}

/// Drive world preload after the HTTP server is already bound.
impl Handler<RunPreload> for Server {
    type Result = ResponseActFuture<Self, ()>;

    fn handle(&mut self, _: RunPreload, _: &mut Context<Self>) -> Self::Result {
        let worlds = self.worlds.clone();
        Box::pin(wrap_future(async move {
            Server::preload_worlds(&worlds).await;
        }))
    }
}

/// Mark the server as started (called after boot preload completes).
impl Handler<SetStarted> for Server {
    type Result = ();

    fn handle(&mut self, msg: SetStarted, _: &mut Context<Self>) -> Self::Result {
        self.started = msg.0;
    }
}

/// Deep health probe: tick liveness + preload state (wedged-but-bound detection).
#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Health;

impl Handler<Health> for Server {
    type Result = ResponseActFuture<Self, Value>;

    fn handle(&mut self, _: Health, _: &mut Context<Self>) -> Self::Result {
        let started = self.started;
        let last_tick_age_ms = self
            .last_tick_at
            .map(|at| at.elapsed().as_millis() as u64);
        let stall_threshold_ms = tick_stall_threshold_ms();
        let world_addrs: Vec<(String, Addr<SyncWorld>)> = self
            .worlds
            .iter()
            .map(|(name, addr)| (name.clone(), addr.clone()))
            .collect();

        Box::pin(wrap_future(async move {
            let mut worlds = Vec::with_capacity(world_addrs.len());
            for (name, addr) in world_addrs {
                match addr.send(GetInfo).await {
                    Ok(info) => worlds.push((name, info.preloading, info.preload_progress)),
                    Err(_) => worlds.push((name, false, 0.0)),
                }
            }
            build_health_value(started, last_tick_age_ms, &worlds, stall_threshold_ms)
        }))
    }
}

/// Handler for getting all world stats.
impl Handler<GetAllWorldStats> for Server {
    type Result = actix::ResponseActFuture<Self, Vec<WorldStatsResponse>>;

    fn handle(&mut self, _: GetAllWorldStats, _: &mut Context<Self>) -> Self::Result {
        let world_addrs: Vec<_> = self.worlds.iter().map(|(_, addr)| addr.clone()).collect();

        Box::pin(wrap_future(async move {
            let mut stats = Vec::new();
            for addr in world_addrs {
                if let Ok(world_stats) = addr.send(GetWorldStats).await {
                    stats.push(world_stats);
                }
            }
            stats
        }))
    }
}

/// Handler for Message message.
impl Handler<ClientMessage> for Server {
    type Result = Option<String>;

    fn handle(&mut self, msg: ClientMessage, ctx: &mut Context<Self>) -> Self::Result {
        let result = self.on_request(
            &msg.id,
            msg.data,
            msg.received_monotonic_ms,
            msg.wire_bytes,
            msg.session_token.as_deref(),
        );
        self.reconcile_gc(ctx);
        result
    }
}

const DEFAULT_DEBUG: bool = true;
const DEFAULT_PORT: u16 = 4000;
const DEFAULT_ADDR: &str = "0.0.0.0";
const DEFAULT_SERVE: &str = "";
const DEFAULT_INTERVAL: u64 = 16;

/// Builder for a voxelize server.
pub struct ServerBuilder {
    port: u16,
    debug: bool,
    addr: String,
    serve: String,
    interval: u64,
    secret: Option<String>,
    registry: Option<Registry>,
    max_worlds: Option<usize>,
    world_pool: Option<PoolConfig>,
}

impl ServerBuilder {
    /// Create a new server builder instance.
    pub fn new() -> Self {
        Self {
            debug: DEFAULT_DEBUG,
            port: DEFAULT_PORT,
            addr: DEFAULT_ADDR.to_owned(),
            serve: DEFAULT_SERVE.to_owned(),
            interval: DEFAULT_INTERVAL,
            secret: None,
            registry: None,
            max_worlds: None,
            world_pool: None,
        }
    }

    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Configure the address of the voxelize server.
    pub fn addr(mut self, addr: &str) -> Self {
        self.addr = addr.to_owned();
        self
    }

    /// Configure whether or not the voxelize server should be in debug mode.
    pub fn debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Configure the static folder to serve.
    pub fn serve(mut self, serve: &str) -> Self {
        self.serve = serve.to_owned();
        self
    }

    /// Configure the interval for the server to tick at.
    pub fn interval(mut self, interval: u64) -> Self {
        self.interval = interval;
        self
    }

    /// Configure the secret for the server to be able to join.
    pub fn secret(mut self, secret: &str) -> Self {
        self.secret = Some(secret.to_owned());
        self
    }

    /// Configure the block registry of the server. Once a registry is configured, mutating it wouldn't
    /// change the server's block list.
    pub fn registry(mut self, registry: &Registry) -> Self {
        self.registry = Some(registry.to_owned());
        self
    }

    /// Instantiate a voxelize server instance.
    pub fn build(self) -> Server {
        let mut registry = self.registry.unwrap_or(Registry::new());
        registry.generate();

        if self.debug {
            Server::setup_logger();
        }

        Server {
            port: self.port,
            addr: self.addr,
            serve: self.serve,
            debug: self.debug,
            interval: self.interval,
            secret: self.secret,

            registry,

            started: false,

            connections: HashMap::default(),
            lost_sessions: HashMap::default(),
            transport_sessions: HashMap::default(),
            pending_world_ticks: HashSet::default(),
            last_tick_at: None,
            actor_started_at: None,
            debug_pause_ticks: false,
            debug_pause_ticks_after: None,
            worlds: HashMap::default(),
            world_inbound_state: HashMap::default(),
            info_handle: default_info_handle,
            action_handles: HashMap::default(),
            rtc_senders: None,
            max_worlds: self.max_worlds,
            world_pool: self.world_pool,
            world_pool_slots: Vec::new(),
            world_entries: HashMap::default(),
            lifecycle_metrics: WorldLifecycleMetrics::default(),
        }
    }
}

#[cfg(test)]
mod health_tests {
    use super::*;

    #[test]
    fn health_reports_stall_when_tick_age_exceeds_threshold() {
        let value = build_health_value(
            true,
            Some(12_000),
            &[("spireash".into(), false, 1.0)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["ready"], json!(false));
        assert_eq!(value["preloading"], json!(false));
        assert_eq!(value["lastTickAgeMs"], json!(12_000));
    }

    #[test]
    fn health_ok_when_recent_tick_and_not_preloading() {
        let value = build_health_value(
            true,
            Some(40),
            &[("spireash".into(), false, 1.0)],
            5_000,
        );
        assert_eq!(value["ok"], json!(true));
        assert_eq!(value["ready"], json!(true));
    }

    #[test]
    fn health_not_ready_while_preloading() {
        let value = build_health_value(
            true,
            Some(10),
            &[("spireash".into(), true, 0.4)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["ready"], json!(false));
        assert_eq!(value["preloading"], json!(true));
    }

    #[test]
    fn health_not_ready_before_started_even_with_ticks() {
        // Bind-before-preload leaves started=false until RunPreload finishes.
        let value = build_health_value(
            false,
            Some(5),
            &[("spireash".into(), true, 0.1)],
            5_000,
        );
        assert_eq!(value["ok"], json!(false));
        assert_eq!(value["started"], json!(false));
        assert_eq!(value["preloading"], json!(true));
        assert!((value["preloadProgress"].as_f64().unwrap() - 0.1).abs() < 1e-6);
    }
}

/// Session lifecycle integration tests: a real `Server` struct routing into a
/// real `SyncWorld` actor (world thread + ECS), with fake sockets. Covers the
/// join/reconnect requirements: idempotent JOIN with ack replay, no duplicate
/// entities, abrupt-disconnect + same-id reconnect, the concurrent old/new
/// socket race, and deterministic membership cleanup.
#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use crate::{decode_message, GetWorldStats};

    const WORLD: &str = "lifeworld";

    fn join_message(world: &str) -> Message {
        Message::new(&MessageType::Join)
            .json(&json!({ "world": world, "username": "tester" }).to_string())
            .build()
    }

    /// Fake connection: returns the sender and its control-lane receiver.
    /// Session lifecycle traffic (INIT, ERROR, JOIN/LEAVE) rides the control
    /// lane; these tests never exercise the bulk lane, so its receiver is
    /// dropped and bulk sends would error harmlessly.
    fn fake_socket() -> (WsSender, mpsc::UnboundedReceiver<Vec<u8>>) {
        let (control_tx, control_rx) = mpsc::unbounded_channel();
        let (bulk_tx, _) = mpsc::unbounded_channel();
        (WsSender::new(control_tx, bulk_tx), control_rx)
    }

    /// Await the world's mailbox draining (SyncArbiter processes messages
    /// FIFO on one thread, so a round-trip proves prior do_sends ran) and
    /// return the world's live client count.
    async fn world_client_count(server: &Server) -> usize {
        server
            .worlds
            .get(WORLD)
            .unwrap()
            .send(GetWorldStats)
            .await
            .unwrap()
            .client_count
    }

    /// Drain everything on a fake socket's control lane, marking each message
    /// written so the sender's depth (the state-flush gate signal) reflects a
    /// live socket. Undecodable payloads (test filler) are skipped.
    fn drain_messages(sender: &WsSender, rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> Vec<Message> {
        let mut messages = vec![];
        while let Ok(bytes) = rx.try_recv() {
            sender.mark_control_written();
            if let Ok(message) = decode_message(&bytes) {
                messages.push(message);
            }
        }
        messages
    }

    fn drain_message_types(
        sender: &WsSender,
        rx: &mut mpsc::UnboundedReceiver<Vec<u8>>,
    ) -> Vec<i32> {
        drain_messages(sender, rx)
            .into_iter()
            .map(|message| message.r#type)
            .collect()
    }

    /// All peer ids mentioned across PEER messages in a drained batch.
    fn peer_ids_in(messages: &[Message]) -> Vec<String> {
        messages
            .iter()
            .filter(|m| m.r#type == MessageType::Peer as i32)
            .flat_map(|m| m.peers.iter().map(|p| p.id.clone()))
            .collect()
    }

    fn build_server_with_world() -> Server {
        let mut server = Server::new().debug(false).build();
        let config = WorldConfig::new().build();
        server
            .add_world(World::new(WORLD, &config))
            .expect("world should register");
        server
    }

    fn on_request(server: &mut Server, id: &str, token: &str, data: Message) -> Option<String> {
        server.on_request(id, data, None, 0, Some(token))
    }

    #[test]
    fn duplicate_join_replays_ack_without_error_or_duplicate_entity() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();
            let (sender, mut rx) = fake_socket();
            let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

            // First JOIN, then a retry as if the INIT ack was lost in flight.
            assert_eq!(on_request(&mut server, &id, &token, join_message(WORLD)), None);
            assert_eq!(
                on_request(&mut server, &id, &token, join_message(WORLD)),
                None,
                "JOIN retry from the live session must not be a fatal error"
            );

            assert_eq!(world_client_count(&server).await, 1, "no duplicate entity");

            let types = drain_message_types(&sender, &mut rx);
            let inits = types
                .iter()
                .filter(|t| **t == MessageType::Init as i32)
                .count();
            assert_eq!(inits, 2, "each JOIN gets an INIT ack (original + replay)");
        });
    }

    #[test]
    fn abrupt_disconnect_then_same_id_reconnect_joins_cleanly() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();

            let (old_sender, _old_rx) = fake_socket();
            let (id, old_token) = server.register_session(Some("bot".into()), false, old_sender.clone());
            assert_eq!(on_request(&mut server, &id, &old_token, join_message(WORLD)), None);
            assert_eq!(world_client_count(&server).await, 1);

            // Abrupt closure: no Leave, no Disconnect — the process died. A
            // fresh connection with the same id must replace the membership.
            let (new_sender, mut new_rx) = fake_socket();
            let (_, new_token) = server.register_session(Some("bot".into()), false, new_sender.clone());
            assert_eq!(
                on_request(&mut server, &id, &new_token, join_message(WORLD)),
                None,
                "reconnect join must not report 'already in world'"
            );

            assert_eq!(world_client_count(&server).await, 1, "exactly one live entity");
            let types = drain_message_types(&new_sender, &mut new_rx);
            assert!(
                types.contains(&(MessageType::Init as i32)),
                "new session receives the INIT ack"
            );

            // The old socket's late disconnect must not tear down the new
            // session (token mismatch).
            server.unregister_session(&id, &old_token);
            assert_eq!(world_client_count(&server).await, 1);
            assert!(server.connections.contains_key(&id));
        });
    }

    #[test]
    fn superseded_socket_is_rejected_and_cannot_cross_wire_sessions() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();

            let (old_sender, mut old_rx) = fake_socket();
            let (id, old_token) = server.register_session(Some("bot".into()), false, old_sender.clone());
            assert_eq!(on_request(&mut server, &id, &old_token, join_message(WORLD)), None);

            // New socket connects while the old one is still open.
            let (new_sender, _new_rx) = fake_socket();
            let (_, new_token) = server.register_session(Some("bot".into()), false, new_sender.clone());

            // Old socket was kicked with a reliable ERROR message.
            let old_types = drain_message_types(&old_sender, &mut old_rx);
            assert!(old_types.contains(&(MessageType::Error as i32)));

            // The old socket's JOIN retry races the new socket's JOIN: it
            // must be rejected, not steal the new session's registration.
            let error = on_request(&mut server, &id, &old_token, join_message(WORLD));
            assert!(error.is_some(), "superseded socket must be rejected");

            assert_eq!(on_request(&mut server, &id, &new_token, join_message(WORLD)), None);
            assert_eq!(world_client_count(&server).await, 1);
        });
    }

    #[test]
    fn disconnect_removes_membership_deterministically_and_rejoin_works() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();

            let (sender, _rx) = fake_socket();
            let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());
            assert_eq!(on_request(&mut server, &id, &token, join_message(WORLD)), None);
            assert_eq!(world_client_count(&server).await, 1);

            server.unregister_session(&id, &token);
            assert_eq!(world_client_count(&server).await, 0, "membership removed");
            assert!(!server.connections.contains_key(&id));
            assert!(!server.lost_sessions.contains_key(&id));

            // A later reconnect with the same id starts a clean session.
            let (sender, mut rx) = fake_socket();
            let (_, token) = server.register_session(Some("bot".into()), false, sender.clone());
            assert_eq!(on_request(&mut server, &id, &token, join_message(WORLD)), None);
            assert_eq!(world_client_count(&server).await, 1);
            assert!(drain_message_types(&sender, &mut rx).contains(&(MessageType::Init as i32)));
        });
    }

    #[test]
    fn join_for_unknown_world_is_rejected_without_touching_session() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();

            let (sender, _rx) = fake_socket();
            let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

            let error = on_request(&mut server, &id, &token, join_message("nowhere"));
            assert!(error.is_some());
            // The session registration survives, so a corrected JOIN works.
            assert!(server.lost_sessions.contains_key(&id));
            assert_eq!(on_request(&mut server, &id, &token, join_message(WORLD)), None);
            assert_eq!(world_client_count(&server).await, 1);
        });
    }

    #[test]
    fn peer_visibility_is_bidirectional_and_lifecycle_survives_backlog() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();
            let world_addr = server.worlds.get(WORLD).unwrap().clone();
            let tick = |n: usize| {
                let world_addr = world_addr.clone();
                async move {
                    for _ in 0..n {
                        world_addr.send(crate::Tick).await.unwrap();
                    }
                }
            };

            // A joins first and settles (its metadata dirty flag is long
            // consumed by the time B joins).
            let (sender_a, mut rx_a) = fake_socket();
            let (id_a, token_a) =
                server.register_session(Some("visA".into()), false, sender_a.clone());
            assert_eq!(on_request(&mut server, &id_a, &token_a, join_message(WORLD)), None);
            tick(4).await;
            drain_messages(&sender_a, &mut rx_a);

            // B joins later.
            let (sender_b, mut rx_b) = fake_socket();
            let (id_b, token_b) =
                server.register_session(Some("visB".into()), false, sender_b.clone());
            assert_eq!(on_request(&mut server, &id_b, &token_b, join_message(WORLD)), None);
            tick(4).await;

            // A must learn about B: reliable JOIN exactly once + peer state.
            let a_messages = drain_messages(&sender_a, &mut rx_a);
            let joins_for_b = a_messages
                .iter()
                .filter(|m| m.r#type == MessageType::Join as i32 && m.text == id_b)
                .count();
            assert_eq!(joins_for_b, 1, "existing client gets exactly one JOIN for newcomer");
            let a_peer_ids = peer_ids_in(&a_messages);
            assert!(
                a_peer_ids.contains(&id_b),
                "existing client receives newcomer's peer state"
            );
            assert!(!a_peer_ids.contains(&id_a), "no self peer echo");

            // B must learn about A: INIT peers + full state re-sync.
            let b_messages = drain_messages(&sender_b, &mut rx_b);
            let init = b_messages
                .iter()
                .find(|m| m.r#type == MessageType::Init as i32)
                .expect("newcomer receives INIT");
            assert!(
                init.peers.iter().any(|p| p.id == id_a),
                "newcomer INIT lists existing peers"
            );
            assert!(
                peer_ids_in(&b_messages).contains(&id_a),
                "newcomer receives existing peers' state"
            );

            // B moves; A converges to B's latest position.
            let move_b = Message::new(&MessageType::Peer)
                .peers(&[crate::PeerProtocol {
                    id: String::new(),
                    username: "visB".into(),
                    metadata: json!({ "position": [5.0, 0.0, 0.0] }).to_string(),
                }])
                .build();
            assert_eq!(server.on_request(&id_b, move_b, None, 0, Some(&token_b)), None);
            tick(4).await;
            let a_messages = drain_messages(&sender_a, &mut rx_a);
            let b_position = a_messages
                .iter()
                .filter(|m| m.r#type == MessageType::Peer as i32)
                .flat_map(|m| m.peers.iter())
                .filter(|p| p.id == id_b)
                .filter_map(|p| {
                    serde_json::from_str::<Value>(&p.metadata)
                        .ok()?
                        .get("position")?
                        .get(0)?
                        .as_f64()
                })
                .last();
            assert_eq!(b_position, Some(5.0), "A receives B's latest position");

            // Backlog A's socket (undrained control lane past the gate), then
            // have B move and leave. Reliable lifecycle must not be starved:
            // the LEAVE arrives even though state flushing is gated, and no
            // stale state for B is delivered after it.
            for _ in 0..(crate::STATE_FLUSH_MAX_SOCKET_BACKLOG * 2) {
                let _ = sender_a.send(vec![0]);
            }
            let move_b = Message::new(&MessageType::Peer)
                .peers(&[crate::PeerProtocol {
                    id: String::new(),
                    username: "visB".into(),
                    metadata: json!({ "position": [8.0, 0.0, 0.0] }).to_string(),
                }])
                .build();
            assert_eq!(server.on_request(&id_b, move_b, None, 0, Some(&token_b)), None);
            tick(2).await;
            let leave_b = Message::new(&MessageType::Leave).text(WORLD).build();
            assert_eq!(server.on_request(&id_b, leave_b, None, 0, Some(&token_b)), None);
            tick(4).await;

            let a_messages = drain_messages(&sender_a, &mut rx_a);
            let leave_index = a_messages
                .iter()
                .position(|m| m.r#type == MessageType::Leave as i32 && m.text == id_b);
            assert!(
                leave_index.is_some(),
                "backlogged client still receives the reliable LEAVE"
            );
            let peers_after_leave = a_messages[leave_index.unwrap()..]
                .iter()
                .filter(|m| m.r#type == MessageType::Peer as i32)
                .flat_map(|m| m.peers.iter())
                .any(|p| p.id == id_b);
            assert!(
                !peers_after_leave,
                "no stale peer state is delivered after the LEAVE"
            );
            assert_eq!(world_client_count(&server).await, 1, "B removed from world");
        });
    }

    #[test]
    fn malformed_join_payload_is_a_typed_error_not_a_panic() {
        actix::System::new().block_on(async {
            let mut server = build_server_with_world();

            let (sender, _rx) = fake_socket();
            let (id, token) = server.register_session(Some("bot".into()), false, sender.clone());

            let message = Message::new(&MessageType::Join).json("{not json").build();
            let error = on_request(&mut server, &id, &token, message);
            assert!(error.unwrap().contains("Malformed JOIN payload"));
        });
    }
}

/// Preload completion against a real `SyncWorld` actor: the completion check
/// must only count in-bounds chunks, so a preload radius larger than the
/// world bounds still finishes instead of leaving `preloading` true forever.
#[cfg(test)]
mod preload_tests {
    use super::*;
    use crate::FlatlandStage;

    #[test]
    fn bounded_world_preload_completes_with_oversize_radius() {
        actix::System::new().block_on(async {
            let mut server = Server::new().debug(false).build();

            // A 3x3-chunk world with a preload radius far beyond its bounds:
            // most cells of the completion check square can never be ready.
            let config = WorldConfig::new()
                .min_chunk([-1, -1])
                .max_chunk([1, 1])
                .preload(true)
                .preload_radius(5)
                .build();

            let mut bounded = World::new("bounded", &config);
            bounded.pipeline_mut().add_stage(FlatlandStage::new());

            let world = server
                .add_world(bounded)
                .expect("world should register")
                .clone();

            world.send(Preload).await.expect("preload should schedule");

            let mut preloading = true;
            for _ in 0..2000 {
                world.send(Tick).await.expect("tick should run");
                let info = world.send(GetInfo).await.expect("info should be readable");
                if !info.preloading {
                    preloading = false;
                    break;
                }
            }

            assert!(
                !preloading,
                "bounded world preload must complete even when the preload radius exceeds the world bounds"
            );
        });
    }
}
