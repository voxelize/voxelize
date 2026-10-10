---
id: "LocalLightDescriptor"
title: "Interface: LocalLightDescriptor"
sidebar_label: "LocalLightDescriptor"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### analyticShare

• `Optional` **analyticShare**: `number`

Scales this light's analytic contribution — and, with it, the coverage
claim that suppresses the baked flood term. `1` (default): the light's
full visible output is analytic wherever it reaches. Lower values lean
on the flood base instead (useful for aggregated dense fields whose few
proxy records cannot reproduce a distributed glow).

___

### angleDeg

• `Optional` **angleDeg**: `number`

Spot only: full outer cone angle in degrees.

___

### color

• `Optional` **color**: [`number`, `number`, `number`]

Linear RGB, each 0..1. Exactly one of `color` | `colorTemperatureK`.

___

### colorTemperatureK

• `Optional` **colorTemperatureK**: `number`

Kelvin, converted once at registration (1800K torch .. 6500K daylight).

___

### direction

• `Optional` **direction**: [`number`, `number`, `number`]

Spot only: axis the cone opens around.

___

### endOffset

• `Optional` **endOffset**: [`number`, `number`, `number`]

Capsule only: second endpoint relative to the position.

___

### flicker

• `Optional` **flicker**: [`FlickerProfile`](FlickerProfile.md)

Shader-evaluated intensity wobble; never touches selection or packing.

___

### innerRatio

• `Optional` **innerRatio**: `number`

Spot only: inner full-brightness cone as a fraction of the outer.

___

### intensity

• **intensity**: `number`

Peak contribution in tonemapped-scene-relative units; 1.0 is a full torch.

___

### isStatic

• **isStatic**: `boolean`

Static sources are maskable by the flood field and assert that
`setPosition` will never be called on them.

___

### priorityBias

• `Optional` **priorityBias**: `number`

Additive selection-score bias for gameplay-critical lights.

___

### range

• **range**: `number`

Hard cutoff in blocks; falloff reaches exactly 0 here.

___

### shadowPolicy

• **shadowPolicy**: [`LightShadowPolicy`](../#lightshadowpolicy)

___

### shape

• **shape**: [`LightShape`](../#lightshape)
