[@voxelize/client](../README.md) / [Exports](../modules.md) / ChunkUtils

# Class: ChunkUtils

## Table of contents

### Constructors

- [constructor](ChunkUtils.md#constructor)

### Methods

- [getChunkName](ChunkUtils.md#getchunkname)
- [getVoxelName](ChunkUtils.md#getvoxelname)
- [mapChunkPosToVoxelPos](ChunkUtils.md#mapchunkpostovoxelpos)
- [mapVoxelPosToChunkLocalPos](ChunkUtils.md#mapvoxelpostochunklocalpos)
- [mapVoxelPosToChunkPos](ChunkUtils.md#mapvoxelpostochunkpos)
- [mapWorldPosToVoxelPos](ChunkUtils.md#mapworldpostovoxelpos)
- [parseChunkName](ChunkUtils.md#parsechunkname)
- [scaleCoordsF](ChunkUtils.md#scalecoordsf)

## Constructors

### constructor

• **new ChunkUtils**()

## Methods

### getChunkName

▸ `Static` **getChunkName**(`coords`, `concat?`): `string`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`string`

#### Defined in

[client/src/utils/chunk-utils.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L13)

___

### getVoxelName

▸ `Static` **getVoxelName**(`coords`, `concat?`): `string`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`string`

#### Defined in

[client/src/utils/chunk-utils.ts:24](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L24)

___

### mapChunkPosToVoxelPos

▸ `Static` **mapChunkPosToVoxelPos**(`chunkPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

#### Parameters

| Name | Type |
| :------ | :------ |
| `chunkPos` | [`Coords2`](../modules.md#coords2) |
| `chunkSize` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/utils/chunk-utils.ts:92](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L92)

___

### mapVoxelPosToChunkLocalPos

▸ `Static` **mapVoxelPosToChunkLocalPos**(`voxelPos`, `chunkSize`): [`Coords3`](../modules.md#coords3)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) |
| `chunkSize` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/utils/chunk-utils.ts:59](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L59)

___

### mapVoxelPosToChunkPos

▸ `Static` **mapVoxelPosToChunkPos**(`voxelPos`, `chunkSize`): [`Coords2`](../modules.md#coords2)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxelPos` | [`Coords3`](../modules.md#coords3) |
| `chunkSize` | `number` |

#### Returns

[`Coords2`](../modules.md#coords2)

#### Defined in

[client/src/utils/chunk-utils.ts:76](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L76)

___

### mapWorldPosToVoxelPos

▸ `Static` **mapWorldPosToVoxelPos**(`worldPos`): [`Coords3`](../modules.md#coords3)

#### Parameters

| Name | Type |
| :------ | :------ |
| `worldPos` | [`Coords3`](../modules.md#coords3) |

#### Returns

[`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/utils/chunk-utils.ts:110](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L110)

___

### parseChunkName

▸ `Static` **parseChunkName**(`name`, `concat?`): `number`[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `name` | `string` | `undefined` |
| `concat` | `string` | `"|"` |

#### Returns

`number`[]

#### Defined in

[client/src/utils/chunk-utils.ts:35](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L35)

___

### scaleCoordsF

▸ `Static` **scaleCoordsF**(`coords`, `factor`): [`Coords3`](../modules.md#coords3)

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords3`](../modules.md#coords3) |
| `factor` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/utils/chunk-utils.ts:46](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/chunk-utils.ts#L46)
