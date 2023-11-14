---
id: "protocol.protocol.Method"
title: "Class: Method"
sidebar_label: "Method"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).Method

Represents a Method.

## Implements

- [`IMethod`](../interfaces/protocol.protocol.IMethod.md)

## Constructors

### constructor

• **new Method**(`properties?`): [`Method`](protocol.protocol.Method.md)

Constructs a new Method.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IMethod`](../interfaces/protocol.protocol.IMethod.md) | Properties to set |

#### Returns

[`Method`](protocol.protocol.Method.md)

## Properties

### name

• **name**: `string`

Method name.

#### Implementation of

[IMethod](../interfaces/protocol.protocol.IMethod.md).[name](../interfaces/protocol.protocol.IMethod.md#name)

___

### payload

• **payload**: `string`

Method payload.

#### Implementation of

[IMethod](../interfaces/protocol.protocol.IMethod.md).[payload](../interfaces/protocol.protocol.IMethod.md#payload)

## Methods

### create

▸ **create**(`properties?`): [`Method`](protocol.protocol.Method.md)

Creates a new Method instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IMethod`](../interfaces/protocol.protocol.IMethod.md) | Properties to set |

#### Returns

[`Method`](protocol.protocol.Method.md)

Method instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Method`](protocol.protocol.Method.md)

Decodes a Method message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Method`](protocol.protocol.Method.md)

Method

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Method`](protocol.protocol.Method.md)

Decodes a Method message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Method`](protocol.protocol.Method.md)

Method

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Method message. Does not implicitly [verify](protocol.protocol.Method.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IMethod`](../interfaces/protocol.protocol.IMethod.md) | Method message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Method message, length delimited. Does not implicitly [verify](protocol.protocol.Method.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IMethod`](../interfaces/protocol.protocol.IMethod.md) | Method message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Method`](protocol.protocol.Method.md)

Creates a Method message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Method`](protocol.protocol.Method.md)

Method

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Method

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

Converts this Method to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Method message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Method`](protocol.protocol.Method.md) | Method |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Method message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
