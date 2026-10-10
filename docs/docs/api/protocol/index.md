---
id: "index"
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

### ChatHistoryEntry

Ƭ **ChatHistoryEntry**: `Object`

One line of a world's chat history, as the server replays it on join (the
INIT `chatHistory` key) and pages it (`vox-builtin:chat-history`).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `body` | `string` | - |
| `kind` | `string` | Who spoke as the server knows it: "player", "system", or a game kind. |
| `metadata` | `string` | - |
| `sender` | `string` | - |
| `senderId` | `string` | - |
| `senderName` | `string` | - |
| `sentAt` | `number` | - |
| `seq` | `number` | - |
| `type` | `string` | The chat protocol type the line was broadcast with. |

___

### ChatHistoryPage

Ƭ **ChatHistoryPage**: `Object`

A page of chat history, oldest first.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `entries` | [`ChatHistoryEntry`](#chathistoryentry)[] | - |
| `hasMore` | `boolean` | Whether the server holds lines older than the first entry. |

___

### ChatProtocol

Ƭ **ChatProtocol**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `body` | `string` | - |
| `metadata?` | `string` | - |
| `sender?` | `string` | - |
| `sentAt?` | `number` | Unix milliseconds the server logged the line at; zero when unlogged. |
| `seq?` | `number` | Position in the world's chat log, stamped by the server on every public line it keeps; zero (or absent) for a line it does not. |
| `tSendMs?` | `number` | - |
| `traceId?` | `string` | - |
| `type` | `string` | - |

___

### ChunkProtocol

Ƭ **ChunkProtocol**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `biomeTints?` | `Uint8Array` | Four x-fast RGB corner multipliers, byte / 128.0; absent on older worlds. |
| `id` | `string` | - |
| `lights` | `Uint32Array` | - |
| `meshes` | [`MeshProtocol`](#meshprotocol)[] | - |
| `voxels` | `Uint32Array` | - |
| `x` | `number` | - |
| `z` | `number` | - |

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
| `motion?` | [`EntityMotionProtocol`](#entitymotionprotocol) |
| `operation` | [`EntityOperation`](#entityoperation) |
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

| Name | Type | Description |
| :------ | :------ | :------ |
| `at?` | [`number`, `number`, `number`] | - |
| `bsCenter?` | [`number`, `number`, `number`] | - |
| `bsRadius?` | `number` | - |
| `faceName?` | `string` | - |
| `indices` | `Uint32Array` | - |
| `lightTwist?` | `Uint8Array` | Per-vertex quad light twist, four bytes per vertex, derived on the client from `lights` and `indices` (see the core's quad-light.ts). Absent on the wire; the mesh worker fills it in. |
| `lights` | `Uint32Array` | - |
| `normals?` | `Float32Array` \| `Int8Array` | - |
| `positions` | `Float32Array` \| `Uint16Array` | - |
| `uvs` | `Float32Array` \| `Uint16Array` | - |
| `voxel` | `number` | - |

___

### MeshProtocol

Ƭ **MeshProtocol**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `connectivity?` | `number` |
| `geometries` | [`GeometryProtocol`](#geometryprotocol)[] |
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

| Name | Type | Description |
| :------ | :------ | :------ |
| `bulkUpdate?` | [`BulkUpdateProtocol`](#bulkupdateprotocol) | - |
| `chat?` | [`ChatProtocol`](#chatprotocol) | - |
| `chunks?` | [`ChunkProtocol`](#chunkprotocol)[] | - |
| `entities?` | [`EntityProtocol`](#entityprotocol)<`Entity`\>[] | - |
| `events?` | [`EventProtocol`](#eventprotocol)<`Event`\>[] | - |
| `json?` | `T` | - |
| `method?` | [`MethodProtocol`](#methodprotocol)<`Method`\> | - |
| `peers?` | [`PeerProtocol`](#peerprotocol)<`Peer`\>[] | - |
| `perfArrivedAt?` | `number` | `performance.now()` when this message's raw bytes reached the client, before queueing and decode. Lets a chunk's timeline separate the server and wire from the client's own decode queue. |
| `perfByteSize?` | `number` | - |
| `perfTraceId?` | `string` | - |
| `text?` | `string` | - |
| `tick?` | `number` | Server tick at which this message's payload was captured. Stamped on high-frequency state messages (ENTITY, PEER) so receivers can drop out-of-order state on unordered transports (WebRTC). |
| `type` | ``"INIT"`` \| ``"JOIN"`` \| ``"LEAVE"`` \| ``"ERROR"`` \| ``"PEER"`` \| ``"ENTITY"`` \| ``"LOAD"`` \| ``"UNLOAD"`` \| ``"UPDATE"`` \| ``"METHOD"`` \| ``"CHAT"`` \| ``"TRANSPORT"`` \| ``"EVENT"`` \| ``"ACTION"`` \| ``"STATS"`` | - |
| `updates?` | [`UpdateProtocol`](#updateprotocol)[] | - |

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
