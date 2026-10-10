---
id: "ChunkLoadTiming"
title: "Interface: ChunkLoadTiming"
sidebar_label: "ChunkLoadTiming"
sidebar_position: 0
custom_edit_url: null
---

Where a chunk's time went on its way to being renderable, in
`performance.now()` milliseconds. Request to sent is this client's own
outbound queue (a flush the main thread had to get to); sent to arrive is
the server's pipeline plus the wire; arrive to receive is the client's
packet queue and worker decode; receive to loaded is its processing queue.
A field is null for a stage the chunk never went through here (a chunk
pushed by the server unasked has no request time; a payload whose
transport did not stamp it has no arrival time).

## Properties

### arrivedAt

• **arrivedAt**: `number`

___

### loadedAt

• **loadedAt**: `number`

___

### receivedAt

• **receivedAt**: `number`

___

### requestedAt

• **requestedAt**: `number`

___

### sentAt

• **sentAt**: `number`
