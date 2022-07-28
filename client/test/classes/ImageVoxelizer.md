[@voxelize/client](../README.md) / [Exports](../modules.md) / ImageVoxelizer

# Class: ImageVoxelizer

## Table of contents

### Constructors

- [constructor](ImageVoxelizer.md#constructor)

### Methods

- [build](ImageVoxelizer.md#build)
- [parse](ImageVoxelizer.md#parse)

## Constructors

### constructor

• **new ImageVoxelizer**()

## Methods

### build

▸ `Static` **build**(`imgURL`, `world`, `position`, `params`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `imgURL` | `string` |
| `world` | [`World`](World.md) |
| `position` | `Vector3` |
| `params` | [`ImageVoxelizerParams`](../modules.md#imagevoxelizerparams) |

#### Returns

`Promise`<`boolean`\>

#### Defined in

[client/src/libs/image-voxelizer.ts:68](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/image-voxelizer.ts#L68)

___

### parse

▸ `Static` **parse**(`rest`): [`string`, [`ImageVoxelizerParams`](../modules.md#imagevoxelizerparams)]

#### Parameters

| Name | Type |
| :------ | :------ |
| `rest` | `string` |

#### Returns

[`string`, [`ImageVoxelizerParams`](../modules.md#imagevoxelizerparams)]

#### Defined in

[client/src/libs/image-voxelizer.ts:39](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/image-voxelizer.ts#L39)
