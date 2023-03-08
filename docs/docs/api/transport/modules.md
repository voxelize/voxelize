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

### ChatProtocol

Ƭ **ChatProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `body` | `string` |
| `sender?` | `string` |
| `type` | `string` |

___

### ChunkProtocol

Ƭ **ChunkProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `lights` | `Uint32Array` |
| `meshes` | [`MeshProtocol`](modules.md#meshprotocol)[] |
| `voxels` | `Uint32Array` |
| `x` | `number` |
| `z` | `number` |

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
| `metadata` | `T` |
| `type` | `string` |

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

### GeometryProtocol

Ƭ **GeometryProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `faceName?` | `string` |
| `indices` | `number`[] |
| `lights` | `number`[] |
| `positions` | `number`[] |
| `uvs` | `number`[] |
| `voxel` | `number` |

___

### MeshProtocol

Ƭ **MeshProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `geometries` | [`GeometryProtocol`](modules.md#geometryprotocol)[] |
| `level` | `number` |

___

### MessageProtocol

Ƭ **MessageProtocol**<`T`, `Peer`, `Entity`, `Event`, `Method`\>: `Object`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |
| `Peer` | `any` |
| `Entity` | `any` |
| `Event` | `any` |
| `Method` | `any` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chat?` | [`ChatProtocol`](modules.md#chatprotocol) |
| `chunks?` | [`ChunkProtocol`](modules.md#chunkprotocol)[] |
| `entities?` | [`EntityProtocol`](modules.md#entityprotocol)<`Entity`\>[] |
| `events?` | [`EventProtocol`](modules.md#eventprotocol)<`Event`\>[] |
| `json?` | `T` |
| `method?` | [`MethodProtocol`](modules.md#methodprotocol)<`Method`\> |
| `peers?` | [`PeerProtocol`](modules.md#peerprotocol)<`Peer`\>[] |
| `text?` | `string` |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` |
| `updates?` | [`UpdateProtocol`](modules.md#updateprotocol)[] |

___

### MethodProtocol

Ƭ **MethodProtocol**<`T`\>: `Object`

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
| `metadata` | `T` |
| `username` | `string` |

___

### UpdateProtocol

Ƭ **UpdateProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `light?` | `number` |
| `voxel?` | `number` |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
