---
id: "modules"
title: "@voxelize/transport"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Classes

- [Transport](Transport.md)

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
| `meshes` | [`MeshProtocol`](../modules.md#meshprotocol-14)[] |
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
| `identifier` | `string` |
| `indices` | `number`[] |
| `lights` | `number`[] |
| `positions` | `number`[] |
| `uvs` | `number`[] |

___

### MeshProtocol

Ƭ **MeshProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `level` | `number` |
| `opaque` | [`GeometryProtocol`](../modules.md#geometryprotocol-14)[] |
| `transparent` | [`GeometryProtocol`](../modules.md#geometryprotocol-14)[] |

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
| `chat?` | [`ChatProtocol`](../modules.md#chatprotocol-14) |
| `chunks?` | [`ChunkProtocol`](../modules.md#chunkprotocol-14)[] |
| `entities?` | [`EntityProtocol`](../modules.md#entityprotocol-14)<`Entity`\>[] |
| `events?` | [`EventProtocol`](../modules.md#eventprotocol-14)<`Event`\>[] |
| `json?` | `T` |
| `method?` | [`MethodProtocol`](../modules.md#methodprotocol-12)<`Method`\> |
| `peers?` | [`PeerProtocol`](../modules.md#peerprotocol-14)<`Peer`\>[] |
| `text?` | `string` |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` |
| `updates?` | [`UpdateProtocol`](../modules.md#updateprotocol-14)[] |

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
