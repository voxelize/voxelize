---
id: "Chunks"
title: "Class: Chunks"
sidebar_label: "Chunks"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Map`<`string`, [`Chunk`](Chunk.md)\>

  ↳ **`Chunks`**

## Properties

### requested

• **requested**: `Set`<`string`\>

___

### toRequest

• **toRequest**: `string`[] = `[]`

___

### toProcess

• **toProcess**: [`ServerChunk`](../modules.md#serverchunk-56)[] = `[]`

___

### toAdd

• **toAdd**: `string`[] = `[]`

___

### currentChunk

• **currentChunk**: `Coords2`

## Constructors

### constructor

• **new Chunks**(`entries?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `entries?` | readonly readonly [`string`, [`Chunk`](Chunk.md)][] |

#### Inherited from

Map<string, Chunk\>.constructor

• **new Chunks**(`iterable`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `iterable` | `Iterable`<readonly [`string`, [`Chunk`](Chunk.md)]\> |

#### Inherited from

Map<string, Chunk\>.constructor
