---
id: "Transport"
title: "Class: Transport"
sidebar_label: "Transport"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `client`

  ↳ **`Transport`**

## Constructors

### constructor

• **new Transport**(`reconnectTimeout?`): [`Transport`](Transport.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `reconnectTimeout?` | `number` |

#### Returns

[`Transport`](Transport.md)

#### Overrides

WebSocket.constructor

## Properties

### MessageTypes

▪ `Static` **MessageTypes**: typeof [`Type`](../enums/protocol.protocol.Message-1.Type.md) = `Message.Type`

___

### connection

• **connection**: `connection`

___

### onAction

• `Optional` **onAction**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onChat

• `Optional` **onChat**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onEntity

• `Optional` **onEntity**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onError

• `Optional` **onError**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onEvent

• `Optional` **onEvent**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onInit

• `Optional` **onInit**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onJoin

• `Optional` **onJoin**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onLeave

• `Optional` **onLeave**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onLoad

• `Optional` **onLoad**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onMethod

• `Optional` **onMethod**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onPeer

• `Optional` **onPeer**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onTransport

• `Optional` **onTransport**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onUnload

• `Optional` **onUnload**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### onUpdate

• `Optional` **onUpdate**: (`event`: [`MessageProtocol`](../modules.md#messageprotocol)) => `void`

#### Type declaration

▸ (`event`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

##### Returns

`void`

___

### reconnectTimeout

• `Optional` **reconnectTimeout**: `number`

## Methods

### connect

▸ **connect**(`address`, `secret`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `address` | `string` |
| `secret` | `string` |

#### Returns

`Promise`\<`void`\>

#### Overrides

WebSocket.connect

___

### decodeSync

▸ **decodeSync**(`buffer`): [`MessageProtocol`](../modules.md#messageprotocol)

#### Parameters

| Name | Type |
| :------ | :------ |
| `buffer` | `any` |

#### Returns

[`MessageProtocol`](../modules.md#messageprotocol)

___

### encodeSync

▸ **encodeSync**(`message`): `Uint8Array`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `any` |

#### Returns

`Uint8Array`

___

### send

▸ **send**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | [`MessageProtocol`](../modules.md#messageprotocol) |

#### Returns

`void`

___

### tryReconnect

▸ **tryReconnect**(): `void`

#### Returns

`void`
