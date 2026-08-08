# Baseline: how Voxelize lights a world today

Everything in this document is an audited fact of the current tree (`main` at the time of
writing), with file references. The design in `02-architecture.md` is built on these facts;
if a fact is wrong, the design review should start there.

## 1. The voxel light field (CPU, authoritative, already shipped)

The engine's only local-light mechanism today is the flood-filled voxel light field.

**Representation.** Each voxel stores one `u32` light word; only the low 16 bits are used —
four 4-bit channels, levels 0–15:

```text
bits 15..12  sunlight
bits 11..8   red torch light
bits  7..4   green torch light
bits  3..0   blue torch light
```

Symbols: `LightUtils::{extract,insert}_{sunlight,red_light,green_light,blue_light}` in
`crates/core/src/light.rs`, mirrored 1:1 in `packages/core/src/utils/light-utils.ts`.
Chunk storage: `Chunk.lights: Arc<Ndarray<u32>>` shaped `[chunk_size, max_height,
chunk_size]` (`server/world/voxels/chunk.rs`). Defaults (`server/world/config.rs`):
`chunk_size = 16`, `max_height = 256`, `sub_chunks = 8` (32-block sections),
`max_light_level = 15` (builder asserts `< 16`).

**Emission declaration.** Blocks declare emission server-side
(`server/world/voxels/block/mod.rs`): `red_light_level` / `green_light_level` /
`blue_light_level: u32`, plus `light_attenuation: u8` (Beer-Lambert optical density: 0 air,
1 leaves-scale, 2 water-scale). `is_light` is *derived* in `BlockBuilder::build()` when any
channel > 0. Builder methods: `red_light_level(..)`, `green_light_level(..)`,
`blue_light_level(..)`, `torch_light_level(..)` (all three), `light_attenuation(..)`,
`light_reduce(..)`. The client receives these fields in the join payload and re-derives
`isLight` (`World.initialize`, `packages/core/src/core/world/index.ts`). Conditional/dynamic
block patterns can override emission per-position (`BlockConditionalPart.red_light_level`
etc., surfaced through `LightPassInfo.has_dynamic_light` in `server/world/registry.rs`).

**Propagation.** BFS flood over 6-neighborhoods (`Lights` in
`server/world/generators/lights.rs`): sunlight floods downward at full strength through
air, torch channels decay by 1 per step or by Beer-Lambert transmittance (`222/256` per
attenuation unit) through attenuating media; face-pair transparency gates entry
(`can_enter`). Removal is the classic reverse-BFS with fringe re-flood (`remove_light`,
batch `remove_lights`). Block updates run the **three-pass system** documented in
`notes/three_pass_lighting.md` (apply topology → batch-remove dead light → re-evaluate and
flood once), implemented in `server/world/systems/chunk/updating.rs`, budget
`max_updates_per_tick = 50 000`.

**Client mirror.** The client runs the same algorithms for immediacy
(`packages/core/src/core/world/lighting.ts`, off-thread in
`workers/light-worker.ts`): defaults `useLightWorkers: true`, `maxLightWorkers: 4`,
`maxLightsUpdateTime: 5` ms analysis budget per frame
(`packages/core/src/core/world/world-options.ts`). Server `Update` packets echo the
authoritative per-voxel `light` word (`messages.proto`); full chunk light arrays arrive
lz4-compressed in chunk `LOAD` packets. **Lights are never persisted** — recomputed on
chunk load (`server/world/voxels/background_chunk_saver.rs` stores voxels + height map
only).

**Meshing.** The mesher bakes smooth per-vertex light + AO into one signed-int vertex
attribute. The bit map lives in `crates/mesher/src/mesher/vertex_light.rs` and is mirrored
in the shader (`packages/core/src/core/world/shaders.ts`):

```text
bits  0..=15  light, four nibbles: red, green, blue, sunlight
bits 16..=17  ambient occlusion, 0..=3
bit  18       fluid
bit  19       emitted by the greedy path
bit  20       surface that should wave
bit  21       in contact with fluid
bits 22..=25  stack index
bits 26..=29  stack count (length − 1)
bit  30       ── unallocated ──
bit  31       sign; must stay clear
```

Per-vertex light averages the un-occluded samples of the 2×2×2 corner neighborhood
(`compute_face_ao_and_light`, `crates/mesher/src/mesher/lighting.rs`); see-through blocks
sample their center voxel. **Exactly one bit (30) remains free.**

**Shading.** The chunk fragment shader (`shaders.ts`) unpacks `vLight` (rgb = torch,
a = sun exposure) and combines:

```glsl
sunContribution = uSunColor * NdotL * csmShadow * uSunlightIntensity * sunExposure;
smoothTorch     = t*t*(3-2t);            // t = vLight.rgb
torchLight      = smoothTorch * 1.2;
totalLight      = 1 - (1-sunTotal) * (1-torchLight);   // screen blend
totalLight      = 1 - (1-totalLight) * (1-coneLight);  // dynamic cones
totalLight     *= temperatureShift(torchDominance);    // warm/cool tint
totalLight      = acesish(totalLight);                 // tonemap curve
```

Water optics (Beer-Lambert downwelling, refraction, fresnel), height fog, and sky fog are
all forward, in this same shader. Specular exists **only on fluids** (sun Blinn-ish
highlight). There is no emissive path for chunk faces — a lava texture at night is lit by
its own flood light only, then tonemapped down.

### What the flood field already buys us

- **Occlusion-correct diffuse.** BFS respects opacity: torch light does not leak through a
  wall. For static emitters this is a free occlusion oracle at voxel resolution.
- **Unlimited emitter count.** A 10 000-voxel lava lake costs zero per frame at render
  time — its light is baked into vertices; the cost was paid once at generation/edit time.
- **Colored, attenuated, water-aware, synced.** Server/client symmetric, incremental,
  worker-offloaded.

### What it cannot do

- No directionality (no N·L response — walls facing away from a torch are as bright as
  walls facing it), no specular, no per-pixel falloff (vertex-interpolated nibbles), 16
  quantization levels, ~15-block max reach.
- **Static only.** Moving a light means reflood + remesh of every touched chunk section —
  milliseconds of worker time and mesh uploads per step. Unusable for held lights or
  projectiles at 60 fps. (This is why held-light flood injection is rejected in D6:
  the flood cost is fine, the remesh storm is not.)
- No shadows from dynamic occluders (entities standing in torch light cast nothing).

## 2. Sunlight CSM (client, shipped)

`CSMRenderer` (`packages/core/src/core/world/csm-renderer.ts`) is a custom 3-cascade
implementation, **not** three.js's CSM. World instantiates it with near map 4096², far maps
2048², `maxShadowDistance: 128` (`World.setupComponents`; the second construction inside
`initialize()` is dead code — it is guarded by `if (!this.csmRenderer)` which is always
false).

Invalidation machinery that already exists and must be respected:

- **Camera-still detection** (position epsilon + view-projection matrix epsilon) skips all
  cascade re-renders when nothing moved.
- **Light-swing skip**: during the dusk sun→moon handoff the direction swings too fast to
  be worth tracking; re-renders are suppressed and drain on the first calm frame.
- **Shadow-strength floor** (`shadowStrengthRenderFloor: 0.15`): invisible shadows are
  never rendered.
- **One far cascade per frame**: a remesh marks all cascades, but far cascades drain one
  per frame to avoid a double-length frame.
- **Entity refresh interval** (`entityShadowFrameInterval: 3`, near cascade only, within
  `ENTITY_SHADOW_DISTANCE = 32`).

Depth pass rules (the "caster/material rules" local lights must stay coherent with):

- `scene.overrideMaterial = MeshDepthMaterial` (no alpha test → cutout foliage casts
  solid-quad shadows; accepted today).
- `material.userData.skipShadow === true` objects are hidden during the pass. Assignments
  today (`chunk-materials.ts`): fluids and non-attenuating transparents (glass) skip;
  the shared cutout bucket casts; the shared cutout **plant** bucket skips.
- Instanced entity pools swap to `customDepthMaterial` where present.

Uniform flow: `World.updateShaderLighting(camera, position)` computes sun/moon direction
and `shadowStrength` from world time (day 1.0, moon 0.6, dusk dip toward 0), calls
`csmRenderer.update(...)`, and copies `csmRenderer.getUniforms()` into
`ChunkRenderer.shaderLightingUniforms` — whose uniform *objects* are shared by reference
into every chunk material (`makeChunkShaderMaterial`, `chunk-materials.ts`), so updates are
zero-copy. `World.renderShadowMaps(renderer, entities?, instancePools?)` runs the depth
passes. **Neither is called anywhere in this repo** — the demo does not drive CSM; the
production consumer (Town) drives the frame loop host-side. Chunk remeshes call
`csmRenderer.markAllCascadesForRender()` (`buildChunkMeshTimed`).

## 3. Dynamic light primitives that already exist

**`LightCones`** (`packages/core/src/core/world/light-cones.ts`): 8 spot cones max, packed
into uniform arrays (`uConeOrigins/Directions/Colors/Shapes`), refilled every frame by the
game (`beginFrame()` + `pushCone(...)`), evaluated in a fixed shader loop with early break,
including quadratic angular/distance falloff, wrap Lambert, per-cone water extinction, and
a 4-sample volumetric in-scatter pass after fog. Bound to **chunk materials only**. No
shadows, no culling help, no point shape, farthest-first dropping is the game's job. No
in-repo caller (Town-facing API). This is the proven in-house pattern for "analytic lights
in uniform arrays."

**`PointLightShadowRenderer`** (`point-light-shadow.ts`): a single-light cube-camera shadow
prototype (512² cube RT, RGBA-packed depth, PCF GLSL snippets exported as strings). **Dead
code** — not exported from the world index, zero usages. It answers one question: cube
shadows were prototyped and never productized. The atlas design in `02-architecture.md`
supersedes it; the file should be deleted in Engine PR B.

**`LightShined`** (`packages/core/src/libs/effects/light-shined.ts`): CPU per-object voxel
light sampling for entities/held items — reads `world.getLightValuesAt` at the object's
voxel, lerps a `lightEffect` uniform injected into the object's materials. Used by
characters, bots, drops, and the first-person arm. This is the entity-side consumer any
analytic layer must feed too.

**Particles** (`packages/particles/src/block-light.ts`): CPU tint per particle from voxel
light (`computeBlockLightColor`, `computeVoxelLightColor`).

**`VoxelOpacityVolume`** (`voxel-opacity-volume.ts`): an orphaned experiment (player-
centered `Data3DTexture` of voxel opacity; not exported, zero consumers). Noted because it
is prior art for "GPU-visible voxel occlusion" — deliberately *not* revived by this design
(the flood field already encodes occlusion in a cheaper, already-interpolated form).

**Item renderer** (`items/renderer.ts`): held/drop item meshes use `MeshBasicMaterial` —
no CSM, no cones. Lighting comes via `LightShined`/arm-held lighting.

## 4. Materials and shader architecture constraints

- **Shared materials.** All opaque chunk geometry world-wide renders with *one* shared
  `ShaderMaterial` (`SHARED_OPAQUE_MATERIAL_KEY`), plus shared cutout buckets and per-id
  materials for special blocks (`chunk-materials.ts`). Per-mesh uniform values are
  therefore not available without breaking material sharing or patching uniforms per draw
  call in `onBeforeRender` — i.e. **per-chunk light lists are architecturally hostile**.
- **WebGL2 is guaranteed.** three `^0.183` is WebGL2-only, and the chunk shader already
  uses ESSL 3.00 features (`attribute int light`, `textureSize()`). `texelFetch` and
  integer textures are available. No float *render targets* are needed by this design, so
  no extension dependencies; data textures are sampled with `texelFetch` (no filtering
  requirement).
- **Uniform budget is already heavy.** Chunk materials carry ~70 uniforms including 3
  shadow maps and 3 mat4s. WebGL2 guarantees only 224 fragment uniform vectors; adding
  per-light mat4 arrays (e.g. 24 mat4 = 96 vec4) is risky — light data belongs in
  textures.
- **Texture units:** chunk materials bind ~6 today (atlas map, 3 CSM maps, scene color,
  plus three.js bookkeeping); WebGL2 guarantees 16 per fragment stage. Budget for local
  lights: ≤ 3 more.
- **Greedy meshing produces huge triangles** (`crates/mesher/src/mesher/greedy.rs`).
  Any shadow projection requiring per-vertex nonlinear warp (dual-paraboloid) will bend
  large quads incorrectly. Only linear (perspective/ortho) projections are safe.
- **Shader source is string-composed per material bucket** at startup; there is no
  per-source specialization anywhere, and none may be introduced (invariant 3).

## 5. Perf/stats surface

- `@voxelize/agent` exposes `RenderStats` over HTTP (`packages/agent/src/bridge.ts`):
  `drawCalls`, `shadowDrawCalls` (cascade fills), `triangles`, program/geometry/texture
  counts, chunk visibility, mesh-apply stats. This is the benchmark harness's data source.
- `World.getMemoryCounters()`, `World.meshApplyStats`, `[PERF]` structured console logging
  (`packages/core/src/core/perf.ts`), and `@voxelize/debug` (status bar, FPS meter, frame
  sampler) exist; there are **no lighting-specific stats or overlays** today beyond
  `uShadowDebugMode` modes (shadow factor, NdotL, AO, cascade tint, bias, sun exposure).

## 6. Lifecycle surface

- Chunk events: `chunk-data-loaded`, `chunk-mesh-loaded/-unloaded/-updated`,
  `chunk-loaded/-unloaded/-updated` via `world.on(...)`; one-shot
  `addChunkInitListener(coords, cb)`; block updates via `addBlockUpdateListener`.
- Render distance: `world.renderRadius` setter (delete radius = 1.1×, fog follows).
- World switch: `Network.join/leave`; re-INIT triggers `resyncChunkStagesAfterRejoin()`;
  full teardown is `World.dispose()`. There is no `World.reset()`.
- **No WebGL context-loss handling anywhere** (`webglcontextlost`/`restored`: zero
  matches). A design gap this RFC's lifecycle section must close for its own GPU state,
  and flag for the engine generally.
- **No quality tiers.** Lighting/shadow knobs are flat world options; CSM sizes are
  hardcoded in `World.setupComponents`.

## 7. What Town does today (as visible from this repo)

Town's source is not in this repo; its usage is visible through the engine surface it
drives and the docs/READMEs that reference it (`README.md` "Town, a production world built
on Voxelize", `docs/AGENT.md`, agent package `TOWN_PERF_*` hooks).

- Placed light sources are **blocks with `torch_light_level`/channel levels** (the demo
  registers Obsidian 15/15/15, Andesite green 10, Slate blue 10, Mushroom 15;
  `examples/server/registry.rs`). Town's torches/lanterns are the same mechanism with its
  own block IDs.
- Entities/held items are lit by `LightShined`; first/third-person held meshes attach via
  `Arm.setArmObject` / `Character.setArmHoldingObject` — holding a glowing block mesh emits
  **no** light today.
- `LightCones` is the engine API designed for Town's flashlights/headlights (per its
  doc comments); the host fills it per frame.
- The host drives `updateShaderLighting` → `renderShadowMaps` in its own render loop.

## 8. Baseline summary table

| Concern | Today | Gap for local lights |
| --- | --- | --- |
| Placed emitter diffuse | voxel flood, baked, unlimited count | no N·L, no specular, no per-pixel falloff |
| Source glow | none (lit like any face) | emissive faces missing |
| Moving lights | none (flood too slow to move) | analytic layer missing |
| Spot lights | `LightCones`, 8, no shadow | point shape, culling, budget integration |
| Local shadows | dead prototype only | atlas + caching + scheduling missing |
| Sun shadows | CSM, well-invalidated, host-driven | must share a frame budget with locals |
| Entities/particles | CPU voxel sampling | must also see analytic lights |
| Stats/debug | agent RenderStats, shadow debug modes | no light overlays/metrics |
| Quality tiers | none | required for mobile/low-end |
| Context loss | unhandled | must be specified for new GPU state |
