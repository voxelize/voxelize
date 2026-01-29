---
id: "Network"
title: "Class: Network"
sidebar_label: "Network"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new Network**(`options?`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`NetworkOptions`](../modules.md#networkoptions)\> |

#### Returns

[`Network`](Network.md)

## Properties

### clientInfo

• **clientInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `metadata?` | `Record`\<`string`, `any`\> |
| `username` | `string` |

___

### connected

• **connected**: `boolean` = `false`

___

### intercepts

• **intercepts**: [`NetIntercept`](../interfaces/NetIntercept.md)[] = `[]`

___

### joined

• **joined**: `boolean` = `false`

___

### onConnect

• **onConnect**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### onDisconnect

• **onDisconnect**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### onJoin

• **onJoin**: (`world`: `string`) => `void`

#### Type declaration

▸ (`world`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

##### Returns

`void`

___

### onLeave

• **onLeave**: (`world`: `string`) => `void`

#### Type declaration

▸ (`world`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

##### Returns

`void`

___

### options

• **options**: [`NetworkOptions`](../modules.md#networkoptions)

___

### socket

• **socket**: `URL`

___

### url

• **url**: `Url`\<\{ `[key: string]`: `any`;  }\>

___

### world

• **world**: `string`

___

### ws

• **ws**: [`ProtocolWS`](../modules.md#protocolws)

## Accessors

### concurrentWorkers

• `get` **concurrentWorkers**(): `number`

#### Returns

`number`

___

### packetQueueLength

• `get` **packetQueueLength**(): `number`

#### Returns

`number`

___

### rtcConnected

• `get` **rtcConnected**(): `boolean`

#### Returns

`boolean`

## Methods

### action

▸ **action**(`type`, `data?`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `data?` | `any` |

#### Returns

`Promise`\<`void`\>

___

### connect

▸ **connect**(`serverURL`, `options?`): `Promise`\<[`Network`](Network.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `serverURL` | `string` |
| `options` | [`NetworkConnectionOptions`](../modules.md#networkconnectionoptions) |

#### Returns

`Promise`\<[`Network`](Network.md)\>

___

### connectWebRTC

▸ **connectWebRTC**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

___

### disconnect

▸ **disconnect**(): `void`

#### Returns

`void`

___

### flush

▸ **flush**(): `void`

#### Returns

`void`

___

### join

▸ **join**(`world`): `Promise`\<[`Network`](Network.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

#### Returns

`Promise`\<[`Network`](Network.md)\>

___

### leave

▸ **leave**(): `void`

#### Returns

`void`

___

### register

▸ **register**(`...intercepts`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...intercepts` | [`NetIntercept`](../interfaces/NetIntercept.md)[] |

#### Returns

[`Network`](Network.md)

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

### setID

▸ **setID**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

___

### setMetadata

▸ **setMetadata**(`metadata`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `metadata` | `Record`\<`string`, `any`\> |

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

### sync

▸ **sync**(): `void`

#### Returns

`void`

___

### unregister

▸ **unregister**(`...intercepts`): [`Network`](Network.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...intercepts` | [`NetIntercept`](../interfaces/NetIntercept.md)[] |

#### Returns

[`Network`](Network.md)
