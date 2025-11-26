---
id: "Chat"
title: "Class: Chat<T>"
sidebar_label: "Chat"
sidebar_position: 0
custom_edit_url: null
---

A network interceptor that gives flexible control over the chat feature of
the game. This also allows for custom commands to be added.

# Example
```ts
const chat = new VOXELIZE.Chat();

// Listen to incoming chat messages.
chat.onChat = (chat: ChatMessage) => {
  console.log(chat);
};

// Sending a chat message.
chat.send({
  type: "CLIENT",
  sender: "Mr. Robot",
  body: "Hello world!",
});

// Register to the network.
network.register(chat);
```

![Chat](/img/docs/chat.png)

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ChatProtocol` = `ChatProtocol` |

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Chat**\<`T`\>(): [`Chat`](Chat.md)\<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ChatProtocol` = `ChatProtocol` |

#### Returns

[`Chat`](Chat.md)\<`T`\>

## Properties

### onChat

• **onChat**: (`chat`: `T`) => `void`

#### Type declaration

▸ (`chat`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `T` |

##### Returns

`void`

## Accessors

### commandSymbol

• `get` **commandSymbol**(): `string`

The symbol that is used to trigger commands.

#### Returns

`string`

___

### commandSymbolCode

• `get` **commandSymbolCode**(): `string`

#### Returns

`string`

## Methods

### addCommand

▸ **addCommand**(`trigger`, `process`, `options?`): () => `void`

Add a command to the chat system. Commands are case sensitive.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `trigger` | `string` | The text to trigger the command, needs to be one single word without spaces. |
| `process` | [`CommandProcessor`](../modules.md#commandprocessor) | The process run when this command is triggered. |
| `options` | [`CommandOptions`](../modules.md#commandoptions) | Optional configuration for the command (description, category, aliases). |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### getAllCommands

▸ **getAllCommands**(): \{ `aliases`: `string`[] ; `category?`: `string` ; `description`: `string` ; `flags`: `string`[] ; `trigger`: `string`  }[]

Get all registered commands with their documentation.
This filters out aliases and returns only the primary command triggers.

#### Returns

\{ `aliases`: `string`[] ; `category?`: `string` ; `description`: `string` ; `flags`: `string`[] ; `trigger`: `string`  }[]

An array of command triggers with their descriptions, categories, and aliases.

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

### send

▸ **send**(`chat`): `void`

Send a chat to the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `chat` | `T` | The chat message to send. |

#### Returns

`void`

___

### setFallbackCommand

▸ **setFallbackCommand**(`fallback`): `void`

Set a fallback command to be executed when no matching command is found.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `fallback` | [`CommandProcessor`](../modules.md#commandprocessor) | The fallback command processor. |

#### Returns

`void`
