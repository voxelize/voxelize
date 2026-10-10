---
id: "ScannableChunk"
title: "Interface: ScannableChunk"
sidebar_label: "ScannableChunk"
sidebar_position: 0
custom_edit_url: null
---

Everything the tracker needs to read voxels out of a loaded chunk. Matches
the world's `RawChunk` without importing it, so tests can fake one.

## Properties

### min

• **min**: [`number`, `number`, `number`]

___

### voxels

• **voxels**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `data` | `number`[] \| `Uint32Array`<`ArrayBufferLike`\> |
