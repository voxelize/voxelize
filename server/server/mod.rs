mod builder;
mod health;
mod lifecycle;
/// Session lifecycle integration tests: a real `Server` struct routing into a
/// real `SyncWorld` actor (world thread + ECS), with fake sockets. Covers the
/// join/reconnect requirements: idempotent JOIN with ack replay, no duplicate
/// entities, abrupt-disconnect + same-id reconnect, the concurrent old/new
/// socket race, and deterministic membership cleanup.
#[cfg(test)]
mod lifecycle_tests;
mod messages;
mod models;
/// Preload completion against a real `SyncWorld` actor: the completion check
/// must only count in-bounds chunks, so a preload radius larger than the
/// world bounds still finishes instead of leaving `preloading` true forever.
#[cfg(test)]
mod preload_tests;

pub use builder::*;
pub use health::*;
pub use messages::*;

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use actix::{fut::wrap_future, Actor, ActorFutureExt, Addr, AsyncContext, Context};
use fern::colors::{Color, ColoredLevelConfig};
use futures_util::future::join_all;
use hashbrown::{HashMap, HashSet};
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::WorldExt;
use std::sync::{
    atomic::{AtomicU16, AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::mpsc;

use crate::{
    errors::AddWorldError,
    perf,
    world::{
        check_protocol, Chunks, ClientPreferencesPatch, InboundStateBuffer, MotionProtocol, Registry,
        World, PROTOCOL_MISMATCH_CLOSE_CODE, PROTOCOL_VERSION,
    },
    ClientJoinRequest, ClientLeaveRequest, ClientRequest, GetInfo, Preload, Prepare, RtcSenders,
    SyncWorld, Tick, TransportJoinRequest, TransportLeaveRequest,
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
    /// Requested WebSocket close code, or `0` for a normal close. Set when the
    /// server refuses a session terminally (e.g. a protocol-version mismatch,
    /// [`PROTOCOL_MISMATCH_CLOSE_CODE`]) so the transport can close with a code
    /// the client treats as non-retryable.
    close_code: Arc<AtomicU16>,
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
            close_code: Arc::new(AtomicU16::new(0)),
        }
    }

    /// Request the transport close this session with a specific WebSocket close
    /// code. Used by the server to fail a join closed (terminal for the client)
    /// instead of leaving it to silently desync.
    pub fn request_close(&self, code: u16) {
        self.close_code.store(code, Ordering::Relaxed);
    }

    /// The requested terminal close code, if any (`0` means normal close).
    pub fn requested_close(&self) -> Option<u16> {
        let code = self.close_code.load(Ordering::Relaxed);
        (code != 0).then_some(code)
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
    /// Wire protocol version the client was built against. Only enforced when
    /// joining a deterministic (fixed-step) world, where it is asserted with
    /// strict equality (no `0`/missing bypass). Non-deterministic worlds ignore
    /// it, so existing clients are unaffected.
    #[serde(default)]
    protocol: Option<u32>,
}

#[derive(Serialize, Deserialize)]
struct OnActionRequest {
    action: String,
    data: Value,
}

type ServerInfoHandle = fn(&Server) -> Value;

/// Value reported on `/info` for any build-identity fact that could not be
/// established. A visible "unknown" — never a fabricated stand-in — so a
/// binary without a stamped identity is unmistakable to tooling.
pub const UNKNOWN_BUILD_IDENTITY: &str = "unknown";

/// Compile-time identity of the binary behind this server, surfaced on
/// `/info` so tooling can prove which sources a running process was built
/// from. Adapters stamp it via [`ServerBuilder::build_identity`]; unset
/// fields stay [`UNKNOWN_BUILD_IDENTITY`].
#[derive(Clone, Debug)]
pub struct BuildIdentity {
    /// Content fingerprint of the sources the binary was compiled from.
    /// The only field tooling may use for staleness decisions.
    pub build_id: String,

    /// Git commit the working tree was on at compile time. Human-facing
    /// context only: uncommitted edits never move it.
    pub git_sha: String,

    /// Cargo profile the binary was compiled with.
    pub profile: String,
}

impl Default for BuildIdentity {
    fn default() -> Self {
        Self {
            build_id: UNKNOWN_BUILD_IDENTITY.to_owned(),
            git_sha: UNKNOWN_BUILD_IDENTITY.to_owned(),
            profile: UNKNOWN_BUILD_IDENTITY.to_owned(),
        }
    }
}

pub(super) fn unix_seconds_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock predates the unix epoch")
        .as_secs()
}

pub(super) fn executable_modified_unix_seconds() -> Option<u64> {
    let executable = std::env::current_exe().ok()?;
    let modified = std::fs::metadata(executable).ok()?.modified().ok()?;
    modified
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|since_epoch| since_epoch.as_secs())
}

fn default_info_handle(server: &Server) -> Value {
    let mut info = HashMap::new();

    info.insert(
        "lost_sessions".to_owned(),
        json!(server.lost_sessions.len()),
    );

    info.insert("buildId".to_owned(), json!(server.build_identity.build_id));
    info.insert("gitSha".to_owned(), json!(server.build_identity.git_sha));
    info.insert("profile".to_owned(), json!(server.build_identity.profile));
    // Informational context only. `builtAt` is the executable's mtime captured
    // once at startup (a rebuild replacing the file on disk must not
    // masquerade as this process's own build time); tooling must never use
    // wall-clock fields for staleness decisions — that is what `buildId` is
    // for.
    info.insert("builtAt".to_owned(), json!(server.executable_built_at_secs));
    info.insert("pid".to_owned(), json!(std::process::id()));
    info.insert(
        "startedAt".to_owned(),
        json!(server.process_started_at_secs),
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

    /// Compile-time identity of this binary, stamped by the adapter.
    pub build_identity: BuildIdentity,

    /// Unix seconds when this server was constructed (process start, for all
    /// practical purposes). Informational only.
    process_started_at_secs: u64,

    /// Unix seconds mtime of the running executable, captured once at
    /// construction. `None` when the executable cannot be stat'ed.
    executable_built_at_secs: Option<u64>,

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

/// Delay between preload progress polls. Each poll also ticks the preloading
/// worlds (and the server actor's own tick interval keeps ticking them during
/// boot preload), so polling hotter than the tick cadence makes preload no
/// faster — it only burns CPU and starves the arbiter that concurrently
/// serves `/health` while chunks generate.
const PRELOAD_POLL_INTERVAL: Duration = Duration::from_millis(10);

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
        let registry = self.registry.clone();
        world.ecs_mut().insert(registry.clone());
        world
            .ecs_mut()
            .write_resource::<Chunks>()
            .set_waterlogging_rules(registry.waterlogging_rules().map(Arc::new));

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
                    perf::log("session_superseded", "server", json!({ "clientId": id }));
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

    /// The control-lane sender for a session, whether it is already in a world
    /// (`connections`) or still pre-join (`lost_sessions`). Used to signal a
    /// terminal close code before rejecting a join.
    fn session_sender(&self, id: &str) -> Option<WsSender> {
        self.connections
            .get(id)
            .map(|(sender, _, _)| sender.clone())
            .or_else(|| self.lost_sessions.get(id).map(|(sender, _)| sender.clone()))
    }

    /// Handle a JOIN request. JOIN is reliable control-plane (see
    /// `world::replication`) and must be IDEMPOTENT: the acknowledgement (the
    /// INIT message) can be delayed or lost, and clients retry. A retry from
    /// the current session must replay the acknowledgement, never produce a
    /// fatal error — a fatal error here is what caused live
    /// join -> ack unanswered -> retry -> "already in world" -> disconnect
    /// loops in live deployments.
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

        // Fail-closed protocol assert for deterministic worlds. A silently
        // accepted stale/absent field desyncs every downstream step of a
        // deterministic sim, so the join is refused with strict equality (no
        // `0`/missing bypass) and closed terminally (`client_outdated`). Non-
        // deterministic worlds skip this entirely — existing clients unchanged.
        if self.world_is_deterministic(&json.world) {
            if let Err(reject) = check_protocol(json.protocol) {
                if let Some(sender) = self.session_sender(id) {
                    sender.request_close(PROTOCOL_MISMATCH_CLOSE_CODE);
                }
                perf::log(
                    "client_join_rejected",
                    &json.world,
                    json!({
                        "clientId": id,
                        "reason": "protocol",
                        "clientProtocol": json.protocol,
                        "serverProtocol": PROTOCOL_VERSION,
                    }),
                );
                return Some(reject.message());
            }
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

#[cfg(test)]
mod build_identity_tests {
    use super::*;

    #[test]
    fn info_reports_the_stamped_identity_and_process_facts() {
        let mut server = Server::new()
            .debug(false)
            .build_identity(BuildIdentity {
                build_id: "f00dfacecafe0123".to_owned(),
                git_sha: "abc1234".to_owned(),
                profile: "release-dev".to_owned(),
            })
            .build();

        let info = server.get_info();
        assert_eq!(info["buildId"], "f00dfacecafe0123");
        assert_eq!(info["gitSha"], "abc1234");
        assert_eq!(info["profile"], "release-dev");
        assert_eq!(info["pid"], json!(std::process::id()));
        assert!(info["startedAt"].as_u64().unwrap() > 0);
        // The test harness executable exists on disk, so its mtime is known.
        assert!(info["builtAt"].as_u64().unwrap() > 0);
    }

    #[test]
    fn unset_identity_reads_unknown_never_a_fabricated_value() {
        let mut server = Server::new().debug(false).build();

        let info = server.get_info();
        assert_eq!(info["buildId"], UNKNOWN_BUILD_IDENTITY);
        assert_eq!(info["gitSha"], UNKNOWN_BUILD_IDENTITY);
        assert_eq!(info["profile"], UNKNOWN_BUILD_IDENTITY);
    }
}
