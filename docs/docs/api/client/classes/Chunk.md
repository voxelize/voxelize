---
id: "Chunk"
title: "Class: Chunk"
sidebar_label: "Chunk"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `RawChunk`

  ↳ **`Chunk`**

## Constructors

### constructor

• **new Chunk**(`id`, `coords`, `options`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `coords` | [`Coords2`](../#coords2) |
| `options` | `RawChunkOptions` |

#### Returns

[`Chunk`](Chunk.md)

#### Overrides

RawChunk.constructor

## Properties

### added

• **added**: `boolean` = `false`

___

### biomeTints

• **biomeTints**: `Uint8Array`<`ArrayBufferLike`\>

___

### coords

• **coords**: [`Coords2`](../#coords2)

#### Inherited from

RawChunk.coords

___

### group

• **group**: [`StaticGroup`](StaticGroup.md)

___

### id

• **id**: `string`

#### Inherited from

RawChunk.id

___

### isDirty

• **isDirty**: `boolean` = `false`

___

### lights

• **lights**: `NdArray`<`Uint32Array`<`ArrayBufferLike`\>\>

#### Inherited from

RawChunk.lights

___

### max

• **max**: [`Coords3`](../#coords3)

#### Inherited from

RawChunk.max

___

### meshes

• **meshes**: `Map`<`number`, `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>[]\>

___

### min

• **min**: [`Coords3`](../#coords3)

#### Inherited from

RawChunk.min

___

### name

• **name**: `string`

#### Inherited from

RawChunk.name

___

### options

• **options**: `RawChunkOptions`

#### Inherited from

RawChunk.options

___

### plantsShown

• **plantsShown**: `boolean` = `null`

Whether this chunk's plant meshes are currently shown, or `null` when the
question has not been asked since its meshes last changed. Lets the
per-frame distance check skip chunks whose band has not moved.

___

### sectionVisibleMask

• **sectionVisibleMask**: `number` = `null`

Bit-per-level mask of which sections the occlusion walk last left
visible, or `null` when it must be reapplied (fresh meshes default to
visible). Lets the per-frame walk skip rewriting mesh visibility for
chunks whose answer has not changed.

___

### voxels

• **voxels**: `NdArray`<`Uint32Array`<`ArrayBufferLike`\>\>

#### Inherited from

RawChunk.voxels

## Accessors

### isReady

• `get` **isReady**(): `boolean`

Whether or not is this chunk ready to be rendered and seen in the world.

#### Returns

`boolean`

#### Inherited from

RawChunk.isReady

## Methods

### deserialize

▸ **deserialize**(`data`): `RawChunk`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `SerializedChunkPayload` |

#### Returns

`RawChunk`

#### Inherited from

RawChunk.deserialize

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

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

#### Inherited from

RawChunk.getBlueLight

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

#### Inherited from

RawChunk.getGreenLight

___

### getRawLight

▸ **getRawLight**(`vx`, `vy`, `vz`): `number`

Get the raw light value at a given voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The raw light value at the given voxel coordinate.

#### Inherited from

RawChunk.getRawLight

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

#### Inherited from

RawChunk.getRawValue

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

#### Inherited from

RawChunk.getRedLight

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

#### Inherited from

RawChunk.getSunlight

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
| `color` | [`LightColor`](../#lightcolor) | The color of the light to get at the given voxel coordinate. |

#### Returns

`number`

The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

#### Inherited from

RawChunk.getTorchLight

___

### getVoxel

▸ **getVoxel**(`vx`, `vy`, `vz`): `number`

Get the voxel type ID at a given voxel or world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

The voxel type ID at the given voxel coordinate.

#### Inherited from

RawChunk.getVoxel

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

#### Inherited from

RawChunk.getVoxelRotation

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

#### Inherited from

RawChunk.getVoxelStage

___

### getVoxelWaterlogLevel

▸ **getVoxelWaterlogLevel**(`vx`, `vy`, `vz`): `number`

The level of waterlogging fluid held by the voxel at a given coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`number`

#### Inherited from

RawChunk.getVoxelWaterlogLevel

___

### getVoxelWaterlogged

▸ **getVoxelWaterlogged**(`vx`, `vy`, `vz`): `boolean`

Whether the voxel at a given coordinate holds the world's waterlogging
fluid alongside its block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |

#### Returns

`boolean`

#### Inherited from

RawChunk.getVoxelWaterlogged

___

### isAirRange

▸ **isAirRange**(`minY`, `maxY`): `boolean`

Whether a full-width, half-open vertical range contains only raw air.
Used before serializing a meshing stencil: empty sky needs no worker.
Reads current storage every time, so bulk loads, edits and shared-buffer
replacement cannot leave a stale occupancy cache. Nonzero metadata is
conservatively sent to the mesher too.

#### Parameters

| Name | Type |
| :------ | :------ |
| `minY` | `number` |
| `maxY` | `number` |

#### Returns

`boolean`

#### Inherited from

RawChunk.isAirRange

___

### serialize

▸ **serialize**(): [`SerializedChunkPayload`, `ArrayBuffer`[]]

#### Returns

[`SerializedChunkPayload`, `ArrayBuffer`[]]

#### Inherited from

RawChunk.serialize

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

#### Inherited from

RawChunk.setBlueLight

___

### setData

▸ **setData**(`data`): `boolean`

See RawChunk.setData: adopts a new server id for the same coordinates.

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `ChunkProtocol` |

#### Returns

`boolean`

#### Overrides

RawChunk.setData

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

#### Inherited from

RawChunk.setGreenLight

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

#### Inherited from

RawChunk.setRawLight

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

#### Inherited from

RawChunk.setRawValue

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

#### Inherited from

RawChunk.setRedLight

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

#### Inherited from

RawChunk.setSunlight

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
| `color` | [`LightColor`](../#lightcolor) | The color of the light to set at the given voxel coordinate. |

#### Returns

`number`

The light level at the given voxel coordinate. If the voxel coordinate is out of bounds, returns 0.

#### Inherited from

RawChunk.setTorchLight

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

#### Inherited from

RawChunk.setVoxel

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

#### Inherited from

RawChunk.setVoxelRotation

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

#### Inherited from

RawChunk.setVoxelStage

___

### setVoxelWaterlogLevel

▸ **setVoxelWaterlogLevel**(`vx`, `vy`, `vz`, `level`): `number`

Set the level of waterlogging fluid held by the voxel at a coordinate.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `level` | `number` | The fluid level, 0 through 7. |

#### Returns

`number`

#### Inherited from

RawChunk.setVoxelWaterlogLevel

___

### setVoxelWaterlogged

▸ **setVoxelWaterlogged**(`vx`, `vy`, `vz`, `isWaterlogged`): `boolean`

Set whether the voxel at a given coordinate holds the waterlogging fluid.

Note: This method is purely client-side and does not affect the actual values on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate. |
| `vy` | `number` | The y voxel coordinate. |
| `vz` | `number` | The z voxel coordinate. |
| `isWaterlogged` | `boolean` | Whether the voxel holds the waterlogging fluid. |

#### Returns

`boolean`

#### Inherited from

RawChunk.setVoxelWaterlogged
