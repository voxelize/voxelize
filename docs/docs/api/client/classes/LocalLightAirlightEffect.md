---
id: "LocalLightAirlightEffect"
title: "Class: LocalLightAirlightEffect"
sidebar_label: "LocalLightAirlightEffect"
sidebar_position: 0
custom_edit_url: null
---

Screen-space half of the air light. Reads the uniform set a
[LocalLightAirlight](LocalLightAirlight.md) maintains; the camera's matrices are refreshed
on every frame the pass renders.

## Hierarchy

- `"postprocessing"`

  ↳ **`LocalLightAirlightEffect`**

## Constructors

### constructor

• **new LocalLightAirlightEffect**(`camera`, `airlight`, `options?`): [`LocalLightAirlightEffect`](LocalLightAirlightEffect.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `camera` | `PerspectiveCamera` |
| `airlight` | [`LocalLightAirlight`](LocalLightAirlight.md) |
| `options` | `Object` |
| `options.skyDistance?` | `number` |

#### Returns

[`LocalLightAirlightEffect`](LocalLightAirlightEffect.md)

#### Overrides

Effect.constructor

## Methods

### update

▸ **update**(): `void`

#### Returns

`void`
