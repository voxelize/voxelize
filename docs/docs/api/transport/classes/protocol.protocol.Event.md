---
id: "protocol.protocol.Event"
title: "Class: Event"
sidebar_label: "Event"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).Event

Represents an Event.

## Implements

- [`IEvent`](../interfaces/protocol.protocol.IEvent.md)

## Constructors

### constructor

• **new Event**(`properties?`): [`Event`](protocol.protocol.Event.md)

Constructs a new Event.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IEvent`](../interfaces/protocol.protocol.IEvent.md) | Properties to set |

#### Returns

[`Event`](protocol.protocol.Event.md)

## Properties

### name

• **name**: `string`

Event name.

#### Implementation of

[IEvent](../interfaces/protocol.protocol.IEvent.md).[name](../interfaces/protocol.protocol.IEvent.md#name)

___

### payload

• **payload**: `string`

Event payload.

#### Implementation of

[IEvent](../interfaces/protocol.protocol.IEvent.md).[payload](../interfaces/protocol.protocol.IEvent.md#payload)

## Methods

### create

▸ **create**(`properties?`): [`Event`](protocol.protocol.Event.md)

Creates a new Event instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IEvent`](../interfaces/protocol.protocol.IEvent.md) | Properties to set |

#### Returns

[`Event`](protocol.protocol.Event.md)

Event instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Event`](protocol.protocol.Event.md)

Decodes an Event message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Event`](protocol.protocol.Event.md)

Event

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Event`](protocol.protocol.Event.md)

Decodes an Event message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Event`](protocol.protocol.Event.md)

Event

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Event message. Does not implicitly [verify](protocol.protocol.Event.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IEvent`](../interfaces/protocol.protocol.IEvent.md) | Event message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Event message, length delimited. Does not implicitly [verify](protocol.protocol.Event.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IEvent`](../interfaces/protocol.protocol.IEvent.md) | Event message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Event`](protocol.protocol.Event.md)

Creates an Event message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Event`](protocol.protocol.Event.md)

Event

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Event

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

Converts this Event to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from an Event message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Event`](protocol.protocol.Event.md) | Event |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies an Event message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
