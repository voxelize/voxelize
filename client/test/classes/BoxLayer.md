[@voxelize/client](../README.md) / [Exports](../modules.md) / BoxLayer

# Class: BoxLayer

## Table of contents

### Constructors

- [constructor](BoxLayer.md#constructor)

### Properties

- [dimension](BoxLayer.md#dimension)
- [geometry](BoxLayer.md#geometry)
- [materials](BoxLayer.md#materials)
- [mesh](BoxLayer.md#mesh)
- [width](BoxLayer.md#width)

### Methods

- [createCanvasMaterial](BoxLayer.md#createcanvasmaterial)
- [paint](BoxLayer.md#paint)

## Constructors

### constructor

• **new BoxLayer**(`dimension`, `width`, `side`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |
| `width` | `number` |
| `side` | `Side` |

#### Defined in

[client/src/libs/canvas-box.ts:55](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L55)

## Properties

### dimension

• **dimension**: `number`

___

### geometry

• **geometry**: `BoxGeometry`

#### Defined in

[client/src/libs/canvas-box.ts:51](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L51)

___

### materials

• **materials**: `Map`<`string`, `MeshBasicMaterial`\>

#### Defined in

[client/src/libs/canvas-box.ts:52](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L52)

___

### mesh

• **mesh**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>

#### Defined in

[client/src/libs/canvas-box.ts:53](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L53)

___

### width

• **width**: `number`

## Methods

### createCanvasMaterial

▸ **createCanvasMaterial**(): `MeshBasicMaterial`

#### Returns

`MeshBasicMaterial`

#### Defined in

[client/src/libs/canvas-box.ts:71](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L71)

___

### paint

▸ **paint**(`side`, `art`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides) \| [`BoxSides`](../modules.md#boxsides)[] |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction) \| `Color` |

#### Returns

`void`

#### Defined in

[client/src/libs/canvas-box.ts:96](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L96)
