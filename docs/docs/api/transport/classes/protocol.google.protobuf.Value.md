---
id: "protocol.google.protobuf.Value"
title: "Class: Value"
sidebar_label: "Value"
custom_edit_url: null
---

[google](../namespaces/protocol.google.md).[protobuf](../namespaces/protocol.google.protobuf.md).Value

Represents a Value.

## Implements

- [`IValue`](../interfaces/protocol.google.protobuf.IValue.md)

## Constructors

### constructor

• **new Value**(`properties?`): [`Value`](protocol.google.protobuf.Value.md)

Constructs a new Value.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IValue`](../interfaces/protocol.google.protobuf.IValue.md) | Properties to set |

#### Returns

[`Value`](protocol.google.protobuf.Value.md)

## Properties

### boolValue

• `Optional` **boolValue**: `boolean`

Value boolValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[boolValue](../interfaces/protocol.google.protobuf.IValue.md#boolvalue)

___

### kind

• `Optional` **kind**: ``"nullValue"`` \| ``"numberValue"`` \| ``"stringValue"`` \| ``"boolValue"`` \| ``"structValue"`` \| ``"listValue"``

Value kind.

___

### listValue

• `Optional` **listValue**: [`IListValue`](../interfaces/protocol.google.protobuf.IListValue.md)

Value listValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[listValue](../interfaces/protocol.google.protobuf.IValue.md#listvalue)

___

### nullValue

• `Optional` **nullValue**: [`NULL_VALUE`](../enums/protocol.google.protobuf.NullValue.md#null_value)

Value nullValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[nullValue](../interfaces/protocol.google.protobuf.IValue.md#nullvalue)

___

### numberValue

• `Optional` **numberValue**: `number`

Value numberValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[numberValue](../interfaces/protocol.google.protobuf.IValue.md#numbervalue)

___

### stringValue

• `Optional` **stringValue**: `string`

Value stringValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[stringValue](../interfaces/protocol.google.protobuf.IValue.md#stringvalue)

___

### structValue

• `Optional` **structValue**: [`IStruct`](../interfaces/protocol.google.protobuf.IStruct.md)

Value structValue.

#### Implementation of

[IValue](../interfaces/protocol.google.protobuf.IValue.md).[structValue](../interfaces/protocol.google.protobuf.IValue.md#structvalue)

## Methods

### create

▸ **create**(`properties?`): [`Value`](protocol.google.protobuf.Value.md)

Creates a new Value instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IValue`](../interfaces/protocol.google.protobuf.IValue.md) | Properties to set |

#### Returns

[`Value`](protocol.google.protobuf.Value.md)

Value instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Value`](protocol.google.protobuf.Value.md)

Decodes a Value message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Value`](protocol.google.protobuf.Value.md)

Value

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Value`](protocol.google.protobuf.Value.md)

Decodes a Value message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Value`](protocol.google.protobuf.Value.md)

Value

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Value message. Does not implicitly [verify](protocol.google.protobuf.Value.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IValue`](../interfaces/protocol.google.protobuf.IValue.md) | Value message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Value message, length delimited. Does not implicitly [verify](protocol.google.protobuf.Value.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IValue`](../interfaces/protocol.google.protobuf.IValue.md) | Value message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Value`](protocol.google.protobuf.Value.md)

Creates a Value message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Value`](protocol.google.protobuf.Value.md)

Value

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Value

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

Converts this Value to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Value message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Value`](protocol.google.protobuf.Value.md) | Value |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Value message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
