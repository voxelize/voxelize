use std::sync::{Arc, OnceLock};

use rayon::{ThreadPool, ThreadPoolBuilder};

/// Worker stack size for the shared pools. Rayon's default is 2 MiB, which
/// the greedy mesher overflowed on worldgen-v2 terrain (dense cave/overhang
/// chunks) — a `chunk-meshing-*` thread aborting the whole process with
/// "fatal runtime error: stack overflow". Sized to the same 8 MiB a main
/// thread gets, so the mesher is no deeper-constrained than the code that
/// calls it.
const WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

fn build(name: &'static str, threads: usize) -> Arc<ThreadPool> {
    Arc::new(
        ThreadPoolBuilder::new()
            .thread_name(move |index| format!("{name}-{index}"))
            .num_threads(threads)
            .stack_size(WORKER_STACK_BYTES)
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
    POOL.get_or_init(|| build("world-dispatch", 1)).clone()
}

/// Rayon pool shared by every world's mesher: meshing parallelism should
/// scale with cores, not with worlds x cores.
pub(crate) fn meshing_pool() -> Arc<ThreadPool> {
    static POOL: OnceLock<Arc<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| build("chunk-meshing", cores())).clone()
}
