---
id: "Network"
title: "Class: Network"
sidebar_label: "Network"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### ws

• **ws**: `CustomWebSocket`

___

### id

• **id**: `string`

___

### url

• **url**: `Url`<`QueryParams`\>

___

### world

• **world**: `string`

___

### socket

• **socket**: `Url`<`QueryParams`\>

___

### connected

• **connected**: `boolean` = `false`

___

### client

• **client**: [`Client`](Client.md)

___

### params

• **params**: [`NetworkParams`](../modules.md#networkparams-36)

## Constructors

### constructor

• **new Network**(`client`, `params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | [`NetworkParams`](../modules.md#networkparams-36) |

## Methods

### connect

▸ **connect**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### disconnect

▸ **disconnect**(): `void`

#### Returns

`void`

___

### fetch

▸ **fetch**(`path`, `query?`): `Promise`<`any`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `string` |
| `query` | `Object` |

#### Returns

`Promise`<`any`\>

___

### send

▸ **send**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `any` |

#### Returns

`void`

___

### decode

▸ **decode**(`data`): `Promise`<`any`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`<`any`\>

___

### decodeSync

▸ `Static` **decodeSync**(`buffer`): `Message`

#### Parameters

| Name | Type |
| :------ | :------ |
| `buffer` | `any` |

#### Returns

`Message`

___

### encode

▸ `Static` **encode**(`message`): `Uint8Array`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `any` |

#### Returns

`Uint8Array`

## Accessors

### concurrentWorkers

• `get` **concurrentWorkers**(): `number`

#### Returns

`number`
