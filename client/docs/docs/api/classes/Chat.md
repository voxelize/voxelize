---
id: "Chat"
title: "Class: Chat"
sidebar_label: "Chat"
sidebar_position: 0
custom_edit_url: null
---

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Chat**()

## Properties

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-556)

___

### onChat

• **onChat**: (`chat`: `ChatProtocol`) => `void`

#### Type declaration

▸ (`chat`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

##### Returns

`void`

## Methods

### send

▸ **send**(`chat`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

#### Returns

`void`

___

### addCommand

▸ **addCommand**(`trigger`, `process`, `aliases?`): `void`

Add a command to the chat system. Commands are case sensitive.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `trigger` | `string` | `undefined` | The text to trigger the command, needs to be one single word without spaces. |
| `process` | [`CommandProcessor`](../modules.md#commandprocessor-556) | `undefined` | The process run when this command is triggered. |
| `aliases` | `string`[] | `[]` | - |

#### Returns

`void`

___

### removeCommand

▸ **removeCommand**(`trigger`): `boolean`

Remove a command from the chat system. Case sensitive.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `trigger` | `string` | The trigger to remove. |

#### Returns

`boolean`

___

### onMessage

▸ **onMessage**(`message`): `void`

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-556)

## Accessors

### commandSymbol

• `get` **commandSymbol**(): `string`

#### Returns

`string`
