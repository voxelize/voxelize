---
id: "protocol.protocol.Geometry"
title: "Class: Geometry"
sidebar_label: "Geometry"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).Geometry

Represents a Geometry.

## Implements

- [`IGeometry`](../interfaces/protocol.protocol.IGeometry.md)

## Constructors

### constructor

• **new Geometry**(`properties?`): [`Geometry`](protocol.protocol.Geometry.md)

Constructs a new Geometry.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IGeometry`](../interfaces/protocol.protocol.IGeometry.md) | Properties to set |

#### Returns

[`Geometry`](protocol.protocol.Geometry.md)

## Properties

### \_faceName

• `Optional` **\_faceName**: ``"faceName"``

Geometry _faceName.

___

### at

• **at**: `number`[]

Geometry at.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[at](../interfaces/protocol.protocol.IGeometry.md#at)

___

### faceName

• `Optional` **faceName**: `string`

Geometry faceName.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[faceName](../interfaces/protocol.protocol.IGeometry.md#facename)

___

### indices

• **indices**: `number`[]

Geometry indices.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[indices](../interfaces/protocol.protocol.IGeometry.md#indices)

___

### lights

• **lights**: `number`[]

Geometry lights.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[lights](../interfaces/protocol.protocol.IGeometry.md#lights)

___

### positions

• **positions**: `number`[]

Geometry positions.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[positions](../interfaces/protocol.protocol.IGeometry.md#positions)

___

### uvs

• **uvs**: `number`[]

Geometry uvs.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[uvs](../interfaces/protocol.protocol.IGeometry.md#uvs)

___

### voxel

• **voxel**: `number`

Geometry voxel.

#### Implementation of

[IGeometry](../interfaces/protocol.protocol.IGeometry.md).[voxel](../interfaces/protocol.protocol.IGeometry.md#voxel)

## Methods

### create

▸ **create**(`properties?`): [`Geometry`](protocol.protocol.Geometry.md)

Creates a new Geometry instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IGeometry`](../interfaces/protocol.protocol.IGeometry.md) | Properties to set |

#### Returns

[`Geometry`](protocol.protocol.Geometry.md)

Geometry instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Geometry`](protocol.protocol.Geometry.md)

Decodes a Geometry message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Geometry`](protocol.protocol.Geometry.md)

Geometry

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Geometry`](protocol.protocol.Geometry.md)

Decodes a Geometry message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Geometry`](protocol.protocol.Geometry.md)

Geometry

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Geometry message. Does not implicitly [verify](protocol.protocol.Geometry.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IGeometry`](../interfaces/protocol.protocol.IGeometry.md) | Geometry message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Geometry message, length delimited. Does not implicitly [verify](protocol.protocol.Geometry.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IGeometry`](../interfaces/protocol.protocol.IGeometry.md) | Geometry message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Geometry`](protocol.protocol.Geometry.md)

Creates a Geometry message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Geometry`](protocol.protocol.Geometry.md)

Geometry

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Geometry

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

Converts this Geometry to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Geometry message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Geometry`](protocol.protocol.Geometry.md) | Geometry |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Geometry message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
