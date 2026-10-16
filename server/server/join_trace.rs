//! Where one JOIN's time goes, from the WebSocket upgrade to the socket write
//! of the LOAD that completes the client's spawn window.
//!
//! Every session's [`WsSender`](super::WsSender) carries one [`JoinTrace`].
//! The socket loop, the server actor and the world thread all hold that
//! sender, so each stamps the stage it owns as the join passes through it. A
//! join is reported once, as one `[join-trace]` info line plus a `join_trace`
//! perf event, when the last chunk of its spawn window is written (its first
//! LOAD, when no chunk request was traced), or after [`JOIN_TRACE_DEADLINE`]
//! when that never happens. Stamps are `Instant`s behind a mutex that is
//! only taken while a join is in flight: once it is reported, every hot path
//! that asks pays one relaxed atomic load.
//!
//! The spawn window is the requested chunks within [`SPAWN_WINDOW_RADIUS`]
//! of the centers the client asks from until the window is served: what a
//! client waits on before it shows the world. (A client's first request can
//! come from where it stood before it was placed at its spawn, and its next
//! one from the spawn, so the window follows the center.) Each dispatch says
//! what it did with each of its
//! chunks (served, held behind its activation, over the per-tick response
//! budget, or sent down the pipeline because it was not ready), and every
//! LOAD queued for the client is counted, so the one carrying the window's
//! last chunk is known by its position on the bulk lane, which keeps LOADs in
//! order.
//!
//! The server stages telescope: `actor + world wait + modifier + build +
//! encode + queue + write` is exactly JOIN read -> INIT written, so the
//! client's own JOIN -> INIT time minus that sum is the wire both ways plus
//! the client's delivery of the INIT.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex, MutexGuard,
};
use std::time::{Duration, Instant};

use hashbrown::HashSet;
use log::info;
use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{json, Value};

use crate::{perf, Vec2};

/// How long a join may go without its spawn window being written before it
/// is reported as it stands.
pub const JOIN_TRACE_DEADLINE: Duration = Duration::from_secs(15);

/// Chunks around a request's center that make up the spawn window: the 3x3
/// a client waits on before it shows the world.
pub const SPAWN_WINDOW_RADIUS: i32 = 1;

/// Request centers a spawn window follows before it is served.
const MAX_WINDOW_CENTERS: usize = 4;

/// What the chunk-request system did with one requested chunk in a dispatch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestOutcome {
    /// Put in this dispatch's LOAD.
    Served,
    /// Ready, but held behind its activation (the application's arrival
    /// work); asked again next dispatch.
    Held,
    /// Ready, but past the per-tick response budget; asked again next
    /// dispatch.
    OverBudget,
    /// Not ready: sent down the generation and meshing pipeline, and to the
    /// client by the chunk-sending system once it is.
    Unready,
}

/// The timing of the session's joins, shared by every clone of its sender.
#[derive(Clone, Default)]
pub struct JoinTrace(Arc<Inner>);

#[derive(Default)]
struct Inner {
    /// True while a join is in flight and unreported: the one thing the hot
    /// paths read.
    active: AtomicBool,
    /// Control-lane position of the traced INIT while its write is awaited,
    /// `0` otherwise (see [`JoinTrace::control_written`]).
    init_seq: AtomicU64,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    upgraded_at: Option<Instant>,
    registered_at: Option<Instant>,
    joins: u32,
    join: Option<Join>,
}

/// One JOIN's stamps. Everything after `read_at` is optional: a join that
/// stalls, or is superseded, is reported with what it reached.
struct Join {
    number: u32,
    /// Upgrade and registration, on the session's first join only.
    upgraded_at: Option<Instant>,
    registered_at: Option<Instant>,
    read_at: Instant,
    acked_at: Option<Instant>,
    forwarded_at: Option<Instant>,
    dequeued_at: Option<Instant>,
    modifier_at: Option<Instant>,
    built_at: Option<Instant>,
    encoded_at: Option<Instant>,
    queued_at: Option<Instant>,
    written_at: Option<Instant>,
    client_id: String,
    world: String,
    raw_bytes: usize,
    wire_bytes: usize,
    registry_cached: bool,
    first_request_at: Option<Instant>,
    held_dispatches: u32,
    held_chunks: usize,
    load_queued_at: Option<Instant>,
    load_encoded_at: Option<Instant>,
    load_sent_at: Option<Instant>,
    load_written_at: Option<Instant>,
    load_chunks: usize,
    load_bytes: usize,
    window: Window,
}

/// The spawn window's progress through the chunk systems and the lane.
#[derive(Default)]
struct Window {
    /// Chunks not yet in a queued LOAD; `None` until the first request.
    left: Option<HashSet<Vec2<i32>>>,
    /// Every chunk of the window, served or not.
    members: HashSet<Vec2<i32>>,
    centers: Vec<Vec2<i32>>,
    /// Chunks the client asked for, and those a queued LOAD carried, while
    /// the window is open.
    requested: HashSet<Vec2<i32>>,
    served: HashSet<Vec2<i32>>,
    /// Dispatches that handled a window chunk, and per outcome how many
    /// window chunks each dispatch held, deferred or sent to the pipeline.
    dispatches: u32,
    held: u32,
    over_budget: u32,
    unready: u32,
    /// When its last chunk went into a queued LOAD.
    served_at: Option<Instant>,
    /// LOADs queued for the client since the INIT, and the position of the
    /// one carrying the window's last chunk.
    loads_queued: u32,
    load: Option<u32>,
    /// LOADs handed to the lane since the INIT.
    loads_sent: u32,
    load_queued_at: Option<Instant>,
    load_encoded_at: Option<Instant>,
    sent_at: Option<Instant>,
    /// LOADs handed to the lane with a write stamp (the first one and the
    /// window's), how many of those are written, and the window's place
    /// among them.
    stamped_sent: u32,
    stamped_written: u32,
    stamp: Option<u32>,
    written_at: Option<Instant>,
}

impl JoinTrace {
    fn state(&self) -> MutexGuard<'_, State> {
        self.0
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Stamp the join in flight, if any.
    fn with_join(&self, stamp: impl FnOnce(&mut Join)) {
        if !self.is_active() {
            return;
        }
        if let Some(join) = self.state().join.as_mut() {
            stamp(join);
        }
    }

    /// Whether a join is in flight and unreported.
    pub fn is_active(&self) -> bool {
        self.0.active.load(Ordering::Relaxed)
    }

    /// The socket was upgraded at `upgraded_at` and the server registered the
    /// session just now. Both are reported with the session's first join.
    pub(crate) fn session_registered(&self, upgraded_at: Instant) {
        let mut state = self.state();
        state.upgraded_at = Some(upgraded_at);
        state.registered_at = Some(Instant::now());
    }

    /// The socket read a JOIN at `read_at`. A previous join still in flight is
    /// reported as superseded first.
    pub(crate) fn begin(&self, read_at: Instant) {
        let mut state = self.state();
        if let Some(previous) = state.join.take() {
            previous.report("superseded by another JOIN");
        }
        state.joins += 1;
        let is_first = state.joins == 1;
        state.join = Some(Join {
            number: state.joins,
            upgraded_at: state.upgraded_at.filter(|_| is_first),
            registered_at: state.registered_at.filter(|_| is_first),
            read_at,
            acked_at: None,
            forwarded_at: None,
            dequeued_at: None,
            modifier_at: None,
            built_at: None,
            encoded_at: None,
            queued_at: None,
            written_at: None,
            client_id: String::new(),
            world: String::new(),
            raw_bytes: 0,
            wire_bytes: 0,
            registry_cached: false,
            first_request_at: None,
            held_dispatches: 0,
            held_chunks: 0,
            load_queued_at: None,
            load_encoded_at: None,
            load_sent_at: None,
            load_written_at: None,
            load_chunks: 0,
            load_bytes: 0,
            window: Window::default(),
        });
        self.0.init_seq.store(0, Ordering::Relaxed);
        self.0.active.store(true, Ordering::Relaxed);
    }

    /// The server actor answered the JOIN's `ClientMessage`.
    pub(crate) fn acked(&self) {
        let now = Instant::now();
        self.with_join(|join| {
            join.acked_at.get_or_insert(now);
        });
    }

    /// The server actor handed the join to `world`'s mailbox.
    pub(crate) fn forwarded(&self, client_id: &str, world: &str) {
        let now = Instant::now();
        self.with_join(|join| {
            join.forwarded_at = Some(now);
            join.client_id = client_id.to_owned();
            join.world = world.to_owned();
        });
    }

    /// The world thread took the join out of its mailbox.
    pub(crate) fn world_dequeued(&self) {
        let now = Instant::now();
        self.with_join(|join| {
            join.dequeued_at = Some(now);
        });
    }

    /// The client entity exists and the game's client modifier has run on it
    /// (on a replayed join, the existing entity was refreshed).
    pub(crate) fn modifier_done(&self) {
        let now = Instant::now();
        self.with_join(|join| {
            join.modifier_at = Some(now);
        });
    }

    /// Mailbox wait and modifier time of the join in flight, for the INIT's
    /// own `serverTiming`.
    pub(crate) fn world_stage_ms(&self) -> (Option<f64>, Option<f64>) {
        if !self.is_active() {
            return (None, None);
        }
        match self.state().join.as_ref() {
            Some(join) => (
                span_ms(join.forwarded_at, join.dequeued_at),
                span_ms(join.dequeued_at, join.modifier_at),
            ),
            None => (None, None),
        }
    }

    /// The INIT message is built: `raw_bytes` of protobuf before compression.
    pub(crate) fn init_built(&self, raw_bytes: usize, registry_cached: bool) {
        let now = Instant::now();
        self.with_join(|join| {
            join.built_at = Some(now);
            join.raw_bytes = raw_bytes;
            join.registry_cached = registry_cached;
        });
    }

    /// The INIT is encoded: `wire_bytes` is what the socket will carry.
    pub(crate) fn init_encoded(&self, wire_bytes: usize) {
        let now = Instant::now();
        self.with_join(|join| {
            join.encoded_at = Some(now);
            join.wire_bytes = wire_bytes;
        });
    }

    /// The INIT went onto the control lane as its `seq`-th message.
    pub(crate) fn init_queued(&self, seq: u64) {
        let now = Instant::now();
        let mut is_queued = false;
        self.with_join(|join| {
            join.queued_at = Some(now);
            is_queued = true;
        });
        if is_queued {
            self.0.init_seq.store(seq, Ordering::Relaxed);
        }
    }

    /// The write loop finished its `written`-th control-lane write. The one
    /// that reaches the INIT's position is the INIT's: handed to the socket
    /// (actix-ws), not yet to the kernel. Two threads queueing on the lane at
    /// the same instant can swap positions, which moves this stamp by at most
    /// one neighbouring write.
    pub(crate) fn control_written(&self, written: u64) {
        let seq = self.0.init_seq.load(Ordering::Relaxed);
        if seq == 0 || written < seq {
            return;
        }
        self.0.init_seq.store(0, Ordering::Relaxed);
        let now = Instant::now();
        self.with_join(|join| {
            join.written_at.get_or_insert(now);
        });
    }

    /// The world's chunk-request system served this client this dispatch:
    /// `outcomes` is what it did with each requested chunk, `center` the
    /// center the client asked around. The first call after the INIT fixes
    /// the spawn window.
    pub(crate) fn chunk_requests(
        &self,
        center: &Vec2<i32>,
        outcomes: &[(Vec2<i32>, RequestOutcome)],
    ) {
        let now = Instant::now();
        self.with_join(|join| {
            if join.queued_at.is_none() {
                return;
            }
            join.first_request_at.get_or_insert(now);
            let held = outcomes
                .iter()
                .filter(|(_, outcome)| *outcome == RequestOutcome::Held)
                .count();
            if join.load_sent_at.is_none() && held > 0 {
                join.held_dispatches += 1;
                join.held_chunks += held;
            }
            let window = &mut join.window;
            if window.served_at.is_some() {
                return;
            }
            window
                .requested
                .extend(outcomes.iter().map(|(coords, _)| coords.clone()));
            if !window.centers.contains(center) && window.centers.len() < MAX_WINDOW_CENTERS {
                window.centers.push(center.clone());
                let left = window.left.get_or_insert_with(HashSet::new);
                for dx in -SPAWN_WINDOW_RADIUS..=SPAWN_WINDOW_RADIUS {
                    for dz in -SPAWN_WINDOW_RADIUS..=SPAWN_WINDOW_RADIUS {
                        let coords = Vec2(center.0 + dx, center.1 + dz);
                        if !window.requested.contains(&coords)
                            || !window.members.insert(coords.clone())
                        {
                            continue;
                        }
                        if !window.served.contains(&coords) {
                            left.insert(coords);
                        }
                    }
                }
            }
            let Some(left) = window.left.as_ref() else {
                return;
            };
            let mut is_touched = false;
            for (coords, outcome) in outcomes {
                if !left.contains(coords) {
                    continue;
                }
                is_touched = true;
                match outcome {
                    RequestOutcome::Held => window.held += 1,
                    RequestOutcome::OverBudget => window.over_budget += 1,
                    RequestOutcome::Unready => window.unready += 1,
                    RequestOutcome::Served => {}
                }
            }
            if is_touched {
                window.dispatches += 1;
            }
        });
    }

    /// A LOAD carrying `chunks` was queued for this client. Called for every
    /// LOAD, in the order they will reach the lane.
    pub(crate) fn load_queued(&self, chunks: impl IntoIterator<Item = Vec2<i32>>) {
        let now = Instant::now();
        self.with_join(|join| {
            if join.queued_at.is_none() {
                return;
            }
            let window = &mut join.window;
            window.loads_queued += 1;
            if window.load.is_some() {
                return;
            }
            let Some(left) = window.left.as_mut() else {
                return;
            };
            for coords in chunks {
                left.remove(&coords);
                window.served.insert(coords);
            }
            if left.is_empty() {
                window.load = Some(window.loads_queued);
                window.served_at = Some(now);
            }
        });
    }

    /// `world` is about to send this client a chunk LOAD that left its tick
    /// at `queued_at` and finished encoding at `encoded_at`. When it is the
    /// join's first or the one completing its spawn window, returns the
    /// join's number: send the LOAD with [`super::WsSender::send_first_load`]
    /// so its write is stamped.
    pub(crate) fn first_load_sent(
        &self,
        world: &str,
        queued_at: Instant,
        encoded_at: Instant,
        chunks: usize,
        bytes: usize,
    ) -> Option<u32> {
        if !self.is_active() {
            return None;
        }
        let now = Instant::now();
        let mut state = self.state();
        let join = state.join.as_mut()?;
        if join.queued_at.is_none() || join.world != world {
            return None;
        }
        join.window.loads_sent += 1;
        let is_first = join.load_sent_at.is_none();
        if is_first {
            join.load_queued_at = Some(queued_at);
            join.load_encoded_at = Some(encoded_at);
            join.load_sent_at = Some(now);
            join.load_chunks = chunks;
            join.load_bytes = bytes;
        }
        let window = &mut join.window;
        let is_window = window.load == Some(window.loads_sent);
        if !is_first && !is_window {
            return None;
        }
        window.stamped_sent += 1;
        if is_window {
            window.load_queued_at = Some(queued_at);
            window.load_encoded_at = Some(encoded_at);
            window.sent_at = Some(now);
            window.stamp = Some(window.stamped_sent);
        }
        Some(join.number)
    }

    /// The write loop wrote one of join `number`'s stamped LOADs (not a
    /// later join's, begun while the LOAD sat on the lane). The join is
    /// reported once its spawn window's LOAD is written, or at its first LOAD
    /// when no chunk request was traced.
    pub(crate) fn first_load_written(&self, number: u32) {
        let now = Instant::now();
        let mut state = self.state();
        let Some(join) = state.join.as_mut().filter(|join| join.number == number) else {
            return;
        };
        join.load_written_at.get_or_insert(now);
        let window = &mut join.window;
        window.stamped_written += 1;
        let is_window_written = window
            .stamp
            .is_some_and(|stamp| window.stamped_written >= stamp);
        if is_window_written {
            window.written_at = Some(now);
        }
        if !is_window_written && window.left.is_some() {
            return;
        }
        let join = state.join.take().expect("checked above");
        self.0.active.store(false, Ordering::Relaxed);
        join.report(if is_window_written {
            "spawn window written"
        } else {
            "first LOAD written"
        });
    }

    /// Report the join in flight if it has run past [`JOIN_TRACE_DEADLINE`].
    pub(crate) fn expire(&self) {
        if !self.is_active() {
            return;
        }
        let mut state = self.state();
        let is_due = state
            .join
            .as_ref()
            .is_some_and(|join| join.read_at.elapsed() >= JOIN_TRACE_DEADLINE);
        if is_due {
            let join = state.join.take().expect("checked above");
            self.0.active.store(false, Ordering::Relaxed);
            join.report("spawn window not written within the deadline");
        }
    }

    /// The session closed: report the join in flight, if any.
    pub(crate) fn session_ended(&self) {
        if !self.is_active() {
            return;
        }
        if let Some(join) = self.state().join.take() {
            self.0.active.store(false, Ordering::Relaxed);
            join.report("session closed");
        }
    }
}

fn span_ms(from: Option<Instant>, to: Option<Instant>) -> Option<f64> {
    match (from, to) {
        (Some(from), Some(to)) => Some(to.saturating_duration_since(from).as_secs_f64() * 1000.0),
        _ => None,
    }
}

fn show(ms: Option<f64>) -> String {
    ms.map_or_else(|| "-".to_owned(), |ms| format!("{ms:.1}"))
}

impl Join {
    fn since_read(&self, at: Option<Instant>) -> Option<f64> {
        span_ms(Some(self.read_at), at)
    }

    fn report(self, outcome: &str) {
        let actor = span_ms(Some(self.read_at), self.forwarded_at);
        let world_wait = span_ms(self.forwarded_at, self.dequeued_at);
        let modifier = span_ms(self.dequeued_at, self.modifier_at);
        let build = span_ms(self.modifier_at, self.built_at);
        let encode = span_ms(self.built_at, self.encoded_at);
        let queue = span_ms(self.encoded_at, self.queued_at);
        let write = span_ms(self.queued_at, self.written_at);
        let server = self.since_read(self.written_at);
        let upgrade_to_registered = span_ms(self.upgraded_at, self.registered_at);
        let registered_to_read = span_ms(self.registered_at, Some(self.read_at));
        let shape = if self.registry_cached {
            "cached"
        } else {
            "full"
        };

        let session = if self.upgraded_at.is_some() {
            format!(
                "session: upgrade -> registered {} ms, registered -> JOIN read {} ms; ",
                show(upgrade_to_registered),
                show(registered_to_read)
            )
        } else {
            String::new()
        };
        let window = &self.window;
        info!(
            "[join-trace] {} -> {} join #{}, {} INIT ({} KB raw, {} KB wire): JOIN read -> INIT \
             written {} ms [actor {}, world wait {}, modifier {}, build {}, encode {}, queue {}, \
             write {}], acked @{}; {}first chunk request @{}, activation held {} dispatch(es) / \
             {} chunk(s); first LOAD queued @{} encoded @{} sent @{} written @{} ({} chunk(s), \
             {} KB); spawn window {} chunk(s) around {} over {} dispatch(es) [held {}, over \
             budget {}, unready {} chunk-dispatches], served @{}, its LOAD #{} queued @{} \
             encoded @{} sent @{} written @{}; outcome: {}",
            self.client_id,
            self.world,
            self.number,
            shape,
            self.raw_bytes / 1024,
            self.wire_bytes / 1024,
            show(server),
            show(actor),
            show(world_wait),
            show(modifier),
            show(build),
            show(encode),
            show(queue),
            show(write),
            show(self.since_read(self.acked_at)),
            session,
            show(self.since_read(self.first_request_at)),
            self.held_dispatches,
            self.held_chunks,
            show(self.since_read(self.load_queued_at)),
            show(self.since_read(self.load_encoded_at)),
            show(self.since_read(self.load_sent_at)),
            show(self.since_read(self.load_written_at)),
            self.load_chunks,
            self.load_bytes / 1024,
            window.members.len(),
            window
                .centers
                .iter()
                .map(|center| format!("({}, {})", center.0, center.1))
                .collect::<Vec<_>>()
                .join(" "),
            window.dispatches,
            window.held,
            window.over_budget,
            window.unready,
            show(self.since_read(window.served_at)),
            window
                .load
                .map_or_else(|| "-".to_owned(), |load| load.to_string()),
            show(self.since_read(window.load_queued_at)),
            show(self.since_read(window.load_encoded_at)),
            show(self.since_read(window.sent_at)),
            show(self.since_read(window.written_at)),
            outcome,
        );

        perf::log(
            "join_trace",
            &self.world,
            json!({
                "clientId": self.client_id,
                "join": self.number,
                "outcome": outcome,
                "registryCached": self.registry_cached,
                "initRawBytes": self.raw_bytes,
                "initWireBytes": self.wire_bytes,
                "serverMs": server,
                "stagesMs": {
                    "actor": actor,
                    "worldWait": world_wait,
                    "modifier": modifier,
                    "build": build,
                    "encode": encode,
                    "queue": queue,
                    "write": write,
                },
                "upgradeToRegisteredMs": upgrade_to_registered,
                "registeredToJoinReadMs": registered_to_read,
                "sinceJoinReadMs": {
                    "acked": self.since_read(self.acked_at),
                    "initWritten": server,
                    "firstChunkRequest": self.since_read(self.first_request_at),
                    "firstLoadQueued": self.since_read(self.load_queued_at),
                    "firstLoadEncoded": self.since_read(self.load_encoded_at),
                    "firstLoadSent": self.since_read(self.load_sent_at),
                    "firstLoadWritten": self.since_read(self.load_written_at),
                    "windowServed": self.since_read(window.served_at),
                    "windowLoadQueued": self.since_read(window.load_queued_at),
                    "windowLoadEncoded": self.since_read(window.load_encoded_at),
                    "windowLoadSent": self.since_read(window.sent_at),
                    "windowLoadWritten": self.since_read(window.written_at),
                },
                "spawnWindow": {
                    "chunks": window.members.len(),
                    "centers": window.centers.iter().map(|c| [c.0, c.1]).collect::<Vec<_>>(),
                    "left": window.left.as_ref().map(|left| left.len()),
                    "dispatches": window.dispatches,
                    "heldChunkDispatches": window.held,
                    "overBudgetChunkDispatches": window.over_budget,
                    "unreadyChunks": window.unready,
                    "load": window.load,
                    "loadsQueued": window.loads_queued,
                    "loadsSent": window.loads_sent,
                },
                "activationHeldDispatches": self.held_dispatches,
                "activationHeldChunks": self.held_chunks,
                "firstLoadChunks": self.load_chunks,
                "firstLoadBytes": self.load_bytes,
            }),
        );
    }
}

/// The INIT's own `serverTiming`: the world stages of the join it answers,
/// serialized as the INIT text is written so `buildMs` covers the build up
/// to its last field. An INIT cannot carry its own encode, so `encodeMs` and
/// `wireBytes` describe the previous INIT of the same shape (full or with
/// the registry left out) this server encoded, flagged by
/// `encodeSample: "previousInit"`, and are absent until there is one.
pub(crate) struct InitServerTiming {
    pub world_wait_ms: Option<f64>,
    pub modifier_ms: Option<f64>,
    pub build_started: Instant,
    pub previous_encode: Option<(f64, usize)>,
}

/// INIT key carrying [`InitServerTiming`].
pub const INIT_SERVER_TIMING_KEY: &str = "serverTiming";

impl InitServerTiming {
    pub(crate) fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

impl Serialize for InitServerTiming {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let round = |ms: f64| (ms * 100.0).round() / 100.0;
        let mut map = serializer.serialize_map(None)?;
        if let Some(ms) = self.world_wait_ms {
            map.serialize_entry("worldWaitMs", &round(ms))?;
        }
        if let Some(ms) = self.modifier_ms {
            map.serialize_entry("modifierMs", &round(ms))?;
        }
        map.serialize_entry(
            "buildMs",
            &round(self.build_started.elapsed().as_secs_f64() * 1000.0),
        )?;
        if let Some((encode_ms, wire_bytes)) = self.previous_encode {
            map.serialize_entry("encodeMs", &round(encode_ms))?;
            map.serialize_entry("wireBytes", &wire_bytes)?;
            map.serialize_entry("encodeSample", "previousInit")?;
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn traced_join(trace: &JoinTrace) {
        trace.begin(Instant::now());
        trace.forwarded("client", "world");
        trace.world_dequeued();
        trace.modifier_done();
        trace.init_built(1000, false);
        trace.init_encoded(400);
        trace.init_queued(2);
    }

    #[test]
    fn the_init_write_is_the_one_at_its_lane_position() {
        let trace = JoinTrace::default();
        traced_join(&trace);
        trace.control_written(1);
        assert!(trace.state().join.as_ref().unwrap().written_at.is_none());
        trace.control_written(2);
        assert!(trace.state().join.as_ref().unwrap().written_at.is_some());
    }

    #[test]
    fn the_first_load_is_claimed_once_and_its_write_reports_the_join() {
        let trace = JoinTrace::default();
        traced_join(&trace);
        let now = Instant::now();
        assert_eq!(trace.first_load_sent("elsewhere", now, now, 1, 10), None);
        assert_eq!(trace.first_load_sent("world", now, now, 4, 4096), Some(1));
        assert_eq!(trace.first_load_sent("world", now, now, 4, 4096), None);
        trace.first_load_written(1);
        assert!(!trace.is_active());
        assert!(trace.state().join.is_none());
    }

    #[test]
    fn the_join_is_reported_when_its_spawn_window_is_written() {
        use RequestOutcome::*;
        let trace = JoinTrace::default();
        traced_join(&trace);
        let center = Vec2(0, 0);
        // (5, 5) is requested but outside the window; (1, 0) waits on its
        // activation, (0, 1) is not ready yet.
        trace.chunk_requests(
            &center,
            &[
                (Vec2(0, 0), Served),
                (Vec2(1, 0), Held),
                (Vec2(0, 1), Unready),
                (Vec2(5, 5), Served),
            ],
        );
        trace.load_queued([Vec2(0, 0), Vec2(5, 5)]);
        trace.chunk_requests(&center, &[(Vec2(1, 0), Served)]);
        trace.load_queued([Vec2(1, 0)]);
        // The pipeline's meshes-only LOAD counts but serves nothing.
        trace.load_queued([]);
        trace.load_queued([Vec2(0, 1)]);
        let now = Instant::now();
        assert_eq!(trace.first_load_sent("world", now, now, 2, 10), Some(1));
        assert_eq!(trace.first_load_sent("world", now, now, 1, 10), None);
        assert_eq!(trace.first_load_sent("world", now, now, 1, 10), None);
        assert_eq!(trace.first_load_sent("world", now, now, 1, 10), Some(1));
        trace.first_load_written(1);
        assert!(trace.is_active(), "the first LOAD alone does not finish it");
        {
            let state = trace.state();
            let window = &state.join.as_ref().unwrap().window;
            assert_eq!(window.members.len(), 3);
            assert_eq!(window.load, Some(4));
            assert_eq!((window.dispatches, window.held, window.unready), (2, 1, 1));
            assert!(window.served_at.is_some() && window.written_at.is_none());
        }
        trace.first_load_written(1);
        assert!(!trace.is_active());
    }

    #[test]
    fn the_window_follows_the_center_until_it_is_served() {
        use RequestOutcome::*;
        let trace = JoinTrace::default();
        traced_join(&trace);
        // The first request comes from where the client stood before it was
        // placed one chunk north; its window is still held.
        trace.chunk_requests(&Vec2(0, 0), &[(Vec2(0, 0), Held), (Vec2(0, -1), Held)]);
        trace.chunk_requests(
            &Vec2(0, 1),
            &[
                (Vec2(0, 0), Served),
                (Vec2(0, -1), Served),
                (Vec2(0, 2), Held),
            ],
        );
        trace.load_queued([Vec2(0, 0), Vec2(0, -1)]);
        {
            let state = trace.state();
            let window = &state.join.as_ref().unwrap().window;
            assert_eq!(window.centers, vec![Vec2(0, 0), Vec2(0, 1)]);
            assert_eq!(window.members.len(), 3);
            assert!(window.load.is_none(), "(0, 2) is still held");
        }
        trace.chunk_requests(&Vec2(0, 1), &[(Vec2(0, 2), Served)]);
        trace.load_queued([Vec2(0, 2)]);
        assert_eq!(trace.state().join.as_ref().unwrap().window.load, Some(2));
    }

    #[test]
    fn a_window_served_in_the_first_load_is_reported_at_its_write() {
        let trace = JoinTrace::default();
        traced_join(&trace);
        let window: Vec<_> = (-1..=1)
            .flat_map(|x| (-1..=1).map(move |z| (Vec2(x, z), RequestOutcome::Served)))
            .collect();
        trace.chunk_requests(&Vec2(0, 0), &window);
        trace.load_queued(window.iter().map(|(coords, _)| coords.clone()));
        let now = Instant::now();
        assert_eq!(trace.first_load_sent("world", now, now, 9, 10), Some(1));
        trace.first_load_written(1);
        assert!(!trace.is_active());
    }

    #[test]
    fn a_stale_first_load_does_not_close_the_next_join() {
        let trace = JoinTrace::default();
        traced_join(&trace);
        let now = Instant::now();
        let first = trace.first_load_sent("world", now, now, 1, 10).unwrap();
        // The player switched worlds while that LOAD sat on the bulk lane.
        traced_join(&trace);
        trace.first_load_written(first);
        assert!(trace.is_active(), "join #2 is still in flight");
        assert_eq!(trace.state().join.as_ref().unwrap().number, 2);
    }

    #[test]
    fn a_load_before_the_init_is_not_the_joins_first() {
        let trace = JoinTrace::default();
        trace.begin(Instant::now());
        trace.forwarded("client", "world");
        let now = Instant::now();
        assert_eq!(trace.first_load_sent("world", now, now, 1, 10), None);
    }

    #[test]
    fn a_second_join_supersedes_the_first_and_only_the_first_carries_the_session() {
        let trace = JoinTrace::default();
        trace.session_registered(Instant::now());
        traced_join(&trace);
        assert!(trace.state().join.as_ref().unwrap().upgraded_at.is_some());
        traced_join(&trace);
        let state = trace.state();
        let join = state.join.as_ref().unwrap();
        assert_eq!(join.number, 2);
        assert!(join.upgraded_at.is_none());
    }

    #[test]
    fn stamps_after_the_report_are_ignored() {
        let trace = JoinTrace::default();
        traced_join(&trace);
        trace.session_ended();
        trace.world_dequeued();
        trace.control_written(5);
        assert!(trace.state().join.is_none());
    }

    #[test]
    fn server_timing_names_the_world_stages_and_flags_a_borrowed_encode() {
        let timing = InitServerTiming {
            world_wait_ms: Some(4.25),
            modifier_ms: Some(1.0),
            build_started: Instant::now(),
            previous_encode: Some((21.5, 1_700_000)),
        };
        let value = timing.to_value();
        assert_eq!(value["worldWaitMs"], json!(4.25));
        assert_eq!(value["modifierMs"], json!(1.0));
        assert!(value["buildMs"].as_f64().unwrap() >= 0.0);
        assert_eq!(value["encodeMs"], json!(21.5));
        assert_eq!(value["wireBytes"], json!(1_700_000));
        assert_eq!(value["encodeSample"], json!("previousInit"));

        let first = InitServerTiming {
            world_wait_ms: None,
            modifier_ms: None,
            build_started: Instant::now(),
            previous_encode: None,
        }
        .to_value();
        assert!(first.get("encodeMs").is_none());
        assert!(first.get("worldWaitMs").is_none());
    }
}

/// One JOIN through a real server and world, stamped the way the socket loop
/// stamps it: every server stage lands, in order, and the INIT says what the
/// world spent on it.
#[cfg(test)]
mod join_tests {
    use std::io::Read;

    use serde_json::{json, Value};
    use tokio::sync::mpsc;

    use super::*;
    use crate::{
        decode_message, Block, GetWorldStats, Message, MessageType, Registry, Server,
        SessionIdentity, World, WorldConfig, WsSender,
    };

    const WORLD: &str = "traced";

    /// Join `client` as the socket loop would, and return its sender and INIT.
    async fn traced_join(server: &mut Server, client: &str) -> (WsSender, Value) {
        let (control_tx, mut control_rx) = mpsc::unbounded_channel();
        let (bulk_tx, _bulk_rx) = mpsc::unbounded_channel();
        let sender = WsSender::new(control_tx, bulk_tx);
        let upgraded_at = Instant::now();
        let (id, token) =
            server.register_session(SessionIdentity::for_client(client), false, sender.clone());
        sender.join_trace().session_registered(upgraded_at);

        sender.join_trace().begin(Instant::now());
        let join = Message::new(&MessageType::Join)
            .json(&json!({ "world": WORLD, "username": client }).to_string())
            .build();
        assert_eq!(server.on_request(&id, join, None, 0, Some(&token)), None);
        sender.join_trace().acked();
        server
            .get_world(WORLD)
            .unwrap()
            .send(GetWorldStats)
            .await
            .unwrap();

        let mut init = None;
        while let Ok(bytes) = control_rx.try_recv() {
            sender.mark_control_written();
            let message = decode_message(&bytes).ok().or_else(|| {
                let mut decoded = Vec::new();
                lz4_flex::frame::FrameDecoder::new(&bytes[..])
                    .read_to_end(&mut decoded)
                    .ok()?;
                decode_message(&decoded).ok()
            });
            if let Some(message) = message.filter(|m| m.r#type == MessageType::Init as i32) {
                init = Some(serde_json::from_str(&message.json).unwrap());
            }
        }
        (sender, init.expect("an INIT"))
    }

    #[test]
    fn a_join_through_the_server_and_world_stamps_every_server_stage() {
        actix::System::new().block_on(async {
            let mut registry = Registry::new();
            registry.register_blocks(&[Block::new("Stone").id(1).build()]);
            let mut server = Server::new().debug(false).registry(&registry).build();
            server
                .add_world(World::new(WORLD, &WorldConfig::new().build()))
                .expect("world should register");

            let (sender, init) = traced_join(&mut server, "first").await;
            {
                let state = sender.join_trace().state();
                let join = state.join.as_ref().expect("no LOAD yet: still in flight");
                assert_eq!(
                    (join.client_id.as_str(), join.world.as_str()),
                    ("first", WORLD)
                );
                assert!(join.upgraded_at.is_some() && join.registered_at.is_some());
                let stamps = [
                    Some(join.read_at),
                    join.forwarded_at,
                    join.dequeued_at,
                    join.modifier_at,
                    join.built_at,
                    join.encoded_at,
                    join.queued_at,
                    join.written_at,
                ];
                assert!(
                    stamps.iter().all(Option::is_some),
                    "every server stage stamped"
                );
                assert!(
                    stamps.windows(2).all(|pair| pair[0] <= pair[1]),
                    "stages in order"
                );
                assert!(join.acked_at.is_some());
                assert!(!join.registry_cached);
                assert!(join.raw_bytes > 0 && join.wire_bytes > 0);
            }
            let timing = &init[INIT_SERVER_TIMING_KEY];
            assert!(timing["worldWaitMs"].as_f64().is_some(), "{timing}");
            assert!(timing["modifierMs"].as_f64().is_some(), "{timing}");
            assert!(timing["buildMs"].as_f64().is_some(), "{timing}");
            assert!(
                timing.get("encodeMs").is_none(),
                "the server's first full INIT has no earlier encode to cite: {timing}"
            );

            // The next full INIT cites the first one's encode.
            let (_, init) = traced_join(&mut server, "second").await;
            let timing = &init[INIT_SERVER_TIMING_KEY];
            assert!(timing["encodeMs"].as_f64().is_some(), "{timing}");
            assert!(timing["wireBytes"].as_u64().unwrap() > 0, "{timing}");
            assert_eq!(timing["encodeSample"], json!("previousInit"));

            // The session closing reports the join in flight and stops it.
            sender.join_trace().session_ended();
            assert!(!sender.join_trace().is_active());
        });
    }
}
