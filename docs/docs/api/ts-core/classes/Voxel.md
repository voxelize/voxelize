---
id: "Voxel"
title: "Class: Voxel"
sidebar_label: "Voxel"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new Voxel**(): [`Voxel`](Voxel.md)

#### Returns

[`Voxel`](Voxel.md)

## Methods

### id

▸ **id**(`voxel`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

`number`

___

### pack

▸ **pack**(`fields`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fields` | `Object` |
| `fields.id` | `number` |
| `fields.rotation?` | [`RotationLike`](../interfaces/RotationLike.md) |
| `fields.stage?` | `number` |

#### Returns

`number`

___

### rotation

▸ **rotation**(`voxel`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### stage

▸ **stage**(`voxel`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

`number`

___

### unpack

▸ **unpack**(`voxel`): [`VoxelFields`](../interfaces/VoxelFields.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |

#### Returns

[`VoxelFields`](../interfaces/VoxelFields.md)

___

### withId

▸ **withId**(`voxel`, `id`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `id` | `number` |

#### Returns

`number`

___

### withRotation

▸ **withRotation**(`voxel`, `rotation`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `rotation` | [`RotationLike`](../interfaces/RotationLike.md) |

#### Returns

`number`

___

### withStage

▸ **withStage**(`voxel`, `stage`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | `number` |
| `stage` | `number` |

#### Returns

`number`
