---
id: "protocol.protocol.Peer"
title: "Class: Peer"
sidebar_label: "Peer"
custom_edit_url: null
---

[protocol](../namespaces/protocol.md).[protocol](../namespaces/protocol.protocol.md).Peer

Represents a Peer.

## Implements

- [`IPeer`](../interfaces/protocol.protocol.IPeer.md)

## Constructors

### constructor

• **new Peer**(`properties?`): [`Peer`](protocol.protocol.Peer.md)

Constructs a new Peer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IPeer`](../interfaces/protocol.protocol.IPeer.md) | Properties to set |

#### Returns

[`Peer`](protocol.protocol.Peer.md)

## Properties

### id

• **id**: `string`

Peer id.

#### Implementation of

[IPeer](../interfaces/protocol.protocol.IPeer.md).[id](../interfaces/protocol.protocol.IPeer.md#id)

___

### metadata

• **metadata**: `string`

Peer metadata.

#### Implementation of

[IPeer](../interfaces/protocol.protocol.IPeer.md).[metadata](../interfaces/protocol.protocol.IPeer.md#metadata)

___

### username

• **username**: `string`

Peer username.

#### Implementation of

[IPeer](../interfaces/protocol.protocol.IPeer.md).[username](../interfaces/protocol.protocol.IPeer.md#username)

## Methods

### create

▸ **create**(`properties?`): [`Peer`](protocol.protocol.Peer.md)

Creates a new Peer instance using the specified properties.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `properties?` | [`IPeer`](../interfaces/protocol.protocol.IPeer.md) | Properties to set |

#### Returns

[`Peer`](protocol.protocol.Peer.md)

Peer instance

___

### decode

▸ **decode**(`reader`, `length?`): [`Peer`](protocol.protocol.Peer.md)

Decodes a Peer message from the specified reader or buffer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |
| `length?` | `number` | Message length if known beforehand |

#### Returns

[`Peer`](protocol.protocol.Peer.md)

Peer

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### decodeDelimited

▸ **decodeDelimited**(`reader`): [`Peer`](protocol.protocol.Peer.md)

Decodes a Peer message from the specified reader or buffer, length delimited.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `reader` | `Uint8Array` \| `Reader` | Reader or buffer to decode from |

#### Returns

[`Peer`](protocol.protocol.Peer.md)

Peer

**`Throws`**

If the payload is not a reader or valid buffer

**`Throws`**

If required fields are missing

___

### encode

▸ **encode**(`message`, `writer?`): `Writer`

Encodes the specified Peer message. Does not implicitly [verify](protocol.protocol.Peer.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IPeer`](../interfaces/protocol.protocol.IPeer.md) | Peer message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### encodeDelimited

▸ **encodeDelimited**(`message`, `writer?`): `Writer`

Encodes the specified Peer message, length delimited. Does not implicitly [verify](protocol.protocol.Peer.md#verify) messages.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`IPeer`](../interfaces/protocol.protocol.IPeer.md) | Peer message or plain object to encode |
| `writer?` | `Writer` | Writer to encode to |

#### Returns

`Writer`

Writer

___

### fromObject

▸ **fromObject**(`object`): [`Peer`](protocol.protocol.Peer.md)

Creates a Peer message from a plain object. Also converts values to their respective internal types.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object` | Plain object |

#### Returns

[`Peer`](protocol.protocol.Peer.md)

Peer

___

### getTypeUrl

▸ **getTypeUrl**(`typeUrlPrefix?`): `string`

Gets the default type url for Peer

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

Converts this Peer to JSON.

#### Returns

`Object`

JSON object

___

### toObject

▸ **toObject**(`message`, `options?`): `Object`

Creates a plain object from a Peer message. Also converts values to other types if specified.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | [`Peer`](protocol.protocol.Peer.md) | Peer |
| `options?` | `IConversionOptions` | Conversion options |

#### Returns

`Object`

Plain object

___

### verify

▸ **verify**(`message`): `string`

Verifies a Peer message.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `Object` | Plain object to verify |

#### Returns

`string`

`null` if valid, otherwise the reason why it is not
