---
id: "BlockRotation"
title: "Class: BlockRotation"
sidebar_label: "BlockRotation"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new BlockRotation**(`value?`, `yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `value` | `number` | `PY_ROTATION` |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

## Properties

### value

• **value**: `number` = `PY_ROTATION`

___

### yRotation

• **yRotation**: `number` = `0`

## Accessors

### axis

• `get` **axis**(): `number`

#### Returns

`number`

• `set` **axis**(`axis`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `axis` | `number` |

#### Returns

`void`

## Methods

### NX

▸ **NX**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### NY

▸ **NY**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### NZ

▸ **NZ**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### PX

▸ **PX**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### PY

▸ **PY**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### PZ

▸ **PZ**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### decode

▸ **decode**(`rotation`): [`number`, `number`]

#### Parameters

| Name | Type |
| :------ | :------ |
| `rotation` | [`BlockRotation`](BlockRotation.md) |

#### Returns

[`number`, `number`]

___

### encode

▸ **encode**(`value`, `yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `value` | `number` | `undefined` |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### equals

▸ **equals**(`other`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`boolean`

___

### nx

▸ **nx**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### ny

▸ **ny**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### nz

▸ **nz**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### px

▸ **px**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### py

▸ **py**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### pz

▸ **pz**(`yRotation?`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `yRotation` | `number` | `0` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### rotateAABB

▸ **rotateAABB**(`aabb`, `yRotate?`, `translate?`): [`AABB`](AABB.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `aabb` | [`AABB`](AABB.md) | `undefined` |
| `yRotate` | `boolean` | `true` |
| `translate` | `boolean` | `true` |

#### Returns

[`AABB`](AABB.md)

___

### rotateNode

▸ **rotateNode**(`node`, `yRotate?`, `translate?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `node` | [`Vec3`](../modules.md#vec3) | `undefined` |
| `yRotate` | `boolean` | `true` |
| `translate` | `boolean` | `true` |

#### Returns

`void`

___

### rotateTransparency

▸ **rotateTransparency**(`«destructured»`): [`FaceTransparency`](../modules.md#facetransparency)

#### Parameters

| Name | Type |
| :------ | :------ |
| `«destructured»` | [`FaceTransparency`](../modules.md#facetransparency) |

#### Returns

[`FaceTransparency`](../modules.md#facetransparency)
