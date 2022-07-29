---
id: "Chat"
title: "Class: Chat"
sidebar_label: "Chat"
sidebar_position: 0
custom_edit_url: null
---

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Properties

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-4)

___

### commandSymbol

• **commandSymbol**: `string` = `"/"`

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

## Constructors

### constructor

• **new Chat**(`commandSymbol?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `commandSymbol` | `string` | `"/"` |

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
| `process` | [`CommandProcessor`](../modules.md#commandprocessor-4) | `undefined` | The process run when this command is triggered. |
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

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-4)
