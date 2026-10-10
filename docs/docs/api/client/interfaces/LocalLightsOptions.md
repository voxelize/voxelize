---
id: "LocalLightsOptions"
title: "Interface: LocalLightsOptions"
sidebar_label: "LocalLightsOptions"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### analyticRadius

• **analyticRadius**: `number`

Blocks from the camera within which lights become analytic.

___

### csmFarCascadeUnits

• **csmFarCascadeUnits**: `number`

Ledger cost of one CSM far cascade, in face units.

___

### csmNearCascadeUnits

• **csmNearCascadeUnits**: `number`

Ledger cost of the CSM near cascade, in face units.

___

### fadingRowReserve

• **fadingRowReserve**: `number`

Data rows kept free for lights fading out of the selection, so the
selection never has to cut one off mid-fade.

___

### fluidSpecularStrength

• **fluidSpecularStrength**: `number`

Strength of local specular on fluids; 0 disables.

___

### gridCellSize

• **gridCellSize**: `number`

Grid cell size in blocks.

___

### gridDims

• **gridDims**: [`number`, `number`, `number`]

Grid cells per axis `[x, y, z]`; the window scrolls with the camera.

___

### highResolutionHysteresis

• **highResolutionHysteresis**: `number`

Fractional band around `highResolutionPixels` the gate must cross to
flip, so an adaptive render scale hovering at the threshold does not
toggle it every step.

___

### highResolutionLightsPerCell

• **highResolutionLightsPerCell**: `number`

___

### highResolutionPixels

• **highResolutionPixels**: `number`

Drawing-buffer pixels at and above which a cell keeps at most
`highResolutionLightsPerCell` steady lights: the per-fragment loop is
paid per pixel, so large buffers trade light count for frame time.

___

### localShadowBias

• **localShadowBias**: `number`

Constant occluder-side depth bias in blocks (linear light space).

___

### localShadowNormalBiasTexels

• **localShadowNormalBiasTexels**: `number`

Receiver offset along the surface normal, in shadow texels.

___

### localShadowPcfRadius

• **localShadowPcfRadius**: `number`

PCF tap spread, in shadow texels.

___

### localShadowStrength

• **localShadowStrength**: `number`

1 = an occluded fragment loses the light entirely.

___

### maskKnee

• **maskKnee**: `number`

Flood-mask knee: flood level (0..1) at which masked lights reach full.

___

### maxClusteredLights

• **maxClusteredLights**: `number`

Lights the clustered layer may select per pass; capped at 255.

___

### maxLightsPerCell

• **maxLightsPerCell**: `number`

Grid slots filled per cell; the shader loop is compiled for 8.

___

### maxRegisteredLights

• **maxRegisteredLights**: `number`

Pool capacity for registered lights (static emitters + dynamic sources).

___

### maxSectionScansPerFrame

• **maxSectionScansPerFrame**: `number`

Sections scanned for emitters per frame at most.

___

### maxShadowedLights

• **maxShadowedLights**: `number`

Shadowed local lights at once; each owns a fixed atlas region.

___

### qualityTier

• **qualityTier**: [`LightQualityTier`](../#lightqualitytier)

Initial quality tier.

___

### selectionHysteresis

• **selectionHysteresis**: `number`

Multiplier a light's score gets while selected, against churn.

___

### shadowAtlasSize

• **shadowAtlasSize**: `number`

Edge length of the shared depth atlas, in pixels.

___

### shadowEvictionHysteresis

• **shadowEvictionHysteresis**: `Object`

A challenger light must out-score a shadow holder by `ratio` for
`frames` consecutive frames before evicting it from the atlas.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `frames` | `number` |
| `ratio` | `number` |

___

### shadowFadeMs

• **shadowFadeMs**: `number`

How long a light's shadow takes to fade in or out, in ms.

___

### shadowLedgerUnitsPerFrame

• **shadowLedgerUnitsPerFrame**: `number`

Face units the shadow ledger may spend per frame (CSM + local).

___

### shadowSlotSize

• **shadowSlotSize**: `number`

Edge length of one atlas cell (one cube face render), in pixels.

___

### slotFadeMs

• **slotFadeMs**: `number`

How long a light takes to fade into or out of a cell, in ms.

___

### temporalStability

• **temporalStability**: `boolean`

Temporal stability of the clustered layer (default on): cells keep the
lights that matter most to them rather than the ones nearest the
camera, every change of a cell's lights fades over `slotFadeMs`, the
window rim fades continuously, and invalidated shadow faces keep
sampling their last map until the re-render lands. Off is the legacy
frame, kept only for A/B captures.

___

### windowFadeBlocks

• **windowFadeBlocks**: `number`

Width of the window-rim fade, in blocks.
