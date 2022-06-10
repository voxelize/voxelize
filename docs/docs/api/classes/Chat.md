---
id: "Chat"
title: "Class: Chat"
sidebar_label: "Chat"
sidebar_position: 0
custom_edit_url: null
---

The **built-in** chat of the Voxelize engine. Handles the networking of sending messages, and displaying
all messages received.

## Example
Access the chat through the client:
```ts
client.chat.enable();
```

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`ChatParams`](../modules.md#chatparams-72)

Parameters to initialize the Voxelize chat.

___

### enabled

• **enabled**: `boolean` = `false`

Whether this chat is enabled or not.

___

### messages

• **messages**: [`ChatMessage`](ChatMessage.md)[] = `[]`

The list of chat messages received in this session.

___

### history

• **history**: [`ChatHistory`](ChatHistory.md)

A manager to control the history of chats, used to retrieve old sent messages.

___

### gui

• **gui**: `Object`

The DOM elements of this chat.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `wrapper` | `HTMLDivElement` | The wrapper around both the chat and the input. |
| `messages` | `HTMLUListElement` | The list of all the received and rendered messages. |
| `input` | `HTMLInputElement` | The input of the chat. |

## Methods

### add

▸ **add**(`data`): `void`

Add a message to the chat.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `Object` | The data of new chat message. |
| `data.type` | [`MESSAGE_TYPE`](../modules.md#message_type-72) | Type of message, used for color rendering. |
| `data.sender?` | `string` | The name of the sender. |
| `data.body?` | `string` | The body text of the message. |

#### Returns

`void`

___

### enable

▸ **enable**(`isCommand?`): `void`

Opens the Voxelize chat. Sets the `client.inputs` namespace to "chat".

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `isCommand` | `boolean` | `false` | Whether if this is triggered to type a command. |

#### Returns

`void`

___

### disable

▸ **disable**(): `void`

Disable the chat of Voxelize. Sets the namespace back to "in-game".

#### Returns

`void`

___

### showMessages

▸ **showMessages**(): `void`

Show the chat messages list.

#### Returns

`void`

___

### showInput

▸ **showInput**(): `void`

Show the chat input.

#### Returns

`void`

___

### hideInput

▸ **hideInput**(): `void`

Hide the chat input.

#### Returns

`void`

___

### resetInput

▸ **resetInput**(): `string`

Return the chat input, setting the input to empty string.

#### Returns

`string`

___

### focusInput

▸ **focusInput**(): `void`

Focus the page onto the input element.

#### Returns

`void`

___

### blurInput

▸ **blurInput**(): `void`

Unfocus the page from the input element.

#### Returns

`void`

___

### applyMessagesStyles

▸ **applyMessagesStyles**(`styles`): `void`

Apply a set of styles to the messages list DOM element.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `styles` | `Partial`<`CSSStyleDeclaration`\> | An object describing the styles to be added to the DOM element. |

#### Returns

`void`

___

### applyInputStyles

▸ **applyInputStyles**(`styles`): `void`

Apply a set of styles to the chat input DOM element.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `styles` | `Partial`<`CSSStyleDeclaration`\> | An object describing the styles to be added to the DOM element. |

#### Returns

`void`

## Accessors

### inputValue

• `get` **inputValue**(): `string`

Get the value of the chat input.

#### Returns

`string`

• `set` **inputValue**(`value`): `void`

Set the value of the chat input.

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `string` |

#### Returns

`void`
