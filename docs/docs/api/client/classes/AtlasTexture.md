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

## Constructors

### constructor

• **new AtlasTexture**(`countPerSide?`, `dimension?`, `canvas?`, `filtering?`): [`AtlasTexture`](AtlasTexture.md)

Create a new texture this.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `countPerSide` | `number` | `1` |
| `dimension` | `number` | `1` |
| `canvas` | `HTMLCanvasElement` | `undefined` |
| `filtering` | [`AtlasFilteringMode`](../#atlasfilteringmode) | `"nearest"` |

#### Returns

[`AtlasTexture`](AtlasTexture.md)

The texture atlas generated.

#### Overrides

CanvasTexture.constructor

## Properties

### animationClock

• **animationClock**: () => `number`

Seconds the animated faces read their frame from. The world points it
at its shared shader clock, so every client shows the same frame of the
same water at the same moment; on its own it runs on local time.

#### Type declaration

▸ (): `number`

##### Returns

`number`

___

### animations

• **animations**: \{ `animation`: [`FaceAnimation`](FaceAnimation.md) ; `drawnFrame`: `number` ; `durationsMs`: `number`[] ; `patch`: `AtlasAnimationPatch` ; `timer`: ``null``  }[] = `[]`

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

## Methods

### applyFiltering

▸ **applyFiltering**(`mode`): `void`

Switches how this atlas samples at glancing angles. Safe to call on a
live atlas already bound to chunk materials (sets `needsUpdate` so the
next upload carries the new filter/mip settings) — an A/B run can flip
this without rebuilding the world. See `WorldOptions.blockTextureFiltering`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `mode` | [`AtlasFilteringMode`](../#atlasfilteringmode) |

#### Returns

`void`

___

### copy

▸ **copy**(`source`): `this`

Carries the atlas geometry so `clone()` yields a faithful atlas view
sharing the source's pixels, with independently settable repeat/offset
(how the held torch windows its flame strip). Animations deliberately do
not transfer: their timers drive the source's own offsets, and a clone
inheriting them would be fought over by two drivers.

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `this` |

#### Returns

`this`

#### Overrides

CanvasTexture.copy

___

### drawImageToRange

▸ **drawImageToRange**(`range`, `image`, `clearRect?`, `opacity?`): `void`

Draw a texture to a range on the texture atlas.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `range` | [`UV`](../#uv) | `undefined` | The range on the texture atlas to draw the texture to. |
| `image` | `Color` \| `Texture`<`unknown`\> \| `HTMLCanvasElement` \| `HTMLImageElement` \| (`width?`: `number`, `height?`: `number`) => `HTMLImageElement` | `undefined` | The texture to draw to the range. |
| `clearRect` | `boolean` | `true` | - |
| `opacity` | `number` | `1.0` | - |

#### Returns

`void`

___

### fillRangeAsFallback

▸ **fillRangeAsFallback**(`range`, `color`): `void`

Paint `range` with a stand-in colour and remember that it is one, so a
later census still lists the slot as unpainted by its own art.

#### Parameters

| Name | Type |
| :------ | :------ |
| `range` | [`UV`](../#uv) |
| `color` | `Color` |

#### Returns

`void`

___

### flushAnimationPatches

▸ **flushAnimationPatches**(`renderer`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |

#### Returns

`void`

___

### isRangeFallback

▸ **isRangeFallback**(`range`): `boolean`

Whether `range` wears a fallback fill instead of its own texture.

#### Parameters

| Name | Type |
| :------ | :------ |
| `range` | [`UV`](../#uv) |

#### Returns

`boolean`

___

### isRangePainted

▸ **isRangePainted**(`range`): `boolean`

Whether anything has been drawn into `range` since the atlas was built.

#### Parameters

| Name | Type |
| :------ | :------ |
| `range` | [`UV`](../#uv) |

#### Returns

`boolean`

___

### makeUnknownImage

▸ **makeUnknownImage**(`dimension`, `color1?`, `color2?`): `HTMLCanvasElement`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `dimension` | `number` | `undefined` |
| `color1` | `string` | `"#FF00FF"` |
| `color2` | `string` | `"#000000"` |

#### Returns

`HTMLCanvasElement`

___

### makeUnknownTexture

▸ **makeUnknownTexture**(`dimension`): [`AtlasTexture`](AtlasTexture.md)

The magenta-and-black checker every surface with no texture yet is given.
One instance serves all of them, so treat it as read-only: painting into
it or disposing it reaches every one of those surfaces at once.

#### Parameters

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |

#### Returns

[`AtlasTexture`](AtlasTexture.md)

___

### paintColor

▸ **paintColor**(`color`): `void`

Paints the entire canvas with a specified color using Three.js Color.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `Color` | A Three.js Color instance to use for painting. |

#### Returns

`void`

___

### rangeTexelClasses

▸ **rangeTexelClasses**(`range`, `cuts`): [`TexelClasses`](../#texelclasses)

Whether `range` holds solid or translucent texels (see
`classifyTexels`): its painted pixels, every keyframe of an animation
playing there, or the opaque unknown checker while nothing is painted.

#### Parameters

| Name | Type |
| :------ | :------ |
| `range` | [`UV`](../#uv) |
| `cuts` | [`TexelAlphaCuts`](../#texelalphacuts) |

#### Returns

[`TexelClasses`](../#texelclasses)

___

### readRangePixels

▸ **readRangePixels**(`range`): `Uint8ClampedArray`<`ArrayBufferLike`\>

The RGBA8 pixels painted inside `range` (its texture, without the
margin around it), or null while nothing has been painted there. One
small read of the atlas canvas.

#### Parameters

| Name | Type |
| :------ | :------ |
| `range` | [`UV`](../#uv) |

#### Returns

`Uint8ClampedArray`<`ArrayBufferLike`\>

___

### registerAnimation

▸ **registerAnimation**(`range`, `keyframes`, `fadeFrames?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `range` | [`UV`](../#uv) | `undefined` |
| `keyframes` | [`number`, `Color` \| `HTMLImageElement`][] | `undefined` |
| `fadeFrames` | `number` | `0` |

#### Returns

`void`

___

### tickAnimations

▸ **tickAnimations**(`seconds?`): `void`

Draws whichever animated faces changed frame since the last call, read
off [animationClock](AtlasTexture.md#animationclock). Called once a frame by the world; a face
whose frame has not changed costs a lookup and nothing else.

#### Parameters

| Name | Type |
| :------ | :------ |
| `seconds` | `number` |

#### Returns

`void`
