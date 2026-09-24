//! Per-world tick statistics and the slow-tick flight recorder.
//!
//! Each world owns a [`TickRecorder`] that only its own thread touches. Once
//! per tick it appends one fixed-size [`TickSample`] to a ring shared with the
//! HTTP layer ([`TickStatsShared`]). The world thread takes that ring's lock
//! with `try_lock` once per tick and never waits on it: if a reader is copying
//! the ring at that moment, the sample goes to a small local backlog and is
//! flushed on the next tick. Readers copy the ring out under the lock and do
//! all sorting and percentile work after releasing it.
//!
//! What a sample measures (all wall-clock unless named CPU):
//!
//! - `total`: the whole tick handler, started **before** inbound state is
//!   applied, so peer packet parsing and preload bookkeeping count.
//! - `inbound`, `dispatch`, `maintain`: the parts of `total`.
//! - `cpu`: this thread's CPU time over the same span
//!   (`CLOCK_THREAD_CPUTIME_ID`). Wall far above CPU means the tick waited:
//!   on a rayon barrier, on a lock, or runnable but descheduled.
//! - `interval`: start-to-start time since the previous tick.
//! - `lateness`: start time minus the slot the Server's timer scheduled this
//!   tick for. It covers the timer's own delay, the hop through the actor
//!   system and any mailbox work queued ahead of the tick. A slot skipped
//!   because the previous tick was still running shows up in `interval`.
//! - `mailbox`: time and count of the actor messages (client requests, joins,
//!   stats reads) handled on the world thread since the previous tick.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use hashbrown::HashMap;
use lazy_static::lazy_static;
use log::warn;
use serde::Serialize;

use super::shared_pools::{pool_inflight, PoolInflight};

/// Ring capacity: 60 s at the Server's 16 ms cadence (62.5 Hz).
pub const TICK_STATS_CAPACITY: usize = 3750;

/// The tick period used when none is known (direct `World::tick` calls).
pub const DEFAULT_TICK_PERIOD: Duration = Duration::from_millis(16);

/// Overrun thresholds counted per window and over the world's lifetime.
const OVERRUN_ONE_FRAME_US: u32 = 16_000;
const OVERRUN_TWO_FRAMES_US: u32 = 33_000;

/// Sentinel for "no value" (the first tick has no interval).
const NONE_US: u32 = u32::MAX;

/// Samples kept locally while a reader holds the ring lock.
const BACKLOG_CAPACITY: usize = 64;

/// Systems named by the flight recorder.
const TOP_SYSTEMS: usize = 5;

/// Slow-tick warnings per world: at most one per second for a world with
/// players in it, one per ten seconds for a world nobody is in.
const SLOW_WARN_INTERVAL: Duration = Duration::from_secs(1);
const SLOW_WARN_INTERVAL_EMPTY: Duration = Duration::from_secs(10);

/// One tick, in microseconds (saturating at `u32::MAX - 1`, about 71 min).
#[derive(Clone, Copy, Debug, Default)]
pub struct TickSample {
    /// Milliseconds since the recorder's epoch when the tick started.
    pub start_ms: u32,
    pub total_us: u32,
    pub inbound_us: u32,
    pub dispatch_us: u32,
    pub maintain_us: u32,
    pub cpu_us: u32,
    pub interval_us: u32,
    pub lateness_us: u32,
    pub mailbox_us: u32,
    pub mailbox_messages: u16,
    pub clients: u16,
    /// Dispatched as a hibernating world's (no clients, reduced rate).
    pub hibernating: bool,
}

fn micros(duration: Duration) -> u32 {
    duration.as_micros().min((NONE_US - 1) as u128) as u32
}

struct TickRing {
    samples: Box<[TickSample]>,
    next: usize,
    len: usize,
    lifetime_ticks: u64,
    lifetime_over_one_frame: u64,
    lifetime_over_two_frames: u64,
    /// Ticks delivered to a hibernating world that did not dispatch.
    lifetime_hibernated_skips: u64,
    period_us: u32,
}

impl TickRing {
    fn new() -> Self {
        Self {
            samples: vec![TickSample::default(); TICK_STATS_CAPACITY].into_boxed_slice(),
            next: 0,
            len: 0,
            lifetime_ticks: 0,
            lifetime_over_one_frame: 0,
            lifetime_over_two_frames: 0,
            lifetime_hibernated_skips: 0,
            period_us: micros(DEFAULT_TICK_PERIOD),
        }
    }

    fn push(&mut self, sample: TickSample) {
        self.samples[self.next] = sample;
        self.next = (self.next + 1) % self.samples.len();
        self.len = (self.len + 1).min(self.samples.len());
        self.lifetime_ticks += 1;
        if sample.total_us > OVERRUN_ONE_FRAME_US {
            self.lifetime_over_one_frame += 1;
        }
        if sample.total_us > OVERRUN_TWO_FRAMES_US {
            self.lifetime_over_two_frames += 1;
        }
    }

    /// Samples oldest first.
    fn ordered(&self) -> Vec<TickSample> {
        let capacity = self.samples.len();
        let start = (self.next + capacity - self.len) % capacity;
        (0..self.len)
            .map(|offset| self.samples[(start + offset) % capacity])
            .collect()
    }
}

/// The half of a world's tick statistics that readers see.
pub struct TickStatsShared {
    epoch: Instant,
    ring: Mutex<TickRing>,
}

impl TickStatsShared {
    fn new() -> Self {
        Self {
            epoch: Instant::now(),
            ring: Mutex::new(TickRing::new()),
        }
    }

    /// Milliseconds since the epoch, wrapping every 2^32 ms (49.7 days).
    /// Readers only ever compare two of these with `wrapping_sub`, and the
    /// ring spans hours at most, so the wrap never makes an age ambiguous.
    fn millis_since_epoch(&self, at: Instant) -> u32 {
        at.saturating_duration_since(self.epoch).as_millis() as u64 as u32
    }

    /// Summarize the last 10 s and 60 s. The lock is held only for the copy.
    pub fn report(&self, world: &str) -> TickStatsReport {
        let (samples, lifetime, hibernated_skips, period_us) = {
            let ring = self.ring.lock().unwrap_or_else(|e| e.into_inner());
            (
                ring.ordered(),
                (
                    ring.lifetime_ticks,
                    ring.lifetime_over_one_frame,
                    ring.lifetime_over_two_frames,
                ),
                ring.lifetime_hibernated_skips,
                ring.period_us,
            )
        };
        // Read the clock after the copy, so no copied sample started after
        // `now` (its age would wrap to ~49 days and drop it from every window).
        let now_ms = self.millis_since_epoch(Instant::now());
        let oldest_ms = samples.first().map(|s| s.start_ms);
        let last_tick_age_ms = samples
            .last()
            .map(|s| now_ms.wrapping_sub(s.start_ms) as f64);

        TickStatsReport {
            world: world.to_owned(),
            period_ms: period_us as f64 / 1000.0,
            capacity: TICK_STATS_CAPACITY,
            samples: samples.len(),
            cpu_clock: thread_cpu_clock_available(),
            last_tick_age_ms,
            lifetime_ticks: lifetime.0,
            lifetime_overruns_over16ms: lifetime.1,
            lifetime_overruns_over33ms: lifetime.2,
            lifetime_hibernated_skips: hibernated_skips,
            hibernating: samples.last().is_some_and(|s| s.hibernating),
            pool_inflight: pool_inflight(),
            last10s: window_report(&samples, now_ms, oldest_ms, 10),
            last60s: window_report(&samples, now_ms, oldest_ms, 60),
        }
    }

    /// The last 10 s in a few numbers, for the all-worlds listing.
    pub fn brief(&self, world: &str) -> TickStatsBrief {
        let report = self.report(world);
        let window = report.last10s;
        TickStatsBrief {
            world: report.world,
            hibernating: report.hibernating,
            hz: window.hz,
            tick_p50_ms: window.tick_total_ms.p50,
            tick_p99_ms: window.tick_total_ms.p99,
            tick_max_ms: window.tick_total_ms.max,
            interval_p99_ms: window.interval_ms.p99,
            cpu_wall_ratio: window.cpu_wall_ratio,
            busy_ratio: window.busy_ratio,
            clients_max: window.clients_max,
        }
    }
}

/// p50/p95/p99/max/mean of one measure, in milliseconds.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Percentiles {
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
    pub max: f64,
    pub mean: f64,
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

/// Nearest-rank percentiles over microsecond values, reported in ms.
fn percentiles(mut values: Vec<u32>) -> Percentiles {
    if values.is_empty() {
        return Percentiles::default();
    }
    values.sort_unstable();
    let n = values.len();
    let rank = |p: f64| {
        let index = ((p * n as f64).ceil() as usize).clamp(1, n) - 1;
        values[index] as f64 / 1000.0
    };
    let sum: u64 = values.iter().map(|&v| v as u64).sum();
    Percentiles {
        p50: round3(rank(0.50)),
        p95: round3(rank(0.95)),
        p99: round3(rank(0.99)),
        max: round3(values[n - 1] as f64 / 1000.0),
        mean: round3(sum as f64 / n as f64 / 1000.0),
    }
}

/// One window of the report.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickWindowReport {
    pub window_secs: u32,
    /// Seconds the window actually covers (shorter while the ring fills).
    pub span_secs: f64,
    pub ticks: usize,
    /// Ticks per second achieved over the window.
    pub hz: f64,
    pub tick_total_ms: Percentiles,
    pub inbound_ms: Percentiles,
    pub dispatch_ms: Percentiles,
    pub maintain_ms: Percentiles,
    pub cpu_ms: Percentiles,
    pub interval_ms: Percentiles,
    pub lateness_ms: Percentiles,
    pub mailbox_ms: Percentiles,
    pub mailbox_messages: u64,
    pub mailbox_messages_max_per_tick: u16,
    /// Sum of thread CPU over sum of tick wall time. Low means the tick
    /// spent its time waiting rather than working.
    pub cpu_wall_ratio: Option<f64>,
    /// Fraction of the window the world thread spent inside a tick.
    pub busy_ratio: f64,
    pub overruns_over16ms: usize,
    pub overruns_over33ms: usize,
    pub clients_max: u16,
    /// Dispatches in the window that ran as a hibernating world's.
    pub hibernating_ticks: usize,
}

fn window_report(
    samples: &[TickSample],
    now_ms: u32,
    oldest_ms: Option<u32>,
    window_secs: u32,
) -> TickWindowReport {
    let window_ms = window_secs * 1000;
    // Ages, not absolute times: `start_ms` wraps every 49.7 days.
    let age = |start_ms: u32| now_ms.wrapping_sub(start_ms);
    let in_window: Vec<&TickSample> = samples
        .iter()
        .filter(|s| age(s.start_ms) <= window_ms)
        .collect();
    // The window covers the full length once the ring holds older samples;
    // before that it starts at the oldest sample.
    let span_ms = oldest_ms.map_or(0, |oldest| age(oldest).min(window_ms));
    let span_secs = span_ms as f64 / 1000.0;

    let collect = |field: fn(&TickSample) -> u32| -> Vec<u32> {
        in_window
            .iter()
            .map(|s| field(s))
            .filter(|&v| v != NONE_US)
            .collect()
    };
    let wall_us: u64 = in_window.iter().map(|s| s.total_us as u64).sum();
    let cpu_us: u64 = in_window.iter().map(|s| s.cpu_us as u64).sum();
    let cpu_known = thread_cpu_clock_available();

    TickWindowReport {
        window_secs,
        span_secs: round3(span_secs),
        ticks: in_window.len(),
        hz: if span_secs > 0.0 {
            round3(in_window.len() as f64 / span_secs)
        } else {
            0.0
        },
        tick_total_ms: percentiles(collect(|s| s.total_us)),
        inbound_ms: percentiles(collect(|s| s.inbound_us)),
        dispatch_ms: percentiles(collect(|s| s.dispatch_us)),
        maintain_ms: percentiles(collect(|s| s.maintain_us)),
        cpu_ms: percentiles(collect(|s| s.cpu_us)),
        interval_ms: percentiles(collect(|s| s.interval_us)),
        lateness_ms: percentiles(collect(|s| s.lateness_us)),
        mailbox_ms: percentiles(collect(|s| s.mailbox_us)),
        mailbox_messages: in_window.iter().map(|s| s.mailbox_messages as u64).sum(),
        mailbox_messages_max_per_tick: in_window
            .iter()
            .map(|s| s.mailbox_messages)
            .max()
            .unwrap_or(0),
        cpu_wall_ratio: (cpu_known && wall_us > 0).then(|| round3(cpu_us as f64 / wall_us as f64)),
        busy_ratio: if span_ms > 0 {
            round3(wall_us as f64 / (span_ms as f64 * 1000.0))
        } else {
            0.0
        },
        overruns_over16ms: in_window
            .iter()
            .filter(|s| s.total_us > OVERRUN_ONE_FRAME_US)
            .count(),
        overruns_over33ms: in_window
            .iter()
            .filter(|s| s.total_us > OVERRUN_TWO_FRAMES_US)
            .count(),
        clients_max: in_window.iter().map(|s| s.clients).max().unwrap_or(0),
        hibernating_ticks: in_window.iter().filter(|s| s.hibernating).count(),
    }
}

/// `GET /tick/stats?world=<name>`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickStatsReport {
    pub world: String,
    pub period_ms: f64,
    pub capacity: usize,
    pub samples: usize,
    /// Whether per-thread CPU time is available on this platform.
    pub cpu_clock: bool,
    pub last_tick_age_ms: Option<f64>,
    pub lifetime_ticks: u64,
    pub lifetime_overruns_over16ms: u64,
    pub lifetime_overruns_over33ms: u64,
    /// Ticks delivered while the world hibernated that ran no dispatch.
    pub lifetime_hibernated_skips: u64,
    /// Whether the latest dispatch ran as a hibernating world's.
    pub hibernating: bool,
    /// Engine jobs queued or running on the shared worker pools, process-wide.
    pub pool_inflight: PoolInflight,
    #[serde(rename = "10s")]
    pub last10s: TickWindowReport,
    #[serde(rename = "60s")]
    pub last60s: TickWindowReport,
}

/// One row of `GET /tick/stats` without a world.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickStatsBrief {
    pub world: String,
    pub hibernating: bool,
    pub hz: f64,
    pub tick_p50_ms: f64,
    pub tick_p99_ms: f64,
    pub tick_max_ms: f64,
    pub interval_p99_ms: f64,
    pub cpu_wall_ratio: Option<f64>,
    pub busy_ratio: f64,
    pub clients_max: u16,
}

lazy_static! {
    static ref TICK_STATS: RwLock<HashMap<String, Arc<TickStatsShared>>> =
        RwLock::new(HashMap::new());
}

fn register(world: &str, shared: &Arc<TickStatsShared>) {
    TICK_STATS
        .write()
        .unwrap_or_else(|e| e.into_inner())
        .insert(world.to_owned(), Arc::clone(shared));
}

fn unregister(world: &str, shared: &Arc<TickStatsShared>) {
    let mut map = TICK_STATS.write().unwrap_or_else(|e| e.into_inner());
    if map.get(world).is_some_and(|current| Arc::ptr_eq(current, shared)) {
        map.remove(world);
    }
}

/// The tick statistics of one world, or `None` when no world has that name.
pub fn get_tick_stats(world: &str) -> Option<TickStatsReport> {
    let shared = TICK_STATS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(world)
        .cloned()?;
    Some(shared.report(world))
}

/// A 10 s summary of every world, busiest first.
pub fn get_tick_stats_all() -> Vec<TickStatsBrief> {
    let worlds: Vec<(String, Arc<TickStatsShared>)> = TICK_STATS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .map(|(name, shared)| (name.clone(), Arc::clone(shared)))
        .collect();
    let mut briefs: Vec<TickStatsBrief> = worlds
        .iter()
        .map(|(name, shared)| shared.brief(name))
        .collect();
    briefs.sort_by(|a, b| b.busy_ratio.total_cmp(&a.busy_ratio));
    briefs
}

// ---------------------------------------------------------------------------
// Thread CPU clock

static CPU_CLOCK_FAILED: AtomicBool = AtomicBool::new(false);

fn thread_cpu_clock_available() -> bool {
    cfg!(unix) && !CPU_CLOCK_FAILED.load(Ordering::Relaxed)
}

/// CPU time consumed by the calling thread, or `None` where unsupported.
pub fn thread_cpu_time() -> Option<Duration> {
    #[cfg(unix)]
    {
        let mut ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        // SAFETY: `ts` is a valid, writable timespec for the call.
        let rc = unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut ts) };
        if rc == 0 {
            return Some(Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32));
        }
        if !CPU_CLOCK_FAILED.swap(true, Ordering::Relaxed) {
            warn!(
                "[tick-stats] clock_gettime(CLOCK_THREAD_CPUTIME_ID) failed ({}); tick CPU time is not recorded",
                std::io::Error::last_os_error()
            );
        }
        None
    }
    #[cfg(not(unix))]
    {
        None
    }
}

// ---------------------------------------------------------------------------
// Per-thread scratch: mailbox time between ticks and the costliest systems of
// the current tick. A world's actor runs every handler and every tick on one
// thread, so thread-local state needs no locks.

#[derive(Clone, Copy)]
struct TickScratch {
    in_tick: bool,
    top: [(&'static str, u32); TOP_SYSTEMS],
    mailbox_us: u64,
    mailbox_messages: u32,
}

impl TickScratch {
    const fn new() -> Self {
        Self {
            in_tick: false,
            top: [("", 0); TOP_SYSTEMS],
            mailbox_us: 0,
            mailbox_messages: 0,
        }
    }
}

thread_local! {
    static SCRATCH: RefCell<TickScratch> = const { RefCell::new(TickScratch::new()) };
}

/// Called by the system timer for every timed system on the world thread.
pub(crate) fn note_system_time(name: &'static str, elapsed: Duration) {
    let us = micros(elapsed);
    SCRATCH.with(|scratch| {
        let Ok(mut scratch) = scratch.try_borrow_mut() else {
            return;
        };
        if !scratch.in_tick {
            return;
        }
        let top = &mut scratch.top;
        if us <= top[TOP_SYSTEMS - 1].1 {
            return;
        }
        let mut index = TOP_SYSTEMS - 1;
        top[index] = (name, us);
        while index > 0 && top[index].1 > top[index - 1].1 {
            top.swap(index, index - 1);
            index -= 1;
        }
    });
}

/// Times one actor message handled on a world thread between ticks.
pub(crate) struct MailboxTimer {
    started: Instant,
}

impl MailboxTimer {
    pub(crate) fn start() -> Self {
        Self {
            started: Instant::now(),
        }
    }
}

impl Drop for MailboxTimer {
    fn drop(&mut self) {
        let us = self.started.elapsed().as_micros() as u64;
        SCRATCH.with(|scratch| {
            if let Ok(mut scratch) = scratch.try_borrow_mut() {
                scratch.mailbox_us = scratch.mailbox_us.saturating_add(us);
                scratch.mailbox_messages = scratch.mailbox_messages.saturating_add(1);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Recorder (world thread only)

/// The parts of a tick measured by the world, handed to [`TickRecorder::finish`].
pub(crate) struct TickParts {
    pub inbound: Duration,
    pub dispatch_ms: f64,
    pub maintain_ms: f64,
    pub clients: usize,
    /// This dispatch ran as a hibernating world's.
    pub hibernating: bool,
    /// The gap since the previous dispatch that is on schedule: the
    /// hibernation interval for a hibernating world's dispatch (and the first
    /// one after it wakes), zero otherwise. A longer interval than the period
    /// is only slow when it is also over twice this.
    pub expected_interval: Duration,
}

/// A tick in progress, from [`TickRecorder::begin`].
pub(crate) struct TickInProgress {
    started: Instant,
    cpu_started: Option<Duration>,
    period: Duration,
    interval_us: u32,
    lateness_us: u32,
    mailbox_us: u32,
    mailbox_messages: u16,
}

/// Owned by a [`super::World`]; records every tick into the shared ring and
/// warns about slow ones.
pub(crate) struct TickRecorder {
    world: String,
    shared: Arc<TickStatsShared>,
    backlog: Vec<TickSample>,
    backlog_dropped: u64,
    /// Hibernated skips not yet added to the shared ring's lifetime count.
    pending_skips: u64,
    last_started: Option<Instant>,
    last_warned: Option<Instant>,
    slow_since_warn: u32,
}

impl TickRecorder {
    pub(crate) fn new(world: &str) -> Self {
        let shared = Arc::new(TickStatsShared::new());
        register(world, &shared);
        Self {
            world: world.to_owned(),
            shared,
            backlog: Vec::with_capacity(BACKLOG_CAPACITY),
            backlog_dropped: 0,
            pending_skips: 0,
            last_started: None,
            last_warned: None,
            slow_since_warn: 0,
        }
    }

    /// Count a tick a hibernating world received without dispatching. It is
    /// not a sample: windows, Hz and intervals describe dispatches only.
    pub(crate) fn note_hibernated_skip(&mut self) {
        self.pending_skips = self.pending_skips.saturating_add(1);
    }

    /// Re-register under a new world name (pooled world reuse).
    pub(crate) fn rename(&mut self, world: &str) {
        unregister(&self.world, &self.shared);
        self.world = world.to_owned();
        self.shared = Arc::new(TickStatsShared::new());
        self.backlog.clear();
        self.last_started = None;
        self.last_warned = None;
        self.slow_since_warn = 0;
        register(world, &self.shared);
    }

    /// Start timing a tick. Call first thing in the tick handler.
    pub(crate) fn begin(&mut self, scheduled_at: Instant, period: Duration) -> TickInProgress {
        let started = Instant::now();
        let cpu_started = thread_cpu_time();
        let (mailbox_us, mailbox_messages) = SCRATCH.with(|scratch| {
            let Ok(mut scratch) = scratch.try_borrow_mut() else {
                return (0, 0);
            };
            let taken = (scratch.mailbox_us, scratch.mailbox_messages);
            *scratch = TickScratch::new();
            scratch.in_tick = true;
            taken
        });
        let interval_us = self
            .last_started
            .map_or(NONE_US, |last| micros(started.saturating_duration_since(last)));
        self.last_started = Some(started);
        TickInProgress {
            started,
            cpu_started,
            period,
            interval_us,
            lateness_us: micros(started.saturating_duration_since(scheduled_at)),
            mailbox_us: mailbox_us.min((NONE_US - 1) as u64) as u32,
            mailbox_messages: mailbox_messages.min(u16::MAX as u32) as u16,
        }
    }

    /// Finish a tick: record its sample and, if it was slow, maybe warn.
    pub(crate) fn finish(&mut self, tick: TickInProgress, parts: TickParts) {
        let total = tick.started.elapsed();
        let cpu = match (tick.cpu_started, thread_cpu_time()) {
            (Some(before), Some(after)) => after.saturating_sub(before),
            _ => Duration::ZERO,
        };
        let top = SCRATCH.with(|scratch| match scratch.try_borrow_mut() {
            Ok(mut scratch) => {
                scratch.in_tick = false;
                scratch.top
            }
            Err(_) => TickScratch::new().top,
        });

        let sample = TickSample {
            start_ms: self.shared.millis_since_epoch(tick.started),
            total_us: micros(total),
            inbound_us: micros(parts.inbound),
            dispatch_us: (parts.dispatch_ms * 1000.0).clamp(0.0, (NONE_US - 1) as f64) as u32,
            maintain_us: (parts.maintain_ms * 1000.0).clamp(0.0, (NONE_US - 1) as f64) as u32,
            cpu_us: micros(cpu),
            interval_us: tick.interval_us,
            lateness_us: tick.lateness_us,
            mailbox_us: tick.mailbox_us,
            mailbox_messages: tick.mailbox_messages,
            clients: parts.clients.min(u16::MAX as usize) as u16,
            hibernating: parts.hibernating,
        };
        self.push(sample, tick.period);

        let budget_us = micros(tick.period).max(1);
        let interval_budget_us = budget_us.max(micros(parts.expected_interval));
        let slow = sample.total_us > budget_us.saturating_mul(2)
            || (sample.interval_us != NONE_US
                && sample.interval_us > interval_budget_us.saturating_mul(2));
        if slow {
            self.flight_record(&sample, &top, tick.started);
        }
    }

    fn push(&mut self, sample: TickSample, period: Duration) {
        match self.shared.ring.try_lock() {
            Ok(mut ring) => {
                ring.period_us = micros(period);
                ring.lifetime_hibernated_skips += std::mem::take(&mut self.pending_skips);
                for pending in self.backlog.drain(..) {
                    ring.push(pending);
                }
                ring.push(sample);
            }
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                let mut ring = poisoned.into_inner();
                ring.lifetime_hibernated_skips += std::mem::take(&mut self.pending_skips);
                for pending in self.backlog.drain(..) {
                    ring.push(pending);
                }
                ring.push(sample);
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                if self.backlog.len() >= BACKLOG_CAPACITY {
                    self.backlog.remove(0);
                    self.backlog_dropped += 1;
                    if self.backlog_dropped.is_power_of_two() {
                        warn!(
                            "[tick-stats] {}: ring reader held the lock for {} ticks; {} sample(s) dropped so far",
                            self.world, BACKLOG_CAPACITY, self.backlog_dropped
                        );
                    }
                }
                self.backlog.push(sample);
            }
        }
    }

    fn flight_record(
        &mut self,
        sample: &TickSample,
        top: &[(&'static str, u32); TOP_SYSTEMS],
        now: Instant,
    ) {
        let min_gap = if sample.clients > 0 {
            SLOW_WARN_INTERVAL
        } else {
            SLOW_WARN_INTERVAL_EMPTY
        };
        if let Some(last) = self.last_warned {
            if now.saturating_duration_since(last) < min_gap {
                self.slow_since_warn = self.slow_since_warn.saturating_add(1);
                return;
            }
        }
        let since = self
            .last_warned
            .map(|last| now.saturating_duration_since(last).as_secs_f32());
        self.last_warned = Some(now);
        let suppressed = std::mem::take(&mut self.slow_since_warn);

        let ms = |us: u32| us as f64 / 1000.0;
        let systems: Vec<String> = top
            .iter()
            .filter(|(name, us)| !name.is_empty() && *us > 0)
            .map(|(name, us)| format!("{name} {:.1}", ms(*us)))
            .collect();
        let pools = pool_inflight();
        let interval = if sample.interval_us == NONE_US {
            "-".to_owned()
        } else {
            format!("{:.1}ms", ms(sample.interval_us))
        };
        let cpu = if thread_cpu_clock_available() {
            format!("{:.1}ms", ms(sample.cpu_us))
        } else {
            "n/a".to_owned()
        };
        let earlier = match since {
            Some(secs) if suppressed > 0 => {
                format!(" (+{suppressed} more slow tick(s) in the last {secs:.1}s)")
            }
            _ => String::new(),
        };
        warn!(
            "[tick-slow] world={}{} tick={:.1}ms cpu={} interval={} late={:.1}ms inbound={:.1}ms \
             dispatch={:.1}ms maintain={:.1}ms mailbox={:.1}ms/{}msg clients={} \
             top=[{}] pools=[worldgen {} encode {} mesh {}]{}",
            self.world,
            if sample.hibernating {
                " (hibernating)"
            } else {
                ""
            },
            ms(sample.total_us),
            cpu,
            interval,
            ms(sample.lateness_us),
            ms(sample.inbound_us),
            ms(sample.dispatch_us),
            ms(sample.maintain_us),
            ms(sample.mailbox_us),
            sample.mailbox_messages,
            sample.clients,
            systems.join(", "),
            pools.worldgen_chunks,
            pools.encode_batches,
            pools.meshing_chunks,
            earlier,
        );
    }
}

impl Drop for TickRecorder {
    fn drop(&mut self) {
        unregister(&self.world, &self.shared);
    }
}

// ---------------------------------------------------------------------------
// Hibernation (world thread only)

/// What a delivered tick should do, from [`Hibernation::step`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HibernationStep {
    /// Run the dispatch.
    Dispatch {
        /// It runs as a hibernating world's.
        hibernating: bool,
        /// The on-schedule gap since the previous dispatch (see
        /// [`TickParts::expected_interval`]).
        expected_interval: Duration,
    },
    /// A hibernating world whose next dispatch is not due yet.
    Skip,
}

/// Paces a world's dispatches while nobody is in it. The world asks once per
/// delivered tick; a world with clients always dispatches, and an empty one
/// dispatches when its hibernation interval has passed since the last one.
#[derive(Default)]
pub(crate) struct Hibernation {
    last_dispatch: Option<Instant>,
    /// The interval the previous dispatch hibernated at, if it did.
    hibernated_at: Option<Duration>,
}

impl Hibernation {
    /// `eligible`: the world may hibernate now (no clients, not preloading,
    /// not deterministic, the switch on, a non-zero `interval`).
    pub(crate) fn step(&mut self, now: Instant, eligible: bool, interval: Duration) -> HibernationStep {
        if !eligible || interval.is_zero() {
            let expected_interval = self.hibernated_at.take().unwrap_or(Duration::ZERO);
            self.last_dispatch = Some(now);
            return HibernationStep::Dispatch {
                hibernating: false,
                expected_interval,
            };
        }
        let is_due = self
            .last_dispatch
            .map_or(true, |last| now.saturating_duration_since(last) >= interval);
        if !is_due {
            return HibernationStep::Skip;
        }
        self.last_dispatch = Some(now);
        self.hibernated_at = Some(interval);
        HibernationStep::Dispatch {
            hibernating: true,
            expected_interval: interval,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(start_ms: u32, total_us: u32) -> TickSample {
        TickSample {
            start_ms,
            total_us,
            cpu_us: total_us / 2,
            interval_us: 16_000,
            ..TickSample::default()
        }
    }

    #[test]
    fn an_empty_world_dispatches_once_per_interval_and_wakes_at_once() {
        let interval = Duration::from_millis(500);
        let tick = Duration::from_millis(16);
        let start = Instant::now();
        let mut hibernation = Hibernation::default();

        // The first tick of an empty world dispatches; the next ones inside
        // the interval skip.
        assert_eq!(
            hibernation.step(start, true, interval),
            HibernationStep::Dispatch {
                hibernating: true,
                expected_interval: interval
            }
        );
        let mut dispatches = 1;
        let mut at = start;
        for _ in 0..62 {
            at += tick;
            if matches!(hibernation.step(at, true, interval), HibernationStep::Dispatch { .. }) {
                dispatches += 1;
            }
        }
        // 62 ticks of 16 ms is 992 ms: dispatches at 0 and 512 ms only.
        assert_eq!(dispatches, 2);

        // A client joins: the very next tick dispatches at full rate, and the
        // gap since the last hibernated dispatch is on schedule.
        at += tick;
        assert_eq!(
            hibernation.step(at, false, interval),
            HibernationStep::Dispatch {
                hibernating: false,
                expected_interval: interval
            }
        );
        at += tick;
        assert_eq!(
            hibernation.step(at, false, interval),
            HibernationStep::Dispatch {
                hibernating: false,
                expected_interval: Duration::ZERO
            }
        );
    }

    #[test]
    fn a_zero_interval_never_hibernates() {
        let mut hibernation = Hibernation::default();
        let at = Instant::now();
        for i in 0..5u64 {
            assert!(matches!(
                hibernation.step(at + Duration::from_millis(i), true, Duration::ZERO),
                HibernationStep::Dispatch {
                    hibernating: false,
                    ..
                }
            ));
        }
    }

    #[test]
    fn hibernated_skips_count_without_becoming_samples() {
        let mut recorder = TickRecorder::new("hibernation-skips-test");
        recorder.note_hibernated_skip();
        recorder.note_hibernated_skip();
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.1,
                maintain_ms: 0.0,
                clients: 0,
                hibernating: true,
                expected_interval: Duration::from_millis(500),
            },
        );
        let report = recorder.shared.report("hibernation-skips-test");
        assert_eq!(report.lifetime_hibernated_skips, 2);
        assert_eq!(report.lifetime_ticks, 1);
        assert!(report.hibernating);
        assert_eq!(report.last10s.hibernating_ticks, 1);
    }

    #[test]
    fn percentiles_use_nearest_rank() {
        let values: Vec<u32> = (1..=100).map(|v| v * 1000).collect();
        let p = percentiles(values);
        assert_eq!(p.p50, 50.0);
        assert_eq!(p.p95, 95.0);
        assert_eq!(p.p99, 99.0);
        assert_eq!(p.max, 100.0);
        assert_eq!(p.mean, 50.5);
        let empty = percentiles(Vec::new());
        assert_eq!(empty.max, 0.0);
    }

    #[test]
    fn ring_wraps_and_returns_oldest_first() {
        let mut ring = TickRing::new();
        for i in 0..(TICK_STATS_CAPACITY as u32 + 10) {
            ring.push(sample(i, 20_000));
        }
        let ordered = ring.ordered();
        assert_eq!(ordered.len(), TICK_STATS_CAPACITY);
        assert_eq!(ordered[0].start_ms, 10);
        assert_eq!(
            ordered.last().unwrap().start_ms,
            TICK_STATS_CAPACITY as u32 + 9
        );
        assert_eq!(ring.lifetime_ticks, TICK_STATS_CAPACITY as u64 + 10);
        assert_eq!(ring.lifetime_over_one_frame, TICK_STATS_CAPACITY as u64 + 10);
        assert_eq!(ring.lifetime_over_two_frames, 0);
    }

    #[test]
    fn window_counts_only_recent_ticks_and_reports_hz() {
        // 30 s of ticks every 20 ms (50 Hz), then look from t = 30 s.
        let samples: Vec<TickSample> = (0..1500).map(|i| sample(i * 20, 4_000)).collect();
        let now_ms = 30_000;
        let oldest = samples.first().map(|s| s.start_ms);

        let last10 = window_report(&samples, now_ms, oldest, 10);
        assert_eq!(last10.ticks, 500);
        assert_eq!(last10.span_secs, 10.0);
        assert_eq!(last10.hz, 50.0);
        assert_eq!(last10.tick_total_ms.p99, 4.0);
        assert_eq!(last10.overruns_over16ms, 0);
        assert!((last10.busy_ratio - 0.2).abs() < 1e-9);

        // The ring only covers 30 s, so the 60 s window is 30 s long.
        let last60 = window_report(&samples, now_ms, oldest, 60);
        assert_eq!(last60.ticks, 1500);
        assert_eq!(last60.span_secs, 30.0);
        assert_eq!(last60.hz, 50.0);
    }

    #[test]
    fn window_survives_the_epoch_clock_wrapping() {
        // 30 s of 50 Hz ticks straddling the u32 wrap (49.7 days of uptime):
        // the same window as above, just shifted across the wrap point.
        let base = u32::MAX - 15_000;
        let samples: Vec<TickSample> = (0..1500u32)
            .map(|i| sample(base.wrapping_add(i * 20), 4_000))
            .collect();
        let now_ms = base.wrapping_add(30_000);
        assert!(now_ms < base, "the clock wrapped");
        let oldest = samples.first().map(|s| s.start_ms);

        let last10 = window_report(&samples, now_ms, oldest, 10);
        assert_eq!(last10.ticks, 500);
        assert_eq!(last10.span_secs, 10.0);
        assert_eq!(last10.hz, 50.0);

        let last60 = window_report(&samples, now_ms, oldest, 60);
        assert_eq!(last60.ticks, 1500);
        assert_eq!(last60.span_secs, 30.0);
    }

    #[test]
    fn first_tick_has_no_interval() {
        let mut recorder = TickRecorder::new("tick-stats-test-first-interval");
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        assert_eq!(tick.interval_us, NONE_US);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.5,
                maintain_ms: 0.1,
                clients: 0,
                hibernating: false,
                expected_interval: Duration::ZERO,
            },
        );
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        assert_ne!(tick.interval_us, NONE_US);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.5,
                maintain_ms: 0.1,
                clients: 1,
                hibernating: false,
                expected_interval: Duration::ZERO,
            },
        );

        let report = get_tick_stats("tick-stats-test-first-interval").expect("registered");
        assert_eq!(report.samples, 2);
        assert_eq!(report.lifetime_ticks, 2);
        // The first tick's missing interval is left out, not counted as huge.
        assert!(report.last10s.interval_ms.max < 1000.0);
        assert_eq!(report.last10s.clients_max, 1);
        assert_eq!(report.last10s.dispatch_ms.max, 0.5);
    }

    #[test]
    fn mailbox_time_between_ticks_lands_on_the_next_tick() {
        let mut recorder = TickRecorder::new("tick-stats-test-mailbox");
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.0,
                maintain_ms: 0.0,
                clients: 0,
                hibernating: false,
                expected_interval: Duration::ZERO,
            },
        );
        for _ in 0..3 {
            let _timer = MailboxTimer::start();
        }
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        assert_eq!(tick.mailbox_messages, 3);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.0,
                maintain_ms: 0.0,
                clients: 0,
                hibernating: false,
                expected_interval: Duration::ZERO,
            },
        );
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        assert_eq!(tick.mailbox_messages, 0, "taken once, then reset");
        drop(tick);
    }

    #[test]
    fn top_systems_keep_the_costliest_in_order() {
        let mut recorder = TickRecorder::new("tick-stats-test-top");
        let tick = recorder.begin(Instant::now(), DEFAULT_TICK_PERIOD);
        for (name, us) in [
            ("a", 5u64),
            ("b", 50),
            ("c", 1),
            ("d", 30),
            ("e", 40),
            ("f", 20),
            ("g", 10),
        ] {
            note_system_time(name, Duration::from_micros(us));
        }
        let top = SCRATCH.with(|scratch| scratch.borrow().top);
        let names: Vec<&str> = top.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, vec!["b", "e", "d", "f", "g"]);
        recorder.finish(
            tick,
            TickParts {
                inbound: Duration::ZERO,
                dispatch_ms: 0.0,
                maintain_ms: 0.0,
                clients: 0,
                hibernating: false,
                expected_interval: Duration::ZERO,
            },
        );
    }

    #[test]
    fn cpu_clock_reads_on_unix() {
        if cfg!(unix) {
            assert!(thread_cpu_time().is_some());
        }
    }
}
