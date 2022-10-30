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

<div style={{width: "100%", display: "flex", flexDirection: "column", alignItems: "center"}}>

 ![Bobby from King of the Hill](/img/bobby-canvas-box.png)

 <p style={{textAlign: "center", color: "gray", fontSize: "0.8rem"}}>Bobby from King of the Hill rendered in CanvasBoxes</p>
</div>

## Hierarchy

- `Group`

  ↳ **`CanvasBox`**

  ↳↳ [`Sky`](Sky.md)

## Properties

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams-394)

Parameters for creating a canvas box.

___

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

The inner layers of the canvas box.

___

### width

• **width**: `number`

The width of the canvas box.

___

### height

• **height**: `number`

The height of the canvas box.

___

### depth

• **depth**: `number`

The depth of the canvas box.

## Constructors

### constructor

• **new CanvasBox**(`params?`)

Create a new canvas box.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Partial`<[`CanvasBoxParams`](../modules.md#canvasboxparams-394)\> | The parameters for creating a canvas box. |

#### Overrides

Group.constructor

## Methods

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-394) \| [`BoxSides`](../modules.md#boxsides-394)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-394) \| `Color` | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`<`string`, `MeshBasicMaterial`\>

The first layer of the canvas box.

#### Returns

`Map`<`string`, `MeshBasicMaterial`\>
