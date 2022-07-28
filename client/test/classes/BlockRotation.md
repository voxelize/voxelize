[@voxelize/client](../README.md) / [Exports](../modules.md) / BlockRotation

# Class: BlockRotation

## Table of contents

### Constructors

- [constructor](BlockRotation.md#constructor)

### Properties

- [value](BlockRotation.md#value)
- [yRotation](BlockRotation.md#yrotation)
- [NX](BlockRotation.md#nx)
- [NY](BlockRotation.md#ny)
- [NZ](BlockRotation.md#nz)
- [PX](BlockRotation.md#px)
- [PY](BlockRotation.md#py)
- [PZ](BlockRotation.md#pz)

### Methods

- [rotateAABB](BlockRotation.md#rotateaabb)
- [rotateNode](BlockRotation.md#rotatenode)
- [decode](BlockRotation.md#decode)
- [encode](BlockRotation.md#encode)
- [rotateX](BlockRotation.md#rotatex)
- [rotateY](BlockRotation.md#rotatey)
- [rotateZ](BlockRotation.md#rotatez)

## Constructors

### constructor

• **new BlockRotation**(`value`, `yRotation`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |
| `yRotation` | `number` |

#### Defined in

[client/src/core/world/block.ts:116](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L116)

## Properties

### value

• **value**: `number`

___

### yRotation

• **yRotation**: `number`

___

### NX

▪ `Static` **NX**: `number` = `1`

#### Defined in

[client/src/core/world/block.ts:110](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L110)

___

### NY

▪ `Static` **NY**: `number` = `3`

#### Defined in

[client/src/core/world/block.ts:112](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L112)

___

### NZ

▪ `Static` **NZ**: `number` = `5`

#### Defined in

[client/src/core/world/block.ts:114](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L114)

___

### PX

▪ `Static` **PX**: `number` = `0`

#### Defined in

[client/src/core/world/block.ts:109](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L109)

___

### PY

▪ `Static` **PY**: `number` = `2`

#### Defined in

[client/src/core/world/block.ts:111](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L111)

___

### PZ

▪ `Static` **PZ**: `number` = `4`

#### Defined in

[client/src/core/world/block.ts:113](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L113)

## Methods

### rotateAABB

▸ **rotateAABB**(`aabb`, `translate?`): `AABB`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `aabb` | `AABB` | `undefined` |
| `translate` | `boolean` | `true` |

#### Returns

`AABB`

#### Defined in

[client/src/core/world/block.ts:281](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L281)

___

### rotateNode

▸ **rotateNode**(`node`, `translate?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3) | `undefined` |
| `translate` | `boolean` | `true` |

#### Returns

`void`

#### Defined in

[client/src/core/world/block.ts:221](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L221)

___

### decode

▸ `Static` **decode**(`rotation`): `number`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`number`[]

#### Defined in

[client/src/core/world/block.ts:167](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L167)

___

### encode

▸ `Static` **encode**(`value`, `yRotation`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |
| `yRotation` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

#### Defined in

[client/src/core/world/block.ts:118](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L118)

___

### rotateX

▸ `Static` `Private` **rotateX**(`node`, `theta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3) |
| `theta` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/world/block.ts:323](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L323)

___

### rotateY

▸ `Static` `Private` **rotateY**(`node`, `theta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3) |
| `theta` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/world/block.ts:333](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L333)

___

### rotateZ

▸ `Static` `Private` **rotateZ**(`node`, `theta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3) |
| `theta` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/world/block.ts:343](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L343)
