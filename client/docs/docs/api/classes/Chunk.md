---
id: "Chunk"
title: "Class: Chunk"
sidebar_label: "Chunk"
sidebar_position: 0
custom_edit_url: null
---

A chunk is a `chunkSize` x `maxHeight` x `chunkSize` region of blocks. The data of each chunk is generated
and sent from the server to the client, then the client renders the chunks surrounding the client.

![Chunk](/img/chunk.png)

<p style={{textAlign: "center", color: "gray", fontSize: "0.8rem"}}>A visualization of one single chunk</p>

## Methods

### addToScene

▸ **addToScene**(`scene`): `void`

Add this chunk to a scene. If the chunk has already been added, this method does nothing.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `scene` | `Scene` | The scene to add the chunk mesh to. |

#### Returns

`void`

___

### build

▸ **build**(`data`, `materials`): `Promise`<`void`\>

Build the chunk mesh from the voxel data.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `ChunkProtocol` | The chunk protocol data received from the server. |
| `materials` | `Object` | The materials to use for the chunk mesh. |
| `materials.opaque?` | `Material` | The opaque material to use for the chunk mesh. |
| `materials.transparent?` | `Object` | The transparent materials to use for the chunk mesh. |
| `materials.transparent.back` | `Material` | The material to use for the transparent back side of the chunk mesh. |
| `materials.transparent.front` | `Material` | The material to use for the transparent front side of the chunk mesh. |

#### Returns

`Promise`<`void`\>

A promise that resolves when the chunk mesh is generated.

___

### dispose

▸ **dispose**(): `void`

Dispose the chunk's meshes.

#### Returns

`void`

___

### distTo

▸ **distTo**(`vx`, `_`, `vz`): `number`

Get the horizontal distance from the chunk's center voxel to the given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `_` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |

#### Returns

`number`

The horizontal distance from this chunk's center to the given voxel coordinate.

___

### getBlueLight

▸ **getBlueLight**(`vx`, `vy`, `vz`): `number`

Get the blue light level at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |

#### Returns

`number`

The blue light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### getGreenLight

▸ **getGreenLight**(`vx`, `vy`, `vz`): `number`

Get the green light level at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |

#### Returns

`number`

The green light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### getRawValue

▸ **getRawValue**(`vx`, `vy`, `vz`): `number`

Get the raw voxel value at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The raw voxel value at the given voxel coordinate. If the voxel is not within
the chunk, this method returns `0`.

___

### getRedLight

▸ **getRedLight**(`vx`, `vy`, `vz`): `number`

Get the red light level at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The red light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### getSunlight

▸ **getSunlight**(`vx`, `vy`, `vz`): `number`

Get the sunlight level at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |

#### Returns

`number`

The sunlight level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### getTorchLight

▸ **getTorchLight**(`vx`, `vy`, `vz`, `color`): `number`

Get the colored torch light level at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `color` | [`LightColor`](../modules.md#lightcolor-128) | The color of the light to get at the given voxel coordinate. |

#### Returns

`number`

The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### getVoxel

▸ **getVoxel**(`vx`, `vy`, `vz`): `number`

Get the voxel type ID at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The voxel type ID at the given voxel coordinate.

___

### getVoxelRotation

▸ **getVoxelRotation**(`vx`, `vy`, `vz`): [`BlockRotation`](BlockRotation.md)

Get the voxel rotation at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

[`BlockRotation`](BlockRotation.md)

The voxel rotation at the given voxel coordinate.

___

### getVoxelStage

▸ **getVoxelStage**(`vx`, `vy`, `vz`): `number`

Get the voxel stage at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The voxel stage at the given voxel coordinate.

___

### removeFromScene

▸ **removeFromScene**(`scene`): `void`

Remove this chunk from a scene. If the chunk has already been removed, this method does nothing.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `scene` | `Scene` | The scene to remove the chunk mesh from. |

#### Returns

`void`

___

### setBlueLight

▸ **setBlueLight**(`vx`, `vy`, `vz`, `level`): `number`

Set the blue light level at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `level` | `number` | The blue light level to set at the given voxel coordinate. |

#### Returns

`number`

The blue light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### setGreenLight

▸ **setGreenLight**(`vx`, `vy`, `vz`, `level`): `number`

Set the green light level at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `level` | `number` | The green light level to set at the given voxel coordinate. |

#### Returns

`number`

The green light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### setRawLight

▸ **setRawLight**(`vx`, `vy`, `vz`, `level`): `number`

Set the raw light value at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `level` | `number` | The raw light level to set at the given voxel coordinate. |

#### Returns

`number`

The raw light level at the given voxel coordinate.

___

### setRawValue

▸ **setRawValue**(`vx`, `vy`, `vz`, `val`): `number`

Set the raw voxel value at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `val` | `number` | - |

#### Returns

`number`

The raw voxel value at the given voxel coordinate.

___

### setRedLight

▸ **setRedLight**(`vx`, `vy`, `vz`, `level`): `number`

Set the red light level at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `level` | `number` | The red light level to set at the given voxel coordinate. |

#### Returns

`number`

The red light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### setSunlight

▸ **setSunlight**(`vx`, `vy`, `vz`, `level`): `number`

Set the sunlight level at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `level` | `number` | The sunlight level to set at the given voxel coordinate. |

#### Returns

`number`

The sunlight level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### setTorchLight

▸ **setTorchLight**(`vx`, `vy`, `vz`, `level`, `color`): `number`

Set the colored torch light level at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate |
| `vy` | `number` | The y voxel coordinate |
| `vz` | `number` | The z voxel coordinate |
| `level` | `number` | The light level to set at the given voxel coordinate. |
| `color` | [`LightColor`](../modules.md#lightcolor-128) | The color of the light to set at the given voxel coordinate. |

#### Returns

`number`

The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

___

### setVoxel

▸ **setVoxel**(`vx`, `vy`, `vz`, `id`): `number`

Set the voxel type ID at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `id` | `number` | The voxel type ID to set at the given voxel coordinate. |

#### Returns

`number`

The voxel type ID at the given voxel coordinate.

___

### setVoxelRotation

▸ **setVoxelRotation**(`vx`, `vy`, `vz`, `rotation`): `void`

Set the voxel rotation at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `rotation` | [`BlockRotation`](BlockRotation.md) | The voxel rotation to set at the given voxel coordinate. |

#### Returns

`void`

___

### setVoxelStage

▸ **setVoxelStage**(`vx`, `vy`, `vz`, `stage`): `number`

Set the voxel stage at a given voxel coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `stage` | `number` | The voxel stage to set at the given voxel coordinate. |

#### Returns

`number`

The voxel stage at the given voxel coordinate.

## Properties

### added

• **added**: `boolean` = `false`

Whether or not the chunk has been added to the world.

___

### coords

• **coords**: [`Coords2`](../modules.md#coords2-128)

The chunk's 2D coordinates in the word. This coordinate is the voxel coordinate divided by the chunk size then floored.

___

### id

• **id**: `string`

The ID of the chunk generated on the server-side.

___

### lights

• **lights**: `NdArray`<`Uint32Array`\>

The lighting data within this chunk, represented by a 1D n-dimensional array.

___

### max

• **max**: [`Coords3`](../modules.md#coords3-128)

The maximum 3D voxel coordinate within this chunk, exclusive.

___

### mesh

• **mesh**: [`ChunkMesh`](ChunkMesh.md)

The chunk's mesh, which is a group of sub-chunks.

___

### min

• **min**: [`Coords3`](../modules.md#coords3-128)

The minimum 3D voxel coordinate within this chunk, inclusive.

___

### name

• **name**: `string`

The name of the chunk, which is converted from the chunk's coordinates into a string representation
through [ChunkUtils.getChunkName](ChunkUtils.md#getchunkname-128).

___

### params

• **params**: [`ChunkParams`](../modules.md#chunkparams-128)

Parameters to create a new chunk.

___

### voxels

• **voxels**: `NdArray`<`Uint32Array`\>

The voxel data within this chunk, represented by a 1D n-dimensional array.

## Constructors

### constructor

• **new Chunk**(`id`, `x`, `z`, `params`)

Create a new chunk with the given parameters.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the chunk generated on the server-side. |
| `x` | `number` | The x coordinate of the chunk. |
| `z` | `number` | The z coordinate of the chunk. |
| `params` | [`ChunkParams`](../modules.md#chunkparams-128) | The parameters to create a new chunk. |

## Accessors

### isReady

• `get` **isReady**(): `boolean`

Whether or not is this chunk ready to be rendered and seen in the world.

#### Returns

`boolean`
