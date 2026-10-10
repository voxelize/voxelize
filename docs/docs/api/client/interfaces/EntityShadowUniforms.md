---
id: "EntityShadowUniforms"
title: "Interface: EntityShadowUniforms"
sidebar_label: "EntityShadowUniforms"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### uCascadeSplit0

• **uCascadeSplit0**: `IUniform`<`number`\>

___

### uCascadeSplit1

• **uCascadeSplit1**: `IUniform`<`number`\>

___

### uCascadeSplit2

• **uCascadeSplit2**: `IUniform`<`number`\>

___

### uMinOccluderDepth

• **uMinOccluderDepth**: `IUniform`<`number`\>

___

### uShadowBias

• **uShadowBias**: `IUniform`<`number`\>

___

### uShadowDepthPerBlock

• **uShadowDepthPerBlock**: `IUniform`<`number`\>

Near-cascade shadow-map depth per block along the light.

___

### uShadowIgnoresSelf

• **uShadowIgnoresSelf**: `IUniform`<`number`\>

1 when nothing inside `uShadowSelfBounds` may shade the surface on any
face: a first-person viewmodel, held at the eye while the body behind
it still casts. 0 (the default) keeps a body's own shadow on the faces
that look toward the sun, as a head shades the shoulders below it.

___

### uShadowMap0

• **uShadowMap0**: `IUniform`<`Texture`<`unknown`\>\>

___

### uShadowMap1

• **uShadowMap1**: `IUniform`<`Texture`<`unknown`\>\>

___

### uShadowMap2

• **uShadowMap2**: `IUniform`<`Texture`<`unknown`\>\>

___

### uShadowMatrix0

• **uShadowMatrix0**: `IUniform`<`Matrix4`\>

___

### uShadowMatrix1

• **uShadowMatrix1**: `IUniform`<`Matrix4`\>

___

### uShadowMatrix2

• **uShadowMatrix2**: `IUniform`<`Matrix4`\>

___

### uShadowNormalBias

• **uShadowNormalBias**: `IUniform`<`number`\>

___

### uShadowSelfBounds

• **uShadowSelfBounds**: `IUniform`<`Vector4`\>

The receiving body's own bounding sphere in world space (centre, radius;
radius 0 for none), read by `getEntityShadowAt`: an occluder inside it,
along the ray to the sun, is the body itself and casts nothing onto it.
A body shares one vector across all of its parts' uniforms.

___

### uShadowStrength

• **uShadowStrength**: `IUniform`<`number`\>

___

### uShadowWorldMatrix

• **uShadowWorldMatrix**: `IUniform`<`Matrix4`\>

Carries the frame a surface is drawn in into the world its shadows are
cast in; identity for anything drawn in the world. A viewmodel drawn in
a scene of its own about the eye sets where that scene sits.

___

### uSunColor

• **uSunColor**: `IUniform`<`Color`\>

___

### uSunDirection

• **uSunDirection**: `IUniform`<`Vector3`\>

___

### uSunlightIntensity

• **uSunlightIntensity**: `IUniform`<`number`\>

___

### uWorldOffset

• **uWorldOffset**: `IUniform`<`Vector3`\>
