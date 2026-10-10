---
id: "ChunkPipeline"
title: "Class: ChunkPipeline"
sidebar_label: "ChunkPipeline"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ChunkPipeline**(): [`ChunkPipeline`](ChunkPipeline.md)

#### Returns

[`ChunkPipeline`](ChunkPipeline.md)

## Properties

### loadedGeneration

• **loadedGeneration**: `number` = `0`

Bumps whenever a chunk enters or leaves the loaded stage. A caller that
memoizes a loaded-chunk lookup (the world's by-coords getter) compares
against it instead of re-resolving the name on every voxel read.

___

### sentStampAttempts

• **sentStampAttempts**: `number` = `0`

How many send stamps were offered, and how many landed on a waiting request.

___

### sentStampHits

• **sentStampHits**: `number` = `0`

## Accessors

### loadedCount

• `get` **loadedCount**(): `number`

#### Returns

`number`

___

### processingCount

• `get` **processingCount**(): `number`

#### Returns

`number`

___

### requestedCount

• `get` **requestedCount**(): `number`

#### Returns

`number`

___

### totalCount

• `get` **totalCount**(): `number`

#### Returns

`number`

## Methods

### expireRequest

▸ **expireRequest**(`name`): `void`

Drop a request presumed lost so the chunk is asked for again. Unlike
[remove](ChunkPipeline.md#remove), the chunk's [ChunkRequestHistory](../interfaces/ChunkRequestHistory.md) stays: the chunk
is still missing.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`void`

___

### forEach

▸ **forEach**(`stage`, `callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |
| `callback` | (`name`: `string`) => `void` |

#### Returns

`void`

___

### forEachLoaded

▸ **forEachLoaded**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`chunk`: [`Chunk`](Chunk.md), `name`: `string`) => `void` |

#### Returns

`void`

___

### forgetRequestsWhere

▸ **forgetRequestsWhere**(`isForgotten`): `void`

Forget the requests of chunks the caller no longer wants, including ones
between attempts that hold no stage to be removed by.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isForgotten` | (`name`: `string`) => `boolean` |

#### Returns

`void`

___

### getInStage

▸ **getInStage**(`stage`): `Set`<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |

#### Returns

`Set`<`string`\>

___

### getLoadedChunk

▸ **getLoadedChunk**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### getProcessingData

▸ **getProcessingData**(`name`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `data` | `ChunkProtocol` |
| `source` | ``"load"`` \| ``"update"`` |

___

### getReloads

▸ **getReloads**(): `ReadonlyMap`<`string`, `PendingChunkData`\>

Data waiting for chunks that stay loaded; see reloads.

#### Returns

`ReadonlyMap`<`string`, `PendingChunkData`\>

___

### getRequestHistory

▸ **getRequestHistory**(`name`): [`ChunkRequestHistory`](../interfaces/ChunkRequestHistory.md)

How long this chunk has been asked for, if it still is.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`ChunkRequestHistory`](../interfaces/ChunkRequestHistory.md)

___

### getStage

▸ **getStage**(`name`): ``"requested"`` \| ``"processing"`` \| ``"loaded"``

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

``"requested"`` \| ``"processing"`` \| ``"loaded"``

___

### getTiming

▸ **getTiming**(`name`): [`ChunkLoadTiming`](../interfaces/ChunkLoadTiming.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`ChunkLoadTiming`](../interfaces/ChunkLoadTiming.md)

___

### isAwaitingData

▸ **isAwaitingData**(`name`): `boolean`

Whether data for this chunk is still waiting to be applied.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`boolean`

___

### isInStage

▸ **isInStage**(`name`, `stage`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |

#### Returns

`boolean`

___

### isRequestStale

▸ **isRequestStale**(`name`, `staleAfterMs`): `boolean`

Whether a request has gone unanswered long enough to be presumed lost.
Measured in elapsed time rather than in world updates, so a chunk asks
again on schedule however slowly the client happens to be running.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `staleAfterMs` | `number` |

#### Returns

`boolean`

___

### markLoaded

▸ **markLoaded**(`coords`, `chunk`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../#coords2) |
| `chunk` | [`Chunk`](Chunk.md) |

#### Returns

`void`

___

### markProcessing

▸ **markProcessing**(`coords`, `source`, `data`, `arrivedAt?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `coords` | [`Coords2`](../#coords2) | `undefined` |
| `source` | ``"load"`` \| ``"update"`` | `undefined` |
| `data` | `ChunkProtocol` | `undefined` |
| `arrivedAt` | `number` | `null` |

#### Returns

`void`

___

### markRequested

▸ **markRequested**(`coords`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../#coords2) |

#### Returns

`void`

___

### markSent

▸ **markSent**(`coords`, `sentAt`): `void`

The queued LOAD for this chunk reached the socket at `sentAt`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../#coords2) |
| `sentAt` | `number` |

#### Returns

`void`

___

### readRecentRoundTrips

▸ **readRecentRoundTrips**(): readonly [`ChunkRoundTrip`](../interfaces/ChunkRoundTrip.md)[]

The last few chunk round trips this client completed: wire is socket send
to raw arrival (server + transport + the main thread getting to the
socket event), load is arrival to data applied. Lets a slow join window be
compared against the same path during play, when the main thread is idle.

#### Returns

readonly [`ChunkRoundTrip`](../interfaces/ChunkRoundTrip.md)[]

___

### remove

▸ **remove**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### resyncForRejoin

▸ **resyncForRejoin**(): `string`[]

#### Returns

`string`[]

___

### takeOverdueRequests

▸ **takeOverdueRequests**(`now`, `overdueMs`): [`OverdueChunkRequest`](../#overduechunkrequest)[]

Requests outstanding for at least `overdueMs`. Each one is returned
again only once another `overdueMs` has passed, so a caller asking every
frame names a stuck chunk once per interval for as long as it stays
stuck.

#### Parameters

| Name | Type |
| :------ | :------ |
| `now` | `number` |
| `overdueMs` | `number` |

#### Returns

[`OverdueChunkRequest`](../#overduechunkrequest)[]
