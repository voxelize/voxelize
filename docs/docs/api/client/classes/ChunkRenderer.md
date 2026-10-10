---
id: "ChunkRenderer"
title: "Class: ChunkRenderer"
sidebar_label: "ChunkRenderer"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ChunkRenderer**(): [`ChunkRenderer`](ChunkRenderer.md)

#### Returns

[`ChunkRenderer`](ChunkRenderer.md)

## Properties

### materials

• **materials**: `Map`<`string`, [`CustomChunkShaderMaterial`](../#customchunkshadermaterial)\>

___

### shaderLightingUniforms

• **shaderLightingUniforms**: [`ShaderLightingUniforms`](../interfaces/ShaderLightingUniforms.md)

___

### uniforms

• **uniforms**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `ao` | \{ `value`: `Vector4`  } | - |
| `ao.value` | `Vector4` | - |
| `atlasSize` | \{ `value`: `number`  } | - |
| `atlasSize.value` | `number` | - |
| `baseAmbient` | \{ `value`: `number`  } | - |
| `baseAmbient.value` | `number` | - |
| `cameraSubmersion` | \{ `value`: `number`  } | - |
| `cameraSubmersion.value` | `number` | - |
| `cameraWaterPlaneY` | \{ `value`: `number`  } | - |
| `cameraWaterPlaneY.value` | `number` | - |
| `faceShades` | \{ `value`: `Vector4`  } | - |
| `faceShades.value` | `Vector4` | - |
| `farCover` | \{ `value`: `Vector4`  } | x, y: mask origin in chunk columns; z: blocks per chunk; w: texels per side. |
| `farCover.value` | `Vector4` | - |
| `farCoverMask` | \{ `value`: `Texture`<`unknown`\>  } | The far layer's chunk-coverage mask and its placement, written by `FarTerrain`: chunk fragments read them to yield their outer half chunk to the far layer across a dithered band. See far-terrain-seam. |
| `farCoverMask.value` | `Texture`<`unknown`\> | - |
| `farSeam` | \{ `value`: `number`  } | The seam band's ramp scale; 0 keeps the loaded edge hard. |
| `farSeam.value` | `number` | - |
| `fogColor` | \{ `value`: `Color`  } | - |
| `fogColor.value` | `Color` | - |
| `fogFar` | \{ `value`: `number`  } | - |
| `fogFar.value` | `number` | - |
| `fogHeightDensity` | \{ `value`: `number`  } | - |
| `fogHeightDensity.value` | `number` | - |
| `fogHeightOrigin` | \{ `value`: `number`  } | - |
| `fogHeightOrigin.value` | `number` | - |
| `fogNear` | \{ `value`: `number`  } | - |
| `fogNear.value` | `number` | - |
| `fogVerticalBlend` | \{ `value`: `number`  } | 0..1 blend from horizontal to true 3D fog distance (caves). |
| `fogVerticalBlend.value` | `number` | - |
| `lightIntensityAdjustment` | \{ `value`: `number`  } | - |
| `lightIntensityAdjustment.value` | `number` | - |
| `minLightLevel` | \{ `value`: `number`  } | - |
| `minLightLevel.value` | `number` | - |
| `pigmentTints` | \{ `value`: `Float32Array`<`ArrayBufferLike`\>  } | The colour table: 16 linear RGB multipliers a face with a pigment mask takes by its voxel stage. Entry 0 is the untinted material. |
| `pigmentTints.value` | `Float32Array`<`ArrayBufferLike`\> | - |
| `sceneColor` | \{ `value`: `Texture`<`unknown`\>  } | What the water refracts: a copy of the frame drawn before it, or with order-independent transparency the scene target's own colour, read while the blended layers draw elsewhere. |
| `sceneColor.value` | `Texture`<`unknown`\> | - |
| `sceneTextureSize` | \{ `value`: `Vector2`  } | - |
| `sceneTextureSize.value` | `Vector2` | - |
| `showGreedyDebug` | \{ `value`: `number`  } | - |
| `showGreedyDebug.value` | `number` | - |
| `skyFogBottomColor` | \{ `value`: `Color`  } | - |
| `skyFogBottomColor.value` | `Color` | - |
| `skyFogDimension` | \{ `value`: `number`  } | - |
| `skyFogDimension.value` | `number` | - |
| `skyFogExponent` | \{ `value`: `number`  } | - |
| `skyFogExponent.value` | `number` | - |
| `skyFogExponent2` | \{ `value`: `number`  } | - |
| `skyFogExponent2.value` | `number` | - |
| `skyFogMiddleColor` | \{ `value`: `Color`  } | - |
| `skyFogMiddleColor.value` | `Color` | - |
| `skyFogOffset` | \{ `value`: `number`  } | - |
| `skyFogOffset.value` | `number` | - |
| `skyFogStrength` | \{ `value`: `number`  } | - |
| `skyFogStrength.value` | `number` | - |
| `skyFogTopColor` | \{ `value`: `Color`  } | - |
| `skyFogTopColor.value` | `Color` | - |
| `skyFogVoidOffset` | \{ `value`: `number`  } | - |
| `skyFogVoidOffset.value` | `number` | - |
| `stageTints` | \{ `value`: `Float32Array`<`ArrayBufferLike`\>  } | - |
| `stageTints.value` | `Float32Array`<`ArrayBufferLike`\> | - |
| `sunlightIntensity` | \{ `value`: `number`  } | - |
| `sunlightIntensity.value` | `number` | - |
| `time` | \{ `value`: `number`  } | - |
| `time.value` | `number` | - |
| `underwaterAmbient` | \{ `value`: `Color`  } | - |
| `underwaterAmbient.value` | `Color` | - |
| `underwaterViewScale` | \{ `value`: `number`  } | - |
| `underwaterViewScale.value` | `number` | - |
| `waterDepth` | \{ `value`: `Texture`<`unknown`\>  } | The depth of the water near the panes in view, and how to read it (`WaterDepthPass`): which side of the water each pane fragment draws. |
| `waterDepth.value` | `Texture`<`unknown`\> | - |
| `waterDepthClip` | \{ `value`: `Vector2`  } | - |
| `waterDepthClip.value` | `Vector2` | - |
| `waterDepthState` | \{ `value`: `number`  } | - |
| `waterDepthState.value` | `number` | - |
| `waterDepthViewport` | \{ `value`: `Vector2`  } | - |
| `waterDepthViewport.value` | `Vector2` | - |
| `waterNormalMap` | \{ `value`: `DataTexture`  } | - |
| `waterNormalMap.value` | `DataTexture` | - |
| `waterRefractionReady` | \{ `value`: `number`  } | - |
| `waterRefractionReady.value` | `number` | - |
| `waterRefractionStrength` | \{ `value`: `number`  } | - |
| `waterRefractionStrength.value` | `number` | - |
| `windDirection` | \{ `value`: `Vector2`  } | - |
| `windDirection.value` | `Vector2` | - |
| `windOffset` | \{ `value`: `Vector2`  } | - |
| `windOffset.value` | `Vector2` | - |
| `windSpeed` | \{ `value`: `number`  } | - |
| `windSpeed.value` | `number` | - |
