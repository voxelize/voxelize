---
id: "BoxLayer"
title: "Class: BoxLayer"
sidebar_label: "BoxLayer"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### geometry

• **geometry**: `BoxGeometry`

___

### materials

• **materials**: `Map`<`string`, `MeshBasicMaterial`\>

___

### mesh

• **mesh**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>

___

### width

• **width**: `number`

___

### height

• **height**: `number`

___

### depth

• **depth**: `number`

___

### widthSegments

• **widthSegments**: `number`

___

### heightSegments

• **heightSegments**: `number`

___

### depthSegments

• **depthSegments**: `number`

## Constructors

### constructor

• **new BoxLayer**(`width`, `height`, `depth`, `widthSegments`, `heightSegments`, `depthSegments`, `side`, `transparent`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `width` | `number` |
| `height` | `number` |
| `depth` | `number` |
| `widthSegments` | `number` |
| `heightSegments` | `number` |
| `depthSegments` | `number` |
| `side` | `Side` |
| `transparent` | `boolean` |

## Methods

### createCanvasMaterial

▸ **createCanvasMaterial**(`face`): `MeshBasicMaterial`

#### Parameters

| Name | Type |
| :------ | :------ |
| `face` | [`BoxSides`](../modules.md#boxsides-90) |

#### Returns

`MeshBasicMaterial`

___

### paint

▸ **paint**(`side`, `art`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-90) \| [`BoxSides`](../modules.md#boxsides-90)[] |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-90) \| `Color` |

#### Returns

`void`
