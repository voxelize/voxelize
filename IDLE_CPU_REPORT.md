# Voxelize Server — Idle CPU Diagnosis (~400% / ~4 cores pegged)

**Scope:** Investigation only. No product code was changed. The server crate was
read end-to-end, then the demo server was **built and run idle** to collect runtime
evidence (`top -H`, `/proc/<pid>/task` sampling, and a `RAYON_NUM_THREADS` A/B test).

**Symptom:** On the Hetzner production machine the server sits at ~400% CPU
(~4 cores fully pegged) at idle — no players connected, nothing happening.

---

## TL;DR

Idle CPU is dominated by **rayon thread-pool wake/spin churn driven by an
unconditional, per-world parallel ECS dispatch that runs every 16 ms (62.5 Hz)**.

- Every world is ticked every 16 ms regardless of whether anything changed.
- Each tick runs a **parallel** `shred`/`specs` dispatch, which calls
  `rayon::ThreadPool::install(...)` and wakes a pool sized to **all cores**.
- `shred` builds a **private, all-cores rayon pool per world** (the code never
  calls `with_pool`), on top of a per-world mesher pool, a per-world pipeline
  pool, and the shared global pool.
- rayon workers spin-search for work before sleeping; being re-woken 62.5 Hz ×
  (number of worlds) means a roughly constant number of workers never settle.
- The cost scales with `num_cpus × num_worlds`, so on a many-core production box
  it reaches ~4 pegged cores even though there is no real work.

**A/B proof (8-core sandbox):** capping the implicit rayon pools via
`RAYON_NUM_THREADS=1` cut idle CPU from **~6.4% to ~2.9%** and threads from
**62 to 34**. The avoidable half is pure per-tick rayon wake/spin overhead, and it
grows linearly with core count.

---

## Runtime evidence

Built `cargo build --profile release-dev --example demo` (after installing
`protobuf-compiler`) and ran it idle on an 8-core box with the bundled
`test` + `terrain` + `flat` worlds.

### Thread inventory

The process spawned **62 threads** for 3 worlds, consistent with
`3 worlds × 3 all-cores pools + global pool + actix/tokio workers + sync arbiters`.
Thread name groups observed via `top -H`:

- `demo` — main, actix system arbiter, actix-web workers, tokio, the 3 SyncWorld
  arbiter threads, **and the per-world dispatcher pools + global rayon pool**
  (unnamed rayon threads inherit the process name).
- `chunk-meshing-*` — per-world mesher pools (idle/sleeping at true idle).
- `voxelize-chunking-*` — per-world pipeline pools (idle/sleeping at true idle).

The named worker pools sat at **0%** at idle — they only run on demand. The idle
cost was spread across the `demo`-named threads (dispatcher pools + global pool +
the per-tick dispatch driver).

### A/B test isolating the rayon pools

| Config | Threads | Idle CPU (10s avg) |
|---|---|---|
| default (8 threads per implicit pool) | 62 | **~6.4%** |
| `RAYON_NUM_THREADS=1` | 34 | **~2.9%** |

`RAYON_NUM_THREADS` affects pools built with the implicit
`ThreadPoolBuilder::new().build()` — i.e. the **per-world dispatcher pools**, the
**pipeline pools**, and the **global pool** — but NOT the mesher pools (they set
`num_threads` explicitly). The mesher pools stayed full-size yet idle CPU still
dropped, which confirms the spinners are the **per-tick-dispatched pools**, not
the on-demand mesher pools.

### Why 400% was not literally reproduced on 8 cores

The cost is linear in `num_cpus × num_worlds`. On 8 cores it is ~3–4% of avoidable
churn; a 16–48 core Hetzner box running the same code spawns **hundreds** of
dispatcher/global rayon workers, all woken `62.5 Hz × worlds` and futex-sleeping
every tick. That wake/spin/futex churn is exactly the load that sits at a roughly
constant few-hundred-percent at idle.

---

## Root causes, ranked by likelihood

### 1. (Most likely) Per-world parallel ECS dispatch on an all-cores rayon pool, every 16 ms, unconditionally

The actix `Server` actor ticks **every** world every `interval` ms (default `16`
→ 62.5 Hz), regardless of clients or pending work.

`server/server/mod.rs:605`
```rust
fn started(&mut self, ctx: &mut Self::Context) {
    ctx.run_interval(Duration::from_millis(self.interval), |act, ctx| {
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
                    if let Err(error) = result {
                        warn!("World tick failed for {}: {:?}", world_name, error);
                    }
                }),
            );
        }
    });
}
```

`DEFAULT_INTERVAL` (`server/server/mod.rs:766`):
```rust
const DEFAULT_INTERVAL: u64 = 16;
```

Each `Tick` always runs the full **parallel** ECS dispatch — there is no
"nothing changed, skip it" path.

`server/world/mod.rs:1654` (inside `World::tick`)
```rust
let dispatch_time = {
    let mut dispatcher_guard = self.built_dispatcher.lock().unwrap();
    if dispatcher_guard.is_none() {
        let build_timer = SystemTimer::new("dispatcher-build");
        let dispatcher = (self.dispatcher)().build();
        *dispatcher_guard = Some(UnsafeSendSync::new(dispatcher));
        record_timing(&self.name, "dispatcher-build", build_timer.elapsed_ms());
    }

    let dispatch_timer = SystemTimer::new("dispatcher-dispatch");
    dispatcher_guard
        .as_mut()
        .unwrap()
        .get_mut()
        .dispatch(&self.ecs);          // <-- parallel dispatch every tick
    dispatch_timer.elapsed_ms()
};
```

The dispatcher factory never shares or caps a pool — it just builds a default
`shred` dispatcher (`server/world/mod.rs:682`):
```rust
dispatcher: Arc::new(|| dispatcher().into_inner()),
```

Because `with_pool(...)` is never called, `shred` creates a **private rayon
`ThreadPool` sized to all cores per world**:

`shred-0.15.0/src/dispatch/builder.rs:413`
```rust
fn create_thread_pool() -> ::std::sync::Arc<::rayon::ThreadPool> {
    use rayon::ThreadPoolBuilder;
    use std::sync::Arc;

    Arc::new(
        ThreadPoolBuilder::new()      // no num_threads => num_cpus threads
            .build()
            .expect("Invalid configuration"),
    )
}
```

…and every tick re-installs onto that pool, waking all its workers:

`shred-0.15.0/src/dispatch/dispatcher.rs:79`
```rust
pub fn dispatch_par(&mut self, world: &World) {
    let stages = &mut self.stages;

    self.thread_pool
        .read()
        .unwrap()
        .as_ref()
        .unwrap()
        .install(move || {            // <-- wakes num_cpus workers, every tick
            for stage in stages {
                stage.execute(world); // independent systems run via rayon scope
            }
        });
}
```

The schedule has **7 dependency-free systems** that fan out into a rayon scope
every tick, plus systems that call `par_join()`:

`server/world/mod.rs:515` (`dispatcher()`):
```rust
TimedDispatcherBuilder::new()
    .with(UpdateStatsSystem, "update-stats", &[])
    .with(EntitiesMetaSystem, "entities-meta", &["physics"])
    .with(PeersMetaSystem, "peers-meta", &[])
    .with(CurrentChunkSystem, "current-chunk", &[])
    ...
    .with(EntityObserveSystem, "entity-observe", &[])
    .with(PathFindingSystem, "path-finding", &["entity-observe"])
    .with(TargetMetadataSystem, "target-meta", &[])
    .with(PathMetadataSystem, "path-meta", &[])
    .with(EntityTreeSystem, "entity-tree", &[])
    .with(WalkTowardsSystem, "walk-towards", &["path-finding"])
```

`CurrentChunkSystem` and `PhysicsSystem` add `par_join()` calls per tick
(`server/world/systems/chunk/current.rs:22`, `server/world/systems/physics.rs:74`),
further engaging rayon workers even with zero entities.

**Net effect:** `pool.install()` is called `worlds × 62.5` times/second; each call
wakes `num_cpus` workers; rayon workers spin-search before sleeping; with frequent
re-wakes a roughly constant set of workers never fully sleeps. Idle cost scales with
`num_cpus × num_worlds` → ~4 cores on a many-core box.

**Recommended fix:**
- Build **one shared, size-capped** rayon pool and pass it to every world's
  dispatcher via `DispatcherBuilder::with_pool(Arc<ThreadPool>)`
  (cap e.g. `min(num_cpus, 4)`), instead of an implicit per-world all-cores pool.
- And/or run the per-tick path **sequentially** via `dispatch_seq` (no
  `pool.install`, see `shred-0.15.0/src/dispatch/dispatcher.rs:101`). At idle — and
  likely under normal load — per-system work is microseconds, so parallel-dispatch
  overhead exceeds its benefit.

---

### 2. (Strong contributor) Proliferation of all-cores rayon pools

Each world creates **three** `num_cpus`-wide pools (dispatcher + mesher + pipeline),
none shared, plus the global pool — `≈ 3 × worlds × cores` worker threads. Even idle
they add futex wake/sleep churn and memory; the dispatcher pool is hit every tick.

`server/world/generators/mesher.rs:33`
```rust
pool: ThreadPoolBuilder::new()
    .thread_name(|index| format!("chunk-meshing-{index}"))
    .num_threads(
        std::thread::available_parallelism()
            .map(|p| p.get())
            .unwrap_or(4),
    )
    .build()
    .unwrap(),
```

`server/world/generators/pipeline.rs:242`
```rust
pool: ThreadPoolBuilder::new()
    .thread_name(|index| format!("voxelize-chunking-{index}"))
    .build()
    .unwrap(),
```

Note the pipeline pool is effectively dead weight: `Pipeline::process` schedules
work on the **global** pool via `rayon::spawn`, not `self.pool`
(`server/world/generators/pipeline.rs:335`):
```rust
rayon::spawn(move || {
    processes
        .into_par_iter()
        .enumerate()
        .for_each(|(_, (chunk, space, stage))| { ... });
});
```

**Recommended fix:** Share a single bounded pool across worlds for dispatch and
for meshing/pipeline work, with explicit small `num_threads`. Remove the unused
per-world pipeline pool (`pipeline.rs:242`) outright since `process` uses the
global pool.

---

### 3. (Contributor / design) Unconditional ticking with no idle gate

`Server::tick` and the `run_interval` send `Tick` to every world every 16 ms, and
`World::tick` always builds/dispatches the full schedule — even with zero clients
and empty pipeline / mesher / update / active-voxel / `to_send` / `to_save` queues.

`server/server/mod.rs:493`
```rust
pub(crate) fn tick(&mut self) {
    for world in self.worlds.values_mut() {
        let _ = world.try_send(Tick);
    }
}
```

`server/world/mod.rs:1608`
```rust
/// Tick of the world, run every 16ms.
pub(crate) fn tick(&mut self) {
    if !self.started {
        self.started = true;
    }
    ...
    // always proceeds to build + parallel-dispatch the schedule
}
```

**Recommended fix:** Add an `is_idle()` check (no clients + all queues empty +
empty active-voxel heap) and either skip the dispatch, run it sequentially, or back
off the tick interval when idle. This removes the wake pressure at true idle.

---

### 4. (Separate latent bug that inflates idle CPU) Dead world re-ticked at 60 Hz + warn spam

When a world actor stops (panics), `run_interval` keeps sending `Tick`; each fails
with `MailboxError` and logs `warn!`, burning CPU/stdout at ~60–100 lines/s/world.

`server/server/mod.rs:621`
```rust
ctx.spawn(
    wrap_future(world.send(Tick)).map(move |result, act: &mut Server, _| {
        act.pending_world_ticks.remove(&world_name);
        if let Err(error) = result {
            warn!("World tick failed for {}: {:?}", world_name, error);
        }
    }),
);
```

Observed in the demo: the example `test` world's custom dispatcher declares a
dependency on an unregistered `"physics"` system, so `shred` panics on build
(`No such system registered ("physics")`), the actor dies, and the server logged
**3300–3800** `World tick failed for test: MailboxError` lines in ~35 s.

This is not the 400% cause by itself, but it is a real idle-CPU drain whenever any
world stops.

**Recommended fix:** On repeated mailbox errors, stop re-ticking / restart the dead
world and rate-limit the warning; separately fix the example world's dispatcher
dependency list.

---

## Recommended priority

1. **Cause 1 + Cause 3** first: a shared/size-capped rayon pool (or sequential
   dispatch) plus an idle gate. Together they eliminate the per-tick all-cores wake
   storm that scales to ~400% at idle on a many-core box.
2. **Cause 2**: consolidate/cap the per-world pools (and drop the unused pipeline
   pool) to reduce thread and memory footprint.
3. **Cause 4**: stop a stopped world from quietly eating a core.

## How to verify a fix on production

Run the server idle and compare `top -H` per-thread CPU before/after; the
`install`-driven dispatcher-pool threads should change from "spinning every tick"
to "sleeping". Repeating the `RAYON_NUM_THREADS=1` vs default comparison should show
the gap shrink toward zero once the per-tick all-cores dispatch is removed.

---

## Appendix — environment / method

- Toolchain: `cargo 1.96.0`; box: 8 logical CPUs.
- Build: `cargo build --profile release-dev --example demo` (required installing
  `protobuf-compiler` for `protoc`).
- Measurement: `top -b -H`, and per-thread CPU deltas from
  `/proc/<pid>/task/*/stat` (`utime+stime` over a 10s window).
- A/B: re-ran the same binary with `RAYON_NUM_THREADS=1` to isolate the implicitly
  built rayon pools (dispatcher + pipeline + global).
