---
id: "ChunkUtils"
title: "Class: ChunkUtils"
sidebar_label: "ChunkUtils"
sidebar_position: 0
custom_edit_url: null
---

A utility class for all things related to chunks and chunk coordinates.

# Example
```ts
// Get the chunk coordinates of a voxel, (0, 0) with `chunkSize=16`.
const chunkCoords = ChunkUtils.mapVoxelToChunk([1, 10, 12]);
```

## Methods

### getChunkName

▸ **getChunkName**(`coords`, `concat?`): `string`

Convert a 2D chunk coordinate to a string representation.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) | `undefined` | The coordinates to convert. |
| `concat` | `string` | `"|"` | The concatenation string to use. |

#### Returns

`string`

The string representation of the coordinates.

___

### getVoxelName

▸ **getVoxelName**(`coords`, `concat?`): `string`

Convert a 3D voxel coordinate to a string representation.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) | `undefined` | The coordinates to convert. |
| `concat` | `string` | `"|"` | The concatenation string to use. |

#### Returns

`string`

The string representation of the coordinates.

___

### mapChunkToVoxel

▸ **mapChunkToVoxel**(`chunkPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

Map a 2D chunk coordinate to the 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `chunkPos` | [`Coords2`](../modules.md#coords2) | The chunk coordinate to map. |
| `chunkSize` | `number` | The horizontal dimension of a chunk. |

#### Returns

[`Coords3`](../modules.md#coords3)

The mapped coordinate.

___

### mapVoxelToChunk

▸ **mapVoxelToChunk**(`voxelPos`, `chunkSize`): [`Coords2`](../modules.md#coords2)

Map a 3D voxel coordinate to the 2D chunk coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) | The voxel coordinate to map. |
| `chunkSize` | `number` | The horizontal dimension of a chunk. |

#### Returns

[`Coords2`](../modules.md#coords2)

The mapped coordinate.

___

### mapVoxelToChunkLocal

▸ **mapVoxelToChunkLocal**(`voxelPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

Map a 3D voxel coordinate to the local 3D voxel coordinate in the situated chunk.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) | The voxel coordinate to map. |
| `chunkSize` | `number` | The horizontal dimension of a chunk. |

#### Returns

[`Coords3`](../modules.md#coords3)

The mapped coordinate.

___

### mapWorldToVoxel

▸ **mapWorldToVoxel**(`worldPos`): [`Coords3`](../modules.md#coords3)

Map a 3D world coordinate to the 3D voxel coordinate. Since a voxel is
exactly 1 unit in size, this is just a floor operation.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `worldPos` | [`Coords3`](../modules.md#coords3) | The world coordinate to map. |

#### Returns

[`Coords3`](../modules.md#coords3)

The mapped coordinate.

___

### parseChunkName

▸ **parseChunkName**(`name`, `concat?`): `number`[]

Given a chunk representation, parse the chunk coordinates.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `name` | `string` | `undefined` | The string representation of the chunk. |
| `concat` | `string` | `"|"` | The concatenation string used. |

#### Returns

`number`[]

The parsed chunk coordinates.

___

### scaleCoordsF

▸ **scaleCoordsF**(`coords`, `factor`): [`Coords3`](../modules.md#coords3)

Scale and floor a 3D coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) | The coordinates to scale and floor. |
| `factor` | `number` | The factor to scale by. |

#### Returns

[`Coords3`](../modules.md#coords3)

The scaled and floored coordinates.
