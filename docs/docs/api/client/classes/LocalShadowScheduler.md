---
id: "LocalShadowScheduler"
title: "Class: LocalShadowScheduler"
sidebar_label: "LocalShadowScheduler"
sidebar_position: 0
custom_edit_url: null
---

The L3 tier: decides which clustered lights earn a shadow slot (with
eviction hysteresis so orbiting the camera does not thrash the atlas),
owns the cached-static / dynamic-overlay face state machine per slot, and
renders the faces the [ShadowFrameLedger](ShadowFrameLedger.md) grants each frame.

A frame with zero shadow slots costs one integer compare in `update` and
an early return in `render`.

## Constructors

### constructor

• **new LocalShadowScheduler**(`registry`, `options`): [`LocalShadowScheduler`](LocalShadowScheduler.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `registry` | [`LightSourceRegistry`](LightSourceRegistry.md) | - |
| `options` | `Object` | - |
| `options.maxShadowedLights` | `number` | - |
| `options.now?` | () => `number` | Clock for the shadow fades; tests inject one. |
| `options.shadowAtlasSize` | `number` | - |
| `options.shadowEvictionHysteresis` | `Object` | - |
| `options.shadowEvictionHysteresis.frames` | `number` | - |
| `options.shadowEvictionHysteresis.ratio` | `number` | - |
| `options.shadowFadeMs?` | `number` | - |
| `options.shadowSlotSize` | `number` | - |
| `options.temporalStability?` | `boolean` | - |

#### Returns

[`LocalShadowScheduler`](LocalShadowScheduler.md)

## Properties

### atlas

• `Readonly` **atlas**: [`LocalShadowAtlas`](LocalShadowAtlas.md)

___

### getIsOpaqueAt

• **getIsOpaqueAt**: (`vx`: `number`, `vy`: `number`, `vz`: `number`) => `boolean` = `null`

getIsOpaqueAt hook, wired by the world; null skips mount awareness.

#### Type declaration

▸ (`vx`, `vy`, `vz`): `boolean`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

##### Returns

`boolean`

___

### getStaticCasterRoots

• **getStaticCasterRoots**: (`x`: `number`, `y`: `number`, `z`: `number`, `radius`: `number`, `out`: `Object3D`<`Object3DEventMap`\>[]) => `void` = `null`

Static caster collection hook, wired by the world: append every world
root (chunk group) whose geometry can occlude a light at `(x, y, z)`
with range `radius` to `out`. Null falls back to rendering the whole
scene per face, which stays correct but pays full-graph traversal.

#### Type declaration

▸ (`x`, `y`, `z`, `radius`, `out`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |
| `radius` | `number` |
| `out` | `Object3D`<`Object3DEventMap`\>[] |

##### Returns

`void`

___

### invalidationLog

• `Readonly` **invalidationLog**: [`ShadowInvalidationEntry`](../interfaces/ShadowInvalidationEntry.md)[] = `[]`

Ring buffer of the most recent invalidations, for the debug HUD.

___

### isBorrowingCasters

• **isBorrowingCasters**: `boolean` = `true`

Draw an overlay face's casters from borrowed lists (on by default):
the near entities in one call without reparenting them, and the slot's
pools in one more, instead of moving each entity into a scratch scene
and back (a `childremoved`/`childadded` pair on its real parent every
time) and rendering each pool as its own root (a matrix walk and a
render call per pool per face). Off restores the old path for A/B
timing; the world flips it with the cascades' single caster pass.

___

### onShadowDataChanged

• **onShadowDataChanged**: () => `void` = `null`

Called whenever packed shadow texels must be rewritten.

#### Type declaration

▸ (): `void`

##### Returns

`void`

## Accessors

### activeSlotCount

• `get` **activeSlotCount**(): `number`

#### Returns

`number`

___

### slotCapacity

• `get` **slotCapacity**(): `number`

#### Returns

`number`

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### estimateDynamicDemand

▸ **estimateDynamicDemand**(`entities?`): `number`

Estimated dynamic face units this frame wants, for the ledger
reservation taken before CSM renders its cascades. Mirrors exactly what
`render` will draw through the dynamic tier — a moving light's pending
world refreshes plus every slot's entity overlay faces — so an idle
held light with no casters nearby reserves nothing and never squeezes
the CSM far cascades or the static FIFO.

#### Parameters

| Name | Type |
| :------ | :------ |
| `entities?` | `Object3D`<`Object3DEventMap`\>[] |

#### Returns

`number`

___

### invalidateAll

▸ **invalidateAll**(`cause`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cause` | [`ShadowInvalidationCause`](../#shadowinvalidationcause) |

#### Returns

`void`

___

### invalidateRegion

▸ **invalidateRegion**(`region`): `void`

Public API: invalidate every cached map intersecting a world region.

#### Parameters

| Name | Type |
| :------ | :------ |
| `region` | `Object` |
| `region.max` | [`number`, `number`, `number`] |
| `region.min` | [`number`, `number`, `number`] |

#### Returns

`void`

___

### notifyBlockEdit

▸ **notifyBlockEdit**(`vx`, `vy`, `vz`): `void`

A voxel changed. Cached static maps of every slot whose range sphere
intersects the edited voxel re-render through the FIFO; edits outside
every range cost one AABB test per active slot.

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`void`

___

### notifyChunkMeshed

▸ **notifyChunkMeshed**(`area`): `void`

A chunk's mesh (re-)built. Cached maps that reach into the chunk baked
whatever geometry existed at render time; streaming in late meshes must
refresh them or lights shine through terrain that "wasn't there yet".

#### Parameters

| Name | Type |
| :------ | :------ |
| `area` | `Object` |
| `area.maxHeight` | `number` |
| `area.maxX` | `number` |
| `area.maxZ` | `number` |
| `area.minX` | `number` |
| `area.minZ` | `number` |

#### Returns

`void`

___

### onContextRestored

▸ **onContextRestored**(): `void`

GPU context restored: atlas contents are gone; re-render lazily.

#### Returns

`void`

___

### recordForIndex

▸ **recordForIndex**(`index`): [`ShadowTexelRecord`](../interfaces/ShadowTexelRecord.md)

Texel provider for the clustered packer. The record is scratch reused
by the next call (the packer runs every frame a shadow fades).

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

[`ShadowTexelRecord`](../interfaces/ShadowTexelRecord.md)

___

### render

▸ **render**(`renderer`, `scene`, `ledger`, `entities`, `instancePools`, `skipShadowObjects`, `stats`, `poolBounds?`): `void`

Render the faces the ledger grants. Order inside the local tier:
moving-light refreshes and entity overlays (dynamic units, reserved)
first, then the invalidated-static FIFO (free units only).

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `scene` | `Scene`<`Object3DEventMap`\> |
| `ledger` | [`ShadowFrameLedger`](ShadowFrameLedger.md) |
| `entities` | `Object3D`<`Object3DEventMap`\>[] |
| `instancePools` | `Group`<`Object3DEventMap`\>[] |
| `skipShadowObjects` | readonly `Object3D`<`Object3DEventMap`\>[] |
| `stats` | [`LocalLightStats`](../interfaces/LocalLightStats.md) |
| `poolBounds?` | readonly `Box3`[] |

#### Returns

`void`

___

### resetCacheCounters

▸ **resetCacheCounters**(): `void`

Restart the cache-hit measurement window (benchmark harnesses).

#### Returns

`void`

___

### setTemporalStability

▸ **setTemporalStability**(`isStable`): `void`

On (default): shadows fade in once their faces exist and fade out
before a slot changes hands, and an invalidated face keeps sampling its
last map until the re-render lands. Off: the legacy behaviour, where an
invalidation blanks every face of the light (fully lit) until the
budgeted re-render, and a swap is instant.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isStable` | `boolean` |

#### Returns

`void`

___

### setTierCaps

▸ **setTierCaps**(`maxShadowedLights`, `atlasSize`, `slotSize`): `void`

Quality-tier change: new caps and atlas geometry. Every cached map is
dropped (the atlas may have been reallocated at a new size).

#### Parameters

| Name | Type |
| :------ | :------ |
| `maxShadowedLights` | `number` |
| `atlasSize` | `number` |
| `slotSize` | `number` |

#### Returns

`void`

___

### update

▸ **update**(`selectedIndices`, `selectedCount`, `cameraX`, `cameraY`, `cameraZ`, `stats`, `retainedIndices?`, `retainedCount?`): `void`

Reconcile shadow slots against the clustered selection. Runs every
frame; the scoring loop is O(clustered ≤ 255) and the whole pass is a
no-op micro-loop when nothing shadow-requesting is selected.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `selectedIndices` | `Uint32Array`<`ArrayBufferLike`\> | `undefined` | - |
| `selectedCount` | `number` | `undefined` | - |
| `cameraX` | `number` | `undefined` | - |
| `cameraY` | `number` | `undefined` | - |
| `cameraZ` | `number` | `undefined` | - |
| `stats` | [`LocalLightStats`](../interfaces/LocalLightStats.md) | `undefined` | - |
| `retainedIndices?` | `Uint32Array`<`ArrayBufferLike`\> | `undefined` | Lights still rendered while they fade out of the clustered set: a holder among them keeps its slot (and its shadow) until it is gone, but they never take or challenge for one. |
| `retainedCount` | `number` | `0` | - |

#### Returns

`void`
