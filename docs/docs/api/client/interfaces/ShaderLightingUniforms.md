---
id: "ShaderLightingUniforms"
title: "Interface: ShaderLightingUniforms"
sidebar_label: "ShaderLightingUniforms"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### ambientColor

• **ambientColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### bedCausticScale

• **bedCausticScale**: `Object`

0..1 scale on the caustic net seen on submerged faces from below.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### cascadeSplit0

• **cascadeSplit0**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### cascadeSplit1

• **cascadeSplit1**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### cascadeSplit2

• **cascadeSplit2**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### celestialDirection

• **celestialDirection**: `Object`

The celestial disc above the horizon as the sky box actually draws it
(`getVisibleDiscDirection`): the sun by day, the moon by night, never
clamped or tilted. Specular reflections read this, so the sun on the
water sits under the sun in the sky.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Vector3` |

___

### directSunlight

• **directSunlight**: `Object`

The share of the sun (the moon by night) that reaches the world as a
direct beam, 0..1: 1 under a clear sky, falling as cloud veils the
disc. What only a beam draws (glints on water, caustics, the disc seen
through the surface from below) scales by it; diffuse daylight
(`sunlightIntensity`) does not. The engine leaves it at 1; a host with
weather lowers it.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowBias

• **shadowBias**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowDebugMode

• **shadowDebugMode**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowMap0

• **shadowMap0**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Texture`<`unknown`\> |

___

### shadowMap1

• **shadowMap1**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Texture`<`unknown`\> |

___

### shadowMap2

• **shadowMap2**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Texture`<`unknown`\> |

___

### shadowMatrix0

• **shadowMatrix0**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Matrix4` |

___

### shadowMatrix1

• **shadowMatrix1**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Matrix4` |

___

### shadowMatrix2

• **shadowMatrix2**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Matrix4` |

___

### shadowNormalBias

• **shadowNormalBias**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowSideFaceBiasScale

• **shadowSideFaceBiasScale**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowSlopeBiasMin

• **shadowSlopeBiasMin**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowSlopeBiasScale

• **shadowSlopeBiasScale**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowStrength

• **shadowStrength**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### shadowTopFaceBiasScale

• **shadowTopFaceBiasScale**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### skyMiddleColor

• **skyMiddleColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### skyTopColor

• **skyTopColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### sunColor

• **sunColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### sunDirection

• **sunDirection**: `Object`

The shading light: held above a minimum elevation, tilted off the sun's
plane, and blended toward the moon through twilight, so terrain shading
and shadows stay readable at every hour. Not where the sun is drawn.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Vector3` |

___

### sunlightIntensity

• **sunlightIntensity**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### surfaceUndersideScale

• **surfaceUndersideScale**: `Object`

The surface's underside while submerged: 0 off, 1 one continuous
rippled ceiling the scene above shows through most straight up, 2 the
texel-stepped window and caustic web, 3 the clear Snell window over a
calm mirror (2 and 3 kept for A/B captures).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### surfaceUndersideTuning

• **surfaceUndersideTuning**: `Object`

Style 1's ceiling, live-tunable: x film brightness against the water's
scatter colour, y the share of the scene above shown straight up, z the
power of the cosine it falls off with toward grazing, w the ripples'
light-and-shade on the film. Defaults are `WATER_OPTICS.underside*`.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Vector4` |

___

### waterAbsorption

• **waterAbsorption**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### waterFresnelStrength

• **waterFresnelStrength**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### waterLevel

• **waterLevel**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### waterStreakStrength

• **waterStreakStrength**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### waterSurfaceCrisp

• **waterSurfaceCrisp**: `Object`

1 draws the water surface per 1/16-block texel (ripples sampled at
texel centres, fresnel and glint in three flat steps); 0 the earlier
smooth surface, for A/B.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `number` |

___

### waterTint

• **waterTint**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |
