mod builder;
mod health;
mod join_trace;
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
/// The INIT registry handshake end to end: a JOIN naming the server's
/// registry digest gets an INIT without the block definitions, any other
/// JOIN gets them in full, and every world serves one shared copy.
#[cfg(test)]
mod registry_cache_tests;
mod session_auth;

pub use builder::*;
pub use health::*;
pub use join_trace::*;
pub use messages::*;
pub use session_auth::*;

use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use actix::{fut::wrap_future, Actor, ActorFutureExt, Addr, AsyncContext, Context};
use futures_util::future::join_all;
use hashbrown::{HashMap, HashSet};
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specs::WorldExt;
use std::sync::{
    atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::mpsc;

use crate::{
    errors::AddWorldError,
    perf,
    world::{
        check_protocol, Chunks, ClientPreferencesPatch, InboundStateBuffer, MethodGuard,
        MethodIndex, MotionProtocol, Registry, SharedInitRegistry, World,
        PROTOCOL_MISMATCH_CLOSE_CODE, PROTOCOL_VERSION,
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
    bulk: mpsc::UnboundedSender<BulkFrame>,
    control_depth: Arc<AtomicUsize>,
    bulk_depth: Arc<AtomicUsize>,
    /// Control-lane messages queued and written over the session's life. The
    /// INIT's queue position names the write that delivers it (see
    /// [`JoinTrace::control_written`]).
    control_queued: Arc<AtomicU64>,
    control_written: Arc<AtomicU64>,
    /// Timing of this session's joins, stamped by the socket loop, the server
    /// actor and the world as a join passes through each.
    join_trace: JoinTrace,
    /// Requested WebSocket close code, or `0` for a normal close. Set when the
    /// server refuses a session terminally (e.g. a protocol-version mismatch,
    /// [`PROTOCOL_MISMATCH_CLOSE_CODE`]) so the transport can close with a code
    /// the client treats as non-retryable.
    close_code: Arc<AtomicU16>,
    /// The WebRTC data channel opened for this socket, if any. It rides with
    /// the socket (across world switches, and out with it when it is
    /// replaced or closes) because one client id may hold sockets in several
    /// worlds, each with its own channel.
    rtc: Arc<std::sync::Mutex<Option<mpsc::UnboundedSender<Vec<u8>>>>>,
}

/// One message on the bulk lane, stamped with when it was queued.
///
/// The stamp rides with the bytes, so the write loop's "waited on the lane"
/// is always this message's own wait. (It used to be a side queue pushed
/// after the channel send; a write that finished first popped nothing, the
/// late push stayed behind, and from then on every message reported the
/// enqueue time of the one before it: the gap between messages, not a wait.)
pub struct BulkFrame {
    pub queued_at: Instant,
    pub data: Vec<u8>,
    /// The join (by number) whose first chunk LOAD this is: its write
    /// completes that join's trace. `None` for every other message.
    pub completes_join: Option<u32>,
}

impl WsSender {
    pub fn new(
        control: mpsc::UnboundedSender<Vec<u8>>,
        bulk: mpsc::UnboundedSender<BulkFrame>,
    ) -> Self {
        Self {
            control,
            bulk,
            control_depth: Arc::new(AtomicUsize::new(0)),
            bulk_depth: Arc::new(AtomicUsize::new(0)),
            control_queued: Arc::new(AtomicU64::new(0)),
            control_written: Arc::new(AtomicU64::new(0)),
            join_trace: JoinTrace::default(),
            close_code: Arc::new(AtomicU16::new(0)),
            rtc: Arc::default(),
        }
    }

    /// Route this socket's unreliable traffic through `rtc` from now on.
    pub fn attach_rtc(&self, rtc: mpsc::UnboundedSender<Vec<u8>>) {
        *self
            .rtc
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(rtc);
    }

    /// Stop using `rtc`, if it is still the attached channel: a channel that
    /// fails after a newer one was attached must not take the newer one
    /// with it.
    pub fn detach_rtc(&self, rtc: &mpsc::UnboundedSender<Vec<u8>>) {
        let mut slot = self
            .rtc
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if slot
            .as_ref()
            .is_some_and(|current| current.same_channel(rtc))
        {
            *slot = None;
        }
    }

    /// The attached WebRTC channel, if one is open.
    pub fn rtc(&self) -> Option<mpsc::UnboundedSender<Vec<u8>>> {
        self.rtc
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
            .filter(|rtc| !rtc.is_closed())
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

    /// The timing of this session's joins.
    pub fn join_trace(&self) -> &JoinTrace {
        &self.join_trace
    }

    /// Send on the control lane (default). Reliable-ordered within the lane.
    pub fn send(&self, data: Vec<u8>) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.send_control(data).map(|_| ())
    }

    /// Send on the control lane; returns the message's position in the lane.
    fn send_control(&self, data: Vec<u8>) -> Result<u64, mpsc::error::SendError<Vec<u8>>> {
        self.control_depth.fetch_add(1, Ordering::Relaxed);
        let seq = self.control_queued.fetch_add(1, Ordering::Relaxed) + 1;
        if let Err(error) = self.control.send(data) {
            self.control_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(error);
        }
        Ok(seq)
    }

    /// Send a join's INIT on the control lane, marking its position so the
    /// write loop can stamp when it is written.
    pub(crate) fn send_init(&self, data: Vec<u8>) {
        if let Ok(seq) = self.send_control(data) {
            self.join_trace.init_queued(seq);
            // The write loop may have written it already.
            self.join_trace
                .control_written(self.control_written.load(Ordering::Relaxed));
        }
    }

    /// Send on the bulk lane (chunk data, voxel updates). Reliable-ordered
    /// within the lane, but drained only when the control lane is empty.
    pub fn send_bulk(&self, data: Vec<u8>) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.send_bulk_frame(data, None)
    }

    /// Send join `join`'s first chunk LOAD on the bulk lane (see
    /// [`JoinTrace::first_load_sent`]).
    pub(crate) fn send_first_load(
        &self,
        data: Vec<u8>,
        join: u32,
    ) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.send_bulk_frame(data, Some(join))
    }

    fn send_bulk_frame(
        &self,
        data: Vec<u8>,
        completes_join: Option<u32>,
    ) -> Result<(), mpsc::error::SendError<Vec<u8>>> {
        self.bulk_depth.fetch_add(1, Ordering::Relaxed);
        let frame = BulkFrame {
            queued_at: Instant::now(),
            data,
            completes_join,
        };
        if let Err(mpsc::error::SendError(frame)) = self.bulk.send(frame) {
            self.bulk_depth.fetch_sub(1, Ordering::Relaxed);
            return Err(mpsc::error::SendError(frame.data));
        }
        Ok(())
    }

    pub fn mark_control_written(&self) {
        self.control_depth.fetch_sub(1, Ordering::Relaxed);
        let written = self.control_written.fetch_add(1, Ordering::Relaxed) + 1;
        self.join_trace.control_written(written);
    }

    /// The write loop finished writing one bulk-lane message.
    pub fn mark_bulk_written(&self) {
        self.bulk_depth.fetch_sub(1, Ordering::Relaxed);
    }

    /// Bulk-lane backlog (observability for the chunk-send log).
    pub fn bulk_len(&self) -> usize {
        self.bulk_depth.load(Ordering::Relaxed)
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

#[cfg(test)]
mod lane_tests {
    use super::*;

    /// The write loop can take a message off the bulk lane before
    /// `send_bulk` has even returned. Each message's wait must still be its
    /// own: with the stamp kept beside the channel, a writer that won that
    /// race popped nothing, and every later message reported the gap since
    /// the one before it (seconds of "waiting" on an idle lane).
    #[tokio::test]
    async fn a_writer_that_drains_before_send_returns_still_reads_each_messages_own_wait() {
        let (control_tx, _control_rx) = mpsc::unbounded_channel();
        let (bulk_tx, mut bulk_rx) = mpsc::unbounded_channel();
        let sender = WsSender::new(control_tx, bulk_tx);

        // A writer spinning on the lane, the way an idle socket loop is
        // parked on it: it drains each message the instant it lands.
        let writer_sender = sender.clone();
        let is_done = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let writer_done = is_done.clone();
        let writer = tokio::task::spawn_blocking(move || {
            let mut waits = vec![];
            loop {
                match bulk_rx.try_recv() {
                    Ok(frame) => {
                        waits.push(frame.queued_at.elapsed());
                        writer_sender.mark_bulk_written();
                    }
                    Err(_) if writer_done.load(Ordering::Relaxed) => return waits,
                    Err(_) => std::hint::spin_loop(),
                }
            }
        });

        const MESSAGES: usize = 10;
        const GAP: Duration = Duration::from_millis(100);
        for _ in 0..MESSAGES {
            sender.send_bulk(vec![0u8; 16]).unwrap();
            tokio::time::sleep(GAP).await;
        }
        assert_eq!(sender.bulk_len(), 0, "every message was written");
        is_done.store(true, Ordering::Relaxed);

        let waits = writer.await.unwrap();
        assert_eq!(waits.len(), MESSAGES);
        for wait in waits {
            assert!(
                wait < GAP / 2,
                "a message on an idle lane reported waiting {wait:?}, about the {GAP:?} gap \
                 between sends"
            );
        }
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
    /// Digest of the block registry the client kept from an earlier INIT
    /// (that INIT's `registryDigest`). When it names this server's registry,
    /// the INIT leaves the block definitions out. Absent for clients that
    /// keep nothing, which get the full INIT as before.
    #[serde(default)]
    registry_digest: Option<String>,
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
        json!(server
            .sessions
            .values()
            .filter(|session| session.world.is_none())
            .count()),
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

    // `connections` (client id -> one world) predates an id being in several
    // worlds at once; `memberships` lists every (id, world) pair.
    let mut connections = HashMap::new();
    let mut memberships = vec![];

    for session in server.sessions.values() {
        if let Some(world) = &session.world {
            connections.insert(session.id.to_owned(), json!(world));
            memberships.push(json!({ "id": session.id, "world": world }));
        }
    }

    info.insert("connections".to_owned(), json!(connections));
    info.insert("memberships".to_owned(), json!(memberships));

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

/// One client socket registered with the server.
pub struct Session {
    /// The client id the socket acts as (from the session authenticator).
    pub id: String,
    pub sender: WsSender,
    /// The world the socket is in; `None` until it joins one, and again
    /// after it leaves.
    pub world: Option<String>,
    /// Verified identity, handed to the world on join so game code can read
    /// the session's claims from the `SessionIdentities` resource.
    pub identity: SessionIdentity,
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

    /// Secret transport servers must present instead of the join secret.
    /// `None` checks transports against the join secret alone.
    pub transport_secret: Option<String>,

    /// Adapter hook deciding who a connecting socket is (see
    /// [`SessionAuthenticator`]). `None` falls back to trusting the client's
    /// requested id, which is only safe off the public internet.
    pub session_authenticator: Option<SessionAuthenticator>,

    /// The game's check on every inbound `Method` call (see [`MethodGuard`]),
    /// installed in and audited against each world this server adds. `None`
    /// hands every call to its handler unchecked.
    pub method_guard: Option<Arc<dyn MethodGuard>>,

    /// Which live world handles which method, shared with every world this
    /// server adds, so a call to a world without that method is answered
    /// with the worlds that have it.
    method_index: MethodIndex,

    /// A map of all the worlds.
    pub worlds: HashMap<String, Addr<SyncWorld>>,

    /// Per-world inbound state buffers. Peer position packets are pushed here
    /// directly instead of through the world's actor mailbox, so the world can
    /// apply them at the start of its next tick — before the system dispatch —
    /// regardless of how Tick and request messages interleave in mailboxes.
    world_inbound_state: HashMap<String, Arc<InboundStateBuffer>>,

    /// Registry of the server.
    pub registry: Registry,

    /// The registry as INIT carries it, serialized once on the first join
    /// and shared by every world this server adds.
    init_registry: SharedInitRegistry,

    /// Every registered client socket, pre-join and in-world, keyed by its
    /// connection token. One client id may hold several sockets, one per
    /// world: a second socket joining a world the id is already in replaces
    /// the first there (see [`Server::on_join`]).
    pub sessions: HashMap<String, Session>,

    /// Transport sessions, not connected to any particular world.
    pub transport_sessions: HashMap<String, WsSender>,

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

    /// The server's one copy of the registry text INIT carries (shared by
    /// every world it adds), for serving it outside a world: the runtime
    /// builds it at boot and serves it over HTTP.
    pub(crate) fn shared_init_registry(&self) -> SharedInitRegistry {
        self.init_registry.clone()
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
        world.share_init_registry(&self.init_registry);
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

        if let Some(guard) = &self.method_guard {
            guard.audit(&world);
            world.set_method_guard(Arc::clone(guard));
        }

        let methods = world.method_names();
        world.ecs_mut().insert(self.method_index.clone());

        let addr = world.start();

        if self.worlds.insert(name.clone(), addr).is_some() {
            return Err(AddWorldError);
        }
        self.method_index.record(&name, methods);
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
        let session_token = match self.resolve_session(id, session_token) {
            Ok(token) => token,
            Err(error) => return Some(error),
        };

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

            let Some(token) = session_token else {
                return Some(format!(
                    "Client {} has no registered session; reconnect before joining.",
                    id
                ));
            };
            return self.on_join(&token, json);
        } else if data.r#type == MessageType::Leave as i32 {
            // Only the world this socket is in: a stale LEAVE for a world it
            // has already switched out of must not pull it out of the new one.
            let session = session_token
                .as_deref()
                .and_then(|token| self.sessions.get_mut(token))
                .filter(|session| session.world.as_deref() == Some(data.text.as_str()));
            if let Some(session) = session {
                session.world = None;
                if let Some(world) = self.worlds.get_mut(&data.text) {
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

        let world_name = session_token
            .as_deref()
            .and_then(|token| self.sessions.get(token))
            .and_then(|session| session.world.clone());
        let Some(world_name) = world_name else {
            return Some("You are not connected to a world!".to_owned());
        };

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

    /// Which registered socket a message from `id` belongs to.
    ///
    /// - A token naming a live session of `id` is that session.
    /// - A token naming no live session, while `id` still holds others, is a
    ///   socket a newer one replaced: refused.
    /// - No token (a secondary lane that cannot name its socket) resolves
    ///   only when `id` holds exactly one session.
    ///
    /// `Ok(None)` means `id` holds no client session at all (transports, or
    /// a socket that was never registered).
    fn resolve_session(&self, id: &str, token: Option<&str>) -> Result<Option<String>, String> {
        if let Some(token) = token {
            if self
                .sessions
                .get(token)
                .is_some_and(|session| session.id == id)
            {
                return Ok(Some(token.to_owned()));
            }
            if self.sessions.values().any(|session| session.id == id) {
                perf::log("session_superseded", "server", json!({ "clientId": id }));
                return Err(
                    "Session superseded by a newer connection with the same client id.".to_owned(),
                );
            }
            return Ok(None);
        }

        let mut tokens = self
            .sessions
            .iter()
            .filter(|(_, session)| session.id == id)
            .map(|(token, _)| token);
        match (tokens.next(), tokens.next()) {
            (None, _) => Ok(None),
            (Some(token), None) => Ok(Some(token.clone())),
            (Some(_), Some(_)) => Err(format!(
                "Client {} has sessions in several worlds; this message names none of them.",
                id
            )),
        }
    }

    /// The token of `id`'s session in `world`, if it has one.
    fn member_token(&self, id: &str, world: &str) -> Option<String> {
        self.sessions
            .iter()
            .find(|(_, session)| session.id == id && session.world.as_deref() == Some(world))
            .map(|(token, _)| token.clone())
    }

    /// The socket and token of `id`'s session in `world`: the lane a
    /// secondary channel (WebRTC) opened for that world attaches to.
    pub(crate) fn world_session(
        &self,
        id: &str,
        world: Option<&str>,
    ) -> Option<(WsSender, String)> {
        let token = match world {
            Some(world) => self.member_token(id, world)?,
            None => self.resolve_session(id, None).ok().flatten()?,
        };
        let session = self.sessions.get(&token)?;
        Some((session.sender.clone(), token))
    }

    /// Whether `id` has a session in `world`.
    pub fn is_in_world(&self, id: &str, world: &str) -> bool {
        self.member_token(id, world).is_some()
    }

    /// Whether `id` has a registered socket that has not joined a world.
    pub fn has_pending_session(&self, id: &str) -> bool {
        self.sessions
            .values()
            .any(|session| session.id == id && session.world.is_none())
    }

    /// Handle a JOIN request. JOIN is reliable control-plane (see
    /// `world::replication`) and must be IDEMPOTENT: the acknowledgement (the
    /// INIT message) can be delayed or lost, and clients retry. A retry from
    /// the current session must replay the acknowledgement, never produce a
    /// fatal error — a fatal error here is what caused live
    /// join -> ack unanswered -> retry -> "already in world" -> disconnect
    /// loops in live deployments.
    fn on_join(&mut self, token: &str, json: OnJoinRequest) -> Option<String> {
        let Some(session) = self.sessions.get(token) else {
            return Some("Session has no registration; reconnect before joining.".to_owned());
        };
        let id = session.id.clone();
        let id = id.as_str();
        let sender = session.sender.clone();
        let current_world = session.world.clone();
        let preferences = json
            .flat_preferences
            .merge(json.preferences.unwrap_or_default());
        let motion_protocol = MotionProtocol::negotiate(&json.capabilities);
        // A verified display name outranks whatever the JOIN payload claims;
        // an unverified session keeps the client's own username.
        let identity = session.identity.clone();
        let username = identity
            .username
            .clone()
            .unwrap_or_else(|| json.username.clone());

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
                sender.request_close(PROTOCOL_MISMATCH_CLOSE_CODE);
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

        let is_replay = current_world.as_deref() == Some(json.world.as_str());
        // Another socket of this id already in the target world: this one
        // takes its place there. Sockets of the id in other worlds stay.
        let replaced = if is_replay {
            None
        } else {
            self.member_token(id, &json.world)
        };

        // Per-world join cap. An idempotent replay of an existing membership,
        // or a socket taking over its id's own place, is not a new occupant,
        // so both are exempt; a fresh join or a switch into a full world is
        // rejected with typed backpressure before any world-side state
        // changes.
        if !is_replay && replaced.is_none() {
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

        if is_replay {
            // Idempotent replay: this session already joined this world.
            // Re-issue the join; the world-side handler replays the INIT
            // ack without creating a duplicate entity.
            perf::log(
                "client_join_replayed",
                &json.world,
                json!({ "clientId": id }),
            );
            info!("Replaying JOIN ack for {} in world {}", id, json.world);
            sender.join_trace().forwarded(id, &json.world);
            let world = self.worlds.get_mut(&json.world).unwrap();
            world.do_send(ClientJoinRequest {
                id: id.to_owned(),
                username,
                sender,
                preferences,
                motion_protocol,
                identity,
                registry_digest: json.registry_digest,
            });
            return None;
        }

        if let Some(replaced) = replaced {
            if let Some(old) = self.sessions.remove(&replaced) {
                info!(
                    "Kicking duplicate session of {} in world {}",
                    id, json.world
                );
                let _ = old.sender.send(encode_message(
                    &Message::new(&MessageType::Error)
                        .text("Another session connected with your account.")
                        .build(),
                ));
            }
            // Same mailbox as the join below, so the old membership is gone
            // before the new one is made.
            if let Some(world) = self.worlds.get_mut(&json.world) {
                world.do_send(ClientLeaveRequest { id: id.to_owned() });
            }
            perf::log("session_replaced", &json.world, json!({ "clientId": id }));
        }

        if let Some(old_world) = &current_world {
            // Session is in a different world: switch atomically — leave the
            // old world, then join below. The two messages share the
            // target/source world mailboxes, so ordering per world is
            // preserved.
            if let Some(old) = self.worlds.get_mut(old_world) {
                old.do_send(ClientLeaveRequest { id: id.to_owned() });
            }
            info!(
                "Client {} switching worlds: {} -> {}",
                id, old_world, json.world
            );
        }

        sender.join_trace().forwarded(id, &json.world);
        let world = self.worlds.get_mut(&json.world).unwrap();
        world.do_send(ClientJoinRequest {
            id: id.to_owned(),
            username,
            sender,
            preferences,
            motion_protocol,
            identity,
            registry_digest: json.registry_digest,
        });
        if let Some(session) = self.sessions.get_mut(token) {
            session.world = Some(json.world);
        }
        None
    }

    /// Register a new session. Returns (client_id, connection_token); the
    /// token authenticates this specific socket for the rest of its life so a
    /// superseded socket cannot act on its replacement's registration.
    ///
    /// Nothing is kicked here: one id may hold a socket in each of several
    /// worlds, so a duplicate is only known once this socket joins a world
    /// the id is already in ([`Server::on_join`]).
    ///
    /// The identity comes from the session authenticator, never from the
    /// client directly: an `identity.id` of `None` mints a fresh id.
    pub(crate) fn register_session(
        &mut self,
        identity: SessionIdentity,
        is_transport: bool,
        sender: WsSender,
    ) -> (String, String) {
        let id = identity.id.clone().unwrap_or_else(|| nanoid!());
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

        self.sessions.insert(
            token.clone(),
            Session {
                id: id.clone(),
                sender,
                world: None,
                identity: SessionIdentity {
                    id: Some(id.clone()),
                    ..identity
                },
            },
        );

        (id, token)
    }

    /// Deterministically release a disconnected session's registration and
    /// world membership. Token-checked so a stale disconnect from a kicked
    /// socket cannot remove its replacement's state.
    pub(crate) fn unregister_session(&mut self, id: &str, token: &str) {
        if self
            .sessions
            .get(token)
            .is_some_and(|session| session.id == id)
        {
            let session = self.sessions.remove(token).unwrap();
            if let Some(world_name) = session.world {
                if let Some(world) = self.worlds.get_mut(&world_name) {
                    world.do_send(ClientLeaveRequest { id: id.to_owned() });
                }
            }
        } else if self.sessions.values().any(|session| session.id == id) {
            info!("Ignoring stale disconnect for {} (token mismatch)", id);
        }

        if self.transport_sessions.remove(id).is_some() {
            self.worlds.values_mut().for_each(|world| {
                world.do_send(TransportLeaveRequest { id: id.to_owned() });
            });

            info!("A transport server connection has ended.")
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

                let _ = world.try_send(Tick::now());

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
        let period = Duration::from_millis(self.interval);
        let scheduled_at = Instant::now();
        for world in self.worlds.values_mut() {
            let _ = world.try_send(Tick::scheduled(scheduled_at, period));
        }
    }

    /// Install the process logger (see [`crate::logging`]): Info by default,
    /// `VOXELIZE_LOG` / `RUST_LOG` to override, written off the world threads.
    fn setup_logger() {
        crate::logging::setup_logger();
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
        // This thread (the System arbiter) runs the tick timer below and
        // forwards every world's Tick, so it gets the same OS priority as the
        // world threads; a tick that leaves late starts late.
        crate::world::shared_pools::raise_to_tick_tier();
        self.actor_started_at = Some(Instant::now());
        if debug_pause_ticks_from_env() {
            self.debug_pause_ticks = true;
        }
        if let Some(after) = debug_pause_ticks_after_from_env() {
            self.debug_pause_ticks_after = Some(after);
        }

        let period = Duration::from_millis(self.interval);
        // actix re-arms the interval from its previous deadline, so its slots
        // sit on a fixed grid starting one period after this instant. Each
        // Tick carries the slot it was sent for; the world measures its
        // lateness (timer delay + actor hop + mailbox wait) against it.
        let grid_origin = Instant::now();
        ctx.run_interval(period, move |act, ctx| {
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

            let now = Instant::now();
            let period_nanos = period.as_nanos().max(1);
            let slots = now.saturating_duration_since(grid_origin).as_nanos() / period_nanos;
            let scheduled_at = grid_origin
                + Duration::from_nanos((slots * period_nanos).min(u64::MAX as u128) as u64);

            for (world_name, world) in worlds_to_tick {
                act.send_world_tick(ctx, world_name, world, scheduled_at, period);
            }
        });
    }
}

impl Server {
    /// Send one world its Tick for `scheduled_at`. When the tick comes back
    /// after its next slot has already passed, the next one goes out at once
    /// rather than waiting for the timer's next slot: a 17 ms tick is
    /// followed after 17 ms, not after 32.
    fn send_world_tick(
        &mut self,
        ctx: &mut Context<Self>,
        world_name: String,
        world: Addr<SyncWorld>,
        scheduled_at: Instant,
        period: Duration,
    ) {
        self.pending_world_ticks.insert(world_name.clone());
        ctx.spawn(
            wrap_future(world.send(Tick::scheduled(scheduled_at, period))).map(
                move |result, act: &mut Server, ctx: &mut Context<Server>| {
                    act.pending_world_ticks.remove(&world_name);
                    match result {
                        Ok(()) => {
                            act.last_tick_at = Some(Instant::now());
                        }
                        Err(error) => {
                            warn!("World tick failed for {}: {:?}", world_name, error);
                            return;
                        }
                    }
                    let now = Instant::now();
                    let is_behind = now >= scheduled_at + period;
                    if !is_behind
                        || act.debug_pause_ticks
                        || !crate::world::perf_toggles::perf_toggle(
                            crate::world::perf_toggles::PerfToggle::CatchUpLateTicks,
                        )
                    {
                        return;
                    }
                    // Only a world still registered under this name is
                    // re-ticked; a torn-down or replaced one is left alone.
                    let Some(current) = act.worlds.get(&world_name).cloned() else {
                        return;
                    };
                    if current != world {
                        return;
                    }
                    // Due now: its lateness is then the hop alone, not the
                    // overrun that made it late.
                    act.send_world_tick(ctx, world_name, current, now, period);
                },
            ),
        );
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
