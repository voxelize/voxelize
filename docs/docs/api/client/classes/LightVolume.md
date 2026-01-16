---
id: "LightVolume"
title: "Class: LightVolume"
sidebar_label: "LightVolume"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new LightVolume**(`config?`): [`LightVolume`](LightVolume.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | `Partial`\<[`LightVolumeConfig`](../interfaces/LightVolumeConfig.md)\> |

#### Returns

[`LightVolume`](LightVolume.md)

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### getResolution

▸ **getResolution**(): `Vector3`

#### Returns

`Vector3`

___

### getTexture

▸ **getTexture**(): `Data3DTexture`

#### Returns

`Data3DTexture`

___

### getVolumeMin

▸ **getVolumeMin**(): `Vector3`

#### Returns

`Vector3`

___

### getVolumeSize

▸ **getVolumeSize**(): `Vector3`

#### Returns

`Vector3`

___

### markDirty

▸ **markDirty**(): `void`

#### Returns

`void`

___

### updateCenter

▸ **updateCenter**(`center`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | `Vector3` |

#### Returns

`boolean`

___

### updateFromRegistry

▸ **updateFromRegistry**(`registry`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `registry` | [`LightSourceRegistry`](LightSourceRegistry.md) |

#### Returns

`boolean`
