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

• **params**: [`RegistryParams`](../modules.md#registryparams-92)

Parameters to initialize the Voxelize registry.

___

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

The generated texture atlas built from all registered block textures.

___

### ranges

• **ranges**: `Map`<`string`, [`TextureRange`](../modules.md#texturerange-92)\>

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
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-92) |
| `transparent?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-92) |

## Methods

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata-78)[] | List of data to load into the game before the game starts. |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata-78) | The data of the texture and where the texture is applying to. |

#### Returns

`void`

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-92)

Get the block information by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block-92)

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-92)

Get the block information by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block-92)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block-92)

Reverse engineer to get the block information from a texture name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

[`Block`](../modules.md#block-92)

___

### getTransparencyByName

▸ **getTransparencyByName**(`name`): `boolean`

Get the transparency of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

`boolean`

___

### getTransparencyById

▸ **getTransparencyById**(`id`): `boolean`

Get the transparency of the block by ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

`boolean`

___

### getFluidityByName

▸ **getFluidityByName**(`name`): `boolean`

Get the fluidity of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

`boolean`

___

### getFluidityById

▸ **getFluidityById**(`id`): `boolean`

Get the fluidity of the block by ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

`boolean`

___

### getSolidityByName

▸ **getSolidityByName**(`name`): `boolean`

Get the solidity of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

`boolean`

___

### getSolidityById

▸ **getSolidityById**(`id`): `boolean`

Get the solidity of the block by ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

`boolean`

___

### getEmptinessByName

▸ **getEmptinessByName**(`name`): `boolean`

Get the emptiness of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

`boolean`

___

### getEmptinessById

▸ **getEmptinessById**(`id`): `boolean`

Get the emptiness of the block by ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

`boolean`

___

### getFacesByName

▸ **getFacesByName**(`name`): [`BlockFace`](../modules.md#blockface-92)[]

Get the faces/sides of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`BlockFace`](../modules.md#blockface-92)[]

___

### getFacesById

▸ **getFacesById**(`id`): [`BlockFace`](../modules.md#blockface-92)[]

Get the faces/sides of the block by ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`BlockFace`](../modules.md#blockface-92)[]

___

### getUVByName

▸ **getUVByName**(`name`): `Object`

Get the UV ranges of the block by name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The ID of the block to get. |

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
| `block` | [`Block`](../modules.md#block-92) |

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

### getSummary

▸ **getSummary**(): `Map`<`number`, [`Block`](../modules.md#block-92)\>

#### Returns

`Map`<`number`, [`Block`](../modules.md#block-92)\>

___

### hasType

▸ **hasType**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

## Accessors

### perSide

• `get` **perSide**(): `number`

#### Returns

`number`
