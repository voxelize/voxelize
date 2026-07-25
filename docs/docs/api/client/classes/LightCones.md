---
id: "LightCones"
title: "Class: LightCones"
sidebar_label: "LightCones"
sidebar_position: 0
custom_edit_url: null
---

Owns the shared cone uniform storage. The game clears and refills it every
frame (`beginFrame` + `pushCone`); every material that binds
[LightCones.uniformBindings](LightCones.md#uniformbindings) sees the same values with zero copying.

## Constructors

### constructor

• **new LightCones**(): [`LightCones`](LightCones.md)

#### Returns

[`LightCones`](LightCones.md)

## Properties

### uniforms

• `Readonly` **uniforms**: [`LightConeUniforms`](../modules.md#lightconeuniforms)

## Accessors

### uniformBindings

• `get` **uniformBindings**(): `Record`\<`string`, [`LightConeUniformBinding`](../modules.md#lightconeuniformbinding)\>

#### Returns

`Record`\<`string`, [`LightConeUniformBinding`](../modules.md#lightconeuniformbinding)\>

## Methods

### beginFrame

▸ **beginFrame**(): `void`

#### Returns

`void`

___

### pushCone

▸ **pushCone**(`input`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `input` | [`LightConeInput`](../modules.md#lightconeinput) |

#### Returns

`boolean`
