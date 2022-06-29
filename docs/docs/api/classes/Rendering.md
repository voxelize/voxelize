---
id: "Rendering"
title: "Class: Rendering"
sidebar_label: "Rendering"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** rendering pipeline for Voxelize, based on ThreeJS's `WebGLRenderer`.

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`RenderingParams`](../modules.md#renderingparams-66)

Parameters to initialize the Voxelize rendering pipeline.

___

### scene

• **scene**: `Scene`

A ThreeJS `Scene` instance holding all ThreeJS-renderable objects.

___

### renderer

• **renderer**: `WebGLRenderer`

The ThreeJS `WebGLRenderer` used to render Voxelize.

___

### composer

• **composer**: `EffectComposer`

A postprocessing effect composer to add post-processing to Voxelize.

___

### uFogColor

• **uFogColor**: `Object`

The GLSL uniform for the color of the fog, in other words the color objects fade into when afar.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `value` | `Color` | A ThreeJS `Color` instance, GLSL-compatible. |

___

### uFogNear

• **uFogNear**: `Object`

The GLSL uniform for the near distance that the fog starts fogging up.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `value` | `number` | The actual fog near distance, in world units. |

___

### uFogFar

• **uFogFar**: `Object`

The GLSL uniform for the near distance that the fog fogs up fully.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `value` | `number` | The actual fog far distance, in world units. |

## Methods

### adjustRenderer

▸ **adjustRenderer**(): `void`

Adjust the Voxelize rendering pipeline to fit the game container's size, updating the
aspect ratio and renderer size.

#### Returns

`void`

___

### setFogDistance

▸ **setFogDistance**(`distance`): `void`

Set the farthest distance for the fog. Fog starts fogging up 50% from the farthest.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | The maximum distance that the fog fully fogs up. |

#### Returns

`void`

## Accessors

### renderSize

• `get` **renderSize**(): `Object`

The size of the Voxelize containing DOM element (offsetWidth and offsetHeight).

#### Returns

`Object`

| Name | Type | Description |
| :------ | :------ | :------ |
| `width` | `number` | The offset width of the DOM container. |
| `height` | `number` | The offset height of the DOM container. |

___

### aspectRatio

• `get` **aspectRatio**(): `number`

The aspect ratio of the renderer, based on the `renderSize`.

#### Returns

`number`
