---
id: "LocalLightStats"
title: "Interface: LocalLightStats"
sidebar_label: "LocalLightStats"
sidebar_position: 0
custom_edit_url: null
---

Mutated in place every update; never reallocated.

## Properties

### atlasBytes

• **atlasBytes**: `number`

GPU bytes held by the shadow atlas (0 until first allocation).

___

### atlasEvictions

• **atlasEvictions**: `number`

Cumulative slot evictions through the challenger hysteresis.

___

### atlasOccupancy

• **atlasOccupancy**: `number`

Active shadow slots over capacity, 0..1.

___

### candidates

• **candidates**: `number`

___

### cellsOverflowed

• **cellsOverflowed**: `number`

___

### clustered

• **clustered**: `number`

___

### dataTextureUploads

• **dataTextureUploads**: `number`

___

### fadingLights

• **fadingLights**: `number`

Lights still packed only to finish fading out of the selection.

___

### fadingSlots

• **fadingSlots**: `number`

Cell slots mid-fade after the last update.

___

### gridTextureUploads

• **gridTextureUploads**: `number`

___

### highResolution

• **highResolution**: `number`

1 while the drawing buffer is past the high-resolution gate.

___

### ledgerUnitsCsm

• **ledgerUnitsCsm**: `number`

Ledger units the CSM cascades consumed this frame.

___

### ledgerUnitsLocal

• **ledgerUnitsLocal**: `number`

Ledger units local faces consumed this frame.

___

### packMs

• **packMs**: `number`

___

### packMsPeak

• **packMsPeak**: `number`

___

### registered

• **registered**: `number`

___

### scanMs

• **scanMs**: `number`

___

### scanMsPeak

• **scanMsPeak**: `number`

___

### sectionsPendingScan

• **sectionsPendingScan**: `number`

___

### selectMs

• **selectMs**: `number`

Cost of the current frame's phases; `0` on frames that skipped them.

___

### selectMsPeak

• **selectMsPeak**: `number`

Worst frame since the last [LocalLights.resetPeakStats](../classes/LocalLights.md#resetpeakstats).

___

### selectionChurn

• **selectionChurn**: `number`

___

### shadowCacheHitRate

• **shadowCacheHitRate**: `number`

Of the frames in which a shadowed light was live, the fraction served
entirely from its cached static faces. Resets with peak stats.

___

### shadowFacesDynamic

• **shadowFacesDynamic**: `number`

___

### shadowFacesRendered

• **shadowFacesRendered**: `number`

Atlas faces rendered this frame (static + dynamic).

___

### shadowFacesStatic

• **shadowFacesStatic**: `number`

___

### shadowInvalidations

• **shadowInvalidations**: `number`

Cumulative cache invalidations (block edits, streaming, regions).

___

### shadowScheduleMs

• **shadowScheduleMs**: `number`

Main-thread cost of the shadow schedule + face renders this frame.

___

### shadowScheduleMsPeak

• **shadowScheduleMsPeak**: `number`

___

### shadowed

• **shadowed**: `number`

Lights currently holding a shadow slot.
