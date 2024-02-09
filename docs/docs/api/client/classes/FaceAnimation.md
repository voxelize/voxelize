---
id: "FaceAnimation"
title: "Class: FaceAnimation"
sidebar_label: "FaceAnimation"
sidebar_position: 0
custom_edit_url: null
---

The animation data that is used internally in an atlas texture. This holds the data and will be used to draw on the texture atlas.

## Constructors

### constructor

• **new FaceAnimation**(`range`, `keyframes`, `fadeFrames?`): [`FaceAnimation`](FaceAnimation.md)

Create a new face animation. This holds the data and will be used to draw on the texture atlas.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `range` | [`UV`](../modules.md#uv) | `undefined` | The range of the texture atlas that this animation uses. |
| `keyframes` | [`number`, `Color` \| `HTMLImageElement`][] | `undefined` | The keyframes of the animation. This will be queried and drawn to the texture atlas. |
| `fadeFrames` | `number` | `0` | The fading duration between each keyframe in milliseconds. |

#### Returns

[`FaceAnimation`](FaceAnimation.md)

## Properties

### fadeFrames

• **fadeFrames**: `number`

The fading duration between each keyframe in milliseconds.

___

### keyframes

• **keyframes**: [`number`, `Color` \| `HTMLImageElement`][]

The keyframes of the animation. This will be queried and drawn to the
texture atlas.

___

### range

• **range**: [`UV`](../modules.md#uv)

The range of the texture atlas that this animation uses.
