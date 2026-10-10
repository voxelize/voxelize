---
id: "VoxelLightVolume"
title: "Interface: VoxelLightVolume"
sidebar_label: "VoxelLightVolume"
sidebar_position: 0
custom_edit_url: null
---

The narrow slice of the world that the client-side lighting algorithms
sense and mutate: voxel/block lookups plus light reads and writes. The
[World](../classes/World.md) satisfies this structurally, and tests can substitute a
plain in-memory implementation.

## Properties

### options

• **options**: [`VoxelLightVolumeOptions`](../#voxellightvolumeoptions)

## Methods

### getBlockAt

▸ **getBlockAt**(`px`, `py`, `pz`): [`Block`](../#block)

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

[`Block`](../#block)

___

### getSunlightAt

▸ **getSunlightAt**(`px`, `py`, `pz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`number`

___

### getTorchLightAt

▸ **getTorchLightAt**(`px`, `py`, `pz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `color` | [`LightColor`](../#lightcolor) |

#### Returns

`number`

___

### getVoxelAt

▸ **getVoxelAt**(`px`, `py`, `pz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`number`

___

### getVoxelRotationAt

▸ **getVoxelRotationAt**(`px`, `py`, `pz`): [`BlockRotation`](../classes/BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

[`BlockRotation`](../classes/BlockRotation.md)

___

### getVoxelStageAt

▸ **getVoxelStageAt**(`px`, `py`, `pz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`number`

___

### setSunlightAt

▸ **setSunlightAt**(`px`, `py`, `pz`, `level`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### setTorchLightAt

▸ **setTorchLightAt**(`px`, `py`, `pz`, `level`, `color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `level` | `number` |
| `color` | [`LightColor`](../#lightcolor) |

#### Returns

`void`
