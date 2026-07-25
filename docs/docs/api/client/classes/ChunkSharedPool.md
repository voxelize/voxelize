---
id: "ChunkSharedPool"
title: "Class: ChunkSharedPool"
sidebar_label: "ChunkSharedPool"
sidebar_position: 0
custom_edit_url: null
---

## Methods

### ensureChunk

▸ **ensureChunk**(`chunk`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `chunk` | `RawChunk` |

#### Returns

`boolean`

___

### getInstance

▸ **getInstance**(): [`ChunkSharedPool`](ChunkSharedPool.md)

#### Returns

[`ChunkSharedPool`](ChunkSharedPool.md)

___

### getStats

▸ **getStats**(): [`ChunkSharedPoolStats`](../modules.md#chunksharedpoolstats)

#### Returns

[`ChunkSharedPoolStats`](../modules.md#chunksharedpoolstats)

___

### hasSlot

▸ **hasSlot**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### isSharedArrayBufferAvailable

▸ **isSharedArrayBufferAvailable**(): `boolean`

#### Returns

`boolean`

___

### releaseChunk

▸ **releaseChunk**(`key`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`void`

___

### resetForTests

▸ **resetForTests**(): `void`

#### Returns

`void`
