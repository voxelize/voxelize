---
id: "TransparentMediumSource"
title: "Interface: TransparentMediumSource"
sidebar_label: "TransparentMediumSource"
sidebar_position: 0
custom_edit_url: null
---

What [TRANSPARENT_SORT](../#transparent_sort) asks about water: the camera's medium, and
the medium at a point. A `World` answers both.

## Methods

### isCameraSubmerged

▸ **isCameraSubmerged**(): `boolean`

#### Returns

`boolean`

___

### orderIndependentBandOf

▸ **orderIndependentBandOf**(`object`, `material`): `number`

While the source draws its blended layers order-independently, the band
an item draws in (`OrderIndependentTransparency.bandOf`); undefined
leaves it to its render order and medium.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |
| `material` | `Material` |

#### Returns

`number`

___

### transparentMediumAt

▸ **transparentMediumAt**(`x`, `y`, `z`): [`TransparentMedium`](../#transparentmedium)

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

[`TransparentMedium`](../#transparentmedium)
