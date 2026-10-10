---
id: "CSMConfig"
title: "Interface: CSMConfig"
sidebar_label: "CSMConfig"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### cascades

• **cascades**: `number`

___

### depthPolygonOffsetFactor

• **depthPolygonOffsetFactor**: `number`

___

### depthPolygonOffsetUnits

• **depthPolygonOffsetUnits**: `number`

___

### entityShadowFrameInterval

• **entityShadowFrameInterval**: `number`

___

### farShadowMapSize

• **farShadowMapSize**: `number`

Map size for cascades past the first. The far cascades cover tens of
times the near cascade's area, so their texel density per block is far
higher than it needs to be at the near cascade's resolution — and a far
cascade re-render's depth-write cost is what turns a shadow refresh
into a dropped frame at high display resolutions.

___

### isDepthPolygonOffsetEnabled

• **isDepthPolygonOffsetEnabled**: `boolean`

___

### lightMargin

• **lightMargin**: `number`

___

### maxLightSwingPerSecond

• **maxLightSwingPerSecond**: `number`

Light-direction speed, in radians per second, above which direction
changes stop marking cascades dirty. The day-cycle drift turns the
light at most 0.005 rad/s on a twenty-minute day; the dusk sun-to-moon
handoff swings it twenty times faster, fast enough that shadows
re-rendered mid-swing are stale by the time they are sampled. The
skipped motion keeps accumulating against the dirty threshold, so the
first calm frame after a swing (or a time-command jump) still
refreshes every cascade at the settled direction.

A speed rather than a per-frame step: the same drift is a bigger step
on a longer frame, and a per-frame cap read it as a swing on every page
below about 52 fps, so the cascades stopped following the sun there.

___

### maxShadowDistance

• **maxShadowDistance**: `number`

___

### shadowBias

• **shadowBias**: `number`

___

### shadowCasterDistance

• **shadowCasterDistance**: `number`

___

### shadowMapSize

• **shadowMapSize**: `number`

___

### shadowNormalBias

• **shadowNormalBias**: `number`

___

### shadowSideFaceBiasScale

• **shadowSideFaceBiasScale**: `number`

___

### shadowSlopeBiasMin

• **shadowSlopeBiasMin**: `number`

___

### shadowSlopeBiasScale

• **shadowSlopeBiasScale**: `number`

___

### shadowStrengthRenderFloor

• **shadowStrengthRenderFloor**: `number`

Shadow strength at or below which cascade re-renders are skipped
entirely. During the dusk handoff the light azimuth swings 180 degrees
from sun to moon while the same curve fades shadows to invisibility;
re-rendering every cascade to track a swing nobody can see is the
single most expensive thing the renderer does all day.

___

### shadowTopFaceBiasScale

• **shadowTopFaceBiasScale**: `number`

___

### stillCameraMatrixEpsilon

• **stillCameraMatrixEpsilon**: `number`

Max absolute per-element view-projection delta below which the camera
counts as still, catching rotation the positional test cannot see.

___

### stillCameraPositionEpsilon

• **stillCameraPositionEpsilon**: `number`

Player movement (blocks per frame) below which the camera counts as
still. Control smoothing approaches its target asymptotically and
never lands bit-exactly, so an exact-equality stillness test never
fires; this floor sits well above that residue and well below any
motion a player could perceive.
