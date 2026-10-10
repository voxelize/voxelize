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

• **new BoxLayer**(`width`, `height`, `depth`, `widthSegments`, `heightSegments`, `depthSegments`, `side`, `transparent`, `receiveShadows?`, `underwaterFog?`, `mergeFaces?`): [`BoxLayer`](BoxLayer.md)

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
| `underwaterFog` | `boolean` | `false` | Whether or not should this canvas box tint underwater. |
| `mergeFaces` | `boolean` | `false` | Whether to draw the six faces in one call through an atlas. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Overrides

Mesh.constructor

## Properties

### atlas

• **atlas**: `Object` = `null`

The one atlas this layer draws with when its faces are merged
(`CanvasBoxOptions.mergeFaces`), else `null` and the layer draws each
face with its own material.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `canvas` | `HTMLCanvasElement` |
| `layout` | [`CanvasBoxAtlasLayout`](../#canvasboxatlaslayout) |
| `material` | `MeshBasicMaterial` |
| `texture` | `CanvasTexture`<`HTMLCanvasElement`\> |

___

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

• **materials**: `Map`<`string`, `MeshBasicMaterial`\>

The materials of the six faces of this box layer.

___

### shadowUniforms

• **shadowUniforms**: [`EntityShadowUniforms`](../interfaces/EntityShadowUniforms.md) = `null`

Shadow uniforms for this box layer (only set if receiveShadows is true).

___

### underwaterUniforms

• **underwaterUniforms**: [`UnderwaterFogUniforms`](../interfaces/UnderwaterFogUniforms.md) = `null`

Underwater fog uniforms for this box layer (only set if underwaterFog is
true). Driven externally from the camera's water-optics state.

___

### width

• **width**: `number`

The width of the box layer.

___

### widthSegments

• **widthSegments**: `number`

The width segments of the box layer.

## Methods

### dispose

▸ **dispose**(): `void`

Free this layer's GPU resources: its geometry, and each face's canvas
texture and material (and a merged layer's atlas). The canvases
themselves are left intact, so a consumer that still borrows a face (a
portrait) re-uploads it instead of drawing garbage. Call once the layer
has left the scene for good.

#### Returns

`void`

___

### paint

▸ **paint**(`side`, `art`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `side` | [`BoxSides`](../#boxsides) \| [`BoxSides`](../#boxsides)[] | The side(s) of the box layer to draw on. |
| `art` | `Color` \| `Texture`<`unknown`\> \| [`ArtFunction`](../#artfunction) | The art or art function to draw on the box layer's side. |

#### Returns

`void`

___

### syncAtlas

▸ **syncAtlas**(`faces?`): `void`

Bring a merged layer's atlas up to date with its face canvases: relay
the atlas out and re-point the UVs when a face canvas was resized or the
geometry replaced, then copy the given faces (every face after a
relayout) into it. `paint` calls this; call it after editing a face
canvas directly. A no-op on a per-face layer.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `faces` | readonly [`BoxSides`](../#boxsides)[] | `BOX_SIDES` |

#### Returns

`void`
