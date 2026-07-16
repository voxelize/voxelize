# Entity motion replication: design rationale

Status: implemented (supersedes the reverted flush-budget design of PR #111).
Code: `server/world/replication/` (scheduler + codec), `server/world/systems/entity/sending.rs` (staging), `server/world/systems/broadcast.rs` (flush), `packages/core/src/core/entities.ts` + `packages/core/src/core/network/workers/decode-utils.ts` (client).

## The problem

Two incidents shaped this design:

1. **Unbounded broadcast (the lobby2 incident).** ~150 tracked entities whose
   metadata JSON re-serialized every tick produced ~120 KB ENTITY frames per
   tick per client (~7.5 MB/s); marginal clients fell behind and died.
2. **The failed fix (PR #111).** A fixed per-tick budget (64 updates / 24 KiB
   payload) over ONE oldest-first rotation of ALL entity state. It bounded
   bandwidth but rationed *freshness*: with N changing entities and a budget
   of K per tick, every entity refreshes every ⌈N/K⌉ ticks — all entities
   equally, in wall-clock terms that stretch further whenever the tick sags.
   In live play that read as visible movement gaps and pauses on every mover
   (the client interpolates over ~50 ms; refresh gaps of 100 ms+ exceed the
   buffer and read as freeze-then-jump). Town reverted to the pre-budget pin.

The root tension: bandwidth must be bounded (incident 1) but motion freshness
must be guaranteed in wall-clock terms (incident 2). A fixed budget over a
single undifferentiated queue cannot satisfy both.

## What production engines do

The patterns below are the industry's convergent answers; citations are to
primary sources.

- **Split traffic by delivery contract.** The TRIBES networking model routes
  moves, events, and object state ("ghosts") through separate managers with
  distinct reliability/priority semantics filling each packet in fixed order
  (Frohnmayer & Gift, *The TRIBES Engine Networking Model*, GDC 1999,
  https://www.gamedevs.org/uploads/tribes-networking-model.pdf). Halo: Reach
  likewise separates reliable events from unreliable, aggressively
  prioritized state replication (Aldridge, *I Shot You First! Networking the
  Gameplay of Halo: Reach*, GDC 2011,
  https://www.gdcvault.com/play/1014346/I-Shot-You-First-Networking).
- **Per-object, per-client priority with distance as the core metric.**
  Halo: Reach computes priority per object per client, distance/direction
  first, with boosts for gameplay salience (Aldridge, GDC 2011). Torque
  prioritizes ghost updates by distance and perpendicular velocity
  (Torque documentation of `NetObject::getUpdatePriority`). Unreal's
  Replication Graph replicates moving actors at a frequency derived from
  distance (`UReplicationGraphNode_DynamicSpatialFrequency`) and explicitly
  tracks and heals starved actors when saturation cut them off
  (`HandleStarvedActorList`; Epic, Replication Graph docs).
- **Priority accumulators: urgency grows over time, senders fill a budget,
  what does not fit stays first in line.** Fiedler's state-synchronization
  articles describe the canonical structure: accumulate per-object priority
  each frame, sort, fill the packet to a byte budget, reset only what was
  sent (Fiedler, *State Synchronization*,
  https://gafferongames.com/post/state_synchronization/, and *Networked
  Physics in Virtual Reality*,
  https://gafferongames.com/post/networked_physics_in_virtual_reality/).
- **Dynamic, not fixed, bandwidth targets.** "The desired bandwidth can even
  be adjusted on the fly … if you detect the connection is having difficulty
  you can reduce the amount of bandwidth sent … and raise it later"
  (Fiedler, *State Synchronization*).
- **Quantize and bound state instead of starving objects.** Snapshot
  compression bounds and quantizes position/rotation to visual precision
  (hundreds of values per meter) because render-only consumers cannot tell
  the difference (Fiedler, *Snapshot Interpolation* and *Snapshot
  Compression*; the VR piece uses 1/1000 cm-scale quantization plus
  smallest-three rotations).
- **Latest-value semantics for state; reliability only for facts.** Tribes'
  ghost updates are eventually consistent — intermediate states may be
  skipped, never replayed (Frohnmayer & Gift; SnapNet's analysis,
  https://www.snapnet.dev/blog/netcode-architectures-part-4-tribes/).
- **Perceptual acceptance testing.** Bungie instrumented playtests with a
  literal "lag button" and iterated until perceived-lag reports stopped
  (Aldridge, GDC 2011) — the acceptance bar for this work (motion-gap
  telemetry + live playtest) follows that practice.

## The design

Voxelize already had the reliable-events vs latest-wins-state split (its
`MessageQueues` vs `ReplicatedStateBuffer` mirrors TRIBES' event vs ghost
managers). This work adds the three missing pieces:

### 1. Motion lane vs metadata lane

Entity state is split by change frequency and perceptual sensitivity:

- **Motion lane**: position, direction, rigid-body fluid state, look-at
  target position — the transforms that animate every frame. Captured
  straight from ECS components, quantized (1/512 block ≈ 2 mm for positions,
  1/512 per direction component, 8-bit fluid ratio), and encoded as a
  versioned binary payload (`motion.v1`, 14–33 bytes vs. hundreds of JSON
  bytes). Quantization doubles as change detection: sub-resolution jitter
  (the "settled boxes still jostling" incident shape) stages nothing at all.
- **Metadata lane**: everything else in the metadata map (paths, text, game
  JSON, target identity) — low-frequency, stays JSON, tolerates more
  latency.

Lifecycle (CREATE / DELETE / OUT_OF_RANGE) stays on the reliable ordered
queue, unbudgeted, with pending state slots cleared on every transition so a
released entity can never be resurrected by stale state. CREATE and INIT
still carry the complete JSON snapshot (including motion keys), so a client's
initial state never depends on the compact path.

### 2. Wall-clock earliest-deadline-first scheduling

Every staged slot carries a deadline: `staged_at + max_age(lane, distance)`.

- Motion max age is a config knob (`entity_motion_max_age_ms`, default
  100 ms), scaled by proximity — the nearest entities get half the bound,
  the far edge of the interest radius gets the full bound. This is Halo's /
  Unreal's distance-scaled frequency expressed as a deadline rather than a
  rate.
- Metadata max age is a constant 250 ms.
- At flush time, slots past their deadline ship **regardless of budget**
  (the freshness guarantee; volume is inherently bounded because each entity
  can go overdue at most once per max-age window), then the remaining budget
  fills earliest-deadline-first. Coalescing keeps the *earliest* deadline,
  so a slot's place in the schedule only moves forward — the deadline is a
  monotone priority accumulator (Fiedler's structure, with "priority" in
  milliseconds), and forced-overdue shipping is Unreal's starved-actor
  healing made a hard contract.

Deadlines are wall-clock, not tick counts: when the tick rate sags the
schedule compresses instead of silently stretching — which is precisely when
the previous design's gaps grew worst.

### 3. Dynamic budget from live socket state

`state_flush_budget(base, tick_ms, backlog)`:

- backlog 0 (socket fully drained): base × 4 — no reason to ration freshness
  when the transport demonstrably keeps up;
- backlog 1..=8: base × 4/(1+backlog) — proportional clamp under genuine
  pressure;
- backlog > 8: gated — no state flush at all; slots keep coalescing to their
  newest value and the client receives one current snapshot when it drains
  (never a replay of stale frames). A wedged socket is eventually torn down
  by the existing write timeout; the #110 keep-alive/ack tolerances are
  untouched.
- The budget also scales linearly with the measured tick duration (capped at
  4×), so the byte *rate* holds when ticks sag.

This is Fiedler's adjust-bandwidth-on-the-fly, driven by the same per-lane
socket depth signal the engine already used for its flush gate.

### 4. Versioned compact wire path with negotiated fallback

Clients advertise `capabilities: ["motion.v1"]` in JOIN. Only then does the
server send `Entity.motion` binary payloads (new protobuf field) and strip
motion keys from metadata-lane JSON; the client folds decoded motion back
into the entity's metadata, so game code reads `metadata.position` etc.
unchanged. Legacy clients (e.g. Town's current pin) negotiate nothing and
receive byte-for-byte the JSON wire shape they already parse — but their
sends now ride the same deadline scheduler, so the freshness fix does not
wait for a client upgrade; the bandwidth fix does.

## Alternatives considered and rejected

- **Keep #111's oldest-first rotation, tune the budget.** Rejected: with one
  undifferentiated lane, any budget small enough to protect marginal links
  rations motion freshness across ALL movers equally, and tick-counted
  fairness degrades exactly when the server struggles. No constant fixes a
  structural problem.
- **Send-rate throttling per entity (fixed Hz tiers by distance).** Simpler
  than deadlines, but provides no guarantee under load (tiers still compete
  for one budget) and reintroduces tick-coupling. The deadline formulation
  gives the same distance-scaled behavior plus a hard bound.
- **Delta compression against per-client acked baselines** (Fiedler's VR
  approach, Quake-style). Rejected for now: it requires a per-client ack
  feedback channel, per-entity baseline tracking on both sides, and careful
  loss handling — significant complexity for a payload that quantization
  already shrinks to ~30 bytes. The `motion.v1` version byte leaves room for
  a delta-encoded `motion.v2` if profiling ever shows the id-string overhead
  (~21 bytes of nanoid per update) dominating; per-client entity index
  tables would then also be on the table.
- **Snapshot-everything at fixed rate** (Fiedler's snapshot interpolation,
  Overwatch-style full world states). Rejected: Voxelize interest sets are
  large (24-chunk radius) and heterogeneous; per-entity latest-wins slots
  with interest management scale better and are already the engine's model.
- **Client-side extrapolation (dead reckoning) to hide gaps.** Out of scope
  and out of contract: Voxelize clients render server state with a short
  interpolation buffer (`Creature`, 50 ms); guaranteeing fresh inputs to
  that buffer is the server's job. Extrapolation guesses wrong at direction
  changes and would change Town gameplay feel.
- **Unreliable transport for motion (WebRTC datagrams) instead of
  scheduling.** The engine already opportunistically uses RTC when
  available; WebSocket remains the baseline transport and its ordered
  reliability is why latest-wins coalescing + gating matters. Transport
  swaps do not remove the need for a scheduler.

## Behavior under pathological clients

- Socket backlog 1–8: budget clamps proportionally; overdue motion still
  ships (a few KB/s at compact encoding).
- Backlog > 8: full gate; everything coalesces (bounded by the interest set,
  hard-capped at 8192 slots/client); on drain the client gets one fresh
  snapshot. No stale replay, no rubber-banding, no unbounded memory.
- Genuinely wedged sockets hit the existing 15 s write timeout and the #110
  dead-socket reaping; nothing in this design disconnects a merely-slow
  client.

## Acceptance

Perceptual freshness is measured, not assumed:

- server: `entity_motion_gap` perf events per client (p50/p95/p99/max of
  wall-clock gaps between consecutive motion-carrying flushes per entity);
- client: `entity_motion_apply_gap` perf events (exact quantiles of
  per-entity apply gaps measured at `performance.now()` resolution);
- `entity_batch_send` reports actual encoded frame bytes, motion/forced
  counts and the live budget.

Design bar: p95/p99 ≤ 100–150 ms per visible mover under 150+ moving
entities, budget-bound bandwidth materially below the ~118–129 KB/tick
incident, no missing/ghost/resurrected entities, lifecycle ordering and
reconnect healing intact. Ship gate: Ian playtest.
