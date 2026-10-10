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

• **new Chat**<`T`\>(): [`Chat`](Chat.md)<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ChatProtocol` = `ChatProtocol` |

#### Returns

[`Chat`](Chat.md)<`T`\>

## Properties

### joinHistory

• **joinHistory**: [`ChatHistoryUpdate`](../#chathistoryupdate) = `null`

The history replay of the latest (re)join, kept so a listener attached
after the INIT arrived can still read it.

___

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

___

### onHistory

• `Optional` **onHistory**: (`update`: [`ChatHistoryUpdate`](../#chathistoryupdate)) => `void`

Called with every page of the world's chat history: the replay a
(re)join brings, then each page `requestHistory` asks for. Those lines
never pass through `onChat`, so nothing a live line triggers (speech
bubbles, client actions in its metadata) runs again for them.

#### Type declaration

▸ (`update`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `update` | [`ChatHistoryUpdate`](../#chathistoryupdate) |

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

___

### isHistoryPending

• `get` **isHistoryPending**(): `boolean`

Whether a history page request is waiting for its answer.

#### Returns

`boolean`

## Methods

### addCommand

▸ **addCommand**<`T`\>(`trigger`, `process`, `options`): () => `void`

Add a command to the chat system. Commands are case sensitive.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ZodObject`<`Record`<`string`, `ZodTypeAny`\>, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\> = `ZodObject`<`Record`<`string`, `never`\>, `UnknownKeysParam`, `ZodTypeAny`, {}, {}\> |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `trigger` | `string` | The text to trigger the command, needs to be one single word without spaces. |
| `process` | (`args`: `TypeOf`<`T`\>) => `void` | The process run when this command is triggered, receives parsed typed args. |
| `options` | [`CommandOptions`](../#commandoptions)<`T`\> | Configuration for the command including Zod schema for args. |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### getAllCommands

▸ **getAllCommands**(): \{ `aliases`: `string`[] ; `args`: [`ArgMetadata`](../#argmetadata)[] ; `category?`: `string` ; `description`: `string` ; `flags`: `string`[] ; `isTabCompletePreFiltered`: `boolean` ; `trigger`: `string`  }[]

Get all registered commands with their documentation.
This filters out aliases and returns only the primary command triggers.

#### Returns

\{ `aliases`: `string`[] ; `args`: [`ArgMetadata`](../#argmetadata)[] ; `category?`: `string` ; `description`: `string` ; `flags`: `string`[] ; `isTabCompletePreFiltered`: `boolean` ; `trigger`: `string`  }[]

An array of command triggers with their descriptions, categories, aliases, and arg schemas.

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

### requestHistory

▸ **requestHistory**(`before`, `limit?`): `boolean`

Ask the server for up to `limit` lines older than `before` (a line's
`seq`). One request is in flight at a time; returns whether this one was
queued.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `before` | `number` | `undefined` |
| `limit` | `number` | `CHAT_HISTORY_PAGE_SIZE` |

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
| `fallback` | (`rest`: `string`) => `void` | The fallback command processor. |

#### Returns

`void`
