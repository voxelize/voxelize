---
id: "Network"
title: "Class: Network"
sidebar_label: "Network"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
server and handles the Protocol Buffer encoding and decoding.

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`NetworkParams`](../modules.md#networkparams-12)

Parameters to initialize the Network instance.

___

### ws

• **ws**: [`ProtocolWS`](../modules.md#protocolws-12)

The WebSocket client for Voxelize.

___

### url

• **url**: `Url`<{ `[key: string]`: `any`;  }\>

A [domurl Url instance](https://github.com/Mikhus/domurl) constructed with `network.params.serverURL`,
representing a HTTP connection URL to the server.

___

### world

• **world**: `string`

The name of the world that the client is connected to.

___

### socket

• **socket**: `Url`<{ `[key: string]`: `any`;  }\>

A [domurl Url instance](https://github.com/Mikhus/domurl) constructed with `network.params.serverURL`,
representing a WebSocket connection URL to the server.

___

### connected

• **connected**: `boolean` = `false`

Whether or not the network connection is established.

## Methods

### send

▸ **send**(`event`): `void`

Encode and send a protocol buffer message to the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `any` | An object that obeys the protocol buffers. |

#### Returns

`void`

___

### decode

▸ **decode**(`data`): `Promise`<`any`\>

Decode a byte array into protocol buffer objects.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `Uint8Array` | Data to offload to the worker pool to decode. |

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

The number of active workers decoding network packets.

#### Returns

`number`
