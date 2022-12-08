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

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams-96)

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

## Constructors

### constructor

• **new CanvasBox**(`params?`)

Create a new canvas box.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Partial`<[`CanvasBoxParams`](../modules.md#canvasboxparams-96)\> | The parameters for creating a canvas box. |

#### Overrides

Group.constructor

## Methods

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-96) \| [`BoxSides`](../modules.md#boxsides-96)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| `Color` \| [`ArtFunction`](../modules.md#artfunction-96) | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`
