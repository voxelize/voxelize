[@voxelize/client](../README.md) / [Exports](../modules.md) / CanvasBox

# Class: CanvasBox

## Table of contents

### Constructors

- [constructor](CanvasBox.md#constructor)

### Properties

- [layers](CanvasBox.md#layers)
- [meshes](CanvasBox.md#meshes)
- [params](CanvasBox.md#params)
- [scaleColor](CanvasBox.md#scalecolor)

### Accessors

- [boxMaterials](CanvasBox.md#boxmaterials)

### Methods

- [makeBoxes](CanvasBox.md#makeboxes)
- [paint](CanvasBox.md#paint)

## Constructors

### constructor

• **new CanvasBox**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`CanvasBoxParams`](../modules.md#canvasboxparams)\> |

#### Defined in

[client/src/libs/canvas-box.ts:144](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L144)

## Properties

### layers

• **layers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

#### Defined in

[client/src/libs/canvas-box.ts:142](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L142)

___

### meshes

• **meshes**: `Group`

#### Defined in

[client/src/libs/canvas-box.ts:141](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L141)

___

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams)

#### Defined in

[client/src/libs/canvas-box.ts:139](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L139)

___

### scaleColor

• **scaleColor**: (`multiplier`: `number`) => `void`

#### Type declaration

▸ (`multiplier`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `multiplier` | `number` |

##### Returns

`void`

#### Defined in

[client/src/libs/canvas-box.ts:176](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L176)

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`<`string`, `MeshBasicMaterial`\>

#### Returns

`Map`<`string`, `MeshBasicMaterial`\>

#### Defined in

[client/src/libs/canvas-box.ts:190](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L190)

## Methods

### makeBoxes

▸ **makeBoxes**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/canvas-box.ts:153](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L153)

___

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides) \| [`BoxSides`](../modules.md#boxsides)[] | `undefined` |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction) \| `Color` | `undefined` |
| `layer` | `number` | `0` |

#### Returns

`void`

#### Defined in

[client/src/libs/canvas-box.ts:163](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L163)
