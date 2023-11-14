---
id: "BlockRotation"
title: "Class: BlockRotation"
sidebar_label: "BlockRotation"
sidebar_position: 0
custom_edit_url: null
---

A block rotation consists of two rotations: one is the axis this block is pointing towards,
and the other is the rotation around that axis (y-rotation). Y-rotation is only applicable
to the positive and negative x-axis.

## Constructors

### constructor

• **new BlockRotation**(`value?`, `yRotation?`): [`BlockRotation`](BlockRotation.md)

Create a new block rotation.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `value` | `number` | `PY_ROTATION` | The axis this block is pointing towards. |
| `yRotation` | `number` | `0` | The rotation around the axis this block is pointing towards, rounded to the nearest (360 / 16) degrees. |

#### Returns

[`BlockRotation`](BlockRotation.md)

## Properties

### value

• **value**: `number`

The axis this block is pointing towards.

___

### yRotation

• **yRotation**: `number`

The rotation around the axis this block is pointing towards, rounded to the nearest
(360 / 16) degrees.

## Methods

### decode

▸ **decode**(`rotation`): `number`[]

Decode a block rotation into two rotations.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation` | [`BlockRotation`](BlockRotation.md) | The block rotation to decode. |

#### Returns

`number`[]

Two values, the first is the axis this block is pointing towards, and
  the second is the rotation around that axis.

___

### encode

▸ **encode**(`value`, `yRotation?`): [`BlockRotation`](BlockRotation.md)

Encode two rotations into a new block rotation instance.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `value` | `number` | `undefined` | The axis this block is pointing towards. |
| `yRotation` | `number` | `0` | The rotation around the axis this block is pointing towards. |

#### Returns

[`BlockRotation`](BlockRotation.md)

A new block rotation.

___

### rotateAABB

▸ **rotateAABB**(`aabb`, `yRotate?`, `translate?`): `AABB`

Rotate an axis aligned bounding box by this block rotation, recalculating the new
maximum and minimum coordinates to this AABB.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `aabb` | `AABB` | `undefined` | The axis aligned bounding box to be rotated. |
| `yRotate` | `boolean` | `true` | Whether or not should the y-rotation be applied. |
| `translate` | `boolean` | `true` | Whether or not should the translation be applied. |

#### Returns

`AABB`

A new axis aligned bounding box.

___

### rotateNode

▸ **rotateNode**(`node`, `yRotate?`, `translate?`): `void`

Rotate a 3D coordinate by this block rotation.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `node` | [`Coords3`](../modules.md#coords3) | `undefined` | A 3D coordinate in the form of [x, y, z] to be rotated by this block rotation. |
| `yRotate` | `boolean` | `true` | Whether or not should the y-rotation be applied. |
| `translate` | `boolean` | `true` | Whether or not should the translation be applied. |

#### Returns

`void`

___

### rotateTransparency

▸ **rotateTransparency**(`«destructured»`): `boolean`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `«destructured»` | [`boolean`, `boolean`, `boolean`, `boolean`, `boolean`, `boolean`] |

#### Returns

`boolean`[]
