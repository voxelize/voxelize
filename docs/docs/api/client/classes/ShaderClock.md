---
id: "ShaderClock"
title: "Class: ShaderClock"
sidebar_label: "ShaderClock"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ShaderClock**(): [`ShaderClock`](ShaderClock.md)

#### Returns

[`ShaderClock`](ShaderClock.md)

## Properties

### isShared

• **isShared**: `boolean` = `true`

Whether the clock follows the shared clock. Off, it runs on local
frame time from zero like the old page-uptime clock: an A/B switch.

## Accessors

### seconds

• `get` **seconds**(): `number`

Seconds, unwrapped: what the clock reads now.

#### Returns

`number`

___

### wrappedSeconds

• `get` **wrappedSeconds**(): `number`

Seconds in `[0, SHADER_CLOCK_WRAP_SECONDS)`: what the uniform holds.

#### Returns

`number`

## Methods

### advance

▸ **advance**(`shared`, `deltaSeconds`): `number`

Advances by one frame toward `shared`, the world's shared clock, and
returns the unwrapped reading.

#### Parameters

| Name | Type |
| :------ | :------ |
| `shared` | `number` |
| `deltaSeconds` | `number` |

#### Returns

`number`
