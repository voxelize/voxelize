---
id: "Chunks"
title: "Class: Chunks"
sidebar_label: "Chunks"
sidebar_position: 0
custom_edit_url: null
---

`Chunks` is a map of chunks that are currently loaded or being loaded. This is
used completely within [World](World.md) and shouldn't be modified by anything else.

One can use [Debug](Debug.md) to view different chunk statuses.

## Hierarchy

- `Map`<`string`, [`Chunk`](Chunk.md)\>

  ↳ **`Chunks`**

## Properties

### currentChunk

• **currentChunk**: [`Coords2`](../modules.md#coords2-4)

The current chunk that is used as the center of the world. This is used to determine which chunks
should be requested and loaded.

___

### requested

• **requested**: `Map`<`string`, `number`\>

The map of requested chunks corresponding to how many times the world has attempted
to re-request the chunk.

___

### toAdd

• **toAdd**: `string`[] = `[]`

A list of chunk representations that are ready to be added into the THREE.js scene. This list empties
out at the rate defined at [WorldClientParams.maxAddsPerTick](../modules.md#worldclientparams-4).

___

### toProcess

• **toProcess**: [`ChunkProtocol`, `number`][] = `[]`

A list of ChunkProtocol objects that are received from the server and are waiting to be
loaded into meshes within the world and actual chunk instances. This list empties out at the rate
defined at [WorldClientParams.maxProcessesPerTick](../modules.md#worldclientparams-4).

___

### toRequest

• **toRequest**: `string`[] = `[]`

A list of chunk representations ready to be sent to the server to be loaded. The rate at which
this list is taken out can be configured at [WorldClientParams.maxRequestsPerTick](../modules.md#worldclientparams-4). Items of
this list will be taken out whenever the server responds with any corresponding chunks.

___

### toUpdate

• **toUpdate**: [`BlockUpdate`](../modules.md#blockupdate-4)[] = `[]`

A list of [BlockUpdate](../modules.md#blockupdate-4) objects that awaits to be sent to the server to make actual voxel
updates. This list empties out at the rate defined at [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams-4).
