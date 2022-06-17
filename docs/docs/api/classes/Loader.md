---
id: "Loader"
title: "Class: Loader"
sidebar_label: "Loader"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** loader for Voxelize.

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### textures

• **textures**: `Map`<`string`, `Texture`\>

A map of all textures loaded by Voxelize.

___

### progress

• **progress**: `number` = `0`

The progress at which Loader has loaded, zero to one.

## Methods

### addTexture

▸ **addTexture**(`source`): `void`

Add a texture source to load from. Must be called before `client.connect`.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the texture file to load from. |

#### Returns

`void`

___

### getTexture

▸ **getTexture**(`source`): `Texture`

Get the loaded texture with this function.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the texture file loaded from. |

#### Returns

`Texture`
