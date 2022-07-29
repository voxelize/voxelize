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

### dimension

• **dimension**: `number`

___

### width

• **width**: `number`

## Constructors

### constructor

• **new BoxLayer**(`dimension`, `width`, `side`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |
| `width` | `number` |
| `side` | `Side` |

## Methods

### createCanvasMaterial

▸ **createCanvasMaterial**(): `MeshBasicMaterial`

#### Returns

`MeshBasicMaterial`

___

### paint

▸ **paint**(`side`, `art`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-4) \| [`BoxSides`](../modules.md#boxsides-4)[] |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-4) \| `Color` |

#### Returns

`void`
