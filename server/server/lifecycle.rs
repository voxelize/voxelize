//! Runtime world lifecycle: create, destroy, list/query, capacity, pooling,
//! and garbage-collection of empty worlds.
//!
//! The tick loop, join resolution, and world map all live inside the [`Server`]
//! actix actor, so the world map cannot be mutated from outside the actor.
//! Every lifecycle operation is therefore an actor message with a `Handler`
//! returning a typed result — never an external `&mut` method. Teardown is a
//! message *to* a world (never an external `RwLock` grab) so it runs FIFO after
//! any in-flight tick on the world's own thread, never mid-borrow.
//!
//! The engine knows exactly one noun: `world`. Games compose higher-level
//! concepts on top by driving these messages; the engine never learns what a
//! world represents.

use std::sync::Arc;
use std::time::{Duration, Instant};

use actix::fut::wrap_future;
use actix::{
    ActorFutureExt, Addr, AsyncContext, Context, Handler, Message as ActixMessage, MessageResult,
    SpawnHandle,
};
use log::info;

use crate::{
    perf, InboundStateBuffer, ResetWorld, Server, SyncWorld, Teardown, World, WorldConfig,
};

/// Immutable, cheaply-cloneable descriptor of a live world, snapshotted at
/// query time. The authoritative player count lives in the world; this is a
/// server-side snapshot derived from the connection registry.
#[derive(Clone)]
pub struct WorldHandle {
    pub name: String,
    pub addr: Addr<SyncWorld>,
    /// Lifetime = `Instant::now() - created_at`.
    pub created_at: Instant,
    pub player_count: usize,
    pub gc_policy: GcPolicy,
}

/// Per-world garbage-collection policy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GcPolicy {
    /// Never reaped. Static startup worlds use this.
    Never,
    /// Reaped `grace` after the last player leaves; cancelled if a player
    /// rejoins within `grace`. A world that has never been occupied is not
    /// reaped — reaping keys off the *last leave*, not creation.
    WhenEmpty { grace: Duration },
}

/// Live-vs-cap snapshot.
#[derive(Clone, Copy, Debug)]
pub struct Capacity {
    /// Current world count (static + dynamic).
    pub live: usize,
    /// Hard ceiling from [`ServerBuilder::max_worlds`]. `usize::MAX` when
    /// unbounded (no builder call).
    pub cap: usize,
}

/// Typed, exhaustive failure mode for every lifecycle op. No panics, no
/// strings-as-errors on the lifecycle path.
#[derive(Debug, thiserror::Error)]
pub enum WorldLifecycleError {
    #[error("world '{0}' already exists")]
    DuplicateName(String),
    #[error("world capacity reached ({live}/{cap})")]
    CapacityReached { live: usize, cap: usize },
    #[error("world '{0}' not found")]
    NotFound(String),
    #[error("world '{0}' is being torn down")]
    TeardownInFlight(String),
    #[error("invalid world config: {0}")]
    InvalidConfig(String),
}

/// Warm pool for the many-small-worlds use case: worlds kept ready so
/// `CreateWorld` reuses a warm slot instead of paying ECS / chunk allocation on
/// the hot path.
#[derive(Clone)]
pub struct PoolConfig {
    /// Maximum number of warm slots retained for reuse.
    pub prealloc: usize,
    /// How a slot is made clean for reuse.
    pub reset: ResetPolicy,
}

/// How a pooled slot is made clean for reuse.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ResetPolicy {
    /// Drop + rebuild the world on reuse. Safest — no state can leak across
    /// reuse, since a fresh `World` is built each time.
    Rebuild,
    /// Reuse the warm `SyncWorld` actor, clearing ECS + inbound state via a
    /// reset pass. Faster; gated by the no-leak reuse test.
    ReuseWarm,
}

/// Structural fingerprint of a [`WorldConfig`]: the fields that determine ECS /
/// chunk allocation. A warm slot may only be reused for a config with the same
/// fingerprint, so reuse can never hand back a differently-shaped world.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ConfigFingerprint {
    chunk_size: usize,
    sub_chunks: usize,
    min_chunk: [i32; 2],
    max_chunk: [i32; 2],
    max_height: usize,
    max_light_level: u32,
    saving: bool,
}

impl ConfigFingerprint {
    pub(crate) fn of(config: &WorldConfig) -> Self {
        Self {
            chunk_size: config.chunk_size,
            sub_chunks: config.sub_chunks,
            min_chunk: config.min_chunk,
            max_chunk: config.max_chunk,
            max_height: config.max_height,
            max_light_level: config.max_light_level,
            saving: config.saving,
        }
    }
}

/// Server-side bookkeeping for a live world. Held alongside the world's actor
/// address so lifecycle, capacity, and GC decisions never need an actor
/// round-trip.
pub(crate) struct WorldEntry {
    pub(crate) created_at: Instant,
    pub(crate) gc_policy: GcPolicy,
    /// Per-world join cap (`usize::MAX` = unbounded).
    pub(crate) max_clients: usize,
    pub(crate) peak_players: usize,
    /// Armed GC timer, if this world is empty and awaiting reap.
    pub(crate) gc_handle: Option<SpawnHandle>,
    pub(crate) config_fingerprint: ConfigFingerprint,
    /// Whether this world runs the deterministic fixed-step tick. Cached from
    /// `config.fixed_timestep.is_some()` so join resolution can decide whether
    /// to enforce the strict protocol assert without an actor round-trip.
    pub(crate) is_deterministic: bool,
}

impl WorldEntry {
    /// Entry for a startup / static world: never reaped.
    pub(crate) fn static_world(config: &WorldConfig) -> Self {
        Self {
            created_at: Instant::now(),
            gc_policy: GcPolicy::Never,
            max_clients: config.max_clients,
            peak_players: 0,
            gc_handle: None,
            config_fingerprint: ConfigFingerprint::of(config),
            is_deterministic: config.fixed_timestep.is_some(),
        }
    }
}

/// A warm, dormant world retained for reuse.
pub(crate) struct PooledSlot {
    pub(crate) addr: Addr<SyncWorld>,
    pub(crate) inbound_state: Arc<InboundStateBuffer>,
    pub(crate) fingerprint: ConfigFingerprint,
}

/// Lifecycle observability counters (gauge = current world count; the rest are
/// monotonic event counters). Emitted alongside a structured log line per
/// transition.
#[derive(Default)]
pub(crate) struct WorldLifecycleMetrics {
    pub(crate) created: u64,
    pub(crate) destroyed: u64,
    pub(crate) cap_rejected: u64,
    pub(crate) gc_scheduled: u64,
    pub(crate) gc_fired: u64,
    pub(crate) gc_cancelled: u64,
    pub(crate) pooled: u64,
    pub(crate) reused: u64,
}

// ─── Messages (the public API) ──────────────────────────────────────────────

/// Create + start a world at runtime, then register it for ticking and joins.
#[derive(ActixMessage)]
#[rtype(result = "Result<WorldHandle, WorldLifecycleError>")]
pub struct CreateWorld {
    pub name: String,
    pub config: WorldConfig,
    pub gc_policy: GcPolicy,
}

/// Tear down a world. `force = false` respects in-flight-tick safety and may
/// return `TeardownInFlight`; `force = true` schedules teardown to run *after*
/// the in-flight tick completes (never mid-borrow).
#[derive(ActixMessage)]
#[rtype(result = "Result<(), WorldLifecycleError>")]
pub struct DestroyWorld {
    pub name: String,
    pub force: bool,
}

/// Snapshot of all live worlds.
#[derive(ActixMessage)]
#[rtype(result = "Vec<WorldHandle>")]
pub struct ListWorlds;

/// One world, or `None`.
#[derive(ActixMessage)]
#[rtype(result = "Option<WorldHandle>")]
pub struct DescribeWorld {
    pub name: String,
}

/// Live count vs hard cap. Cheap; safe to poll for metrics / backpressure.
#[derive(ActixMessage)]
#[rtype(result = "Capacity")]
pub struct WorldCapacity;

/// Observability snapshot: the live-world gauge plus the lifecycle event
/// counters (§6). Cheap; safe to poll for metrics dashboards.
#[derive(Clone, Copy, Debug, Default)]
pub struct LifecycleMetricsSnapshot {
    pub live_worlds: usize,
    pub cap: usize,
    pub created: u64,
    pub destroyed: u64,
    pub cap_rejected: u64,
    pub gc_scheduled: u64,
    pub gc_fired: u64,
    pub gc_cancelled: u64,
    pub pooled: u64,
    pub reused: u64,
}

/// Snapshot the lifecycle metrics.
#[derive(ActixMessage)]
#[rtype(result = "LifecycleMetricsSnapshot")]
pub struct GetLifecycleMetrics;

// ─── ServerBuilder additions ─────────────────────────────────────────────────

impl super::ServerBuilder {
    /// Hard ceiling on total live worlds (static + dynamic). Creates beyond
    /// this fail with `CapacityReached`. With no call, worlds are unbounded
    /// (today's behavior).
    pub fn max_worlds(mut self, cap: usize) -> Self {
        self.max_worlds = Some(cap);
        self
    }

    /// Configure the warm world pool. With no call, no pool exists (today's
    /// behavior).
    pub fn world_pool(mut self, cfg: PoolConfig) -> Self {
        self.world_pool = Some(cfg);
        self
    }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

impl Handler<CreateWorld> for Server {
    type Result = MessageResult<CreateWorld>;

    fn handle(&mut self, msg: CreateWorld, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.create_world(msg))
    }
}

impl Handler<DestroyWorld> for Server {
    type Result = MessageResult<DestroyWorld>;

    fn handle(&mut self, msg: DestroyWorld, ctx: &mut Context<Self>) -> Self::Result {
        MessageResult(self.detach_and_stop(&msg.name, msg.force, ctx))
    }
}

impl Handler<ListWorlds> for Server {
    type Result = MessageResult<ListWorlds>;

    fn handle(&mut self, _: ListWorlds, _: &mut Context<Self>) -> Self::Result {
        let names: Vec<String> = self.worlds.keys().cloned().collect();
        MessageResult(
            names
                .iter()
                .filter_map(|name| self.world_handle(name))
                .collect(),
        )
    }
}

impl Handler<DescribeWorld> for Server {
    type Result = MessageResult<DescribeWorld>;

    fn handle(&mut self, msg: DescribeWorld, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.world_handle(&msg.name))
    }
}

impl Handler<WorldCapacity> for Server {
    type Result = MessageResult<WorldCapacity>;

    fn handle(&mut self, _: WorldCapacity, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.capacity())
    }
}

impl Handler<GetLifecycleMetrics> for Server {
    type Result = MessageResult<GetLifecycleMetrics>;

    fn handle(&mut self, _: GetLifecycleMetrics, _: &mut Context<Self>) -> Self::Result {
        let metrics = &self.lifecycle_metrics;
        MessageResult(LifecycleMetricsSnapshot {
            live_worlds: self.worlds.len(),
            cap: self.world_cap(),
            created: metrics.created,
            destroyed: metrics.destroyed,
            cap_rejected: metrics.cap_rejected,
            gc_scheduled: metrics.gc_scheduled,
            gc_fired: metrics.gc_fired,
            gc_cancelled: metrics.gc_cancelled,
            pooled: metrics.pooled,
            reused: metrics.reused,
        })
    }
}

// ─── Internal implementation ─────────────────────────────────────────────────

impl Server {
    /// Hard cap from the builder, or `usize::MAX` when unbounded.
    pub(crate) fn world_cap(&self) -> usize {
        self.max_worlds.unwrap_or(usize::MAX)
    }

    /// Live-vs-cap snapshot.
    pub(crate) fn capacity(&self) -> Capacity {
        Capacity {
            live: self.worlds.len(),
            cap: self.world_cap(),
        }
    }

    /// Number of clients currently registered in a world, from the connection
    /// registry (authoritative server-side membership, updated synchronously on
    /// join/leave/switch/disconnect).
    pub(crate) fn world_player_count(&self, name: &str) -> usize {
        self.connections
            .values()
            .filter(|(_, world_name, _)| world_name == name)
            .count()
    }

    /// Per-world join cap (`usize::MAX` = unbounded) for the join-full check.
    pub(crate) fn world_max_clients(&self, name: &str) -> usize {
        self.world_entries
            .get(name)
            .map(|entry| entry.max_clients)
            .unwrap_or(usize::MAX)
    }

    /// Whether a world runs the deterministic fixed-step tick. Used by join
    /// resolution to decide whether the strict protocol assert applies.
    pub(crate) fn world_is_deterministic(&self, name: &str) -> bool {
        self.world_entries
            .get(name)
            .map(|entry| entry.is_deterministic)
            .unwrap_or(false)
    }

    /// Build a query-time snapshot of a live world.
    fn world_handle(&self, name: &str) -> Option<WorldHandle> {
        let addr = self.worlds.get(name)?.clone();
        let entry = self.world_entries.get(name)?;
        Some(WorldHandle {
            name: name.to_owned(),
            addr,
            created_at: entry.created_at,
            player_count: self.world_player_count(name),
            gc_policy: entry.gc_policy.clone(),
        })
    }

    /// `CreateWorld` body: duplicate / capacity checks, then `add_world`'s exact
    /// registration ordering (registry + rtc_senders + inbound_state + start +
    /// worlds.insert) — either freshly built or from a warm pooled slot — plus
    /// created_at / gc_policy bookkeeping.
    fn create_world(&mut self, msg: CreateWorld) -> Result<WorldHandle, WorldLifecycleError> {
        let CreateWorld {
            name,
            config,
            gc_policy,
        } = msg;

        if name.trim().is_empty() {
            return Err(WorldLifecycleError::InvalidConfig(
                "world name must not be empty".to_owned(),
            ));
        }
        if self.worlds.contains_key(&name) {
            return Err(WorldLifecycleError::DuplicateName(name));
        }

        let live = self.worlds.len();
        let cap = self.world_cap();
        if live >= cap {
            self.lifecycle_metrics.cap_rejected += 1;
            perf::log(
                "world_create_rejected",
                &name,
                serde_json::json!({ "reason": "capacity", "live": live, "cap": cap }),
            );
            info!(
                "world lifecycle: create '{}' rejected at capacity ({}/{})",
                name, live, cap
            );
            return Err(WorldLifecycleError::CapacityReached { live, cap });
        }

        let fingerprint = ConfigFingerprint::of(&config);
        let max_clients = config.max_clients;
        let is_deterministic = config.fixed_timestep.is_some();

        let (addr, inbound_state, reused) = match self.take_pooled_slot(&fingerprint, &name) {
            Some((addr, inbound_state)) => (addr, inbound_state, true),
            None => {
                let mut world = World::new(&name, &config);
                world.ecs_mut().insert(self.registry.clone());
                if let Some(rtc_senders) = &self.rtc_senders {
                    world.ecs_mut().insert(rtc_senders.clone());
                }
                let inbound_state = world.inbound_state_handle();
                let addr = world.start();
                (addr, inbound_state, false)
            }
        };

        self.world_inbound_state.insert(name.clone(), inbound_state);
        self.worlds.insert(name.clone(), addr.clone());

        let created_at = Instant::now();
        self.world_entries.insert(
            name.clone(),
            WorldEntry {
                created_at,
                gc_policy: gc_policy.clone(),
                max_clients,
                peak_players: 0,
                gc_handle: None,
                config_fingerprint: fingerprint,
                is_deterministic,
            },
        );

        self.lifecycle_metrics.created += 1;
        perf::log(
            "world_created",
            &name,
            serde_json::json!({
                "reusedWarmSlot": reused,
                "live": self.worlds.len(),
                "cap": cap,
            }),
        );
        info!(
            "world lifecycle: created world '{}' (live {}/{}, warm-reuse {}, gc {:?})",
            name,
            self.worlds.len(),
            cap,
            reused,
            gc_policy
        );

        Ok(WorldHandle {
            name,
            addr,
            created_at,
            player_count: 0,
            gc_policy,
        })
    }

    /// Pop a warm slot matching `fingerprint`, reset + rename it for reuse, and
    /// return its address and (cleared) inbound state. `None` when pooling is
    /// off, no slot matches, or the reset policy is not `ReuseWarm`.
    fn take_pooled_slot(
        &mut self,
        fingerprint: &ConfigFingerprint,
        new_name: &str,
    ) -> Option<(Addr<SyncWorld>, Arc<InboundStateBuffer>)> {
        let reuse = self
            .world_pool
            .as_ref()
            .map_or(false, |pool| matches!(pool.reset, ResetPolicy::ReuseWarm));
        if !reuse {
            return None;
        }

        let index = self
            .world_pool_slots
            .iter()
            .position(|slot| &slot.fingerprint == fingerprint)?;
        let slot = self.world_pool_slots.remove(index);

        // Reset + rename runs on the world's own thread, FIFO ahead of any
        // subsequent ClientJoinRequest, so no state leaks into the reused world
        // and every join lands on a clean, correctly-named world.
        slot.addr.do_send(ResetWorld {
            name: new_name.to_owned(),
        });
        slot.inbound_state.reset();

        self.lifecycle_metrics.reused += 1;
        Some((slot.addr, slot.inbound_state))
    }

    /// Detach a world from the live map with the #129-safe ordering, then stop
    /// (or pool) its actor. Returns the typed error on `NotFound` /
    /// `TeardownInFlight`.
    pub(crate) fn detach_and_stop(
        &mut self,
        name: &str,
        force: bool,
        ctx: &mut Context<Self>,
    ) -> Result<(), WorldLifecycleError> {
        if let Some(addr) = self.detach_world(name, force, ctx)? {
            // Queue teardown behind any in-flight tick (FIFO on the world's own
            // thread) and keep the address alive until it completes, so the
            // teardown message is never dropped before it runs.
            ctx.spawn(wrap_future(addr.send(Teardown)).map(|_result, _act: &mut Server, _ctx| ()));
        }
        Ok(())
    }

    /// Steps 1–5 of §3.2: remove-from-map first (stops new ticks + join
    /// resolution), purge server-side state, cancel the GC timer. Returns the
    /// world's address when the caller must stop it; `None` when it was
    /// returned to the warm pool instead.
    fn detach_world(
        &mut self,
        name: &str,
        force: bool,
        ctx: &mut Context<Self>,
    ) -> Result<Option<Addr<SyncWorld>>, WorldLifecycleError> {
        if !self.worlds.contains_key(name) {
            return Err(WorldLifecycleError::NotFound(name.to_owned()));
        }
        // Step 3: a tick in flight with force=false defers to the caller.
        if self.pending_world_ticks.contains(name) && !force {
            return Err(WorldLifecycleError::TeardownInFlight(name.to_owned()));
        }

        // Step 2: remove from the world map FIRST — no new Tick is enqueued and
        // join resolution can no longer find it, closing the window for borrows.
        let addr = self.worlds.remove(name).unwrap();
        self.pending_world_ticks.remove(name);
        let inbound_state = self.world_inbound_state.remove(name);

        // Step 5 (server side): eject sessions bound to this world so a stale
        // reconnect can't resurrect a dead world; it takes the clean
        // non-existent path instead.
        let bound: Vec<String> = self
            .connections
            .iter()
            .filter(|(_, (_, world_name, _))| world_name == name)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &bound {
            self.connections.remove(id);
            self.lost_sessions.remove(id);
        }

        let mut entry = self.world_entries.remove(name);
        if let Some(entry) = &mut entry {
            if let Some(handle) = entry.gc_handle.take() {
                ctx.cancel_future(handle);
            }
        }

        self.lifecycle_metrics.destroyed += 1;
        let lifetime_ms = entry
            .as_ref()
            .map(|entry| entry.created_at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        let peak = entry.as_ref().map(|entry| entry.peak_players).unwrap_or(0);
        perf::log(
            "world_destroyed",
            name,
            serde_json::json!({
                "lifetimeMs": lifetime_ms,
                "peakPlayers": peak,
                "ejectedSessions": bound.len(),
            }),
        );
        info!(
            "world lifecycle: destroyed world '{}' (lifetime {}ms, peak {}, ejected {})",
            name,
            lifetime_ms,
            peak,
            bound.len()
        );

        // Warm-pool return: keep the actor dormant for reuse instead of
        // stopping it, when ReuseWarm pooling has spare capacity and the world
        // is poolable (in-memory, known fingerprint). The slot is reset lazily
        // on reuse (see `take_pooled_slot`).
        let pool_reuse = self
            .world_pool
            .as_ref()
            .map(|pool| (matches!(pool.reset, ResetPolicy::ReuseWarm), pool.prealloc));
        if let (Some((true, prealloc)), Some(entry), Some(inbound_state)) =
            (pool_reuse, &entry, &inbound_state)
        {
            if !entry.config_fingerprint.saving && self.world_pool_slots.len() < prealloc {
                self.world_pool_slots.push(PooledSlot {
                    addr,
                    inbound_state: inbound_state.clone(),
                    fingerprint: entry.config_fingerprint.clone(),
                });
                self.lifecycle_metrics.pooled += 1;
                return Ok(None);
            }
        }

        Ok(Some(addr))
    }

    /// GC timer fired for `name` (§3.3): re-check emptiness — a rejoin within
    /// grace makes the world non-empty and it survives — otherwise reap it.
    pub(crate) fn gc_fire(&mut self, name: &str, ctx: &mut Context<Self>) {
        if let Some(entry) = self.world_entries.get_mut(name) {
            entry.gc_handle = None;
        }
        if self.world_player_count(name) > 0 {
            return;
        }
        self.lifecycle_metrics.gc_fired += 1;
        perf::log("world_gc_fired", name, serde_json::json!({}));
        info!("world lifecycle: GC reaping empty world '{}'", name);
        let _ = self.detach_and_stop(name, true, ctx);
    }

    /// Arm / cancel GC timers to match current occupancy (§3.3). Called after
    /// every membership transition. Arms a `grace` timer on a world that has
    /// become empty *after* having been occupied; cancels it on rejoin. `Never`
    /// worlds never arm.
    pub(crate) fn reconcile_gc(&mut self, ctx: &mut Context<Self>) {
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for (_, world_name, _) in self.connections.values() {
            *counts.entry(world_name.clone()).or_insert(0) += 1;
        }

        let names: Vec<String> = self.world_entries.keys().cloned().collect();
        for name in names {
            let grace = match self
                .world_entries
                .get(&name)
                .map(|entry| entry.gc_policy.clone())
            {
                Some(GcPolicy::WhenEmpty { grace }) => grace,
                _ => continue,
            };
            let count = counts.get(&name).copied().unwrap_or(0);

            if let Some(entry) = self.world_entries.get_mut(&name) {
                if count > entry.peak_players {
                    entry.peak_players = count;
                }
            }

            if count > 0 {
                if let Some(handle) = self
                    .world_entries
                    .get_mut(&name)
                    .and_then(|entry| entry.gc_handle.take())
                {
                    ctx.cancel_future(handle);
                    self.lifecycle_metrics.gc_cancelled += 1;
                    perf::log("world_gc_cancelled", &name, serde_json::json!({}));
                    info!(
                        "world lifecycle: GC cancelled for '{}' (player rejoined)",
                        name
                    );
                }
            } else {
                let (armed, peak) = self
                    .world_entries
                    .get(&name)
                    .map(|entry| (entry.gc_handle.is_some(), entry.peak_players))
                    .unwrap_or((false, 0));
                if !armed && peak > 0 {
                    let world = name.clone();
                    let handle = ctx.run_later(grace, move |act, ctx| {
                        act.gc_fire(&world, ctx);
                    });
                    if let Some(entry) = self.world_entries.get_mut(&name) {
                        entry.gc_handle = Some(handle);
                    }
                    self.lifecycle_metrics.gc_scheduled += 1;
                    perf::log(
                        "world_gc_scheduled",
                        &name,
                        serde_json::json!({ "graceMs": grace.as_millis() as u64 }),
                    );
                    info!(
                        "world lifecycle: GC scheduled for empty world '{}' (grace {}ms)",
                        name,
                        grace.as_millis() as u64
                    );
                }
            }
        }
    }
}

/// Runtime world-lifecycle integration tests against a real `Server` actor
/// driving real `SyncWorld` actors (world thread + ECS) with fake sockets.
/// Covers the seven gated scenarios in the design: pooled-slot no-leak reuse,
/// capacity enforcement, GC-on-empty (fire + cancel), join-when-full, join to a
/// GC'd / nonexistent world, teardown during an in-flight tick (the #129
/// class), and create-then-switch / destroy-during-switch atomicity.
#[cfg(test)]
mod runtime_lifecycle_tests {
    use super::*;

    use actix::{Actor, Context, Handler, Message as ActixMessage};
    use serde_json::json;
    use specs::{Builder, Join, WorldExt};
    use std::time::Duration;
    use tokio::sync::{mpsc, oneshot};

    use crate::{
        ClientMessage, Connect, GetWorldStats, Message, MessageType, Server, World, WorldConfig,
        WsSender,
    };

    /// Test harness: run arbitrary logic on the `Server` actor with its real
    /// `Context`, so tests can inspect private state and drive the ctx-bound
    /// helpers (`detach_and_stop`, `reconcile_gc`) exactly as the actor does.
    struct RunOnActor(Box<dyn FnOnce(&mut Server, &mut Context<Server>) + Send>);

    impl ActixMessage for RunOnActor {
        type Result = ();
    }

    impl Handler<RunOnActor> for Server {
        type Result = ();

        fn handle(&mut self, msg: RunOnActor, ctx: &mut Context<Self>) {
            (msg.0)(self, ctx);
        }
    }

    fn fake_socket() -> (WsSender, mpsc::UnboundedReceiver<Vec<u8>>) {
        let (control_tx, control_rx) = mpsc::unbounded_channel();
        let (bulk_tx, _) = mpsc::unbounded_channel();
        (WsSender::new(control_tx, bulk_tx), control_rx)
    }

    fn join_message(world: &str) -> Message {
        Message::new(&MessageType::Join)
            .json(&json!({ "world": world, "username": "tester" }).to_string())
            .build()
    }

    fn leave_message(world: &str) -> Message {
        Message::new(&MessageType::Leave).text(world).build()
    }

    fn client_message(id: &str, token: &str, data: Message) -> ClientMessage {
        ClientMessage::new(id.to_owned(), data, 0, Some(token.to_owned()))
    }

    fn ecs_entity_count(world: &World) -> usize {
        let entities = world.ecs().entities();
        (&entities).join().count()
    }

    // ── Test 1a: the reset pass ReuseWarm relies on leaves no state behind. ──
    #[test]
    fn pooled_slot_reset_has_no_state_leak() {
        actix::System::new().block_on(async {
            let config = WorldConfig::new().build();
            let mut world = World::new("slot", &config);

            world.ecs_mut().create_entity().build();
            world.ecs_mut().create_entity().build();
            let inbound = world.inbound_state_handle();
            inbound.push("client", Message::new(&MessageType::Peer).build());

            assert!(ecs_entity_count(&world) >= 2, "seeded entities present");
            assert!(!inbound.is_empty(), "seeded inbound state present");

            world.reset();

            assert_eq!(ecs_entity_count(&world), 0, "ECS empty after reset");
            assert!(inbound.is_empty(), "inbound state clean after reset");
        });
    }

    // ── Test 1b: a warm slot is genuinely reused, clean, across a lifecycle. ─
    #[test]
    fn reuse_warm_pool_reuses_clean_slot() {
        actix::System::new().block_on(async {
            let server = Server::new()
                .debug(false)
                .world_pool(PoolConfig {
                    prealloc: 1,
                    reset: ResetPolicy::ReuseWarm,
                })
                .build();
            let addr = server.start();
            let config = WorldConfig::new().build();

            let handle_a = addr
                .send(CreateWorld {
                    name: "slot-a".into(),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .expect("create slot-a");

            let (sender, _rx) = fake_socket();
            let (id, token) = addr
                .send(Connect {
                    id: Some("bot".into()),
                    is_transport: false,
                    sender,
                })
                .await
                .unwrap();
            addr.send(client_message(&id, &token, join_message("slot-a")))
                .await
                .unwrap();

            let stats_a = handle_a.addr.send(GetWorldStats).await.unwrap();
            assert_eq!(stats_a.client_count, 1, "client joined the warm world");

            addr.send(DestroyWorld {
                name: "slot-a".into(),
                force: true,
            })
            .await
            .unwrap()
            .expect("destroy slot-a");

            let handle_b = addr
                .send(CreateWorld {
                    name: "slot-b".into(),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .expect("create slot-b");

            let metrics = addr.send(GetLifecycleMetrics).await.unwrap();
            assert_eq!(metrics.pooled, 1, "destroyed world returned to the pool");
            assert_eq!(metrics.reused, 1, "created world reused the warm slot");

            let stats_b = handle_b.addr.send(GetWorldStats).await.unwrap();
            assert_eq!(stats_b.client_count, 0, "no client carried over");
            assert_eq!(stats_b.entity_count, 0, "no entity carried over");
        });
    }

    // ── Test 2: max_worlds is a hard cap; N+1 is typed backpressure. ─────────
    #[test]
    fn cap_enforcement_rejects_beyond_max_worlds() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).max_worlds(2).build();
            let addr = server.start();
            let config = WorldConfig::new().build();

            for i in 0..2 {
                addr.send(CreateWorld {
                    name: format!("w{i}"),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .unwrap_or_else(|_| panic!("create w{i}"));
            }

            let overflow = addr
                .send(CreateWorld {
                    name: "w2".into(),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap();
            match overflow {
                Err(WorldLifecycleError::CapacityReached { live, cap }) => {
                    assert_eq!(live, 2);
                    assert_eq!(cap, 2);
                }
                Err(other) => panic!("expected CapacityReached, got {other:?}"),
                Ok(_) => panic!("expected CapacityReached, got Ok(handle)"),
            }

            // Server keeps ticking and answering after the rejection.
            let capacity = addr.send(WorldCapacity).await.unwrap();
            assert_eq!(capacity.live, 2);
            assert_eq!(capacity.cap, 2);
            let metrics = addr.send(GetLifecycleMetrics).await.unwrap();
            assert_eq!(metrics.cap_rejected, 1);
        });
    }

    // ── Test 3a: GC reaps an empty world after the grace window. ─────────────
    #[test]
    fn gc_fires_after_grace_when_empty() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();
            let grace = Duration::from_millis(150);

            addr.send(CreateWorld {
                name: "gcw".into(),
                config: WorldConfig::new().build(),
                gc_policy: GcPolicy::WhenEmpty { grace },
            })
            .await
            .unwrap()
            .expect("create gcw");

            let (sender, _rx) = fake_socket();
            let (id, token) = addr
                .send(Connect {
                    id: Some("bot".into()),
                    is_transport: false,
                    sender,
                })
                .await
                .unwrap();
            addr.send(client_message(&id, &token, join_message("gcw")))
                .await
                .unwrap();
            addr.send(client_message(&id, &token, leave_message("gcw")))
                .await
                .unwrap();

            tokio::time::sleep(grace + Duration::from_millis(400)).await;

            let described = addr
                .send(DescribeWorld { name: "gcw".into() })
                .await
                .unwrap();
            assert!(described.is_none(), "empty world reaped after grace");
            let metrics = addr.send(GetLifecycleMetrics).await.unwrap();
            assert_eq!(metrics.gc_fired, 1);
        });
    }

    // ── Test 3b: a rejoin within grace cancels the reap. ─────────────────────
    #[test]
    fn gc_cancels_on_rejoin_within_grace() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();
            let grace = Duration::from_millis(400);

            addr.send(CreateWorld {
                name: "keepw".into(),
                config: WorldConfig::new().build(),
                gc_policy: GcPolicy::WhenEmpty { grace },
            })
            .await
            .unwrap()
            .expect("create keepw");

            let (sender, _rx) = fake_socket();
            let (id, token) = addr
                .send(Connect {
                    id: Some("bot".into()),
                    is_transport: false,
                    sender,
                })
                .await
                .unwrap();
            addr.send(client_message(&id, &token, join_message("keepw")))
                .await
                .unwrap();
            addr.send(client_message(&id, &token, leave_message("keepw")))
                .await
                .unwrap();

            // Rejoin well within grace: cancels the armed timer.
            tokio::time::sleep(Duration::from_millis(80)).await;
            addr.send(client_message(&id, &token, join_message("keepw")))
                .await
                .unwrap();

            tokio::time::sleep(grace + Duration::from_millis(300)).await;

            let described = addr
                .send(DescribeWorld {
                    name: "keepw".into(),
                })
                .await
                .unwrap();
            assert!(described.is_some(), "rejoined world survives grace");
            let metrics = addr.send(GetLifecycleMetrics).await.unwrap();
            assert!(metrics.gc_cancelled >= 1, "GC was cancelled on rejoin");
            assert_eq!(metrics.gc_fired, 0, "world was never reaped");
        });
    }

    // ── Test 4: a world at max_clients rejects the next join cleanly. ────────
    #[test]
    fn join_when_full_is_rejected_cleanly() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();

            let handle = addr
                .send(CreateWorld {
                    name: "full".into(),
                    config: WorldConfig::new().max_clients(1).build(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .expect("create full");

            let (sender_a, _rx_a) = fake_socket();
            let (id_a, token_a) = addr
                .send(Connect {
                    id: Some("a".into()),
                    is_transport: false,
                    sender: sender_a,
                })
                .await
                .unwrap();
            let first = addr
                .send(client_message(&id_a, &token_a, join_message("full")))
                .await
                .unwrap();
            assert_eq!(first, None, "first join within cap succeeds");

            let (sender_b, _rx_b) = fake_socket();
            let (id_b, token_b) = addr
                .send(Connect {
                    id: Some("b".into()),
                    is_transport: false,
                    sender: sender_b,
                })
                .await
                .unwrap();
            let second = addr
                .send(client_message(&id_b, &token_b, join_message("full")))
                .await
                .unwrap();
            let error = second.expect("join past capacity is rejected");
            assert!(
                error.contains("at capacity"),
                "typed capacity rejection, got: {error}"
            );

            // The existing client is unaffected.
            let stats = handle.addr.send(GetWorldStats).await.unwrap();
            assert_eq!(stats.client_count, 1);
        });
    }

    // ── Test 5: joining a GC'd / nonexistent world takes the clean path. ─────
    #[test]
    fn join_to_gcd_or_nonexistent_world_is_clean() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();
            let grace = Duration::from_millis(150);

            // Nonexistent world.
            let (sender, _rx) = fake_socket();
            let (id, token) = addr
                .send(Connect {
                    id: Some("bot".into()),
                    is_transport: false,
                    sender,
                })
                .await
                .unwrap();
            let error = addr
                .send(client_message(&id, &token, join_message("nowhere")))
                .await
                .unwrap()
                .expect("join to nonexistent world is rejected");
            assert!(error.contains("non-existent world"), "clean path: {error}");

            // GC'd world: join, leave, let it reap, then a stale reconnect via
            // the still-registered session hits the same clean path.
            addr.send(CreateWorld {
                name: "temp".into(),
                config: WorldConfig::new().build(),
                gc_policy: GcPolicy::WhenEmpty { grace },
            })
            .await
            .unwrap()
            .expect("create temp");
            assert_eq!(
                addr.send(client_message(&id, &token, join_message("temp")))
                    .await
                    .unwrap(),
                None
            );
            addr.send(client_message(&id, &token, leave_message("temp")))
                .await
                .unwrap();
            tokio::time::sleep(grace + Duration::from_millis(400)).await;

            let stale = addr
                .send(client_message(&id, &token, join_message("temp")))
                .await
                .unwrap()
                .expect("stale reconnect to reaped world is rejected");
            assert!(
                stale.contains("non-existent world"),
                "stale reconnect takes the clean non-existent path: {stale}"
            );
        });
    }

    // ── Test 6: forced teardown while a tick is in flight never panics. ──────
    #[test]
    fn force_teardown_during_in_flight_tick_does_not_panic() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();

            addr.send(CreateWorld {
                name: "tw".into(),
                config: WorldConfig::new().build(),
                gc_policy: GcPolicy::Never,
            })
            .await
            .unwrap()
            .expect("create tw");

            let (tx, rx) = oneshot::channel();
            addr.send(RunOnActor(Box::new(move |server, ctx| {
                // Simulate a tick in flight for this world.
                server.pending_world_ticks.insert("tw".into());
                // force = false must defer, not race the borrow.
                let deferred = server.detach_and_stop("tw", false, ctx);
                // force = true queues Teardown behind the in-flight tick (FIFO
                // on the world's own thread) — never an external RwLock grab.
                let forced = server.detach_and_stop("tw", true, ctx);
                let _ = tx.send((
                    matches!(deferred, Err(WorldLifecycleError::TeardownInFlight(_))),
                    forced.is_ok(),
                    server.worlds.contains_key("tw"),
                    server.world_inbound_state.contains_key("tw"),
                ));
            })))
            .await
            .unwrap();

            let (deferred_inflight, forced_ok, still_present, inbound_present) = rx.await.unwrap();
            assert!(
                deferred_inflight,
                "force=false defers with TeardownInFlight"
            );
            assert!(forced_ok, "force=true tears down cleanly");
            assert!(!still_present, "world removed from the live map");
            assert!(!inbound_present, "inbound state purged");

            // The Server actor survived teardown and still answers.
            let capacity = addr.send(WorldCapacity).await.unwrap();
            assert_eq!(capacity.live, 0);
        });
    }

    // ── Test 7: switching into a fresh world and destroying the source world
    //           a client is leaving both resolve cleanly. ────────────────────
    #[test]
    fn create_then_switch_and_destroy_during_switch_are_atomic() {
        actix::System::new().block_on(async {
            let server = Server::new().debug(false).build();
            let addr = server.start();
            let config = WorldConfig::new().build();

            let handle_1 = addr
                .send(CreateWorld {
                    name: "w1".into(),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .expect("create w1");
            let handle_2 = addr
                .send(CreateWorld {
                    name: "w2".into(),
                    config: config.clone(),
                    gc_policy: GcPolicy::Never,
                })
                .await
                .unwrap()
                .expect("create w2");

            let (sender, _rx) = fake_socket();
            let (id, token) = addr
                .send(Connect {
                    id: Some("bot".into()),
                    is_transport: false,
                    sender,
                })
                .await
                .unwrap();
            assert_eq!(
                addr.send(client_message(&id, &token, join_message("w1")))
                    .await
                    .unwrap(),
                None
            );

            // Switch into the just-created w2, then destroy w1 (the world the
            // client just switched out of). Both resolve cleanly.
            assert_eq!(
                addr.send(client_message(&id, &token, join_message("w2")))
                    .await
                    .unwrap(),
                None,
                "atomic switch into a runtime-created world"
            );
            addr.send(DestroyWorld {
                name: "w1".into(),
                force: true,
            })
            .await
            .unwrap()
            .expect("destroy the world switched out of");

            // w1 is gone; the client landed in w2 with exactly one entity.
            assert!(addr
                .send(DescribeWorld { name: "w1".into() })
                .await
                .unwrap()
                .is_none());
            let _ = handle_1;
            let stats_2 = handle_2.addr.send(GetWorldStats).await.unwrap();
            assert_eq!(stats_2.client_count, 1, "client resolved into w2");
        });
    }
}
