# API: types, lifecycle guarantees, worked examples

Everything here is the contract Town codes against. Engine PR A and PR B implement it
as written apart from the **[implemented]** notes below; the shadow-facing surface
(`shadowMap` honoring, `invalidateShadowRegion(min, max)`, atlas/tier options, the
`ShadowFrameLedger`) is live as of Engine PR B. PR B also derives each emitter's
default anchor from its declared emissive faces (a torch lights from its tip, rotating
with the block); `BlockLightProfile.offset` overrides it. The authoritative signatures
live in `packages/core/src/core/world/local-lights/`.

## 1. TypeScript surface (`@voxelize/core`)

### 1.1 Handles

```ts
/**
 * Stable identity of a registered light source. Packed `index:20 | generation:12`;
 * `0` is the invalid handle. Handles are plain numbers: storable, comparable,
 * serializable, allocation-free.
 */
export type LightHandle = number;

export const INVALID_LIGHT_HANDLE: LightHandle = 0;
```

Guarantees: a handle is valid from `add()`/scan-registration until the matching removal;
every accessor generation-checks and treats a stale handle as a no-op returning
`false`/`undefined` (plus a dev-mode warning). Handles are never reused until the
generation wraps (4096 lifetimes per slot).

### 1.2 Source descriptors

```ts
export type LightShape = "point" | "spot" | "capsule";

export type LightShadowPolicy =
  | "none"        // analytic only; may leak through occluders
  | "voxelMask"   // masked by the baked flood field (static sources only)
  | "shadowMap";  // requests an atlas slot; granted by budget + importance

export interface FlickerProfile {
  /** Hz of the primary intensity wobble. */
  speed: number;
  /** 0..1 fraction of intensity the wobble spans. */
  amplitude: number;
}
// [implemented] Flicker is evaluated in the shader (two detuned sines over uTime,
// phase derived deterministically from the slot) so it costs no CPU and no uploads.
// The RFC's named style presets collapsed into (speed, amplitude) pairs.

export interface LocalLightDescriptor {
  shape: LightShape;
  /** Linear RGB. Exactly one of `color` | `colorTemperatureK` must be set. */
  color?: [number, number, number];
  /** Kelvin, converted once at registration (1800K torch .. 6500K daylight). */
  colorTemperatureK?: number;
  /** Peak contribution in tonemapped-scene-relative units; 1.0 ≈ full torch. */
  intensity: number;
  /** Hard cutoff in blocks; falloff reaches exactly 0 here (no popping). */
  range: number;
  /**
   * Static sources are cacheable (shadow maps) and maskable (flood mask), and
   * assert that `setPosition` will not be called on them.
   */
  isStatic: boolean;
  shadowPolicy: LightShadowPolicy;
  /** Spot only. */
  direction?: [number, number, number];
  angleDeg?: number;        // full outer angle
  innerRatio?: number;      // inner full-brightness cone as fraction of outer
  /** Capsule only: second endpoint relative to position (lava runs, light strips). */
  endOffset?: [number, number, number];
  /** Multiplies L2 contribution to tune against the L0 flood base. Default 0.6. */
  analyticShare?: number;
  flicker?: FlickerProfile;
  /** 0..1 volumetric scatter hint; only honored for hero-cone-tier sources in v1. */
  volumetric?: number;
  /** Additive selection-score bias for gameplay-critical lights. Default 0. */
  priorityBias?: number;
}
```

### 1.3 Block profiles (bulk/static registration)

```ts
/**
 * Declared by the game per *its own* block id. When none is declared, the engine
 * derives a default from the block's flood light levels — point shape, color =
 * normalized RGB levels, range = max channel level, static, `voxelMask` — so
 * unconfigured emitter blocks still work.
 */
export interface BlockLightProfile
  extends Partial<Omit<LocalLightDescriptor, "isStatic">> {
  /** Emitter origin within the voxel, e.g. a torch head. Default [0.5, 0.5, 0.5]. */
  offset?: [number, number, number];
  // Engine PR B adds mountAware (mount-derived shadow-face skipping).
  /** Collapse dense same-profile emitters into per-section proxies. Default "cluster". */
  aggregation?: "none" | "cluster";
  aggregateThreshold?: number;   // default 8 per section
  maxProxiesPerSection?: number; // default 4
}
```

L1 emissive faces are deliberately **not** part of the profile: they must be visible to
the mesher in both meshing modes (client wasm and server-side), so they are declared with
the block itself, server-side (§2) — the same place faces and flood levels live. Profile =
how the renderer treats the *analytic* light; block = what the block *is*.

### 1.4 The facade

```ts
export type LightQualityTier = "ultra" | "high" | "medium" | "low" | "potato";

export interface LocalLightsOptions {
  maxRegisteredLights: number;     // 4096
  maxClusteredLights: number;      // per tier; see 04-benchmarks.md
  maxLightsPerCell: number;        // 8
  analyticRadius: number;          // 64 (blocks)
  gridCellSize: number;            // 8 (blocks)
  maxShadowedLights: number;       // ≤ 4
  shadowAtlasSize: number;         // 2048
  shadowSlotSize: number;          // 256
  shadowLedgerUnitsPerFrame: number; // 12
  selectionIntervalFrames: number; // 1 (amortize selection when > 1)
  shadowEvictionHysteresis: { ratio: number; frames: number }; // 1.25 / 30
}

export class LocalLights {
  /** Declare/replace the profile for a game block id (or name). Idempotent. */
  setBlockProfile(block: number | string, profile: BlockLightProfile): void;
  clearBlockProfile(block: number | string): void;

  /** Dynamic sources. `add` copies the descriptor into pooled SoA; no retention. */
  add(descriptor: LocalLightDescriptor, position: Vector3): LightHandle;
  remove(handle: LightHandle): boolean;

  /** Mutators: in-place SoA writes, valid every frame, zero allocation. */
  setPosition(handle: LightHandle, position: Vector3): boolean;   // dynamic only
  setDirection(handle: LightHandle, direction: Vector3): boolean; // spot only
  setIntensity(handle: LightHandle, intensity: number): boolean;
  setColor(handle: LightHandle, color: [number, number, number]): boolean;
  setRange(handle: LightHandle, range: number): boolean;          // re-bins cells
  setEnabled(handle: LightHandle, isEnabled: boolean): boolean;

  /**
   * CPU query over the same SoA for entities/particles/items. Zero alloc
   * (per-frame callers reuse one options scratch object); each selected
   * light contributes within its own range. `floodMask` is the caller's
   * knee-mapped flood level (occlusion stand-in), `timeMs` drives flicker.
   */
  queryLocalLights(
    position: Vector3,
    out: LocalLightSample,
    options?: { floodMask?: number; timeMs?: number },
  ): void;

  setQualityTier(tier: LightQualityTier): void;
  getQualityTier(): LightQualityTier;

  /** 0 off, 1 cell-occupancy heatmap, 2 isolated contribution, 3 leak mask. */
  setDebugMode(mode: 0 | 1 | 2 | 3): void;
  getDebugMode(): number;
  /** Instanced wireframe range spheres of the clustered set. */
  showDebugOverlay(parent: Object3D): void;
  hideDebugOverlay(): void;

  /** Re-upload GPU textures after `webglcontextrestored`; CPU state is truth. */
  onContextRestored(): void;
  /** Start a fresh peak-cost window (benchmark harnesses). */
  resetPeakStats(): void;

  readonly stats: LocalLightStats;    // see local-lights/types.ts
}
// Engine PR B adds: invalidateShadowRegion(min: Vector3, max: Vector3),
// forwarding to the scheduler's named-args form:
//   shadows.invalidateRegion({ min: [x, y, z], max: [x, y, z] }).

export interface LocalLightSample {
  /** Combined linear RGB arriving at the query point. */
  color: [number, number, number];
  /** Lights that contributed. */
  count: number;
}
```

`World` additions:

```ts
class World {
  public localLights: LocalLights;                       // constructed in setupComponents
  // WorldClientOptions gains: localLights?: Partial<LocalLightsOptions>
}
```

### 1.5 Frame integration (host loop — Town's render loop today)

```ts
world.update(position, direction, camera);       // unchanged; internally runs
                                                 // localLights selection/pack after
                                                 // chunk maintenance (no new host call)
world.updateShaderLighting(camera, position);    // unchanged signature; also refreshes
                                                 // local-light uniforms (grid origin)
world.renderShadowMaps(renderer, entities, pools); // unchanged signature; internally:
                                                 // ledger.beginFrame() → CSM + atlas
```

Deliberate: **no new required host calls.** Hosts that never touch `localLights` get
today's behavior (invariant 6/7).

## 2. Rust surface (server + mesher)

Server changes are additive and tiny — emission is already server-declared.

```rust
// server/world/voxels/block/builder.rs — additions
impl BlockBuilder {
    /// L1: all faces render emissive at `strength` (0.0..=4.0, tonemap-relative).
    pub fn emissive(mut self, strength: f32) -> Self;
    /// L1 per-face override, matching the face-name scheme used by `faces`.
    pub fn face_emissive(mut self, face_name: &str, strength: f32) -> Self;
}
// Block gains `emissive_faces: Vec<(String, f32)>` (empty = none), serialized in the
// init JSON like every other block field; client `Block` mirrors it.
```

```rust
// crates/mesher/src/mesher/vertex_light.rs — the last free bit
pub const EMISSIVE_BIT: i32 = 1 << 30;
pub const HIGHEST_ALLOCATED_BIT: i32 = 30; // was 29
// faces.rs / greedy.rs OR the bit in when the face's block declares emissive.
// The greedy merge key gains the bit (and the strength index below), so emissive
// and non-emissive faces of the same texture never merge.
```

**Emissive strength without new bits or split materials.** An emissive face bypasses the
lighting model, so it has no use for its ambient-occlusion value — under `EMISSIVE_BIT`,
the two AO bits (16–17) are reinterpreted as a 2-bit **strength index** into a 4-entry
uniform table (`uEmissiveLevels: vec4`, world-level, default `[1.0, 1.75, 2.5, 3.5]`).
Declared strengths quantize to the nearest table entry at registration (dev warning on
lossy quantization; the table is a world option for games that need different anchors).
This keeps every emissive face in its existing shared material bucket — no per-strength
materials, no extra draw calls, no third vertex attribute — at the cost of 4 distinct
strength levels per world, which the worked examples in §5 fit comfortably. Blocks that
truly need an exact off-table strength use the existing per-id custom-material escape
hatch (`customizeMaterialShaders`).

No protocol (`messages.proto`) changes in v1. The optional entity-light metadata
convention is documented in `05-rollout.md` as deferred.

## 3. Shader-facing interface (GLSL, chunk materials)

```glsl
// ── uniforms added to every chunk material (bound once, shared by reference) ──
uniform highp usampler2D uLightGrid;    // R8UI  (cellCount × maxLightsPerCell)
uniform sampler2D  uLightData;          // RGBA32F (4 texels per record × capacity)
uniform sampler2D  uLocalShadowAtlas;   // depth texture (shared atlas)
uniform vec3  uLightGridOrigin;         // world min corner of the scrolled window
uniform vec3  uLightGridDims;           // cells per axis
uniform float uLightGridCellSize;       // 8.0
uniform int   uClusteredLightCount;     // 0 disables the loop entirely (potato tier)
uniform float uLocalLightDebugMode;     // §5 of 04-benchmarks.md

// ── functions (composed into the fragment string next to LIGHT_CONES_FUNCTIONS) ──
vec3 clusteredLocalLight(vec3 worldPos, vec3 normal, vec3 floodRgb);
vec3 clusteredLocalSpecular(vec3 worldPos, vec3 normal, vec3 viewDir); // fluid variant only
float sampleLocalShadow(int lightIndex, vec3 worldPos);               // atlas compare
```

Compile-time constants (per material bucket, fixed at startup — not per source):
`MAX_LIGHTS_PER_CELL` (8), `MASK_KNEE` (2.0/15.0); empty grid slots are value `0`
(index + 1 encoding). Shadow matrices live in `uLightData` texels (no mat4 uniform
arrays — uniform budget, `01-baseline.md` §4). The emissive path reads bit 30 and the
reused AO bits:

```glsl
// vertex — alongside the existing unpack:
int isEmissive = (light >> 30) & 0x1;
// when emissive, bits 16..17 are the strength index, not AO (see §2):
vEmissive = float(isEmissive) * uEmissiveLevels[(light >> AO_SHIFT) & AO_BITS];
// fragment:
if (vEmissive > 0.0) { outgoingLight = diffuseColor.rgb * vEmissive; }  // still fogged + tonemapped
```

## 4. Lifecycle guarantees

| Event | Guaranteed behavior |
| --- | --- |
| `add()` | Handle valid immediately; light selectable next selection pass (≤ `selectionIntervalFrames`). Fails (returns `INVALID_LIGHT_HANDLE`, dev warn) only when the pool is exhausted. |
| `remove()` | Contribution gone next packed frame; atlas slot freed; stale handle ops become no-ops. Double-remove is a no-op returning `false`. |
| Chunk data loaded / remeshed | Mesh-worker scan diffs the section's emitter set; registrations carry the section key. Remesh that doesn't change emitters changes nothing (stable handles — no shadow/selection churn). |
| Chunk unloaded | All section-keyed registrations released, atlas slots freed, cells cleaned — same frame as `chunk-unloaded`. |
| Block place/break | Rides the same update stream as the flood relight: emitter add/remove is atomic with L0's change. Cached shadow maps whose range intersects the edit are invalidated (ledger re-renders over subsequent frames). |
| Moving light (`setPosition`) | Old ∪ new overlapped cells dirtied; O(cells), no allocation. Static handles reject it (`false` + dev warn). |
| Teleport / render-distance change | Falls out of chunk load/unload — no special path. Selection hysteresis resets when the camera jumps > `analyticRadius` in one frame (prevents dragging stale selections across the map). |
| World switch / reconnect | `World.dispose()` releases everything (pools, textures, atlas). Re-INIT resync (`resyncChunkStagesAfterRejoin`) re-scans arriving chunks — registry rebuilds from the same events as first join. |
| Quality-tier change | Textures/atlas reallocated; cached maps invalidated; **no shader recompile**; handles and registrations untouched. |
| GPU context loss | CPU SoA is the source of truth; on `webglcontextrestored`, data/grid textures re-upload and atlas slots mark `invalid` (lazy re-render through the ledger). The engine currently has **no** context-loss handling (`01-baseline.md` §6); Engine PR A adds the listener pair scoped to light GPU state and flags the wider gap. |
| `dispose()` | Idempotent; all GPU resources freed; subsequent calls on the facade are no-ops with dev warnings. |
| Determinism | Selection and per-cell overflow are pure functions of (registry state, camera cell, frame index for amortized phases); ties break on handle order. Two clients with identical state select identically — required by the golden tests in `04-benchmarks.md`. |
| Threading | All facade methods are main-thread. The scan runs in mesh workers and lands via the existing mesh-result path; no locks. |

## 5. Worked examples (Town-side, illustrative — not Town code)

Server side, where Town already registers its blocks — flood levels (existing API) plus
the new emissive declarations:

```rust
Block::new("torch").id(TORCH)
    .red_light_level(14).green_light_level(9).blue_light_level(2)   // existing flood
    .face_emissive("flame", 2.5)                                    // new: the flame glows
    .build(),
Block::new("lantern").id(LANTERN)
    .torch_light_level(12)
    .face_emissive("glass", 1.75)
    .build(),
Block::new("campfire").id(CAMPFIRE)
    .red_light_level(15).green_light_level(10).blue_light_level(3)
    .face_emissive("embers", 3.5)
    .build(),
Block::new("lava").id(LAVA)
    .red_light_level(15).green_light_level(8)
    .emissive(3.5)                                                  // whole surface glows
    .build(),
Block::new("lit_window").id(LIT_WINDOW)
    .torch_light_level(6)
    .emissive(1.75)
    .build(),
```

Client side, once at world init — the analytic profiles:

```ts
// Torch: warm point at the flame, flickering, flood-masked, wall-mount aware.
world.localLights.setBlockProfile(TOWN_BLOCKS.TORCH, {
  shape: "point",
  colorTemperatureK: 1900,
  intensity: 1.0,
  range: 12,
  offset: [0.5, 0.7, 0.5],
  shadowPolicy: "voxelMask",
  flicker: { speed: 9, amplitude: 0.12 },
});

// Lantern: steadier, cooler, slightly longer reach; eligible for a cached shadow
// slot when important enough (hanging lantern over a doorway).
world.localLights.setBlockProfile(TOWN_BLOCKS.LANTERN, {
  shape: "point",
  colorTemperatureK: 2700,
  intensity: 1.1,
  range: 14,
  shadowPolicy: "shadowMap",       // request, not entitlement — budget decides
  flicker: { speed: 0.5, amplitude: 0.04 },
});

// Campfire: bigger, hero-shadow candidate, strong flicker, slight volumetric hint.
world.localLights.setBlockProfile(TOWN_BLOCKS.CAMPFIRE, {
  shape: "point",
  colorTemperatureK: 1700,
  intensity: 1.6,
  range: 18,
  offset: [0.5, 0.4, 0.5],
  shadowPolicy: "shadowMap",
  priorityBias: 0.5,
  flicker: { speed: 6, amplitude: 0.25 },
  volumetric: 0.15,
});

// Lava: emissive surface + flood does the heavy lifting; analytic proxies are
// aggregated per section so a lake is ~4 records per section, not 10,000 total.
world.localLights.setBlockProfile(TOWN_BLOCKS.LAVA, {
  shape: "point",
  colorTemperatureK: 1400,
  intensity: 0.8,
  range: 10,
  analyticShare: 0.35,             // flood already carries most of the glow
  shadowPolicy: "none",
  aggregation: "cluster",
  aggregateThreshold: 6,
  maxProxiesPerSection: 4,
});

// Glowing window (night): mostly the emissive face + faint interior spill.
world.localLights.setBlockProfile(TOWN_BLOCKS.LIT_WINDOW, {
  shape: "point",
  colorTemperatureK: 3200,
  intensity: 0.4,
  range: 6,
  shadowPolicy: "none",
});
```

Dynamic sources at play time:

```ts
// Held torch: dynamic, follows the hand, hero-shadow request. One handle for the
// session; position updated every frame — no add/remove churn.
const heldTorch = world.localLights.add(
  {
    shape: "point",
    colorTemperatureK: 1900,
    intensity: 1.2,
    range: 14,
    isStatic: false,
    shadowPolicy: "shadowMap",
    priorityBias: 2.0,             // the player's own light wins ties
    flicker: { speed: 9, amplitude: 0.1 },
  },
  handWorldPosition,
);
// per frame:
world.localLights.setPosition(heldTorch, handWorldPosition);
// on unequip:
world.localLights.setEnabled(heldTorch, false);   // keep the handle, skip re-adds

// Fast projectile (fire arrow): short-range, unmasked, never shadowed, pooled by
// the game exactly like its projectile entities.
const arrowLight = world.localLights.add(
  {
    shape: "point",
    color: [1.0, 0.55, 0.2],
    intensity: 0.7,
    range: 6,
    isStatic: false,
    shadowPolicy: "none",
  },
  arrow.position,
);
// per tick: world.localLights.setPosition(arrowLight, arrow.position);
// on impact: world.localLights.remove(arrowLight);
```

Entity/particle consumption (unchanged pattern, richer data):

```ts
const sample: LocalLightSample = { color: [0, 0, 0], count: 0 };
const options = { floodMask: 1, timeMs: 0 }; // scratch, reused per frame
world.localLights.queryLocalLights(npc.position, sample, options);
// LightShined folds `sample.color` into its existing voxel-light term.
```
