# Rollout: phased plan, migration, risks

## D9 — the split

Three PRs, strictly ordered, each independently shippable and revertible. No calendar
estimates; scope is defined by files touched and gates passed.

### Engine PR A — analytic layer (no shadow maps)

Touches:

- `crates/mesher`: `EMISSIVE_BIT` (bit 30), emissive merge-key change, scan-extraction of
  `[voxel, blockId, rotation]` emitter lists in the mesh path; vertex-light layout doc +
  overlap test updated (`HIGHEST_ALLOCATED_BIT` 29 → 30).
- `server/world/voxels/block/builder.rs` + block model: `emissive` / `face_emissive`,
  init-JSON passthrough; client `Block` mirror.
- `packages/core` new: `local-lights/` (registry SoA + handles, block profiles, chunk-scan
  diffing, aggregation, world-space grid, selection + hysteresis, data-texture packing,
  `queryLocalLights`, stats, debug overlays 1–3 + bounds/grid/table, context-loss listener
  scoped to light textures).
- `packages/core` edits: chunk shader string composition (cluster uniforms + functions +
  emissive branch), `chunk-materials.ts` bindings, `World.setupComponents`/`update`
  wiring, `world-options.ts` (`localLights` options), `LightShined` + particles
  `queryLocalLights` folding.
- `packages/agent`: `RenderStats.localLights` section.
- `examples/server`: benchmark scenes (S1–S7, S9, S10, S12, S13 seeds); `examples/client`:
  demo toggles.
- Tests: registry/handle unit tests, selection determinism goldens, grid re-bin property
  tests, scan-diff tests, Rust bit-layout tests, benches per `04-benchmarks.md` §6.

Gates: S1–S7, S9, S10, S12, S13 (no shadow gates yet); invariants 1–4, 7–10.

### Engine PR B — shadows + ledger

Touches:

- `packages/core`: shadow atlas (single depth RT, scissored slots), cube-face rendering
  with mount-aware face masks, cached-static slot state machine, `ShadowFrameLedger`,
  CSM's far-cascade rule swapped to ledger grants (behavior-identical when locals absent —
  covered by a CSM regression test on `getDebugState()` traces), shadow sampling in the
  cluster loop, debug views 4–5 + atlas viewer + ledger HUD + invalidation log.
- Deletes `point-light-shadow.ts` (superseded prototype).
- Tests: ledger grant-order tests, cache invalidation tests (block edit AABB), eviction
  hysteresis tests, S8/S11/S14/S15 gates, golden shadow closeups.

Gates: full `04-benchmarks.md` suite; invariants 5–6.

### Town PR — consumer/content (separate repo, after A+B ship in a tagged engine release)

- Profiles for Town's torch/lantern/campfire/lava/window IDs (worked examples in
  `03-api.md` §5 are the template), held-torch + projectile wiring at its existing
  `Arm`/entity attach points, tier selection in its graphics settings, HUD debug toggle.
- Content pass: intensity/temperature tuning per profile against the visual-proof set.
- No engine changes; if the Town PR needs one, it goes back through an engine PR.

## Migration & compatibility

- **No breaking API changes.** All new surface is additive (`world.localLights`, block
  builder methods, options). Existing hosts that ignore it render exactly as today
  (invariants 6–7); the demo gains opt-in toggles only.
- **Doc drift cleanup rides Engine PR A:** `docs/docs/wiki/blocks/block-registry.md` and
  `tutorials/intermediate/12-custom-blocks.md` still show a stale `.is_light/.light_level`
  builder API (`01-baseline.md` §7); they get corrected and extended with profiles +
  emissive when the API lands.
- **`LightCones` (D7):** untouched through A and B. A later PR may re-express cones as
  `shape: "spot"` records behind the same registry with the scatter pass keyed to the hero
  tier — only worth doing once Town migrates its cone callers, hence deferred.
- **Protocol annex (deferred):** a documented entity-metadata key (working name
  `voxelize:light`) so server-driven entities can carry a descriptor; client maps it to
  `add()/setPosition()` on entity create/update/delete. Not needed for v1 — Town can map
  entity types client-side — and not worth freezing bytes for until a second consumer
  asks.

## Risks and their planned answers

| Risk | Answer |
| --- | --- |
| Cell occupancy explodes in pathological builds (light walls) | per-cell overflow policy is deterministic + counted (`overflowCells`); S5/S7 gate it; froxels (D1-b) documented as the fallback representation |
| Uniform/texture-unit pressure on old drivers | ≤ +3 units budgeted (invariant 8); matrices in texels not uniforms; verified on min-spec in Engine PR A CI |
| Flood-mask halo reads as wrong on thin walls | mask knee is per-tier tunable; golden S2 both sides of the wall; fallback per profile is `shadowPolicy: "shadowMap"` for the few lights where it matters |
| Ledger starves CSM in torch-dense scenes | CSM near cascade is priority 1 and cannot be preempted; S11 gates identical CSM debug traces |
| Scan cost on remesh regresses mesh latency | scan shares the mesher's existing voxel traversal; gate: ≤ 10 % section time (S7); measured in the mesh-worker timings that already exist |
| Emissive bit spends the last vertex bit (D8) | acknowledged — it is the highest-value single-bit feature identified; anything needing more bits later must move to a second attribute anyway, which is unaffected by spending bit 30 now |
| Atlas thrash under camera orbit around many shadow-worthy lights | eviction hysteresis (25 % / 30 frames) + S14 soak gate on evictions/minute |
| WebGL context loss paths untested in engine at all | scoped listeners land with the feature (S15 gate); the engine-wide gap is flagged separately rather than silently absorbed here |

## Decision recap for sign-off

- D1 world-space clustered forward (§2, `02-architecture.md`)
- D2 cube-faces-in-atlas + mount-aware skipping (§6)
- D3 tier/budget numbers (`04-benchmarks.md` §4)
- D4 static cache semantics: block-edit invalidation only; entities excluded (§6)
- D5 boundary: game declares, engine owns (§9)
- D6 leak policy: static mask / dynamic none / held shadow (§5)
- D7 `LightCones` deferred fold
- D8 bit 30 = emissive
- D9 this rollout split

Approval of all nine unblocks Engine PR A.
