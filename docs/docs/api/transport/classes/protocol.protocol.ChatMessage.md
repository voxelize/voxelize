---
id: "protocol.protocol.ChatMessage"
title: "Class: ChatMessage"
sidebar_label: "ChatMessage"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).ChatMessage

Represents a ChatMessage.

## Implements

- [`IChatMessage`](../interfaces/protocol.protocol.IChatMessage.md)

## Constructors

### constructor

• **new ChatMessage**(`properties?`): [`ChatMessage`](protocol.protocol.ChatMessage.md)

Constructs a new ChatMessage.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IChatMessage`](../interfaces/protocol.protocol.IChatMessage.md) | Properties to set |

#### Returns

[`ChatMessage`](protocol.protocol.ChatMessage.md)

## Properties

### body

• **body**: `string`

ChatMessage body.

#### Implementation of

[IChatMessage](../interfaces/protocol.protocol.IChatMessage.md).[body](../interfaces/protocol.protocol.IChatMessage.md#body)

___

### sender

• **sender**: `string`

ChatMessage sender.

#### Implementation of

[IChatMessage](../interfaces/protocol.protocol.IChatMessage.md).[sender](../interfaces/protocol.protocol.IChatMessage.md#sender)

___

### type

• **type**: `string`

ChatMessage type.

#### Implementation of

[IChatMessage](../interfaces/protocol.protocol.IChatMessage.md).[type](../interfaces/protocol.protocol.IChatMessage.md#type)

## Methods

### create

▸ **create**(`properties?`): [`ChatMessage`](protocol.protocol.ChatMessage.md)

Creates a new ChatMessage instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IChatMessage`](../interfaces/protocol.protocol.IChatMessage.md) | Properties to set |

#### Returns

[`ChatMessage`](protocol.protocol.ChatMessage.md)

ChatMessage instance

___

### decode

▸ **decode**(`reader`, `length?`): [`ChatMessage`](protocol.protocol.ChatMessage.md)

Decodes a ChatMessage message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`ChatMessage`](protocol.protocol.ChatMessage.md)

ChatMessage

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`ChatMessage`](protocol.protocol.ChatMessage.md)

Decodes a ChatMessage message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`ChatMessage`](protocol.protocol.ChatMessage.md)

ChatMessage

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified ChatMessage message. Does not implicitly [verify](protocol.protocol.ChatMessage.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IChatMessage`](../interfaces/protocol.protocol.IChatMessage.md) | ChatMessage message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified ChatMessage message, length delimited. Does not implicitly [verify](protocol.protocol.ChatMessage.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IChatMessage`](../interfaces/protocol.protocol.IChatMessage.md) | ChatMessage message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`ChatMessage`](protocol.protocol.ChatMessage.md)

Creates a ChatMessage message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`ChatMessage`](protocol.protocol.ChatMessage.md)

ChatMessage

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for ChatMessage

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

Converts this ChatMessage to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a ChatMessage message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`ChatMessage`](protocol.protocol.ChatMessage.md) | ChatMessage |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a ChatMessage message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
