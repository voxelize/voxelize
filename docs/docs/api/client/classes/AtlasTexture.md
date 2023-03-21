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

### DEFAULT\_ANISOTROPY

▪ `Static` **DEFAULT\_ANISOTROPY**: `number`

#### Inherited from

CanvasTexture.DEFAULT\_ANISOTROPY

___

### DEFAULT\_IMAGE

▪ `Static` **DEFAULT\_IMAGE**: `any`

#### Inherited from

CanvasTexture.DEFAULT\_IMAGE

___

### DEFAULT\_MAPPING

▪ `Static` **DEFAULT\_MAPPING**: `any`

#### Inherited from

CanvasTexture.DEFAULT\_MAPPING

___

### animations

• **animations**: { `animation`: [`FaceAnimation`](FaceAnimation.md) ; `timer`: `any`  }[] = `[]`

The list of block animations that are being used by this texture atlas.

___

### anisotropy

• **anisotropy**: `number`

**`Default`**

1

#### Inherited from

CanvasTexture.anisotropy

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

### center

• **center**: `Vector2`

**`Default`**

new THREE.Vector2( 0, 0 )

#### Inherited from

CanvasTexture.center

___

### countPerSide

• **countPerSide**: `number`

___

### dimension

• **dimension**: `number`

___

### encoding

• **encoding**: `TextureEncoding`

**`Default`**

THREE.LinearEncoding

#### Inherited from

CanvasTexture.encoding

___

### flipY

• **flipY**: `boolean`

**`Default`**

true

#### Inherited from

CanvasTexture.flipY

___

### format

• **format**: `PixelFormat`

**`Default`**

THREE.RGBAFormat

#### Inherited from

CanvasTexture.format

___

### generateMipmaps

• **generateMipmaps**: `boolean`

**`Default`**

true

#### Inherited from

CanvasTexture.generateMipmaps

___

### id

• **id**: `number`

#### Inherited from

CanvasTexture.id

___

### internalFormat

• **internalFormat**: `PixelFormatGPU`

#### Inherited from

CanvasTexture.internalFormat

___

### isCanvasTexture

• `Readonly` **isCanvasTexture**: ``true``

#### Inherited from

CanvasTexture.isCanvasTexture

___

### isRenderTargetTexture

• **isRenderTargetTexture**: `boolean`

**`Default`**

false

#### Inherited from

CanvasTexture.isRenderTargetTexture

___

### isTexture

• `Readonly` **isTexture**: ``true``

#### Inherited from

CanvasTexture.isTexture

___

### magFilter

• **magFilter**: `TextureFilter`

**`Default`**

THREE.LinearFilter

#### Inherited from

CanvasTexture.magFilter

___

### mapping

• **mapping**: `Mapping`

**`Default`**

THREE.Texture.DEFAULT_MAPPING

#### Inherited from

CanvasTexture.mapping

___

### matrix

• **matrix**: `Matrix3`

**`Default`**

new THREE.Matrix3()

#### Inherited from

CanvasTexture.matrix

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

**`Default`**

true

#### Inherited from

CanvasTexture.matrixAutoUpdate

___

### minFilter

• **minFilter**: `TextureFilter`

**`Default`**

THREE.LinearMipmapLinearFilter

#### Inherited from

CanvasTexture.minFilter

___

### mipmaps

• **mipmaps**: `any`[]

**`Default`**

[]

#### Inherited from

CanvasTexture.mipmaps

___

### name

• **name**: `string`

**`Default`**

''

#### Inherited from

CanvasTexture.name

___

### needsPMREMUpdate

• **needsPMREMUpdate**: `boolean`

**`Default`**

false

#### Inherited from

CanvasTexture.needsPMREMUpdate

___

### offset

• **offset**: `Vector2`

**`Default`**

new THREE.Vector2( 0, 0 )

#### Inherited from

CanvasTexture.offset

___

### onUpdate

• **onUpdate**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Inherited from

CanvasTexture.onUpdate

___

### premultiplyAlpha

• **premultiplyAlpha**: `boolean`

**`Default`**

false

#### Inherited from

CanvasTexture.premultiplyAlpha

___

### repeat

• **repeat**: `Vector2`

**`Default`**

new THREE.Vector2( 1, 1 )

#### Inherited from

CanvasTexture.repeat

___

### rotation

• **rotation**: `number`

**`Default`**

0

#### Inherited from

CanvasTexture.rotation

___

### source

• **source**: `Source`

The data definition of a texture. A reference to the data source can be shared across textures.
This is often useful in context of spritesheets where multiple textures render the same data but with different texture transformations.

#### Inherited from

CanvasTexture.source

___

### sourceFile

• **sourceFile**: `string`

#### Inherited from

CanvasTexture.sourceFile

___

### type

• **type**: `TextureDataType`

**`Default`**

THREE.UnsignedByteType

#### Inherited from

CanvasTexture.type

___

### unpackAlignment

• **unpackAlignment**: `number`

**`Default`**

4

#### Inherited from

CanvasTexture.unpackAlignment

___

### userData

• **userData**: `any`

An object that can be used to store custom data about the Material. It should not hold references to functions as these will not be cloned.

**`Default`**

#### Inherited from

CanvasTexture.userData

___

### uuid

• **uuid**: `string`

#### Inherited from

CanvasTexture.uuid

___

### version

• **version**: `number`

**`Default`**

0

#### Inherited from

CanvasTexture.version

___

### wrapS

• **wrapS**: `Wrapping`

**`Default`**

THREE.ClampToEdgeWrapping

#### Inherited from

CanvasTexture.wrapS

___

### wrapT

• **wrapT**: `Wrapping`

**`Default`**

THREE.ClampToEdgeWrapping

#### Inherited from

CanvasTexture.wrapT

## Methods

### addEventListener

▸ **addEventListener**<`T`\>(`type`, `listener`): `void`

Adds a listener to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`AtlasTexture`](AtlasTexture.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

CanvasTexture.addEventListener

___

### clone

▸ **clone**(): [`AtlasTexture`](AtlasTexture.md)

#### Returns

[`AtlasTexture`](AtlasTexture.md)

#### Inherited from

CanvasTexture.clone

___

### copy

▸ **copy**(`source`): [`AtlasTexture`](AtlasTexture.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `Texture` |

#### Returns

[`AtlasTexture`](AtlasTexture.md)

#### Inherited from

CanvasTexture.copy

___

### dispatchEvent

▸ **dispatchEvent**(`event`): `void`

Fire an event type.

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `Event` |

#### Returns

`void`

#### Inherited from

CanvasTexture.dispatchEvent

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

#### Inherited from

CanvasTexture.dispose

___

### drawImageToRange

▸ **drawImageToRange**(`range`, `image`, `clearRect?`, `opacity?`): `void`

Draw a texture to a range on the texture atlas.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `range` | [`TextureRange`](../modules.md#texturerange-18) | `undefined` | The range on the texture atlas to draw the texture to. |
| `image` | `Color` \| `Texture` \| `HTMLImageElement` \| (`width?`: `number`, `height?`: `number`) => `HTMLImageElement` \| `HTMLCanvasElement` | `undefined` | The texture to draw to the range. |
| `clearRect` | `boolean` | `true` | - |
| `opacity` | `number` | `1.0` | - |

#### Returns

`void`

___

### hasEventListener

▸ **hasEventListener**<`T`\>(`type`, `listener`): `boolean`

Checks if listener is added to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`AtlasTexture`](AtlasTexture.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

CanvasTexture.hasEventListener

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
| `range` | [`TextureRange`](../modules.md#texturerange-18) | `undefined` |
| `keyframes` | [`number`, `Color` \| `HTMLImageElement`][] | `undefined` |
| `fadeFrames` | `number` | `0` |

#### Returns

`void`

___

### removeEventListener

▸ **removeEventListener**<`T`\>(`type`, `listener`): `void`

Removes a listener from an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of the listener that gets removed. |
| `listener` | `EventListener`<`Event`, `T`, [`AtlasTexture`](AtlasTexture.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

CanvasTexture.removeEventListener

___

### toJSON

▸ **toJSON**(`meta`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `meta` | `any` |

#### Returns

`any`

#### Inherited from

CanvasTexture.toJSON

___

### transformUv

▸ **transformUv**(`uv`): `Vector2`

#### Parameters

| Name | Type |
| :------ | :------ |
| `uv` | `Vector2` |

#### Returns

`Vector2`

#### Inherited from

CanvasTexture.transformUv

___

### updateMatrix

▸ **updateMatrix**(): `void`

#### Returns

`void`

#### Inherited from

CanvasTexture.updateMatrix

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

## Accessors

### image

• `get` **image**(): `any`

An image object, typically created using the TextureLoader.load method.
This can be any image (e.g., PNG, JPG, GIF, DDS) or video (e.g., MP4, OGG/OGV) type supported by three.js.

To use video as a texture you need to have a playing HTML5
video element as a source for your texture image and continuously update this texture
as long as video is playing - the VideoTexture class handles this automatically.

#### Returns

`any`

#### Inherited from

CanvasTexture.image

• `set` **image**(`data`): `void`

An image object, typically created using the TextureLoader.load method.
This can be any image (e.g., PNG, JPG, GIF, DDS) or video (e.g., MP4, OGG/OGV) type supported by three.js.

To use video as a texture you need to have a playing HTML5
video element as a source for your texture image and continuously update this texture
as long as video is playing - the VideoTexture class handles this automatically.

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`void`

#### Inherited from

CanvasTexture.image

___

### needsUpdate

• `set` **needsUpdate**(`value`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `boolean` |

#### Returns

`void`

#### Inherited from

CanvasTexture.needsUpdate
