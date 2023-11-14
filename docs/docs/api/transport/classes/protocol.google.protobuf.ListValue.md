---
id: "protocol.google.protobuf.ListValue"
title: "Class: ListValue"
sidebar_label: "ListValue"
custom_edit_url: null
---

[google](../namespaces/protocol.google.md).[protobuf](../namespaces/protocol.google.protobuf.md).ListValue

Represents a ListValue.

## Implements

- [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md)

## Constructors

### constructor

• **new ListValue**(`properties?`): [`ListValue`](protocol.google.protobuf.ListValue.md)

Constructs a new ListValue.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md) | Properties to set |

#### Returns

[`ListValue`](protocol.google.protobuf.ListValue.md)

## Properties

### values

• **values**: [`IValue`](../interfaces/protocol.google.protobuf.IValue.md)[]

ListValue values.

#### Implementation of

[IListValue](../interfaces/protocol.google.protobuf.IListValue.md).[values](../interfaces/protocol.google.protobuf.IListValue.md#values)

## Methods

### create

▸ **create**(`properties?`): [`ListValue`](protocol.google.protobuf.ListValue.md)

Creates a new ListValue instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md) | Properties to set |

#### Returns

[`ListValue`](protocol.google.protobuf.ListValue.md)

ListValue instance

___

### decode

▸ **decode**(`reader`, `length?`): [`ListValue`](protocol.google.protobuf.ListValue.md)

Decodes a ListValue message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`ListValue`](protocol.google.protobuf.ListValue.md)

ListValue

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`ListValue`](protocol.google.protobuf.ListValue.md)

Decodes a ListValue message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`ListValue`](protocol.google.protobuf.ListValue.md)

ListValue

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified ListValue message. Does not implicitly [verify](protocol.google.protobuf.ListValue.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md) | ListValue message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified ListValue message, length delimited. Does not implicitly [verify](protocol.google.protobuf.ListValue.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md) | ListValue message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`ListValue`](protocol.google.protobuf.ListValue.md)

Creates a ListValue message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`ListValue`](protocol.google.protobuf.ListValue.md)

ListValue

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for ListValue

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

Converts this ListValue to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a ListValue message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`ListValue`](protocol.google.protobuf.ListValue.md) | ListValue |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a ListValue message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
