---
id: "BlockUtils"
title: "Class: BlockUtils"
sidebar_label: "BlockUtils"
sidebar_position: 0
custom_edit_url: null
---

Utility class to extract voxel data from a single number

Bit lineup as such (from right to left):
- `1 - 16 bits`: ID (0x0000FFFF)
- `17 - 20 bit`: rotation (0x000F0000)
- `21 - 32 bit`: stage (0xFFF00000)

## Constructors

### constructor

• **new BlockUtils**()

## Methods

### extractID

▸ `Static` **extractID**(`voxel`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

`number`

___

### insertId

▸ `Static` **insertId**(`voxel`, `id`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `id` | `number` |

#### Returns

`number`

___

### extractRotation

▸ `Static` **extractRotation**(`voxel`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### insertRotation

▸ `Static` **insertRotation**(`voxel`, `rotation`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`number`

___

### extractStage

▸ `Static` **extractStage**(`voxel`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

`number`

___

### insertStage

▸ `Static` **insertStage**(`voxel`, `stage`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `stage` | `number` |

#### Returns

`number`
