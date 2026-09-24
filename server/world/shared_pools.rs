//! The engine's worker pools, and how the OS should rank their threads
//! against the world tick threads.
//!
//! A world tick must never wait behind background work. Before these pools
//! existed, tick-path `par_join`s, worldgen stage jobs and message encodes
//! all shared rayon's process-global pool. A tick's barrier was injected
//! behind the worldgen backlog, and rayon serves injected jobs last. Now:
//!
//! - Tick-path loops run inline on the world thread. The few that are heavy
//!   enough to split (physics integration, A* searches, saved-chunk loads)
//!   go to [`tick_pool`], which only ever holds tick work, and only when
//!   [`tick_split`] says the batch is big enough to pay for the handoff.
//! - Worldgen stage jobs run on [`worldgen_pool`], encodes on [`encode_pool`]
//!   and mesh/light jobs on [`meshing_pool`].
//! - World threads and the tick pool run at a higher OS priority than the
//!   rest (see [`ThreadTier`]).
//!
//! `VOXELIZE_THREAD_PRIORITY` and `VOXELIZE_TICK_SPLIT` switch these choices
//! at boot, so each one's cost can be A/B tested without a rebuild.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use log::{info, warn};
use rayon::{ThreadPool, ThreadPoolBuilder};
use serde::Serialize;

/// Worker stack size for the shared pools. Rayon's default is 2 MiB, which
/// the greedy mesher overflowed on worldgen-v2 terrain (dense cave/overhang
/// chunks) — a `chunk-meshing-*` thread aborting the whole process with
/// "fatal runtime error: stack overflow". Sized to the same 8 MiB a main
/// thread gets, so the mesher is no deeper-constrained than the code that
/// calls it.
const WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

/// Cores the worldgen pool leaves to the world threads that are busy at any
/// moment (usually the one or two worlds with players) and the Server
/// actor's thread. Worldgen still uses them whenever they are idle; this only
/// caps how many stage jobs can run at once.
const TICK_RESERVED_CORES: usize = 2;

fn build(name: &'static str, threads: usize, tier: Option<ThreadTier>) -> Arc<ThreadPool> {
    let mut builder = ThreadPoolBuilder::new()
        .thread_name(move |index| format!("{name}-{index}"))
        .num_threads(threads)
        .stack_size(WORKER_STACK_BYTES);
    if let Some(tier) = tier {
        builder = builder.start_handler(move |_| apply_thread_tier(tier));
    }
    Arc::new(
        builder
            .build()
            .unwrap_or_else(|err| panic!("failed to build {name} thread pool: {err}")),
    )
}

fn cores() -> usize {
    std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4)
}

/// Placeholder pool attached to every world's ECS dispatcher.
///
/// World dispatch runs sequentially (see `run_dispatch`), so this pool never
/// receives work. It exists only because shred's `DispatcherBuilder::build`
/// eagerly creates a private num-cpus pool when none is attached — which,
/// multiplied by every world on the server, is how the process once reached
/// ~950 threads. One shared single-thread pool satisfies the builder at the
/// cost of one parked thread.
pub(crate) fn dispatch_pool() -> Arc<ThreadPool> {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| build("world-dispatch", 1, None)).clone()
}

/// Rayon pool shared by every world's mesher: meshing parallelism should
/// scale with cores, not with worlds x cores.
pub(crate) fn meshing_pool() -> Arc<ThreadPool> {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| build("chunk-meshing", cores(), Some(ThreadTier::Delivery)))
        .clone()
}

/// Worldgen stage jobs from every world's pipeline. A stage job's own
/// `par_iter`s run here too, since rayon keeps nested work in the pool that
/// is running it. Background priority: it yields to the world threads.
pub(crate) fn worldgen_pool() -> Arc<ThreadPool> {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = cores().saturating_sub(TICK_RESERVED_CORES).max(1);
        build("worldgen", threads, Some(ThreadTier::Background))
    })
    .clone()
}

/// Encodes of every world's outbound messages. Most batches are a few small
/// messages; a join's chunk burst (about a millisecond of LZ4 per chunk) is
/// the only big one. The encode sits on the delivery path of every entity
/// and chunk update, so it keeps the default priority.
pub(crate) fn encode_pool() -> Arc<ThreadPool> {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = (cores() / 3).clamp(2, 4);
        build("encode", threads, Some(ThreadTier::Delivery))
    })
    .clone()
}

/// The pool for tick-path loops that are worth splitting. Nothing else runs
/// here, so a tick that hands work to it never queues behind worldgen or
/// encodes, and its threads share the world threads' priority. It is small
/// on purpose: the world thread blocks while it runs, and every world
/// shares it.
fn tick_pool() -> &'static ThreadPool {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| {
        let threads = (cores() / 3).clamp(2, 4);
        build("tick", threads, Some(ThreadTier::Tick))
    })
}

/* -------------------------------------------------------------------------- */
/*                         Splitting tick-path loops                          */
/* -------------------------------------------------------------------------- */

/// Physics integrates on the world thread until this many bodies need it in
/// one tick. Below that, waking pool threads costs more than the work
/// (roughly 5–20 µs per body), and far more on a loaded host.
pub const TICK_SPLIT_MIN_BODIES: usize = 64;

/// Pathfinding runs its A* searches on the world thread until a tick has
/// this many. Each search can take up to its time budget (1–5 ms), so two
/// are already worth running side by side.
pub const TICK_SPLIT_MIN_SEARCHES: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TickSplitMode {
    /// Split when a batch reaches the call site's minimum (the default).
    Auto,
    /// Never split: every tick-path loop runs on the world thread.
    Never,
    /// Split any batch of two or more.
    Always,
}

fn parse_tick_split_mode(value: Option<&str>) -> Result<TickSplitMode, String> {
    match value.map(|v| v.trim().to_ascii_lowercase()) {
        None => Ok(TickSplitMode::Auto),
        Some(v) if v.is_empty() || v == "auto" => Ok(TickSplitMode::Auto),
        Some(v) if v == "never" || v == "off" || v == "0" => Ok(TickSplitMode::Never),
        Some(v) if v == "always" => Ok(TickSplitMode::Always),
        Some(v) => Err(v),
    }
}

fn tick_split_mode() -> TickSplitMode {
    static MODE: OnceLock<TickSplitMode> = OnceLock::new();
    *MODE.get_or_init(|| {
        let raw = std::env::var("VOXELIZE_TICK_SPLIT").ok();
        match parse_tick_split_mode(raw.as_deref()) {
            Ok(mode) => {
                if mode != TickSplitMode::Auto {
                    info!("[tick-pool] VOXELIZE_TICK_SPLIT={mode:?}");
                }
                mode
            }
            Err(value) => {
                warn!(
                    "[tick-pool] VOXELIZE_TICK_SPLIT={value:?} is not auto, never or always; \
                     using auto"
                );
                TickSplitMode::Auto
            }
        }
    })
}

fn should_split(mode: TickSplitMode, items: usize, min_items: usize) -> bool {
    match mode {
        TickSplitMode::Never => false,
        TickSplitMode::Always => items >= 2,
        TickSplitMode::Auto => items >= min_items.max(2),
    }
}

/// Whether a tick-path batch of `items` should run split across the tick
/// pool (with [`run_on_tick_pool`] and `par_join`) rather than inline on the
/// world thread. `min_items` is the call site's break-even batch size, such
/// as [`TICK_SPLIT_MIN_BODIES`].
pub fn tick_split(items: usize, min_items: usize) -> bool {
    should_split(tick_split_mode(), items, min_items)
}

/// Runs `op` on the tick pool and blocks until it returns. Any rayon
/// parallel iterator inside `op` splits across the tick pool only. Call it
/// from a world thread for a batch [`tick_split`] approved; never use the
/// global rayon pool from the tick path.
pub fn run_on_tick_pool<R: Send>(op: impl FnOnce() -> R + Send) -> R {
    tick_pool().install(op)
}

/* -------------------------------------------------------------------------- */
/*                              Thread priority                               */
/* -------------------------------------------------------------------------- */

/// How strongly the OS scheduler should favor a thread.
///
/// On macOS a new thread starts at QoS default whatever its creator's QoS.
/// The main thread (the actix System arbiter, which runs the Server's tick
/// timer) starts at default under pm2, or at user-interactive when launched
/// from a terminal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ThreadTier {
    /// World tick threads, the Server actor's thread and the tick pool.
    /// macOS: QoS user-initiated (a thread already above it is left alone),
    /// above default-QoS work such as compilers, other processes' workers and
    /// our own background pools, and below the user-interactive foreground
    /// UI (the browser the game is played in). Linux: unchanged, since
    /// raising priority needs CAP_SYS_NICE.
    Tick,
    /// Encode and meshing workers: default priority on every OS.
    Delivery,
    /// Worldgen workers. Linux: nice +10. macOS: QoS default (already one
    /// tier below the tick), or QoS utility with
    /// `VOXELIZE_THREAD_PRIORITY=strict`. Utility is not the default because
    /// on a saturated dev machine it starves chunk generation behind every
    /// default-QoS compiler and browser thread.
    Background,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PriorityMode {
    /// Leave every thread at the OS default.
    Off,
    /// The tiers above (the default).
    On,
    /// As `On`, with macOS worldgen workers at QoS utility.
    Strict,
}

fn parse_priority_mode(value: Option<&str>) -> Result<PriorityMode, String> {
    match value.map(|v| v.trim().to_ascii_lowercase()) {
        None => Ok(PriorityMode::On),
        Some(v) if v.is_empty() || v == "on" || v == "1" => Ok(PriorityMode::On),
        Some(v) if v == "off" || v == "0" => Ok(PriorityMode::Off),
        Some(v) if v == "strict" => Ok(PriorityMode::Strict),
        Some(v) => Err(v),
    }
}

fn priority_mode() -> PriorityMode {
    static MODE: OnceLock<PriorityMode> = OnceLock::new();
    *MODE.get_or_init(|| {
        let raw = std::env::var("VOXELIZE_THREAD_PRIORITY").ok();
        match parse_priority_mode(raw.as_deref()) {
            Ok(mode) => {
                if mode != PriorityMode::On {
                    info!("[thread-priority] VOXELIZE_THREAD_PRIORITY={mode:?}");
                }
                mode
            }
            Err(value) => {
                warn!(
                    "[thread-priority] VOXELIZE_THREAD_PRIORITY={value:?} is not on, off or \
                     strict; using on"
                );
                PriorityMode::On
            }
        }
    })
}

/// What a tier asks of the OS on this platform, or `None` to leave the
/// thread as it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PriorityRequest {
    MacQos(MacQos),
    LinuxNice(i32),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MacQos {
    UserInitiated,
    Utility,
}

fn priority_request(tier: ThreadTier, mode: PriorityMode) -> Option<PriorityRequest> {
    if mode == PriorityMode::Off {
        return None;
    }
    if cfg!(target_os = "macos") {
        match tier {
            ThreadTier::Tick => Some(PriorityRequest::MacQos(MacQos::UserInitiated)),
            ThreadTier::Delivery => None,
            ThreadTier::Background if mode == PriorityMode::Strict => {
                Some(PriorityRequest::MacQos(MacQos::Utility))
            }
            ThreadTier::Background => None,
        }
    } else if cfg!(target_os = "linux") {
        match tier {
            ThreadTier::Tick | ThreadTier::Delivery => None,
            ThreadTier::Background => Some(PriorityRequest::LinuxNice(10)),
        }
    } else {
        None
    }
}

/// Moves the calling thread into `tier`. A failure is logged once per tier
/// and the thread keeps running at its current priority.
pub(crate) fn apply_thread_tier(tier: ThreadTier) {
    let Some(request) = priority_request(tier, priority_mode()) else {
        return;
    };
    if let Err(err) = set_current_thread_priority(request) {
        static TICK_WARNED: AtomicBool = AtomicBool::new(false);
        static DELIVERY_WARNED: AtomicBool = AtomicBool::new(false);
        static BACKGROUND_WARNED: AtomicBool = AtomicBool::new(false);
        let warned = match tier {
            ThreadTier::Tick => &TICK_WARNED,
            ThreadTier::Delivery => &DELIVERY_WARNED,
            ThreadTier::Background => &BACKGROUND_WARNED,
        };
        if !warned.swap(true, Ordering::Relaxed) {
            warn!(
                "[thread-priority] could not move {:?} threads to {request:?}: {err}; they keep \
                 the OS default (further failures for this tier are not logged)",
                tier
            );
        }
    }
}

/// Raises the calling thread to the tick tier: each world's thread as it
/// starts, and the thread running the Server actor's tick timer. Never
/// lowers a thread that already runs higher (a main thread launched from an
/// interactive terminal starts at user-interactive on macOS).
pub(crate) fn raise_to_tick_tier() {
    apply_thread_tier(ThreadTier::Tick);
}

#[cfg(target_os = "macos")]
fn current_thread_qos() -> Option<libc::qos_class_t> {
    let mut class = libc::qos_class_t::QOS_CLASS_UNSPECIFIED;
    let mut relative = 0;
    // SAFETY: queries the calling thread's own QoS into locals.
    let rc =
        unsafe { libc::pthread_get_qos_class_np(libc::pthread_self(), &mut class, &mut relative) };
    (rc == 0).then_some(class)
}

#[cfg(target_os = "macos")]
fn set_current_thread_priority(request: PriorityRequest) -> Result<(), String> {
    if request == PriorityRequest::MacQos(MacQos::UserInitiated)
        && matches!(
            current_thread_qos(),
            Some(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE)
        )
    {
        return Ok(());
    }
    let class = match request {
        PriorityRequest::MacQos(MacQos::UserInitiated) => {
            libc::qos_class_t::QOS_CLASS_USER_INITIATED
        }
        PriorityRequest::MacQos(MacQos::Utility) => libc::qos_class_t::QOS_CLASS_UTILITY,
        PriorityRequest::LinuxNice(_) => {
            return Err("nice levels are not used on macOS".to_owned());
        }
    };
    // SAFETY: plain FFI call that only affects the calling thread.
    let rc = unsafe { libc::pthread_set_qos_class_self_np(class, 0) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!("pthread_set_qos_class_self_np returned {rc}"))
    }
}

#[cfg(target_os = "linux")]
fn set_current_thread_priority(request: PriorityRequest) -> Result<(), String> {
    let PriorityRequest::LinuxNice(nice) = request else {
        return Err("QoS classes are not used on Linux".to_owned());
    };
    // On Linux, PRIO_PROCESS with a thread id sets that one thread's nice.
    // SAFETY: plain FFI calls that only affect the calling thread.
    let tid = unsafe { libc::syscall(libc::SYS_gettid) } as libc::id_t;
    let rc = unsafe { libc::setpriority(libc::PRIO_PROCESS, tid, nice) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "setpriority failed: {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn set_current_thread_priority(request: PriorityRequest) -> Result<(), String> {
    Err(format!("{request:?} is not supported on this OS"))
}

/* -------------------------------------------------------------------------- */
/*                             In-flight counters                             */
/* -------------------------------------------------------------------------- */

/// Engine jobs queued or running on the worker pools. Rayon exposes no queue
/// depth, so each engine spawn site counts its own jobs in and out. A host's
/// own planners that spawn onto the global pool are not counted.
pub(crate) static WORLDGEN_INFLIGHT: AtomicUsize = AtomicUsize::new(0);
pub(crate) static ENCODE_INFLIGHT: AtomicUsize = AtomicUsize::new(0);
pub(crate) static MESHING_INFLIGHT: AtomicUsize = AtomicUsize::new(0);

/// A snapshot of [`WORLDGEN_INFLIGHT`], [`ENCODE_INFLIGHT`] and
/// [`MESHING_INFLIGHT`], process-wide.
#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolInflight {
    /// Chunk stage jobs on the `worldgen` pool.
    pub worldgen_chunks: usize,
    /// Message encode batches on the `encode` pool.
    pub encode_batches: usize,
    /// Chunk mesh/light jobs on the `chunk-meshing` pool.
    pub meshing_chunks: usize,
}

pub fn pool_inflight() -> PoolInflight {
    PoolInflight {
        worldgen_chunks: WORLDGEN_INFLIGHT.load(Ordering::Relaxed),
        encode_batches: ENCODE_INFLIGHT.load(Ordering::Relaxed),
        meshing_chunks: MESHING_INFLIGHT.load(Ordering::Relaxed),
    }
}

/// Counts one job out of an in-flight counter when dropped (so a panicking
/// job still leaves the count right). The spawner counts jobs in with
/// [`InflightJob::queue`] before handing them to the pool.
pub(crate) struct InflightJob(&'static AtomicUsize);

impl InflightJob {
    pub(crate) fn queue(counter: &'static AtomicUsize, jobs: usize) {
        counter.fetch_add(jobs, Ordering::Relaxed);
    }

    pub(crate) fn adopt(counter: &'static AtomicUsize) -> Self {
        Self(counter)
    }
}

impl Drop for InflightJob {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_split_modes_parse() {
        assert_eq!(parse_tick_split_mode(None), Ok(TickSplitMode::Auto));
        assert_eq!(parse_tick_split_mode(Some("")), Ok(TickSplitMode::Auto));
        assert_eq!(parse_tick_split_mode(Some(" Never ")), Ok(TickSplitMode::Never));
        assert_eq!(parse_tick_split_mode(Some("off")), Ok(TickSplitMode::Never));
        assert_eq!(parse_tick_split_mode(Some("always")), Ok(TickSplitMode::Always));
        assert_eq!(parse_tick_split_mode(Some("sometimes")), Err("sometimes".to_owned()));
    }

    #[test]
    fn split_only_batches_that_pay_for_the_handoff() {
        let min = TICK_SPLIT_MIN_BODIES;
        assert!(!should_split(TickSplitMode::Auto, 0, min));
        assert!(!should_split(TickSplitMode::Auto, min - 1, min));
        assert!(should_split(TickSplitMode::Auto, min, min));
        // A minimum below two never splits a single item.
        assert!(!should_split(TickSplitMode::Auto, 1, 0));
        assert!(should_split(TickSplitMode::Auto, 2, TICK_SPLIT_MIN_SEARCHES));
        assert!(!should_split(TickSplitMode::Never, 10_000, min));
        assert!(!should_split(TickSplitMode::Always, 1, min));
        assert!(should_split(TickSplitMode::Always, 2, min));
    }

    #[test]
    fn priority_modes_parse() {
        assert_eq!(parse_priority_mode(None), Ok(PriorityMode::On));
        assert_eq!(parse_priority_mode(Some("OFF")), Ok(PriorityMode::Off));
        assert_eq!(parse_priority_mode(Some("strict")), Ok(PriorityMode::Strict));
        assert_eq!(parse_priority_mode(Some("max")), Err("max".to_owned()));
    }

    #[test]
    fn tiers_never_lower_the_tick_or_raise_background_work() {
        for mode in [PriorityMode::On, PriorityMode::Strict] {
            let tick = priority_request(ThreadTier::Tick, mode);
            let background = priority_request(ThreadTier::Background, mode);
            if cfg!(target_os = "macos") {
                assert_eq!(tick, Some(PriorityRequest::MacQos(MacQos::UserInitiated)));
                let expected = (mode == PriorityMode::Strict)
                    .then_some(PriorityRequest::MacQos(MacQos::Utility));
                assert_eq!(background, expected);
            } else if cfg!(target_os = "linux") {
                assert_eq!(tick, None);
                assert_eq!(background, Some(PriorityRequest::LinuxNice(10)));
            }
            assert_eq!(priority_request(ThreadTier::Delivery, mode), None);
        }
        for tier in [ThreadTier::Tick, ThreadTier::Delivery, ThreadTier::Background] {
            assert_eq!(priority_request(tier, PriorityMode::Off), None);
        }
    }

    #[test]
    fn tick_pool_runs_splits_off_the_calling_thread() {
        use rayon::prelude::*;

        let caller = std::thread::current().id();
        let (sum, ran_elsewhere) = run_on_tick_pool(|| {
            let sum: u64 = (0..10_000u64).into_par_iter().sum();
            (sum, std::thread::current().id() != caller)
        });
        assert_eq!(sum, 49_995_000);
        assert!(ran_elsewhere);
        let name = run_on_tick_pool(|| std::thread::current().name().map(str::to_owned));
        assert!(name.is_some_and(|n| n.starts_with("tick-")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn tick_pool_threads_run_at_user_initiated_qos() {
        if priority_mode() != PriorityMode::On {
            return;
        }
        let class = run_on_tick_pool(|| current_thread_qos().map(|c| c as u32));
        assert_eq!(
            class,
            Some(libc::qos_class_t::QOS_CLASS_USER_INITIATED as u32)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn raising_never_lowers_a_user_interactive_thread() {
        if priority_mode() != PriorityMode::On {
            return;
        }
        let class = std::thread::spawn(|| {
            // SAFETY: sets the spawned test thread's own QoS.
            let rc = unsafe {
                libc::pthread_set_qos_class_self_np(
                    libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE,
                    0,
                )
            };
            assert_eq!(rc, 0);
            raise_to_tick_tier();
            current_thread_qos().map(|c| c as u32)
        })
        .join()
        .expect("test thread panicked");
        assert_eq!(
            class,
            Some(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE as u32)
        );
    }
}
