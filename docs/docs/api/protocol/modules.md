---
id: "modules"
title: "@voxelize/protocol"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Namespaces

- [protocol](namespaces/protocol.md)

## References

### default

Renames and re-exports [protocol](namespaces/protocol.md)

## Type Aliases

### BulkUpdateProtocol

Ƭ **BulkUpdateProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lights` | `number`[] |
| `voxels` | `number`[] |
| `vx` | `number`[] |
| `vy` | `number`[] |
| `vz` | `number`[] |

___

### ChatProtocol

Ƭ **ChatProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `body` | `string` |
| `metadata?` | `string` |
| `sender?` | `string` |
| `tSendMs?` | `number` |
| `traceId?` | `string` |
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

### EntityMotionProtocol

Ƭ **EntityMotionProtocol**: `Object`

The decoded compact motion payload of an entity UPDATE (the versioned
`motion.v1` wire format negotiated through the JOIN capabilities). Servers
send it in place of JSON motion metadata to clients that advertised
support; the client merges it back into the entity's metadata so consumer
code keeps reading `metadata.position` / `metadata.direction` /
`metadata.rigidBody` / `metadata.target.position` unchanged.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `direction?` | [`number`, `number`, `number`] |
| `position` | [`number`, `number`, `number`] |
| `rigidBody?` | \{ `fluidRatio`: `number` ; `isInFluid`: `boolean`  } |
| `rigidBody.fluidRatio` | `number` |
| `rigidBody.isInFluid` | `boolean` |
| `targetPosition?` | [`number`, `number`, `number`] |

___

### EntityOperation

Ƭ **EntityOperation**: ``"CREATE"`` \| ``"UPDATE"`` \| ``"DELETE"`` \| ``"OUT_OF_RANGE"``

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
| `motion?` | [`EntityMotionProtocol`](modules.md#entitymotionprotocol) |
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
| `bsCenter?` | [`number`, `number`, `number`] |
| `bsRadius?` | `number` |
| `faceName?` | `string` |
| `indices` | `Uint32Array` |
| `lights` | `Uint32Array` |
| `normals?` | `Float32Array` |
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

| Name | Type | Description |
| :------ | :------ | :------ |
| `bulkUpdate?` | [`BulkUpdateProtocol`](modules.md#bulkupdateprotocol) | - |
| `chat?` | [`ChatProtocol`](modules.md#chatprotocol) | - |
| `chunks?` | [`ChunkProtocol`](modules.md#chunkprotocol)[] | - |
| `entities?` | [`EntityProtocol`](modules.md#entityprotocol)\<`Entity`\>[] | - |
| `events?` | [`EventProtocol`](modules.md#eventprotocol)\<`Event`\>[] | - |
| `json?` | `T` | - |
| `method?` | [`MethodProtocol`](modules.md#methodprotocol)\<`Method`\> | - |
| `peers?` | [`PeerProtocol`](modules.md#peerprotocol)\<`Peer`\>[] | - |
| `perfByteSize?` | `number` | - |
| `perfTraceId?` | `string` | - |
| `text?` | `string` | - |
| `tick?` | `number` | Server tick at which this message's payload was captured. Stamped on high-frequency state messages (ENTITY, PEER) so receivers can drop out-of-order state on unordered transports (WebRTC). |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` \| ``"STATS"`` | - |
| `updates?` | [`UpdateProtocol`](modules.md#updateprotocol)[] | - |

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

## Variables

### PROTOCOL\_MISMATCH\_CLOSE\_CODE

• `Const` **PROTOCOL\_MISMATCH\_CLOSE\_CODE**: `number` = `protocolVersion.mismatchCloseCode`

Application WebSocket close code sent when the server refuses a client for a
protocol-version mismatch. The client treats it as terminal
(`client_outdated`): it never retries and never burns reconnect grace.
Derived from the shared `protocol-version.json` (see above).

___

### PROTOCOL\_VERSION

• `Const` **PROTOCOL\_VERSION**: `number` = `protocolVersion.version`

Wire protocol version. Must match the server's `PROTOCOL_VERSION` constant
(Rust). The client sends this on JOIN; a deterministic (fixed-step) world
asserts strict equality and refuses a mismatch. Client + server deploy in
lockstep on every bump.

SINGLE SOURCE OF TRUTH: this value is derived from `protocol-version.json`,
the same file the Rust server compiles its `PROTOCOL_VERSION` from
(`include_str!` + const parse). There is exactly one number; the two sides
cannot silently drift.
