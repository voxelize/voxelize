---
id: "Network"
title: "Class: Network"
sidebar_label: "Network"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** network connector to the Voxelize backend. Establishes a WebSocket connection to the backend
server and handles the Protocol Buffer encoding and decoding.

## Hierarchy

- `EventEmitter`

  ↳ **`Network`**

## Properties

### clientInfo

• **clientInfo**: `Object`

Reference linking back to the Voxelize client instance.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `username` | `string` |

___

### intercepts

• **intercepts**: [`NetIntercept`](../interfaces/NetIntercept.md)[] = `[]`

The interceptions to network events.

___

### params

• **params**: [`NetworkParams`](../modules.md#networkparams-4)

Parameters to initialize the Network instance.

___

### ws

• **ws**: [`ProtocolWS`](../modules.md#protocolws-4)

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

• **socket**: `URL`

A native URL instance constructed with `network.params.serverURL`,
representing a WebSocket connection URL to the server.

___

### connected

• **connected**: `boolean` = `false`

Whether or not the network connection is established.

___

### joined

• **joined**: `boolean` = `false`

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

#### Inherited from

EventEmitter.defaultMaxListeners

## Constructors

### constructor

• **new Network**()

#### Inherited from

EventEmitter.constructor

## Methods

### join

▸ **join**(`world`): `Promise`<[`Network`](Network.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

#### Returns

`Promise`<[`Network`](Network.md)\>

___

### leave

▸ **leave**(): `void`

#### Returns

`void`

___

### flush

▸ **flush**(): `void`

#### Returns

`void`

___

### register

▸ **register**(...`intercepts`): `this`

#### Parameters

| Name | Type |
| :------ | :------ |
| `...intercepts` | [`NetIntercept`](../interfaces/NetIntercept.md)[] |

#### Returns

`this`

___

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

### setID

▸ **setID**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

___

### setUsername

▸ **setUsername**(`username`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `username` | `string` |

#### Returns

`void`

___

### listenerCount

▸ `Static` **listenerCount**(`emitter`, `type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` |
| `type` | `string` \| `number` |

#### Returns

`number`

#### Inherited from

EventEmitter.listenerCount

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

#### Inherited from

EventEmitter.eventNames

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.setMaxListeners

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

#### Inherited from

EventEmitter.getMaxListeners

___

### emit

▸ **emit**(`type`, ...`args`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `...args` | `any`[] |

#### Returns

`boolean`

#### Inherited from

EventEmitter.emit

___

### addListener

▸ **addListener**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.addListener

___

### on

▸ **on**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.on

___

### once

▸ **once**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.once

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.prependListener

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.prependOnceListener

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.removeListener

___

### off

▸ **off**(`type`, `listener`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.off

___

### removeAllListeners

▸ **removeAllListeners**(`type?`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`Network`](Network.md)

#### Inherited from

EventEmitter.removeAllListeners

___

### listeners

▸ **listeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Inherited from

EventEmitter.listeners

___

### listenerCount

▸ **listenerCount**(`type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`number`

#### Inherited from

EventEmitter.listenerCount

___

### rawListeners

▸ **rawListeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Inherited from

EventEmitter.rawListeners

## Accessors

### concurrentWorkers

• `get` **concurrentWorkers**(): `number`

The number of active workers decoding network packets.

#### Returns

`number`
