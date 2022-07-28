[@voxelize/client](../README.md) / [Exports](../modules.md) / Chunk

# Class: Chunk

## Table of contents

### Constructors

- [constructor](Chunk.md#constructor)

### Properties

- [added](Chunk.md#added)
- [coords](Chunk.md#coords)
- [id](Chunk.md#id)
- [lights](Chunk.md#lights)
- [max](Chunk.md#max)
- [mesh](Chunk.md#mesh)
- [min](Chunk.md#min)
- [name](Chunk.md#name)
- [params](Chunk.md#params)
- [voxels](Chunk.md#voxels)
- [SUB\_MESHING\_INTERVAL](Chunk.md#sub_meshing_interval)

### Accessors

- [isReady](Chunk.md#isready)

### Methods

- [addToScene](Chunk.md#addtoscene)
- [build](Chunk.md#build)
- [contains](Chunk.md#contains)
- [dispose](Chunk.md#dispose)
- [distTo](Chunk.md#distto)
- [getBlueLight](Chunk.md#getbluelight)
- [getGreenLight](Chunk.md#getgreenlight)
- [getLocalBlueLight](Chunk.md#getlocalbluelight)
- [getLocalGreenLight](Chunk.md#getlocalgreenlight)
- [getLocalRedLight](Chunk.md#getlocalredlight)
- [getLocalSunlight](Chunk.md#getlocalsunlight)
- [getRawValue](Chunk.md#getrawvalue)
- [getRedLight](Chunk.md#getredlight)
- [getSunlight](Chunk.md#getsunlight)
- [getTorchLight](Chunk.md#gettorchlight)
- [getVoxel](Chunk.md#getvoxel)
- [getVoxelRotation](Chunk.md#getvoxelrotation)
- [getVoxelStage](Chunk.md#getvoxelstage)
- [removeFromScene](Chunk.md#removefromscene)
- [setBlueLight](Chunk.md#setbluelight)
- [setGreenLight](Chunk.md#setgreenlight)
- [setLocalBlueLight](Chunk.md#setlocalbluelight)
- [setLocalGreenLight](Chunk.md#setlocalgreenlight)
- [setLocalRedLight](Chunk.md#setlocalredlight)
- [setLocalSunlight](Chunk.md#setlocalsunlight)
- [setRawLight](Chunk.md#setrawlight)
- [setRawValue](Chunk.md#setrawvalue)
- [setRedLight](Chunk.md#setredlight)
- [setSunlight](Chunk.md#setsunlight)
- [setTorchLight](Chunk.md#settorchlight)
- [setVoxel](Chunk.md#setvoxel)
- [setVoxelRotation](Chunk.md#setvoxelrotation)
- [setVoxelStage](Chunk.md#setvoxelstage)
- [toLocal](Chunk.md#tolocal)

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

#### Defined in

[client/src/core/world/chunk.ts:131](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L131)

## Properties

### added

• **added**: `boolean` = `false`

#### Defined in

[client/src/core/world/chunk.ts:126](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L126)

___

### coords

• **coords**: [`Coords2`](../modules.md#coords2)

#### Defined in

[client/src/core/world/chunk.ts:118](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L118)

___

### id

• **id**: `string`

___

### lights

• **lights**: `NdArray`<`Uint32Array`\>

#### Defined in

[client/src/core/world/chunk.ts:124](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L124)

___

### max

• **max**: [`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/core/world/chunk.ts:121](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L121)

___

### mesh

• **mesh**: [`ChunkMesh`](ChunkMesh.md)

#### Defined in

[client/src/core/world/chunk.ts:115](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L115)

___

### min

• **min**: [`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/core/world/chunk.ts:120](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L120)

___

### name

• **name**: `string`

#### Defined in

[client/src/core/world/chunk.ts:117](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L117)

___

### params

• **params**: `ChunkParams`

___

### voxels

• **voxels**: `NdArray`<`Uint32Array`\>

#### Defined in

[client/src/core/world/chunk.ts:123](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L123)

___

### SUB\_MESHING\_INTERVAL

▪ `Static` **SUB\_MESHING\_INTERVAL**: `number` = `100`

#### Defined in

[client/src/core/world/chunk.ts:129](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L129)

## Accessors

### isReady

• `get` **isReady**(): `boolean`

#### Returns

`boolean`

#### Defined in

[client/src/core/world/chunk.ts:364](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L364)

## Methods

### addToScene

▸ **addToScene**(`scene`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene` |

#### Returns

`void`

#### Defined in

[client/src/core/world/chunk.ts:177](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L177)

___

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

#### Defined in

[client/src/core/world/chunk.ts:151](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L151)

___

### contains

▸ `Private` **contains**(`vx`, `vy`, `vz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`boolean`

#### Defined in

[client/src/core/world/chunk.ts:449](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L449)

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/chunk.ts:360](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L360)

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

#### Defined in

[client/src/core/world/chunk.ts:351](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L351)

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

#### Defined in

[client/src/core/world/chunk.ts:283](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L283)

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

#### Defined in

[client/src/core/world/chunk.ts:265](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L265)

___

### getLocalBlueLight

▸ `Private` **getLocalBlueLight**(`lx`, `ly`, `lz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:408](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L408)

___

### getLocalGreenLight

▸ `Private` **getLocalGreenLight**(`lx`, `ly`, `lz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:390](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L390)

___

### getLocalRedLight

▸ `Private` **getLocalRedLight**(`lx`, `ly`, `lz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:372](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L372)

___

### getLocalSunlight

▸ `Private` **getLocalSunlight**(`lx`, `ly`, `lz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:426](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L426)

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

#### Defined in

[client/src/core/world/chunk.ts:187](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L187)

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

#### Defined in

[client/src/core/world/chunk.ts:247](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L247)

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

#### Defined in

[client/src/core/world/chunk.ts:333](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L333)

___

### getTorchLight

▸ **getTorchLight**(`vx`, `vy`, `vz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `color` | [`LightColor`](../modules.md#lightcolor) |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:301](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L301)

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

#### Defined in

[client/src/core/world/chunk.ts:208](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L208)

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

#### Defined in

[client/src/core/world/chunk.ts:218](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L218)

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

#### Defined in

[client/src/core/world/chunk.ts:236](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L236)

___

### removeFromScene

▸ **removeFromScene**(`scene`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `scene` | `Scene` |

#### Returns

`void`

#### Defined in

[client/src/core/world/chunk.ts:182](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L182)

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

#### Defined in

[client/src/core/world/chunk.ts:292](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L292)

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

#### Defined in

[client/src/core/world/chunk.ts:274](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L274)

___

### setLocalBlueLight

▸ `Private` **setLocalBlueLight**(`lx`, `ly`, `lz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |
| `level` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:412](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L412)

___

### setLocalGreenLight

▸ `Private` **setLocalGreenLight**(`lx`, `ly`, `lz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |
| `level` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:394](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L394)

___

### setLocalRedLight

▸ `Private` **setLocalRedLight**(`lx`, `ly`, `lz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |
| `level` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:376](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L376)

___

### setLocalSunlight

▸ `Private` **setLocalSunlight**(`lx`, `ly`, `lz`, `level`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lx` | `number` |
| `ly` | `number` |
| `lz` | `number` |
| `level` | `number` |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:430](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L430)

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

#### Defined in

[client/src/core/world/chunk.ts:202](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L202)

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

#### Defined in

[client/src/core/world/chunk.ts:196](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L196)

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

#### Defined in

[client/src/core/world/chunk.ts:256](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L256)

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

#### Defined in

[client/src/core/world/chunk.ts:342](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L342)

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
| `color` | [`LightColor`](../modules.md#lightcolor) |

#### Returns

`number`

#### Defined in

[client/src/core/world/chunk.ts:314](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L314)

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

#### Defined in

[client/src/core/world/chunk.ts:212](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L212)

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

#### Defined in

[client/src/core/world/chunk.ts:223](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L223)

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

#### Defined in

[client/src/core/world/chunk.ts:241](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L241)

___

### toLocal

▸ `Private` **toLocal**(`vx`, `vy`, `vz`): `number`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`[]

#### Defined in

[client/src/core/world/chunk.ts:444](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunk.ts#L444)
