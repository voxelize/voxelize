---
id: "LightClusterGrid"
title: "Class: LightClusterGrid"
sidebar_label: "LightClusterGrid"
sidebar_position: 0
custom_edit_url: null
---

The world-space clustered light layer: selects the highest-importance
registered lights around the camera (deterministically, with hysteresis),
bins them into a camera-centered world-aligned cell grid, and packs both
into two small data textures every chunk material samples.

A cell keeps the lights that light *it* best — ranked by their falloff at
the cell, not by distance to the camera — so walking around never changes
which lights a corner is lit by. Whatever does change a cell's lights (a
light entering or leaving the selection, a rival winning its slot, the
resolution gate) fades per slot over `slotFadeMs` instead of popping. Cells
live in toroidal storage (world cell mod dims), so a cell keeps its slots
and their fades while the window scrolls around it.

All per-frame work runs on preallocated scratch; a frame in which neither
the registry nor the camera cell changed and nothing is fading does
nothing at all.

## Constructors

### constructor

• **new LightClusterGrid**(`registry`, `options`): [`LightClusterGrid`](LightClusterGrid.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `registry` | [`LightSourceRegistry`](LightSourceRegistry.md) |
| `options` | `LightClusterGridOptions` |

#### Returns

[`LightClusterGrid`](LightClusterGrid.md)

## Properties

### packedCount

• **packedCount**: `number` = `0`

___

### packedIndices

• `Readonly` **packedIndices**: `Uint32Array`<`ArrayBufferLike`\>

Registry slot per packed data row: the selection in rank order, then
the lights that left it but are still fading out of their cells.

___

### selectedCount

• **selectedCount**: `number` = `0`

___

### selectedIndices

• `Readonly` **selectedIndices**: `Uint32Array`<`ArrayBufferLike`\>

Selected registry slot per rank; `selectedCount` entries are live.

___

### shadowProvider

• **shadowProvider**: (`index`: `number`) => [`ShadowTexelRecord`](../interfaces/ShadowTexelRecord.md) = `null`

Shadow-slot data source, wired by the facade once the shadow scheduler
exists. Null keeps every record unshadowed (Engine PR A behavior).

#### Type declaration

▸ (`index`): [`ShadowTexelRecord`](../interfaces/ShadowTexelRecord.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

##### Returns

[`ShadowTexelRecord`](../interfaces/ShadowTexelRecord.md)

___

### uniforms

• `Readonly` **uniforms**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `clusteredCount` | \{ `value`: `number` = 0 } | - |
| `clusteredCount.value` | `number` | - |
| `debugMode` | \{ `value`: `number` = 0 } | - |
| `debugMode.value` | `number` | - |
| `emissiveLevels` | \{ `value`: `Vector4`  } | - |
| `emissiveLevels.value` | `Vector4` | - |
| `gridCellSize` | \{ `value`: `number` = 8 } | - |
| `gridCellSize.value` | `number` | - |
| `gridCenter` | \{ `value`: `Vector4`  } | The point the window is centred on (xyz), written every frame, and the rim fade width in blocks (w). The rim fade is continuous in it, so a world point's analytic light never steps when the window scrolls. |
| `gridCenter.value` | `Vector4` | - |
| `gridDims` | \{ `value`: `Vector3`  } | - |
| `gridDims.value` | `Vector3` | - |
| `gridHalf` | \{ `value`: `Vector3`  } | Half extent the window covers around its centre on every frame. |
| `gridHalf.value` | `Vector3` | - |
| `gridOrigin` | \{ `value`: `Vector3`  } | - |
| `gridOrigin.value` | `Vector3` | - |
| `gridStorageOffset` | \{ `value`: `Vector3`  } | The window origin's cell mod the dims: its storage cell, per axis. |
| `gridStorageOffset.value` | `Vector3` | - |
| `lightData` | \{ `value`: `DataTexture`  } | - |
| `lightData.value` | `DataTexture` | - |
| `lightGrid` | \{ `value`: `DataTexture`  } | - |
| `lightGrid.value` | `DataTexture` | - |
| `maskKnee` | \{ `value`: `number`  } | - |
| `maskKnee.value` | `number` | - |
| `ownership` | \{ `value`: `number` = 1 } | 0..1: how strongly analytic claims suppress the baked flood term. |
| `ownership.value` | `number` | - |
| `specularStrength` | \{ `value`: `number` = 1 } | - |
| `specularStrength.value` | `number` | - |
| `stable` | \{ `value`: `number` = 1 } | 1: the temporally stable layer. 0: the legacy frame, for A/B. |
| `stable.value` | `number` | - |

## Accessors

### isHighResolutionGate

• `get` **isHighResolutionGate**(): `boolean`

#### Returns

`boolean`

___

### isTemporallyStable

• `get` **isTemporallyStable**(): `boolean`

#### Returns

`boolean`

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### markTexturesDirty

▸ **markTexturesDirty**(): `void`

Re-upload GPU state after a restored context; CPU data is authoritative.

#### Returns

`void`

___

### refreshShadowTexels

▸ **refreshShadowTexels**(`stats`): `void`

Rewrite only the shadow-facing data (flags bit 2 + texels 4–5) of every
packed record. Runs when shadow slots change on a frame where the main
pack did not — a ≤ 32 KB re-upload, counted in stats.

#### Parameters

| Name | Type |
| :------ | :------ |
| `stats` | [`LocalLightStats`](../interfaces/LocalLightStats.md) |

#### Returns

`void`

___

### resetHysteresis

▸ **resetHysteresis**(): `void`

A camera jump larger than the analytic radius means the previous
selection belongs to somewhere else entirely; hysteresis must not drag
it across the map, and nothing there should fade in from black.

#### Returns

`void`

___

### sampleIrradiance

▸ **sampleIrradiance**(`point`, `out`, `options?`): `number`

CPU mirror of the shader's light response, for entities and particles:
accumulates the falloff-weighted color of every light the point's cell
holds, scaled by each slot's fade, with the same spot/capsule shaping,
shader-matched flicker, and — when the caller supplies its local flood
level — the same occlusion mask the world surfaces use, so an entity
behind a wall stops tinting from the light the wall blocks. Mirrors the
chunk shader's per-fragment structure exactly: only lights present in
the point's grid cell contribute — color and claim alike — so a point
outside the window or in an overflowed cell keeps its flood look on
entities just as it does on blocks, and both the color and `out.claim`
(the unoccluded luminance claim that drives the flood remainder) carry
the same window fade the shader applies, keeping the combined block
light continuous across the rim. Zero allocation; the caller owns `out`
and may reuse one `options` scratch object across calls (`floodMask` is
the knee-mapped local flood level, 1 = fully open; `timeMs` drives the
same flicker curve the shader evaluates).

#### Parameters

| Name | Type |
| :------ | :------ |
| `point` | [`number`, `number`, `number`] |
| `out` | [`LocalLightSample`](../interfaces/LocalLightSample.md) |
| `options?` | `Object` |
| `options.floodMask?` | `number` |
| `options.timeMs?` | `number` |

#### Returns

`number`

___

### setRenderPixels

▸ **setRenderPixels**(`pixels`): `void`

The drawing buffer's pixel count, fed every frame. Crossing the
high-resolution gate (with hysteresis) changes how many steady lights a
cell keeps; the cells that lose or gain one fade like any other change.

#### Parameters

| Name | Type |
| :------ | :------ |
| `pixels` | `number` |

#### Returns

`void`

___

### setTemporalStability

▸ **setTemporalStability**(`isStable`): `void`

Stable layer on (default) or the legacy frame, for A/B captures. Either
way the next pass rebuilds every cell from scratch.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isStable` | `boolean` |

#### Returns

`void`

___

### setTierCaps

▸ **setTierCaps**(`caps`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `caps` | `Object` |
| `caps.analyticRadius` | `number` |
| `caps.blockLightOwnership` | `number` |
| `caps.fluidSpecularStrength` | `number` |
| `caps.maxClusteredLights` | `number` |
| `caps.maxLightsPerCell` | `number` |

#### Returns

`void`

___

### update

▸ **update**(`cameraX`, `cameraY`, `cameraZ`, `stats`, `nowMs?`): `void`

Selection + binning + packing when the registry or the camera's grid
cell moved since the last pass, then this frame's slot fades.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cameraX` | `number` |
| `cameraY` | `number` |
| `cameraZ` | `number` |
| `stats` | [`LocalLightStats`](../interfaces/LocalLightStats.md) |
| `nowMs` | `number` |

#### Returns

`void`
