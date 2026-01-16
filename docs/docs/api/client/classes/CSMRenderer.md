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
| `config` | `Partial`\<[`CSMConfig`](../interfaces/CSMConfig.md)\> |

#### Returns

[`CSMRenderer`](CSMRenderer.md)

## Accessors

### numCascades

• `get` **numCascades**(): `number`

#### Returns

`number`

___

### shadowBias

• `get` **shadowBias**(): `number`

#### Returns

`number`

## Methods

### addSkipShadowObject

▸ **addSkipShadowObject**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> |

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

### getShadowMap

▸ **getShadowMap**(`index`): `Texture`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`Texture`

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
| `uShadowMaps` | `Texture`[] |
| `uShadowMatrices` | `Matrix4`[] |

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
| `scene` | `Scene` |

#### Returns

`void`

___

### removeSkipShadowObject

▸ **removeSkipShadowObject**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> |

#### Returns

`void`

___

### render

▸ **render**(`renderer`, `scene`, `entities?`, `maxEntityShadowDistance?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `renderer` | `WebGLRenderer` | `undefined` |
| `scene` | `Scene` | `undefined` |
| `entities?` | `Object3D`\<`Object3DEventMap`\>[] | `undefined` |
| `maxEntityShadowDistance` | `number` | `32` |

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

### update

▸ **update**(`mainCamera`, `sunDirection`, `playerPosition?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `mainCamera` | `Camera` |
| `sunDirection` | `Vector3` |
| `playerPosition?` | `Vector3` |

#### Returns

`void`
