---
id: "protocol.Chunk"
title: "Class: Chunk"
sidebar_label: "Chunk"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).Chunk

Represents a Chunk.

## Implements

- [`IChunk`](../interfaces/protocol.IChunk.md)

## Constructors

### constructor

• **new Chunk**(`properties?`): [`Chunk`](protocol.Chunk.md)

Constructs a new Chunk.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IChunk`](../interfaces/protocol.IChunk.md) | Properties to set |

#### Returns

[`Chunk`](protocol.Chunk.md)

## Properties

### id

• **id**: `string`

Chunk id.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[id](../interfaces/protocol.IChunk.md#id)

___

### lights

• **lights**: `number`[]

Chunk lights.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[lights](../interfaces/protocol.IChunk.md#lights)

___

### meshes

• **meshes**: [`IMesh`](../interfaces/protocol.IMesh.md)[]

Chunk meshes.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[meshes](../interfaces/protocol.IChunk.md#meshes)

___

### voxels

• **voxels**: `number`[]

Chunk voxels.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[voxels](../interfaces/protocol.IChunk.md#voxels)

___

### x

• **x**: `number`

Chunk x.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[x](../interfaces/protocol.IChunk.md#x)

___

### z

• **z**: `number`

Chunk z.

#### Implementation of

[IChunk](../interfaces/protocol.IChunk.md).[z](../interfaces/protocol.IChunk.md#z)

## Methods

### create

▸ **create**(`properties?`): [`Chunk`](protocol.Chunk.md)

Creates a new Chunk instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IChunk`](../interfaces/protocol.IChunk.md) | Properties to set |

#### Returns

[`Chunk`](protocol.Chunk.md)

Chunk instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Chunk`](protocol.Chunk.md)

Decodes a Chunk message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array`\<`ArrayBufferLike`\> | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Chunk`](protocol.Chunk.md)

Chunk

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Chunk`](protocol.Chunk.md)

Decodes a Chunk message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array`\<`ArrayBufferLike`\> | Reader or buffer to decode from |

#### Returns

[`Chunk`](protocol.Chunk.md)

Chunk

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Chunk message. Does not implicitly [verify](protocol.Chunk.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IChunk`](../interfaces/protocol.IChunk.md) | Chunk message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Chunk message, length delimited. Does not implicitly [verify](protocol.Chunk.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IChunk`](../interfaces/protocol.IChunk.md) | Chunk message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Chunk`](protocol.Chunk.md)

Creates a Chunk message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Chunk`](protocol.Chunk.md)

Chunk

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Chunk

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

Converts this Chunk to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Chunk message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Chunk`](protocol.Chunk.md) | Chunk |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Chunk message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
