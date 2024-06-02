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
| `options` | `Partial`\<[`CanvasBoxOptions`](../modules.md#canvasboxoptions)\> | The options for creating a canvas box. |

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

• **options**: [`CanvasBoxOptions`](../modules.md#canvasboxoptions)

Parameters for creating a canvas box.

___

### width

• **width**: `number`

The width of the canvas box.

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`\<`string`, `MeshBasicMaterial`\>

The first layer of the canvas box.

#### Returns

`Map`\<`string`, `MeshBasicMaterial`\>

## Methods

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides) \| [`BoxSides`](../modules.md#boxsides)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Color` \| `Texture` \| [`ArtFunction`](../modules.md#artfunction) | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`
