---
id: "Registry"
title: "Class: Registry"
sidebar_label: "Registry"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** block registry for Voxelize.

## Methods

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata-156) | The data of the texture and where the texture is applying to. |

#### Returns

`void`

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata-156)[] | List of data to load into the game before the game starts. |

#### Returns

`void`

___

### checkHeight

▸ **checkHeight**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-156)

Get the block information by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block-156)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-156)

Get the block information by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block-156)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block-156)

Reverse engineer to get the block information from a texture name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

[`Block`](../modules.md#block-156)

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

## Properties

### blocksById

• **blocksById**: `Map`<`number`, [`Block`](../modules.md#block-156)\>

A map of blocks by their IDs.

___

### blocksByName

• **blocksByName**: `Map`<`string`, [`Block`](../modules.md#block-156)\>

A map of blocks by their names.

___

### ranges

• **ranges**: `Map`<`string`, [`TextureRange`](../modules.md#texturerange-156)\>

A map of UV ranges for all registered blocks.

___

### sources

• **sources**: `Map`<`string`, `string` \| `Color`\>

___

### textures

• **textures**: `Set`<`string`\>

## Constructors

### constructor

• **new Registry**()

## Accessors

### perSide

• `get` **perSide**(): `number`

On the texture atlas, how many textures are on each side.

#### Returns

`number`
