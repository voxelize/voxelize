---
id: "Registry"
title: "Class: Registry"
sidebar_label: "Registry"
sidebar_position: 0
custom_edit_url: null
---

A client-side manager for blocks. This class will receive block data on connecting to a server, and will
be responsible for loading the block textures and creating the block instances that can be queried.

Registry is by default created by the world and is available as [registry](World.md#registry-96).

# Example
```ts
// Register a new texture to all faces of type "Test".
world.registry.applyTextureByName(
  name: "Test",
  sides: VOXELIZE.ALL_FACES,
  data: "https://example.com/test.png"
});
```

## Methods

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata-96) | The data of the texture and where the texture is applying to. |

#### Returns

`void`

___

### checkHeight

▸ **checkHeight**(`id`): `boolean`

Check if a block ID should be counted as a potential max height block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block. |

#### Returns

`boolean`

Whether or not should this block be counted as a potential max height at the voxel column.

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-96)

Get the block information by its ID. Call this after connecting to the server, or else
no blocks will be loaded yet.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block-96)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-96)

Get the block information by its name. Call this after connecting to the server, or else
no blocks will be loaded yet.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block-96)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): `Object`

Reverse engineer to get the block information from a texture name. Call this after connecting to the server, or else
no blocks will be loaded yet.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block-96) |
| `side` | `string` |

___

### load

▸ **load**(`blocks`, `ranges`): `void`

Load blocks from the server and generate atlas. This is called automatically by the world.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `blocks` | [`Block`](../modules.md#block-96)[] | A list of blocks received from the server. |
| `ranges` | `Object` | A map of UV ranges for all registered blocks. This is generated and loaded from the server, then passed into creating the texture atlas. |

#### Returns

`void`

___

### makeSideName

▸ `Static` **makeSideName**(`name`, `side`): `string`

Generate a key for the block's side.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block. |
| `side` | `string` | The side of the block. |

#### Returns

`string`

A string representing the side's texture key.

## Properties

### blocksById

• **blocksById**: `Map`<`number`, [`Block`](../modules.md#block-96)\>

A map of blocks by their IDs.

___

### blocksByName

• **blocksByName**: `Map`<`string`, [`Block`](../modules.md#block-96)\>

A map of blocks by their names.

___

### keyframes

• **keyframes**: `Map`<`string`, { `data`: [`number`, `string` \| `Texture` \| `Color`][] ; `fadeFrames`: `number`  }\>

A map of side names to their corresponding keyframe sources.

___

### nameMap

• **nameMap**: `Map`<`number`, `string`\>

A map of block ID to block name.

___

### ranges

• **ranges**: `Map`<`string`, [`TextureRange`](../modules.md#texturerange-96)\>

A map of UV ranges for all registered blocks. This is generated and loaded from the server, then passed into creating the texture atlas.

___

### sources

• **sources**: `Map`<`string`, `string` \| `Color`\>

A map of side names to their corresponding texture sources.

___

### textures

• **textures**: `Set`<`string`\>

A set of side names that are currently registered.

___

### typeMap

• **typeMap**: `Map`<`string`, `number`\>

A map of block name to block ID.

## Accessors

### perSide

• `get` **perSide**(): `number`

On the texture atlas, how many textures are on each side.

#### Returns

`number`
