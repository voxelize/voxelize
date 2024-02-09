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

![Sky](/img/docs/sky.png)

## Hierarchy

- [`CanvasBox`](CanvasBox.md)

  ↳ **`Sky`**

## Constructors

### constructor

• **new Sky**(`options?`): [`Sky`](Sky.md)

Create a new sky instance.

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`SkyOptions`](../modules.md#skyoptions)\> |

#### Returns

[`Sky`](Sky.md)

#### Overrides

[CanvasBox](CanvasBox.md).[constructor](CanvasBox.md#constructor)

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

### height

• **height**: `number`

The height of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[height](CanvasBox.md#height)

___

### options

• **options**: [`CanvasBoxOptions`](../modules.md#canvasboxoptions) & [`SkyOptions`](../modules.md#skyoptions)

Parameters for creating a canvas box.

#### Overrides

[CanvasBox](CanvasBox.md).[options](CanvasBox.md#options)

___

### shadingData

• **shadingData**: [`SkyShadingCycleData`](../modules.md#skyshadingcycledata)[] = `[]`

___

### uBottomColor

• **uBottomColor**: `Object`

The bottom color of the sky gradient. Change this by calling Sky.setBottomColor.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uMiddleColor

• **uMiddleColor**: `Object`

The middle color of the sky gradient. Change this by calling Sky.setMiddleColor.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uSkyOffset

• **uSkyOffset**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### uTopColor

• **uTopColor**: `Object`

The top color of the sky gradient. Change this by calling Sky.setTopColor.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uVoidOffset

• **uVoidOffset**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### width

• **width**: `number`

The width of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[width](CanvasBox.md#width)

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`\<`string`, `MeshBasicMaterial`\>

The first layer of the canvas box.

#### Returns

`Map`\<`string`, `MeshBasicMaterial`\>

#### Inherited from

CanvasBox.boxMaterials

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
| `art` | `Color` \| `Texture` \| [`ArtFunction`](../modules.md#artfunction) | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[paint](CanvasBox.md#paint)

___

### setShadingPhases

▸ **setShadingPhases**(`data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | [`SkyShadingCycleData`](../modules.md#skyshadingcycledata)[] |

#### Returns

`void`

___

### update

▸ **update**(`position`, `time`, `timePerDay`): `void`

Update the position of the sky box to the camera's x/z position, and lerp the sky gradient colors.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `position` | `Vector3` | The new position to center the sky at. |
| `time` | `number` | - |
| `timePerDay` | `number` | - |

#### Returns

`void`
