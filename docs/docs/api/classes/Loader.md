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

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `string` |

#### Returns

`void`

___

### getTexture

▸ **getTexture**(`source`): `Texture`

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `string` |

#### Returns

`Texture`

___

### load

▸ **load**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>
