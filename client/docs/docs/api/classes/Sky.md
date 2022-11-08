---
id: "Sky"
title: "Class: Sky"
sidebar_label: "Sky"
sidebar_position: 0
custom_edit_url: null
---

Sky consists of both a large dodecahedron used to render the 3-leveled sky gradient and a [CanvasBox](CanvasBox.md) that renders custom sky textures (
for a sky box) within the dodecahedron sky.

# Example
```ts
// Create the sky texture.
const sky = new VOXELIZE.Sky();

// Load a texture and paint it to the top of the sky.
world.loader.addTexture(ExampleImage, (texture) => {
  sky.paint("top", texture);
})

// Add the sky to the scene.
world.add(sky);

// Update the sky per frame.
sky.update(camera.position);
```

![Sky](/img/sky.png)

## Hierarchy

- [`CanvasBox`](CanvasBox.md)

  ↳ **`Sky`**

## Properties

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

The inner layers of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[boxLayers](CanvasBox.md#boxlayers)

___

### depth

• **depth**: `number`

The depth of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[depth](CanvasBox.md#depth)

___

### dimension

• **dimension**: `number`

The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.

___

### height

• **height**: `number`

The height of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[height](CanvasBox.md#height)

___

### lerpFactor

• **lerpFactor**: `number`

The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods.

___

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams)

Parameters for creating a canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[params](CanvasBox.md#params)

___

### uBottomColor

• **uBottomColor**: `Object`

The bottom color of the sky gradient. Change this by calling [Sky.setBottomColor](Sky.md#setbottomcolor).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uMiddleColor

• **uMiddleColor**: `Object`

The middle color of the sky gradient. Change this by calling [Sky.setMiddleColor](Sky.md#setmiddlecolor).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uTopColor

• **uTopColor**: `Object`

The top color of the sky gradient. Change this by calling [Sky.setTopColor](Sky.md#settopcolor).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### width

• **width**: `number`

The width of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[width](CanvasBox.md#width)

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`<`string`, `MeshBasicMaterial`\>

The first layer of the canvas box.

#### Returns

`Map`<`string`, `MeshBasicMaterial`\>

#### Inherited from

CanvasBox.boxMaterials

## Constructors

### constructor

• **new Sky**(`dimension?`, `lerpFactor?`)

Create a new sky instance.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `dimension` | `number` | `2000` | The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension. |
| `lerpFactor` | `number` | `0.01` | The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color. |

#### Overrides

[CanvasBox](CanvasBox.md).[constructor](CanvasBox.md#constructor)

## Methods

### getBottomColor

▸ **getBottomColor**(): `Color`

Get the current bottom color of the sky gradient. This can be used as shader uniforms's value.

#### Returns

`Color`

The current bottom color of the sky gradient.

___

### getMiddleColor

▸ **getMiddleColor**(): `Color`

Get the current middle color of the sky gradient. This can be used as shader uniforms's value. For instance,
this can be used to set the color of the fog in the world.

#### Returns

`Color`

The current middle color of the sky gradient.

___

### getTopColor

▸ **getTopColor**(): `Color`

Get the current top color of the sky gradient. This can be used as shader uniforms's value.

#### Returns

`Color`

The current top color of the sky gradient.

___

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides) \| [`BoxSides`](../modules.md#boxsides)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction) \| `Color` | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[paint](CanvasBox.md#paint)

___

### setBottomColor

▸ **setBottomColor**(`color`): `void`

Set the new bottom color of the sky gradient. This will not affect the sky gradient immediately, but
will instead lerp the current color to the new color.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `Color` | The new color of the bottom of the sky gradient. |

#### Returns

`void`

___

### setMiddleColor

▸ **setMiddleColor**(`color`): `void`

Set the new middle color of the sky gradient. This will not affect the sky gradient immediately, but
will instead lerp the current color to the new color.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `Color` | The new color of the middle of the sky gradient. |

#### Returns

`void`

___

### setTopColor

▸ **setTopColor**(`color`): `void`

Set the new top color of the sky gradient. This will not affect the sky gradient immediately, but
will instead lerp the current color to the new color.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `Color` | The new color of the top of the sky gradient. |

#### Returns

`void`

___

### update

▸ **update**(`position`): `void`

Update the position of the sky box to the camera's x/z position, and lerp the sky gradient colors.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `position` | `Vector3` | The new position to center the sky at. |

#### Returns

`void`
