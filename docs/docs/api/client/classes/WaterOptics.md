---
id: "WaterOptics"
title: "Class: WaterOptics"
sidebar_label: "WaterOptics"
sidebar_position: 0
custom_edit_url: null
---

Per-frame driver of the camera's underwater state. Smooths submersion and
depth across the waterline, and derives the ambient water color, sky fade,
and near-camera light filter that the renderer uniforms consume.

## Constructors

### constructor

• **new WaterOptics**(): [`WaterOptics`](WaterOptics.md)

#### Returns

[`WaterOptics`](WaterOptics.md)

## Properties

### ambientColor

• `Readonly` **ambientColor**: `Color`

___

### depth

• **depth**: `number` = `0`

___

### lightFilter

• `Readonly` **lightFilter**: `Color`

___

### skyFade

• **skyFade**: `number` = `0`

___

### submersion

• **submersion**: `number` = `0`

___

### viewExtinctionScale

• **viewExtinctionScale**: `number` = `1`

A/B knob on the underwater view extinction, relative to the baked
`viewExtinctionScale`: 1 is the shipped clarity, 0.35 / 0.22 the
earlier, murkier water.

___

### waterPlaneY

• **waterPlaneY**: `number` = `0`

## Methods

### update

▸ **update**(`input`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `input` | [`WaterOpticsFrameInput`](../#wateropticsframeinput) |

#### Returns

`void`
