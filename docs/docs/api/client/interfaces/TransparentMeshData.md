---
id: "TransparentMeshData"
title: "Interface: TransparentMeshData"
sidebar_label: "TransparentMeshData"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### centroids

• **centroids**: `Float32Array`<`ArrayBufferLike`\>

___

### classification

• **classification**: [`TransparentSortClassification`](../#transparentsortclassification)

___

### distances

• **distances**: `Float32Array`<`ArrayBufferLike`\>

___

### faceCount

• **faceCount**: `number`

___

### faceOrder

• **faceOrder**: `Uint32Array`<`ArrayBufferLike`\>

___

### lastCameraPos

• **lastCameraPos**: `Vector3`

___

### lastIntervals

• **lastIntervals**: [`number`, `number`, `number`]

Camera interval index per axis at the last sort; -2 = never sorted.

___

### originalIndices

• **originalIndices**: `Uint32Array`<`ArrayBufferLike`\>

___

### planesByAxis

• **planesByAxis**: [`number`[], `number`[], `number`[]]

Sorted distinct face-plane offsets per axis (x, y, z).

___

### sortKeys

• **sortKeys**: `Uint32Array`<`ArrayBufferLike`\>

___

### sortTemp

• **sortTemp**: `Uint32Array`<`ArrayBufferLike`\>

___

### sortedIndices

• **sortedIndices**: `Uint32Array`<`ArrayBufferLike`\>
