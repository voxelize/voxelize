---
id: "Loader"
title: "Class: Loader"
sidebar_label: "Loader"
sidebar_position: 0
custom_edit_url: null
---

An asset loader that can load textures and audio files. This class is used internally by the world
and can be accessed via [loader](World.md#loader-114).

## Methods

### addAudioBuffer

▸ **addAudioBuffer**(`source`, `onLoaded?`): `void`

Add an audio file to be loaded from.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the audio file to load from. |
| `onLoaded?` | (`buffer`: `AudioBuffer`) => `void` | A callback to run when the audio is loaded. |

#### Returns

`void`

___

### addGifTexture

▸ **addGifTexture**(`source`, `onLoaded?`): `void`

Load a GIF texture from a source URL. This uses omggif to load the GIF and then creates a
texture for each frame. The textures are stored in an array and can be accessed via the
[textures](Loader.md#textures-22) map with the source.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the GIF file. |
| `onLoaded?` | (`texture`: `Texture`[]) => `void` | A callback that is called when the GIF is loaded. |

#### Returns

`void`

___

### addTexture

▸ **addTexture**(`source`, `onLoaded?`): `void`

Add a texture source to load from. Must be called before `client.connect`.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the texture file to load from. |
| `onLoaded?` | (`texture`: `Texture`) => `void` | - |

#### Returns

`void`

___

### getAudioBuffer

▸ **getAudioBuffer**(`source`): `AudioBuffer`

Get an audio buffer by its source.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `string` | The source to the audio file to load from. |

#### Returns

`AudioBuffer`

The audio buffer loaded from the source.

___

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

▸ **load**(): `Promise`<`void`\>

Load all assets other than the textures. Called internally by the world.
This can be used to ensure that a function runs after all assets are loaded.

**`Example`**

```ts
world.loader.load().then(() => {});
```

#### Returns

`Promise`<`void`\>

A promise that resolves when all assets are loaded.

## Properties

### audioBuffers

• **audioBuffers**: `Map`<`string`, `AudioBuffer`\>

A map of all audios loaded by Voxelize.

___

### progress

• **progress**: `number` = `0`

The progress at which Loader has loaded, zero to one.

___

### textures

• **textures**: `Map`<`string`, `Texture` \| `Texture`[]\>

A map of all textures loaded by Voxelize.
