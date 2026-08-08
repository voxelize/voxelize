# Benchmarks: budgets, gates, scenes, metrics, debug views

Rule: numbers below are **acceptance gates**, not aspirations — an implementation PR that
misses a gate on the reference hardware does not merge. Values marked ⚙ are initial
calibrations to be pinned (possibly re-argued with data) in Engine PR A's first benchmark
run; the *structure* of every gate is fixed now.

## 0. Measured results — Engine PR A (see §6 for methodology caveats)

Environment: headless Chromium on **SwiftShader software WebGL** (cloud VM, no GPU),
1280×720, flat demo world, night, `renderRadius` 8, identical deterministic scenes and
camera on both revisions via `scripts/bench-local-lights.mjs`. Software rasterization
executes every fragment on the CPU, so per-fragment shader cost appears grossly amplified
relative to any real GPU — treat GPU-side deltas as loose upper bounds and the CPU-side
milliseconds as real.

| Scene | main p50/p95 (ms) | branch p50/p95 (ms) | registered → clustered |
| --- | --- | --- | --- |
| parity (0 emitters) | 93.5 / 189.2 | 100.6 / 192.7 | 0 → 0 |
| grid 1 | 97.3 / 180.9 | 105.4 / 197.5 | 1 → 1 |
| grid 16 | 98.0 / 151.7 | 116.7 / 217.1 | 16 → 16 |
| grid 128 | 108.0 / 212.0 | 139.0 / 233.3 | 128 → 128 |
| grid 1 000 | 112.3 / 217.1 | 142.7 / 256.8 | 946 → 192 (tier cap) |
| field 10 000, aggregation off | 125.5 / 242.8 | 172.7 / 362.3 | **10 000** → 192 |
| field 10 000, aggregated | 125.2 / 245.0 | 167.0 / 331.4 | **193 records** → 184 |
| torch tunnel (64) | 159.7 / 298.1 | 218.3 / 691.0 | 56 → 42 |

CPU costs of the light system itself (peaks over measurement windows, main thread):

- selection + packing: ≤ 0.2 ms at village scale; **0.63 ms select + 0.13 ms pack** at
  10 000 registered / 7 694 candidates (micro-benchmark, 50 passes) — the linear
  O(registered) pass holds to the biggest scene.
- section emitter scans: ≤ 4.4 ms per frame during cold chunk-load bursts (16 sections;
  amortized by `maxSectionScansPerFrame`), 0 when idle.
- idle frames: selection, packing, and uploads all skip — a 12-minute night soak with a
  perpetually moving orbit light held heap flat (~155–185 MB sawtooth, no trend) with
  zero selection churn.

Behavior gates, all green:

- draw calls flat at 6 in every scene on both revisions (shared-material pipeline
  untouched; invariant holds).
- streaming: 108 registered → fly away → 0 → fly back → **108** (no leak, exact
  restoration).
- churn: 20 place/clear cycles of a 10-torch grid over 20 s; aftermath frame times match
  parity and the registry returns to its pre-churn count.
- quality tiers step 120 → 80 → 80 → 64 → 0 clustered with p50 falling 144.5 → 125.0 ms
  (SwiftShader exaggerates the shader-side delta; `potato` renders the pre-branch frame
  plus emissive).
- context loss/restore: scripted `WEBGL_lose_context` mid-scene; full visual recovery,
  lights re-clustered (80) on the restored context.
- selection determinism and tie-breaks, overflow policy, hysteresis retention, handle
  stability across rescans, and aggregation determinism are locked by unit tests rather
  than benchmarks.

The parity delta (+7.6 % p50, +1.9 % p95) is the cost of the always-present cluster-loop
early-out **under software rasterization**; the added per-fragment work at zero lights is
one uniform integer compare, which real GPUs absorb below measurement noise. Re-verifying
parity on GPU hardware is the one open measurement for the reference-desktop gate table
below.

## 1. Reference hardware & settings

| Class | Reference | Resolution | Tier |
| --- | --- | --- | --- |
| Desktop | GTX 1060 / M1-class, Chrome | 1920×1080 | high |
| Low-end / mobile | Adreno 640-class Android, Chrome | 1280×720 | low |
| Floor | any WebGL2 device | 1280×720 | potato |

All runs: demo world seeded deterministically, fixed camera paths (recorded input scripts
via `@voxelize/agent`), `renderRadius` 6, identical world time unless the scene says
otherwise, single client against a local server (multiplayer-independent by construction —
the light system is client render state; a second connected client must not change any
measured number, verified once by a two-client control run).

## 2. Metrics (collected every run)

CPU (per frame, p50/p95/p99 over ≥ 60 s):
`select ms`, `pack ms` (cells + light rows), `scan ms` (per remeshed section, worker),
`shadow schedule ms`, total added main-thread ms vs baseline.

GPU / renderer:
frame time (`EXT_disjoint_timer_query_webgl2` when available; wall-clock frame delta
otherwise), `drawCalls`, `shadowDrawCalls` (exists in agent `RenderStats` today), local
shadow faces rendered/frame, ledger units consumed by CSM vs locals.

Memory / GC:
JS heap delta over the run, major GC count (Chrome `performance.memory` + devtools
protocol via agent), GPU texture bytes (light textures + atlas), **steady-state allocation
count in light code paths = 0** (asserted by an allocation-tracking dev harness, not
sampled).

System health:
atlas occupancy %, atlas evictions/minute (thrash), shadow cache hit rate
(frames served from cache / frames a shadowed light was visible), selection churn
(selected-set symmetric difference per second — the "visual pop" proxy), overflow cells.

All of it lands in two places: `world.localLights.stats` (below) and the agent's
`RenderStats` extension (`localLights` section) so headless CI reads it over HTTP.

```ts
export interface LocalLightStats {
  registered: number; candidates: number; clustered: number; shadowed: number;
  cellsDirty: number; cellsOverflowed: number;
  selectMs: number; packMs: number;
  shadowFacesRendered: number; ledgerUnitsUsed: { csm: number; local: number };
  atlasOccupancy: number; atlasEvictions: number; shadowCacheHitRate: number;
  selectionChurn: number;
}
```

## 3. Scenes and gates

Scenes are seeded worlds + scripted camera paths added to `examples/server` (test world)
and driven by `@voxelize/agent` `Arena`. Each runs **cold** (first join, empty caches) and
**warm** (after 60 s), and once on `main` and once on the branch at identical
camera/world/settings — the comparison is part of the gate.

| # | Scene | Contents | Desktop gates (high tier) ⚙ | Low-end gates (low tier) ⚙ |
| --- | --- | --- | --- | --- |
| S1 | Null | 0 emitters, plains day | added frame cost ≤ 1 % vs main; 0 light allocations | same |
| S2 | Single torch closeup | 1 torch, wall mount, night | added GPU ≤ 0.3 ms; mask shows no through-wall leak (golden shot) | ≤ 0.3 ms |
| S3 | Room | 16 mixed emitters | select+pack ≤ 0.2 ms p95 | ≤ 0.2 ms |
| S4 | Village at night | ~128 emitters over ~150×150, ~40 in view | select+pack ≤ 0.5 ms p95; added GPU ≤ 1.5 ms p95; shadow faces ≤ 4/frame | ≤ 0.3 ms CPU; added GPU ≤ 1.2 ms; 0 shadow faces |
| S5 | Torch tunnel | 256 torches, 128 m corridor, camera fly-through | no visible pop (selection churn < 2/s at constant speed); every in-range torch lit (L0+L2 continuity) | churn < 2/s; L2 radius 32 |
| S6 | 1 000 registered | town-scale scatter, most out of view | select ≤ 0.6 ms p95 (gather is cell-bound, not count-bound); memory flat | select ≤ 0.4 ms |
| S7 | Lava cavern | ~10 000 emissive lava voxels in loaded chunks | aggregation holds: ≤ `maxProxiesPerSection` analytic records per section, clustered set within tier cap; scan adds ≤ 10 % to mesh-worker section time; added GPU ≤ 2 ms | potato: emissive only, ≤ 0.2 ms added |
| S8 | Held torch run | sprint + jump through village interior/exterior | hero faces ≤ 2/frame p95; no shadow pop on room transitions (hysteresis); leak-free vs golden |
| S9 | Projectile volley | 32 concurrent fire arrows, 8/s spawn/despawn | 0 allocations steady state; add/remove ≤ 0.02 ms each; no selection flicker of statics |
| S10 | Entity crowd | 100 glowing entities among 128 static emitters | `queryLocalLights` total ≤ 0.3 ms/frame for all entities |
| S11 | Dusk transition | S4 through full sun→moon handoff | CSM swing-skip behavior unchanged (debug state identical to main); locals visually constant through handoff |
| S12 | Churn | scripted place/break of 10 torches/s for 60 s | relight+registry+invalidations sustained; frame p99 within 15 % of S4; no cache-hit collapse below 70 % |
| S13 | Streaming flight | straight-line flight, continuous chunk load/unload | registrations track sections exactly (leak assert: registered count returns to baseline after flight); no atlas leak |
| S14 | Soak | S4 idle-orbit 30 min | zero heap growth trend; stats counters stable; no atlas fragmentation growth |
| S15 | Context loss | S4 + scripted `WEBGL_lose_context` lose/restore | full visual recovery ≤ 2 s; caches rebuilt lazily; no crash, no stale textures |

Global gates on every scene: `drawCalls` unchanged vs main except shadow-face fills
(chunk pipeline untouched); no shader recompilations after startup (asserted via renderer
`info.programs` count stability); `shadowDrawCalls` within ledger budget every frame.

Visual-proof set (goldens + demo captures, updated per PR; agent screenshots at fixed
camera keys): torch-against-wall occlusion closeup (front + behind), S4 wide shot, S5
mid-tunnel, S8 room transition sequence, day/noon/dusk/night of the same anchor scene,
underwater lantern + surface torch water shot, custom-shaped block (fence/stair) as
blocker closeup, each quality tier of S4 side-by-side.

## 4. Tier table (D3 — approve these numbers)

| | ultra | high | medium | low | potato |
| --- | --- | --- | --- | --- | --- |
| maxClusteredLights | 255 (R8UI index space) | 192 | 128 | 64 | 0 |
| maxLightsPerCell | 8 | 8 | 6 | 4 | — |
| analyticRadius | 96 | 64 | 48 | 32 | — |
| maxShadowedLights | 4 | 3 | 2 | 0 | 0 |
| shadowAtlasSize | 4096² | 2048² | 2048² | — | — |
| shadowSlotSize | 512² | 256² | 256² | — | — |
| ledger units/frame | 16 | 12 | 8 | 4 | 4 |
| local specular (fluids) | on | on | off | off | — |
| flicker update Hz | 60 | 60 | 30 | 15 | — |

Ledger calibration ⚙: near cascade 4 units, far cascade 6, 256² local face 1, 512² face 2
(re-measured in Engine PR B against actual depth-pass timings; the *ratios* are the
reviewable content).

Degradation order (auto-tier, opt-in; each step logged to stats):
specular off → analyticRadius −25 % steps → maxShadowedLights −1 steps → maxClusteredLights
halved → maxLightsPerCell −2 → L2 off (potato). Recovery climbs the same ladder with 10 s
hysteresis.

## 5. Debug views (ship with Engine PR A/B, used by every benchmark)

Shader modes (`uLocalLightDebugMode`, mirroring the existing `uShadowDebugMode` pattern):
1 = cluster occupancy heatmap (cell light-count → color ramp); 2 = selected-light tint
(each selected light's contribution isolated); 3 = flood-mask view (the occlusion term);
4 = shadowed-light atlas-slot tint; 5 = overflow cells flashed.

CPU overlays (one `InstancedMesh` each, zero per-frame allocation):
light bounds spheres (color = state: clustered / candidate / culled / shadowed), grid
window wireframe, atlas viewer quad (live depth atlas with slot rectangles + owner
labels), selection table + per-light estimated cost (`@voxelize/debug` status-bar pane),
invalidation log ring buffer (cause enum: `blockEdit | eviction | tierChange |
contextRestore | manualRegion`, with region + handle), CSM/local ledger HUD (units
requested vs granted per consumer per frame).

Every overlay is reachable from `world.localLights.debug` and off by default; overlays
allocate only when first enabled.

## 6. Methodology notes

- Harness: `@voxelize/agent` (headless Chromium) — deterministic input scripts, `/render-
  stats` + new stats endpoint polling at 1 Hz, screenshot keys for goldens. CI runs S1–S6
  + S9 + S12 headless per engine PR; S7/S8/S13–S15 run on the desktop reference before
  merge (manual or nightly — cloud VMs have no GPU and only validate correctness, not
  perf).
- Baseline comparisons pin the `main` commit hash in the run metadata; both runs use the
  same seed, camera script, viewport, and tier.
- Warm vs cold definitions: cold = first 10 s after join (atlas empty, shadow caches
  cold, scan backlog draining); warm = minute 2 of the same session. Gates apply to warm
  runs; cold runs gate only on "no frame > 100 ms attributable to light init" (asserted
  via the frame sampler).
- Rust-side: `benches/lights_bench.rs` gains a scan-extraction bench (emitter extraction
  per section) and an aggregation bench; both criterion, thresholds relative (±10 % vs
  committed baseline JSON), run by `pnpm bench:lights`.
