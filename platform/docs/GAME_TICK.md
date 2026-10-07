# Game tick architecture

## 1. Loop

Each world is an actor driven by the engine's server loop. Wall-clock ticks
arrive from the `Server` actor; a fixed-step accumulator turns them into
simulation steps of `world_step_ms` (16 ms, ≈ 60 Hz). A stalled host batches
steps up to `max_catch_up_steps` (64) and drops older debt beyond
`max_catch_up_debt_secs`, so a slow server degrades instead of spiralling.
Worlds with no players hibernate (`hibernation_interval_ms`) and catch up
bounded random ticks when they wake.

The world clock is separate: `ticks_per_day` = 24 000 game ticks, advanced
by the world, and drives day/night (sunrise, morning, noon, sunset, night,
midnight), mob spawning rules, crop growth and NPC schedules.

## 2. One step

Systems run in a fixed order inside a `specs` dispatcher
(`server/world/systems`); the platform adds its systems at the marked points.

```
1. Inbound        drain client messages: JOIN/LEAVE, PEER, METHOD, EVENT, CHAT
                  -> platform method handlers validate intents here
2. Time           advance world clock, weather timers
3. Chunks         request -> generate (worker pool) -> light -> mesh -> ready
                  apply queued voxel updates, incremental light, fluids
4. Random ticks   per loaded sub-chunk sampler (grass spread, crop growth,
                  leaf decay, ice melt) — platform block behaviours run here
5. Physics        rigid bodies (rapier), entity-voxel collision, grounded state
6. Entities / AI  behaviour trees and pathfinding (phase 10), spawning rules
7. Gameplay       survival (hunger, air, damage), processing stations,
                  automation network update (phase 12)
8. Interest       recompute per-client chunk and entity interest (AOI)
9. Replication    entity / peer deltas stamped with the tick, chunk LOAD /
                  UPDATE / UNLOAD within per-tick send budgets
10. Persistence   mark dirty chunks; background saver writes them
```

Long work never blocks the step: generation, lighting and meshing run on a
worker pool and come back through queues; saving runs on its own thread.

## 3. Budgets

| Budget | Default | Purpose |
| --- | --- | --- |
| `max_chunks_per_tick` | 64 | chunk pipeline work admitted per step |
| `max_updates_per_tick` | 50 000 | voxel updates applied per step |
| `max_response_per_tick` | 16 | chunk responses sent per step |
| `max_random_ticks_per_tick` | 2 048 | random block ticks per step |
| `max_saves_per_tick` | 2 | chunk files queued per step |

Every queue that is over budget carries its remainder to the next step.
Nothing is dropped silently (`.cursor/rules/honest-failures.mdc`).

Targets: server step p99 < 16 ms with 100 players and 2 000 active entities
on one world process; client 60 FPS desktop, 30–60 FPS mobile.

## 4. Determinism

- World generation is a pure function of the seed (`crates/worldgen`).
- The engine's opt-in fixed-step mode (`server/world/fixed_step.rs`) gives a
  seeded PRNG and a protocol assert for simulations that must replay
  exactly (automation circuits, tests).
- Gameplay randomness (drops, spawns) draws from a per-world seeded stream so
  incidents can be replayed from logs.

## 5. Interaction with the business API

The tick never waits on HTTP. Economic intents (shop purchase, NPC sale,
quest reward) are queued to an async task that calls the internal API with an
idempotency key; the result comes back as a message the next step applies.
The in-world effect is applied only after the API confirms
([ARCHITECTURE.md](ARCHITECTURE.md) §6).

## 6. Observability

The engine publishes per-world tick statistics (`tick_stats`, `/info`,
`/health`): step duration percentiles, chunk queue depths, entity counts,
clients. The admin live monitor (phase 9) reads these together with process
CPU and memory.
