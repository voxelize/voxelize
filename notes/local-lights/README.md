# Local light emitters: design and implementation notes

Status: **Engine PR A implemented** (emissive faces + registry + clustered analytic layer).
Engine PR B (shadow atlas, hero point shadows, CSM ledger) remains future work; its
sections in these documents are design, not shipped behavior. Where the implementation
deviates from the original RFC text, the deviation is marked inline with **[implemented]**
notes — the code is the source of truth, these documents are the rationale.

Scope: extremely performant local light emitters — torches, lanterns, campfires, lava,
glowing windows, magic lamps, held lights, projectiles, moving entities — rendered by the
Voxelize engine and declared by the game layer (Town), integrated with the existing
sunlight/CSM/shadow/render pipeline without disturbing it.

## Documents

| File | Contents |
| --- | --- |
| [`01-baseline.md`](./01-baseline.md) | Audit of the current renderer, light propagation, meshing, CSM, shadow invalidation, render stats, and consumer usage. Constraints derived from it. |
| [`02-architecture.md`](./02-architecture.md) | The layered hybrid design, alternatives compared, diagrams, selection/culling/caching mechanics, CSM integration. |
| [`03-api.md`](./03-api.md) | Reviewable TypeScript / Rust / shader-facing types, lifecycle guarantees, worked Town-side examples. |
| [`04-benchmarks.md`](./04-benchmarks.md) | Hard budgets, acceptance gates, benchmark scenes, methodology, metrics, debug overlays. |
| [`05-rollout.md`](./05-rollout.md) | Phased implementation plan (engine PRs, then Town PR), migration, risks. |

## One-paragraph summary

CSM is for directional sunlight and stays that way; a torch does not belong in a cascade.
Local lights become a complementary, layered system. The existing voxel flood light — which
is already a colored, occlusion-correct, incrementally updated diffuse field baked into
vertices at zero per-frame cost — remains the broad-diffuse and far-field layer for every
placed emitter, however many thousands there are. On top of it: an **emissive-face bit** so
sources themselves glow; a **world-space clustered analytic light layer** (data textures +
fixed shader loop, one shader permutation, no per-source objects) that adds per-pixel
falloff, normal response, and specular for the nearest ~dozens of sources; and a small
**shadowed hero tier** (≤ 4 lights) rendered into a shared shadow atlas with cached static
maps, scheduled by the same frame ledger that already throttles CSM cascade renders. Static
emitters use the flood field itself as a leak mask (the BFS already encodes occlusion), so
thousands of torches get "shadows" without a single extra shadow camera.

## Hard invariants (non-negotiable in implementation)

1. **Zero steady-state allocations.** All light records live in pooled SoA typed arrays;
   handles are packed integers; per-frame work reuses scratch buffers.
2. **No O(lights × chunks/meshes) scans.** All queries go through the spatial grid; updates
   touch only dirty cells.
3. **One shader permutation per existing material bucket.** Light count, tier, and budgets
   are uniform/texture data. No shader recompilation when sources appear, move, or die.
4. **No `THREE.PointLight`, no six live shadow cameras per source.** Chunk materials do not
   use three.js's lighting system today and will not start.
5. **No flicker-driven shadow redraws.** Flicker is an intensity animation on the light
   record; it never invalidates a shadow map. Shadow selection uses hysteresis.
6. **CSM behavior is unchanged when zero local lights are registered**, byte-for-byte on
   the shader side apart from dead uniform declarations.
7. **The lowest quality tier renders exactly like today plus emissive faces** — the
   fallback for mobile/low-end is the current look, not a broken one.
8. **≤ +3 texture units** on chunk materials (light data, cluster grid, shadow atlas);
   fits the WebGL2 guaranteed minimum of 16 with today's ~6.
9. **Deterministic selection.** Same registry + camera state ⇒ same selected set; ties
   break on stable handle order. Reproducible in tests.
10. **No game-specific block IDs in the engine.** Town declares semantic profiles for its
    own IDs through the API; the engine ships zero knowledge of "torch".

## Decisions Ian must approve

Each decision below is argued in detail in `02-architecture.md` (D1–D8) and `05-rollout.md`
(D9). "Rec" = recommendation this RFC argues for.

| # | Decision | Options | Rec |
| --- | --- | --- | --- |
| D1 | Analytic-light architecture | (a) world-space clustered forward grid, (b) view-frustum froxels, (c) uniform-array only, (d) per-chunk light lists, (e) deferred | **(a)**, with (c) surviving as the hero-cone tier |
| D2 | Point-shadow representation | (a) cube faces in shared atlas + mount-aware face skipping, (b) dual-paraboloid, (c) tetrahedral, (d) per-light cube render targets | **(a)**; (b) rejected on greedy-mesh vertex warp, (c) deferred experiment |
| D3 | Quality tiers & budgets | tier table in `04-benchmarks.md` | approve numbers as starting calibration |
| D4 | Static shadow cache semantics | cache key + invalidation = block edits intersecting light range; entities excluded from cached maps | approve (entities never invalidate static maps) |
| D5 | Integration boundary | game declares block profiles + dynamic sources; engine owns GPU representation, culling, scheduling, caching, rendering | approve |
| D6 | Leak policy | static emitters: flood-field mask by default; dynamic: unmasked by default; held light: hero shadow | approve |
| D7 | `LightCones` fate | keep as-is as the hero-cone tier now; fold behind the unified registry in a later phase | approve deferral |
| D8 | Spend of vertex-light bit 30 | emissive-face flag (the last free bit in the packed vertex attribute) | approve |
| D9 | Rollout | Engine PR A (emissive + registry + clustered layer + debug + benches) → Engine PR B (atlas shadows + ledger) → Town PR (profiles/content) | approve split |

## How to review

Read in order: `01-baseline` (30 min — establishes shared facts), `02-architecture`
(45 min — the design and its alternatives), `03-api` (30 min — what implementers and Town
will actually code against), then skim `04-benchmarks` and `05-rollout` (15 min). Every
"Decision" callout in `02-architecture.md` maps to a row above; comment on the row, not
just the prose.

## Implementation map (Engine PR A)

| Piece | Code |
| --- | --- |
| Emissive vertex bit + strength levels | `crates/mesher/src/mesher/vertex_light.rs` (`EMISSIVE_BIT`, `EMISSIVE_LEVELS`, `ao_or_emissive_bits`), packed in `faces.rs` / `greedy.rs` / `fluid.rs` |
| Block declaration | `server/world/voxels/block/builder.rs` (`emissive`, `face_emissive`), `BlockFace.emissive` on both the server and `voxelize_core` types |
| Registry / handles | `packages/core/src/core/world/local-lights/registry.ts` |
| Profiles + chunk scan + aggregation | `local-lights/scan.ts` |
| Selection + grid + GPU packing | `local-lights/clustering.ts` |
| Shader functions + emissive branch | `local-lights/shader.ts`, composed in `world/shaders.ts` |
| Facade, lifecycle, stats, tiers | `local-lights/index.ts`, wired in `world/index.ts` |
| Debug overlay | `local-lights/debug.ts` |
| Benchmarks | `scripts/bench-local-lights.mjs`, demo scenes in `examples/server/worlds/shared/methods.rs` |
