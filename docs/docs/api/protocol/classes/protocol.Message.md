---
id: "protocol.Message"
title: "Class: Message"
sidebar_label: "Message"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).Message

Represents a Message.

## Implements

- [`IMessage`](../interfaces/protocol.IMessage.md)

## Constructors

### constructor

• **new Message**(`properties?`): [`Message`](protocol.Message.md)

Constructs a new Message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IMessage`](../interfaces/protocol.IMessage.md) | Properties to set |

#### Returns

[`Message`](protocol.Message.md)

## Properties

### chat

• `Optional` **chat**: [`IChatMessage`](../interfaces/protocol.IChatMessage.md)

Message chat.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[chat](../interfaces/protocol.IMessage.md#chat)

___

### chunks

• **chunks**: [`IChunk`](../interfaces/protocol.IChunk.md)[]

Message chunks.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[chunks](../interfaces/protocol.IMessage.md#chunks)

___

### entities

• **entities**: [`IEntity`](../interfaces/protocol.IEntity.md)[]

Message entities.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[entities](../interfaces/protocol.IMessage.md#entities)

___

### events

• **events**: [`IEvent`](../interfaces/protocol.IEvent.md)[]

Message events.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[events](../interfaces/protocol.IMessage.md#events)

___

### json

• **json**: `string`

Message json.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[json](../interfaces/protocol.IMessage.md#json)

___

### method

• `Optional` **method**: [`IMethod`](../interfaces/protocol.IMethod.md)

Message method.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[method](../interfaces/protocol.IMessage.md#method)

___

### peers

• **peers**: [`IPeer`](../interfaces/protocol.IPeer.md)[]

Message peers.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[peers](../interfaces/protocol.IMessage.md#peers)

___

### text

• **text**: `string`

Message text.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[text](../interfaces/protocol.IMessage.md#text)

___

### type

• **type**: [`Type`](../enums/protocol.Message-1.Type.md)

Message type.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[type](../interfaces/protocol.IMessage.md#type)

___

### updates

• **updates**: [`IUpdate`](../interfaces/protocol.IUpdate.md)[]

Message updates.

#### Implementation of

[IMessage](../interfaces/protocol.IMessage.md).[updates](../interfaces/protocol.IMessage.md#updates)

## Methods

### create

▸ **create**(`properties?`): [`Message`](protocol.Message.md)

Creates a new Message instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IMessage`](../interfaces/protocol.IMessage.md) | Properties to set |

#### Returns

[`Message`](protocol.Message.md)

Message instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Message`](protocol.Message.md)

Decodes a Message message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Message`](protocol.Message.md)

Message

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Message`](protocol.Message.md)

Decodes a Message message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array` | Reader or buffer to decode from |

#### Returns

[`Message`](protocol.Message.md)

Message

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Message message. Does not implicitly [verify](protocol.Message.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IMessage`](../interfaces/protocol.IMessage.md) | Message message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Message message, length delimited. Does not implicitly [verify](protocol.Message.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IMessage`](../interfaces/protocol.IMessage.md) | Message message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Message`](protocol.Message.md)

Creates a Message message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Message`](protocol.Message.md)

Message

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Message

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `typeUrlPrefix?` | `string` | your custom typeUrlPrefix(default "type.googleapis.com") |

#### Returns

`string`

The default type url

___

### toJSON

▸ **toJSON**(): `Object`

Converts this Message to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Message message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Message`](protocol.Message.md) | Message |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Message message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
