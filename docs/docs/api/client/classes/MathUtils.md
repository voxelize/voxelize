---
id: "MathUtils"
title: "Class: MathUtils"
sidebar_label: "MathUtils"
sidebar_position: 0
custom_edit_url: null
---

A utility class for doing math operations.

## Methods

### directionToQuaternion

▸ **directionToQuaternion**(`dx`, `dy`, `dz`): `Quaternion`

Convert a direction vector to a quaternion.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `dx` | `number` | X component of the direction vector. |
| `dy` | `number` | Y component of the direction vector. |
| `dz` | `number` | Z component of the direction vector. |

#### Returns

`Quaternion`

The quaternion representing the direction vector.

___

### normalizeAngle

▸ **normalizeAngle**(`angle`): `number`

Normalizes an angle to be between -2PI and 2PI.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | The angle to normalize. |

#### Returns

`number`

The normalized angle.

___

### round

▸ **round**(`n`, `digits`): `number`

Round a number to a given precision.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `n` | `number` | The number to round. |
| `digits` | `number` | The number of digits after decimal to round to. |

#### Returns

`number`

The rounded number.
