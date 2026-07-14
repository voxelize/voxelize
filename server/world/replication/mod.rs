//! State replication: the engine's networking split between reliable events
//! and latest-wins state.
//!
//! Every piece of data a Voxelize world sends to (or receives from) a client
//! belongs to exactly one of two channels. Picking the right one is a
//! correctness decision, not an optimization:
//!
//! ## 1. Reliable ordered events (must-deliver)
//!
//! Chat messages, voxel/block updates, chunk loads, entity CREATE / DELETE /
//! OUT_OF_RANGE transitions, join/leave notifications, method results and
//! custom events are *facts*. Every one of them must reach the client exactly
//! once and in order — a client that misses an entity CREATE never renders the
//! entity, a client that misses a DELETE keeps a ghost forever. These flow
//! through [`crate::MessageQueues`] / [`crate::EncodedMessageQueue`] and are
//! drained FIFO by the broadcast system. They are never dropped.
//!
//! ## 2. Unreliable latest-wins state (drop-old-ok)
//!
//! Entity positions/metadata deltas and peer (player) positions/metadata are
//! *samples of a continuously changing value*. An old sample is garbage the
//! instant a newer one exists: replaying it makes remote entities walk through
//! their own past, which the player perceives as lag followed by a teleport
//! (rubber-banding). The correct queueing model for this channel is a single
//! latest-value slot per client, per item, overwritten in place:
//!
//! - staging a newer value **overwrites** the pending one — never appends;
//! - the structure is **bounded** by (clients x items in interest), and a hard
//!   per-client cap backstops that bound;
//! - flushing ships the current snapshot and leaves nothing behind;
//! - when a client's socket is backed up, flushing is **skipped** for that
//!   client while its slots keep coalescing, so the moment the socket drains
//!   it receives one current snapshot instead of a replay of stale frames.
//!
//! DO NOT "fix" this back into a FIFO. A queue of positional states is a queue
//! of lies: everything except the newest element misrepresents where the
//! entity actually is. If you need guaranteed delivery for a new kind of data,
//! it is an *event* — route it through [`crate::MessageQueues`] instead.
//!
//! The same logic applies inbound: a client's own position packets are state,
//! so [`InboundStateBuffer`] hands them to the world for application at the
//! start of the tick — before the system dispatch — so AI/pathfinding systems
//! always read current-tick player positions instead of positions from a
//! packet that is still sitting in an actor mailbox.

mod interest;

pub use interest::*;

use std::sync::Mutex;

use hashbrown::HashMap;

use crate::{server::Message, EntityProtocol, PeerProtocol};

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

/// How many perf trace ids a client's slot set remembers between flushes.
const MAX_PENDING_TRACE_IDS: usize = 8;

/// Latest-wins slots for one client. One slot per replicated item; staging a
/// newer value overwrites the pending one in place.
#[derive(Default)]
struct ClientStateSlots {
    /// entity id -> newest pending entity UPDATE for this client.
    entities: HashMap<String, EntityProtocol>,
    /// peer id -> newest pending peer snapshot for this client.
    peers: HashMap<String, PeerProtocol>,
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
    /// Perf trace ids coalesced into this flush (newest last).
    pub trace_ids: Vec<String>,
}

/// The outbound half of the latest-wins state channel: per-client, per-item
/// latest-value slots for all high-frequency replicated state (entity updates,
/// peer positions/metadata). See the module docs for why this must never
/// become a FIFO.
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

    /// Stage the newest pending UPDATE for `(client, entity)`, overwriting any
    /// undelivered older value. Keep-alives (updates with no metadata) never
    /// clobber a pending metadata-bearing update — that would silently discard
    /// state the client has not received yet.
    ///
    /// Lifecycle operations (CREATE / DELETE / OUT_OF_RANGE) are reliable
    /// events, not state: route them through [`crate::MessageQueues`] and call
    /// [`Self::clear_entity`] so a stale pending update cannot be flushed
    /// after the transition and resurrect a released entity.
    pub fn stage_entity_update(&mut self, client_id: &str, update: EntityProtocol) {
        let slots = self.clients.entry(client_id.to_owned()).or_default();
        match slots.entities.get_mut(&update.id) {
            Some(pending) => {
                if update.metadata.is_none() && pending.metadata.is_some() {
                    return;
                }
                *pending = update;
            }
            None => {
                if slots.len() >= MAX_STATE_SLOTS_PER_CLIENT {
                    self.dropped_updates += 1;
                    return;
                }
                slots.entities.insert(update.id.clone(), update);
            }
        }
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

    /// Drop the pending update slot for `(client, entity)`. Must be called
    /// when an entity lifecycle transition (DELETE / OUT_OF_RANGE) is queued
    /// for the client, so state that predates the transition is never sent
    /// after it.
    pub fn clear_entity(&mut self, client_id: &str, entity_id: &str) {
        if let Some(slots) = self.clients.get_mut(client_id) {
            slots.entities.remove(entity_id);
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

    /// Drop everything pending for a disconnected client.
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

    /// Take the client's current snapshot for sending, leaving its slots
    /// empty. Returns `None` when there is nothing pending.
    pub fn drain_client(&mut self, client_id: &str) -> Option<ClientStateFlush> {
        let slots = self.clients.get_mut(client_id)?;
        if slots.is_empty() {
            return None;
        }
        Some(ClientStateFlush {
            entities: slots.entities.drain().map(|(_, update)| update).collect(),
            peers: slots.peers.drain().map(|(_, peer)| peer).collect(),
            trace_ids: std::mem::take(&mut slots.trace_ids),
        })
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
    use crate::EntityOperation;

    fn update(id: &str, metadata: Option<&str>) -> EntityProtocol {
        EntityProtocol {
            operation: EntityOperation::Update,
            id: id.to_owned(),
            r#type: "bot".to_owned(),
            metadata: metadata.map(str::to_owned),
        }
    }

    fn peer(id: &str, metadata: &str) -> PeerProtocol {
        PeerProtocol {
            id: id.to_owned(),
            username: id.to_owned(),
            metadata: metadata.to_owned(),
        }
    }

    #[test]
    fn newer_entity_state_overwrites_pending_state() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_entity_update("client", update("bot", Some("old")));
        buffer.stage_entity_update("client", update("bot", Some("new")));

        let flush = buffer.drain_client("client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("new"));
        assert!(buffer.drain_client("client").is_none());
    }

    #[test]
    fn keep_alive_never_clobbers_pending_metadata() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_entity_update("client", update("bot", Some("pos")));
        buffer.stage_entity_update("client", update("bot", None));

        let flush = buffer.drain_client("client").unwrap();
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("pos"));
    }

    #[test]
    fn keep_alive_fills_an_empty_slot() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_entity_update("client", update("bot", None));

        let flush = buffer.drain_client("client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert!(flush.entities[0].metadata.is_none());
    }

    #[test]
    fn lifecycle_clear_prevents_stale_state_after_release() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_entity_update("client", update("bot", Some("stale")));
        buffer.clear_entity("client", "bot");

        assert!(buffer.drain_client("client").is_none());
    }

    #[test]
    fn newer_peer_state_overwrites_pending_state() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_peer_update("client", peer("friend", "old"));
        buffer.stage_peer_update("client", peer("friend", "new"));

        let flush = buffer.drain_client("client").unwrap();
        assert_eq!(flush.peers.len(), 1);
        assert_eq!(flush.peers[0].metadata, "new");
    }

    #[test]
    fn departed_peer_state_is_cleared_everywhere() {
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_peer_update("a", peer("gone", "pos"));
        buffer.stage_peer_update("b", peer("gone", "pos"));
        buffer.remove_peer("gone");

        assert!(buffer.drain_client("a").is_none());
        assert!(buffer.drain_client("b").is_none());
    }

    #[test]
    fn slot_cap_bounds_the_buffer_and_counts_drops() {
        let mut buffer = ReplicatedStateBuffer::new();
        for i in 0..MAX_STATE_SLOTS_PER_CLIENT {
            buffer.stage_entity_update("client", update(&format!("bot-{}", i), Some("m")));
        }
        buffer.stage_entity_update("client", update("one-too-many", Some("m")));

        assert_eq!(buffer.total_pending(), MAX_STATE_SLOTS_PER_CLIENT);
        assert_eq!(buffer.dropped_updates(), 1);

        // Overwriting an existing slot is always allowed at the cap.
        buffer.stage_entity_update("client", update("bot-0", Some("newer")));
        assert_eq!(buffer.total_pending(), MAX_STATE_SLOTS_PER_CLIENT);
        assert_eq!(buffer.dropped_updates(), 1);
    }

    #[test]
    fn coalescing_survives_a_gated_flush() {
        // A gated client's slots persist and keep coalescing; the next
        // successful flush carries the newest snapshot only.
        let mut buffer = ReplicatedStateBuffer::new();
        buffer.stage_entity_update("client", update("bot", Some("tick-1")));
        // Flush gated: nothing drained. Newer state arrives.
        buffer.stage_entity_update("client", update("bot", Some("tick-2")));
        buffer.stage_entity_update("client", update("bot", Some("tick-3")));

        let flush = buffer.drain_client("client").unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].metadata.as_deref(), Some("tick-3"));
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
