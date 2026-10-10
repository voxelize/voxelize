---
id: "ChunkMaterialHost"
title: "Interface: ChunkMaterialHost"
sidebar_label: "ChunkMaterialHost"
sidebar_position: 0
custom_edit_url: null
---

What the chunk material factory needs from the world: the renderer that
owns shared uniforms and the material registry, the per-world uniform
overrides, and the light cones whose bindings every chunk shader shares.

## Properties

### chunkRenderer

• **chunkRenderer**: [`ChunkRenderer`](../classes/ChunkRenderer.md)

___

### lightCones

• **lightCones**: [`LightCones`](../classes/LightCones.md)

___

### localLights

• **localLights**: [`LocalLights`](../classes/LocalLights.md)

___

### options

• **options**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `blockTextureFiltering` | [`AtlasFilteringMode`](../#atlasfilteringmode) |
| `chunkSize` | `number` |
| `chunkUniformsOverwrite` | `Partial`<\{ `ao`: \{ `value`: `Vector4`  } ; `atlasSize`: \{ `value`: `number`  } ; `baseAmbient`: \{ `value`: `number`  } ; `cameraSubmersion`: \{ `value`: `number`  } ; `cameraWaterPlaneY`: \{ `value`: `number`  } ; `faceShades`: \{ `value`: `Vector4`  } ; `farCover`: \{ `value`: `Vector4`  } ; `farCoverMask`: \{ `value`: `Texture`<`unknown`\>  } ; `farSeam`: \{ `value`: `number`  } ; `fogColor`: \{ `value`: `Color`  } ; `fogFar`: \{ `value`: `number`  } ; `fogHeightDensity`: \{ `value`: `number`  } ; `fogHeightOrigin`: \{ `value`: `number`  } ; `fogNear`: \{ `value`: `number`  } ; `fogVerticalBlend`: \{ `value`: `number`  } ; `lightIntensityAdjustment`: \{ `value`: `number`  } ; `minLightLevel`: \{ `value`: `number`  } ; `pigmentTints`: \{ `value`: `Float32Array`<`ArrayBufferLike`\>  } ; `sceneColor`: \{ `value`: `Texture`<`unknown`\>  } ; `sceneTextureSize`: \{ `value`: `Vector2`  } ; `showGreedyDebug`: \{ `value`: `number`  } ; `skyFogBottomColor`: \{ `value`: `Color`  } ; `skyFogDimension`: \{ `value`: `number`  } ; `skyFogExponent`: \{ `value`: `number`  } ; `skyFogExponent2`: \{ `value`: `number`  } ; `skyFogMiddleColor`: \{ `value`: `Color`  } ; `skyFogOffset`: \{ `value`: `number`  } ; `skyFogStrength`: \{ `value`: `number`  } ; `skyFogTopColor`: \{ `value`: `Color`  } ; `skyFogVoidOffset`: \{ `value`: `number`  } ; `stageTints`: \{ `value`: `Float32Array`<`ArrayBufferLike`\>  } ; `sunlightIntensity`: \{ `value`: `number`  } ; `time`: \{ `value`: `number`  } ; `underwaterAmbient`: \{ `value`: `Color`  } ; `underwaterViewScale`: \{ `value`: `number`  } ; `waterDepth`: \{ `value`: `Texture`<`unknown`\>  } ; `waterDepthClip`: \{ `value`: `Vector2`  } ; `waterDepthState`: \{ `value`: `number`  } ; `waterDepthViewport`: \{ `value`: `Vector2`  } ; `waterNormalMap`: \{ `value`: `DataTexture`  } ; `waterRefractionReady`: \{ `value`: `number`  } ; `waterRefractionStrength`: \{ `value`: `number`  } ; `windDirection`: \{ `value`: `Vector2`  } ; `windOffset`: \{ `value`: `Vector2`  } ; `windSpeed`: \{ `value`: `number`  }  }\> |
| `maxHeight` | `number` |
| `subChunks` | `number` |
| `swayProfileCapacity` | `number` |
| `textureUnitDimension` | `number` |

___

### swayProfileTable

• **swayProfileTable**: `Uniform`<`any`\>

## Methods

### hasCustomBlockMaterial

▸ **hasCustomBlockMaterial**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`
