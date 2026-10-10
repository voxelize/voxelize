---
id: "BoneTextureManager"
title: "Class: BoneTextureManager"
sidebar_label: "BoneTextureManager"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new BoneTextureManager**(`maxInstances`, `bonesPerInstance`): [`BoneTextureManager`](BoneTextureManager.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `maxInstances` | `number` |
| `bonesPerInstance` | `number` |

#### Returns

[`BoneTextureManager`](BoneTextureManager.md)

## Methods

### allocate

▸ **allocate**(): `number`

#### Returns

`number`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### free

▸ **free**(`slot`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | `number` |

#### Returns

`void`

___

### getActiveCount

▸ **getActiveCount**(): `number`

#### Returns

`number`

___

### getBonesPerInstance

▸ **getBonesPerInstance**(): `number`

#### Returns

`number`

___

### getHeight

▸ **getHeight**(): `number`

#### Returns

`number`

___

### getTexture

▸ **getTexture**(): `DataTexture`

#### Returns

`DataTexture`

___

### getWidth

▸ **getWidth**(): `number`

#### Returns

`number`

___

### setBoneMatrix

▸ **setBoneMatrix**(`instanceIndex`, `boneIndex`, `matrix`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `instanceIndex` | `number` |
| `boneIndex` | `number` |
| `matrix` | `Matrix4` |

#### Returns

`void`

___

### upload

▸ **upload**(`renderer`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |

#### Returns

`void`
