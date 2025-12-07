---
id: "Loader"
title: "Class: Loader"
sidebar_label: "Loader"
sidebar_position: 0
custom_edit_url: null
---

An asset loader that can load textures and audio files. This class is used internally by the world
and can be accessed via [World.loader](World.md#loader).

## Properties

### audioBuffers

• **audioBuffers**: `Map`\<`string`, `AudioBuffer`\>

A map of all audios loaded by Voxelize.

___

### images

• **images**: `Map`\<`string`, `HTMLImageElement` \| `HTMLImageElement`[]\>

___

### progress

• **progress**: `number` = `0`

The progress at which Loader has loaded, zero to one.

___

### textureLoader

• **textureLoader**: `TextureLoader`

The internal texture loader used by the loader.

___

### textures

• **textures**: `Map`\<`string`, `Texture`\>

A map of all textures loaded by Voxelize.

## Methods

### getGifTexture

▸ **getGifTexture**(`source`): `Texture`[]

Get a loaded gif texture with this function.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the texture file loaded from. |

#### Returns

`Texture`[]

A list of textures for each frame of the gif.

___

### getTexture

▸ **getTexture**(`source`): `Texture`

Get a loaded texture by its source.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the texture file to load from. |

#### Returns

`Texture`

A texture instance loaded from the source.

___

### load

▸ **load**(): `Promise`\<`void`\>

Load all assets other than the textures. Called internally by the world.
This can be used to ensure that a function runs after all assets are loaded.

#### Returns

`Promise`\<`void`\>

A promise that resolves when all assets are loaded.

**`Example`**

```ts
world.loader.load().then(() => {});
```

___

### loadAudioBuffer

▸ **loadAudioBuffer**(`source`, `onLoaded?`): `Promise`\<`AudioBuffer`\>

Add an audio file to be loaded from.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the audio file to load from. |
| `onLoaded?` | (`buffer`: `AudioBuffer`) => `void` | A callback to run when the audio is loaded. |

#### Returns

`Promise`\<`AudioBuffer`\>

___

### loadGifImages

▸ **loadGifImages**(`source`, `onLoaded?`): `Promise`\<`HTMLImageElement`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `string` |
| `onLoaded?` | (`images`: `HTMLImageElement`[]) => `void` |

#### Returns

`Promise`\<`HTMLImageElement`[]\>

___

### loadImage

▸ **loadImage**(`source`, `onLoaded?`): `Promise`\<`HTMLImageElement`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `string` |
| `onLoaded?` | (`image`: `HTMLImageElement`) => `void` |

#### Returns

`Promise`\<`HTMLImageElement`\>

___

### loadTexture

▸ **loadTexture**(`source`, `onLoaded?`): `Promise`\<`Texture`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | `string` |
| `onLoaded?` | (`texture`: `Texture`) => `void` |

#### Returns

`Promise`\<`Texture`\>
