---
id: "LocalLightAirlight"
title: "Class: LocalLightAirlight"
sidebar_label: "LocalLightAirlight"
sidebar_position: 0
custom_edit_url: null
---

The few local lights the camera can see, for effects that light the air
and the room rather than the surface next to each source (plan steps 5
and 8). Drawn from the clustered layer's selection, so it inherits that
selection's stability; on top, a light keeps its place against a
marginally stronger challenger (`hysteresis`), and every change — joining,
leaving, losing or regaining line of sight, the day coming up — fades.
All per-frame work runs on preallocated arrays.

## Constructors

### constructor

• **new LocalLightAirlight**(`options?`): [`LocalLightAirlight`](LocalLightAirlight.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`<[`LocalLightAirlightOptions`](../#locallightairlightoptions)\> |

#### Returns

[`LocalLightAirlight`](LocalLightAirlight.md)

## Properties

### isEnabled

• **isEnabled**: `boolean` = `true`

Off for A/B captures; the set empties through its fades.

___

### options

• `Readonly` **options**: [`LocalLightAirlightOptions`](../#locallightairlightoptions)

___

### uniforms

• `Readonly` **uniforms**: `Object`

Shared by every material that reads the set; updated in place.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airActive` | \{ `value`: `number` = 0 } | 1 when any member glows in the air (the effect's early out). |
| `airActive.value` | `number` | - |
| `bands` | \{ `value`: `number` = 0 } | - |
| `bands.value` | `number` | - |
| `colors` | \{ `value`: `Vector4`[]  } | rgb x intensity x fade, w = scattering core radius |
| `colors.value` | `Vector4`[] | - |
| `count` | \{ `value`: `number` = 0 } | - |
| `count.value` | `number` | - |
| `fillCoreScale` | \{ `value`: `number` = 0 } | - |
| `fillCoreScale.value` | `number` | - |
| `fillFloodMask` | \{ `value`: `number` = 0 } | - |
| `fillFloodMask.value` | `number` | - |
| `fillRangeScale` | \{ `value`: `number` = 0 } | - |
| `fillRangeScale.value` | `number` | - |
| `fillStrength` | \{ `value`: `number` = 0 } | - |
| `fillStrength.value` | `number` | - |
| `maxAdded` | \{ `value`: `number` = 0 } | - |
| `maxAdded.value` | `number` | - |
| `positions` | \{ `value`: `Vector4`[]  } | xyz, range |
| `positions.value` | `Vector4`[] | - |
| `seen` | \{ `value`: `number`[]  } | Per member, the air glow's share: line of sight from the camera x the daylight/open-sky/submersion dimmer. Room fill ignores it — a surface's bounce light does not depend on where the camera stands. |
| `seen.value` | `number`[] | - |
| `strength` | \{ `value`: `number` = 0 } | - |
| `strength.value` | `number` | - |

## Accessors

### size

• `get` **size**(): `number`

Lights in the set right now, fading ones included.

#### Returns

`number`

## Methods

### update

▸ **update**(`input`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `input` | [`AirlightInput`](../#airlightinput) |

#### Returns

`void`
