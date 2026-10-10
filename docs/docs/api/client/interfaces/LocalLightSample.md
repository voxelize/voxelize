---
id: "LocalLightSample"
title: "Interface: LocalLightSample"
sidebar_label: "LocalLightSample"
sidebar_position: 0
custom_edit_url: null
---

Zero-allocation output target for [LocalLights.queryLocalLights](../classes/LocalLights.md#querylocallights).

## Properties

### claim

• **claim**: `number`

Unoccluded luminance the cell-held lights *claim* at the point (falloff
and cone shaping only — no flicker, occlusion, shadows, or rim fade).
Consumers that also apply a baked flood term scale that term by the
flood remainder derived from this claim and [windowFade](LocalLightSample.md#windowfade),
mirroring the chunk shader's ownership blend, so a point covered by
analytic lights is never lit by both models.

___

### color

• **color**: [`number`, `number`, `number`]

Combined linear RGB arriving at the query point, already scaled by the
window-rim fade like the chunk shader's analytic term.

___

### count

• **count**: `number`

Lights that contributed.

___

### windowFade

• **windowFade**: `number`

Window-rim fade at the point (1 deep inside the grid window, 0 at and
beyond its edge) — the crossfade weight between the owned composition
and the legacy flood frame.
