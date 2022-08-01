---
id: "ChunkUtils"
title: "Class: ChunkUtils"
sidebar_label: "ChunkUtils"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ChunkUtils**()

## Methods

### getChunkName

▸ `Static` **getChunkName**(`coords`, `concat?`): `string`

Given a coordinate of a chunk, return the chunk representation.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`string`

___

### getVoxelName

▸ `Static` **getVoxelName**(`coords`, `concat?`): `string`

Given a coordinate of a voxel, return the voxel representation.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`string`

___

### parseChunkName

▸ `Static` **parseChunkName**(`name`, `concat?`): `number`[]

Given a chunk name, return the coordinates of the chunk

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `name` | `string` | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`number`[]

___

### scaleCoordsF

▸ `Static` **scaleCoordsF**(`coords`, `factor`): [`Coords3`](../modules.md#coords3)

Scale coordinates and floor them.

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) |
| `factor` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

___

### mapVoxelPosToChunkLocalPos

▸ `Static` **mapVoxelPosToChunkLocalPos**(`voxelPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

Map voxel position to local position in current chunk.

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) |
| `chunkSize` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

___

### mapVoxelPosToChunkPos

▸ `Static` **mapVoxelPosToChunkPos**(`voxelPos`, `chunkSize`): [`Coords2`](../modules.md#coords2)

Map voxel position to the current chunk position.

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) |
| `chunkSize` | `number` |

#### Returns

[`Coords2`](../modules.md#coords2)

___

### mapChunkPosToVoxelPos

▸ `Static` **mapChunkPosToVoxelPos**(`chunkPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

Get the voxel position of a chunk position.

**`static`**

**`memberof`** Helper

#### Parameters

| Name | Type |
| :------ | :------ |
| `chunkPos` | [`Coords2`](../modules.md#coords2) |
| `chunkSize` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

___

### mapWorldPosToVoxelPos

▸ `Static` **mapWorldPosToVoxelPos**(`worldPos`): [`Coords3`](../modules.md#coords3)

Map world position to voxel position.

#### Parameters

| Name | Type |
| :------ | :------ |
| `worldPos` | [`Coords3`](../modules.md#coords3) |

#### Returns

[`Coords3`](../modules.md#coords3)
