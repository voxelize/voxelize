---
id: "modules"
title: "@voxelize/transport"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Namespaces

### protocol

• **protocol**: Namespace protocol

## Classes

### Transport

• **Transport**: Class Transport

**`No Inherit Doc`**

## Type Aliases

### ChatProtocol

Ƭ **ChatProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `body` | string |
| `sender?` | string |
| `type` | string |

___

### ChunkProtocol

Ƭ **ChunkProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | string |
| `lights` | Uint32Array |
| `meshes` | MeshProtocol[] |
| `voxels` | Uint32Array |
| `x` | number |
| `z` | number |

___

### EntityProtocol

Ƭ **EntityProtocol**: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | string |
| `metadata` | T |
| `operation` | "CREATE" \| "UPDATE" \| "DELETE" |
| `type` | string |

___

### EventProtocol

Ƭ **EventProtocol**: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `name` | string |
| `payload` | T |

___

### GeometryProtocol

Ƭ **GeometryProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `faceName?` | string |
| `indices` | number[] |
| `lights` | number[] |
| `positions` | number[] |
| `uvs` | number[] |
| `voxel` | number |

___

### MeshProtocol

Ƭ **MeshProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `geometries` | GeometryProtocol[] |
| `level` | number |

___

### MessageProtocol

Ƭ **MessageProtocol**: `Object`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | any |
| `Peer` | any |
| `Entity` | any |
| `Event` | any |
| `Method` | any |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chat?` | ChatProtocol |
| `chunks?` | ChunkProtocol[] |
| `entities?` | EntityProtocol\<Entity\>[] |
| `events?` | EventProtocol\<Event\>[] |
| `json?` | T |
| `method?` | MethodProtocol\<Method\> |
| `peers?` | PeerProtocol\<Peer\>[] |
| `text?` | string |
| `type` | "INIT" \| "JOIN" \| "LEAVE" \| "ERROR" \| "PEER" \| "ENTITY" \| "LOAD" \| "UNLOAD" \| "UPDATE" \| "METHOD" \| "CHAT" \| "TRANSPORT" \| "EVENT" \| "ACTION" \| "STATS" |
| `updates?` | UpdateProtocol[] |

___

### MethodProtocol

Ƭ **MethodProtocol**: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `name` | string |
| `payload` | T |

___

### PeerProtocol

Ƭ **PeerProtocol**: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | string |
| `metadata` | T |
| `username` | string |

___

### UpdateProtocol

Ƭ **UpdateProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `light?` | number |
| `voxel?` | number |
| `vx` | number |
| `vy` | number |
| `vz` | number |

## Functions

### decodeStructToObject

▸ **decodeStructToObject**(`struct`): any

#### Parameters

| Name | Type |
| :------ | :------ |
| `struct` | any |

#### Returns

any

___

### encodeObjectToStruct

▸ **encodeObjectToStruct**(`obj`, `seenObjects?`): any

#### Parameters

| Name | Type |
| :------ | :------ |
| `obj` | any |
| `seenObjects` | Set\<any\> |

#### Returns

any
