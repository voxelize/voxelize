---
id: "BlockLightProfile"
title: "Interface: BlockLightProfile"
sidebar_label: "BlockLightProfile"
sidebar_position: 0
custom_edit_url: null
---

Declared by the game per block id (or name). When none is declared for an
emitting block, the engine derives a default from the block's flood light
levels — point shape, color from normalized RGB levels, range from the max
channel level, static, `voxelMask` — so unconfigured emitter blocks work.

## Hierarchy

- `Partial`<`Omit`<[`LocalLightDescriptor`](LocalLightDescriptor.md), ``"isStatic"``\>\>

  ↳ **`BlockLightProfile`**

## Properties

### aggregateThreshold

• `Optional` **aggregateThreshold**: `number`

Emitters per 16-block section above which aggregation kicks in.

___

### aggregation

• `Optional` **aggregation**: ``"none"`` \| ``"cluster"``

Collapse dense same-block emitters into per-section proxies.

___

### analyticShare

• `Optional` **analyticShare**: `number`

Scales this light's analytic contribution — and, with it, the coverage
claim that suppresses the baked flood term. `1` (default): the light's
full visible output is analytic wherever it reaches. Lower values lean
on the flood base instead (useful for aggregated dense fields whose few
proxy records cannot reproduce a distributed glow).

#### Inherited from

Partial.analyticShare

___

### angleDeg

• `Optional` **angleDeg**: `number`

Spot only: full outer cone angle in degrees.

#### Inherited from

Partial.angleDeg

___

### color

• `Optional` **color**: [`number`, `number`, `number`]

Linear RGB, each 0..1. Exactly one of `color` | `colorTemperatureK`.

#### Inherited from

Partial.color

___

### colorTemperatureK

• `Optional` **colorTemperatureK**: `number`

Kelvin, converted once at registration (1800K torch .. 6500K daylight).

#### Inherited from

Partial.colorTemperatureK

___

### direction

• `Optional` **direction**: [`number`, `number`, `number`]

Spot only: axis the cone opens around.

#### Inherited from

Partial.direction

___

### endOffset

• `Optional` **endOffset**: [`number`, `number`, `number`]

Capsule only: second endpoint relative to the position.

#### Inherited from

Partial.endOffset

___

### flicker

• `Optional` **flicker**: [`FlickerProfile`](FlickerProfile.md)

Shader-evaluated intensity wobble; never touches selection or packing.

#### Inherited from

Partial.flicker

___

### innerRatio

• `Optional` **innerRatio**: `number`

Spot only: inner full-brightness cone as a fraction of the outer.

#### Inherited from

Partial.innerRatio

___

### intensity

• `Optional` **intensity**: `number`

Peak contribution in tonemapped-scene-relative units; 1.0 is a full torch.

#### Inherited from

Partial.intensity

___

### maxProxiesPerSection

• `Optional` **maxProxiesPerSection**: `number`

Proxy records a section may hold once aggregated.

___

### offset

• `Optional` **offset**: [`number`, `number`, `number`]

Emitter origin within the voxel. Default `[0.5, 0.5, 0.5]`.

___

### priorityBias

• `Optional` **priorityBias**: `number`

Additive selection-score bias for gameplay-critical lights.

#### Inherited from

Partial.priorityBias

___

### range

• `Optional` **range**: `number`

Hard cutoff in blocks; falloff reaches exactly 0 here.

#### Inherited from

Partial.range

___

### shadowPolicy

• `Optional` **shadowPolicy**: [`LightShadowPolicy`](../#lightshadowpolicy)

#### Inherited from

Partial.shadowPolicy

___

### shape

• `Optional` **shape**: [`LightShape`](../#lightshape)

#### Inherited from

Partial.shape
