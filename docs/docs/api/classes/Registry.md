---
id: "Registry"
title: "Class: Registry"
sidebar_label: "Registry"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`RegistryParams`](../modules.md#registryparams-56)

___

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

___

### ranges

• **ranges**: `Map`<`string`, `TextureRange`\>

___

### atlasUniform

• **atlasUniform**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Texture` |

___

### aoUniform

• **aoUniform**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Vector4` |

___

### minLightUniform

• **minLightUniform**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### materials

• **materials**: `Object` = `{}`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-56) |
| `transparent?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-56) |

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Registry**(`client`, `params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`RegistryParams`](../modules.md#registryparams-56)\> |

## Methods

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `textures` | { `name`: `string` ; `side`: `BlockFace` ; `data`: `string` \| `Color`  }[] |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`name`, `side`, `data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `side` | `BlockFace` |
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
| `side` | `BlockFace` |
| `path` | `string` |

#### Returns

`void`

___

### load

▸ **load**(`blocks`, `ranges`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `blocks` | `Block`[] |
| `ranges` | `Object` |

#### Returns

`void`

___

### getBlockByName

▸ **getBlockByName**(`name`): `Block`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Block`

___

### getBlockById

▸ **getBlockById**(`id`): `Block`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`Block`

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

▸ **getFacesByName**(`name`): `BlockFace`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`BlockFace`[]

___

### getFacesById

▸ **getFacesById**(`id`): `BlockFace`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`BlockFace`[]

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
| `block` | `Block` |

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

### getFacesMap

▸ `Static` **getFacesMap**(`faces`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `faces` | `BlockFace`[] |

#### Returns

`Object`

___

### fixTextureBleeding

▸ `Static` **fixTextureBleeding**(`startU`, `startV`, `endU`, `endV`): `number`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `startU` | `number` |
| `startV` | `number` |
| `endU` | `number` |
| `endV` | `number` |

#### Returns

`number`[]

## Accessors

### perSide

• `get` **perSide**(): `number`

#### Returns

`number`
