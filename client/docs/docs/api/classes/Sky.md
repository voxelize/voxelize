---
id: "Sky"
title: "Class: Sky"
sidebar_label: "Sky"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`CanvasBox`](CanvasBox.md)

  ↳ **`Sky`**

## Properties

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

The inner layers of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[boxLayers](CanvasBox.md#boxlayers-82)

___

### depth

• **depth**: `number`

The depth of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[depth](CanvasBox.md#depth-82)

___

### dimension

• **dimension**: `number` = `2000`

___

### height

• **height**: `number`

The height of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[height](CanvasBox.md#height-82)

___

### lerpFactor

• **lerpFactor**: `number` = `0.01`

___

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams-82)

Parameters for creating a canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[params](CanvasBox.md#params-82)

___

### uBottomColor

• **uBottomColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uMiddleColor

• **uMiddleColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uTopColor

• **uTopColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### width

• **width**: `number`

The width of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[width](CanvasBox.md#width-82)

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

Create a new canvas box.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `dimension` | `number` | `2000` |
| `lerpFactor` | `number` | `0.01` |

#### Overrides

[CanvasBox](CanvasBox.md).[constructor](CanvasBox.md#constructor-82)

## Methods

### getMiddleColor

▸ **getMiddleColor**(): `Color`

#### Returns

`Color`

___

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-82) \| [`BoxSides`](../modules.md#boxsides-82)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-82) \| `Color` | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[paint](CanvasBox.md#paint-82)

___

### update

▸ **update**(`position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |

#### Returns

`void`
