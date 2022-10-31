---
id: "modules"
title: "@voxelize/transport"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Classes

- [Transport](classes/Transport.md)

## Type Aliases

### GeometryProtocol

Ƭ **GeometryProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `identifier` | `number` |
| `positions` | `number`[] |
| `uvs` | `number`[] |
| `indices` | `number`[] |
| `lights` | `number`[] |

___

### MeshProtocol

Ƭ **MeshProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `level` | `number` |
| `opaque` | [`GeometryProtocol`](modules.md#geometryprotocol) |
| `transparent` | [`GeometryProtocol`](modules.md#geometryprotocol)[] |

___

### ChunkProtocol

Ƭ **ChunkProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `z` | `number` |
| `id` | `string` |
| `meshes` | [`MeshProtocol`](modules.md#meshprotocol)[] |
| `voxels` | `Uint32Array` |
| `lights` | `Uint32Array` |

___

### PeerProtocol

Ƭ **PeerProtocol**<`T`\>: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `username` | `string` |
| `metadata` | `T` |

___

### EntityProtocol

Ƭ **EntityProtocol**<`T`\>: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `type` | `string` |
| `metadata` | `T` |

___

### EventProtocol

Ƭ **EventProtocol**<`T`\>: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `payload` | `T` |

___

### UpdateProtocol

Ƭ **UpdateProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `voxel?` | `number` |
| `light?` | `number` |

___

### ChatProtocol

Ƭ **ChatProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `sender?` | `string` |
| `body` | `string` |

___

### MessageProtocol

Ƭ **MessageProtocol**<`T`, `Peer`, `Entity`, `Event`\>: `Object`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |
| `Peer` | `any` |
| `Entity` | `any` |
| `Event` | `any` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` |
| `json?` | `T` |
| `text?` | `string` |
| `chat?` | [`ChatProtocol`](modules.md#chatprotocol) |
| `peers?` | [`PeerProtocol`](modules.md#peerprotocol)<`Peer`\>[] |
| `entities?` | [`EntityProtocol`](modules.md#entityprotocol)<`Entity`\>[] |
| `chunks?` | [`ChunkProtocol`](modules.md#chunkprotocol)[] |
| `events?` | [`EventProtocol`](modules.md#eventprotocol)<`Event`\>[] |
| `updates?` | [`UpdateProtocol`](modules.md#updateprotocol)[] |
