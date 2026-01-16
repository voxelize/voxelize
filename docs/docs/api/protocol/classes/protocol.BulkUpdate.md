---
id: "protocol.BulkUpdate"
title: "Class: BulkUpdate"
sidebar_label: "BulkUpdate"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).BulkUpdate

Represents a BulkUpdate.

## Implements

- [`IBulkUpdate`](../interfaces/protocol.IBulkUpdate.md)

## Constructors

### constructor

• **new BulkUpdate**(`properties?`): [`BulkUpdate`](protocol.BulkUpdate.md)

Constructs a new BulkUpdate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IBulkUpdate`](../interfaces/protocol.IBulkUpdate.md) | Properties to set |

#### Returns

[`BulkUpdate`](protocol.BulkUpdate.md)

## Properties

### lights

• **lights**: `number`[]

BulkUpdate lights.

#### Implementation of

[IBulkUpdate](../interfaces/protocol.IBulkUpdate.md).[lights](../interfaces/protocol.IBulkUpdate.md#lights)

___

### voxels

• **voxels**: `number`[]

BulkUpdate voxels.

#### Implementation of

[IBulkUpdate](../interfaces/protocol.IBulkUpdate.md).[voxels](../interfaces/protocol.IBulkUpdate.md#voxels)

___

### vx

• **vx**: `number`[]

BulkUpdate vx.

#### Implementation of

[IBulkUpdate](../interfaces/protocol.IBulkUpdate.md).[vx](../interfaces/protocol.IBulkUpdate.md#vx)

___

### vy

• **vy**: `number`[]

BulkUpdate vy.

#### Implementation of

[IBulkUpdate](../interfaces/protocol.IBulkUpdate.md).[vy](../interfaces/protocol.IBulkUpdate.md#vy)

___

### vz

• **vz**: `number`[]

BulkUpdate vz.

#### Implementation of

[IBulkUpdate](../interfaces/protocol.IBulkUpdate.md).[vz](../interfaces/protocol.IBulkUpdate.md#vz)

## Methods

### create

▸ **create**(`properties?`): [`BulkUpdate`](protocol.BulkUpdate.md)

Creates a new BulkUpdate instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IBulkUpdate`](../interfaces/protocol.IBulkUpdate.md) | Properties to set |

#### Returns

[`BulkUpdate`](protocol.BulkUpdate.md)

BulkUpdate instance

___

### decode

▸ **decode**(`reader`, `length?`): [`BulkUpdate`](protocol.BulkUpdate.md)

Decodes a BulkUpdate message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array`\<`ArrayBufferLike`\> \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`BulkUpdate`](protocol.BulkUpdate.md)

BulkUpdate

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`BulkUpdate`](protocol.BulkUpdate.md)

Decodes a BulkUpdate message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array`\<`ArrayBufferLike`\> \| `Reader` | Reader or buffer to decode from |

#### Returns

[`BulkUpdate`](protocol.BulkUpdate.md)

BulkUpdate

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified BulkUpdate message. Does not implicitly [verify](protocol.BulkUpdate.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IBulkUpdate`](../interfaces/protocol.IBulkUpdate.md) | BulkUpdate message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified BulkUpdate message, length delimited. Does not implicitly [verify](protocol.BulkUpdate.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IBulkUpdate`](../interfaces/protocol.IBulkUpdate.md) | BulkUpdate message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`BulkUpdate`](protocol.BulkUpdate.md)

Creates a BulkUpdate message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`BulkUpdate`](protocol.BulkUpdate.md)

BulkUpdate

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for BulkUpdate

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

Converts this BulkUpdate to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a BulkUpdate message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`BulkUpdate`](protocol.BulkUpdate.md) | BulkUpdate |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a BulkUpdate message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
