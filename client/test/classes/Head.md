[@voxelize/client](../README.md) / [Exports](../modules.md) / Head

# Class: Head

## Table of contents

### Constructors

- [constructor](Head.md#constructor)

### Properties

- [box](Head.md#box)
- [params](Head.md#params)

### Accessors

- [mesh](Head.md#mesh)

### Methods

- [drawBackground](Head.md#drawbackground)
- [drawCrown](Head.md#drawcrown)
- [drawFace](Head.md#drawface)
- [drawHair](Head.md#drawhair)

## Constructors

### constructor

• **new Head**(`params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | [`HeadParams`](../modules.md#headparams) |

#### Defined in

[client/src/libs/head.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L13)

## Properties

### box

• **box**: [`CanvasBox`](CanvasBox.md)

#### Defined in

[client/src/libs/head.ts:11](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L11)

___

### params

• **params**: [`HeadParams`](../modules.md#headparams)

## Accessors

### mesh

• `get` **mesh**(): `Group`

#### Returns

`Group`

#### Defined in

[client/src/libs/head.ts:106](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L106)

## Methods

### drawBackground

▸ `Private` **drawBackground**(`context`, `canvas`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |
| `canvas` | `HTMLCanvasElement` |

#### Returns

`void`

#### Defined in

[client/src/libs/head.ts:31](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L31)

___

### drawCrown

▸ `Private` **drawCrown**(`context`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |

#### Returns

`void`

#### Defined in

[client/src/libs/head.ts:59](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L59)

___

### drawFace

▸ `Private` **drawFace**(`context`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |

#### Returns

`void`

#### Defined in

[client/src/libs/head.ts:39](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L39)

___

### drawHair

▸ `Private` **drawHair**(`material`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `material` | `MeshBasicMaterial` |

#### Returns

`void`

#### Defined in

[client/src/libs/head.ts:95](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L95)
