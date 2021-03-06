---
id: "Chunk"
title: "Class: Chunk"
sidebar_label: "Chunk"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### mesh

• **mesh**: [`ChunkMesh`](ChunkMesh.md)

___

### name

• **name**: `string`

___

### coords

• **coords**: [`Coords2`](../modules.md#coords2-4)

___

### min

• **min**: [`Coords3`](../modules.md#coords3-4)

___

### max

• **max**: [`Coords3`](../modules.md#coords3-4)

___

### voxels

• **voxels**: `NdArray`<`Uint32Array`\>

___

### lights

• **lights**: `NdArray`<`Uint32Array`\>

___

### added

• **added**: `boolean` = `false`

___

### SUB\_MESHING\_INTERVAL

▪ `Static` **SUB\_MESHING\_INTERVAL**: `number` = `100`

___

### id

• **id**: `string`

___

### params

• **params**: `ChunkParams`

## Constructors

### constructor

• **new Chunk**(`id`, `x`, `z`, `params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `x` | `number` |
| `z` | `number` |
| `params` | `ChunkParams` |

## Methods

### build

▸ **build**(`data`, `materials`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `ChunkProtocol` |
| `materials` | `Object` |
| `materials.opaque?` | `Material` |
| `materials.transparent?` | `Material` |

#### Returns

`void`

___

### addToScene

▸ **addToScene**(`scene`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene` |

#### Returns

`void`

___

### removeFromScene

▸ **removeFromScene**(`scene`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene` |

#### Returns

`void`

___

### getRawValue

▸ **getRawValue**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setRawValue

▸ **setRawValue**(`vx`, `vy`, `vz`, `val`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `val` | `number` |

#### Returns

`number`

___

### setRawLight

▸ **setRawLight**(`vx`, `vy`, `vz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

#### Returns

`number`

___

### getVoxel

▸ **getVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setVoxel

▸ **setVoxel**(`vx`, `vy`, `vz`, `id`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `id` | `number` |

#### Returns

`number`

___

### getVoxelRotation

▸ **getVoxelRotation**(`vx`, `vy`, `vz`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### setVoxelRotation

▸ **setVoxelRotation**(`vx`, `vy`, `vz`, `rotation`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`void`

___

### getVoxelStage

▸ **getVoxelStage**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setVoxelStage

▸ **setVoxelStage**(`vx`, `vy`, `vz`, `stage`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `stage` | `number` |

#### Returns

`number`

___

### getRedLight

▸ **getRedLight**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setRedLight

▸ **setRedLight**(`vx`, `vy`, `vz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

#### Returns

`number`

___

### getGreenLight

▸ **getGreenLight**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setGreenLight

▸ **setGreenLight**(`vx`, `vy`, `vz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

#### Returns

`number`

___

### getBlueLight

▸ **getBlueLight**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setBlueLight

▸ **setBlueLight**(`vx`, `vy`, `vz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

#### Returns

`number`

___

### getTorchLight

▸ **getTorchLight**(`vx`, `vy`, `vz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `color` | [`LightColor`](../modules.md#lightcolor-4) |

#### Returns

`number`

___

### setTorchLight

▸ **setTorchLight**(`vx`, `vy`, `vz`, `level`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |
| `color` | [`LightColor`](../modules.md#lightcolor-4) |

#### Returns

`number`

___

### getSunlight

▸ **getSunlight**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### setSunlight

▸ **setSunlight**(`vx`, `vy`, `vz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `level` | `number` |

#### Returns

`number`

___

### distTo

▸ **distTo**(`vx`, `_`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `_` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

## Accessors

### isReady

• `get` **isReady**(): `boolean`

#### Returns

`boolean`
