---
id: "BlockUtils"
title: "Class: BlockUtils"
sidebar_label: "BlockUtils"
sidebar_position: 0
custom_edit_url: null
---

A utility class for extracting and inserting voxel data from and into numbers.

The voxel data is stored in the following format:
- Voxel type: `0x0000ffff`
- Rotation: `0x000f0000`
- Y-rotation: `0x00f00000`
- Stage: `0xff000000`

TODO-DOCS
For more information about voxel data, see [here](/)

# Example
```ts
// Insert a voxel type 13 into zero.
const number = VoxelUtils.insertID(0, 13);
```

## Methods

### evaluateBlockRule

▸ **evaluateBlockRule**(`rule`, `voxel`, `functions`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `rule` | [`BlockRule`](../modules.md#blockrule) |
| `voxel` | [`Coords3`](../modules.md#coords3) |
| `functions` | `Object` |
| `functions.getVoxelAt` | (`x`: `number`, `y`: `number`, `z`: `number`) => `number` |
| `functions.getVoxelRotationAt` | (`x`: `number`, `y`: `number`, `z`: `number`) => [`BlockRotation`](BlockRotation.md) |
| `functions.getVoxelStageAt` | (`x`: `number`, `y`: `number`, `z`: `number`) => `number` |

#### Returns

`boolean`

___

### extractID

▸ **extractID**(`voxel`): `number`

Extract the voxel id from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to extract from. |

#### Returns

`number`

The extracted voxel id.

___

### extractRotation

▸ **extractRotation**(`voxel`): [`BlockRotation`](BlockRotation.md)

Extract the voxel rotation from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to extract from. |

#### Returns

[`BlockRotation`](BlockRotation.md)

The extracted voxel rotation.

___

### extractStage

▸ **extractStage**(`voxel`): `number`

Extract the voxel stage from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to extract from. |

#### Returns

`number`

The extracted voxel stage.

___

### getBlockEntityId

▸ **getBlockEntityId**(`id`, `voxel`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `voxel` | [`Coords3`](../modules.md#coords3) |

#### Returns

`string`

___

### getBlockRotatedTransparency

▸ **getBlockRotatedTransparency**(`block`, `rotation`): `boolean`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block) |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`boolean`[]

___

### getBlockTorchLightLevel

▸ **getBlockTorchLightLevel**(`block`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block) |
| `color` | [`LightColor`](../modules.md#lightcolor) |

#### Returns

`number`

___

### insertAll

▸ **insertAll**(`id`, `rotation?`, `stage?`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `rotation?` | [`BlockRotation`](BlockRotation.md) |
| `stage?` | `number` |

#### Returns

`number`

___

### insertID

▸ **insertID**(`voxel`, `id`): `number`

Insert a voxel id into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to insert the id into. |
| `id` | `number` | The voxel id to insert. |

#### Returns

`number`

The inserted voxel value.

___

### insertRotation

▸ **insertRotation**(`voxel`, `rotation`): `number`

Insert a voxel rotation into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to insert the rotation into. |
| `rotation` | [`BlockRotation`](BlockRotation.md) | The voxel rotation to insert. |

#### Returns

`number`

The inserted voxel value.

___

### insertStage

▸ **insertStage**(`voxel`, `stage`): `number`

Insert a voxel stage into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | `number` | The voxel value to insert the stage into. |
| `stage` | `number` | The voxel stage to insert. |

#### Returns

`number`

The inserted voxel value.
