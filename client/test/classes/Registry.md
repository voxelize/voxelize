[@voxelize/client](../README.md) / [Exports](../modules.md) / Registry

# Class: Registry

## Table of contents

### Constructors

- [constructor](Registry.md#constructor)

### Properties

- [blocksById](Registry.md#blocksbyid)
- [blocksByName](Registry.md#blocksbyname)
- [nameMap](Registry.md#namemap)
- [ranges](Registry.md#ranges)
- [sources](Registry.md#sources)
- [textures](Registry.md#textures)
- [typeMap](Registry.md#typemap)

### Accessors

- [perSide](Registry.md#perside)

### Methods

- [applyTextureByName](Registry.md#applytexturebyname)
- [applyTexturesByNames](Registry.md#applytexturesbynames)
- [getBlockById](Registry.md#getblockbyid)
- [getBlockByName](Registry.md#getblockbyname)
- [getBlockByTextureName](Registry.md#getblockbytexturename)
- [getUVMap](Registry.md#getuvmap)
- [makeSideName](Registry.md#makesidename)
- [recordBlock](Registry.md#recordblock)

## Constructors

### constructor

• **new Registry**()

## Properties

### blocksById

• **blocksById**: `Map`<`number`, [`Block`](../modules.md#block)\>

#### Defined in

[client/src/core/world/registry.ts:62](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L62)

___

### blocksByName

• **blocksByName**: `Map`<`string`, [`Block`](../modules.md#block)\>

#### Defined in

[client/src/core/world/registry.ts:57](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L57)

___

### nameMap

• `Private` **nameMap**: `Map`<`number`, `string`\>

#### Defined in

[client/src/core/world/registry.ts:67](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L67)

___

### ranges

• **ranges**: `Map`<`string`, [`TextureRange`](../modules.md#texturerange)\>

#### Defined in

[client/src/core/world/registry.ts:52](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L52)

___

### sources

• **sources**: `Map`<`string`, `string` \| `Color`\>

#### Defined in

[client/src/core/world/registry.ts:64](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L64)

___

### textures

• **textures**: `Set`<`string`\>

#### Defined in

[client/src/core/world/registry.ts:66](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L66)

___

### typeMap

• `Private` **typeMap**: `Map`<`string`, `number`\>

#### Defined in

[client/src/core/world/registry.ts:68](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L68)

## Accessors

### perSide

• `get` **perSide**(): `number`

#### Returns

`number`

#### Defined in

[client/src/core/world/registry.ts:241](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L241)

## Methods

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata) |  |

#### Returns

`void`

#### Defined in

[client/src/core/world/registry.ts:102](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L102)

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata)[] |  |

#### Returns

`void`

#### Defined in

[client/src/core/world/registry.ts:91](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L91)

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/registry.ts:124](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L124)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/registry.ts:115](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L115)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/registry.ts:133](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L133)

___

### getUVMap

▸ `Private` **getUVMap**(`block`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block) |

#### Returns

`Object`

#### Defined in

[client/src/core/world/registry.ts:250](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L250)

___

### makeSideName

▸ **makeSideName**(`name`, `side`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `side` | `string` |

#### Returns

`string`

#### Defined in

[client/src/core/world/registry.ts:234](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L234)

___

### recordBlock

▸ `Private` **recordBlock**(`block`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block) |

#### Returns

`void`

#### Defined in

[client/src/core/world/registry.ts:264](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L264)
