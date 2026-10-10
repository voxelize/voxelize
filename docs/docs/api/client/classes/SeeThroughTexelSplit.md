---
id: "SeeThroughTexelSplit"
title: "Class: SeeThroughTexelSplit"
sidebar_label: "SeeThroughTexelSplit"
sidebar_position: 0
custom_edit_url: null
---

Splits a see-through mesh's texels by their alpha (see [TexelPlan](../#texelplan)).
Solid texels hide what is behind them, so they draw with the depth
writers, and the depth they leave hides the blended layers behind them;
translucent texels tint what is behind, so they blend and write nothing.
One material fork per side carries the cut, made once per material.

## Constructors

### constructor

• **new SeeThroughTexelSplit**(`cuts`, `fork`): [`SeeThroughTexelSplit`](SeeThroughTexelSplit.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cuts` | [`TexelAlphaCuts`](../#texelalphacuts) | - |
| `fork` | (`material`: `Material`) => `Material` | A copy of a material that keeps its live uniforms and textures. |

#### Returns

[`SeeThroughTexelSplit`](SeeThroughTexelSplit.md)

## Properties

### cuts

• `Readonly` **cuts**: [`TexelAlphaCuts`](../#texelalphacuts)

## Methods

### apply

▸ **apply**(`mesh`, `base`, `plan`): `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

Points `mesh` at the draws `plan` asks for, `base` being the material it
was built with. The child that draws translucent texels is made the
first time a split needs it and hidden, never disposed, when a later
plan does not: it draws from the mesh's own buffers.

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\> |
| `base` | `Material` |
| `plan` | [`TexelPlan`](../#texelplan) |

#### Returns

`Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

___

### forget

▸ **forget**(`material`): `void`

Drops `material`'s forks: its shader changed, and they copied the old.

#### Parameters

| Name | Type |
| :------ | :------ |
| `material` | `Material` |

#### Returns

`void`

___

### forksOf

▸ **forksOf**(`material`): [`TexelForks`](../#texelforks)

#### Parameters

| Name | Type |
| :------ | :------ |
| `material` | `Material` |

#### Returns

[`TexelForks`](../#texelforks)

___

### layerOf

▸ **layerOf**(`mesh`): `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>

The child that draws `mesh`'s translucent texels, once one was made.

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\> |

#### Returns

`Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>
