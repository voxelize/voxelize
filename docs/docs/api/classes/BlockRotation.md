---
id: "BlockRotation"
title: "Class: BlockRotation"
sidebar_label: "BlockRotation"
sidebar_position: 0
custom_edit_url: null
---

6 possible rotations: (px, nx, py, ny, pz, nz)
Default rotation is PY

## Properties

### PX

▪ `Static` **PX**: `number` = `0`

___

### NX

▪ `Static` **NX**: `number` = `1`

___

### PY

▪ `Static` **PY**: `number` = `2`

___

### NY

▪ `Static` **NY**: `number` = `3`

___

### PZ

▪ `Static` **PZ**: `number` = `4`

___

### NZ

▪ `Static` **NZ**: `number` = `5`

___

### value

• **value**: `number`

___

### yRotation

• **yRotation**: `number`

## Constructors

### constructor

• **new BlockRotation**(`value`, `yRotation`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |
| `yRotation` | `number` |

## Methods

### encode

▸ `Static` **encode**(`value`, `yRotation`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `number` |
| `yRotation` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### decode

▸ `Static` **decode**(`rotation`): `number`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`number`[]

___

### rotate

▸ **rotate**(`node`, `translate`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3-26) |
| `translate` | `boolean` |

#### Returns

`void`

___

### rotateInv

▸ **rotateInv**(`node`, `translate`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3-26) |
| `translate` | `boolean` |

#### Returns

`void`
