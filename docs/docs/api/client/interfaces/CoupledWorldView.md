---
id: "CoupledWorldView"
title: "Interface: CoupledWorldView"
sidebar_label: "CoupledWorldView"
sidebar_position: 0
custom_edit_url: null
---

The slice of a world the coupled-unit expansion reads. Kept to plain
queries so the rules can be exercised against a stub, and so they read
the same picture the server's intake does: committed voxels, plus what the
batch itself is about to write.

## Properties

### maxHeight

• **maxHeight**: `number`

## Methods

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../#block)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

[`Block`](../#block)

___

### getVoxelAt

▸ **getVoxelAt**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getVoxelRotationAt

▸ **getVoxelRotationAt**(`vx`, `vy`, `vz`): [`BlockRotation`](../classes/BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`BlockRotation`](../classes/BlockRotation.md)

___

### getVoxelStageAt

▸ **getVoxelStageAt**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`
