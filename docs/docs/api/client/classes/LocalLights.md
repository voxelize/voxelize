---
id: "LocalLights"
title: "Class: LocalLights"
sidebar_label: "LocalLights"
sidebar_position: 0
custom_edit_url: null
---

Local light emitters: the engine-owned registry, selection, clustering,
and GPU packing behind `world.localLights`. The game declares semantic
block profiles and dynamic sources; chunk scanning, diffing, aggregation,
culling, and rendering state are owned here.

A world that registers no lights and declares no profiles pays one uniform
compare per fragment and nothing per frame on the CPU.

## Constructors

### constructor

• **new LocalLights**(`options`, `getWorldConfig`, `getBlocks`): [`LocalLights`](LocalLights.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`<[`LocalLightsOptions`](../interfaces/LocalLightsOptions.md)\> |
| `getWorldConfig` | () => [`LocalLightsWorldConfig`](../interfaces/LocalLightsWorldConfig.md) |
| `getBlocks` | () => `Iterable`<[`EmitterBlock`](../interfaces/EmitterBlock.md), `any`, `any`\> |

#### Returns

[`LocalLights`](LocalLights.md)

## Properties

### airlight

• `Readonly` **airlight**: [`LocalLightAirlight`](LocalLightAirlight.md)

The few lights the camera sees, lighting the air (a screen effect the
game adds) and the room (the chunk shader's fill). The game drives its
`update` once per drawn frame with the camera's daylight and sight
lines; an empty set costs the shaders one integer compare.

___

### getLoadedChunk

• **getLoadedChunk**: (`cx`: `number`, `cz`: `number`) => [`ScannableChunk`](../interfaces/ScannableChunk.md)

Chunk lookup for late profile changes. Populated by the world adapter;
null keeps late declarations working for future loads only.

#### Type declaration

▸ (`cx`, `cz`): [`ScannableChunk`](../interfaces/ScannableChunk.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

##### Returns

[`ScannableChunk`](../interfaces/ScannableChunk.md)

___

### grid

• `Readonly` **grid**: [`LightClusterGrid`](LightClusterGrid.md)

___

### options

• `Readonly` **options**: [`LocalLightsOptions`](../interfaces/LocalLightsOptions.md)

___

### registry

• `Readonly` **registry**: [`LightSourceRegistry`](LightSourceRegistry.md)

___

### shadowLedger

• `Readonly` **shadowLedger**: [`ShadowFrameLedger`](ShadowFrameLedger.md)

The per-frame face-unit budget CSM and local shadows share.

___

### shadows

• `Readonly` **shadows**: [`LocalShadowScheduler`](LocalShadowScheduler.md)

The L3 shadow tier: slot selection, cached faces, atlas renders.

___

### stats

• `Readonly` **stats**: [`LocalLightStats`](../interfaces/LocalLightStats.md)

Mutated in place; never reallocated.

## Accessors

### blockLightOwnership

• `get` **blockLightOwnership**(): `number`

Flood-ownership weight of the current tier: `1` on every tier that
renders clustered lights (the analytic layer owns visible block-source
lighting exclusively — nothing double-lights), `0` at `off`/`potato`
(the exact legacy flood frame). This is an invariant, not
configuration — read-only introspection for CPU consumers
(`LightShined`) that mirror the chunk shader's `uLocalOwnership`
uniform; hybrid visible stacking is not a supported state.

#### Returns

`number`

___

### getIsOpaqueAt

• `set` **getIsOpaqueAt**(`fn`): `void`

Voxel opacity oracle for mount-aware shadow-face skipping, wired by the
world adapter. Null disables the skip (all six faces render).

#### Parameters

| Name | Type |
| :------ | :------ |
| `fn` | (`vx`: `number`, `vy`: `number`, `vz`: `number`) => `boolean` |

#### Returns

`void`

___

### isTemporallyStable

• `get` **isTemporallyStable**(): `boolean`

#### Returns

`boolean`

___

### uniformBindings

• `get` **uniformBindings**(): `Object`

The shared uniform objects every chunk material binds. One set for the
whole world; updates are zero-copy.

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `uAirColor` | \{ `value`: `Vector4`[]  } |
| `uAirColor.value` | `Vector4`[] |
| `uAirCount` | \{ `value`: `number` = 0 } |
| `uAirCount.value` | `number` |
| `uAirPos` | \{ `value`: `Vector4`[]  } |
| `uAirPos.value` | `Vector4`[] |
| `uClusteredLightCount` | \{ `value`: `number` = 0 } |
| `uClusteredLightCount.value` | `number` |
| `uEmissiveLevels` | \{ `value`: `Vector4`  } |
| `uEmissiveLevels.value` | `Vector4` |
| `uLightData` | \{ `value`: `DataTexture`  } |
| `uLightData.value` | `DataTexture` |
| `uLightGrid` | \{ `value`: `DataTexture`  } |
| `uLightGrid.value` | `DataTexture` |
| `uLightGridCellSize` | \{ `value`: `number` = 8 } |
| `uLightGridCellSize.value` | `number` |
| `uLightGridCenter` | \{ `value`: `Vector4`  } |
| `uLightGridCenter.value` | `Vector4` |
| `uLightGridDims` | \{ `value`: `Vector3`  } |
| `uLightGridDims.value` | `Vector3` |
| `uLightGridHalf` | \{ `value`: `Vector3`  } |
| `uLightGridHalf.value` | `Vector3` |
| `uLightGridOrigin` | \{ `value`: `Vector3`  } |
| `uLightGridOrigin.value` | `Vector3` |
| `uLightGridStorageOffset` | \{ `value`: `Vector3`  } |
| `uLightGridStorageOffset.value` | `Vector3` |
| `uLocalLightDebugMode` | \{ `value`: `number` = 0 } |
| `uLocalLightDebugMode.value` | `number` |
| `uLocalLightStable` | \{ `value`: `number` = 1 } |
| `uLocalLightStable.value` | `number` |
| `uLocalMaskKnee` | \{ `value`: `number`  } |
| `uLocalMaskKnee.value` | `number` |
| `uLocalOwnership` | \{ `value`: `number` = 1 } |
| `uLocalOwnership.value` | `number` |
| `uLocalShadowAtlas` | \{ `value`: `Texture`<`unknown`\>  } |
| `uLocalShadowAtlas.value` | `Texture`<`unknown`\> |
| `uLocalShadowParams` | \{ `value`: `Vector4`  } |
| `uLocalShadowParams.value` | `Vector4` |
| `uLocalShadowParams2` | \{ `value`: `Vector4`  } |
| `uLocalShadowParams2.value` | `Vector4` |
| `uLocalSpecularStrength` | \{ `value`: `number` = 1 } |
| `uLocalSpecularStrength.value` | `number` |
| `uRoomFillCoreScale` | \{ `value`: `number` = 0 } |
| `uRoomFillCoreScale.value` | `number` |
| `uRoomFillFloodMask` | \{ `value`: `number` = 0 } |
| `uRoomFillFloodMask.value` | `number` |
| `uRoomFillRangeScale` | \{ `value`: `number` = 0 } |
| `uRoomFillRangeScale.value` | `number` |
| `uRoomFillStrength` | \{ `value`: `number` = 0 } |
| `uRoomFillStrength.value` | `number` |

## Methods

### add

▸ **add**(`descriptor`, `position`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `descriptor` | [`LocalLightDescriptor`](../interfaces/LocalLightDescriptor.md) |
| `position` | `Vector3` |

#### Returns

`number`

___

### beginShadowFrame

▸ **beginShadowFrame**(`entities?`): `void`

Open this frame's shadow budget and reserve units for dynamic faces
(moving hero lights, entity overlays) before the CSM cascades spend.

#### Parameters

| Name | Type |
| :------ | :------ |
| `entities?` | `Object3D`<`Object3DEventMap`\>[] |

#### Returns

`void`

___

### clearBlockProfile

▸ **clearBlockProfile**(`block`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | `string` \| `number` |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### getDebugMode

▸ **getDebugMode**(): `number`

#### Returns

`number`

___

### getQualityTier

▸ **getQualityTier**(): [`LightQualityTier`](../#lightqualitytier)

#### Returns

[`LightQualityTier`](../#lightqualitytier)

___

### handleBlockUpdate

▸ **handleBlockUpdate**(`edit`): `void`

A voxel changed. Only edits that touch an emitter queue a section
rescan; everything else costs one AABB test per active shadow slot.

Takes the raw voxel words, not bare ids: rotating a torch in place
changes only the rotation bits, yet must re-anchor its light (the scan
signatures carry rotation) and refresh cached shadow maps (the stick
occludes differently) exactly like swapping the block would.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `edit` | `Object` | - |
| `edit.chunk` | [`ScannableChunk`](../interfaces/ScannableChunk.md) | - |
| `edit.newValue` | `number` | - |
| `edit.oldValue` | `number` | Raw voxel words: id in the low 16 bits, rotation/stage above. |
| `edit.voxel` | [`number`, `number`, `number`] | - |

#### Returns

`void`

___

### handleChunkLoaded

▸ **handleChunkLoaded**(`cx`, `cz`, `chunk`): `void`

A chunk's data arrived or re-arrived: queue every section for a scan.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `chunk` | [`ScannableChunk`](../interfaces/ScannableChunk.md) |

#### Returns

`void`

___

### handleChunkMeshed

▸ **handleChunkMeshed**(`cx`, `cz`): `void`

A chunk mesh (re)built: refresh cached maps that reach into it.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### handleChunkUnloaded

▸ **handleChunkUnloaded**(`cx`, `cz`): `void`

A chunk left the render distance: its registrations release now.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### hideDebugOverlay

▸ **hideDebugOverlay**(): `void`

#### Returns

`void`

___

### invalidateShadowRegion

▸ **invalidateShadowRegion**(`region`): `void`

Invalidate every cached shadow map intersecting `[min, max)` — for game
systems that alter occluding geometry outside the block-update stream.

#### Parameters

| Name | Type |
| :------ | :------ |
| `region` | `Object` |
| `region.max` | `Vector3` |
| `region.min` | `Vector3` |

#### Returns

`void`

___

### onContextRestored

▸ **onContextRestored**(): `void`

GPU context restored: CPU-side light state is authoritative, so all GPU
textures simply re-upload. Wire this to the canvas's
`webglcontextrestored` event.

#### Returns

`void`

___

### queryLocalLights

▸ **queryLocalLights**(`position`, `out`, `options?`): `void`

CPU sample of the selected lights' combined irradiance at a point, for
entities, held items, and particles. Writes into `out`; no allocation
(per-frame callers may reuse one `options` scratch object).

`options.floodMask` is the caller's local flood-light level mapped
through the mask knee (1 = fully open); masked and shadow-fallback
lights multiply by it so an entity behind a wall stops tinting from a
blocked light. `options.timeMs` drives the same flicker curve the
shader evaluates.

`out.claim` and `out.windowFade` mirror the chunk shader's
flood-ownership term: consumers that also apply a baked flood tint
scale that tint by `blockLightFloodRemainder({ scaledClaim:
out.claim × {@link blockLightOwnership}, floodLevel, windowFade:
out.windowFade })` so a point covered by analytic lights is never lit
by both models and the window-rim crossfade matches the ground
(`LightShined` does exactly this).

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |
| `out` | [`LocalLightSample`](../interfaces/LocalLightSample.md) |
| `options?` | `Object` |
| `options.floodMask?` | `number` |
| `options.timeMs?` | `number` |

#### Returns

`void`

___

### rebuildProfiles

▸ **rebuildProfiles**(): `void`

Re-resolve every block profile and rescan the loaded world through the
bounded queue — for scan-time switches (`BLOCK_LIGHT_TUNING`'s
`analyticHue`, `proxyEnergy`) flipped at runtime.

#### Returns

`void`

___

### remove

▸ **remove**(`handle`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |

#### Returns

`boolean`

___

### renderShadows

▸ **renderShadows**(`renderer`, `scene`, `entities?`, `instancePools?`, `skipShadowObjects?`, `poolBounds?`): `void`

Render whatever local shadow faces this frame's remaining budget grants:
moving-light refreshes and entity overlays first, then the invalidated
static FIFO. A frame with zero shadow slots returns immediately.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `renderer` | `WebGLRenderer` | `undefined` |
| `scene` | `Scene`<`Object3DEventMap`\> | `undefined` |
| `entities?` | `Object3D`<`Object3DEventMap`\>[] | `undefined` |
| `instancePools?` | `Group`<`Object3DEventMap`\>[] | `undefined` |
| `skipShadowObjects` | readonly `Object3D`<`Object3DEventMap`\>[] | `[]` |
| `poolBounds?` | readonly `Box3`[] | `undefined` |

#### Returns

`void`

___

### resetPeakStats

▸ **resetPeakStats**(): `void`

Start a fresh peak-cost measurement window (benchmark harnesses).

#### Returns

`void`

___

### setBlockProfile

▸ **setBlockProfile**(`block`, `profile`): `void`

Declare (or replace) the semantic light profile for a block id or name.
Affects every present and future emitter of that block: all tracked
sections rescan through the amortized queue.

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | `string` \| `number` |
| `profile` | [`BlockLightProfile`](../interfaces/BlockLightProfile.md) |

#### Returns

`void`

___

### setColor

▸ **setColor**(`handle`, `color`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `color` | [`number`, `number`, `number`] |

#### Returns

`boolean`

___

### setDebugMode

▸ **setDebugMode**(`mode`): `void`

0 off, 1 cell occupancy heatmap, 2 isolated contribution, 3 leak mask,
4 shadow-slot tint, 5 isolated local-shadow visibility, 6 flood-
ownership remainder (white = legacy flood renders, black = analytic
owns).

#### Parameters

| Name | Type |
| :------ | :------ |
| `mode` | ``0`` \| ``1`` \| ``2`` \| ``3`` \| ``4`` \| ``5`` \| ``6`` |

#### Returns

`void`

___

### setDirection

▸ **setDirection**(`handle`, `direction`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `direction` | `Vector3` |

#### Returns

`boolean`

___

### setEnabled

▸ **setEnabled**(`handle`, `isEnabled`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `isEnabled` | `boolean` |

#### Returns

`boolean`

___

### setIntensity

▸ **setIntensity**(`handle`, `intensity`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `intensity` | `number` |

#### Returns

`boolean`

___

### setPosition

▸ **setPosition**(`handle`, `position`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `position` | `Vector3` |

#### Returns

`boolean`

___

### setQualityTier

▸ **setQualityTier**(`tier`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `tier` | [`LightQualityTier`](../#lightqualitytier) |

#### Returns

`void`

___

### setRange

▸ **setRange**(`handle`, `range`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `range` | `number` |

#### Returns

`boolean`

___

### setRenderPixels

▸ **setRenderPixels**(`pixels`): `void`

The drawing buffer's pixel count; the world feeds it every rendered
frame. Past `highResolutionPixels` (with hysteresis) cells keep fewer
steady lights, and the ones they drop fade out.

#### Parameters

| Name | Type |
| :------ | :------ |
| `pixels` | `number` |

#### Returns

`void`

___

### setTemporalStability

▸ **setTemporalStability**(`isStable`): `void`

On by default. Off renders the legacy frame — camera-ranked cells,
popping selection, stepped window rim, shadows that blank on every
nearby remesh — and exists only for A/B captures and measurements.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isStable` | `boolean` |

#### Returns

`void`

___

### showDebugOverlay

▸ **showDebugOverlay**(`parent`): `void`

Wireframe bounds of every selected light, colored by state. Attached to
the given parent (typically the world); allocated on first use only.

#### Parameters

| Name | Type |
| :------ | :------ |
| `parent` | `Object` |
| `parent.add` | (`object`: `object`) => `void` |

#### Returns

`void`

___

### update

▸ **update**(`position`): `void`

Per-frame work: drain the bounded scan queue, then run selection and
packing (which no-op when nothing changed). Called from `World.update`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |

#### Returns

`void`
