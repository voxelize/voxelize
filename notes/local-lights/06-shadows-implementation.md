# Engine PR B: shadow implementation — decisions, tradeoffs, measurements

Status: **implemented** (this PR). `02-architecture.md` §6 fixed the *shape* of the
L3 tier — cube faces in one shared atlas, cached static maps, a frame ledger shared
with CSM (decisions D2/D4). This document records the implementation-level decisions
inside that shape, the alternatives each one displaced, and what was measured. Where
behavior deviates from the RFC prose, the deviation is called out inline; the code is
the source of truth.

## I1 — Dynamic casters: split static/dynamic cells, not re-rendered maps

The acceptance bar for this PR includes entity shadows: a pig standing between a lamp
and a wall must block the light and drag a moving shadow. D4 forbids the naive answer
(entities invalidate cached maps → every intersected light re-renders world geometry
every frame an entity moves).

| Option | Cost profile | Verdict |
| --- | --- | --- |
| (a) Entities invalidate static maps | world redraw × lights × every frame an entity moves | Rejected by D4 — the exact explosion the cache exists to prevent |
| (b) Separate per-frame *overlay* cells holding only entity depth, combined at sample time | entity-only depth (a few hundred triangles) × faces actually containing an entity; 2nd atlas tap per shadowed light | **Implemented** |
| (c) No entity shadows from local lights | zero | Rejected by the acceptance bar; also the visible gap Town asked about first |

(b) is the industry-standard cached-shadow composition: Unreal's stationary lights
render static casters into a cached map and dynamics into a per-frame map, combining
at sample time [1]; Unity HDRP's cached shadows with `OnDemandShadowMapUpdate` do the
same [2]. Each shadow slot owns 12 atlas cells: 6 static cube faces (cached, world
geometry only) + 6 dynamic overlay faces (entities only, re-rendered per frame while a
caster stands in the face's frustum, mask-cleared the frame it leaves). The fragment
shader takes `min(staticVis, dynamicVis)` — the union of occluders. A face with no
entity in it costs nothing to maintain and one mask test to skip.

Moving lights (held torch, orbit light) keep the same split with a different refresh
cadence: every anchor move re-queues their *world-only* static faces, charged at the
ledger's dynamic priority (grant order 2, matching the RFC) because staleness is
immediately visible, while entities ride the same per-frame overlay as every other
slot. Entities are never baked into the cached world cells — the first cut did bake
them, and a held light that stopped moving kept a frozen imprint of wherever its
casters stood at the last refresh while its full face set stayed reserved in the
ledger every frame. Now an idle held light costs zero static work, refreshes only the
overlay faces a caster actually stands in, and reserves nothing beyond them.

Instanced pools (item drops) render into overlay faces via their `customDepthMaterial`,
exactly like the CSM entity pass — but only when an *entity* already triggered that
face; pool instances alone do not open overlay faces (documented v1 limitation; the
per-instance position readback to test them would cost more than it saves).

## I2 — Face math: analytic reconstruction, not per-fragment matrix fetches

The RFC put shadow matrices in light-data texels to dodge the uniform budget. Measured
against the alternative, full matrices are not even needed:

| Option | Per-fragment cost | Verdict |
| --- | --- | --- |
| (a) mat4 uniform arrays (4 lights × 6 faces) | 96 vec4 uniform slots — over budget | Rejected (uniform budget, `01-baseline.md` §4) |
| (b) matrices in texels, 4 `texelFetch` per sample | 4 fetches + mat mul | Workable, rejected as strictly worse than (c) |
| (c) analytic reconstruction from light position + face convention + near/far | ~10 ALU, **zero** fetches beyond the 2 shadow texels | **Implemented** |

A point-light cube face is a 90° frustum with axis-aligned basis vectors; a fragment's
face index is the dominant axis of `fragment − light`, its UV two component ratios, and
its depth compare value the linear distance along that axis. A spot's single face
reconstructs the same way from its (already-packed) direction and cone angle with a
deterministic up-vector rule. The face bases live once in `shadow-atlas.ts`
(`SHADOW_FACE_*`) and are mirrored in the GLSL; a unit test projects hundreds of points
through the actual render cameras and asserts the reconstruction lands on the same
UV/depth to 4 decimal places, so the two sides cannot drift silently.

Faces render with a 4 % guard band past 90° (`POINT_FACE_GUARD_TAN_HALF = 1.04`,
sampling uses the same constant) so PCF taps near cube-edge seams land on real depth
instead of clamped border texels — the standard cube-face-atlas seam treatment.

## I3 — Depth compare in linear light space, slope-scaled normal-offset bias

Hardware depth from a perspective face is hyperbolic in distance; comparing in that
space makes bias a resolution- *and range*-dependent fudge factor (the classic
acne/peter-panning tuning trap). Instead the sampler linearizes the stored depth
(2 ALU) and compares **linear block distances**, so bias is a world unit.

Bias model (all terms visible in `shader.ts`):

- constant occluder bias `0.035` blocks;
- texel-footprint term: one shadow texel spans `2·tanHalf·d / slotSize` blocks at
  distance `d`; bias scales with it so 256² and 512² tiers self-adjust;
- slope term: receiver offset along the surface normal scaled by
  `1 + √(1−(N·L)²)/(N·L)` (clamped ×8), which is Holbert's normal-offset shadows [3].
  This is what kills the grazing-incidence case that dominates this system's look: a
  torch 0.6 blocks above an infinite floor shadow-maps that floor against itself at
  incidence angles under 5°, where a naive constant bias either acnes (too small) or
  detaches every contact shadow (big enough to cover the worst case). Measured
  visually in the lone-torch scene: pre-fix the floor read fully shadowed past ~4
  blocks; post-fix the floor is clean to the range edge with no detached contact
  shadows (screenshots in the PR).

PCF is 4 rotated taps spread one texel — enough to soften the silhouette edge about a
texel and a half without eating the small slots' resolution. Penumbra is therefore
resolution-driven (256² ⇒ ~1.5-texel soft edge at mid range), not distance-driven;
PCSS-style contact hardening was evaluated and rejected for v1 (blocker-search taps
triple the cost of the common case on surfaces that are mostly *fully lit*).

**Resident-code cost under software rasterization.** A finding the RFC's methodology
did not anticipate: SwiftShader (the only rasterizer cloud CI can run) pays per
*fragment* for inlined shader volume even on branches never taken. The first cut
inlined the sampler at three sites (lit path, and each of the two new debug modes —
one of which re-inlined the entire clustered loop for its "isolated contribution"
view) and regressed the fill-heavy 42-light tunnel scene 48 % and zero-light parity
17 % — with identical draw calls, programs, and zero executed shadow instructions
(verified by stubbing the sampler bodies: costs returned to baseline exactly). The
shipped structure inlines the full sampler exactly once (both atlas layers fold into
one loop inside it), reuses the main pass's cluster term for debug mode 2, and gives
debug modes 4/5 a shared single-tap probe. Measured after: zero-light parity is
byte-equal with PR A (96.9 vs 97.6 ms p50 — inside noise) and the tunnel worst case
is +22 % under SwiftShader — the one resident sampler copy, the same order as the
+37 % SwiftShader delta PR A itself shipped for the analytic loop, and like it, a
software-rasterizer artifact to be re-checked on the reference-hardware gate.

## I4 — Atlas residency: fixed per-slot regions, no allocator

With `maxShadowedLights ≤ 4` and 12 cells per slot, the worst case is 48 cells of a
64-cell atlas (2048² / 256², high tier). A free-list allocator with per-face
allocation, compaction, and fragmentation counters was designed and then deleted:
fixed regions (slot *s* owns cells `12s..12s+11`) make eviction a single slot swap,
cannot fragment, and turn the shader's cell lookup into pure arithmetic. The unused
capacity (16 cells at high tier) is the deliberate price; ultra tier (4096²/512², 64
cells) fits its 4 slots exactly.

The atlas render target allocates lazily on the first granted slot, so a world that
never shadows never holds the memory (33.5 MB at 2048²: 16.8 MB RGBA color it cannot
drop plus 16.8 MB depth. The color attachment is dead weight — three.js cannot render
a depth-only pass to a color-less FBO through the public API; measured and accepted,
noted for a future engine-level depth-only path).

## I5 — Ledger semantics: reservation + bounded far-cascade deferral

The RFC's grant order (CSM near → dynamic local → CSM far → static FIFO) collides with
an implementation reality: CSM renders all its cascades inside one `csm.render()`
call, *before* local faces are drawn. The implemented contract keeps the order's
intent without restructuring CSM:

- the local scheduler **reserves** its dynamic-face units before CSM renders
  (`reserveDynamic`), capped at the free budget. The estimate mirrors exactly what
  `render` will draw through the dynamic tier — a moving light's *pending* world
  refreshes plus the overlay faces casters currently stand in — so an idle held
  light with nothing to redraw reserves nothing and cannot squeeze the far
  cascades or the static FIFO with phantom demand;
- CSM near charges unconditionally (priority 1 — never denied, may overdraw);
- a CSM far cascade is granted unless local lights are *actively sharing the frame*
  (reservation or last-frame spend) and it does not fit beside the reservation; a far
  cascade denied 2 consecutive frames is force-granted on the 3rd, so a permanently
  reserving held light degrades far-cascade cadence to every-3rd-frame instead of
  starving it;
- static FIFO faces spend only unreserved leftovers.

Invariant 6 falls out structurally: with zero local lights there is never a
reservation nor local spend, so every CSM request is granted at every tier — including
low/potato tiers whose 4-unit budgets are smaller than a far cascade's 6. This is
locked by a unit test (`grants CSM everything when local lights are inactive`).

## I6 — Emissive-face anchor + rotation-aware scan (the torch rule)

An authored torch is a wooden stick whose *tip face* is the hot surface. Anchoring its
light at the block center would embed the shadow near-plane in the stick, bias every
face camera half a block into the wood, and read as "the block glows"; anchoring at
the tip makes the analytic falloff, the shadow projection, the mount tests, and the
selection bounds all originate at the flame.

- Default anchor = emissive-strength-weighted centroid of the block's declared
  emissive faces (`deriveEmissiveAnchor`), clamped 2 % inside the voxel so `floor()`
  attribution (mount tests, cell binning) stays on the emitter block. A block with no
  emissive faces keeps the voxel center; an all-faces-emissive block (lamp cube)
  derives its center. `BlockLightProfile.offset` still overrides everything.
- The chunk scan now keeps the raw voxel's rotation bits in its per-voxel signature,
  so a rotated torch (a) re-registers when rotated in place and (b) rotates its anchor
  with `BlockRotation.rotateNode` — a wall torch's light hangs at the leaned tip. This
  is the generic API delta Engine PR A's scan was missing; no game-specific knowledge
  is involved (invariant 10).
- The stick itself is ordinary chunk geometry: it shades normally, receives CSM and
  local shadows, occludes other lights' maps, and occludes *its own* tip light
  downward (the honest dark column under a torch). The tip face is emissive and
  therefore immune to the acne a near-plane-adjacent surface would otherwise show.

## I7 — Entity tint parity (CPU sample ↔ GPU response)

`LightShined` tints entities from `queryLocalLights`. PR A's CPU sample ignored shape,
flicker, and occlusion, so a character behind a wall kept the blocked torch's tint.
The sample now mirrors the shader: spot angular falloff, capsule closest-point,
the same double-sine flicker (fed `performance.now()`), and the flood-mask occlusion
term for masked lights — with shadow-slot lights treated as masked on the CPU (the
atlas is not CPU-readable; the flood mask is the correct conservative stand-in). One
tint per entity remains the model (an entity does not self-shadow its own tint);
per-face entity lighting is a material feature, not a light-system feature.

The fluid specular pass follows the same stand-in rule from the GPU side: a static
shadow holder's packed flags carry the masked bit *alongside* the shadowed bit, so
water highlights multiply by the flood mask (no glint through a wall) while the
diffuse ladder keeps preferring the per-light atlas. Sampling the atlas in the water
branch instead would inline a second resident copy of the shadow sampler — the exact
code-volume regression I2's restructuring removed. Dynamic holders (held lights) keep
unmasked specular: they have no flood field of their own, and killing their glint by
whatever flood surrounds them would darken legitimate highlights in unlit rooms.

## I8 — Cache invalidation triggers (superset of the RFC's list)

The RFC named block edits, eviction, tier change, and context restore. Implementation
added two the RFC missed, both found by testing:

- **Chunk mesh (re)builds** (`handleChunkMeshed`): a cached map rendered while a
  neighbor chunk was still meshing has baked *absent* geometry; streaming that mesh in
  later must refresh the map or the light shines through terrain. Rides the same
  `buildChunkMesh` event CSM already uses to re-mark cascades.
- **Light anchor movement** (`refreshSlotGeometry`): dynamic lights obviously, but
  also a *static* light whose registration moved (block rotated in place → same slot
  index, new anchor). The block-edit path hands the facade *raw voxel words*, not
  extracted ids, precisely so an in-place rotation (same id, new rotation bits)
  queues the rescan that moves the anchor and refreshes the maps.
- **Spot cone rotation** (`refreshSlotGeometry`, cause `lightRotated`): a spot's
  cached face aims along its cone; `setDirection` (or a cone-angle change) re-queues
  it, or the atlas would keep shadowing the old aim.

Every invalidation lands in a 32-entry ring (`invalidationLog`) with its cause, read
by the debug HUD and the proof harness.

## Prior art consulted (patterns, not code)

1. Epic — Unreal Engine, *Stationary Light* shadow caching (static casters cached,
   dynamics composited from separate per-frame maps).
2. Unity — HDRP *Cached Shadow Maps* documentation (atlas residency, mixed cached +
   dynamic composition, on-demand updates).
3. Holbert — *Normal Offset Shadows* (GDC 2011 poster; slope-scaled receiver offset).
4. Olsson et al. — *Efficient Virtual Shadow Maps for Many Lights*, I3D 2014
   (residency management; why per-light RTs do not scale).
5. King — *Shadow Mapping Algorithms* (GPU Gems-era guard-band and cube-seam
   treatments for atlased point lights).

No proprietary implementation was examined or copied.
