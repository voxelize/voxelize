//! State replication: the engine's networking split between reliable events
//! and latest-wins state.
//!
//! Every piece of data a Voxelize world sends to (or receives from) a client
//! belongs to exactly one of these channels. Picking the right one is a
//! correctness decision, not an optimization. The taxonomy follows what
//! production engines converged on (TRIBES' stream managers, Halo's
//! replication priorities, Unreal's replication graph — see
//! `notes/entity-motion-replication.md` for the full design rationale):
//!
//! ## 1. Reliable ordered events (must-deliver)
//!
//! Chat messages, voxel/block updates, chunk loads, entity CREATE / DELETE /
//! OUT_OF_RANGE transitions, join/leave notifications, method results and
//! custom events are *facts*. Every one of them must reach the client exactly
//! once and in order — a client that misses an entity CREATE never renders the
//! entity, a client that misses a DELETE keeps a ghost forever. These flow
//! through [`crate::MessageQueues`] / [`crate::EncodedMessageQueue`] and are
//! drained FIFO by the broadcast system. They are never dropped, budgeted or
//! reordered.
//!
//! Session control-plane traffic (JOIN, its INIT acknowledgement, LEAVE,
//! disconnect cleanup) is the most reliable-ordered of all: it is never
//! gated, never coalesced, and — because acks can be delayed or lost and
//! clients retry — JOIN handling is IDEMPOTENT end to end (`Server::on_join`
//! replays into `World::add_client`, which refreshes the live session instead
//! of creating a duplicate entity).
//!
//! ## 2. Unreliable latest-wins state (drop-old-ok)
//!
//! Entity motion/metadata and peer (player) positions/metadata are *samples
//! of a continuously changing value*. An old sample is garbage the instant a
//! newer one exists: replaying it makes remote entities walk through their
//! own past, which the player perceives as lag followed by a teleport
//! (rubber-banding). The correct queueing model for this channel is a single
//! latest-value slot per client, per item, overwritten in place.
//!
//! Within this channel, entity state is split into two lanes with different
//! freshness contracts:
//!
//! - the MOTION lane carries the animation-critical transforms every moving
//!   entity produces each tick (position, direction, rigid-body fluid state,
//!   look-at target). Its service-level agreement is WALL-CLOCK: a pending
//!   motion slot must flush within [`crate::WorldConfig::entity_motion_max_age_ms`]
//!   milliseconds (proximity-scaled — nearer entities get a tighter bound,
//!   see [`motion_max_age_for`]), no matter how many other slots are pending
//!   and no matter how far the tick rate sags. To make that affordable,
//!   motion encodes compactly ([`QuantizedMotion`]) for clients that
//!   negotiated the versioned compact path, and quantization doubles as
//!   change detection so sub-visual jitter never stages an update at all.
//! - the METADATA lane carries everything else in an entity's metadata map
//!   (paths, text, game JSON). It changes rarely, tolerates more latency
//!   ([`METADATA_MAX_AGE_MS`]), and stays JSON.
//!
//! Flushing is scheduled EARLIEST-DEADLINE-FIRST under a DYNAMIC byte budget
//! ([`state_flush_budget`]): every slot carries the wall-clock deadline its
//! lane's max age implies, overdue slots always ship (the freshness
//! guarantee), and the remaining budget fills in deadline order. The budget
//! expands while the client's socket is healthy and clamps proportionally as
//! its control-lane backlog grows; only a genuinely backed-up socket
//! (backlog beyond [`STATE_FLUSH_MAX_SOCKET_BACKLOG`]) suspends flushing
//! entirely, during which slots keep coalescing to their newest value so the
//! moment the socket drains the client receives one current snapshot instead
//! of a replay of stale frames.
//!
//! DO NOT "fix" this back into a FIFO, and DO NOT schedule it by tick counts:
//! a queue of positional states is a queue of lies, and tick-counted ages
//! silently stretch exactly when the server is struggling and freshness
//! matters most. If you need guaranteed delivery for a new kind of data, it
//! is an *event* — route it through [`crate::MessageQueues`] instead.
//!
//! The same logic applies inbound: a client's own position packets are state,
//! so [`InboundStateBuffer`] hands them to the world for application at the
//! start of the tick — before the system dispatch — so AI/pathfinding systems
//! always read current-tick player positions instead of positions from a
//! packet that is still sitting in an actor mailbox.

mod interest;
mod motion;

pub use interest::*;
pub use motion::*;

use std::sync::Mutex;

use hashbrown::HashMap;

use crate::{server::Message, EntityOperation, EntityProtocol, PeerProtocol};

/// How many messages may sit unread in a client's WebSocket channel before the
/// state flush for that client is skipped for the tick. Reliable events are
/// unaffected (they must queue); state simply keeps coalescing in its slots
/// and the client receives one fresh snapshot once the socket drains. A small
/// value keeps a slow client's view of the world *current* instead of
/// *complete-but-late*.
pub const STATE_FLUSH_MAX_SOCKET_BACKLOG: usize = 8;

/// Hard cap on latest-value slots per client. The structure is already bounded
/// by the client's interest set, so this is a backstop against pathological
/// interest sizes; overflowing entity updates are dropped (the keep-alive
/// cycle re-sends them) and a counter is exposed through perf tracing.
pub const MAX_STATE_SLOTS_PER_CLIENT: usize = 8192;

/// Hard cap on inbound state packets buffered per client between ticks. At a
/// 16ms tick and a typical 20-60Hz client send rate this holds 1-4 entries;
/// the cap only bites on a misbehaving client, where dropping the *oldest*
/// packets is safe because newer ones supersede them.
pub const MAX_PENDING_INBOUND_PER_CLIENT: usize = 64;

/// Wall-clock max age of a pending METADATA-lane slot. Metadata is
/// low-frequency (paths, text, game JSON), so it tolerates more staleness
/// than motion, but it is still bounded — a changed path must not hide
/// behind a busy motion lane forever.
pub const METADATA_MAX_AGE_MS: u64 = 250;

/// Budget expansion factor for a client whose socket backlog is zero. The
/// budget exists to protect the socket; when the socket is demonstrably
/// keeping up there is no reason to ration freshness.
const HEALTHY_BUDGET_EXPANSION: f64 = 4.0;

/// The tick duration the base byte budget is defined against.
const BUDGET_REFERENCE_TICK_MS: f64 = 16.0;

/// Cap on how much a sagging tick can scale a single flush's budget, so one
/// multi-second hitch cannot produce an arbitrarily large frame.
const MAX_BUDGET_TICK_SCALE: f64 = 4.0;

/// How many perf trace ids a client's slot set remembers between flushes.
const MAX_PENDING_TRACE_IDS: usize = 8;

/// Upper edges (ms) of the motion-gap histogram buckets, sized to resolve the
/// freshness targets that matter (one tick, ~two ticks, 50, 75, 100, 150ms…).
const GAP_BUCKET_EDGES_MS: [u64; 9] = [17, 34, 50, 75, 100, 150, 250, 500, 1000];

/// Proximity-scaled motion max age: the nearest entities refresh twice as
/// fast as the configured bound, scaling linearly out to the full bound at
/// (and beyond) the visible radius. Distance modulates PRIORITY, never
/// eligibility — the far edge still holds the configured wall-clock bound.
pub fn motion_max_age_for(base_max_age_ms: u64, distance_sq: f32, visible_radius: f32) -> u64 {
    if visible_radius <= 0.0 {
        return base_max_age_ms;
    }
    let ratio = (distance_sq.max(0.0).sqrt() / visible_radius).min(1.0);
    let half = base_max_age_ms as f64 / 2.0;
    (half + half * ratio as f64).round() as u64
}

/// Per-client flush budget in (approximate payload) bytes, derived from the
/// socket's live state. Returns `None` when the socket is genuinely backed
/// up and the flush must be skipped for the tick.
///
/// - backlog 0: the socket drained everything we gave it — expand.
/// - backlog 1..=[`STATE_FLUSH_MAX_SOCKET_BACKLOG`]: clamp proportionally.
/// - beyond: gate. Slots keep coalescing; nothing stale is ever replayed.
///
/// `tick_ms` scales the budget by the wall-clock the flush covers, so a
/// sagging tick rate does not silently shrink the byte RATE exactly when
/// freshness pressure is highest (capped at [`MAX_BUDGET_TICK_SCALE`]).
pub fn state_flush_budget(
    base_bytes_per_tick: usize,
    tick_ms: f64,
    backlog: usize,
) -> Option<usize> {
    if backlog > STATE_FLUSH_MAX_SOCKET_BACKLOG {
        return None;
    }
    let tick_scale = (tick_ms / BUDGET_REFERENCE_TICK_MS).clamp(1.0, MAX_BUDGET_TICK_SCALE);
    let pressure_factor = HEALTHY_BUDGET_EXPANSION / (1.0 + backlog as f64);
    Some((base_bytes_per_tick as f64 * tick_scale * pressure_factor) as usize)
}

/// One pending latest-value slot for one (client, entity): the newest
/// undelivered motion payload and/or metadata JSON, plus the scheduling facts
/// the earliest-deadline-first flush needs.
struct EntitySlot {
    etype: String,
    /// Newest pending compact motion payload (compact-protocol clients).
    motion: Option<Vec<u8>>,
    /// Newest pending metadata JSON (full map for legacy clients, non-motion
    /// subset for compact clients).
    metadata: Option<String>,
    /// Whether this slot carries motion-fresh content: a compact payload, or
    /// a legacy full-JSON snapshot staged because motion changed. Gap
    /// telemetry is recorded only for motion-carrying flushes.
    is_motion_fresh: bool,
    /// Squared client-to-entity distance at the newest staging (flush
    /// tiebreak: nearer first).
    distance_sq: f32,
    /// Wall-clock ms at which the oldest still-pending content of this slot
    /// exceeds its lane's max age. Coalescing takes the MINIMUM of the old
    /// and new deadlines, so a slot's place in the schedule only ever moves
    /// earlier — no amount of newer traffic can starve it.
    deadline_ms: u64,
}

impl EntitySlot {
    fn wire_cost(&self, id: &str) -> usize {
        id.len()
            + self.etype.len()
            + self.metadata.as_ref().map_or(0, String::len)
            + self.motion.as_ref().map_or(0, Vec::len)
            + 8
    }
}

#[derive(Default)]
struct MotionGapHistogram {
    buckets: [u32; GAP_BUCKET_EDGES_MS.len() + 1],
    count: u64,
    max_ms: u64,
    window_started_ms: u64,
}

impl MotionGapHistogram {
    fn record(&mut self, gap_ms: u64) {
        let bucket = GAP_BUCKET_EDGES_MS
            .iter()
            .position(|edge| gap_ms <= *edge)
            .unwrap_or(GAP_BUCKET_EDGES_MS.len());
        self.buckets[bucket] += 1;
        self.count += 1;
        self.max_ms = self.max_ms.max(gap_ms);
    }

    fn quantile_upper_bound_ms(&self, quantile: f64) -> u64 {
        if self.count == 0 {
            return 0;
        }
        let rank = (self.count as f64 * quantile).ceil() as u64;
        let mut seen = 0u64;
        for (bucket, edge) in GAP_BUCKET_EDGES_MS.iter().enumerate() {
            seen += self.buckets[bucket] as u64;
            if seen >= rank {
                return *edge;
            }
        }
        self.max_ms
    }
}

/// Aggregated wall-clock motion-gap distribution for one client over one
/// reporting window: how long each tracked entity's consecutive
/// motion-carrying flushes were apart. Quantiles are bucket upper bounds
/// (conservative), the max is exact.
pub struct MotionGapReport {
    pub count: u64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub max_ms: u64,
}

/// Latest-wins slots for one client. One slot per replicated item; staging a
/// newer value overwrites the pending one in place.
#[derive(Default)]
struct ClientStateSlots {
    /// entity id -> newest pending entity state for this client.
    entities: HashMap<String, EntitySlot>,
    /// peer id -> newest pending peer snapshot for this client.
    peers: HashMap<String, PeerProtocol>,
    /// entity id -> wall-clock ms of the last motion-carrying flush, for gap
    /// telemetry. Bounded by the client's interest set; entries are removed
    /// with [`ReplicatedStateBuffer::clear_entity`].
    last_motion_sent_ms: HashMap<String, u64>,
    gaps: MotionGapHistogram,
    /// Perf trace ids of the staging batches coalesced into these slots.
    trace_ids: Vec<String>,
}

impl ClientStateSlots {
    fn len(&self) -> usize {
        self.entities.len() + self.peers.len()
    }

    fn is_empty(&self) -> bool {
        self.entities.is_empty() && self.peers.is_empty()
    }
}

/// Everything pending for one client at flush time: the current snapshot of
/// all state that changed since the client's last successful flush.
pub struct ClientStateFlush {
    pub entities: Vec<EntityProtocol>,
    pub peers: Vec<PeerProtocol>,
    /// How many entity updates were overdue (past their lane deadline) and
    /// shipped outside the budget.
    pub forced_count: usize,
    /// How many entity updates carried motion-fresh content.
    pub motion_count: usize,
    /// Perf trace ids coalesced into this flush (newest last).
    pub trace_ids: Vec<String>,
}

/// The outbound half of the latest-wins state channel: per-client, per-item
/// latest-value slots for all high-frequency replicated state (entity motion
/// and metadata, peer positions/metadata). See the module docs for why this
/// must never become a FIFO.
#[derive(Default)]
pub struct ReplicatedStateBuffer {
    clients: HashMap<String, ClientStateSlots>,
    /// Cumulative count of updates dropped by the per-client slot cap.
    dropped_updates: u64,
    /// Number of clients whose flush was skipped last tick (socket backlog).
    gated_clients_last_flush: usize,
}

impl ReplicatedStateBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    fn slot_mut<'a>(
        clients: &'a mut HashMap<String, ClientStateSlots>,
        dropped_updates: &mut u64,
        client_id: &str,
        entity_id: &str,
        etype: &str,
        distance_sq: f32,
        deadline_ms: u64,
    ) -> Option<&'a mut EntitySlot> {
        let slots = clients.entry(client_id.to_owned()).or_default();
        if !slots.entities.contains_key(entity_id) && slots.len() >= MAX_STATE_SLOTS_PER_CLIENT {
            *dropped_updates += 1;
            return None;
        }
        let slot = slots
            .entities
            .entry(entity_id.to_owned())
            .or_insert_with(|| EntitySlot {
                etype: etype.to_owned(),
                motion: None,
                metadata: None,
                is_motion_fresh: false,
                distance_sq,
                deadline_ms,
            });
        slot.distance_sq = distance_sq;
        slot.deadline_ms = slot.deadline_ms.min(deadline_ms);
        Some(slot)
    }

    /// Stage the newest compact motion payload for `(client, entity)`,
    /// overwriting any undelivered older one. `max_age_ms` is the
    /// proximity-scaled wall-clock bound this payload must flush within
    /// (see [`motion_max_age_for`]).
    pub fn stage_motion(
        &mut self,
        client_id: &str,
        entity_id: &str,
        etype: &str,
        payload: Vec<u8>,
        distance_sq: f32,
        now_ms: u64,
        max_age_ms: u64,
    ) {
        let deadline = now_ms + max_age_ms;
        if let Some(slot) = Self::slot_mut(
            &mut self.clients,
            &mut self.dropped_updates,
            client_id,
            entity_id,
            etype,
            distance_sq,
            deadline,
        ) {
            slot.motion = Some(payload);
            slot.is_motion_fresh = true;
        }
    }

    /// Stage the newest metadata JSON for `(client, entity)`, overwriting any
    /// undelivered older one. `is_motion_fresh` marks a legacy full-map
    /// snapshot staged because the entity's MOTION changed: it schedules
    /// under the motion lane's max age (`max_age_ms`) instead of the
    /// metadata lane's, so pinned legacy clients get the same freshness
    /// guarantee as compact ones, just with a fatter encoding.
    pub fn stage_metadata(
        &mut self,
        client_id: &str,
        entity_id: &str,
        etype: &str,
        json: String,
        is_motion_fresh: bool,
        distance_sq: f32,
        now_ms: u64,
        max_age_ms: u64,
    ) {
        let deadline = now_ms + max_age_ms;
        if let Some(slot) = Self::slot_mut(
            &mut self.clients,
            &mut self.dropped_updates,
            client_id,
            entity_id,
            etype,
            distance_sq,
            deadline,
        ) {
            slot.metadata = Some(json);
            slot.is_motion_fresh = slot.is_motion_fresh || is_motion_fresh;
        }
    }

    /// Stage a keep-alive for `(client, entity)`: a payload-less update that
    /// only refreshes client-side liveness. Never clobbers a pending slot —
    /// that would silently discard state the client has not received yet.
    pub fn stage_keep_alive(
        &mut self,
        client_id: &str,
        entity_id: &str,
        etype: &str,
        distance_sq: f32,
        now_ms: u64,
    ) {
        let slots = self.clients.entry(client_id.to_owned()).or_default();
        if slots.entities.contains_key(entity_id) {
            return;
        }
        if slots.len() >= MAX_STATE_SLOTS_PER_CLIENT {
            self.dropped_updates += 1;
            return;
        }
        slots.entities.insert(
            entity_id.to_owned(),
            EntitySlot {
                etype: etype.to_owned(),
                motion: None,
                metadata: None,
                is_motion_fresh: false,
                distance_sq,
                deadline_ms: now_ms + METADATA_MAX_AGE_MS,
            },
        );
    }

    /// Stage the newest snapshot of a peer for a client, overwriting any
    /// undelivered older one. Peer metadata is always a full snapshot, so
    /// overwriting is lossless by construction.
    pub fn stage_peer_update(&mut self, client_id: &str, peer: PeerProtocol) {
        let slots = self.clients.entry(client_id.to_owned()).or_default();
        if !slots.peers.contains_key(&peer.id) && slots.len() >= MAX_STATE_SLOTS_PER_CLIENT {
            self.dropped_updates += 1;
            return;
        }
        slots.peers.insert(peer.id.clone(), peer);
    }

    /// Remember a perf trace id for the staging batch that just wrote into a
    /// client's slots, so the flush event can be correlated with its queue
    /// event(s) in the `TOWN_PERF_LOG` stream.
    pub fn note_trace_id(&mut self, client_id: &str, trace_id: String) {
        let slots = self.clients.entry(client_id.to_owned()).or_default();
        if slots.trace_ids.len() >= MAX_PENDING_TRACE_IDS {
            slots.trace_ids.remove(0);
        }
        slots.trace_ids.push(trace_id);
    }

    /// Drop the pending slot and telemetry entry for `(client, entity)`. Must
    /// be called when an entity lifecycle transition (DELETE / OUT_OF_RANGE)
    /// is queued for the client, so state that predates the transition is
    /// never sent after it and cannot resurrect a released entity.
    pub fn clear_entity(&mut self, client_id: &str, entity_id: &str) {
        if let Some(slots) = self.clients.get_mut(client_id) {
            slots.entities.remove(entity_id);
            slots.last_motion_sent_ms.remove(entity_id);
        }
    }

    /// Drop pending peer snapshots of a departed peer from every client's
    /// slots. The reliable LEAVE event is what removes the peer client-side;
    /// state staged before it must not be delivered after it.
    pub fn remove_peer(&mut self, peer_id: &str) {
        for slots in self.clients.values_mut() {
            slots.peers.remove(peer_id);
        }
    }

    /// Drop everything pending for a disconnected (or re-initialized) client.
    pub fn remove_client(&mut self, client_id: &str) {
        self.clients.remove(client_id);
    }

    /// Whether the client has any undelivered state pending.
    pub fn has_pending(&self, client_id: &str) -> bool {
        self.clients
            .get(client_id)
            .map(|slots| !slots.is_empty())
            .unwrap_or(false)
    }

    /// Take the client's pending state for sending, EARLIEST DEADLINE FIRST
    /// under `budget_bytes` of approximate payload:
    ///
    /// - every slot past its deadline ships regardless of the budget — that
    ///   is the wall-clock freshness guarantee, and its volume is inherently
    ///   bounded (each entity can go overdue at most once per its max age);
    /// - the remaining budget fills with the slots closest to their
    ///   deadlines (nearest entity first, then id, as deterministic
    ///   tiebreaks); slots that do not fit stay pending and keep coalescing;
    /// - if nothing fits at all, the most urgent slot ships anyway so the
    ///   rotation always makes progress.
    ///
    /// Peer snapshots are few and latency-critical, so they always flush in
    /// full. Returns `None` when nothing is pending.
    pub fn drain_client(
        &mut self,
        client_id: &str,
        now_ms: u64,
        budget_bytes: usize,
    ) -> Option<ClientStateFlush> {
        let slots = self.clients.get_mut(client_id)?;
        if slots.is_empty() {
            return None;
        }

        let mut order: Vec<(u64, f32, &String)> = slots
            .entities
            .iter()
            .map(|(id, slot)| (slot.deadline_ms, slot.distance_sq, id))
            .collect();
        order.sort_unstable_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
                .then_with(|| left.2.cmp(right.2))
        });

        let mut selected: Vec<String> = Vec::new();
        let mut forced_count = 0usize;
        let mut bytes = 0usize;
        for (deadline_ms, _, id) in order {
            let cost = slots.entities[id].wire_cost(id);
            if deadline_ms <= now_ms {
                forced_count += 1;
            } else if bytes + cost > budget_bytes && !selected.is_empty() {
                // Over budget: skip, but keep scanning — a smaller slot
                // further down may still fit. When NOTHING has shipped yet,
                // fall through and ship the most urgent slot anyway so the
                // rotation always makes progress.
                continue;
            }
            bytes += cost;
            selected.push(id.clone());
        }

        let mut motion_count = 0usize;
        let entities: Vec<EntityProtocol> = selected
            .into_iter()
            .filter_map(|id| {
                let slot = slots.entities.remove(&id)?;
                if slot.is_motion_fresh {
                    motion_count += 1;
                    if let Some(previous) = slots.last_motion_sent_ms.insert(id.clone(), now_ms) {
                        slots.gaps.record(now_ms.saturating_sub(previous));
                    }
                }
                Some(EntityProtocol {
                    operation: EntityOperation::Update,
                    id,
                    r#type: slot.etype,
                    metadata: slot.metadata,
                    motion: slot.motion,
                })
            })
            .collect();

        Some(ClientStateFlush {
            entities,
            peers: slots.peers.drain().map(|(_, peer)| peer).collect(),
            forced_count,
            motion_count,
            trace_ids: std::mem::take(&mut slots.trace_ids),
        })
    }

    /// Take the client's motion-gap distribution when at least
    /// `min_window_ms` has elapsed since the last report. Returns `None`
    /// while the window is still filling or when no gaps were recorded.
    pub fn take_motion_gap_report(
        &mut self,
        client_id: &str,
        now_ms: u64,
        min_window_ms: u64,
    ) -> Option<MotionGapReport> {
        let slots = self.clients.get_mut(client_id)?;
        if slots.gaps.window_started_ms == 0 {
            slots.gaps.window_started_ms = now_ms;
            return None;
        }
        if now_ms.saturating_sub(slots.gaps.window_started_ms) < min_window_ms {
            return None;
        }
        let gaps = std::mem::take(&mut slots.gaps);
        slots.gaps.window_started_ms = now_ms;
        if gaps.count == 0 {
            return None;
        }
        Some(MotionGapReport {
            count: gaps.count,
            p50_ms: gaps.quantile_upper_bound_ms(0.50),
            p95_ms: gaps.quantile_upper_bound_ms(0.95),
            p99_ms: gaps.quantile_upper_bound_ms(0.99),
            max_ms: gaps.max_ms,
        })
    }

    /// Entity slots still pending for a client after a (budgeted) flush.
    pub fn pending_entities(&self, client_id: &str) -> usize {
        self.clients
            .get(client_id)
            .map(|slots| slots.entities.len())
            .unwrap_or(0)
    }

    /// Total pending latest-value slots across all clients. Bounded by
    /// (clients x interest set size); exposed through `core_tick` perf
    /// tracing so regressions toward unbounded queueing are visible.
    pub fn total_pending(&self) -> usize {
        self.clients.values().map(ClientStateSlots::len).sum()
    }

    pub fn dropped_updates(&self) -> u64 {
        self.dropped_updates
    }

    pub fn set_gated_clients(&mut self, gated: usize) {
        self.gated_clients_last_flush = gated;
    }

    pub fn gated_clients(&self) -> usize {
        self.gated_clients_last_flush
    }
}

/// The inbound half of the state channel: peer (client position) packets
/// staged by the network layer and applied by the world at the start of every
/// tick, *before* the system dispatch.
///
/// Why this exists: peer packets used to be applied whenever their actor
/// message happened to be handled, which could be *after* the tick that should
/// have observed them — AI systems (target selection, pathfinding) would then
/// read the player's previous position and walk bots toward where the player
/// used to be. Staging packets here and draining at tick start makes the
/// ordering deterministic: every packet that arrived before the tick began is
/// visible to every system in that tick.
///
/// Packets are kept per client in arrival order (a client may send partial
/// updates, so intermediate packets cannot be coalesced away server-side), but
/// the buffer is hard-bounded: beyond [`MAX_PENDING_INBOUND_PER_CLIENT`] the
/// oldest packets are dropped, which is safe because newer state supersedes
/// older state.
#[derive(Default)]
pub struct InboundStateBuffer {
    pending: Mutex<InboundPending>,
}

#[derive(Default)]
struct InboundPending {
    per_client: HashMap<String, Vec<Message>>,
    dropped: u64,
}

impl InboundStateBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Stage an inbound peer/state packet from the network layer. Callable
    /// from any thread.
    pub fn push(&self, client_id: &str, message: Message) {
        let mut pending = self.pending.lock().unwrap();
        let pending = &mut *pending;
        let queue = pending.per_client.entry(client_id.to_owned()).or_default();
        if queue.len() >= MAX_PENDING_INBOUND_PER_CLIENT {
            queue.remove(0);
            pending.dropped += 1;
        }
        queue.push(message);
    }

    /// Take every staged packet, grouped per client in arrival order. Called
    /// by the world at the start of each tick (and before handling any other
    /// client request, to preserve state-before-command ordering per client).
    pub fn drain(&self) -> Vec<(String, Vec<Message>)> {
        let mut pending = self.pending.lock().unwrap();
        if pending.per_client.is_empty() {
            return Vec::new();
        }
        pending.per_client.drain().collect()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.lock().unwrap().per_client.is_empty()
    }

    /// Cumulative count of packets dropped by the per-client cap.
    pub fn dropped_total(&self) -> u64 {
        self.pending.lock().unwrap().dropped
    }

    /// Drop staged packets of a disconnected client.
    pub fn remove_client(&self, client_id: &str) {
        self.pending.lock().unwrap().per_client.remove(client_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOTION_SLA: u64 = 100;

    fn peer(id: &str, metadata: &str) -> PeerProtocol {
        PeerProtocol {
            id: id.to_owned(),
            username: id.to_owned(),
            metadata: metadata.to_owned(),
        }
    }

    fn stage_motion(
        buffer: &mut ReplicatedStateBuffer,
        client: &str,
        entity: &str,
        payload: &[u8],
        now_ms: u64,
    ) {
        buffer.stage_motion(
            client,
            entity,
            "bot",
            payload.to_vec(),
            0.0,
            now_ms,
            MOTION_SLA,
        );
    }

    fn stage_metadata(
        buffer: &mut ReplicatedStateBuffer,
        client: &str,
        entity: &str,
        json: &str,
        now_ms: u64,
    ) {
        buffer.stage_metadata(
            client,
            entity,
            "bot",
            json.to_owned(),
            false,
            0.0,
            now_ms,
            METADATA_MAX_AGE_MS,
        );
    }

    fn drain_all(buffer: &mut ReplicatedStateBuffer, client: &str) -> Option<ClientStateFlush> {
        buffer.drain_client(client, u64::MAX / 2, usize::MAX)
    }

    #[test]
    fn newer_motion_overwrites_pending_motion() {
        let mut buffer = ReplicatedStateBuffer::new();
        stage_motion(&mut buffer, "client", "bot", &[1], 0);
        stage_motion(&mut buffer, "client", "bot", &[2], 16);

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].motion.as_deref(), Some(&[2][..]));
        assert!(drain_all(&mut buffer, "client").is_none());
    }

    #[test]
    fn motion_and_metadata_coalesce_into_one_update() {
        let mut buffer = ReplicatedStateBuffer::new();
        stage_motion(&mut buffer, "client", "bot", &[7], 0);
        stage_metadata(&mut buffer, "client", "bot", "{\"path\":1}", 0);

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].motion.as_deref(), Some(&[7][..]));
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("{\"path\":1}"));
        assert_eq!(flush.motion_count, 1);
    }

    #[test]
    fn keep_alive_never_clobbers_pending_state() {
        let mut buffer = ReplicatedStateBuffer::new();
        stage_metadata(&mut buffer, "client", "bot", "pos", 0);
        buffer.stage_keep_alive("client", "bot", "bot", 0.0, 16);

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("pos"));
    }

    #[test]
    fn keep_alive_fills_an_empty_slot() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_keep_alive("client", "bot", "bot", 0.0, 0);

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert!(flush.entities[0].metadata.is_none());
        assert!(flush.entities[0].motion.is_none());
    }

    #[test]
    fn lifecycle_clear_prevents_stale_state_after_release() {
        let mut buffer = ReplicatedStateBuffer::new();
        stage_motion(&mut buffer, "client", "bot", &[1], 0);
        stage_metadata(&mut buffer, "client", "bot", "stale", 0);
        buffer.clear_entity("client", "bot");

        assert!(drain_all(&mut buffer, "client").is_none());
    }

    #[test]
    fn newer_peer_state_overwrites_pending_state() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_peer_update("client", peer("friend", "old"));
        buffer.stage_peer_update("client", peer("friend", "new"));

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.peers.len(), 1);
        assert_eq!(flush.peers[0].metadata, "new");
    }

    #[test]
    fn departed_peer_state_is_cleared_everywhere() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_peer_update("a", peer("gone", "pos"));
        buffer.stage_peer_update("b", peer("gone", "pos"));
        buffer.remove_peer("gone");

        assert!(drain_all(&mut buffer, "a").is_none());
        assert!(drain_all(&mut buffer, "b").is_none());
    }

    #[test]
    fn slot_cap_bounds_the_buffer_and_counts_drops() {
        let mut buffer = ReplicatedStateBuffer::new();
        for i in 0..MAX_STATE_SLOTS_PER_CLIENT {
            stage_metadata(&mut buffer, "client", &format!("bot-{}", i), "m", 0);
        }
        stage_metadata(&mut buffer, "client", "one-too-many", "m", 0);

        assert_eq!(buffer.total_pending(), MAX_STATE_SLOTS_PER_CLIENT);
        assert_eq!(buffer.dropped_updates(), 1);

        // Overwriting an existing slot is always allowed at the cap.
        stage_metadata(&mut buffer, "client", "bot-0", "newer", 0);
        assert_eq!(buffer.total_pending(), MAX_STATE_SLOTS_PER_CLIENT);
        assert_eq!(buffer.dropped_updates(), 1);
    }

    #[test]
    fn coalescing_survives_a_gated_flush() {
        // A gated client's slots persist and keep coalescing; the next
        // successful flush carries the newest snapshot only.
        let mut buffer = ReplicatedStateBuffer::new();
        stage_metadata(&mut buffer, "client", "bot", "tick-1", 0);
        stage_metadata(&mut buffer, "client", "bot", "tick-2", 16);
        stage_metadata(&mut buffer, "client", "bot", "tick-3", 32);

        let flush = drain_all(&mut buffer, "client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("tick-3"));
    }

    #[test]
    fn overdue_slots_ship_regardless_of_budget() {
        let mut buffer = ReplicatedStateBuffer::new();
        for i in 0..50 {
            stage_motion(&mut buffer, "client", &format!("bot-{:02}", i), &[0; 20], 0);
        }

        // Well past every slot's deadline, a one-byte budget still ships all.
        let flush = buffer.drain_client("client", MOTION_SLA + 1, 1).unwrap();
        assert_eq!(flush.entities.len(), 50);
        assert_eq!(flush.forced_count, 50);
        assert_eq!(buffer.pending_entities("client"), 0);
    }

    #[test]
    fn budget_fills_earliest_deadline_first_and_keeps_the_rest_pending() {
        let mut buffer = ReplicatedStateBuffer::new();
        // Metadata staged earlier has an earlier deadline than newer motion
        // only if its lane bound expires sooner; here all are motion, staged
        // at increasing times.
        for i in 0..10u64 {
            stage_motion(
                &mut buffer,
                "client",
                &format!("bot-{}", i),
                &[0; 20],
                i * 10,
            );
        }

        // Nothing overdue yet; budget fits roughly four slots (cost = id(5) +
        // type(3) + motion(20) + 8 = 36).
        let flush = buffer.drain_client("client", 5, 4 * 36).unwrap();
        assert_eq!(flush.forced_count, 0);
        let ids: Vec<&str> = flush.entities.iter().map(|u| u.id.as_str()).collect();
        assert_eq!(ids, vec!["bot-0", "bot-1", "bot-2", "bot-3"]);
        assert_eq!(buffer.pending_entities("client"), 6);
    }

    #[test]
    fn nearest_entity_wins_deadline_ties() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_motion("client", "far", "bot", vec![0; 8], 900.0, 0, MOTION_SLA);
        buffer.stage_motion("client", "near", "bot", vec![0; 8], 1.0, 0, MOTION_SLA);

        let flush = buffer.drain_client("client", 5, 24).unwrap();
        assert_eq!(flush.entities[0].id, "near");
        assert_eq!(buffer.pending_entities("client"), 1);
    }

    #[test]
    fn coalescing_never_pushes_a_deadline_later() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_motion("client", "old-timer", "bot", vec![1], 500.0, 0, MOTION_SLA);
        buffer.stage_motion("client", "newcomer", "bot", vec![1], 1.0, 50, MOTION_SLA);
        // The old slot coalesces at t=50 but keeps its t=100 deadline, so it
        // still flushes before the newcomer (deadline t=150) despite being
        // farther away.
        buffer.stage_motion("client", "old-timer", "bot", vec![2], 500.0, 50, MOTION_SLA);

        let flush = buffer.drain_client("client", 60, 24).unwrap();
        assert_eq!(flush.entities[0].id, "old-timer");
        assert_eq!(flush.entities[0].motion.as_deref(), Some(&[2][..]));
    }

    #[test]
    fn an_oversized_urgent_slot_still_makes_progress() {
        let mut buffer = ReplicatedStateBuffer::new();
        stage_metadata(&mut buffer, "client", "heavy", &"x".repeat(1000), 0);

        let flush = buffer.drain_client("client", 5, 10).unwrap();
        assert_eq!(flush.entities.len(), 1);
    }

    #[test]
    fn budget_expands_when_healthy_and_clamps_under_backpressure() {
        let base = 24 * 1024;
        assert_eq!(state_flush_budget(base, 16.0, 0), Some(base * 4));
        assert_eq!(state_flush_budget(base, 16.0, 1), Some(base * 2));
        assert_eq!(state_flush_budget(base, 16.0, 3), Some(base));
        let degraded = state_flush_budget(base, 16.0, 8).unwrap();
        assert!(
            degraded < base / 2,
            "expected a hard clamp, got {}",
            degraded
        );
        assert_eq!(state_flush_budget(base, 16.0, 9), None);
    }

    #[test]
    fn budget_scales_with_wall_clock_tick_duration() {
        let base = 1000;
        let healthy_16ms = state_flush_budget(base, 16.0, 0).unwrap();
        let healthy_48ms = state_flush_budget(base, 48.0, 0).unwrap();
        assert_eq!(healthy_48ms, healthy_16ms * 3);
        // A multi-second hitch cannot produce an arbitrarily large budget.
        let capped = state_flush_budget(base, 5000.0, 0).unwrap();
        assert_eq!(capped, healthy_16ms * 4);
        // A fast tick never shrinks the budget below its reference size.
        assert_eq!(state_flush_budget(base, 4.0, 0), Some(healthy_16ms));
    }

    #[test]
    fn proximity_tightens_the_motion_max_age_but_never_extends_it() {
        let base = 100;
        let radius = 384.0;
        assert_eq!(motion_max_age_for(base, 0.0, radius), 50);
        assert_eq!(motion_max_age_for(base, radius * radius, radius), 100);
        assert_eq!(
            motion_max_age_for(base, radius * radius * 100.0, radius),
            100
        );
        let mid = motion_max_age_for(base, (radius / 2.0) * (radius / 2.0), radius);
        assert_eq!(mid, 75);
    }

    #[test]
    fn a_150_mover_scene_meets_the_wall_clock_sla_even_when_ticks_sag() {
        // The perceptual regression that killed the previous design: 150
        // entities moving every tick, a budget too small to flush them all,
        // and a tick rate that sags mid-run. The deadline scheduler must
        // bound every entity's wall-clock refresh gap at the SLA plus one
        // tick, no matter the tick duration.
        const ENTITIES: usize = 150;
        let payload = vec![0u8; 20];
        let mut buffer = ReplicatedStateBuffer::new();
        let mut last_flushed: HashMap<String, u64> = HashMap::new();
        let mut max_gap = 0u64;
        let mut now_ms = 0u64;
        let mut worst_flush_bytes = 0usize;

        // A budget deliberately too small to flush the whole scene per tick
        // (~39 of 150 slots fit), so the deadline rotation has to do the
        // work.
        let budget = 1500;

        for step in 0..600u64 {
            // Ticks run at 16ms, then sag to 50ms for a stretch.
            let tick_ms = if (200..300).contains(&step) { 50 } else { 16 };
            now_ms += tick_ms;

            for i in 0..ENTITIES {
                let distance_sq = (i * i) as f32;
                let max_age = motion_max_age_for(100, distance_sq, 384.0);
                buffer.stage_motion(
                    "client",
                    &format!("bot-{:03}", i),
                    "bot",
                    payload.clone(),
                    distance_sq,
                    now_ms,
                    max_age,
                );
            }
            assert!(buffer.total_pending() <= ENTITIES);

            let flush = buffer.drain_client("client", now_ms, budget).unwrap();
            let bytes: usize = flush
                .entities
                .iter()
                .map(|u| {
                    u.id.len()
                        + u.r#type.len()
                        + u.metadata.as_ref().map_or(0, String::len)
                        + u.motion.as_ref().map_or(0, Vec::len)
                        + 8
                })
                .sum();
            worst_flush_bytes = worst_flush_bytes.max(bytes);

            for update in &flush.entities {
                if let Some(previous) = last_flushed.insert(update.id.clone(), now_ms) {
                    if step > 10 {
                        max_gap = max_gap.max(now_ms - previous);
                    }
                }
            }
        }

        assert_eq!(last_flushed.len(), ENTITIES);
        // SLA (far edge 100ms) plus one sagged tick of slack.
        assert!(
            max_gap <= 100 + 50,
            "wall-clock motion gap exceeded the SLA: {}ms",
            max_gap
        );
        // The scene is small enough for the compact encoding that the budget
        // never needed to be exceeded by much: every flush stayed bounded.
        assert!(
            worst_flush_bytes <= budget + ENTITIES * 44,
            "flush ballooned to {} bytes",
            worst_flush_bytes
        );

        // Entities that stop changing are not re-staged and go silent.
        while buffer.drain_client("client", now_ms, budget).is_some() {
            now_ms += 16;
        }
        assert_eq!(buffer.pending_entities("client"), 0);
    }

    #[test]
    fn motion_gap_report_aggregates_send_gaps() {
        let mut buffer = ReplicatedStateBuffer::new();
        assert!(buffer.take_motion_gap_report("client", 0, 5000).is_none());

        stage_motion(&mut buffer, "client", "bot", &[1], 0);
        // First report call opens the window.
        buffer.drain_client("client", 16, usize::MAX);
        assert!(buffer.take_motion_gap_report("client", 16, 5000).is_none());

        for step in 1..=10u64 {
            stage_motion(&mut buffer, "client", "bot", &[1], step * 16);
            buffer.drain_client("client", step * 16 + 16, usize::MAX);
        }

        let report = buffer.take_motion_gap_report("client", 6000, 5000).unwrap();
        assert_eq!(report.count, 10);
        assert!(report.p50_ms <= 17);
        assert!(report.max_ms <= 17);

        // The window resets after a report.
        assert!(buffer
            .take_motion_gap_report("client", 6001, 5000)
            .is_none());
    }

    #[test]
    fn inbound_buffer_preserves_arrival_order_and_caps() {
        let buffer = InboundStateBuffer::new();
        for i in 0..(MAX_PENDING_INBOUND_PER_CLIENT + 3) {
            buffer.push(
                "client",
                Message {
                    tick: i as u64,
                    ..Default::default()
                },
            );
        }

        let drained = buffer.drain();
        assert_eq!(drained.len(), 1);
        let (client_id, messages) = &drained[0];
        assert_eq!(client_id, "client");
        assert_eq!(messages.len(), MAX_PENDING_INBOUND_PER_CLIENT);
        // The three oldest packets were dropped; order is preserved.
        assert_eq!(messages.first().unwrap().tick, 3);
        assert_eq!(
            messages.last().unwrap().tick,
            (MAX_PENDING_INBOUND_PER_CLIENT + 2) as u64
        );
        assert_eq!(buffer.dropped_total(), 3);
        assert!(buffer.is_empty());
    }
}
