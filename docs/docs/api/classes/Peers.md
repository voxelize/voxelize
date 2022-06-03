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
