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
| `options` | `Partial`<[`NetworkOptions`](../#networkoptions)\> |

#### Returns

[`Network`](Network.md)

## Properties

### clientInfo

• **clientInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `metadata?` | `Record`<`string`, `any`\> |
| `username` | `string` |

___

### connected

• **connected**: `boolean` = `false`

___

### disconnectReason

• **disconnectReason**: `string` = `""`

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

• **options**: [`NetworkOptions`](../#networkoptions)

___

### socket

• **socket**: `URL`

___

### url

• **url**: `Url`<\{ `[key: string]`: `any`;  }\>

___

### world

• **world**: `string`

___

### ws

• **ws**: [`ProtocolWS`](../#protocolws) = `null`

## Accessors

### concurrentWorkers

• `get` **concurrentWorkers**(): `number`

#### Returns

`number`

___

### droppedCommandCount

• `get` **droppedCommandCount**(): `number`

Command packets dropped for good, with an error logged for each batch.

#### Returns

`number`

___

### droppedPacketCount

• `get` **droppedPacketCount**(): `number`

Inbound packets dropped unprocessed this session, each reported in an
error log (see [NetworkOptions.maxQueuedPackets](../#maxqueuedpackets)).

#### Returns

`number`

___

### isClientOutdated

• `get` **isClientOutdated**(): `boolean`

Terminal protocol rejection: only a fresh client build can reconnect.

#### Returns

`boolean`

___

### isJoinPending

• `get` **isJoinPending**(): `boolean`

True between a (re)join request and its INIT: reads of world state are
answered from a map the server may no longer agree with.

#### Returns

`boolean`

___

### joinGeneration

• `get` **joinGeneration**(): `number`

Completed INIT handshakes so far; bumps on first join, every rejoin,
and every world switch.

#### Returns

`number`

___

### packetQueueLength

• `get` **packetQueueLength**(): `number`

#### Returns

`number`

___

### pendingCommandCount

• `get` **pendingCommandCount**(): `number`

Command packets waiting for a live session to retry on.

#### Returns

`number`

___

### rtcConnected

• `get` **rtcConnected**(): `boolean`

#### Returns

`boolean`

___

### serverUrl

• `get` **serverUrl**(): `string`

#### Returns

`string`

## Methods

### action

▸ **action**(`type`, `data?`): `Promise`<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `data?` | `any` |

#### Returns

`Promise`<`void`\>

___

### connect

▸ **connect**(`serverURL`, `options?`): `Promise`<[`Network`](Network.md)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `serverURL` | `string` |
| `options` | [`NetworkConnectionOptions`](../#networkconnectionoptions) |

#### Returns

`Promise`<[`Network`](Network.md)\>

___

### connectWebRTC

▸ **connectWebRTC**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

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

### isPacketPendingSend

▸ **isPacketPendingSend**(`packet`): `boolean`

Whether this exact packet object is still waiting in the command retry
queue. Together with the packet's absence from its intercept queue this
lets a caller prove a command was handed to an OPEN socket.

#### Parameters

| Name | Type |
| :------ | :------ |
| `packet` | `MessageProtocol` |

#### Returns

`boolean`

___

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

### reconnectNow

▸ **reconnectNow**(): `boolean`

Trigger an immediate reconnect attempt, bypassing the periodic backoff.
Returns false when there is nothing to do: already connected, never
connected, or terminally rejected (outdated client build).

#### Returns

`boolean`

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

▸ **send**(`event`): `boolean`

Hand one event to the socket. Returns whether the packet was actually
given to an OPEN socket: `false` means it was NOT sent (no socket, still
connecting, closing, or closed). Callers that carry one-shot intent must
check the answer; [flush](Network.md#flush) does this for every intercept packet.

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `any` |

#### Returns

`boolean`

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
| `metadata` | `Record`<`string`, `any`\> |

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
