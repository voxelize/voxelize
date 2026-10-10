---
id: "CSMRenderer"
title: "Class: CSMRenderer"
sidebar_label: "CSMRenderer"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new CSMRenderer**(`config?`): [`CSMRenderer`](CSMRenderer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | `Partial`<[`CSMConfig`](../interfaces/CSMConfig.md)\> |

#### Returns

[`CSMRenderer`](CSMRenderer.md)

## Accessors

### casterDepthMaterial

• `get` **casterDepthMaterial**(): `MeshDepthMaterial`

The depth material every cascade draws its casters with. A load-time
shader warmup compiles it against each kind of caster (plain, instanced,
batched) so no depth program is built on a frame the player sees.

#### Returns

`MeshDepthMaterial`

___

### lightLagRadians

• `get` **lightLagRadians**(): `number`

The angle between the live light and the direction the cascades were
last fitted to: how far drawn shadows lag the sun.

#### Returns

`number`

___

### nonCasterExclusion

• `get` **nonCasterExclusion**(): `boolean`

#### Returns

`boolean`

___

### numCascades

• `get` **numCascades**(): `number`

#### Returns

`number`

___

### shadowBias

• `get` **shadowBias**(): `number`

#### Returns

`number`

___

### singleCasterPass

• `get` **singleCasterPass**(): `boolean`

#### Returns

`boolean`

___

### skipShadowObjects

• `get` **skipShadowObjects**(): readonly `Object3D`<`Object3DEventMap`\>[]

The `skipShadow`-flagged objects every depth consumer must hide. The
local shadow atlas hides the same list, so casters can never disagree
between the sun's maps and a torch's.

#### Returns

readonly `Object3D`<`Object3DEventMap`\>[]

## Methods

### addNeverCaster

▸ **addNeverCaster**(`object`): `void`

Keep `object` (and its subtree) out of every depth pass, always: a
stand-in that only ever draws where real geometry does not, such as the
far-terrain layer. Its own shader discards it under the loaded chunks,
but a depth pass draws it with the shared depth material and no such
test, so it would shade the real ground below it. `castShadow` alone
does not keep it out: the cascades render the whole scene. Holds
whether or not the host brackets its passes in [hideNonCasters](CSMRenderer.md#hidenoncasters).

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### addShadowExclusion

▸ **addShadowExclusion**(`object`): `void`

Keep `object` (and its subtree) out of every whole-scene depth pass.
Unlike [addSkipShadowObject](CSMRenderer.md#addskipshadowobject) this needs no material flag, so a
group can be excluded — the instanced-pool root is registered here
because its pools cast only through dedicated passes that render each
pool as its own root.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### addSkipShadowObject

▸ **addSkipShadowObject**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### attachShadowLedger

▸ **attachShadowLedger**(`ledger`, `nearUnits?`, `farUnits?`): `void`

Share the per-frame shadow budget with the local light atlas. The near
cascade is priority 1 and only *records* its spend; far cascades ask for
a grant where the hard-coded one-far-per-frame rule used to be the only
throttle. With no ledger attached (or no local lights active — the
ledger grants unconditionally then), behavior is exactly today's.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `ledger` | [`CSMShadowLedger`](../interfaces/CSMShadowLedger.md) | `undefined` |
| `nearUnits` | `number` | `4` |
| `farUnits` | `number` | `6` |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### getCascadeMatrix

▸ **getCascadeMatrix**(`index`): `Matrix4`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`Matrix4`

___

### getCascadeSplit

▸ **getCascadeSplit**(`index`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`number`

___

### getDebugState

▸ **getDebugState**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `cascadeDirty` | `boolean`[] |
| `cascadeNeedsRender` | `boolean`[] |
| `currentShadowStrength` | `number` |
| `isCameraStill` | `boolean` |
| `lastFrameLightSwing` | `number` |
| `lastLightSwingPerSecond` | `number` |
| `lightLagRadians` | `number` |

___

### getShadowMap

▸ **getShadowMap**(`index`): `Texture`<`unknown`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`Texture`<`unknown`\>

___

### getUniforms

▸ **getUniforms**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `uCascadeSplits` | `number`[] |
| `uNumCascades` | `number` |
| `uShadowBias` | `number` |
| `uShadowMaps` | `Texture`<`unknown`\>[] |
| `uShadowMatrices` | `Matrix4`[] |
| `uShadowNormalBias` | `number` |
| `uShadowSideFaceBiasScale` | `number` |
| `uShadowSlopeBiasMin` | `number` |
| `uShadowSlopeBiasScale` | `number` |
| `uShadowTopFaceBiasScale` | `number` |

___

### hideNonCasters

▸ **hideNonCasters**(`scene`): `void`

Hide everything no depth pass may draw, for one shadow frame: the
never-casters (registered, or direct children of `scene` that
isMarkedNeverCaster marks), the registered exclusions and every
direct child of `scene` that
isNonCasterEffect identifies. Call once before the frame's
first depth pass (cascades and local lights alike) and pair with
[restoreNonCasters](CSMRenderer.md#restorenoncasters).

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene`<`Object3DEventMap`\> |

#### Returns

`void`

___

### markAllCascadesForRender

▸ **markAllCascadesForRender**(): `void`

#### Returns

`void`

___

### markCascadesForEntityRender

▸ **markCascadesForEntityRender**(): `void`

#### Returns

`void`

___

### rebuildSkipShadowCache

▸ **rebuildSkipShadowCache**(`scene`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene`<`Object3DEventMap`\> |

#### Returns

`void`

___

### removeNeverCaster

▸ **removeNeverCaster**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### removeShadowExclusion

▸ **removeShadowExclusion**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### removeSkipShadowObject

▸ **removeSkipShadowObject**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |

#### Returns

`void`

___

### render

▸ **render**(`renderer`, `scene`, `entities?`, `maxEntityShadowDistance?`, `instancePools?`, `poolBounds?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `renderer` | `WebGLRenderer` | `undefined` |
| `scene` | `Scene`<`Object3DEventMap`\> | `undefined` |
| `entities?` | `Object3D`<`Object3DEventMap`\>[] | `undefined` |
| `maxEntityShadowDistance` | `number` | `ENTITY_SHADOW_DISTANCE` |
| `instancePools?` | `Group`<`Object3DEventMap`\>[] | `undefined` |
| `poolBounds?` | readonly `Box3`[] | `undefined` |

#### Returns

`void`

___

### restoreNonCasters

▸ **restoreNonCasters**(): `void`

#### Returns

`void`

___

### setLightDirection

▸ **setLightDirection**(`direction`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `direction` | `Vector3` |

#### Returns

`void`

___

### setNonCasterExclusion

▸ **setNonCasterExclusion**(`isEnabled`): `void`

A/B switch for [hideNonCasters](CSMRenderer.md#hidenoncasters) (on by default). Off draws
see-through scene effects and registered exclusions into every depth
pass, as before the audit.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isEnabled` | `boolean` |

#### Returns

`void`

___

### setSingleCasterPass

▸ **setSingleCasterPass**(`isEnabled`): `void`

A/B switch for the single caster pass (on by default). Off draws near
entities and pools the old way: once in the whole-scene pass with the
generic depth material (instanced pools in their bind pose) and again,
on entity-refresh frames, through a reparented batch.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isEnabled` | `boolean` |

#### Returns

`void`

___

### update

▸ **update**(`mainCamera`, `sunDirection`, `playerPosition?`, `shadowStrength?`, `deltaSeconds?`): `void`

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `mainCamera` | `Camera` | `undefined` | - |
| `sunDirection` | `Vector3` | `undefined` | - |
| `playerPosition?` | `Vector3` | `undefined` | - |
| `shadowStrength` | `number` | `1` | - |
| `deltaSeconds?` | `number` | `undefined` | Time since the previous update. Measured between calls when omitted; a caller stepping a simulated clock passes its own. |

#### Returns

`void`
