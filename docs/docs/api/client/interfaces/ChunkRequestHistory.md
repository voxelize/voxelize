---
id: "ChunkRequestHistory"
title: "Interface: ChunkRequestHistory"
sidebar_label: "ChunkRequestHistory"
sidebar_position: 0
custom_edit_url: null
---

A chunk's outstanding request, from the first time it was asked for until
data for it arrives or it leaves the world. It outlives the `requested`
stage: a retry ([ChunkPipeline.expireRequest](../classes/ChunkPipeline.md#expirerequest)) and a rejoin
([ChunkPipeline.resyncForRejoin](../classes/ChunkPipeline.md#resyncforrejoin)) both drop that stage so the chunk
is asked for again, and the stage's own clock restarts with every attempt,
so without this a chunk missing for ten minutes looked just asked for.
Times are `performance.now()` milliseconds.

## Properties

### attempts

• **attempts**: `number`

LOAD requests queued for it so far, the first one included.

___

### firstRequestedAt

• **firstRequestedAt**: `number`

When the chunk was first asked for.

___

### lastSentAt

• **lastSentAt**: `number`

When the latest of them reached the socket; null if none ever has.
