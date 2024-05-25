---
id: "modules"
title: "@voxelize/protocol"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Namespaces

- [protocol](namespaces/protocol.md)

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

### EntityOperation

Ƭ **EntityOperation**: ``"CREATE"`` \| ``"UPDATE"`` \| ``"DELETE"``

___

### EntityProtocol

Ƭ **EntityProtocol**\<`T`\>: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `metadata` | `T` |
| `operation` | [`EntityOperation`](modules.md#entityoperation) |
| `type` | `string` |

___

### EventProtocol

Ƭ **EventProtocol**\<`T`\>: `Object`

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
| `at?` | [`number`, `number`, `number`] |
| `faceName?` | `string` |
| `indices` | `Uint32Array` |
| `lights` | `Uint32Array` |
| `positions` | `Float32Array` |
| `uvs` | `Float32Array` |
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

Ƭ **MessageProtocol**\<`T`, `Peer`, `Entity`, `Event`, `Method`\>: `Object`

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
| `entities?` | [`EntityProtocol`](modules.md#entityprotocol)\<`Entity`\>[] |
| `events?` | [`EventProtocol`](modules.md#eventprotocol)\<`Event`\>[] |
| `json?` | `T` |
| `method?` | [`MethodProtocol`](modules.md#methodprotocol)\<`Method`\> |
| `peers?` | [`PeerProtocol`](modules.md#peerprotocol)\<`Peer`\>[] |
| `text?` | `string` |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` \| ``"STATS"`` |
| `updates?` | [`UpdateProtocol`](modules.md#updateprotocol)[] |

___

### MethodProtocol

Ƭ **MethodProtocol**\<`T`\>: `Object`

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

Ƭ **PeerProtocol**\<`T`\>: `Object`

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

## Functions

### decodeStructToObject

▸ **decodeStructToObject**(`struct`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `struct` | `any` |

#### Returns

`any`

___

### encodeObjectToStruct

▸ **encodeObjectToStruct**(`obj`, `seenObjects?`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `obj` | `any` |
| `seenObjects` | `Set`\<`any`\> |

#### Returns

`any`
