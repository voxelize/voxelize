---
id: "Chat"
title: "Class: Chat"
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

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Chat**(): [`Chat`](Chat.md)

#### Returns

[`Chat`](Chat.md)

## Properties

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

## Accessors

### commandSymbol

• `get` **commandSymbol**(): `string`

The symbol that is used to trigger commands.

#### Returns

`string`

## Methods

### addCommand

▸ **addCommand**(`trigger`, `process`, `aliases?`): `void`

Add a command to the chat system. Commands are case sensitive.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `trigger` | `string` | `undefined` | The text to trigger the command, needs to be one single word without spaces. |
| `process` | [`CommandProcessor`](../modules.md#commandprocessor) | `undefined` | The process run when this command is triggered. |
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

### send

▸ **send**(`chat`): `void`

Send a chat to the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `chat` | `ChatProtocol` | The chat message to send. |

#### Returns

`void`
