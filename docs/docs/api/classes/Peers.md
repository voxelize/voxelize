---
id: "Peers"
title: "Class: Peers"
sidebar_label: "Peers"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Map`<`string`, [`Peer`](Peer.md)\>

  ↳ **`Peers`**

## Properties

### params

• **params**: [`PeerParams`](../modules.md#peerparams)

___

### client

• **client**: [`Client`](Client.md)

___

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

___

### [toStringTag]

• `Readonly` **[toStringTag]**: `string`

#### Inherited from

Map.\_\_@toStringTag@10422

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@10951

## Constructors

### constructor

• **new Peers**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`PeersParams`](../modules.md#peersparams)\> |

#### Overrides

Map&lt;string, Peer\&gt;.constructor

## Methods

### addPeer

▸ **addPeer**(`id`, `connection`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `connection` | `Instance` |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### broadcast

▸ **broadcast**(`encoded`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `encoded` | `any` |

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`

___

### clear

▸ **clear**(): `void`

#### Returns

`void`

#### Inherited from

Map.clear

___

### delete

▸ **delete**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Inherited from

Map.delete

___

### forEach

▸ **forEach**(`callbackfn`, `thisArg?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callbackfn` | (`value`: [`Peer`](Peer.md), `key`: `string`, `map`: `Map`<`string`, [`Peer`](Peer.md)\>) => `void` |
| `thisArg?` | `any` |

#### Returns

`void`

#### Inherited from

Map.forEach

___

### get

▸ **get**(`key`): [`Peer`](Peer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`Peer`](Peer.md)

#### Inherited from

Map.get

___

### has

▸ **has**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Inherited from

Map.has

___

### set

▸ **set**(`key`, `value`): [`Peers`](Peers.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`Peer`](Peer.md) |

#### Returns

[`Peers`](Peers.md)

#### Inherited from

Map.set

___

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`Peer`](Peer.md)]\>

Returns an iterable of entries in the map.

#### Returns

`IterableIterator`<[`string`, [`Peer`](Peer.md)]\>

#### Inherited from

Map.\_\_@iterator@10426

___

### entries

▸ **entries**(): `IterableIterator`<[`string`, [`Peer`](Peer.md)]\>

Returns an iterable of key, value pairs for every entry in the map.

#### Returns

`IterableIterator`<[`string`, [`Peer`](Peer.md)]\>

#### Inherited from

Map.entries

___

### keys

▸ **keys**(): `IterableIterator`<`string`\>

Returns an iterable of keys in the map

#### Returns

`IterableIterator`<`string`\>

#### Inherited from

Map.keys

___

### values

▸ **values**(): `IterableIterator`<[`Peer`](Peer.md)\>

Returns an iterable of values in the map

#### Returns

`IterableIterator`<[`Peer`](Peer.md)\>

#### Inherited from

Map.values
