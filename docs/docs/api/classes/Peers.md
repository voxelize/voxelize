---
id: "Peers"
title: "Class: Peers"
sidebar_label: "Peers"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** manager for the peer clients in the same Voxelize world.

## Hierarchy

- `Map`<`string`, [`Peer`](Peer.md)\>

  ↳ **`Peers`**

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`PeerParams`](../modules.md#peerparams-508)

Parameters to initialize the Peers manager.

## Methods

### broadcast

▸ **broadcast**(`event`): `void`

Send a protocol buffer event to all peers.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `any` | A protocol buffer object. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`
