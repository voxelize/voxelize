---
id: "World"
title: "Class: World"
sidebar_label: "World"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: `WorldParams` = `{}`

___

### sky

• **sky**: [`Sky`](Sky.md)

___

### chunks

• **chunks**: [`Chunks`](Chunks.md)

___

### uSunlightIntensity

• **uSunlightIntensity**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### client

• **client**: [`Client`](Client.md)

___

### setVoxelRotationByVoxel

• **setVoxelRotationByVoxel**: (`vx`: `number`, `vy`: `number`, `vz`: `number`, `rotation`: `number`) => `number`

#### Type declaration

▸ (`vx`, `vy`, `vz`, `rotation`): `number`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `rotation` | `number` |

##### Returns

`number`

___

### setVoxelStageByVoxel

• **setVoxelStageByVoxel**: (`vx`: `number`, `vy`: `number`, `vz`: `number`, `stage`: `number`) => `number`

#### Type declaration

▸ (`vx`, `vy`, `vz`, `stage`): `number`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `stage` | `number` |

##### Returns

`number`

___

### setSunlightByVoxel

• **setSunlightByVoxel**: (`vx`: `number`, `vy`: `number`, `vz`: `number`, `level`: `number`) => `void`

#### Type declaration

▸ (`vx`, `vy`, `vz`, `level`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

##### Returns

`void`

___

### setTorchLightByVoxel

• **setTorchLightByVoxel**: (`vx`: `number`, `vy`: `number`, `vz`: `number`, `level`: `number`, `color`: `LightColor`) => `void`

#### Type declaration

▸ (`vx`, `vy`, `vz`, `level`, `color`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |
| `color` | `LightColor` |

##### Returns

`void`

___

### setMaxHeight

• **setMaxHeight**: (`vx`: `number`, `vz`: `number`, `height`: `number`) => `void`

#### Type declaration

▸ (`vx`, `vz`, `height`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vz` | `number` |
| `height` | `number` |

##### Returns

`void`

___

### update

• **update**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

## Constructors

### constructor

• **new World**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`WorldInitParams`](../modules.md#worldinitparams-4)\> |

## Methods

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### setParams

▸ **setParams**(`data`): `void`

Applies the server settings onto this world.
Caution: do not call this after game started!

**`memberof`** World

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `Omit`<`WorldParams`, ``"dimension"``\> |

#### Returns

`void`

___

### setDimension

▸ **setDimension**(`value`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |

#### Returns

`void`

___

### getChunk

▸ **getChunk**(`cx`, `cz`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

[`Chunk`](Chunk.md)

___

### getChunkByName

▸ **getChunkByName**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### handleServerChunk

▸ **handleServerChunk**(`data`, `urgent?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `data` | [`ServerChunk`](../modules.md#serverchunk-4) | `undefined` |
| `urgent` | `boolean` | `false` |

#### Returns

`void`

___

### getChunkByVoxel

▸ **getChunkByVoxel**(`vx`, `vy`, `vz`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Chunk`](Chunk.md)

___

### getVoxelByVoxel

▸ **getVoxelByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getVoxelByWorld

▸ **getVoxelByWorld**(`wx`, `wy`, `wz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wy` | `number` |
| `wz` | `number` |

#### Returns

`number`

___

### setVoxelByVoxel

▸ **setVoxelByVoxel**(`vx`, `vy`, `vz`, `type`, `rotation?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `type` | `number` |
| `rotation?` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`void`

___

### setVoxelsByVoxel

▸ **setVoxelsByVoxel**(`updates`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `updates` | { `vx`: `number` ; `vy`: `number` ; `vz`: `number` ; `type`: `number` ; `rotation?`: [`BlockRotation`](BlockRotation.md)  }[] |

#### Returns

`void`

___

### getVoxelRotationByVoxel

▸ **getVoxelRotationByVoxel**(`vx`, `vy`, `vz`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### getVoxelStageByVoxel

▸ **getVoxelStageByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getSunlightByVoxel

▸ **getSunlightByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getTorchLightByVoxel

▸ **getTorchLightByVoxel**(`vx`, `vy`, `vz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `color` | `LightColor` |

#### Returns

`number`

___

### getBlockByVoxel

▸ **getBlockByVoxel**(`vx`, `vy`, `vz`): [`Block`](../modules.md#block-4)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Block`](../modules.md#block-4)

___

### getMaxHeight

▸ **getMaxHeight**(`vx`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getWalkableByVoxel

▸ **getWalkableByVoxel**(`vx`, `vy`, `vz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`boolean`

___

### getSolidityByVoxel

▸ **getSolidityByVoxel**(`vx`, `vy`, `vz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`boolean`

___

### getFluidityByVoxel

▸ **getFluidityByVoxel**(`vx`, `vy`, `vz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`boolean`

___

### getNeighborChunkCoords

▸ **getNeighborChunkCoords**(`vx`, `vy`, `vz`): [`Coords2`](../modules.md#coords2-4)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Coords2`](../modules.md#coords2-4)[]

___

### getStandableVoxel

▸ **getStandableVoxel**(`vx`, `vy`, `vz`): [`Coords3`](../modules.md#coords3-4)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Coords3`](../modules.md#coords3-4)

___

### all

▸ **all**(): [`Chunk`](Chunk.md)[]

#### Returns

[`Chunk`](Chunk.md)[]

___

### raw

▸ **raw**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### checkSurrounded

▸ **checkSurrounded**(`cx`, `cz`, `r`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `r` | `number` |

#### Returns

`boolean`

___

### isWithinWorld

▸ **isWithinWorld**(`cx`, `cz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`boolean`

___

### isChunkInView

▸ **isChunkInView**(`cx`, `cz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`boolean`
