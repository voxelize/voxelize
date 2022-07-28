[@voxelize/client](../README.md) / [Exports](../modules.md) / TextureAtlas

# Class: TextureAtlas

## Table of contents

### Constructors

- [constructor](TextureAtlas.md#constructor)

### Properties

- [canvas](TextureAtlas.md#canvas)
- [dataURLs](TextureAtlas.md#dataurls)
- [margin](TextureAtlas.md#margin)
- [material](TextureAtlas.md#material)
- [params](TextureAtlas.md#params)
- [texture](TextureAtlas.md#texture)

### Methods

- [makeCanvasPowerOfTwo](TextureAtlas.md#makecanvaspoweroftwo)
- [create](TextureAtlas.md#create)
- [makeUnknownTexture](TextureAtlas.md#makeunknowntexture)

## Constructors

### constructor

• **new TextureAtlas**()

## Properties

### canvas

• **canvas**: `HTMLCanvasElement`

#### Defined in

[client/src/core/world/atlas.ts:24](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L24)

___

### dataURLs

• **dataURLs**: `Map`<`string`, `string`\>

#### Defined in

[client/src/core/world/atlas.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L23)

___

### margin

• **margin**: `number` = `0`

#### Defined in

[client/src/core/world/atlas.ts:25](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L25)

___

### material

• **material**: `MeshBasicMaterial`

#### Defined in

[client/src/core/world/atlas.ts:22](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L22)

___

### params

• **params**: `TextureAtlasParams`

#### Defined in

[client/src/core/world/atlas.ts:20](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L20)

___

### texture

• **texture**: `CanvasTexture`

#### Defined in

[client/src/core/world/atlas.ts:21](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L21)

## Methods

### makeCanvasPowerOfTwo

▸ **makeCanvasPowerOfTwo**(`canvas?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `canvas?` | `HTMLCanvasElement` |

#### Returns

`void`

#### Defined in

[client/src/core/world/atlas.ts:133](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L133)

___

### create

▸ `Static` **create**(`textureMap`, `ranges`, `params`): [`TextureAtlas`](TextureAtlas.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `textureMap` | `Map`<`string`, `Texture` \| `Color`\> |
| `ranges` | `Map`<`string`, [`TextureRange`](../modules.md#texturerange)\> |
| `params` | `TextureAtlasParams` |

#### Returns

[`TextureAtlas`](TextureAtlas.md)

#### Defined in

[client/src/core/world/atlas.ts:27](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L27)

___

### makeUnknownTexture

▸ `Static` `Private` **makeUnknownTexture**(`dimension`, `color1?`, `color2?`, `segments?`): `CanvasTexture`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `dimension` | `number` | `undefined` |
| `color1` | `string` | `"#6A67CE"` |
| `color2` | `string` | `"#16003B"` |
| `segments` | `number` | `2` |

#### Returns

`CanvasTexture`

#### Defined in

[client/src/core/world/atlas.ts:155](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/atlas.ts#L155)
