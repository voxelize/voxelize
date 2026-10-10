---
id: "EmitterBlock"
title: "Interface: EmitterBlock"
sidebar_label: "EmitterBlock"
sidebar_position: 0
custom_edit_url: null
---

The slice of a client block definition the scanner needs. Structural on
purpose: tests feed it plain objects, the world feeds it its registry.

## Properties

### blueLightLevel

• **blueLightLevel**: `number`

___

### faces

• `Optional` **faces**: `EmitterBlockFace`[]

Authored face geometry. When present and the block declares emissive
faces, the default emitter anchor is derived from the hot faces instead
of the voxel center — a torch emits from its flame, not its stick.

___

### greenLightLevel

• **greenLightLevel**: `number`

___

### id

• **id**: `number`

___

### isLight

• **isLight**: `boolean`

___

### redLightLevel

• **redLightLevel**: `number`
