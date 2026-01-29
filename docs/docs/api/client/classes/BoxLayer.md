---
id: "BoxLayer"
title: "Class: BoxLayer"
sidebar_label: "BoxLayer"
sidebar_position: 0
custom_edit_url: null
---

A layer of a canvas box. This is a group of six canvases that are rendered as a single mesh.

## Hierarchy

- `Mesh`

  ↳ **`BoxLayer`**

## Constructors

### constructor

• **new BoxLayer**(`width`, `height`, `depth`, `widthSegments`, `heightSegments`, `depthSegments`, `side`, `transparent`, `receiveShadows?`): [`BoxLayer`](BoxLayer.md)

Create a six-sided canvas box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `width` | `number` | `undefined` | The width of the box layer. |
| `height` | `number` | `undefined` | The height of the box layer. |
| `depth` | `number` | `undefined` | The depth of the box layer. |
| `widthSegments` | `number` | `undefined` | The width segments of the box layer. |
| `heightSegments` | `number` | `undefined` | The height segments of the box layer. |
| `depthSegments` | `number` | `undefined` | The depth segments of the box layer. |
| `side` | `Side` | `undefined` | The side of the box layer to render. |
| `transparent` | `boolean` | `undefined` | Whether or not should this canvas box be rendered as transparent. |
| `receiveShadows` | `boolean` | `false` | Whether or not should this canvas box receive shadows. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Overrides

Mesh.constructor

## Properties

### depth

• **depth**: `number`

The depth of the box layer.

___

### depthSegments

• **depthSegments**: `number`

The depth segments of the box layer.

___

### height

• **height**: `number`

The height of the box layer.

___

### heightSegments

• **heightSegments**: `number`

The height segments of the box layer.

___

### materials

• **materials**: `Map`\<`string`, `MeshBasicMaterial`\>

The materials of the six faces of this box layer.

___

### shadowUniforms

• **shadowUniforms**: [`EntityShadowUniforms`](../interfaces/EntityShadowUniforms.md) = `null`

Shadow uniforms for this box layer (only set if receiveShadows is true).

___

### width

• **width**: `number`

The width of the box layer.

___

### widthSegments

• **widthSegments**: `number`

The width segments of the box layer.

## Methods

### paint

▸ **paint**(`side`, `art`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides) \| [`BoxSides`](../modules.md#boxsides)[] | The side(s) of the box layer to draw on. |
| `art` | `Color` \| `Texture` \| [`ArtFunction`](../modules.md#artfunction) | The art or art function to draw on the box layer's side. |

#### Returns

`void`
