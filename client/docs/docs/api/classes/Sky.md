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

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams-556)

Parameters for creating a canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[params](CanvasBox.md#params-556)

___

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

The inner layers of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[boxLayers](CanvasBox.md#boxlayers-556)

___

### width

• **width**: `number`

The width of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[width](CanvasBox.md#width-556)

___

### height

• **height**: `number`

The height of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[height](CanvasBox.md#height-556)

___

### depth

• **depth**: `number`

The depth of the canvas box.

#### Inherited from

[CanvasBox](CanvasBox.md).[depth](CanvasBox.md#depth-556)

___

### uTopColor

• **uTopColor**: `Object`

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

### uBottomColor

• **uBottomColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### dimension

• **dimension**: `number` = `2000`

___

### lerpFactor

• **lerpFactor**: `number` = `0.01`

## Methods

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-556) \| [`BoxSides`](../modules.md#boxsides-556)[] | `undefined` | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-556) \| `Color` | `undefined` | The art or art function to draw on the box layer's side. |
| `layer` | `number` | `0` | The layer to draw on. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[paint](CanvasBox.md#paint-556)

___

### getMiddleColor

▸ **getMiddleColor**(): `Color`

#### Returns

`Color`

___

### update

▸ **update**(`position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |

#### Returns

`void`

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

[CanvasBox](CanvasBox.md).[constructor](CanvasBox.md#constructor-556)
