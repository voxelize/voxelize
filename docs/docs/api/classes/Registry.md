---
id: "Registry"
title: "Class: Registry"
sidebar_label: "Registry"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** block registry for Voxelize.

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`RegistryParams`](../modules.md#registryparams-88)

Parameters to initialize the Voxelize registry.

___

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

The generated texture atlas built from all registered block textures.

___

### ranges

• **ranges**: `Map`<`string`, [`TextureRange`](../modules.md#texturerange-88)\>

A map of UV ranges for all registered blocks.

___

### atlasUniform

• **atlasUniform**: `Object`

The uniform for the texture atlas to work with chunks.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Texture` |

___

### aoUniform

• **aoUniform**: `Object`

A `Vector4` representing the [4 levels of ambient occlusion](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Vector4` |

___

### minLightUniform

• **minLightUniform**: `Object`

The minimum sunlight for each block rendered.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### materials

• **materials**: `Object` = `{}`

The shared material instances for chunks.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-88) |
| `transparent?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-88) |

## Methods

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `textures` | { `name`: `string` ; `side`: [`BlockFace`](../modules.md#blockface-88) ; `data`: `string` \| `Color`  }[] |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`name`, `side`, `data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `side` | [`BlockFace`](../modules.md#blockface-88) |
| `data` | `string` \| `Color` |

#### Returns

`void`

___

### applyTextureById

▸ **applyTextureById**(`id`, `side`, `path`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `side` | [`BlockFace`](../modules.md#blockface-88) |
| `path` | `string` |

#### Returns

`void`

___

### load

▸ **load**(`blocks`, `ranges`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `blocks` | [`Block`](../modules.md#block-88)[] |
| `ranges` | `Object` |

#### Returns

`void`

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-88)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Block`](../modules.md#block-88)

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-88)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

[`Block`](../modules.md#block-88)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block-88)

#### Parameters

| Name | Type |
| :------ | :------ |
| `textureName` | `string` |

#### Returns

[`Block`](../modules.md#block-88)

___

### getTransparencyByName

▸ **getTransparencyByName**(`name`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

___

### getTransparencyById

▸ **getTransparencyById**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getFluidityByName

▸ **getFluidityByName**(`name`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

___

### getFluidityById

▸ **getFluidityById**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getSolidityByName

▸ **getSolidityByName**(`name`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

___

### getSolidityById

▸ **getSolidityById**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getEmptinessByName

▸ **getEmptinessByName**(`name`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

___

### getEmptinessById

▸ **getEmptinessById**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getFacesByName

▸ **getFacesByName**(`name`): [`BlockFace`](../modules.md#blockface-88)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`BlockFace`](../modules.md#blockface-88)[]

___

### getFacesById

▸ **getFacesById**(`id`): [`BlockFace`](../modules.md#blockface-88)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

[`BlockFace`](../modules.md#blockface-88)[]

___

### getUVByName

▸ **getUVByName**(`name`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Object`

___

### getUVById

▸ **getUVById**(`id`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`Object`

___

### getUVMap

▸ **getUVMap**(`block`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block-88) |

#### Returns

`Object`

___

### getUV

▸ **getUV**(`id`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`Object`

___

### getTypeMap

▸ **getTypeMap**(`blocks`): `string`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `blocks` | `string`[] |

#### Returns

`string`[]

___

### getBlockMap

▸ **getBlockMap**(): `Object`

#### Returns

`Object`

___

### hasType

▸ **hasType**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getSummary

▸ **getSummary**(): `Map`<`number`, [`Block`](../modules.md#block-88)\>

#### Returns

`Map`<`number`, [`Block`](../modules.md#block-88)\>

## Accessors

### perSide

• `get` **perSide**(): `number`

#### Returns

`number`
