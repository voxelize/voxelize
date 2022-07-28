[@voxelize/client](../README.md) / [Exports](../modules.md) / Network

# Class: Network

## Hierarchy

- `EventEmitter`

  ↳ **`Network`**

## Table of contents

### Constructors

- [constructor](Network.md#constructor)

### Properties

- [clientInfo](Network.md#clientinfo)
- [connected](Network.md#connected)
- [intercepts](Network.md#intercepts)
- [joinResolve](Network.md#joinresolve)
- [joined](Network.md#joined)
- [params](Network.md#params)
- [pool](Network.md#pool)
- [reconnection](Network.md#reconnection)
- [socket](Network.md#socket)
- [url](Network.md#url)
- [world](Network.md#world)
- [ws](Network.md#ws)
- [defaultMaxListeners](Network.md#defaultmaxlisteners)

### Accessors

- [concurrentWorkers](Network.md#concurrentworkers)

### Methods

- [addListener](Network.md#addlistener)
- [decode](Network.md#decode)
- [emit](Network.md#emit)
- [eventNames](Network.md#eventnames)
- [flush](Network.md#flush)
- [getMaxListeners](Network.md#getmaxlisteners)
- [join](Network.md#join)
- [leave](Network.md#leave)
- [listenerCount](Network.md#listenercount)
- [listeners](Network.md#listeners)
- [off](Network.md#off)
- [on](Network.md#on)
- [onMessage](Network.md#onmessage)
- [once](Network.md#once)
- [prependListener](Network.md#prependlistener)
- [prependOnceListener](Network.md#prependoncelistener)
- [rawListeners](Network.md#rawlisteners)
- [register](Network.md#register)
- [removeAllListeners](Network.md#removealllisteners)
- [removeListener](Network.md#removelistener)
- [send](Network.md#send)
- [setID](Network.md#setid)
- [setMaxListeners](Network.md#setmaxlisteners)
- [setUsername](Network.md#setusername)
- [encodeSync](Network.md#encodesync)
- [listenerCount](Network.md#listenercount-1)

## Constructors

### constructor

• **new Network**()

#### Inherited from

EventEmitter.constructor

## Properties

### clientInfo

• **clientInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `username` | `string` |

#### Defined in

[client/src/core/network/index.ts:56](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L56)

___

### connected

• **connected**: `boolean` = `false`

#### Defined in

[client/src/core/network/index.ts:101](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L101)

___

### intercepts

• **intercepts**: [`NetIntercept`](../interfaces/NetIntercept.md)[] = `[]`

#### Defined in

[client/src/core/network/index.ts:67](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L67)

___

### joinResolve

• `Private` **joinResolve**: (`value`: [`Network`](Network.md)) => `void` = `null`

#### Type declaration

▸ (`value`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `value` | [`Network`](Network.md) |

##### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:109](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L109)

___

### joined

• **joined**: `boolean` = `false`

#### Defined in

[client/src/core/network/index.ts:102](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L102)

___

### params

• **params**: [`NetworkParams`](../modules.md#networkparams)

#### Defined in

[client/src/core/network/index.ts:72](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L72)

___

### pool

• `Private` **pool**: [`WorkerPool`](WorkerPool.md)

#### Defined in

[client/src/core/network/index.ts:104](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L104)

___

### reconnection

• `Private` **reconnection**: `any`

#### Defined in

[client/src/core/network/index.ts:108](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L108)

___

### socket

• **socket**: `URL`

#### Defined in

[client/src/core/network/index.ts:96](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L96)

___

### url

• **url**: `Url`<{ `[key: string]`: `any`;  }\>

#### Defined in

[client/src/core/network/index.ts:83](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L83)

___

### world

• **world**: `string`

#### Defined in

[client/src/core/network/index.ts:90](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L90)

___

### ws

• **ws**: [`ProtocolWS`](../modules.md#protocolws)

#### Defined in

[client/src/core/network/index.ts:77](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L77)

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

#### Inherited from

EventEmitter.defaultMaxListeners

#### Defined in

node_modules/@types/events/index.d.ts:11

## Accessors

### concurrentWorkers

• `get` **concurrentWorkers**(): `number`

#### Returns

`number`

#### Defined in

[client/src/core/network/index.ts:290](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L290)

## Methods

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

#### Defined in

node_modules/@types/events/index.d.ts:17

___

### decode

▸ `Private` **decode**(`data`): `Promise`<`any`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `Uint8Array` |  |

#### Returns

`Promise`<`any`\>

#### Defined in

[client/src/core/network/index.ts:347](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L347)

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

#### Defined in

node_modules/@types/events/index.d.ts:16

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

#### Inherited from

EventEmitter.eventNames

#### Defined in

node_modules/@types/events/index.d.ts:13

___

### flush

▸ **flush**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:227](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L227)

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

#### Inherited from

EventEmitter.getMaxListeners

#### Defined in

node_modules/@types/events/index.d.ts:15

___

### join

▸ **join**(`world`): `Promise`<[`Network`](Network.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

#### Returns

`Promise`<[`Network`](Network.md)\>

#### Defined in

[client/src/core/network/index.ts:189](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L189)

___

### leave

▸ **leave**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:212](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L212)

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

#### Defined in

node_modules/@types/events/index.d.ts:26

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

#### Defined in

node_modules/@types/events/index.d.ts:25

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

#### Defined in

node_modules/@types/events/index.d.ts:23

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

#### Defined in

node_modules/@types/events/index.d.ts:18

___

### onMessage

▸ `Private` **onMessage**(`message`): `Promise`<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`Promise`<`void`\>

#### Defined in

[client/src/core/network/index.ts:294](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L294)

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

#### Defined in

node_modules/@types/events/index.d.ts:19

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

#### Defined in

node_modules/@types/events/index.d.ts:20

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

#### Defined in

node_modules/@types/events/index.d.ts:21

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

#### Defined in

node_modules/@types/events/index.d.ts:27

___

### register

▸ **register**(...`intercepts`): `this`

#### Parameters

| Name | Type |
| :------ | :------ |
| `...intercepts` | [`NetIntercept`](../interfaces/NetIntercept.md)[] |

#### Returns

`this`

#### Defined in

[client/src/core/network/index.ts:239](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L239)

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

#### Defined in

node_modules/@types/events/index.d.ts:24

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

#### Defined in

node_modules/@types/events/index.d.ts:22

___

### send

▸ **send**(`event`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `any` |  |

#### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:275](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L275)

___

### setID

▸ **setID**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:279](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L279)

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

#### Defined in

node_modules/@types/events/index.d.ts:14

___

### setUsername

▸ **setUsername**(`username`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `username` | `string` |

#### Returns

`void`

#### Defined in

[client/src/core/network/index.ts:283](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L283)

___

### encodeSync

▸ `Static` `Private` **encodeSync**(`message`): `Uint8Array`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `any` |

#### Returns

`Uint8Array`

#### Defined in

[client/src/core/network/index.ts:324](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L324)

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

#### Defined in

node_modules/@types/events/index.d.ts:10
