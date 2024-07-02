---
id: "modules"
title: "@voxelize/protocol"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## References

### default

• **default**: Reference default

## Namespaces

### protocol

• **protocol**: Namespace protocol

Namespace protocol.

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

### EntityOperation

Ƭ **EntityOperation**: "CREATE" \| "UPDATE" \| "DELETE"

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
| `operation` | EntityOperation |
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
| `at?` | [number, number, number] |
| `faceName?` | string |
| `indices` | Uint32Array |
| `lights` | Uint32Array |
| `positions` | Float32Array |
| `uvs` | Float32Array |
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
