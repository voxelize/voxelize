---
id: "AtlasTexture"
title: "Class: AtlasTexture"
sidebar_label: "AtlasTexture"
sidebar_position: 0
custom_edit_url: null
---

A texture atlas is a collection of textures that are packed into a single texture.
This is useful for reducing the number of draw calls required to render a scene, since
all block textures can be rendered with a single draw call.

By default, the texture atlas creates an additional border around each texture to prevent
texture bleeding.

![Texture bleeding](/img/docs/texture-bleeding.png)

## Hierarchy

- `CanvasTexture`

  ↳ **`AtlasTexture`**

## Properties

### animations

• **animations**: { `animation`: [`FaceAnimation`](FaceAnimation.md) ; `timer`: `any`  }[] = `[]`

The list of block animations that are being used by this texture atlas.

___

### atlasMargin

• **atlasMargin**: `number` = `0`

The margin between each block texture in the this.

___

### atlasOffset

• **atlasOffset**: `number` = `0`

The offset of each block's texture to the end of its border.

___

### atlasRatio

• **atlasRatio**: `number` = `0`

The ratio of the texture on the atlas to the original texture.

___

### canvas

• **canvas**: `HTMLCanvasElement`

The canvas that is used to generate the texture this.

___

### countPerSide

• **countPerSide**: `number`

The number of textures per side of the texture atlas

___

### dimension

• **dimension**: `number`

Since the texture atlas is a square, the dimension is the length of one side.

## Constructors

### constructor

• **new AtlasTexture**(`countPerSide`, `dimension`, `canvas?`)

Create a new texture this.

#### Parameters

| Name | Type |
| :------ | :------ |
| `countPerSide` | `number` |
| `dimension` | `number` |
| `canvas` | `HTMLCanvasElement` |

#### Overrides

CanvasTexture.constructor

## Methods

### drawImageToRange

▸ **drawImageToRange**(`range`, `image`, `clearRect?`, `opacity?`): `void`

Draw a texture to a range on the texture atlas.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `range` | [`TextureRange`](../modules.md#texturerange-120) | `undefined` | The range on the texture atlas to draw the texture to. |
| `image` | `Color` \| `Texture` \| `HTMLImageElement` \| (`width?`: `number`, `height?`: `number`) => `HTMLImageElement` \| `HTMLCanvasElement` | `undefined` | The texture to draw to the range. |
| `clearRect` | `boolean` | `true` | - |
| `opacity` | `number` | `1.0` | - |

#### Returns

`void`

___

### makeUnknownImage

▸ `Static` **makeUnknownImage**(`dimension`, `color1?`, `color2?`): `HTMLCanvasElement`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `dimension` | `number` | `undefined` |
| `color1` | `string` | `"#0A2647"` |
| `color2` | `string` | `"#E1D7C6"` |

#### Returns

`HTMLCanvasElement`

___

### makeUnknownTexture

▸ `Static` **makeUnknownTexture**(`dimension`): `CanvasTexture`

#### Parameters

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |

#### Returns

`CanvasTexture`

___

### registerAnimation

▸ **registerAnimation**(`range`, `keyframes`, `fadeFrames?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `range` | [`TextureRange`](../modules.md#texturerange-120) | `undefined` |
| `keyframes` | [`number`, `Color` \| `HTMLImageElement`][] | `undefined` |
| `fadeFrames` | `number` | `0` |

#### Returns

`void`
