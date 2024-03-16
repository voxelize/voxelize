---
id: "BlockOverlayEffect"
title: "Class: BlockOverlayEffect"
sidebar_label: "BlockOverlayEffect"
sidebar_position: 0
custom_edit_url: null
---

The block overlay effect is used to add a color blend whenever the camera is inside certain types of blocks.

This module is dependent on the [`postprocessing`](https://github.com/pmndrs/postprocessing) package.

# Example
```ts
import { EffectComposer, RenderPass } from "postprocessing";

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);

composer.addPass(
  new EffectPass(camera, overlayEffect)
);
```

![Block overlay effect](/img/docs/overlay.png)

## Hierarchy

- `"postprocessing"`

  ↳ **`BlockOverlayEffect`**

## Constructors

### constructor

• **new BlockOverlayEffect**(`world`, `camera`): [`BlockOverlayEffect`](BlockOverlayEffect.md)

Create a new block overlay effect.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `world` | [`World`](World.md)\<`any`\> | The world that the effect is in. |
| `camera` | `PerspectiveCamera` | The camera that the effect is applied to. |

#### Returns

[`BlockOverlayEffect`](BlockOverlayEffect.md)

#### Overrides

Effect.constructor

## Properties

### camera

• **camera**: `PerspectiveCamera`

The camera that the effect is applied to.

___

### world

• **world**: [`World`](World.md)\<`any`\>

The world that the effect is in.

## Methods

### addOverlay

▸ **addOverlay**(`idOrName`, `color`, `opacity`): `void`

Add a new overlay to a certain voxel type.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | The block ID or name to add an overlay for. |
| `color` | `Color` | The color of the overlay. |
| `opacity` | `number` | The opacity of the overlay. |

#### Returns

`void`
