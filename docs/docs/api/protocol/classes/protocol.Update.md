---
id: "protocol.Update"
title: "Class: Update"
sidebar_label: "Update"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).Update

Represents an Update.

## Implements

- [`IUpdate`](../interfaces/protocol.IUpdate.md)

## Constructors

### constructor

• **new Update**(`properties?`): [`Update`](protocol.Update.md)

Constructs a new Update.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IUpdate`](../interfaces/protocol.IUpdate.md) | Properties to set |

#### Returns

[`Update`](protocol.Update.md)

## Properties

### light

• **light**: `number`

Update light.

#### Implementation of

[IUpdate](../interfaces/protocol.IUpdate.md).[light](../interfaces/protocol.IUpdate.md#light)

___

### voxel

• **voxel**: `number`

Update voxel.

#### Implementation of

[IUpdate](../interfaces/protocol.IUpdate.md).[voxel](../interfaces/protocol.IUpdate.md#voxel)

___

### vx

• **vx**: `number`

Update vx.

#### Implementation of

[IUpdate](../interfaces/protocol.IUpdate.md).[vx](../interfaces/protocol.IUpdate.md#vx)

___

### vy

• **vy**: `number`

Update vy.

#### Implementation of

[IUpdate](../interfaces/protocol.IUpdate.md).[vy](../interfaces/protocol.IUpdate.md#vy)

___

### vz

• **vz**: `number`

Update vz.

#### Implementation of

[IUpdate](../interfaces/protocol.IUpdate.md).[vz](../interfaces/protocol.IUpdate.md#vz)

## Methods

### create

▸ **create**(`properties?`): [`Update`](protocol.Update.md)

Creates a new Update instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IUpdate`](../interfaces/protocol.IUpdate.md) | Properties to set |

#### Returns

[`Update`](protocol.Update.md)

Update instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Update`](protocol.Update.md)

Decodes an Update message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array`\<`ArrayBufferLike`\> | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Update`](protocol.Update.md)

Update

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Update`](protocol.Update.md)

Decodes an Update message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Reader` \| `Uint8Array`\<`ArrayBufferLike`\> | Reader or buffer to decode from |

#### Returns

[`Update`](protocol.Update.md)

Update

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Update message. Does not implicitly [verify](protocol.Update.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IUpdate`](../interfaces/protocol.IUpdate.md) | Update message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Update message, length delimited. Does not implicitly [verify](protocol.Update.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IUpdate`](../interfaces/protocol.IUpdate.md) | Update message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Update`](protocol.Update.md)

Creates an Update message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Update`](protocol.Update.md)

Update

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Update

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

Converts this Update to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from an Update message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Update`](protocol.Update.md) | Update |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies an Update message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
