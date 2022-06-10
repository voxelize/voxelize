---
id: "TextureAtlas"
title: "Class: TextureAtlas"
sidebar_label: "TextureAtlas"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new TextureAtlas**()

## Properties

### params

• **params**: `TextureAtlasParams`

___

### texture

• **texture**: `CanvasTexture`

___

### material

• **material**: `MeshBasicMaterial`

___

### dataURLs

• **dataURLs**: `Map`<`string`, `string`\>

___

### canvas

• **canvas**: `HTMLCanvasElement`

## Methods

### create

▸ `Static` **create**(`textureMap`, `ranges`, `params`): [`TextureAtlas`](TextureAtlas.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `textureMap` | `Map`<`string`, `Texture` \| `Color`\> |
| `ranges` | `Map`<`string`, [`TextureRange`](../modules.md#texturerange-72)\> |
| `params` | `TextureAtlasParams` |

#### Returns

[`TextureAtlas`](TextureAtlas.md)

___

### makeCanvasPowerOfTwo

▸ **makeCanvasPowerOfTwo**(`canvas?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `canvas?` | `HTMLCanvasElement` |

#### Returns

`void`
