# voxelize-gen `landscape`: design of the terrain and structure generator, with a default preset

Status: amended final design, 7 Oct 2026. This document is the authority for the `landscape` module of `voxelize-gen`. It supersedes the earlier synthesis; Appendix A maps each of the 24 review findings to the section that resolves it, and Appendix B keeps the resolutions of the three design reviews.

The module is unstable until phase P7 freezes it: it compiles only with the non-default cargo feature `unstable-landscape` (section 2.1), so no existing consumer of `voxelize-gen` compiles or links any of it.

**Repo-text rules for this module.** Code, comments, docs, tests and commit messages for `landscape`:
- never name the classic block-building game that voxel engines get compared to, or any of its update names; prior art is described by mechanism ("density-router generators", "piece-graph assembly"), and no prior-art URL is pasted anywhere;
- never name a game built on the engine, its worlds, blocks, biomes or creatures; the reference world the recipes come from is called "the flagship world", and its proven recipes are written down as numbers and math;
- never branch on a literal block name in engine source (`node scripts/engine-boundary/check.mjs` enforces this, plus a consumer vocabulary scan).

**Citations.** Paths are relative to the voxelize repo root. Line numbers were read on the `landscape` branch (based on `origin/main`) and may drift by a few lines.

---

## 0. Summary

`voxelize-gen` already has the right foundation: five-component seed streams with one claimed salt namespace (`crates/gen/src/stream.rs:41-55`), owned, golden-pinned noise (`crates/gen/src/noise.rs`), compile-or-refuse specs (`crates/gen/src/spec.rs`), field programs compiled to register code (`crates/gen/src/field.rs`), proven independence from chunk order (`crates/gen/tests/generation.rs`), and plan-sliced structures (`crates/gen/src/structures.rs`).

What it lacks is what makes a world look massive and worn: a shared column model, planned landforms, a banded 3D pass, water that can be queried, structures that fit the terrain, and one budgeted, measured pipeline. The flagship world has all of these, welded into one large column function and one large fill stage; this design distils them into an engine module with explicit contracts.

**The design** is a new module, `voxelize_gen::landscape` (spec format 2), next to today's generator ("v1"). v1 stays frozen and pinned by goldens. `landscape`:

1. **Acquires every input as a typed handle** from `BuildCtx`. The planner DAG is recorded from those handles, so it always equals the code: an undeclared read cannot compile, a cycle is a compile error, and there are no thread-local re-entrancy guards. The spawn search is a declared DAG node (section 2.7).
2. **Has five plugin kinds**: `Landform`, `RegionSolver`, `Province` (a 3D refine, add or carve owned by a landform), `Surfacer` and `SiteSet`. A slot canyon or a sky-island field is one `Landform`.
3. **Dispatches per chunk**: plans live in a spatial index, and each landform instance is called once per chunk with a masked `ColumnBatch`. A chunk without a feature pays about 1 µs.
4. **Composes by contract**: ground always blends and no write is dropped. Ground ops are one-sided soft clamps that are the identity where the target equals the current ground. Every op is multiplied by an engine-computed footprint fade, so every landform is C0 at its bound by construction. Claims and bands fade by edge too, so no channel switches on a contour.
5. **Keeps one `ChunkFacts` per chunk**: the single source of truth for every pass, public query, structure, flora rule, habitat query, the far sampler and the renderer.
6. **Writes volume as runs**: heightfield, blended refine bands, detached solids and a separate carve list, evaluated only inside declared y bands on world-aligned lattices, with exact culling for separable forms. The run writer maintains the chunk's height watermark.
7. **Treats water as data**: a water layer is (body, level, bed), resolved after composition against final ground. A void-fill rule gives carved voids below a connected body's level to that body. Aquifers are per-cell levels. Fluid role bindings carry the game's fluid configuration, so stamping and the settle test use the same rules as the game's fluid simulation.
8. **Fits structures to terrain**: landform anchors, footprint constraints at a pre-fit tier, worn fit modes with cut and fill budgets, vertical sockets, per-piece protection, underground settlements, and a narrow marker hook for game loot.
9. **Ships a bit-stable worn-not-cut kit**: `pow_smooth` with its analytic derivative, `psin`, `pseudo_angle`, `ring_noise`, one-sided soft clamps, a rational soft ceiling, and Hermite walls, cones, faces and S-walls with inverses.
10. **Makes taste code**: compile-time `TasteGuards` and run-time `QualityReport` bands that check both directions (knife-cut and fake-smooth).
11. **Makes speed code**: deterministic work counters gate CI on any machine; a calibrated wall-clock gate runs on the bench host; budgets are pinned at P3 against a like-for-like warm walk of the flagship world, including a cascaded first-touch metric.
12. **Makes determinism a test kit**: two processes, two platforms, caches at capacity 1, grid equals point, culled equals unculled, an own JSON number path and canonical writer, and no unordered iteration in any output path.
13. **Ships a default preset**, `presets::default_landscape` (key `voxelize.default`), authored in Rust and exported to a golden JSON twin. It exercises every built-in kind through 34 material roles that the game binds to its own blocks, and the `showcase` example serves it as an in-engine world 512 blocks tall.

Every phase (P0 to P8, with P2 split into P2a and P2b) is independently shippable and reviewed. The full program is kept because the owner asked for the best system, not the smallest.

---

## 1. Goals and non-goals

### Goals

**G1. Massive landforms as planned features.** Great ranges with horns and a hero range in view of spawn. Benched canyons with falls. Stratovolcanoes with calderas, and island volcanoes. Sea cliffs with stacks, arches, coves, sea caves and pillar bays. Tors, slot canyons, giant dune seas, sky islands, cavern realms, polar sea ice and ice shelves. Each is placed by a planner, never by accident of noise.

**G2. Worn, not cut, by construction.**
- Every shape comes from C1 profiles.
- Every landform fades to zero at its footprint bound, enforced by the engine.
- Every 3D form fades at band floor, ceiling and edge; claims and bands fade by the owner's edge.
- Ground ops never shift ground where a landform's target equals the current ground.
- Knife-cut and fine-cavity configurations are refused at compile time and measured at run time.

**G3. Noisy at large and medium scale, plain at fine scale.**
- Nothing on ground at a wavelength below 16 blocks except a grain of 0.75 block or less, and declared strata and bench terms with their own guards.
- A floor on medium-scale energy stops terrain from looking fake-smooth. Broad smooth faces are allowed.

**G4. Instant.** Provisional targets for the default preset at H = 512 on the bench host, pinned at P3 (section 7.3):
- warm walking median ≤ 2.5 ms per chunk (stretch 1.5), and no slower than the flagship world's warm median on the same recorded trace and host;
- p95 ≤ 7 ms; worst landform chunk ≤ 12 ms;
- every plan solve on the planner pool, zero solves on the tick thread, and no chunk job waiting more than 10 ms on a solve during the recorded walk.

**G5. Deterministic and bit-stable.**
- Every value is a pure function of (seed, dimension, salt, cell or coordinates).
- Arithmetic in the scope stated in section 2.14 is IEEE add, sub, mul, div, sqrt, floor, abs, min and max only.
- Golden chunk digests exist per preset.
- Identity includes the engine algorithm version, kind versions (with their provinces), typed parameters and resolved roles. It is persisted next to the chunks and checked on load.

**G6. Water as data.** Any system can ask which fluid is at (x, y, z), what kind it is, which body it belongs to, whether it is enclosed, and how it flows. Every fluid voxel belongs to a declared layer.

**G7. Structures native to terrain.** Siting reads facts and landform anchors at a tier that sees every landform; fits blend into the ground before the fill, with cut and fill budgets; settlements can live underground; loot belongs to the game.

**G8. Extensible without engine edits.** Games register landforms, region solvers, provinces, surfacers, site sets, zones, claims and water kinds exactly as built-ins do. Disabling or adding a node leaves chunks byte-identical outside its affected set (section 7.5, test 7).

**G9. Data-authored.** Specs deserialize with `deny_unknown_fields` and path-qualified errors. Overrides use RFC 7396 JSON merge patches. The Rust builder and the JSON twin hash identically. Pieces are data from P6.

**G10. Game-agnostic.** Blocks enter only as role bindings. Kinds and fields use geology words. The engine boundary gate stays clean.

### Non-goals

- **Changing v1 or any existing world.** v1 (`GeneratorSpec`, `compile`, `install`, `CompiledGenerator`) keeps its API and output, pinned by goldens. A world adopts `landscape` only by opting in.
- **Non-local simulation at chunk time.** No droplet erosion, global stream power or global rejection loops. Erosion is analytic, or regional with an apron.
- **Far-layer rendering by default.** Plain fog is the preferred horizon. The far sampler exists for maps, debug routes and tools; games opt in.
- **Wave-function collapse across chunks**, and a node editor in this program. The data specs make an editor possible later.
- **Busy decoration.** Plain caves are common, textures are calm, flora is clustered, never sprinkled.
- **A multi-rate field compiler on the critical path.** It is the optional phase P8, and its rate table is authored data.

---

## 2. Architecture

### 2.1 Where it lives, and how it is gated

| System | Status |
|---|---|
| `server/world/generators` (legacy noise, splines, L-system trees, biome tree) | Frozen. Doc-deprecated in favour of `landscape`. The demo server's `terrain` world keeps using it. |
| `voxelize_gen` v1 | Frozen API and output, pinned by `tests/golden_v1.rs` from P0. Name-free primitives are reused as libraries (section 2.4.2). |
| `voxelize_gen::landscape` (new, format 2) | The convergence target. Purely additive. Compiled only with the `unstable-landscape` feature until P7. |

`voxelize-gen` depends on `voxelize`, and `voxelize` never depends on `voxelize-gen` (`crates/gen/Cargo.toml`). `landscape` therefore needs no engine change on its critical path; optional engine additions are listed in section 13, question 12.

**Cargo wiring** (added in P1; the CI job in P0):

```toml
# crates/gen/Cargo.toml
[features]
default = []
unstable-landscape = ["dep:ryu", "dep:serde_path_to_error"]
kit = ["unstable-landscape"]            # landform_suite!, province_suite!, structure_suite!, determinism suite
gen-counters = ["unstable-landscape"]   # deterministic work counters (cost only, never output)

[dependencies]
ryu = { version = "1", optional = true }                  # pinned float formatter for the canonical writer
serde_path_to_error = { version = "0.1", optional = true } # path-qualified spec errors

[dev-dependencies]
rayon = "1.10"
criterion = { version = "0.5", features = ["html_reports"] }
actix-web = "4"        # showcase example: #[actix_web::main], optional debug HTTP route
log = "0.4"            # showcase example logging

[[example]]
name = "showcase"
required-features = ["unstable-landscape"]
# likewise landscape_render, landscape_census, landscape_profiles, export_preset;
# walk_bench builds without the feature (v1 fixture) and gains landscape workloads with it
```

Rules that keep existing consumers untouched:
- **No new feature on any shared dependency.** Cargo unifies features across a consumer's whole build graph, so a feature turned on here is turned on for the consumer's own code too. serde_json's `float_roundtrip` would change how the consumer's floats parse, and `arbitrary_precision` and `preserve_order` would change how its numbers and maps are represented. `landscape` needs none of them (nor `raw_value`): it parses spec numbers through its own path (section 2.4.3).
- **No derive is added to a v1 type.** `landscape` uses owned mirror types and an explicit lowering layer (section 2.4.2).
- **v1 edits are additive or byte-identical**: explicit `Subsystem` discriminants (identical values) and the new `stream_seed_lane` and `stream_seed_bytes` in P0; name-free entry points behind v1 compile functions in P2a and P6, gated by `golden_v1` (section 10.1).
- **Bitflags are hand-rolled newtypes** (`Claims(u32)`), so no new dependency is needed for them.
- At P7 the feature is renamed `landscape` (still non-default) and `unstable-landscape` stays as an alias for one minor release.

### 2.2 Tiers

Every tier is a pure function of its inputs. Caches change cost, never results.

| Tier | Holds | Keyed by | Built by |
|---|---|---|---|
| L0 prior (optional) | Geology plates and erosion tiles (v1 `GeoModel`) | seed, tile | the `geology_prior` region solver; off in the default preset |
| L1 plans | Landform plans, region tiles, site plans, the spawn anchor, hero plans | seed, kind salt, cell | a `ClockCache` per node, solved on the planner DAG |
| L2 columns | Kept fields, composed ground, claims with weights, water layers, bands, spans, zones, climate, biome, typed cells | seed, (x, z), plans in reach | `ChunkFacts` (chunk path) and the point path (same arithmetic) |
| L3 voxels | Run lists: heightfield ⊕ refine bands ∪ adds ∪ spans − carves; paint, water, pieces, flora | column facts, world-aligned lattices | `LandscapeStage` |

### 2.3 Module map

```
crates/gen/src/
  stream.rs                 (P0) explicit Subsystem discriminants; + stream_seed_bytes
  landscape/                (cfg feature = "unstable-landscape")
    mod.rs                  prelude, re-exports, module docs (game-agnostic)
    cache.rs                ClockCache<K, V>: CLOCK eviction, one entry at a time, cost-only
    math.rs                 pow_smooth (+ derivative), psin, pcos, pseudo_angle, soft clamps, smin/smax,
                            soft_ceiling, smoothstep/smootherstep, bias/gain, exp2_p/log2_p
    profile.rs              Wall, Cone, Face, SWall, SlotSection, DuneWave, Talus, relax; slopes + inverses
    strata.rs               BandTable, BandCursor (wandering absolute-height strata)
    geometry.rs             Footprint SDFs + fade, zero_line_distance, trace_iso, ArcSchedule,
                            FeatureFrame, ring_noise, Lipschitz gate bounds
    lattice.rs              world-aligned trilinear lattices, CellCorners, exact interval bounds
    channels.rs             ChannelNet<P: Copy>: polyline field with a per-vertex payload, sqrt not hypot
    flood.rs                bounded lowest-frontier flood; priority flood with synthetic divides
    settle.rs               fluid steady-state check and pre-settle via a binding's fluid rules
    json.rs                 strict spec reader: correctly rounded numbers, duplicate-key refusal
    canon.rs                canonical writer: sorted keys, pinned float formatting, spec_hash
    spec.rs                 LandscapeSpec, NodeSpec, FieldDef, FrameSpec, Height, Span, RoleDecl,
                            ZoneDecl, WaterKindDecl, TasteGuards, PlanBudgets, Knobs; merge_patch
    mirror.rs               owned mirrors of v1 named configs (climate, surface, flora, ecology, pieces)
    lower.rs                explicit lowering of mirrors to resolved, name-free forms
    identity.rs             LandscapeIdentity, Compat, IdentityFile (persist next to chunks, check on load)
    registry.rs             KindRegistry of factories (built-ins register like game plugins)
    plugin.rs               the five traits, Validate, Fact, Layout, Layer
    build.rs                BuildCtx and the typed handles (records DAG edges)
    dag.rs                  planner DAG, spawn node, composition order, refusals, lints
    fields/                 ir.rs compile.rs (DCE, CSE, bandwidth + Lipschitz analysis) eval.rs grid.rs nodes.rs
    facts.rs                ChunkFacts (SoA + halo), FactKey<T>, Tier, ColumnFact
    compose.rs              ColumnBatch, Col, GroundOp, Claims, ZoneKey, weights, two-pass fold
    index.rs                FeatureIndex (512-block cells), ColumnMask, Field-layout tile gating
    plan.rs                 PlanCtx, probes (macro/coarse/exact), planner pool, prefetch ring,
                            WorkMeter (always compiled, per index under par_map), forbid_solves
    volume.rs               Province plumbing, DensityForm, culling, analytic spans, run lists
    water.rs                WaterKind, WaterDecl, WaterLayer, beds, void fill, aquifers, bodies, stamping
    surface.rs              Surfacer plumbing, PaintColumn, MaterialRuns, lowered paint tables
    sites/                  mod.rs siting.rs constraints.rs fit.rs pieces.rs protect.rs markers.rs
    stage.rs                LandscapeStage, install / install_split, run writer, facts LRU
    query.rs                public queries on Landscape, Query::{Ready, Pending}
    explain.rs              per-column provenance records (render --explain, debug route)
    far.rs                  LandscapeFarSampler: voxelize::FarTerrainSampler (opt-in)
    quality.rs              QualityReport and metrics
    counters.rs             work counters (feature "gen-counters")
    kit/                    feature "kit": suites, determinism suite, assert_no_libm!
    library/                built-in kinds (section 4)
    presets/                default.rs, default.json, plain.rs, roles.rs, demo_blocks.rs, demo_pieces.rs
crates/gen/examples/
  showcase.rs landscape_render.rs landscape_census.rs walk_bench.rs export_preset.rs landscape_profiles.rs
crates/gen/benches/       landscape_kernel.rs  traces/ (recorded walk traces)
crates/gen/budgets/       default.json plain.json fixture.json
crates/gen/tests/         golden_v1.rs landscape_*.rs no_libm.rs golden/
crates/gen/docs/          landscape.md (this document)
```

### 2.4 The spec

#### 2.4.1 Types

```rust
// landscape/spec.rs
pub const LANDSCAPE_FORMAT: u32 = 2;   // v1 keeps FORMAT_VERSION = 1 (crates/gen/src/spec.rs:60)

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandscapeSpec {
    pub format: u32,
    pub preset: String,                          // "voxelize.default"
    pub content_version: ContentVersion,         // owned mirror; From<ContentVersion> for v1 Version
    pub frame: FrameSpec,                        // height (== WorldConfig::max_height), sea, ceiling, bedrock,
                                                 // scale (the knob; section 3.3)
    pub roles: BTreeMap<String, RoleDecl>,       // declared material roles + fallbacks
    pub zones: BTreeMap<String, ZoneDecl>,       // game zone keys (built-in zone keys are registered by kinds)
    pub water_kinds: BTreeMap<String, WaterKindDecl>, // game water kinds (built-ins are registered)
    pub claim_keys: BTreeMap<String, ClaimKeyDecl>,   // game claim bits (16 max)
    pub fields: BTreeMap<String, FieldDef>,      // named shared fields
    pub nodes: BTreeMap<String, NodeSpec>,       // landforms, region solvers, site sets, keyed by id
    pub paint: Vec<PaintNode>,                   // surfacers, applied in list order
    pub biomes: BiomeSpecM,                      // owned mirror: climate partition + biome keys -> paint, flora
    pub flora: Option<FloraSpecM>,               // owned mirror of v1 flora + ecology configs
    pub water: WaterSpec,                        // fluid roles, stamp policy, sea body, aquifer recipe
    pub spawn: SpawnSpec,                        // Fixed { x, z } | Search(SpawnSearch)
    pub taste: TasteGuards,
    pub budgets: PlanBudgets,                    // deterministic step budgets; part of spec_hash
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeSpec {
    pub kind: String,                            // registry key: "canyon", "drainage", "pieces", "game.sinkhole"
    pub salt: String,                            // claimed in the world-wide salt namespace
    #[serde(default = "yes")] pub enabled: bool, // A/B flag (section 7.5 test 7 states the invariant)
    #[serde(default)] pub over: Vec<String>,     // same-layer composition edges: this applies after these
    #[serde(default)] pub under: Vec<String>,    // ...and before these
    pub params: serde_json::Value,               // deserialized + validated by the factory, then re-serialized
                                                 // typed for spec_hash (section 2.14, D6)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Height {
    Abs(f64),
    AboveSea(f64),
    ShareOfRelief(f64),  // × (H − sea), above sea
    ShareOfWorld(f64),   // × H
}

/// A horizontal size. `Span` values scale with the `scale` knob; `Blocks` values never do (section 3.3).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum Size { Span(f64), Blocks(f64) }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoleDecl { pub doc: String, pub fallback: Option<String>, pub fluid: bool }
```

**Spec rules.**
- **Owned strings and BTreeMaps** everywhere, so data loading, hot reload and merge patches just work. There is no `&'static str` in any landscape type and no leaking interner.
- **Library params have no struct-level `Default`.** Optional fields are explicit `Option<T>`, `deny_unknown_fields` catches typos, and the exported preset writes every field. Params never use `skip_serializing_if`, so a typed re-serialization is total.
- **Heights resolve against `WorldFrame`.** Library params take `Height`, never a raw y. The `LiteralHeight` lint refuses an `Abs` landform height under `TasteGuards::strict()`.
- **Horizontal sizes are typed** as `Size::Span` (landform scale, follows the `scale` knob) or `Size::Blocks` (block scale, never scaled).
- **Overrides are RFC 7396 merge patches.** Nodes are a map keyed by id: disabling a node is `{"nodes": {"tors": {"enabled": false}}}`.
- **The spine field.** `frame.height` must equal `WorldConfig::max_height`, as in v1 (`crates/gen/src/spec.rs:448-453`). There is no mandatory topology: the spine is the named field `ground`.

#### 2.4.2 Owned mirrors and the lowering layer

v1's named configs hold `&'static str`: `SaltPath(pub &'static str)` (`crates/gen/src/stream.rs:28-29`), `SurfaceRule.place` (`crates/gen/src/surface.rs:23-27`), `PieceDef.key` and `palette` (`crates/gen/src/structures.rs:89-102`), climate `AxisKey`, `BiomeKey`, surface-table and tag names (`crates/gen/src/climate.rs:16-60`), flora and ecology species, sets and biome lists (`crates/gen/src/flora.rs:35-57`, `crates/gen/src/ecology.rs:41-106`), and `Env.biome_key` returns `&'static str` (`crates/gen/src/ecology.rs:102`). None of them derives `Deserialize`, and none can be built from owned strings without leaking.

So `landscape` never embeds a v1 named type. It defines owned mirrors (`mirror.rs`) and an explicit lowering (`lower.rs`):

| v1 component | Mirror | Lowering target | Phase |
|---|---|---|---|
| `SaltPath` + `stream_seed` | salts as `String` | two additive v1 functions in P0: `stream_seed_lane(world, dim, lane: u8, salt: &[u8], cell)` and `stream_seed_bytes(world, dim, subsystem, salt: &[u8], cell)`, with `stream_seed` rewritten as a call to them. All three hash `lane << 56` and FNV over the same bytes, so `stream_seed_bytes` returns exactly what `stream_seed` returns for the same text (pinned by a P0 test). | P0 |
| `Subsystem` | none | landscape lanes are a landscape-local `Lane` enum passed to `stream_seed_lane` at values 6 and above (`Landforms = 6, Water = 7, Sites = 8, Volume = 9, Spawn = 10`), so v1's public `Subsystem` enum gains no variant and no downstream exhaustive match breaks | P1 |
| `Version` | `ContentVersion { major, minor, patch }` | `From<ContentVersion> for Version` | P2a |
| climate partitions (`ClimateSpec`, `BiomePartition`, overlays) | `BiomeSpecM` | resolved partition over field indices and `BiomeId(u16)`; evaluated by v1's partition math through a name-free entry point | P2a |
| surface tables | `PaintRuleM { when: Vec<PaintCondM>, place: String /* role */ }` | landscape `PaintTable` (role ids → block ids); conditions reimplemented, since landscape adds many | P2a |
| flora and ecology | `FloraSpecM`, `EcologySpecM` | resolved specs with block ids and `BiomeId`s; evaluated by v1's placement through name-free entry points | P2a |
| pieces and pools | `PieceSpecM { key: String, palette: Vec<String /* role or block */>, cells, states, sockets: Vec<SocketM>, anchor, markers }` | resolved pieces with block ids, reusing v1's name-free rotation and packing (`PieceCellState::pack`) | P6 |

**Name-free entry points in v1.** Where a v1 algorithm is worth sharing (climate partition evaluation, flora and ecology placement), P2a refactors v1's compile so that it resolves names first and then calls a new name-free constructor (`from_resolved`). v1's public API and output are unchanged, and `golden_v1` plus the adopting game's own preset digests must stay green. If a refactor would touch a v1 hot path in a way that cannot be shown byte-identical, `landscape` ports the algorithm instead, and a shared-fixture test asserts the port equals v1. Budget: about 1,900 lines including tests (climate 250, flora and ecology 450, pieces 250, mirror and lower 600, tests 350), split across P2a and P6. Data-authored pieces (G9) arrive with the piece mirror in P6.

#### 2.4.3 The number path: reading and writing specs without new serde features

- **Reading** (`json.rs`). A strict RFC 8259 reader produces a `serde_json::Value`. It refuses duplicate keys, NaN and infinity literals, trailing commas and nesting deeper than 64. Integer literals that fit `i64`/`u64` are stored as integers. Every literal with a fraction or exponent is parsed with Rust's `f64::from_str`, which is correctly rounded on every platform, and stored with `serde_json::Number::from_f64`. Typed deserialization then runs through `serde_path_to_error::deserialize(value)`, which gives errors like `nodes.canyons.params.depth.1: expected Height`. So a JSON twin written by the canonical writer reads back to exactly the same `f64` bits as the Rust builder's literals, without enabling `float_roundtrip`.
- **Writing** (`canon.rs`). The canonical form is produced by our own writer, never by serde_json's formatter. It converts a typed value with `serde_json::to_value` (which stores floats exactly and formats nothing), then writes objects with keys sorted by bytes regardless of the map type, no whitespace, minimal string escapes, integers in decimal, `-0.0` normalized to `0.0`, and floats through `ryu::Buffer::format_finite`. `ryu` is a direct, pinned dependency, so the canonical bytes do not depend on which float formatter the lockfile's serde_json uses.
- **v1 note.** v1's `spec_hash` formats through serde_json (`crates/gen/src/spec.rs:766`), and serde_json's formatter changed between lockfiles: one writes `1e16`, the other `1e+16`. The two agree for every float below 1e16. P0 pins v1's fixture hashes and adds a guard test that no v1 fixture float is at or above 1e16, so the v1 pins are lockfile-independent. v1 itself is not changed.

### 2.5 Identity and persistence

```rust
// landscape/identity.rs
pub struct LandscapeIdentity {
    pub preset: String, pub format: u32, pub content_version: ContentVersion,
    pub world_seed: u32, pub dimension: String,
    pub spec_hash: u64,               // canonical writer over the spec with every node's params replaced by
                                      // its typed, validated re-serialization (section 2.14, D6)
    pub canon: u32,                   // canonical writer version (formatting rules, pinned formatter)
    pub algo: u32,                    // ENGINE_ALGO: bumped whenever engine arithmetic changes output
    pub kinds: Vec<KindStamp>,        // every registered kind the spec uses, sorted
    pub roles_digest: u64,            // (role, block name, block id, fluid rules digest), sorted
}
pub struct KindStamp { pub kind: String, pub version: u32, pub provinces: Vec<(String, u32)> }
pub enum Compat { Identical, ContentDrift, AlgoDrift, KindDrift, RoleDrift, FormatDrift, DifferentPreset, DifferentSeed, Unknown }
pub enum DriftPolicy { Refuse, Warn, Allow }

pub struct IdentityFile;
impl IdentityFile {
    /// `<save_dir>/chunks/landscape.identity` when `WorldConfig.saving` (server/world/config.rs:160-163).
    pub fn check_or_write(cfg: &WorldConfig, id: &LandscapeIdentity, policy: DriftPolicy) -> Result<Compat, GenError>;
}
```

**Where the file lives, and why.** The chunk manager stores chunks in `<save_dir>/chunks` (`server/world/voxels/chunks.rs:284-305`), and `Chunks::wipe` deletes every file in that folder (`server/world/voxels/chunks.rs:312-341`). The identity file therefore lives in the same folder, so a wipe resets chunks and identity together and a clean regenerate never trips `Refuse`. Its extension is `.identity`, not `.json`, so nothing that enumerates chunk files by extension sees it. Drift events are appended to `landscape.drift.log` in the same folder, which a wipe also removes.

**Pristine chunks.** With `save_pristine_chunks = false`, the engine default (`server/world/config.rs:185-193`), unedited chunks are never written (`server/world/systems/chunk/generating.rs:405-445`). They always regenerate with the current generator. Drift therefore shows only where chunks were saved, and it shows as seams between saved and regenerated chunks. The policies:
- `Refuse`: start fails on any drift verdict if the chunks folder holds at least one saved chunk. With no saved chunk the file is rewritten silently, because nothing can seam. A missing identity file next to saved chunks gives `Unknown`, which every policy treats as drift.
- `Warn`: logs the verdict with the count of saved chunk files, rewrites the identity, appends to the drift log.
- `Allow`: rewrites and appends silently.

The showcase uses `Warn`. A world that sets `save_pristine_chunks = true` saves everything it generates, so drift seams appear at its generation frontier; such worlds should use `Refuse`.

This closes three gaps in v1: its hash omits the engine version and block ids, its `check_compat` (`crates/gen/src/spec.rs:162`) is wired to no save path, and saved chunks short-circuit generation, so drift at a save boundary must be a decision, not a silent seam.

### 2.6 The five plugin kinds

All five share one shape: an associated `Params`, a const `KIND` and `VERSION`, and a `build` that acquires typed handles. A generic `Node<T>` adapter erases the types and owns each node's cache, fact store, profiler slot and DAG record. Game code never touches the erasure. The registry is `KindRegistry` (it never collides with `voxelize::Registry`, which appears in the same `compile` call).

```rust
// landscape/plugin.rs
pub trait Validate { fn validate(&self, v: &mut Validator); }      // path-qualified errors
pub trait Fact: Copy + Default + Send + Sync + 'static {}         // POD per-column record

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Layer { Uplift, Incise, Shore, Water, Detail, Fit }      // Base (fields) precedes all

pub enum Layout {
    /// One jittered site per `cell`; `roll` is one hash before any other work.
    Cells { cell: i32, roll: f64, reach: i32 },
    /// A continuous, position-pure landform. `tile` is a dispatch tile, not a plan cell: there is no
    /// per-tile plan, and the engine fades the landform by its gate:
    /// edge = smootherstep(clamp(gate(x, z) / fade, 0, 1)). See "Field layouts" in 2.8.
    Field { tile: i32, gate: FieldRef, fade: f64 },
    /// One world-scale plan (spawn-relative hero placements). Must be cheap or prefetched.
    Once { reach: i32 },
}

pub trait Landform: Sized + Send + Sync + 'static {
    const KIND: &'static str;
    /// Covers the landform and every province it owns; identity also records each province's own
    /// (KIND, VERSION) under this landform's KindStamp.
    const VERSION: u32;
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    type Plan: Send + Sync + 'static;
    /// This landform's per-column record, readable by later nodes through FactKey<Self::Cell>. `()` if none.
    type Cell: Fact;

    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, GenError>;
    fn layer(&self) -> Layer;
    fn layout(&self) -> Layout;
    /// Cells and Once layouts: one plan per site. Never called for Field layouts.
    fn plan(&self, _site: Site, _cx: &mut PlanCtx<'_>) -> Option<Planned<Self::Plan>> { None }
    /// Field layouts: one world-constant plan, computed once at compile. It takes no position, so a
    /// Field landform cannot hold position-varying plan state (compile refuses a Field layout without it).
    fn field_plan(&self) -> Option<Self::Plan> { None }
    /// Called once per (instance, chunk) with the instance's masked columns.
    fn columns(&self, plan: &Self::Plan, batch: &mut ColumnBatch<'_, Self::Cell>);
    fn census(&self, _plan: &Self::Plan, _row: &mut CensusRow) {}
    /// Far/LOD contribution: default = columns() over band-limited fields with detail ops skipped.
    fn lod(&self, plan: &Self::Plan, batch: &mut LodBatch<'_>) { lod_default(self, plan, batch) }
}

pub trait RegionSolver: Sized + Send + Sync + 'static {       // drainage, basins, lava pools, geology prior
    const KIND: &'static str; const VERSION: u32;
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    type Tile: Send + Sync + 'static;
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, GenError>;
    fn layer(&self) -> Layer { Layer::Water }
    fn tiles(&self) -> TileLattice;                           // { size, apron } (apron >= influence, validated)
    fn solve(&self, tile: TileId, cx: &mut PlanCtx<'_>) -> Self::Tile;
    fn columns(&self, tiles: &TileSet<'_, Self::Tile>, batch: &mut ColumnBatch<'_, ()>);
}

pub enum Effect { Refine, Add, Carve }
pub enum WetPolicy { Dry, Fill(WaterSource) }                 // Carve only (section 5.3)

pub trait Province: Send + Sync + 'static {                   // 3D, owned by a landform via ProvinceHandle
    const KIND: &'static str; const VERSION: u32;             // folded into the owner's KindStamp
    type Params: Fact;                                        // typed per-column params
    const EFFECT: Effect;
    fn lattices(&self) -> &[LatticeSpec];                     // extra 3D fields (stride >= 3)
    /// Separable forms let the engine cull lattice cells exactly; Opaque is evaluated everywhere in band.
    fn form(&self) -> DensityForm<'_> { DensityForm::Opaque }
    /// Refine: solid > 0, and with every lattice amplitude at zero it MUST equal the heightfield density
    /// `ground + 0.5 − y` (strict refinement). Add: a detached solid, solid > 0. Carve: remove > 0.
    fn density(&self, p: &Self::Params, at: VoxelAt, lat: &LatticeView<'_>) -> f64;
    /// Density depth over which the engine fades this province by its weight (section 2.12).
    fn fade_depth(&self) -> f64 { 2.0 }
    /// ThinPair culling bound: max carve half width over [y0, y1] for this column. The default disables culling.
    fn thin_width_bound(&self, _p: &Self::Params, _c: &BandColumn<'_>, _y0: i32, _y1: i32) -> f64 { f64::INFINITY }
    /// Threshold culling bound: min threshold over [y0, y1] for this column. The default disables culling.
    fn threshold_bound(&self, _p: &Self::Params, _c: &BandColumn<'_>, _y0: i32, _y1: i32) -> f64 { f64::NEG_INFINITY }
    fn wet(&self) -> WetPolicy { WetPolicy::Dry }
    fn paint(&self, _p: &Self::Params, _at: VoxelAt, _lat: &LatticeView<'_>) -> Option<ZoneKey> { None }
}

pub trait Surfacer: Sized + Send + Sync + 'static {
    const KIND: &'static str; const VERSION: u32;
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, GenError>;
    /// Once per column, with every exposure: top, band faces, span tops, cave floors and ceilings.
    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns<'_>);
}

pub trait SiteSet: Sized + Send + Sync + 'static {
    const KIND: &'static str; const VERSION: u32;
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    type Plan: Send + Sync + 'static;
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, GenError>;
    fn siting(&self) -> Siting;
    fn solve(&self, cand: Candidate, cx: &mut SiteCtx<'_>) -> Result<Self::Plan, Reject>;
    /// Bounds, fit ops (ground deltas in the Fit layer), per-piece protection, reservations, claims.
    fn emit(&self, plan: &Self::Plan, out: &mut SiteEmit<'_>);
    fn paint(&self, plan: &Self::Plan, w: &mut SliceWriter<'_>);
    fn markers(&self, _plan: &Self::Plan, _out: &mut Markers) {}
}
```

The built-in data-driven `pieces` site set (piece-graph assembly over v1-style pieces and pools, lowered from owned mirrors) means most games never implement `SiteSet`.

### 2.7 BuildCtx: dependencies are the handles you acquire

```rust
// landscape/build.rs
impl<'a> BuildCtx<'a> {
    pub fn frame(&self) -> &WorldFrame;                                   // H, sea, ceiling, Height + Size resolution
    pub fn field(&mut self, name: &str) -> Result<FieldRef, GenError>;    // named shared field
    pub fn local_field(&mut self, sub: &str, f: impl FnOnce(&mut FieldBuilder) -> FieldNodeId)
        -> Result<FieldRef, GenError>;                                    // salted "<salt>.<sub>", CSE'd globally
    pub fn noise(&mut self, sub: &str, spec: NoiseSpec) -> Result<Noise, GenError>;   // claims "<salt>.<sub>"
    pub fn plans<K: Landform>(&mut self, id: &str) -> Result<PlanReader<K>, GenError>; // typed; refuses wrong kind
    pub fn optional_plans<K: Landform>(&mut self, id: &str) -> Result<Option<PlanReader<K>>, GenError>;
    pub fn occupancy(&mut self, ids: &[&str]) -> Result<ClaimReader, GenError>;       // plan-time footprints
    pub fn probe(&mut self, through: Through<'_>) -> Result<ProbeReader, GenError>;   // composed ground upstream
    pub fn water_of(&mut self, ids: &[&str]) -> Result<WaterReader, GenError>;        // earlier nodes' water decls
    pub fn fact<T: Fact>(&mut self, node_id: &str) -> Result<FactKey<T>, GenError>;   // strictly earlier node only
    pub fn province<P: Province>(&mut self, p: P) -> Result<ProvinceHandle<P::Params>, GenError>;
    pub fn role(&mut self, role: &str) -> Result<RoleId, GenError>;      // must be declared in spec.roles
    pub fn zone(&mut self, key: &str) -> Result<ZoneKey, GenError>;      // built-in or declared zone key
    pub fn water_kind(&mut self, key: &str) -> Result<WaterKind, GenError>; // built-in or declared kind
    pub fn claim_key(&mut self, key: &str) -> Result<Claims, GenError>;  // declared game claim bit
    pub fn anchors(&mut self, tag: &str, of: &[&str]) -> Result<AnchorReader, GenError>;
    /// Reading the spawn anchor makes this node a spawn reader: its footprints must keep `clear` blocks
    /// from spawn (plans that don't are rejected and counted), and the spawn search never sees it.
    pub fn spawn(&mut self, clear: i32) -> Result<SpawnReader, GenError>;
}

pub enum Through<'s> {
    Macro,                 // base fields at macro stride + spine ground: "relief before any detail"
    Layer(Layer),          // + every ground writer in layers strictly below the given layer
    With(&'s [&'s str]),   // + only these nodes (and their transitive inputs)
}
```

**How edges are recorded.** Every method above records an edge in the planner DAG. The DAG cannot drift from the code, because a plugin holding no handle cannot read the thing. Typos in fields, roles, zones, kinds and ids fail in `build()` with a path-qualified `GenError`, never in a hot loop.

**Probe semantics.** `Through::Macro` gives planners relief "before any detail", so tuning detail can never move a plan. `Through::Layer(L)` includes every ground writer in layers strictly below `L`. `Through::With(ids)` may name a node of the reader's own layer only if that node composes strictly earlier (an explicit `over` path), the same rule as fact reads. So `Through::Layer(Layer::Detail)` includes the Water layer and gives final hydrology; it is what tors read to measure crests. `Through::Layer(Layer::Water)` gives shaped relief after Uplift, Incise and Shore, without water.

**The spawn node.** The spawn anchor is an engine node, `engine.spawn`, declared in the DAG like any other:

```rust
pub enum SpawnSpec { Fixed { x: i32, z: i32 }, Search(SpawnSearch) }
pub struct SpawnSearch {
    pub origin: (i32, i32), pub max_radius: i32, pub stride: i32,   // fixed spiral over a lattice
    pub ground: (Height, Height),        // e.g. AboveSea(3) ..= AboveSea(40)
    pub max_slope: f64,                  // L2 at probe stride
    pub temperature: (f64, f64), pub moisture: (f64, f64),
    pub coast_within: Option<i32>,       // blocks; the default preset asks for 1500
    pub clear_radius: i32,               // default 256 (section 4.2 lists each reader's own clearance)
}
```

- **Shape search.** Candidates in fixed spiral order are filtered at macro tier (climate windows, land), then tested through `Through::Layer(Layer::Water)` restricted to nodes that do not read the spawn anchor, directly or transitively. So spawn sees ranges, canyons and coasts; it cannot land in a canyon or on a cliff.
- **Verification.** The first candidate that passes is verified at `Tier::PreFit` (everything but the Fit layer), again excluding spawn readers: dry (no water layer), slope ≤ `max_slope`, and zero ROCK, HYDRO and NO_SITES weight. A failure moves on to the next candidate in the same order. This catches a game's Detail landform or a river that does not read spawn.
- **Readers keep clear.** A node that reads spawn (hero placements, `SpawnDistance` constraints, the volcano's distance rule) keeps its footprints `clear` blocks from spawn. Readers in Uplift, Incise and Shore must use `clear ≥ spawn.clear_radius`, or compile refuses. Because excluded readers stay clear, the ground and water the search saw at the spawn column are final; `spawn_point()` returns (x, final top + 1, z) and the kit asserts a dry, calm spawn on gate seeds.
- **Cycles.** A node that reads spawn and is also needed by spawn is a compile error printed as a cycle.

**Compile refusals** (each path-qualified):
- a cycle, printed as `coasts → canyons → coasts` with a suggested fix;
- a read from the same or a later layer through `Through::Layer`, or a same-layer `Through::With` read of a node that does not compose strictly earlier;
- an unknown id, or the wrong kind for a typed reader;
- a disabled dependency, unless acquired with `optional_plans`;
- a `fact::<T>(id)` whose node does not compose strictly earlier than the reader (section 2.8);
- a salt collision, or the reserved `engine.` prefix;
- a halo above 4, or a reach above the preset cap;
- an undeclared role, zone key, water kind or claim key;
- a Field layout without `field_plan`, or with a gate whose Lipschitz bound is unknown (section 2.13);
- a spawn reader in Uplift, Incise or Shore with `clear < spawn.clear_radius`;
- a `TasteGuards` violation under `strict()`.

**Lints** (warnings; listed in the compile report and the census): `ImplicitOrder` (a game ground writer placed by the default order, section 2.8), `NarrowGate` (a smoothstep window under 2 blocks of input-equivalent), `MixedScale` (a term mixing `Span` and `Blocks` sizes; a refusal under `strict()`), `LiteralHeight` (a refusal under `strict()`).

### 2.8 The composition contract

`ColumnBatch` is the only way to write columns. Composition order is a total order independent of the planner DAG:

1. `Layer`;
2. within a layer, a topological order of the explicit `over`/`under` edges, breaking ties by (built-in rank from the engine's default table, then game nodes, then node id);
3. then instance cell.

A game ground writer with no `over`/`under` edge composes after every built-in writer of its layer (the default "after built-ins" order), and compile prints the `ImplicitOrder` lint naming it. So a new built-in added to a layer never breaks a game spec; it composes before the game's defaulted nodes, and identity changes only because the spec now names a new kind.

That independence is what lets a canyon (Incise) always compose over a range (Uplift) even though horns read canyon occupancy at plan time.

```rust
// landscape/compose.rs
impl<'a, C: Fact> ColumnBatch<'a, C> {
    pub fn iter(&mut self) -> impl Iterator<Item = Col<'_, C>>;   // masked lanes, row-major
    pub fn scratch(&mut self) -> &mut HaloGrid<f64>;               // halo-sized grid for stencils (relax)
}
impl<C: Fact> Col<'_, C> {
    pub fn x(&self) -> i32;  pub fn z(&self) -> i32;
    pub fn xf(&self) -> f64; pub fn zf(&self) -> f64;              // column centres (x + 0.5)
    pub fn edge(&self) -> f64;              // engine fade in [0,1]: footprint (Cells/Once) or gate (Field)
    pub fn weight(&self) -> f64;            // edge · exclusion: the t applied to this instance's ops
    pub fn ground(&self) -> f64;            // composed so far (lower layers + earlier instances)
    pub fn field(&self, f: FieldRef) -> f64;
    pub fn ground_op(&mut self, op: GroundOp);
    pub fn slope_hint(&mut self, s: f64);   // analytic slope where this op dominates (t ≥ 0.999)
    pub fn claim(&mut self, c: ColumnClaims);   // weight t; ColumnClaims has no exclusive bit (plan-level only)
    pub fn claim_scaled(&mut self, c: ColumnClaims, s: f64); // weight t·s, s in [0,1]: a claim faded inside a footprint
    pub fn zone(&mut self, z: ZoneKey);
    pub fn province<P: Fact>(&mut self, h: &ProvinceHandle<P>, lo: i32, hi: i32, p: P); // refine, add or carve
    pub fn solid_span(&mut self, lo: i32, hi: i32, role: RoleId);   // analytic interval (stacks, tors, shelves)
    pub fn water(&mut self, w: WaterDecl);  // resolved after compose (section 5.2)
    pub fn cave_ceiling(&mut self, y: i32);
    pub fn classify_as(&mut self, h: f64);  // height the biome classifier sees (pillar crowns → lowland)
    pub fn cell(&mut self, c: C);
    pub fn read<T: Fact>(&self, k: FactKey<T>) -> Option<T>; // keys of strictly earlier nodes only
    pub fn claim_weight(&self, c: Claims) -> f64;            // max weight so far for these bits
}

pub enum GroundOp {
    Set   { h: f64, w: f64 },   // cur + w·(h − cur)
    Carve { h: f64, k: f64 },   // one-sided soft clamp down: cur − r_k(cur − h)
    Build { h: f64, k: f64 },   // one-sided soft clamp up:   cur + r_k(h − cur)
    Raise { dh: f64 },          // cur + dh
}
// r_k(d) = 0 if d ≤ 0;  d²/(2k) if 0 < d < k;  d − k/2 if d ≥ k.   (k = rounding width in blocks)
// Applied as: cur ← cur + t·(op(cur) − cur), with t = edge · exclusion · hydro_guard
```

**Ground ops are one-sided soft clamps.** `r_k` is C1 (r(0) = r′(0) = 0, r(k) = k/2, r′(k) = 1), monotone, and never exceeds d. So:
- **Identity where the target equals the ground.** `Carve` returns `cur` bit for bit whenever `h ≥ cur` (`cur − 0.0`), `Build` whenever `h ≤ cur`, `Set` whenever `h == cur`, `Raise` whenever `dh == 0`; the weighted application then adds `t·0.0`. The fade ring and every flank where a landform's delta is zero are untouched. The kit test `ground_ops_identity` checks this bitwise over random inputs, including through the full fold.
- **Monotone and C1** in both `cur` and `h`: the result never inverts a slope.
- **Engaged offset.** A fully engaged `Carve` (cur − h ≥ k) lands at exactly `h + k/2`; a fully engaged `Build` at `h − k/2`. A monotone C1 clamp that is the identity at `h == cur` cannot also land exactly on `h`, so the offset is part of the contract. A landform that wants floor `F` writes its depth through its profile as `h = cur − profile(u)·(cur − F + k/2)`: where the profile is 0 (rim, fade ring) `h == cur` and the identity holds; where it is 1 the result is `F`.
- **Overlaps.** Two carves resolve as "lowest wins" with a C1 junction and no crease. Symmetric `smin`/`smax` remain field nodes for blending fields; they are never ground ops, because `smin(a, a, k) = a − k/4` would shift ground wherever two inputs agree.

**How each channel combines** (documented and tested word for word):

| Channel | Writer | Combination |
|---|---|---|
| ground | `ground_op` | Ordered fold as above. The soft ceiling applies last. Never dropped. |
| slope | `slope_hint` | L2 stencil on final ground (halo). A hint replaces it only where its op dominates. |
| claims | `claim`, `Planned::claims` | Per bit: weight = max over claimants of `edge · exclusion`; owner = argmax, ties to the later instance in composition order. Consumers fade by the weight (table below); nothing switches on a contour. |
| refine bands | `province` (Refine) | Deviations from the heightfield, summed with per-band weights (section 2.12). No count limit, nothing dropped. |
| adds | `province` (Add) | Union by max of weight-faded densities. |
| carves | `province` (Carve) | A separate list from bands. Union by max of carve densities faded by weight, by NO_CAVES weight and by foreign ROCK weight; respects `cave_ceiling`, `ProtectMask` and the water seal. |
| spans | `solid_span` | Union. |
| water | `water` | Declarations are collected and resolved after compose against final ground (section 5.2); stacked by level and disjoint; overlap goes to the later instance in composition order. |
| cave ceiling | `cave_ceiling` | Minimum. |
| zone | `zone` | Among the instances that wrote a zone at this column, the one with the largest `t`; ties to the later instance. |
| classify | `classify_as` | Same owner rule as zone, among writers of `classify_as`. |
| cell | `cell` | Per landform, under its own `FactKey`. |

```rust
/// Engine bits 0..16, game claim keys 16..32 (declared in spec.claim_keys, acquired with cx.claim_key).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Claims(pub u32);
impl Claims {
    pub const ROCK: Self      = Self(1 << 0); // bare rock: soil/cover yield; foreign carves fade out
    pub const HYDRO: Self     = Self(1 << 1); // drainage/basins keep out; the owner supplies its water
    pub const NO_CAVES: Self  = Self(1 << 2); // carve provinces fade out
    pub const NO_BANDS: Self  = Self(1 << 3); // lower-ranked refine deviations fade out
    pub const NO_SITES: Self  = Self(1 << 4);
    pub const NO_FLORA: Self  = Self(1 << 5);
    pub const FALLS_OK: Self  = Self(1 << 6); // drainage may form a knickpoint fall across this column
}
// impl BitOr, BitAnd, contains(): hand-rolled, no dependency.
pub struct ColumnClaims(Claims);     // constructible from any Claims; there is no EXCLUSIVE bit to set
```

**Claim consumers fade by weight:**

| Bit | Consumer | Rule at weight w |
|---|---|---|
| ROCK | soil and cover depth; carves owned by other landforms | soil depth × (1 − w); foreign carve faded with w (section 2.12) |
| HYDRO | drainage and basins; later-layer ground ops | routing treats w ≥ 0.5 as reserved (routing is discrete, and the owner supplies water there); drainage's own ground ops × (1 − w); Detail and Fit ground ops on water-declared columns × (1 − w) (the hydro guard) |
| NO_CAVES | carve provinces | carve faded with w: caves taper out instead of ending in a wall |
| NO_BANDS | refine bands of lower-ranked instances | deviation × (1 − w) |
| NO_SITES | site constraints | a footprint is rejected if any column has w > 0 (placements are discrete; conservative) |
| NO_FLORA | flora placement | placement probability × (1 − w) |
| FALLS_OK | drainage knickpoints | allowed where w ≥ 0.5 (discrete) |
| game keys | game plugins | read with `claim_weight` and from facts |

**Exclusivity is plan-level.** `Planned::exclusive()` marks an instance whose presence suppresses every lower-ranked instance: each lower-ranked contribution in every channel is multiplied by `exclusion = Π(1 − e_h)` over higher-ranked exclusive instances h present at the column, where `e_h` is h's edge. Exclusivity is known from footprints before any `columns()` call, so the fold is two-pass: pass 1 computes every instance's edge from its footprint SDF or gate, plus the exclusions; pass 2 folds with final weights. The result is deterministic and independent of evaluation order. A per-column exclusive claim cannot be expressed (`ColumnClaims` has no such bit).

**Fact reads see only earlier nodes.** `BuildCtx::fact::<T>(id)` refuses unless node `id` composes strictly earlier than the reader: an earlier layer, or the same layer with an explicit `over` path from reader to `id`. Surfacers, site sets, flora and queries run after composition and may read any fact.

**C0 by construction.**
- For Cells and Once layouts, `edge()` comes from the plan's declared `Footprint` (`disc`, `capsule_chain`, `polygon`, `rect`, `channel(&ChannelNet, half_width_fn)`) and its `.fade(w)`: `edge = smootherstep(clamp(sdf_inside / w, 0, 1))`. Columns outside the footprint are never called, and edge is 0 on the bound.
- A plan whose footprint leaves `cell ± reach` panics in debug builds; in release it is rejected and counted, never clamped (clamping would leave a cut edge).
- **Field layouts.** A Field landform is position-pure: its only plan is the world-constant `field_plan()`, so a column's contribution is a pure function of its position and the gate. Its edge comes from the gate, `smootherstep(clamp(gate / fade, 0, 1))`, and the gate must be continuous (compile refuses a gate containing a hard `Select`). Dispatch tiles never fade anything; they are only a cost device. A tile is dispatched when a conservative upper bound of the gate over the tile is above 0: the maximum of macro samples at stride s over the tile plus a one-sample ring, plus `L·s/√2`, where `L` is the gate's Lipschitz bound from the field compiler's analysis (section 2.13). The bound can only over-dispatch, never miss a cell.
- The kit's `edge_continuous` test samples column pairs across every footprint bound and, for Field layouts, across every dispatch-tile boundary.

### 2.9 Facts: one record per chunk

```rust
// landscape/facts.rs  (SoA over (16 + 2h)², halo h = max declared stencil, default 2, cap 4)
pub struct ChunkFacts {
    pub origin: (i32, i32), pub size: u16, pub halo: u8,
    pub ground: Box<[f64]>,          // continuous final ground (one definition of ground)
    pub top: Box<[i16]>,             // solid top of the heightfield
    pub slope: Box<[f32]>,           // L2, from final ground
    pub aspect: Box<[[f32; 2]]>,     // unit downhill vector, [0,0] on flats (no atan2)
    pub curvature: Box<[f32]>,       // Laplacian of final ground
    pub temperature: Box<[f32]>, pub moisture: Box<[f32]>,
    pub biome: Box<[BiomeCell]>,     // dithered BiomeId + edge weight
    pub zone: Box<[ZoneKey]>, pub cave_ceiling: Box<[i16]>, pub classify: Box<[f32]>,
    pub owner: Box<[OwnerRef]>,      // zone owner (census, far, explain)
    pub claims: SparseCols<ClaimEntry>,   // (bits, weight, owner) per claimed column
    pub water: WaterTile,            // resolved stacked layers per column
    pub aquifer: AquiferTile,        // per-column aquifer level + barrier flag (section 5.4)
    pub bands: SparseCols<BandRef>, pub adds: SparseCols<BandRef>, pub carves: SparseCols<BandRef>,
    pub spans: SparseCols<SolidSpan>,
    pub kept: KeptFields,            // only fields declared `keep: true`, stored f32
    pub plans: PlansInReach,         // Arc'd plans per node touching chunk ∪ halo
    pub protect: ProtectMask,        // per-piece cells + clearance
    ext: ExtStore,                   // FactKey<T> stores: landform Cells, province params
}
pub struct FactKey<T: Fact> { slot: u16, _t: PhantomData<T> }

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Tier { Macro, Shaped, Hydro, PreFit, Full }
//              after Base | after Shore | after Water | after Detail | everything (incl. Fit)
```

- **One definition of ground.** `ground` replaces v1's diverging definitions (`surface_raw`, `adapt_surface`, `ground_at`, the river bank raise, the lake fill), so no pass can read unadapted ground.
- **L2 slope everywhere**, which removes the axis banding an L1 slope produces.
- **Tier semantics.** A tier's answer equals the full pipeline's intermediate state after that layer; the kit's `lean_tiers_equal_full` asserts it. Site constraints use `Tier::PreFit`, which sees every landform's claims (a tor's NO_SITES included) and never the fits themselves, so siting has no cycle.
- **Memory.** 400 columns at the default halo × about 62 bytes of fixed channels, plus 4 bytes per kept field (the default preset keeps 6), is about 34 KB, plus sparse stores (typically 4–10 KB): about 40 KB per chunk. Fields not marked `keep` are evaluated into thread scratch and dropped. The facts LRU is capped in bytes (default 24 MB, about 600 chunks), not in entries.

### 2.10 Queries

```rust
// landscape/query.rs
pub enum Query<T> { Ready(T), Pending }
impl Landscape {
    pub fn chunk_facts(&self, chunk: Vec2<i32>) -> Arc<ChunkFacts>;             // worldgen/tool threads
    pub fn column(&self, x: i32, z: i32, tier: Tier) -> ColumnFact;            // may solve plans
    pub fn column_ground(&self, x: i32, z: i32, tier: Tier) -> f64;            // one column, no stencil
    pub fn column_if_ready(&self, x: i32, z: i32, tier: Tier) -> Query<ColumnFact>; // never solves;
                                                                                  // Pending enqueues prefetch
    pub fn water_at(&self, x: i32, z: i32) -> WaterColumn;
    pub fn water_if_ready(&self, x: i32, z: i32) -> Query<WaterColumn>;
    pub fn fluid_at(&self, x: i32, y: i32, z: i32) -> Option<WaterHit>;
    pub fn water_body(&self, id: WaterBodyId) -> Option<WaterBodyInfo>;
    pub fn nearest_water(&self, x: i32, z: i32, kinds: WaterKindSet, max_r: i32) -> Option<(WaterHit, i32)>;
    pub fn cave_zone_at(&self, x: i32, y: i32, z: i32) -> Option<ZoneKey>;     // vertical zone partition
    pub fn fact<T: Fact>(&self, key: FactKey<T>, x: i32, z: i32) -> Option<T>;
    pub fn plans<K: Landform>(&self, h: &LandformHandle<K>, area: Aabb2) -> Vec<Arc<K::Plan>>; // typed
    pub fn anchors_near(&self, tag: &str, x: i32, z: i32, r: i32) -> Vec<Anchor>;
    pub fn structures_near(&self, area: Aabb2) -> Vec<StructureInfo>;
    pub fn spawn(&self) -> (i32, i32);
    pub fn spawn_point(&self) -> (i32, i32, i32);                              // y = final top + 1
    pub fn explain(&self, x: i32, z: i32) -> ColumnExplain;                    // provenance (section 7.1)
    pub fn prefetch_around(&self, points: &[(i32, i32)], radius: i32);
    pub fn far_sampler(&self) -> Arc<dyn voxelize::FarTerrainSampler>;
    pub fn quality(&self, window: Aabb2, stride: u32) -> QualityReport;
    pub fn identity(&self) -> &LandscapeIdentity;
}
```

**How point queries stay cheap and exact:**
- they read the facts LRU first, which is O(1) for generated chunks;
- then a bounded column cache;
- on a cold miss, `column_ground` composes one column; only a query that needs slope or curvature builds a (2h+1)² mini-grid, so slope equals the chunk path bit for bit (the `grid_equals_point` test);
- `fluid_at` tests surface layers first, then the aquifer or void-fill rule at that one voxel only (section 5.4).

Budgets (cold, excluding plan solves): `column_ground` at `Tier::Hydro` ≤ 40 µs; `fluid_at` adds ≤ 10 µs. `plans` is typed through a `LandformHandle<K>` obtained from the registry.

### 2.11 Per-chunk data flow

`landscape::install(&mut pipeline, land, hooks)` adds one engine stage, `landscape`. The pipeline fuses stages that need no neighbour `Space` and rescans the height map between fused inner stages (`server/world/generators/pipeline.rs:46-61`) and again after each job (`:480`), so a single stage avoids most of those rescans. Games that interleave their own stages use `install_split`, which adds three stages (terrain, structures, flora), each reading `Arc<ChunkFacts>` from the LRU; a miss recomputes, because facts are pure.

```
LandscapeStage::process(chunk)
 0 index   FeatureIndex: instances whose footprint touches chunk ∪ halo → ColumnMask each; Field
           tiles admitted by their conservative gate bound; enqueue the prefetch ring on the planner pool
 1 fields  macro tiles (stride 16, shared cache) + Stride(4) grids + full-rate columns over (16+2h)²
 2 base    ground ← field "ground"
 3 compose pass 1: edges and exclusions; pass 2: for layer in Uplift, Incise, Shore, Water, Detail, Fit:
             for instance in composition order: instance.columns(plan, masked batch)   // 1 dyn call each
           water declarations collected; hydro guard on Detail/Fit ops; soft ceiling last
 4 final   L2 slope/aspect/curvature (halo); lapse; orographic moisture; biome blend + dither;
           claim weights; cave_ceiling (including the water seal ring); protect mask
 4b water  resolve beds against final ground; stack; sea layer; aquifer level per column (section 5)
 5 volume  one LatticeSet over ∪(band ranges, province gates) with world-aligned nodes;
           per column: runs = heightfield ⊕ refine ∪ adds ∪ spans − carves; void fill (section 5.3)
 6 paint   surfacers in list order over every exposure → material runs (strata via BandCursor; cave zones)
 7 water   stamp resolved layers by StampMode, with the binding's fluid rules (section 5.5)
 8 sites   structure slices (rotated packed states), stilts/terrace fills, MarkerEvents → MarkerHook
           → chunk.block_entity_seeds
 9 flora   lowered v1 flora/ecology reading facts (NO_FLORA weight, reservations, water distance, slope)
10 write   run writer (section 2.12, item 7); chunk.top_filled_y; chunk.biome_tints from the biome tint
           table when declared (four corners, x-fast RGB multipliers); publish Arc<ChunkFacts>
```

**Warm targets** for a 16×16×512 chunk on the bench host. They are provisional, extrapolated from measured primitives (about 4.1 ns per 2D noise octave, 6.6–7.3 ns per 3D octave, 6.5 ns per bicubic), and are pinned at P3 against measurement (section 7.3):

| Step | Provisional target |
|---|---|
| 0 index and plan references | 0.01 ms |
| 1 fields | 0.15 ms |
| 3 compose (only where instances exist) | 0–0.30 ms |
| 4–4b finalize and water resolve | 0.06 ms |
| 5 volume (caves culled, bands where declared) | 0.30 ms, measured at H = 512 in P3 |
| 6 paint runs | 0.10 ms |
| 7 water stamp | 0.02 ms |
| 8–9 sites and flora (when present) | 0–0.30 ms |
| 10 run writer | 0.10 ms |
| **Walking p50** | **gate 2.5 ms, stretch 1.5 ms** |

### 2.12 Volume: runs, spans, culled lattices

The volume model is a heightfield everywhere, with density only inside declared y bands on the columns that need it, faded at floor, ceiling and horizontal edge. A chunk without a band builds nothing 3D.

1. **Analytic solid spans first.** Stacks, pillars, tor slabs, ice shelves and cliff faces with an analytic inverse write `[lo, hi]` spans per column with no lattice at all (the sea-cliff `Face::offset(v)` gives how far in the face lies at height v).

2. **Three effects, all faded, none dropped.** Let `d_hf(y) = ground + 0.5 − y` be the heightfield density. Every province entry i on a column carries a weight `w_i = edge_i · exclusion_i` and a band fade `f_i(y) = smoothstep(lo_i, lo_i + b, y) · (1 − smoothstep(hi_i − b, hi_i, y))`, with `b ≥ TasteGuards::min_band_fade` (1 block). With `u_i = w_i · f_i(y)` and `F_i` the province's `fade_depth()`:
   - **Refine** (ground-attached: crests, shelves, coast faces, notches into a wall): `d = d_hf + Σ_i u_i · (1 − N_i) · (d_i − d_hf)`, where `N_i` is the largest NO_BANDS weight from claimants ranked above i. Any number of bands may overlap, and a strata shelf against a range crest blends instead of losing a band. Strict refinement (`d_i = d_hf` when amplitudes are 0) means a zero-amplitude band changes nothing.
   - **Add** (detached solids: sky islands): `d_add = max_i (u_i · d_i − (1 − u_i) · F_i)`, so at `u_i = 0` an add contributes nothing and its zero set shrinks smoothly as the weight falls.
   - **Carve** (a separate list): `c_i' = v_i · c_i − (1 − v_i) · F_i` with `v_i = u_i · (1 − NC) · (1 − R_i) · smoothstep(0, 4, ceiling − y)`, where `NC` is the NO_CAVES weight, `R_i` the ROCK weight of claimants other than i's owner, and `ceiling` the column's cave ceiling. Caves taper out at claim bounds and below ceilings instead of ending in a wall.
   - A voxel is solid when `(max(d, d_add) > 0 or inside a span)` and not `(max_i c_i' > 0 and not protected)`.
   - **Water seal.** Under a surface water layer, refine deviations are additionally multiplied by `smoothstep(level + 1, level + 3, y)` (nothing moves at or below a water surface), and the cave ceiling of every water column and its four neighbours is lowered to `bed − seal` (seal 2 by default), so no Dry carve opens under or beside surface water. Carves with a Fill policy are handled by the void-fill rule (section 5.3).

3. **Separable forms are culled exactly.** Trilinear interpolation is a convex combination of the 8 cell corners, so corner min and max bound every voxel in a cell.

   ```rust
   pub enum DensityForm<'a> {
       /// d(y) = (g − y)/s + Σ amp_i · L_i(x,y,z) + pulse(y); bound = column term over the cell's y range
       ///        + Σ amp_i · [min, max] of L_i corners + pulse range.
       Separable { scale: f64, terms: &'a [(LatticeFieldId, f64)], pulse: Option<PulseSpec> },
       /// Carve where |A| < w ∧ |B| < w; a cell is skipped if all A corners are beyond ±W, where
       /// W = Province::thin_width_bound(params, column, y0, y1) (a method, so it can read params).
       ThinPair { a: LatticeFieldId, b: LatticeFieldId },
       /// Carve where L > t; a cell is skipped if every corner ≤ Province::threshold_bound(...).
       Threshold { field: LatticeFieldId },
       Opaque,   // no culling; evaluated per voxel in band
   }
   ```

   Weights and claim fades only shrink carves and deviations, so bounds computed at full weight stay conservative. `province_suite!` runs `culled_equals_unculled` for every province, which also catches an optimistic author bound. Gains are measured, not promised: a generator that already gates its cave test before costly reads gains less.

4. **Continuous y.** Squashed y is never rounded. The `QuantizedCoordinate` lint is structural: the field IR has no Round node on coordinates.

5. **Lattices.** World-aligned nodes at multiples of the stride, with a 1-block margin for gradients. Strides keep the flagship world's tuned values: 6 for tunnels, 4 for threads and band shape, 3 for detail. The y stride may double only after a visual A/B.

6. **No floaters.** Every Refine province passes the floating-solid connectivity test (the pattern in `crates/gen/src/density.rs`). Add provinces are detached by design; their test is that every connected component has at least the declared `min_volume` (default 64 voxels), so no specks.

7. **The run writer contract.**
   - Call `Arc::make_mut(&mut chunk.voxels)` once per chunk (the job owns the chunk, so this does not clone in the normal case), then write runs straight into `voxels.data` (`server/libs/ndarray.rs:12`) in the chunk's `[x, y, z]` layout with z contiguous. Air is never written, because new chunks are zeroed.
   - Set `chunk.top_filled_y = Some(max_y)`, the highest y holding a non-air voxel the writer wrote, or leave `Some(-1)` when nothing was written. New chunks start at `Some(-1)` (`server/world/voxels/chunk.rs:144`); `calculate_max_height` scans only up to that watermark (`:158-163`); and only `set_raw_voxel` raises it (`:260-276`). Direct writes without this step would give every column height 0.
   - Never route voxels through `set_raw_voxel`: it costs a bounds check and a HashSet insert per voxel (`add_updated_level`, `:216-230`). New chunks already mark every sub-chunk level as updated (`:143`).
   - Game stages after `landscape` use the normal voxel API, which keeps the watermark.
   - Kit test `height_map_matches_rescan`: on golden chunks, the height map after the stage equals the one obtained after setting `top_filled_y = None` and rescanning, and `top_filled_y ≥ y` for every non-air voxel.

### 2.13 Field programs

`landscape/fields/` is a new compiler. It reuses v1 noise kernels and the monotone spline math, and leaves v1 `FieldProgram` untouched.

- **Named shared fields.** `FieldDef { graph, domain: Macro | Detail, resolution: Full | Stride(4) | Stride(16), range: Option<(f64, f64)>, keep: bool }`. `FieldNode::Ref(name)` reads another field. The whole library compiles to one program with CSE across fields, which ends single-output mega-graphs and v1's world-unique salt per graph. `keep` puts the field in `ChunkFacts`; other fields live in scratch.
- **New nodes**, all bit-stable:
  - `SMin/SMax{k}`, `Bias/Gain`, `Terrace{step, softness}`, `Select{cond, a, b, at, blend}` (blend 0 is a hard select);
  - `Div` (guarded), `Sqrt`, `Cellular{F1 | F2−F1}` (sqrt only);
  - `HermiteNest`, a nested monotone Hermite spline router with Fritsch–Carlson clamps;
  - `Orographic{height, probes, node}`;
  - `DampedFbm`: per octave `a += b·n/(1 + |d|²)`, with analytic noise derivatives from the quintic fade's polynomial derivative;
  - `GullyFilter{octaves ≤ 3, wavelength ≥ 24}`, using `psin`;
  - `Pulse{period, softness}` for strata and bench terms;
  - `Input(Channel)`, for detail fields only.
- **Term roles.** Every noise and pulse node carries `TermRole::{Shape, Strata, Bench, Grain}`. Strata and Bench terms are exempt from `min_ground_wavelength` and checked by their own guards (section 3.3); Grain terms must stay at or under `max_fine_amplitude`.
- **The compiler** adds dead-node elimination, hash-consing CSE, register reuse, and grid evaluation (`SlopeOf`/`CurvatureOf` of a named field within the halo read the grid instead of re-running nested programs).
- **Analyses** (lints and bounds only; they never change rates silently):
  - *Bandwidth*: λ_min per node; noise gives `1/(f·lac^(oct−1))`; a warp scales it by `1/(1 + amp·2π/λ_warp)`; nonlinear nodes mark it unknown. Macro-domain fields must have λ_min ≥ 128, which makes stride-16 planner probes safe.
  - *Lipschitz bound* L per node, used for Field-layout gate bounds (section 2.8). Normalized noise uses a pinned analytic per-kernel gradient bound (loose but provably safe; over-dispatch costs a masked loop, never correctness), times `Σ_k gain^k · 2π f lac^k`. Combinators: `L(a+b) ≤ L(a)+L(b)`; `L(c·a) = |c|·L(a)`; `L(smoothstep(e0, e1, a)) ≤ 1.5·L(a)/(e1 − e0)`; `L(min/max) ≤ max(L)`; `L(a·b) ≤ |a|_max·L(b) + |b|_max·L(a)` using range analysis; `L(n(p + w)) ≤ L(n)·(1 + L(w))`. Anything else is unknown, and an unknown gate is refused for Field layouts.
  - *Range*: interval arithmetic over every node, used by the product rule and by `range` checks.
- **Resolution is authored data**, part of `spec_hash` and so of identity. The optional P8 multi-rate compiler writes suggestions into the spec through a tool.
- **Normalized noise kinds** (`*Normalized`) have a practical ±1 range, so amplitudes mean blocks.

### 2.14 Determinism model

- **D1. Pure derivation.** Seeds come from `stream_seed_bytes(world, dim, Subsystem, salt, cell)` for reused v1 lanes and `stream_seed_lane(world, dim, lane, salt, cell)` for landscape lanes (values 6 and up, section 2.4.2). P0 pins v1's `Subsystem` discriminants explicitly (`Fields = 0` … `Ecology = 5`), which is byte-identical. Each node's salt is claimed world-wide; sub-noises are `"<salt>.<sub>"`; plan and build streams are separate lanes. This rules out identical warps from reused salts and two subsystems sharing one salt.
- **D2. Arithmetic, and the scope of the claim.**
  - Allowed: add, sub, mul, div, sqrt, floor, abs, min, max and comparisons. No `mul_add`; Rust never contracts to FMA on its own. `math` provides everything else.
  - **Scope.** The cross-platform bit-stability claim covers (1) all code under `src/landscape/**`, and (2) the v1 code that landscape calls on output paths, which is audited: stream hashing (integer only), the noise kernels, spline math, climate partition math, and flora and ecology placement. That placement contains one `powi(2)` (`crates/gen/src/ecology.rs:278`), which equals `x·x` bit for bit whether the compiler lowers it to a multiply or to its runtime's repeated-squaring routine (`1·(x·x)`).
  - **Outside the claim.** The `geology_prior` solver (v1 geology uses `powi` with a variable exponent, `crates/gen/src/geology/solve.rs:659`, and `powi(2)` sums at `crates/gen/src/geology/query.rs:300`), v1 `FieldProgram`'s `PowI` (`crates/gen/src/field.rs:1033`) and v1 channel curvature's `hypot` (`crates/gen/src/channels.rs:70, 91`). Landscape never calls the last two. Presets that enable `geology_prior` get per-platform goldens.
  - `tests/no_libm.rs` refuses `.sin(`, `.cos(`, `.tan(`, `.powf(`, `.powi(`, `.hypot(`, `.exp(`, `.ln(`, `.log2(`, `.log10(`, `.tanh(`, `.atan(`, `.atan2(`, `.cbrt(` and `mul_add` under `src/landscape/**`, and checks the audited v1 files against an allowlist of exactly the lines above, so a new libm call in a reachable v1 file fails the test. `kit::assert_no_libm!("src/worldgen")` gives game crates the same check.
- **D3. Acyclic planners.** Strict DAG, no thread-local guards, no provisional answers.
- **D4. Total composition order.** Layer, then explicit edges with the default order, then id, then cell (section 2.8).
- **D5. No unordered iteration in output paths.** hashbrown with ahash may seed differently per process. Output paths use sorted Vecs or BTreeMaps; scoped parallel solves join in index order.
- **D6. Spec parsing and hashing.** No new serde_json feature is enabled. Numbers are read by `json.rs` (correctly rounded) and written by `canon.rs` (pinned `ryu`), section 2.4.3. `spec_hash` covers the typed parameters: compile deserializes each node's `params` into its `K::Params`, validates them, re-serializes them with `to_value`, and hashes the spec with those typed values in place of the raw JSON. So an `Option` field given as absent or as `null` (both deserialize to `None`), differently ordered keys, and equivalent spellings of a number (`1` and `1.0` for an `f64` field) all hash identically.
- **D7. Caches are cost-only.** The kit runs with every cache at capacity 1 and compares digests.
- **D8. Plan budgets are semantic and always compiled.** `WorkMeter` counts deterministic steps (probe calls, trace steps, flood cells). Exceeding `PlanBudgets` rejects the plan (`Reject::Budget`); the budget constants are in `spec_hash`. Under `PlanCtx::par_map(items, per_item_budget, f)`, each item gets its own meter with its own budget: an item that exceeds it stops with `Reject::Budget`, and its count depends only on its inputs. After the join, item counts are summed in index order and the plan budget is checked. Which step trips a budget therefore never depends on scheduling. The census reports the rejection rate, and the default preset requires zero rejections on its gate seeds within 8 km. Cost counters are a separate, feature-gated mechanism (section 7.3).
- **D9. Goldens.** Per preset × 3 seeds × 32 chunks (a walking path plus census-located landmark chunks), digesting voxels and facts. CI runs Linux x86_64 from P0 (v1) and adds macOS arm64 from P2a. Kit tests run in two processes.

### 2.15 Caching

`ClockCache<K, V>` (in `landscape/cache.rs`; the name avoids v1's existing `voxelize_gen::CellCache`, `crates/gen/src/ecology.rs:119`) evicts one entry at a time with the CLOCK algorithm. Every cache below is cost-only.

| Cache | Key → value | Default size | Eviction |
|---|---|---|---|
| Plans per planner node | cell → `Arc<OnceLock<Option<Arc<Plan>>>>` | 4096 small kinds, 256 large | CLOCK; the roll is decided before insert |
| Region tiles per solver | tile → `Arc<OnceLock<Tile>>` | 64 | CLOCK |
| Feature index | 512-block cell → `SmallVec<[InstanceRef; 4]>` | 16k | CLOCK |
| Macro tiles | 256-block tile → stride-16 SoA fields | 512 (about 18 MB at 12 fields) | CLOCK |
| Coarse probe tiles | (layer, 64-block tile) → stride-4 ground | 1024 | CLOCK |
| Exact probe columns | (layer, x, z) → ground | 64k | CLOCK |
| Facts LRU | chunk → `Arc<ChunkFacts>` | 24 MB (byte-capped) | CLOCK |
| Thread scratch | registers, lattices, run buffers, non-kept fields | per worker | reused; no per-chunk allocation |

- **Probe caches are shared across solves.** This is safe because a probe at layer L is a pure function of strictly lower-layer plans, and a strict DAG never stores a provisional answer.
- **Flood solvers** (basins, lava pools, creeks) read exact probes, never stride-4 coarse probes, so water never hangs or spills.
- **Never clear everything.** No landscape cache clears all entries on overflow. v1's own caches are not touched by this program: its plan cache is keyed without the terrain view (`crates/gen/src/structures.rs:796-817`), so changing its eviction is not provably cost-only for every caller.

### 2.16 Threading, prefetch, cascades and tick safety

- **Chunk jobs** run on the engine worldgen pool, one chunk per thread, with no nested parallelism.
- **Plan solves** run inline behind `OnceLock` on first need, or on the gen crate's own small, low-priority planner pool (default 4 threads). Solves never call rayon: `PlanCtx::par_map` uses scoped native threads joined in index order. A waiter only waits on strictly lower-ranked solves, so no wait cycle can form.
- **Cascades.** One first touch can pull a chain. A drainage tile of 1536 blocks at stride 24 needs about 4,900 exact probes, each composing every Uplift, Incise and Shore instance in the tile and apron, which pulls range, canyon and coast plan solves. The rules:
  - probes are single-column compositions with no stencil, evaluated in batches over probe lattices (one dynamic call per instance per probe tile) and stored in the shared probe caches;
  - a tile first collects the distinct plan cells its probes need, then solves them with `par_map`, joined in index order;
  - `walk_bench` and the census report `first_touch_cascade_ms` per node (from cold caches to the first generated chunk at a census-located instance, including every transitive solve), plus `cascade_plan_solves` and `cascade_probe_columns`;
  - cascade budgets are pinned at P3 (range, horn), P4 (canyon, drainage tile) and P5 (coast, stratovolcano). Provisional values on a 4-thread planner pool: range 40 ms, canyon 60, drainage tile 120, coast 60, stratovolcano 40;
  - on the recorded walk, `chunk_wait_on_solve_ms` p99 must stay ≤ 10 ms: cascades are hidden by prefetch, not by luck.
- **Prefetch** needs no engine change. Each processed chunk enqueues unsolved cells within reach plus a ring, and region tiles one tile ahead along the walk direction. Games may also call `prefetch_around(player_positions)`. Results are identical whether a plan was prefetched or solved on demand.
- **Tick safety.** `*_if_ready` queries never plan. `let _g = landscape::forbid_solves();` marks a scope such as a game's tick systems; a solve inside it panics in debug and test builds, which turns a cold read on the tick thread into a test failure.

---

## 3. Bit-stable math and the worn-not-cut kit

### 3.1 `landscape::math`

Every formula uses only allowed operations, and every output is golden-pinned.

| Function | Definition |
|---|---|
| `smoothstep(a,b,x)` | `t = clamp((x−a)/(b−a)); t²(3−2t)` |
| `smootherstep(a,b,x)` | `t³(t(6t−15)+10)` (C2; used for edge fade) |
| `soft_down(cur, h, k)` | `cur − r_k(cur − h)`, with `r_k(d) = 0` (d ≤ 0), `d²/(2k)` (0 < d < k), `d − k/2` (d ≥ k). The `Carve` op. Identity for h ≥ cur; C1; monotone; engaged result h + k/2. |
| `soft_up(cur, h, k)` | `cur + r_k(h − cur)`. The `Build` op. |
| `smin(a,b,k)` | `h = max(k − |a−b|, 0)/k; min(a,b) − h²·k/4`. Field node only (symmetric blend). |
| `smax(a,b,k)` | `−smin(−a, −b, k)`. Field node only. |
| `soft_ceiling(h,knee,cap)` | `h ≤ knee`: h. Otherwise `s = (h−knee)/(cap−knee)` and `knee + (cap−knee)·s/√(1+s²)`. Slope 1 at the knee; never reaches the cap. |
| `pow_smooth(t,e)` | `k = ⌊8e⌋, f = 8e−k`; result `(1−f)·p8(t,k) + f·p8(t,k+1)`. `p8(t,k) = t^⌊k/8⌋ · r2^b2 · r4^b1 · r8^b0`, where `r2 = √t, r4 = √r2, r8 = √r4`, `k mod 8 = 4b2+2b1+b0`, and the integer power is repeated multiplication in fixed order. Continuous in e, monotone in t, exact at multiples of 1/8. |
| `pow_smooth_d(t,e)` | Its exact analytic derivative for e ≥ 1: `(1−f)·(k/8)·p8(t,k−8) + f·((k+1)/8)·p8(t,k−7)`, using `p8(t,k)/t = p8(t,k−8)` (one fewer factor of t, so no division and a correct value at t = 0). |
| `bias(t,b)`, `gain(t,g)` | Schlick rationals: `t/((1/b − 2)(1 − t) + 1)`. Exact inverse `bias(·, 1−b)`. |
| `psin(x)`, `pcos(x)` | `u = x·(1/2π); u −= ⌊u + 0.5⌋`; fold to `[−¼, ¼]`; odd degree-9 minimax polynomial in `v = 2πu`; coefficients pinned. Max error ≤ 2e-7. |
| `pseudo_angle(dx,dz)` | Diamond angle in [0, 4): with `s = |dx| + |dz|`, `dz ≥ 0 ? (dx ≥ 0 ? dz/s : 1 − dx/s) : (dx < 0 ? 2 − dz/s : 3 + dx/s)`. Monotone in true angle; no atan2. |
| `unit_dir(i, n)` | Pinned table of n ∈ {8, 16, 32} unit vectors (prevailing directions without trig). |
| `ring_noise(n, c, p, R)` | `n(c + R·(p−c)/|p−c|)`: azimuthal variation with no trig and no azimuth seam. |
| `exp2_p`, `log2_p` | Range reduction by `floor` plus pinned polynomials, for the rare true exponential. |

### 3.2 `landscape::profile`

Each profile returns `height(u)`, `slope(u)` and an inverse, either analytic or by fixed-iteration bisection. Unit tests assert monotonicity, C1 joins (value and slope jumps ≤ 1e-12, rounding only, because joins are derived from the same functions they join) and inverse round-trips within 1e-6.

| Profile | Form | Proven recipe |
|---|---|---|
| `Wall { exp: p, rim_round: s }` | For `u < u0 = 1−s`: `w = pow_smooth(u, p)`. Over `[u0, 1]`: a cubic Hermite from `(w0, g0)` to `(1, 0)` with `w0 = pow_smooth(u0, p)` and `g0 = pow_smooth_d(u0, p)`; with `t = (u−u0)/s` and `a = g0·s`: `w = w0 + a t + (3(1−w0) − 2a) t² + (a − 2(1−w0)) t³`. C1 everywhere with zero slope at the rim; monotone when `a ≤ 3(1−w0)`, and validation refuses otherwise. | canyon walls, exponent 1.35 ± 30%, rim rounding 0.07 |
| `Cone { exp: p, shoulder: ts }` | `t < ts`: `pow_smooth(t, p)`. Then `h_s + g_s(t−ts) − g_s(t−ts)²/(2(1−ts))` with `h_s = pow_smooth(ts, p)`, `g_s = pow_smooth_d(ts, p)`, renormalized by its value at t = 1, `h_s + g_s(1−ts)/2`. Zero slope at t = 1. | volcano cones, exponent 1.875 |
| `Face { h, ledge, run1, shelf, run2, rim }` | A cubic foot, then a worn shelf rising 0.3 per block (≤ 4.5 wide), then an upper wall `1 − pow_smooth(1−u, 2.6)`, rounding over 3–7 blocks. Analytic `offset(v)`: how far in the face lies at height v. | sea cliffs |
| `SWall { share, slump }` | Smoothstep S-wall plus `4v(1−v)·slump` roughness | calderas |
| `SlotSection` | Quadratic rim lip of 1–3 blocks; bench dip `pow_smooth(·, 1.5)`; ledge ≤ 4 at 25–50% depth; independent wall bulges of 35% | slot canyons |
| `DuneWave { stoss: a }` | On the phase `u ∈ [0, 1)`: stoss `smootherstep(0, a, u)` for `u < a`; lee `1 − smoothstep(a, 1, u)` for `u ≥ a`. C1 at the crest and trough (zero slope on both sides), so crests are rounded. Maximum lee slope is `A·1.5/((1 − a)·λ)` for height A and wavelength λ; validation refuses it above the angle of repose. | giant dunes (section 4.2) |
| `Talus { repose, apron, wander }` | Apron zone where slope > repose and ∇² ≥ −0.05, with a wander window | scree |
| `relax(h, lap, cap, σ)` | `h + clamp(1.6·∇²h, −cap, cap)·(1 − σ²)`, with σ the summit share, using `ColumnBatch::scratch` for the stencil | range flanks |

**`strata::BandTable`.**
- Ledge k sits at `y_k = (k + j_k)·B − tilt·⟨(x,z), dir⟩`.
- Each boundary wanders along the wall: `b_k = y_k + A·(α_k·n1 + (1−α_k)·n2)`, with two slow fields at λ 83 and 48.
- Each band has tread, cliff and talus parts that vary on their own.
- The fold returns a slope gain, so slope rules stay honest, and it never inverts a slope.
- `BandCursor` walks a column without re-deriving the band per voxel.

**`geometry`.**
- `zero_line_distance(f, ∇f) = |f|/max(|∇f|, ε)`, refined by one Newton step `p' = p − f∇f/|∇f|²`, so saddles fork instead of opening rooms.
- `trace_iso` marches iso-contours with Newton correction along the normal.
- `ArcSchedule` spaces features along a polyline with interval reservation.
- `FeatureFrame` gives (arc s, signed across d) for spurs, gullies and notches.
- `gate_upper_bound(samples, L, stride)` is the conservative tile gate of section 2.8.

**`WearSpec`** is data embedded in every built-in landform's params:

```rust
pub struct WearSpec {
    pub rim_round: Size,             // Blocks: Wall.rim_round / Build k
    pub foot_round: Size,            // Blocks: soft-clamp k at the foot (no knife junction with the plain)
    pub talus: Option<TalusSpec>,
    pub relax: Option<RelaxSpec>,    // cap (≤ 3), summit exemption
    pub gully: Option<GullySpec>,    // octaves ≤ 3, wavelength ≥ 24 (taste guard)
    pub benches: Option<BenchSpec>,  // TermRole::Bench
}
```

### 3.3 Scale bands, taste guards and the scale knob

| Band | Wavelength | What lives there |
|---|---|---|
| Continental | ≥ 2048 | continentality, land and interior masks, climate. Warps apply to masks, never to final height. |
| Regional | 512–2048 | router relief, range spines, canyon courses, plan sites, giant dune wavelengths |
| Landform | 64–512 | profiles, outline harmonics (k = 1–3), spurs (λ 230/105/48), along-spine modulation, superimposed dunes |
| Medium wear | 24–64 | gullies and buttresses at λ 48; face warp of 8 blocks at λ 64 plus 2 at λ 16, slope-gated; bench wander; talus and snow windows (38/13, 29/9) |
| Fine | < 16 | Nothing on ground but grain ≤ 0.75 block, plus declared strata and bench terms. 3D band grain ≤ 0.5 block on stride ≥ 3. Cavity-like fine erosion is refused. |

```rust
pub struct TasteGuards {
    pub min_ground_wavelength: f64,   // 16 (Shape terms)
    pub max_fine_amplitude: f64,      // 0.75 block, λ < 16, Grain terms on any ground export
    pub min_medium_amplitude: f64,    // "too smooth" floor on land exports, 32–256 band
    pub warp_fold_limit: f64,         // amp·2π/λ ≤ 0.8
    pub max_gully_octaves: u8,        // 3
    pub min_gully_wavelength: f64,    // 24
    pub min_strata_period: f64,       // 6 blocks (Strata terms), riser softness ≥ 0.1
    pub min_bench_period: f64,        // 8 blocks (Bench terms)
    pub min_band_stride: u8,          // 3
    pub max_band_grain: f64,          // 0.5
    pub min_band_fade: f64,           // 1 block at floor, ceiling and edge
    pub max_dune_lee_slope: f64,      // 0.65 (angle of repose of loose sand)
    pub forbid_literal_heights: bool, // landform heights must be Height shares
}   // TasteGuards::strict() refuses (default preset, preset CI); ::warn() logs.
```

**The `scale` knob** (`Knobs::scale`, 0.5 ..= 2.0, stored as `frame.scale` so `BuildCtx::frame()` applies it when resolving sizes and heights) is defined by size types, not by a threshold heuristic:
- **`Size::Span` values scale by s**: cells, reaches, radii, widths, lengths, spacings, and the wavelengths and warp amplitudes of Shape terms in the Continental, Regional and Landform bands. A warp's fold ratio `amp·2π/λ` is invariant, because both scale together.
- **`Size::Blocks` values never scale**: medium-wear terms (λ 24–64), grain, strata periods, bench pulses, soft-clamp widths `k`, fades and lattice strides. Wear stays at block scale on any size of world, so at s = 0.5 the face warp's λ 16 component stays λ 16 and the fold limit holds.
- **Vertical relief scales by v(s) = min(1, √s)**: landform rises and depths, and the router's relief knots, are `Height` values multiplied by v(s) before resolution. A world is never taller than authored (the frame is the limit); a compacted world lowers its relief by √s, so slopes grow by at most s^(−1/2) ≈ 1.41 at s = 0.5 and halve at s = 2. Frame heights (sea, ceiling, band floors given as `ShareOfWorld`) do not scale.
- The `MixedScale` lint refuses, under `strict()`, a term that mixes `Span` and `Blocks` sizes, since that would break fold invariance.
- Tests: `scale_extremes_compile_strict` compiles the default preset with `TasteGuards::strict()` at s = 0.5, 1 and 2, and the quality bands of section 7.2 run at both extremes on 3 seeds.

The `NarrowGate` lint warns when a smoothstep window is under 2 blocks of input-equivalent, which is a knife-edge risk.

---

## 4. Landform vocabulary and recipes

Numbers are the flagship world's proven values unless marked "new". Heights are written as `Height` shares of H = 512 with sea = 86 (relief 426); horizontal sizes are `Span` unless marked "blocks". Every recipe below uses only `math` and `profile` operations.

### 4.1 Base relief: the named fields of the default preset

Axis names are neutral: `continentality`, `ruggedness`, `variety`, `ridge_fold`.

- **Continents.**
  - `c = 0.75·n_c(p + w) + 0.10·coast + 0.08`, where `n_c` is fbm at f = 0.00024.
  - `w = (±380·n_wx, ±270·n_wz)` uses two independently salted noises (`continent.warp_x`, `continent.warp_z`), so the warp never shears along a diagonal.
  - `land = smoothstep(−0.08, 0.08, c)`, `interior = smoothstep(0.08, 0.48, c)`.
- **Seabed.**
  - Base: a spline of continent noise (f 0.0035, 5 octaves, warped ±38) with knots from (−1.2, 34) to (1.4, 98), as `ShareOfWorld` values.
  - Offshore depth ±9·offshore_t; roughness `4.5·clamp(|base − sea|/12, 0.1, 1)`.
  - Trench: ridged f 0.0012, mask smoothstep(0.52, 0.76), carve 34, floor ≥ 12.
  - Abyssal ridge: ridged f 0.0018, mask (0.45, 0.75), raise ≤ 26, capped 8 below sea.
- **Router.**
  - Inputs: `ruggedness` (f 0.0011), `variety` (f 0.0018), and `ridge_fold = 1 − 3·| |variety| − 2/3 |`.
  - `HermiteNest(c → ruggedness → ridge_fold)`. Offset knots in `ShareOfRelief` (blocks/426): c −1 → 0; −0.75 → relief(18, 9); −0.05 → relief(82, 38); 0.65 → relief(140, 68); 1 → relief(148, 72). These are `Relief` values for the scale knob.
- **Plains.** `datum = sea + 2 + 5·interior`; `vd = smoothstep(−0.85, −0.35, ridge_fold)`; `plains = datum + (93 − datum)·vd + 5·n·(0.12 + 0.88·vd)`.
- **Wear fields** (Detail domain, `Blocks` sizes).
  - Face warp: 8 blocks at λ 64 plus 2 at λ 16, gated by `smoothstep(0.86, 2.1, slope)`.
  - Gullies and buttresses at λ 48: `channel = 1 − smoothstep(0, 0.22, |n|)`, `buttress = smoothstep(0.3, 0.75, n)`, `Δ = gate·(6·buttress − 10·channel)`, with `gate = smoothstep(1.3, 2.1, broad slope at d = 12)`.
  - A `DampedFbm` crag field on steep ground.
- **Ground.** `ground = base + (land_h − base)·pow_smooth(land, 0.75)`.
- **Climate.**
  - `temperature = 0.50 + 0.62·n + 0.04·coast + border jitter`, then lapse `−lapse·(ground − sea)/relief`.
  - `moisture = regional + orographic − 0.10·interior`.
  - Orographic correction: `0.18·clamp((h − h₉₆)/70) − 0.25·clamp((max(h, h_up) − h − 10)/85)`, with upwind probes at 96/224/448 on 64-block nodes eased bilinearly. It reads macro ground only; rivers never feed back into climate.
  - A border jitter channel (f 0.011, 3 octaves) bends every climate threshold at a 30–120 block scale.

### 4.2 Built-in kinds (`landscape/library/`)

| Kind (layer) | Layout and siting | Column contribution | 3D, water, anchors | Claims | Phase |
|---|---|---|---|---|---|
| `range` (Uplift) | Cells 2560, roll 0.55, 8 footings with ruggedness ≥ threshold. A 4-point bent spine 600–1600 long, half width 220–320. **Hero** variant: `Once`; 16 directions at 720–880 from spawn, maximizing the summit's elevation angle over the near horizon, broadside, exclusion 2400; a spawn reader with clear 256. | Cross profile `pow_smooth(1−u, 1.9–2.4)`. Modulation `0.72 + 0.2·psin(λ 380–560) + 0.1·psin(λ 150–230)`, clamped 0.45–1. Per-arc lifts every 32 blocks to a target summit share of 0.86–0.96 H under the soft ceiling (knee 0.88 H, cap H − 14). Spurs (λ 230/105/48, stretched 2.8× downslope); notches in the upper third; `relax` cap 3. `Build{k = 6}`. | `crest` Refine province (Separable): `(h + 0.5 − y)/7 + amp·shape(x, 0.4y, z) + 0.5·ledge pulse` (Bench term, period 11–16 blocks), depth `40·mix + 10`, faded over 10 blocks at the floor and over slope 0.9–2.2. Anchors `summit`, `saddle`. | NO_SITES on crests | P3 |
| `horn` (Uplift, over `range`) | Cells 768, roll 0.55, 6 footings with relief ≥ 78; reads `canyon` occupancy | `Cone{1.875}` with outline harmonics k = 1–3, amplitude 0.08–0.2/√k; summit 0.70–0.82 H | `crest`; anchor `summit` | — | P3 |
| `strata_cliffs` (Uplift, under `range`) | `Field`, gate `cliff_country` (a region window field); contribution × `smoothstep(1.15, 2.1, SlopeOf(ground))` | `BandTable` ledges (Strata terms): band 10 ± 3 blocks, tilt 14, riser softness 0.1, irregularity 0.35 | `shelf` Refine province: shelters at 25% coverage, room 3–5 tall, roof ≥ 3 | — | P3 |
| `dunes` (Uplift) | `Field`, gate: hot, dry, low axes (smoothstep windows ≥ 0.05 wide). Two modes, below. | Ripple: `pow_smooth(0.5 + 0.5·psin(0.13x + 0.042z + 5·eco), 2.2)·7 − 2` (λ ≈ 46 blocks). Erg (new): giant dunes 60–120 tall, below. | — | — | P3 |
| `stratovolcano` (Uplift, over `horn`) | Cells 2816, roll 0.5, 5×5 grid over 50% of the cell. Centre on full land, 14–112 above sea, not arid. 8 foot probes at 0.78 r. Score `−σ − 0.3·(base − 14) − 10·offcentre`. A spawn reader keeping ≥ 1200 from spawn. Hero variant: `Once`, ring 1500–3500. Reads `canyon` occupancy. **Island** variant (new), below. | Rise `ShareOfRelief(0.47–0.70)`, cap 0.86 H; radius = rise × 2.2–2.7. `Cone` plus ring gullies (scale 90, azimuth warp 0.3, channel 0.2, depth 12 ± 75%). Lobed flows (2–4 tongues, lift 3). Rim rise and dip ±8/±3. `Build{k = 5}`. | Caldera `SWall` (depth 38–62, share 0.42 ± 20%) with a `LAKE` 10–22 deep or a dry floor with vents and a `LAVA_POOL`. Outlet notch snapped to a grid axis, giving a 28–42 block `FALL` into an alcove pool (r 5). Lava tubes under the flank (cone_t < 0.82, roof ≥ 7): carve where `((roof − (12 + 5·m))/4.5)² + (A/0.075)² < 1`. Anchors `caldera_rim`, `outlet_pool`, `flank_pad`. | exclusive, HYDRO, ROCK, NO_CAVES (cone core) | P5 |
| `canyon` (Incise) | Cells 3072, roll 0.62, 22×22 jittered heads (land ≥ 0.98, macro height ≥ `Abs(140)` scaled, temperature ≥ 0.46, moisture ≤ 0.46). Trace in 48-block steps; cost `0.5h + 50·wet − 80·(1−land) + 5·|turn| + meander`; the floor never climbs (≤ 0.25 per block); ends at the sea or a terminal lake; length 1000–3000. | Depth 58 → 150 over 560 (shares), 7-node moving average, shallowing at sea mouths. Section: `Wall{exp 1.35 ± 30%, rim_round 0.07}`, floor share 0.26, rim dip 6, written as `h = cur − profile·(cur − F + k/2)` (section 2.8). Fades over 2.1 half widths, keeping 30% of land relief, via `Footprint::channel`. Overlapping canyons meet as soft-clamp carves (lowest wins, no crease). Benches 27 ± 22% (Bench terms), wandering ±5; buttes; ±20% width scalloping. | Trunk `RIVER` declaration with flow. Side canyons from 300 every 360, hanging 42–78, with a `FALL` into an alcove (half width 11) and a `PLUNGE_POOL` (r 4.5, depth 3). Anchors `rim`, `lip`, `pool`, `mouth`. `ChannelNet<CanyonVertex{arc, side}>`. | exclusive, HYDRO (floor), ROCK (walls), NO_CAVES, FALLS_OK | P4 |
| `slot_canyon` (Incise, under `canyon`) | `Field`, gate: f 0.0011 field > 0.38 (smoothstep window 0.38–0.44) times dry and hot axes. Climate axes only, never biome identity. | Zero-line course through warps of 8 at f 0.022 and 2.5 at f 0.05; width via `zero_line_distance` (half width 1.5–3 blocks); `SlotSection`; wear × `clamp((depth−2)/14)`; slot floors keep tunnels 4 blocks below (`cave_ceiling`) | Optional seep `SPRING` declarations. Open ravine elsewhere: depth 48 × exposure × shoulder. | NO_CAVES near | P5 |
| `coast` (Shore) | Cells 1536, roll 0.62 for cliffs and 0.10 for a pillar bay; 14×14 probes; not polar. `trace_iso` shoreline with steps of 24; stops on a sharp turn or shallow sea; length ≥ 380; trimmed short of canyon and volcano berths (reads their occupancy). Hero variant: `Once`, within 1.5 km of spawn, a spawn reader with clear 256. | `Face` per node; height 30–90 by random walk × swell, tapered over 4 nodes; face-line warp 2.5, ribs 1.4, headlands ±16; sea shelf 5–12 deep over 56–90 | `coast_face` Refine province with inward-only cuts: arches (ridge 24–40 long, opening 45–66%) and a wave notch 2.5. Sea caves (26–40 long, r 3.5–5) are a Carve province with `WetPolicy::Fill(Sea)`. Stacks as analytic spans (2–4, r 3.5–9, shrinking 14%, facets at 76–92% of r, grain 0.25). Cove beaches (`ArcSchedule`: headlands 330, coves 560); cliff `FALL`s every 430 where height ≥ 40. Pillar bay: 40-block jittered grid, r 5–14, height 40–120, taper 0.12, lean 0.35 r; crowns `classify_as(lowland)`. Anchors `headland`, `cove`, `cliff_top`, `fall_lip`. | exclusive, ROCK | P5 |
| `tor` (Detail) | Cells 128, roll 0.36, 6 candidates within ±26; hill-climb 4 × 8 directions at stride 8 on `Through::Layer(Layer::Detail)` (final hydrology). Two-ring crest test (r 20: none more than 2 above; r 40: none more than 4 above and ≥ 6 of 8 dropped by 4). Footing relief ≤ 6. A spawn reader with clear 48. | Bared apron zone; clitter downhill only | 5–7 superellipse slabs (power 4–8, turned ≤ 8.6°, tilt ≤ 0.11, buried 2) as analytic spans; 55% chance of a companion stack. Anchor `crest`. | ROCK (apron), NO_SITES | P3 |
| `sky_islands` (Detail) | `Field` tile 512; gate = region (f 0.0009, window 0.34–0.56) × land (0.85–0.97) × interior (0.25–0.5) | Upper ground records; `far` sky channel | `float` Add province in an upper band at `ShareOfWorld(0.28) ± 12`, at least district ground + 46, cap 0.38 H; top `band + 1.4·roll − 1.6·slump`; depth `2 + (20 ± 7 + drip ≤ 7)·pow_smooth(mass, 0.75)`; underside roughness f 0.085 on a stride-4 lattice; gap ≥ 10. `PERCHED` pools and rim `FALL`s as declared water with explicit beds. Anchor `island_top`. | — | P5 |
| `cavern_realm` (Detail) | Cells 1024, gated by a geology field; slab layer at depth `ShareOfWorld(0.12–0.20)` | `cave_ceiling` above | Carve province: slab cavern with pillars (noise > 0.52 stays) and curtains (|A| < 0.05 stays); two-lobe halls (32% of 160-block sub-cells); roof ≥ 25; floors as worn shelves. Anchor `cavern_floor`. | NO_CAVES breach above | P5 |
| `caves` (Detail) | `Field` tile 256, gate `land ≥ 0.6`; a spawn reader with clear 16 (no entrances at spawn) | `cave_ceiling` from claims | The cave recipe below; aquifer (section 5.4) from P4; pools and lava pockets from P4 | respects NO_CAVES, ROCK, ProtectMask | P3 (P4 water) |
| `creeks` (Water, over `drainage` and `basins`) | Cells 128, chance 0.27; a cell is accepted only if its hash is the minimum of its 3×3 neighbourhood (no two adjacent creeks). Probes `Through::With(["drainage", "basins"])` and reads their water through `water_of`. A spawn reader with clear 650. | Small carved channels (cut ≤ 4 blocks, 3 on hard rock) | Spring-fed creek to a real receiver, below | HYDRO (channel) | P4 |
| `polar_sea` (Water) | `Field`, gate: cold (temperature below the polar threshold plus the floe band) | — | Sea ice and an ice shelf as analytic spans, below | — | P5 |

**Cave recipe** (`caves`, the flagship world's values; y values as shares of H):
- **Tunnels** (`ThinPair`, stride 6). Two 3D fields A, B at f 0.0085, y squash 1.6, with a shared xz warp ±12 at f 0.011 (independently salted x and z warps).
  - Base half width `w0 = 0.057·(0.88 + 0.30·carbonate)·(1 + 0.35·m)`, where `m` is a width field at f 0.02; × 1.2 below `ShareOfWorld(0.107)`; × `smoothstep(floor, floor + 4, y)` with `floor = Abs(4)`.
  - Roof: `buried = smoothstep(8, 16, ground − y)` (8 blocks of roof, then 8 of fade). Entrance mouth: `mouth = entrance·1.8·(1 − buried)`, where `entrance` is `smoothstep(0.35, 0.9, slope)` times a noise window (f 0.012, −0.15 to 0.25), only where ground ≥ sea + 6.
  - Detail field D (f 0.1, y squash 1.4, stride 3). Width `w = w0·(buried·max(0, 1 + 0.4·D) + mouth)`; carve where |A| < w and |B| < w. Culling bound: `w0_max·(1.4·buried_max + mouth_max)` over the cell's y range.
- **Threads** (`ThinPair`, stride 4): f 0.028, carve where both fields are under 0.048 in magnitude, for `floor + 4 < y ≤ ShareOfWorld(0.191)` with roof ≥ 8.
- **Caverns** (`Threshold`, stride 6, detail stride 3): field C at f 0.0085, 3 octaves, y squash 1.05. Threshold `t = 0.51 + 0.045·intrusive − 0.035·carbonate` (geology fields), softened by detail to `t − 0.09·D`. Only for `floor + 1 < y ≤ ShareOfWorld(0.219)` with roof ≥ 25. Pillars: a field P at f 0.031 above 0.52 stays solid. Curtains: where D > −0.2 and |A| < 0.05 the rock stays, subdividing big halls (tunnels have already cut doorways through them).
- Under a canyon or slot-canyon floor, under a volcano's caldera, lake or vents, and under any HYDRO water, the owner's `cave_ceiling` keeps carves out.

**Cave zones** (`cave_zones` surfacer plus a restrained `cave_dressing` Add province; P3). A vertical zone partition, so underground has places, not one grey network. Plain rock is the common case: the region field (f 0.011, 2 octaves; features about 90 blocks) has narrow windows, so each theme is a pocket, and each room takes one theme from its floor.

| Zone key | Depth band | Score | Dressing at full score |
|---|---|---|---|
| `cave.upper` | above the cavern ceiling `ShareOfWorld(0.219)` | region window (0.45, 0.75) × surface moisture window (0.42, 0.60) | floor cover 0.70 and ceiling cover 0.30 (role `cave.cover`); hanging strands 0.15 per covered ceiling cell, up to 6 long (`cave.strand`); glow accents 0.06, up to 2 (`cave.glow`) |
| `cave.mid` | at or below `ShareOfWorld(0.141)` and above the deep band | region window (0.25, 0.60) | floor re-skin 0.15 and rubble 0.045 (`cave.rubble`); ceiling spikes 0.055 and floor spikes 0.0375, up to 7 long, tapered; fused columns 0.025 where the gap is ≤ 10 (`cave.spike`) |
| `cave.deep` | at or below `ShareOfWorld(0.066)` | region window (0.25, 0.50) | dark floor patches 0.072 (`rock.volcanic`) and glass patches 0.03 (`rock.glass`) on a 4-block patch lattice; fine volcanic rubble 0.021 (`rock.volcanic.fine`) |

From P4, `caves` also declares enclosed water and lava for the partition: upper-zone pools (cell 12, chance 0.5, r 2.2–4.8, sunk into the floor slab, kept only where all four neighbours are solid or pool) and deep-zone lava pockets (cell 48, chance 0.55, r 5–9, deep score ≥ 0.5, at least 4 blocks of air above). `cave_zone_at(x, y, z)` exposes the partition to games (habitat, ambience).

**Giant dunes** (`dunes`, `mode: Erg`; new; P3). Dune seas with ridges 60–120 blocks tall.
- Erg region: `e = smoothstep(0.35, 0.60, n_e)`, with `n_e` normalized fbm at f 0.0005, 2 octaves, times the climate gate (temperature ≥ 0.62, moisture ≤ 0.30, interior ≥ 0.4, ground ≤ sea + `ShareOfRelief(0.25)`; each a smoothstep window 0.05 wide).
- Ridges: a prevailing direction `d = unit_dir(hash(seed) mod 16, 16)`; phase `φ = ⟨p, d⟩/λ_d + 0.08·n_w(p) + 0.03·n_a(⟨p, d⊥⟩)`, with `λ_d = Span(1400)`, `n_w` at λ 2800 and `n_a` at λ 900 (both normalized).
- Height `A = (0.14 + 0.14·(0.5 + 0.5·n_h))` × relief (60–120 blocks at 512), `n_h` at λ 2400, times along-crest modulation `0.7 + 0.3·n_a`.
- Ground op: `Raise { dh: e · A · DuneWave(frac(φ), stoss 0.72) }`. DuneWave is 0 with zero slope at both ends of a cycle, so the wrap of `frac` is C1.
- Superimposed dunes on the stoss slopes: λ `Span(130)`, height `clamp(0.08·A, 4, 9)` blocks, stoss 0.70, direction rotated two table steps, masked by `1 − smoothstep(0.62, 0.72, frac(φ))`.
- Validation: `lee_max = A_max·1.5/((1 − a)·λ_d)·(1 + c)` must be ≤ `max_dune_lee_slope` (0.65), where c is the phase-gradient compression bound of the warp terms from the Lipschitz analysis. The defaults give a lee slope of about 0.60 and a stoss slope of about 0.25. Troughs are interdune flats (zone `flat`); crests and flanks take zone `dune`.

**Island volcanoes and seamounts** (`stratovolcano.island`; new; P5). A share of volcano cells (`chance` 0.3) search their 5×5 grid for sea instead of land: the centre's seabed lies 12–60 below sea, and all 8 foot probes at 0.78 r are sea. The cone rises from the local seabed by `ShareOfRelief(0.30–0.55)`. A summit at or above sea + 24 makes an island (caldera lake above sea, beach zone where |ground − sea| ≤ 3); a summit at or below sea − 6 makes a seamount (no caldera water but the sea). Summits in between are rejected, so no volcano breaks the surface by a sliver. Island cones keep clear of coast plans through occupancy.

**Creeks and springs** (`creeks`; the flagship world's values; P4).
- Sources: 16 probes per accepted cell on a 4×4 jittered lattice (offsets `16 + 28i ± 12` and `24 + 18j ± 12` blocks). A source needs moisture ≥ 0.48, temperature ≥ 0.30, ground ≥ sea + 12, no water, and no HYDRO, ROCK or band claim.
- Route: up to 144 greedy steps over 4-neighbours within 72 blocks of the source, on exact probes. Each step picks the minimum of `ground + 0.65·(min ground 2–4 blocks ahead − ground) + 0.08·turn + 0.6·hash`. A step may cut at most 4 blocks (3 where the `hardness` field exceeds 0.65), drop at most 18, and never go below sea.
- Join: the route ends when a receiver (lake, river or sea surface) lies 0–18 below, after ≥ 24 steps, with the source ≥ 7 above the water. The bed is then graded to be non-increasing, with a 1-block step after runs of 4 level cells.
- Channel: radius 2 (1 where the grade is ≥ 2), bed `y − 1 + round(0.95·d)`; a receiver pool of radius 3, deepened 3 at its centre and 1 at its shoulders, at the receiver's real level.
- Water: a `SPRING` at the source and `CREEK` flow, pre-settled by `settle.rs` with the binding's fluid rules (budget ≤ 1600 water voxels) and stamped as `StampMode::Settled`. Failed settles reject the plan (counted).

**Polar sea ice and the ice shelf** (`polar_sea`; the flagship world's values; P5).
- Thermal distance `over = (T_polar − temperature)·K`, with `T_polar = 0.15` and `K = 4000` blocks per unit of temperature.
- Sea ice: on sea columns, a 1-block ice span at the sea surface where `over ≥ 0`. Across a floe fringe 110 blocks wide (`−110 < over < 0`), a column freezes when `0.5 + 0.5·n_floe < 1 + over/110`, with `n_floe` a smooth warp field, so floes clump into rafts instead of speckle. Under ice the sea layer's level drops by one.
- Ice shelf, on the chosen hemisphere (`shelf_side`, default `South`): `into = (T_polar − 0.04 − temperature)·K`; where `into > 0` and the sea is at least 6 deep, `ramp = smoothstep(0, 16, into)` and `height = ramp·(9 + 5·n_shelf)` (f 0.02, 2 octaves). The shelf is an ice span from sea − 6 (its draft) to sea + height, so its edge is a worn 16-block ramp, never a wall. The sea layer under it ends at sea − 7.

**Region solvers.**
- **`drainage`** (Water): catchment tiles of 1536 with a synthetic divide 96 tall at the edges; stride 24 (±6 jitter); priority flood only from real ocean outlets; runoff `50 + 100·moisture`; minimum area 1300; grade ≤ 0.22; half width 1.8–7.5 and depth 2–5 blocks; watertight cubic Bézier reaches validated against exact ground. It emits `ChannelNet<RiverVertex>` and `RIVER` declarations. A knickpoint `FALL` forms where a reach crosses a step ≥ `min_drop` on a column with FALLS_OK weight ≥ 0.5. A spawn reader with clear 6.
- **`basins`**: lakes (cell 512, r ≤ 96, depth ≤ 10, budget 24000 probes) and ponds (cell 128, depth ≤ 3, budget 3600). A bounded lowest-frontier flood on exact ground; never excavates. A spawn reader with clear 16.
- **`lava_pools`**: cell 192, flood r 16, budget 900, depth ≤ 5.
- **`geology_prior`**: wraps v1 `GeoModel` for presets that want plate relief. Off in the default preset; outside the cross-platform claim (section 2.14, D2).

### 4.3 Surfacers

- **`surface_rules`**: the lowered paint table (section 2.4.2) with conditions: depth below top, y range, water within d by kind, aspect, curvature, relative height (`Height`), zone, hash speckle, cave floor or ceiling, band face, cave zone.
- **`ecotones`**:
  - snow: `score = snow_temp − (temp + 0.09·patch + 0.045·slope)`; full cover at ≥ 0.06, otherwise hash speckle with p = score/0.06;
  - rock line: `ShareOfRelief(0.20)` ± hash and patch;
  - cliff rock where `smoothstep(1.2, 2.4, slope) > 0.5 + 0.2·patch`;
  - talus at slope 0.55–1.2 with a patch threshold;
  - peak-band snow holds where the isosurface slope is < 1.3 ± 0.35, or on a ledge.
- **`zones`**: paints keyed zones through roles. Built-in zone keys, registered by the kinds that write them: `cliff`, `talus`, `wash`, `bench`, `floor`, `beach`, `wall`, `crest`, `apron`, `dune`, `flat`, `ash`, `glass`, `cave.upper`, `cave.mid`, `cave.deep`. Walls get `BandCursor` strata, which brings strata to canyon and cliff walls.
- **`cave_zones`**: the vertical partition above.

### 4.4 Default composition order

| Layer | Order (applied left to right) |
|---|---|
| Uplift | dunes, strata_cliffs, range, horn, stratovolcano |
| Incise | slot_canyon, canyon |
| Shore | coast |
| Water | drainage, basins, lava_pools, creeks, polar_sea |
| Detail | caves, cavern_realm, tor, sky_islands |
| Fit | sites |

The implicit sea layer (section 5.2) ranks below every declaration, so `polar_sea` and Fill(Sea) carves override it where they apply.

---

## 5. Water as data

### 5.1 Types

```rust
// landscape/water.rs
/// Keyed: built-in constants below; games declare more in spec.water_kinds and acquire them with cx.water_kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WaterKind(pub u16);
impl WaterKind {
    pub const SEA: Self = Self(0);   pub const LAKE: Self = Self(1);  pub const POND: Self = Self(2);
    pub const RIVER: Self = Self(3); pub const CREEK: Self = Self(4); pub const FALL: Self = Self(5);
    pub const PLUNGE_POOL: Self = Self(6); pub const SPRING: Self = Self(7); pub const MARSH: Self = Self(8);
    pub const AQUIFER: Self = Self(9); pub const PERCHED: Self = Self(10); pub const LAVA_POOL: Self = Self(11);
    // game kinds are assigned from 256 up, in sorted key order (stable across runs)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WaterKindDecl { pub doc: String, pub fluid: String /* a fluid role */, pub class: WaterClass }
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum WaterClass { Still, Flowing, Falling, Enclosed }

#[derive(Clone, Copy, Debug)] pub enum Flow { Still, Downstream { dx: f32, dz: f32, speed: f32 }, Falling }
#[derive(Clone, Copy, Debug)] pub enum StampMode { Sources, Curtain, LipStream, Settled(SettledRef) }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct WaterBodyId(pub u64);       // hash(node salt, plan cell, index); the sea is one well-known id
#[derive(Clone, Copy, Debug)] pub enum Bed { FinalGround, Explicit(i32) }
#[derive(Clone, Copy, Debug)] pub enum WaterSource { Sea, Body(WaterBodyId) }

/// What a writer declares during composition. `level` is the y of the highest fluid voxel.
#[derive(Clone, Copy, Debug)]
pub struct WaterDecl { pub body: WaterBodyId, pub kind: WaterKind, pub fluid: RoleId,
                       pub level: i32, pub bed: Bed, pub flow: Flow, pub stamp: StampMode }
/// What resolution produces, after composition, against final ground.
#[derive(Clone, Copy, Debug)]
pub struct WaterLayer { pub body: WaterBodyId, pub kind: WaterKind, pub fluid: RoleId,
                        pub level: i32, pub bottom: i32, pub flow: Flow, pub stamp: StampMode }
pub struct AquiferColumn { pub body: WaterBodyId, pub level: i32, pub barrier: bool }
pub struct WaterColumn { pub layers: SmallVec<[WaterLayer; 2]>, pub aquifer: Option<AquiferColumn> } // top-down, disjoint
pub struct WaterHit { pub kind: WaterKind, pub fluid: RoleId, pub body: WaterBodyId,
                      pub surface: i32, pub depth: i32, pub flow: Flow, pub enclosed: bool }
pub struct WaterBodyInfo { pub kind: WaterKind, pub surface: i32, pub max_depth: i32, pub bounds: Aabb2,
                           pub area: u32, pub outlet: Option<WaterBodyId>, pub sea_connected: bool }
```

`frame.sea` is the sea level in the same sense as `level`: the y of the highest sea water voxel.

### 5.2 Declaration and resolution

A water layer is (body, level, bed). Writers declare it; the engine resolves it after composition, so later ground motion can never leave water hanging or buried.

1. **Declare.** During compose, landforms call `col.water(WaterDecl)` and region solvers write declarations from their tiles; plans may also declare whole bodies (`WaterBodyDecl`) for queries such as `water_body`.
2. **Guard.** Ground ops of nodes in the Detail and Fit layers are multiplied by `(1 − w)` on columns carrying an earlier water declaration, where w is the column's HYDRO weight. Under fully claimed water nothing later moves the ground (kit test `no_ground_under_water`).
3. **Resolve beds** (step 4b, after the soft ceiling): `FinalGround` gives `bottom = top + 1` from the final heightfield top; `Explicit(y)` gives `bottom = y` (perched pools on an Add solid, pools sunk into a cave floor). Where `bottom > level` the layer is empty at that column and counted (`water_dry_cells`), which is normal at the rim of a bowl.
4. **Stack.** Layers are sorted by level, top-down. Where two overlap, the later instance in composition order keeps the overlap and the other is trimmed, so no voxel holds two fluids.
5. **The sea.** Every column whose final top is below `frame.sea` gets an implicit `SEA` layer `[top + 1, sea]` ranked below every declaration.
6. **Aquifer.** Each column gets its aquifer level and barrier flag (section 5.4).

An explicit bed must rest on solid: the voxel below `bottom` is solid after the volume pass. The `water_census` test checks it; it is a test failure, never silently corrected.

### 5.3 The void-fill rule

Carves are partitioned by their province's `WetPolicy`, and the rule is local, so it needs no flood across chunks:

- **Aquifer columns.** In a wet aquifer column, every carved void voxel at or below the column's aquifer level becomes `AQUIFER` water with `enclosed = true`, whatever carve produced it; voxels above stay air. Barrier columns refuse carves at `y ≤ level + 1`, so aquifer water never touches a void in a dry or differently levelled column.
- **`Fill(source)` carves** (sea caves, cavern pools): void voxels at or below the source's level take that body; voxels above stay air. Opening into the source is part of the province's contract, and the kit checks that every connected component of `Fill(Sea)` water touches open sea water.
- **`Dry` carves** never meet water: the water seal lowers the cave ceiling on every water column and its four neighbours to `bed − seal` (section 2.12), and aquifer columns are handled above.
- **Other voids below sea level** in land columns stay air. They are sealed under at least 8 blocks of roof and away from water columns, and the fluid simulation spreads only from fluid voxels, so they are stable.

Together these give the invariant checked by `void_fill_closed`: no fluid voxel is face-adjacent to an air voxel at or below its body's level.

### 5.4 Aquifers (P4)

The flagship world's aquifer, with per-cell levels:
- **Wet region**: a 2D normalized noise at f 0.006, 1 octave; a column is wet where it exceeds 0.35. Volcano cores are dry.
- **Level**: `ShareOfWorld(0.0703)` (y 36 at H = 512). Per-cell levels are supported: `level(cell) = base + jitter·(hash(cell) − 0.5)` over aquifer cells of `Span(256)`; the default jitter is 0, which is the flagship world's single level.
- **Barrier**: a wet column with any 4-neighbour that is dry, in a different level cell, or inside a volcano throat is a barrier column; carves are refused there at `y ≤ level + 1`, a rock seal along every contact.
- **Queries**: `fluid_at(x, y, z)` for `y ≤ level` in a wet, non-barrier column tests the carve at that one voxel only: from the facts' carve list if the chunk is generated, else by a point evaluation of the cave provinces (a few lattice samples). There is no column-wide 3D evaluation, which keeps `fluid_at` within its 10 µs addition.
- A later optional kind, `aquifer_cells` (3D cells with their own levels and spread fields), can replace the 2D region without changing the water model.

### 5.5 Fluid roles and stamping

The steady state of a stamped curtain or bowl depends on the game's fluid configuration, which is baked into the fluid block's updater closure (`server/world/voxels/fluids.rs:6-30`, `:423`; `server/world/voxels/block/mod.rs:204`). So fluid roles carry that configuration:

- **Binding.** `RoleBinding::fluid("fluid.water", "Water", FluidConfig::new())`. Compile checks that the block is a fluid and folds the config (max_stage, infinite_source, infinite_source_count, flows_down_as_source, renews_reach_on_fall, slope_find_distance) into `roles_digest`.
- **Demo blocks.** `presets::demo_blocks` builds Water and Lava with `create_fluid_active_fn(id, config)` from the same binding, so stamping and simulation share one value. A game with its own fluid blocks passes the same `FluidConfig` it baked into them; the settle test is what proves they agree.
- **`FluidRules::from(&FluidConfig)`** mirrors the engine's level rules as pure functions: the falling level (0 if `flows_down_as_source`, else 1 if `renews_reach_on_fall`, else max(1, stage)); horizontal reach (`max_stage`); and infinite-source refill.
- **Stamp modes:**
  - `Sources`: stage 0 throughout (sea, lakes, ponds, aquifers, plunge pools, perched pools).
  - `Curtain`: below a lip, a column at the falling level from `FluidRules`, fed by a source stream at the lip. Lip notches snap to a grid axis, so every curtain cell has its feeder, and every curtain lands in a bowl of sources.
  - `LipStream`: a flowing run from a source toward a lip, re-seeded with a source at most every `max_stage − 1` cells, so no run outlives its reach.
  - `Settled`: an explicit per-voxel stage map produced by `settle.rs` at plan time (creeks, springs).
  - Levels pack into the voxel's stage bits, as `PieceCellState::pack` does.

### 5.6 Producers and the one-writer rule

Only these write water: landforms (`col.water`, plan body declarations), region solvers, `Fill` carves and aquifer columns through the void-fill rule, and the implicit sea. The writer emits fluid voxels only from resolved layers and void-fill hits, and `SliceWriter` refuses a fluid role in a structure unless the voxel is inside a matching layer. The model and the voxels cannot disagree.

### 5.7 Invariants (kit-tested)

1. `water_census`: every fluid voxel lies in a layer returned by `water_at`, or is a hit returned by `fluid_at`; explicit beds rest on solid.
2. `settle`: running the binding's fluid updater for 64 ticks on generated chunks changes nothing outside declared curtains. It runs once per fluid binding of the preset under test, and the kit runs it with three configurations (default; `flows_down_as_source`; `renews_reach_on_fall`).
3. Water never hangs: channel levels are monotone, lakes sit at or below their rim, and beds resolve after compose.
4. `void_fill_closed` (section 5.3).
5. `no_ground_under_water` (section 5.2).
6. `fluid_at_equals_voxels` on golden chunks.

### 5.8 Water-aware rules and an example

- `SurfaceCond::Water { kinds, max_dist }` replaces a sea-only "under fluid" test.
- Site constraints `WaterNear` and `WaterFloor` replace a sea-only fluid-floor requirement.
- Custom kinds: a spec declares `"water_kinds": {"game.hot_spring": {"doc": "...", "fluid": "fluid.water", "class": "Still"}}`, and the game's landform acquires it with `cx.water_kind("game.hot_spring")?`.

```rust
// game code: a habitat query
let land = landscape.clone();
let hot = land.water_kind_key("game.hot_spring");
let habitat = move |x, y, z| match land.fluid_at(x, y, z) {
    Some(h) if h.kind == WaterKind::AQUIFER && h.enclosed => Habitat::Cave,
    Some(h) if h.kind == WaterKind::SEA => Habitat::Marine,
    Some(h) if matches!(h.kind, WaterKind::RIVER | WaterKind::CREEK | WaterKind::FALL) => Habitat::Stream,
    Some(h) if h.kind == WaterKind::LAVA_POOL => Habitat::Hostile,
    Some(h) if Some(h.kind) == hot => Habitat::Thermal,
    Some(_) => Habitat::Still,          // lake, pond, plunge pool, perched, marsh, spring
    None => Habitat::Dry,
};
// Tick systems: land.water_if_ready(x, z) → Query::Pending skips the column this tick.
```

---

## 6. Structures

**Siting** (`Siting`):
- `Cells { cell, chance, jitter }` and `Spread { spacing, separation }`;
- `Rings { around: Spawn, distance, spread, count }` (a spawn reader);
- `Anchors { tag, of: [node ids], spacing, jitter, chance }`, placed with `ArcSchedule` reservation along features;
- `Crests { cell, roll }`, reusing the two-ring crest test;
- `NearWater { kinds, max_dist, cell }`;
- `Underground { anchor: "cavern_floor", min_room: (x, y, z) }`.

Landforms publish anchors in `Planned`, so a coast plan can level a lookout pad on its headland and a volcano can host a shrine inside its caldera.

**Constraints** are evaluated on the footprint at `Tier::PreFit`, never on one raw sample. That tier sees every landform, including Detail claims such as a tor's NO_SITES, and never the Fit layer, so siting has no cycle. The set:
- `Footprint { probe, max_relief }`: a 5-probe early reject, then a stride-2 median with tolerance;
- `SlopeL2 { max }`;
- `GroundShare { min, max }` (shares, never absolute y);
- `Geomorphon(set)`;
- `Landform { id, inside }`;
- `WaterNear`, `WaterFloor`;
- `SpawnDistance { min, max }`, measured from the spawn anchor (a spawn reader);
- `NotClaimed(Claims)`: any weight above 0 rejects;
- `BiomeKey(set)`, `CaveZone(set)`.

Every rejection is counted in `RejectionStats` and appears in the census.

**Fitting** is a set of Fit-layer ground ops, so facts, paint, flora and water all see the fitted ground. Fit ops are hydro-guarded like every Fit op. Overlapping fits blend by normalized weight; they never step. Each mode has cut and fill budgets checked at plan time, and exceeding them rejects the site.

| `Fit` | Ground delta |
|---|---|
| `WornPad { blend, round, max_cut, max_fill }` | Distance-transform grade ring `clamp(floor ± d)` with a smootherstep falloff. The cut side rounds through `soft_up`/`soft_down` with `k = round`; the fill side keeps the angle of repose. |
| `Terrace { step, levels, falloff }` | Footprint split along the downhill aspect, with risers |
| `Stilts { role, max_len }` | Ground untouched; the lowest piece cells extend down to the ground with a role block |
| `Bury { depth }` | Anchor at ground − depth; pieces protect themselves from carves |
| `Encapsulate { margin, shell }` | Carves a void around the piece, with an optional shell (halls in caverns) |
| `CliffHang { min_drop }` | Anchor on a face via `Face::offset(v)` or the wall inverse; back filled to rock |
| `RoadGrade { polyline, width, max_grade }` | Half-step grade envelopes |
| `FollowGround` | Per piece: y = footprint median |

**Piece graphs** (the built-in `pieces` site set) assemble pieces from pools through sockets, lowered from owned mirrors (`PieceSpecM`), which makes pieces data-authored. Compared with v1's pieces:
- `Dir6` sockets (Up and Down) for stairs, shafts and towers; v1 sockets are horizontal only (`Dir4`, `crates/gen/src/structures.rs:16-22`);
- per-piece `Projection::{Rigid, TerrainMatching}`;
- depth and radius caps, and pool aliases for themed variants;
- cross-plan collision through a reservation index of site footprints in reach;
- underground connection: `SiteCtx::passage_to(anchor, max_cost)` digs a bounded cheapest-rock passage to a real cave floor, or rejects.

**Underground settlements.** `Siting::Underground` places a site on a `cavern_floor` anchor with room for its footprint. The demo `undercroft` (P6) assembles halls, galleries and stairs through `Dir6` sockets, fits with `Encapsulate` (a void with an optional masonry shell), connects to the `stair_shaft` and to a natural cave floor with `passage_to`, and protects only its own pieces. Its markers resolve through the game's hook like any surface structure.

**Protection** is a per-piece voxel occupancy mask plus 1 block of clearance and the fitted band. v1 protects the whole plan box plus 1 (`crates/gen/src/structures.rs:1201-1210`), which lets sprawling plans block caves and dam rivers. Rivers are planned before sites, so sites avoid water by constraint.

**Reservations** keep vegetation and decoration out of pads, and are checked before trees grow.

**Plan caches** are keyed by (node, cell) inside the landscape, with no view parameter.

**Markers and loot.** The engine knows no loot:

```rust
pub struct PieceMarker { pub at: (u16, u16, u16), pub key: String, pub facing: Dir4 }   // on PieceSpecM
pub struct MarkerEvent<'a> { pub key: &'a str, pub world: (i32, i32, i32), pub facing: Dir4,
                             pub seed: u64, pub set: &'a str, pub member: &'a str }
pub trait MarkerHook: Send + Sync {
    /// Returns (block id, block-entity json) for chunk.block_entity_seeds; no chunk access.
    fn resolve(&self, e: &MarkerEvent<'_>) -> Option<(u32, String)>;
}
```

The seed comes from the site's build lane plus the piece and marker indices, so loot rolls never shift with placement draws. Hooks never receive a chunk writer.

---

## 7. Tooling

### 7.1 Offline renderer and provenance (`crates/gen/examples/landscape_render.rs`)

```
cargo run -p voxelize-gen --release --features unstable-landscape --example landscape_render -- \
  --preset default --seed 7 --height 512 \
  ( --postcard x,z,yaw,pitch | --map <layer> | --cutaway x0,z0,x1,z1 | --profiles | --census-sheet
  | --explain x,z | --dag [--dot] ) \
  --out <dir>
```

- **Images**: an oblique CPU-hillshade postcard coloured by role; top-down maps of any kept field, zone owner, claims (with weights), zones, water kind, bands, spans, biome or fit; cutaways showing bands, adds, carves, spans, water layers and cave zones; a worn-profile sheet; a census sheet of landform thumbnails at their located positions. Every image is labelled "OFFLINE LANDSCAPE RENDER — not in-game", and in-engine capture is always the final proof.
- **`--explain x,z`** prints the column's provenance, as text and JSON: every node and instance touching the column with its edge, exclusion and hydro guard; each ground op in fold order with the ground before and after and its `t`; claims with weights and owners; the zone and classify owners; refine, add and carve entries with ranges and weights; water declarations and the resolved layers; the aquifer column; spans; final top, biome and cave zones by y range. This is the tool for debugging the two-pass fold.
- **`--dag`** prints the planner DAG (each edge with the handle that recorded it, the spawn node and its excluded readers) and the composition order per layer, with the edge or default rule that placed each node and any `ImplicitOrder` lints. `--dot` emits Graphviz.

**Optional debug HTTP route.** `showcase --debug-http <port>` (binds 127.0.0.1) serves `/landscape/explain?x=&z=`, `/landscape/map?layer=&x0=&z0=&size=&stride=` (PNG), `/landscape/dag`, `/landscape/census?r=` and `/landscape/quality?x0=&z0=&size=`. It uses the `actix-web` dev-dependency and lives only in the example, never in the library.

### 7.2 Diagnostics (`landscape/quality.rs`)

`QualityReport` is computed from a heightmap window of facts tiles, or from LOD at stride 1–4. It extends v1's relief windows, repetition, autocorrelation and local maxima (`crates/gen/src/diag.rs`):

| Group | Metrics |
|---|---|
| Cut-ness | **Rim break width**: for slope ≥ 1.2 next to slope ≤ 0.3 along the gradient, the distance between them; p10 and p50; knife ≤ 1.5, worn ≥ 3. **Edge spike share**: share of land columns with \|Δ²h\| ≥ 6. **Axis bias**: gradient-direction histogram, 0°/90° bins over the mean ≤ 1.3. **Bench regularity**: autocorrelation peak of the steep-column height histogram. **Claim and band seams**: carve volume and band deviation sampled across claim bounds change continuously. |
| Spectrum (no FFT) | Box-blur difference ladder `E_λ = mean((B_{λ/2}h − B_λ h)²)` for λ = 2..512. **Fine ratio** `E(≤8)/E(32–256)` ≤ cap (no cavities), averaged over columns outside declared strata and bench zones (mask dilated by 8), since those carry their fine structure by design. **Medium floor** `E(32–256)/E(≥512)` ≥ floor (not fake-smooth). |
| Massiveness | Prominence and isolation of the top peaks within 3 km of spawn; relief p90 per 512-block window; canyon depth, dune height and volcano rise shares; landform quota per region |
| Realism | Geomorphon histogram (10 classes); hypsometric integral |
| Water | Share of river cells reaching the sea; settle violations; void-fill violations; body counts by kind |
| Seams and determinism | Chunk-border diff under shuffled order; digest equality across thread counts |
| Cost shape | Refine bands per column (p95), carves per column (p95), dispatch tiles admitted vs touched |

The **census** (`examples/landscape_census.rs`) reports counts per kind, the nearest instance to spawn, area share, a claim-overlap matrix, rejection stats with budget rejections broken out, the lints, and a landmark-chunk list that feeds goldens and screenshot poses.

### 7.3 Benchmarks and the budget gate

- **Walk bench** (`examples/walk_bench.rs`). Workloads:
  - **recorded traces** in `crates/gen/benches/traces/`: the showcase server logs, with `--trace-out <file>`, every chunk request in the order the engine dispatched it while the voxelize agent walks a fixed route. Replaying a real trace replaces re-implementing the engine's request order;
  - spiral; teleport; hero sites (worst-case chunks per kind, found by the census).

  It runs 1/4/8 workers, cold and warm, and reports p50/p95/max per pass and per kind, `first_touch_cascade_ms` per node, `chunk_wait_on_solve_ms`, and the engine gen profiler's stage times. It alternates before and after binaries and records each binary's sha256.
- **Deterministic gate** (every CI run, any machine). `counters.rs` (feature `gen-counters`) counts 2D and 3D octave evaluations, lattice nodes, culled versus straddling cells, voxels evaluated, plan steps, probe columns and cache misses. Per-chunk median and p95 are compared against `crates/gen/budgets/<preset>.json`; a failure prints a table naming the kind and the counter.
- **Wall-clock gate** (bench host, `GEN_BUDGET_GATE=1`). A calibration kernel runs first (1M 2D noise octaves plus 1M trilinear samples), and budgets are stored in calibration units, so a loaded or slower box doesn't false-fail. Locally the gate prints and never fails.
- **Pinning at P3.** `budgets/default.json` is pinned at P3 from a like-for-like comparison: the same recorded trace replayed warm (caches primed by one pass) against the default preset and against the flagship world's generator, both at H = 512, on the same host with the same worker count, in alternated runs. The pinned file records both measurements; the gate is the measured default value plus 10%, and P3 acceptance requires the default preset's warm p50 to be no slower than the flagship world's and ≤ 2.5 ms. Pinned at the same time: p95, worst chunk, per-node first touch and cascade times, cold point queries, and `volume_caves_512` (the cave province set alone at H = 512, ms per chunk and culled share; a criterion bench in `benches/landscape_kernel.rs`). P4 and P5 extend the file for the kinds they add.
- **Provisional values** until P3: `walk_p50_ms 2.5`, `walk_p95_ms 7`, `worst_chunk_ms 12`, `first_touch_cascade_ms {range 40, horn 20, canyon 60, drainage_tile 120, coast 60, stratovolcano 40}`, `chunk_wait_on_solve_p99_ms 10`, `point_query_cold_us 40`, `volume_ms 0.30`.
- **The v1 fixture** keeps its own baseline, measured in P0 with `generation_cost_smoke` (`crates/gen/tests/generation.rs:430`); its p50 may not regress by more than 3%.

### 7.4 Golden tests

- **Contents.** `tests/golden/landscape/<preset>.json` pins `(spec_hash, canon, algo, kinds, roles_digest)` plus FNV digests of voxels and facts for 3 seeds × 32 chunks.
- **Updating** requires `UPDATE_GOLDENS=1`, plus a content-version or `ENGINE_ALGO` bump, plus a changelog line.
- **v1 goldens.** `tests/golden_v1.rs` pins every v1 fixture: `fixture_spec`, `geology_fixture_spec` and `walker_fixture_spec` (`crates/gen/tests/fixtures/mod.rs`).
- **Map goldens** use pixel tolerance (mean absolute 1.5, changed share 0.005) and write a golden | current | diff sheet on failure. Voxels are compared exactly; pixels with tolerance.
- **Quality bands** are pinned per preset × seed in `tests/golden/landscape/<preset>.metrics.json`: measured values plus margins, re-pinned by an ignored survey test.

### 7.5 Test kit (`landscape::kit`, feature `kit`)

```rust
kit::landform_suite! {
    canyons: Canyon, spec = presets::default_landscape(&Knobs::test()), bindings = RoleBinding::demo(),
    seeds = [1, 7, 123123123],
    rarity = within(4000.0) >= 1, density_per_km2 = 0.02..0.4,
    country = |f| f.moisture <= 0.5,
}
```

It generates these tests:
1. `rare_and_within_reach`
2. `only_in_its_country`
3. `deterministic_any_order_and_threads`
4. `two_process_identical`
5. `seamless`
6. `caches_cost_only`
7. `costs_nothing_elsewhere`. **Invariant:** disabling node N leaves every chunk byte-identical outside its affected set A(N). A(N) is the union of the footprints (with fade) of N's instances and, recursively for every node R that reads N (plans, occupancy, facts, `water_of`, or a probe whose layer range includes N), R's instances whose footprints meet A; for a region solver, the whole tiles (with apron) whose probe area meets A; for a Field reader, the dispatch tiles meeting A. The test computes A(N) from the DAG and the feature index and compares digests over a window outside it. For a node that drainage probes through, A(N) contains whole 1536-block catchment tiles: rivers move anywhere in an affected tile, and the invariant says so instead of claiming locality it doesn't have.
8. `edge_continuous`, across footprint bounds and Field dispatch-tile boundaries
9. `lean_tiers_equal_full`
10. `grid_equals_point`
11. `culled_equals_unculled`
12. `no_floaters`
13. `water_census`, `settle` (per binding), `void_fill_closed`, `no_ground_under_water`
14. `far_reads_it`
15. quality bands (rim break width, fine ratio, medium floor, claim and band seams)
16. `within_work_budget`
17. `plan_budget_rejections_zero`
18. `watchdog` (1/2/4 workers, 10 s)
19. `ground_ops_identity` (bitwise, through the fold)
20. `height_map_matches_rescan`

`province_suite!` and `structure_suite!` cover their kinds: slices reassemble, fit budgets reject, protection covers only pieces, marker seeds are stable. The preset suite adds `spawn_is_dry_and_calm`, `scale_extremes_compile_strict` and the identity-file lifecycle (write, drift verdict, wipe resets).

---

## 8. The default preset

### 8.1 How it is authored

- **Rust is the source of truth.** `presets::default_landscape(knobs: &Knobs) -> LandscapeSpec` in `landscape/presets/default.rs` is type-checked, built only from library kinds, and claims its salts (`default.*`).
- **The JSON twin.** `cargo run -p voxelize-gen --features unstable-landscape --example export_preset` writes `landscape/presets/default.json` with every field present, through the canonical writer. `tests/landscape_spec.rs` asserts that reading the file (section 2.4.3) and the builder produce the same `spec_hash`. Games copy the JSON and edit or merge-patch it.

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Knobs {
    pub height: u32,               // must equal WorldConfig::max_height; tuned at 512, validated at 256 and 384
    pub sea: Height,               // ShareOfWorld(0.168): 86 at 512
    pub scale: f64,                // 0.5..=2.0; Span sizes × s, relief × min(1, √s), Blocks fixed (section 3.3)
    pub landforms: BTreeMap<String, bool>,   // per-node enable (section 7.5 test 7 states the invariant)
    pub rarity: BTreeMap<String, f64>,       // roll multipliers
    pub showcase: bool,            // hero placements near spawn (default true)
    pub spawn: SpawnSpec,          // default Search: calm temperate lowland, coast within 1.5 km
}
```

### 8.2 Materials and the boundary

**Roles.** The preset declares 34 roles with fallbacks. The game binds them with a `RoleBinding` (role → registry block name; fluid roles also carry a `FluidConfig`). Compile resolves each role through the binding, then the fallback chain, else refuses, as v1 refuses unknown block names (`crates/gen/src/spec.rs:455-461`). The resolved table is folded into `roles_digest`.

| Role | `RoleBinding::demo()` | Fallback |
|---|---|---|
| `rock.base` | Stone | — |
| `rock.hard` | Granite | rock.base |
| `rock.soft` | Limestone | rock.base |
| `rock.layer.0` / `.1` / `.2` | Sandstone / Clay / Mudstone | rock.soft |
| `rock.volcanic` | Basalt | rock.hard |
| `rock.volcanic.fine` | Scoria | rock.volcanic |
| `rock.tuff` | Tuff | rock.volcanic |
| `rock.glass` | Obsidian | rock.volcanic |
| `soil.top` | Grass Block | — |
| `soil.sub` | Dirt | — |
| `soil.dry` | Sand | soil.sub |
| `soil.wet` | Clay | soil.sub |
| `shore` | Sand | soil.sub |
| `gravel`, `talus`, `bed.river` | Gravel | rock.base |
| `bed.lake` | Clay | soil.sub |
| `snow` | Snow | — |
| `ice` | Ice | snow |
| `fluid.water` | Water, `FluidConfig::new()` | — |
| `fluid.lava` | Lava, `FluidConfig::new().max_stage(3).tick_rate(30)` | rock.glass |
| `cover.moss` | Moss | soil.top |
| `cave.cover` | Moss | cover.moss |
| `cave.strand` | Vines | — (unbound: dressing skipped) |
| `cave.glow` | Glow Stone | — (unbound: dressing skipped) |
| `cave.rubble` | Gravel | gravel |
| `cave.spike` | Dripstone | rock.soft |
| `flora.broadleaf.log` / `.leaf` | Oak Log / Oak Leaves | — |
| `flora.pale.log` | Birch Log | flora.broadleaf.log |
| `build.masonry` | Cobblestone | rock.base |
| `build.timber` | Oak Planks | flora.broadleaf.log |

Optional roles may declare "unbound: skip" instead of a fallback, so a game without such blocks loses only that dressing.

**Why this stays game-agnostic.**
- Role keys and block names are spec data. The literal-name rule flags only `get_block_by_name("…")` and `.name == "…"` in engine source (`scripts/engine-boundary/check.mjs`), and the engine branches on none of them. Every demo name passes the boundary gate, which is authoritative for generic material words.
- **Biome keys** are climate descriptors: `temperate.low`, `temperate.high`, `cold.alpine`, `dry.low`, `dry.high`, `wet.low`, `frozen`, `shore`, `seabed`. They are assigned after shape by the lowered climate partition, and own only paint tables, flora and dressing.
- **The demo block pack.** The engine registry ships only Air, so `presets::demo_blocks(first_id: u32, binding: &RoleBinding) -> Vec<Block>` returns a block per demo name. Water and Lava are fluids built with `create_fluid_active_fn` from the binding's configs; Glow Stone emits light.

### 8.3 What a player sees

This is the showcase at H = 512 with `showcase` on; the exact layout depends on the seed.

- **Spawn.** You arrive on calm temperate lowland a few blocks above a drainage river. Broadleaf and pale-barked trees stand in clusters, not sprinkled, and the grass is plain.
- **The hero range** lies broadside at 720–880 blocks, in the direction whose summits stand highest above your near horizon. Its crests approach 0.9 H under the soft ceiling; free-standing horns rise to 0.70–0.82 H around it. Crests are the 3D band, so they are true sharp ridges worn into ribs and buttresses, never fluted. Snow holds on ledges and gentle isosurface slopes; scree aprons gather at the foot. Flanks are gullied at a 48-block wavelength, and the faces between are broad and plain.
- **The sea coast**, within about 1.5 km: worn cliffs 30–90 tall with a shelf partway up; every 330 blocks a headland with an arch and two to four faceted, shrinking stacks; coves of sand with sea caves that the sea fills; a ribbon fall off a high cliff; somewhere a bay of wooded pillars; a lookout on a worn pad on a headland.
- **The dry interior**, a horizon over: a tableland cut by a benched canyon 58–150 deep, with sandstone, clay and mudstone benches wandering along the walls, buttes on the floor beside a trunk river, and side canyons hanging 40–80 above the floor, pouring falls into alcove pools. Farther into the hot, dry country, a dune sea: ridges 60–120 tall with gentle windward slopes, rounded crests and steep lee faces, small dunes riding their flanks, flats between them.
- **The volcano**, on the skyline: a concave cone with radial gullies and lobed basalt tongues, a caldera lake, an outlet fall from a notch in the rim. Offshore on some seeds, an island volcano with its own beach ring.
- **Moor crests** near spawn carry tors with a cairn; small spring-fed creeks wind down wet hillsides into the rivers and lakes.
- **Cold seas**, where the seed has them, freeze into a sheet that breaks into floe rafts at its edge; on one hemisphere an ice shelf stands 9–14 blocks above the sea with a worn ramped edge.
- **Over the high interior**, sky islands float at least 46 blocks above the ground, with rough undersides and their own perched pools and rim falls.
- **Underground.** Plain tunnels, threads and caverns are common. Wet districts hold aquifer water behind rock seals. Rare pockets take a theme by depth: covered, strand-hung upper galleries with small pools; spiked middle galleries; dark, glassy deep floors with the odd lava pocket. A rare cavern realm has pillars, curtains and terraced floors, reached by a stair shaft, with an undercroft settlement built into one hall.
- **Restraint.** No decorative scatter beyond ground cover. Three soft strata at most. Noise lives only at scales from 24 to 2048 blocks, apart from declared strata and benches.

**Demo structures** (`presets/demo_pieces.rs`, owned piece mirrors):
- `lookout`: anchors `headland` and `rim`; `WornPad` or `CliffHang`.
- `cairn`: `Geomorphon(crest)`; `Bury`.
- `stair_shaft`: anchor `cavern_floor`; `Dir6` sockets; `Encapsulate`.
- `undercroft`: `Siting::Underground` on `cavern_floor`; halls, galleries and stairs through `Dir6` sockets; `Encapsulate` with a masonry shell; joined to the stair shaft and to a cave floor with `passage_to`.

Each carries a `cache.common` marker that the showcase resolves with a demo hook.

### 8.4 The in-engine example world

`crates/gen/examples/showcase.rs` lives in the gen crate's examples, which avoids a dependency loop (the root `demo` example depending back on gen would compile two copies of voxelize). It:
- builds a registry of Air plus `demo_blocks(...)`;
- sets `WorldConfig` to `max_height(512)` (`server/world/config.rs:518`), chunk size 16, saving optional (the identity file then lives in `<save_dir>/chunks`, policy `Warn`);
- calls `landscape::compile(&presets::default_landscape(&Knobs::default()), &KindRegistry::with_builtins(), &RoleBinding::demo(), &blocks, &config)`;
- calls `landscape::install` with the demo marker hook;
- serves world `showcase` on port 4000 (`#[actix_web::main]`, as the demo server does), with optional `--trace-out <file>` and `--debug-http <port>`.

The voxelize example client picks its world from `?world=` (`examples/client/src/main.ts:1424-1427`) and connects to port 4000 (`examples/client/src/config/constants.ts`). It paints the demo blocks it doesn't already know with flat colours through `applyBlockTexture(…, new THREE.Color(…))` (`examples/client/src/world.ts`), and `showcase` is added to its world list (`main.ts:1981`). The demo server's legacy `terrain` world is untouched.

**Capturing in-engine:**
1. `cargo run -p voxelize-gen --release --features unstable-landscape --example showcase` (port 4000);
2. `pnpm --dir examples/client demo` (port 3000);
3. `pnpm --dir packages/agent dev -- --url "http://localhost:3000/?world=showcase" --world showcase --port 4099`, then numbered, captioned screenshots at census-located poses through the agent's `/sc` route.

---

## 9. Extensibility walkthrough (game code)

A game adds a **karst sinkhole**: a worn bowl with an optional pond and an undercut rim. It then adds a **rim lookout** with game loot, and tests both. Nothing in voxelize changes.

```rust
// game/worldgen/sinkhole.rs
use voxelize_gen::landscape::prelude::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SinkholeParams {
    pub cell: Size,                  // Span: follows the scale knob
    pub roll: f64,
    pub radius: (Size, Size),        // Span
    pub depth: (Height, Height),     // below local ground
    pub pool_chance: f64,
    pub round: f64,                  // soft-clamp width k, blocks
    pub undercut: Option<f64>,       // rim groove depth in blocks; None = no overhang
}
impl Validate for SinkholeParams {
    fn validate(&self, v: &mut Validator) {
        v.span("cell", self.cell, 256.0..=8192.0);
        v.unit("roll", self.roll);
        v.ordered_span("radius", self.radius, 8.0..=128.0);
        v.check("radius", v.size(self.radius.1) * 1.6 * 2.0 <= v.size(self.cell), "plan and fade must fit the cell");
        v.unit("pool_chance", self.pool_chance);
        v.range("round", self.round, 1.0..=6.0);
        if let Some(u) = self.undercut { v.range("undercut", u, 1.0..=6.0); }
    }
}

/// This landform's column record, readable by later nodes through FactKey<SinkholeCell>.
#[derive(Clone, Copy, Default)] pub struct SinkholeCell { pub d: f32 }
impl Fact for SinkholeCell {}

/// A carve province: a rounded groove under the lip, centred on a ring just outside the bowl wall.
#[derive(Clone, Copy, Default)]
pub struct NotchParams { pub cx: f32, pub cz: f32, pub ring: f32, pub half: f32, pub waist: f32 }
impl Fact for NotchParams {}
struct Notch;
impl Province for Notch {
    const KIND: &'static str = "game.sinkhole.notch";
    const VERSION: u32 = 1;
    type Params = NotchParams;
    const EFFECT: Effect = Effect::Carve;
    fn lattices(&self) -> &[LatticeSpec] { &[] }
    fn density(&self, p: &NotchParams, at: VoxelAt, _: &LatticeView<'_>) -> f64 {
        let (dx, dz) = (at.xf - p.cx as f64, at.zf - p.cz as f64);
        let radial = ((dx * dx + dz * dz).sqrt() - p.ring as f64).abs();  // distance from the groove's centre ring
        let v = (at.yf - p.waist as f64) / 3.0;                           // closes 3 blocks above and below
        p.half as f64 * (1.0 - v * v) - radial                            // > 0 inside a rounded groove
    }
}

pub struct Sinkhole {
    p: SinkholeParams,
    cell: i32, radius: (f64, f64),    // resolved spans
    karst: FieldRef,                  // a named field the game's spec exports
    probe: ProbeReader,               // composed ground below this layer
    avoid: ClaimReader,               // canyon / coast footprints at plan time
    outline: Noise,
    notch: ProvinceHandle<NotchParams>,
    wall: ZoneKey,
    water: RoleId,
}
pub struct SinkholePlan { c: (f64, f64), r: f64, floor: f64, lip: f64, pool: Option<i32>, body: WaterBodyId }

impl Landform for Sinkhole {
    const KIND: &'static str = "game.sinkhole";
    const VERSION: u32 = 1;
    type Params = SinkholeParams;
    type Plan = SinkholePlan;
    type Cell = SinkholeCell;

    fn build(p: SinkholeParams, cx: &mut BuildCtx<'_>) -> Result<Self, GenError> {
        Ok(Self {
            cell: cx.frame().span(p.cell).round() as i32,
            radius: (cx.frame().span(p.radius.0), cx.frame().span(p.radius.1)),
            karst: cx.field("karst")?,                            // edge: field → sinkholes
            probe: cx.probe(Through::Layer(Layer::Incise))?,      // edges: every Uplift writer → sinkholes
            avoid: cx.occupancy(&["canyons", "coasts"])?,         // edges: canyons, coasts → sinkholes
            outline: cx.noise("outline", NoiseSpec::fbm(1.0 / 40.0, 2).normalized())?,
            notch: cx.province(Notch)?,
            wall: cx.zone("game.sinkhole_wall")?,                 // declared in spec.zones
            water: cx.role("fluid.water")?,                       // declared role; the game binds the block
            p,
        })
    }
    fn layer(&self) -> Layer { Layer::Incise }
    fn layout(&self) -> Layout {
        Layout::Cells { cell: self.cell, roll: self.p.roll, reach: (self.radius.1 * 1.6).ceil() as i32 }
    }

    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<Planned<SinkholePlan>> {
        let (x, z) = site.jittered(0.6);
        if cx.field(self.karst, x, z) < 0.6 { return None; }                       // country gate
        let mut s = cx.stream("shape");
        let r = s.range_f(self.radius);
        if cx.claimed(&self.avoid, Area::disc((x, z), r * 1.6), Claims::ROCK | Claims::HYDRO) { return None; }
        let lip = cx.probe_exact(&self.probe, x, z).ground;
        let rim_min = cx.probe_ring_min(&self.probe, (x, z), r, 16);             // lowest of 16 rim probes
        let floor = lip - cx.frame().resolve_range(self.p.depth, &mut s);
        let pool = (s.unit() < self.p.pool_chance)
            .then(|| (floor + 0.5 * self.p.round + 2.0).min(rim_min - 1.0).floor() as i32)
            .filter(|&level| level as f64 > floor);                                // never above the lowest rim
        Some(Planned::new(SinkholePlan { c: (x, z), r, floor, lip, pool, body: cx.body_id(0) })
            .footprint(Footprint::disc((x, z), r * 1.6).fade(r * 0.6))   // edge(): 0 at 1.6 r, 1 inside 1.0 r
            .claims(Claims::HYDRO)                                        // drainage keeps out, faded by edge
            .anchor("rim", (x + r * 1.15, z), Facing::West)
            .body_opt(pool.map(|level| WaterBodyDecl::pond(level, Area::disc((x, z), r)))))
    }

    fn columns(&self, p: &SinkholePlan, batch: &mut ColumnBatch<'_, SinkholeCell>) {
        let bowl = profile::Wall::new(2.2, 0.15);                 // C1: flat floor, zero slope at the rim
        let k = self.p.round;
        for mut col in batch.iter() {
            let wob = 1.0 + 0.08 * self.outline.ring(p.c, (col.xf(), col.zf()), 4.0 * p.r);
            let (dx, dz) = (col.xf() - p.c.0, col.zf() - p.c.1);
            let dist = (dx * dx + dz * dz).sqrt();
            let d = dist / (p.r * wob);
            let profile = bowl.height((1.0 - d).clamp(0.0, 1.0));   // 1 at the centre, 0 at and beyond the rim
            let cur = col.ground();
            // Engaged, the soft clamp lands on the floor; where profile == 0 (rim, fade ring) h == cur,
            // so the op is the identity there and the bowl leaves no ring outside itself.
            let h = cur - profile * (cur - p.floor + 0.5 * k).max(0.0);
            col.ground_op(GroundOp::Carve { h, k });               // the engine multiplies by col.weight()
            col.claim_scaled(Claims::NO_SITES.into(), 1.0 - smoothstep(0.9, 1.05, d)); // the bowl, not the rim
            if profile > 0.0 { col.zone(self.wall); }
            col.cell(SinkholeCell { d: d as f32 });
            if d < 1.0 {
                col.cave_ceiling(p.floor as i32 - 6);
                if let Some(level) = p.pool {
                    // The bed resolves to final ground after composition: no air gap, no hanging water.
                    col.water(WaterDecl::still(WaterKind::POND, self.water, p.body, level).bed(Bed::FinalGround));
                }
            }
            if let Some(reach) = self.p.undercut {
                let ring = p.r * wob + 0.5 * reach;
                if (dist - ring).abs() < 0.5 * reach + 1.0 {          // density < 0 on this bound: no cut edge
                    let waist = p.lip - 4.0;
                    col.province(&self.notch, waist as i32 - 3, waist as i32 + 3,
                                 NotchParams { cx: p.c.0 as f32, cz: p.c.1 as f32, ring: ring as f32,
                                               half: (0.5 * reach) as f32, waist: waist as f32 });
                }
            }
        }
    }
}
```

**Registration, a structure, and loot:**

```rust
let mut reg = landscape::KindRegistry::with_builtins();
reg.landform::<Sinkhole>();

let spec = presets::default_landscape(&Knobs::default())
    .with_field("karst", FieldDef::detail(|b| b.fbm("game.karst", 1.0 / 1800.0, 3, 0.5, 2.0).normalized()))
    .with_zone("game.sinkhole_wall", ZoneDecl::doc("the worn wall of a sinkhole bowl"))
    .with_node("sinkholes", NodeSpec::new("game.sinkhole", "game.sinkholes")
        .over(&["slot_canyons"]).under(&["canyons"])          // explicit place in the Incise order
        .params(SinkholeParams { cell: Size::Span(640.0), roll: 0.3,
                                 radius: (Size::Span(14.0), Size::Span(30.0)),
                                 depth: (Height::ShareOfRelief(0.04), Height::ShareOfRelief(0.09)),
                                 pool_chance: 0.4, round: 3.0, undercut: Some(3.0) })?)
    .with_node("rim_lookouts", SiteSetSpec::pieces("game.rim_lookout")
        .siting(Siting::anchors("rim").of(&["sinkholes", "canyons"]).spacing(160.0).chance(0.5))
        .require(Constraint::Footprint { probe: FootprintProbe::median5(), max_relief: 3 })
        .require(Constraint::SlopeL2 { max: 0.6 })
        .require(Constraint::NotClaimed(Claims::NO_SITES))
        .fit(Fit::WornPad { blend: 6.0, round: 3.0, max_cut: 4, max_fill: 3 })
        .start(PieceStart::pool("game.lookout").depth(3).radius(24).projection(Projection::Rigid))
        .into_node())?;

struct Loot { chest: u32 }
impl MarkerHook for Loot {
    fn resolve(&self, e: &MarkerEvent<'_>) -> Option<(u32, String)> {
        (e.key == "cache.common").then(|| (self.chest, my_game::loot::roll("common", e.seed)))
    }
}

let land = landscape::compile(&spec, &reg, &my_game::roles(), &block_registry, &world_config)?; // refuses on any problem
landscape::install(&mut pipeline, land.clone(), Hooks::new().markers(Loot { chest }));
```

**The test is one block:**

```rust
landscape::kit::landform_suite! {
    sinkholes: Sinkhole, spec = my_game::spec(), bindings = my_game::roles(), seeds = [1, 7, 42],
    rarity = within(4000.0) >= 1, country = |f| f.field("karst") >= 0.6,
}
```

**What the game never touched:**
- Drainage keeps out because of the plan's HYDRO claim; later layers cannot raise ground through the pond because of the hydro guard.
- Caves stay below because of `cave_ceiling`; the groove is a carve province culled under the band rules and faded by the engine.
- Paint uses roles and the declared zone; the far sampler uses its LOD default; the census uses `census()` defaults.

**What the DAG did.**
- It recorded `karst → sinkholes`, every Uplift writer → sinkholes (through the probe), and canyons and coasts → sinkholes (occupancy; plan-time footprints may be read from any layer).
- The composition order puts sinkholes after slot canyons and before canyons in Incise.
- Had the game omitted `over`/`under`, the sinkhole would compose after every built-in in Incise and compile would print `lint ImplicitOrder: nodes[sinkholes] composes after the built-ins of layer Incise (slot_canyons, canyons); add "over" or "under" to place it`.

**Cost.** Cells that roll out cost one hash. Chunks outside a footprint pay nothing. Inside, there is one dynamic call per chunk plus the masked loop.

---

## 10. Migration

### 10.1 voxelize-gen v1 users

- **Nothing changes.** `GeneratorSpec`, `compile`, `install`, `CompiledGenerator` and every public v1 type keep their API and output, pinned by `tests/golden_v1.rs`, which CI runs from P0.
- **v1 edits are byte-identical and golden-gated:**
  - P0: explicit `Subsystem` discriminants (identical values); `stream_seed_lane` and `stream_seed_bytes` added, with `stream_seed` delegating to them (identical outputs, pinned).
  - P2a and P6: name-free entry points (`from_resolved`) behind v1's compile functions for climate partitions, flora, ecology and pieces. An adopting game's own preset digests must also stay equal on the dependency bump that carries them.
  - No serde feature is enabled on any shared dependency, no derive is added to a v1 type, and v1's caches are untouched.
- **v1's libm uses stay** (`crates/gen/src/channels.rs:70, 91`; `crates/gen/src/field.rs:1033`; `crates/gen/src/geology/solve.rs:659`). Changing them would be a format decision with no consumer asking.
- **v1's `spec_hash` float spelling** depends on the lockfile's serde_json formatter for floats ≥ 1e16; P0 guards the v1 fixtures against such floats (section 2.4.3).
- **Lowering v1 into `landscape`** (`landscape::from_v1`) is optional and future. It may land only with byte parity on all v1 goldens.
- **Legacy `server/world/generators`** gets a doc warning: `SeededNoise::new` ignores `NoiseOptions::seed`. Behaviour is unchanged.

### 10.2 Adopting `landscape` in an existing game

Generic guidance; a game's own adoption plan lives in its own repository.
- **Opt in per world.** Existing worlds and saves stay on whatever they use. `landscape` touches nothing until a world compiles a `LandscapeSpec`.
- **Feature hygiene.** Until P7 the module is behind `unstable-landscape`. Enabling it adds two small optional dependencies and no feature to any shared dependency; the API may still change.
- **Cost-only infrastructure first.** A game can adopt `ClockCache`, the stream hashing and exact lattice culling ideas in its own generator, gated by its own digests. Cost-only caches are only cost-only if the game's caches never store provisional answers, so the gate should include a shuffled-order determinism test, not just a fixed-window digest.
- **The water seam.** A game can mirror `WaterHit` semantics in its own code before P7 (every fluid voxel belongs to a declared layer; habitat queries ask `fluid_at`), then switch to the engine types after the freeze.
- **Ports one landform at a time**, with A/B renders, census and in-game captures; only chunks not yet generated change.
- **Every dependency bump** carries the adopter's own changelog entry and visual evidence, and the adopter's CI should run `cargo test -p voxelize-gen --release` alongside its own tests.

### 10.3 The distillation loop

When the flagship world lands or perfects a landform, the engine gets a twin:
1. extract the recipe with neutral names, as numbers and math;
2. port it with `math` and `profile` into `landscape/library/`;
3. give it its `landform_suite!` and quality bands;
4. run a **twin census**: distribution metrics (prominence, rim break width, depth shares, fine ratio) for the twin in the default preset versus the flagship instance, within tolerance bands. This is not bit equality, because `pow_smooth`, normalized noise and the soft clamps differ by design;
5. the default preset adopts the twin with the owner's approval.

The boundary gate and the consumer vocabulary scan run on every twin PR.

---

## 11. Phased implementation plan

Every phase is independently shippable: it lands as its own reviewed PR series on `main`, keeps all v1 goldens green, keeps `node scripts/engine-boundary/check.mjs` clean, and leaves CI green. The next phase starts only after its predecessor has merged. From P3 on, each phase also needs the owner's review of its numbered, captioned in-engine captures (section 8.4). Offline renders are labelled and never stand in for in-engine proof.

### P0. CI and baseline (no output change)

- **Create:** `crates/gen/tests/golden_v1.rs`, `crates/gen/tests/golden/v1.json`, `crates/gen/examples/walk_bench.rs` (v1 fixture workloads: spiral and teleport, plus a trace reader), `crates/gen/budgets/fixture.json`.
- **Change:**
  - `.github/workflows/rust-ci.yml`: a new job `gen` that installs protoc and runs `cargo test -p voxelize-gen --release` (the existing `cargo test --lib` runs only the root `voxelize` package, so gen's tests gate nothing today).
  - `crates/gen/src/stream.rs`: explicit discriminants 0–5 with a comment that order is identity; `stream_seed_lane` and `stream_seed_bytes`; `stream_seed` delegating.
- **Tests:** v1 goldens (3 fixtures × 3 seeds × 24 chunks, plus spec_hash pins) identical at 1/4/8 threads and in shuffled order; a two-process run (the test re-executes itself and compares digests); `stream_seed_bytes == stream_seed` and `stream_seed_lane(.., s as u8, ..) == stream_seed_bytes(.., s, ..)` on random inputs; no v1 fixture float ≥ 1e16.
- **Benchmarks:** fixture walking baseline, cold and warm.
- **Acceptance:** the CI job runs and is green; goldens byte-identical; boundary clean.
- **Proof:** bench JSON and the golden file (engine-only, no visuals).

### P1. Kernel toolkits (behind `unstable-landscape`)

- **Change:** `crates/gen/Cargo.toml` (features, optional dependencies, dev-dependencies, `required-features` on landscape examples, section 2.1); `crates/gen/src/lib.rs` (`#[cfg(feature = "unstable-landscape")] pub mod landscape;`); the CI job adds `cargo test -p voxelize-gen --release --features unstable-landscape,kit,gen-counters`.
- **Create:** `landscape/{mod, cache, math, profile, strata, geometry, lattice, channels, flood, settle}.rs`; `tests/landscape_kernel.rs`; `tests/no_libm.rs`; `benches/landscape_kernel.rs`; `examples/landscape_profiles.rs`.
- **Tests:**
  - golden pins for every `math` function, with error bounds (psin ≤ 2e-7);
  - `soft_down`/`soft_up`: bitwise identity where the target is at or beyond the ground, monotone, C1, engaged offset exactly k/2;
  - `pow_smooth_d` matches a central difference within 1e-9 and is exact at multiples of 1/8;
  - profiles monotone, joins C1 within 1e-12, inverse round-trips within 1e-6; `DuneWave` C1 across the wrap;
  - `BandTable` never inverts a slope;
  - lattice seam continuity, and culled == unculled on random fields;
  - Lipschitz gate bounds never below dense-sampled maxima on random fields;
  - `ClockCache` cost-only (capacity 1 vs large);
  - flood determinism; settle on synthetic falls under three `FluidConfig`s;
  - no libm under `landscape/`, and the v1 allowlist.
- **Benchmarks:** ns per op for math; lattice ns per node; cull ratio.
- **Acceptance:** all pins; zero libm; v1 goldens unchanged; a build without the feature compiles no landscape code and adds no dependency (`cargo tree -e features -p voxelize-gen`).
- **Proof:** the `landscape_profiles` sheet: Wall, Cone, Face, SWall, SlotSection and DuneWave cross sections with slopes.

### P2a. Heightfield core and the `plain` preset

- **Create:**
  - `landscape/{json, canon, spec, mirror, lower, identity, facts, surface, stage, query, quality, counters, explain}.rs`;
  - `landscape/water.rs`, sea only: the types, the implicit sea layer, `Sources` stamping and `water_at` (declarations, beds, void fill, aquifers and the other stamp modes arrive in P4);
  - `fields/{ir, compile, eval, grid, nodes}.rs`;
  - `kit/{mod, determinism}.rs`;
  - `library/{surface_rules, ecotones, zones}.rs`;
  - `presets/{plain, roles, demo_blocks}.rs`;
  - examples `landscape_render.rs` (maps, hillshade, `--explain`), `showcase.rs` (plain), `export_preset.rs`;
  - `budgets/plain.json`;
  - `tests/landscape_{spec, fields, facts, identity, writer, determinism}.rs`.
- **Change:**
  - v1 (byte-identical): name-free `from_resolved` entry points for climate partitions, flora and ecology, with v1 compile resolving names and then calling them;
  - client: `examples/client/src/world.ts` (flat colours for demo blocks) and `main.ts` (add `showcase` to the world list);
  - CI: a macOS arm64 job runs the same gen tests and compares golden digests with Linux.
- **Scope.** The plain preset is fields, paint, biomes, flora and the sea, with no plugins: the stage runs steps 1, 2, 4, 4b (sea only), 6, 7 (sea only), 9 and 10.
- **Tests:**
  - JSON reader (duplicate keys, NaN, depth, path-qualified errors) and round trip: builder == JSON twin hash, including floats needing 17 digits and values ≥ 1e16;
  - canonical writer goldens: independent of map order, pinned float spellings;
  - typed-param hashing (absent == null; `1` == `1.0` for an f64 field); merge patches;
  - field DCE and CSE equivalence; bandwidth, Lipschitz and range analyses; taste refusals including the fold limit;
  - identity verdicts and the file lifecycle: in the chunks folder, persists across restarts, removed by `Chunks::wipe`, `Refuse` with and without saved chunks, invisible to `.json` chunk enumeration;
  - `height_map_matches_rescan`;
  - determinism suite: order and thread shuffles, two processes, caches at capacity 1, grid == point;
  - `golden_v1` unchanged after the entry-point refactor.
- **Benchmarks:** plain preset walk; counters pinned in `budgets/plain.json`.
- **Acceptance:** plain p50 ≤ 1.0 ms warm on the bench host (provisional); determinism suite green on both architectures; `showcase` persists and checks identity.
- **Proof:** hillshade, climate and biome maps of the plain preset; agent screenshots at spawn in `showcase`.

### P2b. Plugins, DAG and composition

- **Create:**
  - `landscape/{registry, plugin, build, dag, compose, index, plan}.rs`;
  - `kit/landform.rs` (`landform_suite!`), with test-only landforms `kit::TestMesa` (a disc tableland built from `Wall`, Cells layout) and `kit::TestSwell` (Field layout);
  - `tests/landscape_{dag, compose, spawn}.rs`;
  - `benches/traces/` with the first recorded showcase walk;
  - `showcase --trace-out` and `--debug-http`; `landscape_render --dag` and the full `--explain`.
- **Tests:**
  - DAG refusals: cycle, layer violation, wrong-kind handle, disabled dependency, undeclared role, zone, kind or claim key, salt collision, fact read not strictly earlier, Field layout without `field_plan` or with an unknown-Lipschitz gate, spawn reader too close;
  - the default "after built-ins" order and its `ImplicitOrder` lint; composition order independent of the DAG;
  - `ground_ops_identity` through the fold; claim weights and plan-level exclusion (two-pass, order-independent);
  - `edge_continuous` for Cells and for Field across dispatch tiles; tile gating never misses (dense check);
  - `costs_nothing_elsewhere` with the computed affected set;
  - spawn: a declared node, readers excluded, verification at PreFit; a game Detail landform placed on the first candidate moves spawn to the next;
  - per-index `WorkMeter` determinism under thread shuffles; `forbid_solves`.
- **Benchmarks:** walk with the test landforms enabled vs disabled (cost per chunk without an instance ≤ 1 µs).
- **Acceptance:** all of the above; plain preset digests unchanged by P2b (it has no nodes).
- **Proof:** `--dag` output; `--explain` dumps for a TestMesa rim column and fade-ring column; maps of edge and claim weights.

### P3. Volume, caves, cave zones and the relief family

- **Create:** `landscape/volume.rs`; `library/{caves, cave_zones, range, horn, strata_cliffs, dunes, tor}.rs`; `presets/default.rs` v0 (relief, range with hero, horns, strata, dunes with the erg mode, tors, caves, cave zones); `kit/province.rs`; `tests/landscape_{volume, relief, caves}.rs`; `budgets/default.json` (pinned here).
- **Tests:**
  - per-kind suites; culled == unculled for every province; no floaters; `edge_continuous`;
  - claim and band fades continuous (caves taper at NO_CAVES bounds; a strata shelf blends against a crest);
  - hero range in view from spawn on seeds 1–8; prominence ≥ 0.7·(H − sea) within 3 km;
  - rim break width p50 ≥ 3; fine ratio ≤ cap (strata masked) and medium floor ≥ floor;
  - erg ridge heights 60–120 and measured lee slope ≤ 0.65;
  - cave-zone pockets cover ≤ 15% of cave floor area (restraint);
  - zero plan-budget rejections; scale extremes compile strict and pass quality bands; spawn dry and calm on seeds 1–8.
- **Benchmarks:** the like-for-like warm walk against the flagship world on the same trace (pins the budgets); `volume_caves_512`; range and horn cascades.
- **Acceptance:** warm p50 no slower than the flagship world's and ≤ 2.5 ms; worst chunk ≤ 12 ms; cascades within the pinned budgets; owner review.
- **Proof:** a postcard from spawn toward the hero range; a dune-sea postcard; a tor census sheet; a cave cutaway with zones; agent screenshots of the range from spawn, a tor crest, a dune ridge, a themed cave pocket and a plain cave.

### P4. Water as data, the canyon, aquifers and creeks

- **Create:** the full water model in `landscape/water.rs` (declarations, beds, the hydro guard, void fill, aquifers, every stamp mode, `FluidRules`); `library/{drainage, basins, lava_pools, canyon, creeks}.rs`; aquifer, cave pools and lava pockets in `library/caves.rs`; `kit/water.rs`; `tests/landscape_water.rs`.
- **Change:** `presets/default.rs` (drainage, basins, canyon, creeks, aquifer).
- **Tests:**
  - `water_census`; `settle` at 64 ticks per binding and under the three kit configs; `void_fill_closed`; `no_ground_under_water`;
  - beds resolve to final ground: a Detail op under partial HYDRO weight moves bed and water together;
  - rivers-to-sea share ≥ 0.9; lakes never excavate; tile independence and seams;
  - canyon cross sections; benches wander (autocorrelation guard); at least one fall drop ≥ 20 on seeds 1–8;
  - at least one creek joining a receiver within 4 km of spawn on seeds 1–8;
  - aquifer barriers seal; `fluid_at_equals_voxels`; `fluid_at` cold ≤ 50 µs.
- **Benchmarks:** drainage-tile and canyon cascades; walk p50 within the pinned budget.
- **Acceptance:** all of the above; owner review.
- **Proof:** a water-kind map; a canyon cross-section sheet; an aquifer cutaway; agent screenshots of a canyon fall, a lake, a creek mouth and an aquifer lake behind its seal.

### P5. Signature landforms and the far sampler

- **Create:** `library/{stratovolcano, coast, slot_canyon, sky_islands, cavern_realm, polar_sea}.rs` (the volcano with island and seamount variants); `landscape/far.rs`; `tests/landscape_signature.rs`.
- **Change:** `presets/default.rs` (all kinds, showcase heroes).
- **Tests:**
  - per-kind suites;
  - ≥ 2 stacks and 1 arch; a caldera; ≥ 3 tors; a sky island with perched water; cavern volume ≥ threshold;
  - sea caves filled by the sea (every Fill(Sea) component touches the sea);
  - an island volcano or seamount on at least 2 of seeds 1–8 within 6 km;
  - sea ice and a shelf on a cold-seed fixture, with shelf-edge rim break width ≥ 3;
  - `far_reads_it`; sky channel present.
- **Benchmarks:** volcano and coast cascades; walk p50 and p95 within budget.
- **Acceptance:** all of the above; owner review.
- **Proof:** a census sheet of all kinds; agent screenshots of the coast with stacks and an arch, a sea cave, the volcano with its caldera lake, an island volcano, sky islands, the cavern realm, sea ice and the ice shelf.

### P6. Structures v2 and underground settlements

- **Create:** `landscape/sites/{mod, siting, constraints, fit, pieces, protect, markers}.rs`; piece mirrors in `mirror.rs` and `lower.rs` (with v1's name-free piece entry point); `presets/demo_pieces.rs` (lookout, cairn, stair_shaft, undercroft); `kit/structure.rs`; `tests/landscape_sites.rs`.
- **Change:** `presets/default.rs` (sites); `examples/showcase.rs` (demo marker hook).
- **Tests:**
  - slices reassemble the plan; fit budgets reject; protection covers only pieces; cross-plan reservations; marker seeds stable under placement changes;
  - constraints at `Tier::PreFit` see Detail claims (a cairn never lands on a tor's NO_SITES apron);
  - `Dir6` stairs connect; `passage_to` reaches a cave floor or rejects;
  - the undercroft fits inside a hall on seeds where one exists and never breaches water;
  - data-authored pieces from JSON hash like their Rust twins; `golden_v1` unchanged after the piece refactor.
- **Benchmarks:** walk p50 still within budget.
- **Acceptance:** all of the above; owner review.
- **Proof:** fit-overlay maps; agent screenshots of a lookout on a headland, a cairn on a tor, the stair shaft and the undercroft.

### P7. Default preset 1.0, docs and the freeze

- **Create:** `presets/default.json` (final export); `tests/golden/landscape/default.json` and `default.metrics.json`; `crates/gen/README.md`; `docs/docs/tutorials/intermediate/14-landscape-generation.md` (the intermediate tutorials currently end at 13).
- **Change:** `docs/docs/tutorials/basics/5-chunk-generation.md` (fix the stale `ResourceResults` type and link the new page); the feature is renamed `landscape` (still non-default), with `unstable-landscape` kept as an alias for one minor release; CI adds `walk_bench --quick --gate-counters`.
- **Acceptance:** every gate in CI on both architectures; owner review of numbered in-game captures; content version 1.0.0; spec format 2 frozen.
- **Proof:** a full showcase capture set plus the census.

### P8 (optional, after P7). Multi-rate field evaluation

- **Create:** `fields/{rate, batch}.rs`, and `export_preset --suggest-rates`, which writes per-octave resolutions into the spec as authored data.
- **Tests:** batch == scalar bit for bit; interpolation error ≤ 0.05 blocks (a property test); preset digests change only through an explicit content-version bump.
- **Acceptance:** ≥ 30% field-time reduction on walk_bench with an unchanged QualityReport.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Scope.** gen is about 12.7k lines today, and this roughly doubles it. | Phases are independently shippable and reviewed one at a time; the plain preset ships in P2a before any landform; five plugin kinds only; stop adding kinds once the flagship set is covered. |
| **Abstraction cost.** | Dispatch once per instance per chunk; per-voxel work only in provinces on lattices with exact culling; the run writer; work counters gate CI from P2a; budgets pinned like-for-like at P3. |
| **First-touch cascades** on chunk workers. | Batched probes, shared probe caches, parallel plan solves per tile, prefetch one tile ahead, cascade budgets, `chunk_wait_on_solve_ms`, `*_if_ready` and `forbid_solves` for ticks. |
| **Look drift from the flagship world** (`pow_smooth` vs a true power, normalized noise, soft clamps). | Twin census with tolerance bands, A/B renders, owner review. Bit equality is explicitly not a goal for twins. |
| **Determinism leaks** in game plugins or ports. | `no_libm` scan and `kit::assert_no_libm!`; two-process and two-platform goldens; `caches_cost_only`; no unordered iteration; per-index budgets; typed-param hashing. |
| **Feature unification** reaching consumers. | No new feature on shared dependencies; landscape behind a non-default feature; `cargo tree` check in P1 acceptance. |
| **Plan-budget rejections** silently deleting landforms. | Budgets in `spec_hash`; census reports rejection rates; zero rejections required on gate seeds. |
| **Overlap semantics** differ from a hard "first present wins" chain. | Plan-level exclusivity reproduces whole-column exclusion faded by edge; planners avoid overlap through occupancy; the kit tests overlaps for continuity. |
| **Water edge cases** (sea caves, aquifers, perched pools). | (body, level, bed) resolved after compose, the void-fill rule, barrier seals, settle per binding, `void_fill_closed`. |
| **Too many systems coexisting** (legacy generators, v1, `landscape`, game generators). | Explicit roles: legacy and v1 frozen; `landscape` the target; games adopt infrastructure first; optional v1 lowering only with parity. |
| **Boundary leaks** from preset words, docs or kind names. | Names pre-scanned against a consumer vocabulary; the gate in CI; neutral axis names; game-specific adoption text kept in the game's repository. |
| **Taste** (busy, generic or knife-cut). | `TasteGuards::strict`; quality bands in both directions; restrained defaults; owner review per phase; fix named symptoms inside the existing look rather than redesigning. |
| **Memory** (about 50 MB of caches by default). | Configurable caps; byte-capped facts LRU; CLOCK degrades gracefully. |
| **Format churn.** | Format 2 is unstable behind the feature until P7; later additions go through kind `VERSION` and `ENGINE_ALGO` in identity; breaking changes need a format bump and a load-time check. |

---

## 13. Open questions and answers

1. **Extend `GeneratorSpec` in place, or a separate module?** A separate `landscape` module (format 2), with zero v1 literal breakage and no version branches inside v1 stage bodies. v1 primitives are reused through name-free entry points.
2. **JSON or RON for presets?** JSON is canonical, read by our own strict reader and written by our own canonical writer. RON could be an optional feature lowered to JSON before hashing; not planned.
3. **Fix v1's libm calls, or lower v1 into `landscape`?** Neither, unless a v1 consumer asks. Any lowering requires byte parity on all v1 goldens.
4. **Default height?** The engine default stays 256 (`server/world/config.rs:287`). The preset is tuned at 512 and validated at 256 and 384 by quality bands scaled by `Height` shares.
5. **Far layer on by default?** No. Fog is the preferred horizon. `LandscapeFarSampler` serves maps, debug routes and tools; games opt in.
6. **Must existing worlds migrate?** Never. Games adopt cost-only infrastructure and the water seam first, and port landforms one at a time on request.
7. **Multi-rate compiler?** Later (P8), optional, with rates as authored data pinned in `spec_hash`.
8. **Ownership model?** Per-channel claims with continuous weights by default; plan-level exclusivity for whole-column exclusion, faded by the owner's edge. Ground always blends.
9. **Geology plate prior in the default preset?** No: startup cost and tile flushes, and it is outside the cross-platform claim. Field relief plus planned ranges and drainage tiles give massive forms instantly.
10. **Hero placement without rejection loops?** `Layout::Once` hero variants for range, stratovolcano and coast, all spawn readers, plus the declared spawn search. They are guaranteed by construction and verified over seeds 1–8.
11. **Precedence integers?** None: `Layer`, named `over`/`under` edges, and the default "after built-ins" order with a lint.
12. **Does voxelize core need changes?** None on the critical path; `chunk.top_filled_y` is public. Optional later additions, each justified by measurement: a `ChunkStage::prefetch` hook; an engine-set tick-thread marker; a public `FluidConfig::falling_stage(stage)` so gen calls the engine's rule instead of mirroring it.
13. **Where does the showcase live?** `crates/gen/examples/showcase.rs`, avoiding the voxelize ↔ voxelize-gen dependency loop. The demo server's `terrain` world stays.
14. **How are game landform params validated?** Through `Validate` with path-qualified errors and no struct-level `Default`; optional fields are `Option<T>`; exported presets write every field; the hash covers the typed values.
15. **How do structures get loot?** Through the narrow `MarkerHook` returning `(block id, json)` into `block_entity_seeds`, with seeds from the build lane. Hooks never get a chunk writer.
16. **Who keeps the engine in step with the flagship world?** Each flagship landform PR spawns an engine-twin task (section 10.3), checked by the twin census and the boundary gate.
17. **Why not turn on serde_json's `float_roundtrip`?** Cargo unifies features across a consumer's build, so it would change how the consumer's own JSON parses. The own number path gives correctly rounded reads without it.
18. **Why does an engaged `Carve` land k/2 above its target?** A monotone C1 one-sided clamp that is the identity where the target equals the ground cannot also land exactly on the target; profiles absorb the offset (section 2.8).
19. **Why exclude spawn readers from the spawn search?** It breaks the cycle between spawn and hero placement; readers keep their footprints clear of spawn, so the excluded nodes cannot change what the search saw.
20. **May demo blocks use generic words that a game also uses as block names?** Yes: the boundary gate's generic-word allowlist governs. The demo pack still prefers neutral geology words where a choice exists (for example `Mudstone` for the third strata role).

---

## Appendix A. How each review finding is resolved

| # | Finding | Resolution | Where |
|---|---|---|---|
| 1 | No CI runs the gen tests | P0 adds a CI job running `cargo test -p voxelize-gen --release`; P1 adds the feature run; P2a adds macOS arm64. The adopter adds the same command to its own verify. | 10.1, 11 P0–P2a |
| 2 | "Reuse v1 primitives" vs owned strings plus Deserialize | Owned mirror types and an explicit lowering layer; `stream_seed_bytes` and `stream_seed_lane`; no derive on any v1 type; name-free v1 entry points behind v1 compile, golden-gated; the work is budgeted; data pieces arrive with the piece mirror in P6. | 2.4.2, 2.14 D1, 11 P0, P2a, P6 |
| 3 | The water model contradicts itself | A layer is (body, level, bed) resolved after compose against final ground; the void-fill rule; per-cell aquifer levels with single-voxel `fluid_at`; the hydro guard on Detail and Fit ground ops; the walkthrough uses a `FinalGround` bed. | 5.2–5.4, 2.8, 9 |
| 4 | Carve and Build shift ground where they should change nothing | One-sided soft clamps, identity where target == ground, monotone and C1, engaged offset k/2 absorbed by profiles; symmetric smin/smax are field nodes only; kit test `ground_ops_identity`. | 2.8, 3.1, 7.5 |
| 5 | The run writer breaks the height map | The writer contract: one `Arc::make_mut`, direct writes, `chunk.top_filled_y = Some(max_y)`; kit test `height_map_matches_rescan`. | 2.12 item 7, 7.5 |
| 6 | `float_roundtrip` would change consumers' binaries | Not enabled, nor any other serde_json feature; own strict reader with correctly rounded numbers; own canonical writer with a pinned `ryu`. | 2.1, 2.4.3, 2.14 D6 |
| 7 | Budgets not grounded in measurement | Pinned at P3 from a like-for-like warm walk of the flagship world on the same recorded trace and host; a cascaded first-touch metric; `volume_caves_512`; facts memory recomputed with only kept fields and a byte-capped LRU. | 2.9, 2.16, 7.3 |
| 8 | Binary claims and band slots cut edges in 3D | Claims carry continuous weights and consumers fade by them; refine bands blend as weighted deviations with no count limit; carves are a separate list faded by weight and claims; zone owner is the largest weight among zone writers, with no ordinal multiplication. | 2.8, 2.12 |
| 9 | Field layouts can seam at cell boundaries | Field layouts are position-pure (`field_plan` takes no position); tiles are dispatch-only; edge from the gate; conservative tile gate from Lipschitz bounds; `edge_continuous` across tile boundaries. | 2.6, 2.8, 2.13, 7.5 |
| 10 | Reads in compose can't see later data | `fact::<T>` refuses nodes not strictly earlier in composition order (also `Through::With` same-layer reads); exclusivity is plan-level only and `ColumnClaims` has no exclusive bit. | 2.7, 2.8 |
| 11 | Spawn and Tier underspecified | `engine.spawn` is a declared DAG node searching through `Through::Layer(Water)` over spawn-independent nodes, verified at `Tier::PreFit`; readers keep clear; `Tier::PreFit` added; site constraints at PreFit; the probe text is fixed (`Layer(Detail)` gives final hydrology). | 2.7, 2.9, 6 |
| 12 | Water stamping depends on the game's fluid config | Fluid role bindings carry `FluidConfig`; `FluidRules` mirrors its level rules; demo fluids are built from the binding; `settle` runs per binding and under three kit configs. | 5.5, 5.7 |
| 13 | Determinism holes | Per-index `WorkMeter` budgets checked after the join; `spec_hash` over typed, validated params; the no-libm scope stated with an audited v1 allowlist; a pinned float formatter as a direct dependency. | 2.14 D2, D6, D8; 2.4.3 |
| 14 | Cave constants from the other game | Caves and aquifer use the flagship world's own values (roof 8 + fade 8; 2D aquifer region f 0.006 > 0.35 at level 0.0703 H with barrier seals); 3D cell aquifers are an optional later kind with no provenance in repo text. | 4.2, 5.4 |
| 15 | Phases not independent | Aquifers moved to P4; P2 split into P2a (heightfield, surface, stage, facts, plain preset) and P2b (plugins, DAG, compose with test landforms); the module is behind `unstable-landscape` until P7. | 2.1, 11 |
| 16 | Name collisions and API pain | `ClockCache` and `KindRegistry`; keyed zones (`ZoneKey`), custom water kinds (`WaterKind(u16)` with declarations) and keyed game claim bits; province `KIND`/`VERSION` folded into the owner's `KindStamp`; culling bounds are trait methods, not fn pointers; the default "after built-ins" order with the `ImplicitOrder` lint; the walkthrough uses a declared zone. | 2.6–2.8, 2.15, 5.1, 9 |
| 17 | The scale knob fights the taste guards | Typed sizes: `Span` scales with s, `Blocks` never does; relief × min(1, √s); fold ratios invariant; strata and bench terms exempt with their own guards; strict compile tested at s = 0.5, 1 and 2. | 3.3, 2.13 |
| 18 | `pow_smooth` breaks the C1 claim | Wall and Cone joins use `pow_smooth` and its exact analytic derivative `pow_smooth_d`; join tests at 1e-12. | 3.1, 3.2 |
| 19 | Landforms the owner asked for are missing or thin | Underground settlement demo `undercroft` (P6); vertical cave-zone partition (P3); creeks and springs (P4); polar sea ice and ice shelf, island volcanoes and seamounts (P5); giant dunes 60–120 (P3). | 4.2, 6, 8.3, 11 |
| 20 | Identity file lifecycle | The file lives in `<save_dir>/chunks` with a non-`.json` extension, so `wipe` resets it; pristine-chunk behaviour and the policies are documented. | 2.5 |
| 21 | Missing dependencies and housekeeping | Cargo wiring listed (optional `ryu`, `serde_path_to_error`; dev `actix-web`, `log`; no bitflags); tutorial numbered 14; horn and range summit heights made consistent; the client command corrected to `demo`. | 2.1, 8.3, 8.4, 11 P7 |
| 22 | The A/B claim is overstated | The invariant is byte-identity outside the computed affected set (footprints plus affected readers' footprints, whole region tiles and dispatch tiles), and the test computes that set. | 1 G8, 7.5 test 7 |
| 23 | Missing tooling | `landscape_render --explain x,z` and `--dag`; an optional showcase debug HTTP route; recorded walk traces replayed by `walk_bench`; `chunk.biome_tints` filled by the writer. | 7.1, 7.3, 2.11 |
| 24 | Scope versus the stated preference | The full program is kept (the owner asked for the best system); every phase is independently shippable, reviewed, and gated on its predecessor. | 0, 11 |

## Appendix B. Design-review flaws carried from the synthesis

| Flaw raised | Resolution |
|---|---|
| A two-dialect API (`SpecExt` plus version levels) inside v1 | A separate `landscape` module and spec; v1 frozen; its edits byte-identical. |
| Dependencies declared apart from use; erased plan views; stringly fields | Typed `BuildCtx` handles record the DAG; `PlanReader<K>` and `FieldRef` are typed. |
| Fixed `[f32; 6]` band params | `Province::Params: Fact` with typed `ProvinceHandle<P>`. |
| No typed per-landform column record | `Landform::Cell` plus `FactKey<T>`. |
| An interner leaking `&'static str` | Owned strings, mirrors and lowering. |
| A fixed material-roles struct | A role table with fallbacks, folded into identity. |
| A fragile thread-local facts handoff | One `LandscapeStage` plus a facts LRU; `install_split` for interleaving. |
| No per-voxel strategy at 512; weak auto-stride | Runs, analytic spans and exact culling; resolution is authored; multi-rate is P8. |
| A fixed-byte column record that doesn't add up | SoA with an honest memory estimate. |
| Release builds clamping out-of-reach bounds | Rejected and counted, never clamped. |
| Cut edges in example landforms | Every op multiplied by the engine fade; `edge_continuous`; identity ground ops; the walkthrough is C0. |
| Twelve overlapping traits | Five kinds. |
| Four ordering mechanisms; precedence integers | Layer plus named `over`/`under` plus the default order; the planner DAG derived from handles; paint order is a list. |
| Blending order tied to plan rank; ownership by dropping writes | Composition order independent of the DAG; ground always blends; claims fade other channels. |
| `Params: Default` plus `serde(default)` silently filling | No struct-level defaults; `Option<T>`; full export; typed hashing. |
| `Vec<Arc<dyn Any>>` plan queries | Typed `plans::<K>(&LandformHandle<K>, …)`. |
| A home-made patch dialect | RFC 7396 merge patches over node maps. |
| Solve-local probe frontiers; point queries costing 9× | Shared probe caches (safe under a strict DAG); point queries consult the LRU first and compose one column when no stencil is needed. |
| A taste gate checking one direction | A fine ceiling plus a medium floor. |
| A risky bit-identical rewiring of a game generator | Adoption is opt-in, infrastructure first, ports one landform at a time. |
| An unpinned rate table in identity | Resolution is authored data in `spec_hash`. |
| Work meter vs counter configuration conflict | Plan budgets always compiled and in `spec_hash`; cost counters feature-gated and separate. |
| Coarse probes setting water levels | Flood solvers use exact probes. |
| Optimistic culling bounds | Bounds derived from `DensityForm` or author methods verified by `culled_equals_unculled` in every province suite. |
| A raw chunk writer in game hooks | `MarkerHook` returns data only. |
| Replacing the example terrain world | `showcase` added in gen examples; the demo's `terrain` world stays. |
| A channel payload breaking existing literals | A new `ChannelNet<P>` type; v1 channel structs unchanged. |
| Implicit `Subsystem` discriminants | Pinned explicitly (byte-identical); landscape lanes use `stream_seed_lane` at 6 and above, so v1's enum gains no variant. |
