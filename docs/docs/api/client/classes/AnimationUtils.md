---
id: "AnimationUtils"
title: "Class: AnimationUtils"
sidebar_label: "AnimationUtils"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new AnimationUtils**(): [`AnimationUtils`](AnimationUtils.md)

#### Returns

[`AnimationUtils`](AnimationUtils.md)

## Methods

### generateClip

▸ **generateClip**(`name`, `times`, `initialPosition`, `initialQuaternion`, `midPositions`, `midQuaternions`): `AnimationClip`

Generates an animation clip.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | Name of the clip |
| `times` | `number`[] | Times of the clip |
| `initialPosition` | `Vector3` | Initial position |
| `initialQuaternion` | `Quaternion` | Initial quaternion |
| `midPositions` | `Vector3`[] | Middle positions |
| `midQuaternions` | `Quaternion`[] | Middle quaternions |

#### Returns

`AnimationClip`

Animation clip
