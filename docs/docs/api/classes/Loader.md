---
id: "Loader"
title: "Class: Loader"
sidebar_label: "Loader"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### textures

• **textures**: `Map`<`string`, `Texture`\>

___

### progress

• **progress**: `number` = `0`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Loader**(`client`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

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
