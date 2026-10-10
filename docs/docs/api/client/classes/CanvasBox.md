---
id: "CanvasBox"
title: "Class: CanvasBox"
sidebar_label: "CanvasBox"
sidebar_position: 0
custom_edit_url: null
---

A canvas box is a group of `BoxLayer`s that are rendered as a single mesh.
Each box layer is a group of six canvases that are also rendered as a single mesh.
You can then paint on each canvas individually by calling `box.paint()`.

# Example
```ts
const box = new VOXELIZE.CanvasBox();

box.paint("all", (ctx, canvas) => {
  ctx.fillStyle = "red";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
});
```

![Bobby from King of the Hill](/img/docs/bobby-canvas-box.png)

# Rotation Conventions
- `rotation.x`: Positive tilts backward (front face goes up), negative tilts forward
- `rotation.y`: Positive rotates left (counter-clockwise from above), negative rotates right
- `rotation.z`: Positive rolls counter-clockwise (from front view), negative rolls clockwise

## Hierarchy

- `Group`

  ↳ **`CanvasBox`**

  ↳↳ [`Sky`](Sky.md)

## Constructors

### constructor

• **new CanvasBox**(`options?`): [`CanvasBox`](CanvasBox.md)

Create a new canvas box.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Partial`<[`CanvasBoxOptions`](../#canvasboxoptions)\> | The options for creating a canvas box. |

#### Returns

[`CanvasBox`](CanvasBox.md)

#### Overrides

Group.constructor

## Properties

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

The inner layers of the canvas box.

___

### depth

• **depth**: `number`

The depth of the canvas box.

___

### height

• **height**: `number`

The height of the canvas box.

___

### options

• **options**: [`CanvasBoxOptions`](../#canvasboxoptions)

Parameters for creating a canvas box.

___

### width

• **width**: `number`

The width of the canvas box.

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`<`string`, `MeshBasicMaterial`\>

The first layer of the canvas box.

#### Returns

`Map`<`string`, `MeshBasicMaterial`\>

___

### shadowUniforms

• `get` **shadowUniforms**(): [`EntityShadowUniforms`](../interfaces/EntityShadowUniforms.md)

Get the shadow uniforms for this canvas box (from the first layer).
Returns null if receiveShadows is false.

#### Returns

[`EntityShadowUniforms`](../interfaces/EntityShadowUniforms.md)

___

### underwaterUniforms

• `get` **underwaterUniforms**(): [`UnderwaterFogUniforms`](../interfaces/UnderwaterFogUniforms.md)

Get the underwater fog uniforms for this canvas box (from the first
layer). Returns null if underwaterFog is false.

#### Returns

[`UnderwaterFogUniforms`](../interfaces/UnderwaterFogUniforms.md)

## Methods

### dispose

▸ **dispose**(): `void`

Free every layer's geometry, face textures and materials. Call once the
box has left the scene for good.

#### Returns

`void`

___

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../#boxsides) \| [`BoxSides`](../#boxsides)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Color` \| `Texture`<`unknown`\> \| [`ArtFunction`](../#artfunction) | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`
