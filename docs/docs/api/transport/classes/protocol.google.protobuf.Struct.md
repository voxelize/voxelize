---
id: "protocol.google.protobuf.Struct"
title: "Class: Struct"
sidebar_label: "Struct"
custom_edit_url: null
---

[google](../namespaces/protocol.google.md).[protobuf](../namespaces/protocol.google.protobuf.md).Struct

Represents a Struct.

## Implements

- [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md)

## Constructors

### constructor

• **new Struct**(`properties?`): [`Struct`](protocol.google.protobuf.Struct.md)

Constructs a new Struct.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md) | Properties to set |

#### Returns

[`Struct`](protocol.google.protobuf.Struct.md)

## Properties

### fields

• **fields**: `Object`

Struct fields.

#### Index signature

▪ [k: `string`]: [`IValue`](../interfaces/protocol.google.protobuf.IValue.md)

#### Implementation of

[IStruct](../interfaces/protocol.google.protobuf.IStruct.md).[fields](../interfaces/protocol.google.protobuf.IStruct.md#fields)

## Methods

### create

▸ **create**(`properties?`): [`Struct`](protocol.google.protobuf.Struct.md)

Creates a new Struct instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md) | Properties to set |

#### Returns

[`Struct`](protocol.google.protobuf.Struct.md)

Struct instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Struct`](protocol.google.protobuf.Struct.md)

Decodes a Struct message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Struct`](protocol.google.protobuf.Struct.md)

Struct

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Struct`](protocol.google.protobuf.Struct.md)

Decodes a Struct message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Struct`](protocol.google.protobuf.Struct.md)

Struct

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Struct message. Does not implicitly [verify](protocol.google.protobuf.Struct.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md) | Struct message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Struct message, length delimited. Does not implicitly [verify](protocol.google.protobuf.Struct.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md) | Struct message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Struct`](protocol.google.protobuf.Struct.md)

Creates a Struct message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Struct`](protocol.google.protobuf.Struct.md)

Struct

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Struct

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

Converts this Struct to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Struct message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Struct`](protocol.google.protobuf.Struct.md) | Struct |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Struct message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
