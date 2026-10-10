---
id: "LightSourceRegistry"
title: "Class: LightSourceRegistry"
sidebar_label: "LightSourceRegistry"
sidebar_position: 0
custom_edit_url: null
---

Pooled structure-of-arrays storage for every registered local light.
Handles are generation-checked packed integers; all mutators are in-place
writes with zero allocation. The registry knows nothing about selection,
chunks, or the GPU — it is the single source of truth the rest of the
system reads.

## Constructors

### constructor

• **new LightSourceRegistry**(`capacity`): [`LightSourceRegistry`](LightSourceRegistry.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `capacity` | `number` |

#### Returns

[`LightSourceRegistry`](LightSourceRegistry.md)

## Properties

### aliveCount

• **aliveCount**: `number` = `0`

___

### aliveIndices

• `Readonly` **aliveIndices**: `Uint32Array`<`ArrayBufferLike`\>

Dense list of alive slot indices, iteration order = allocation order.

___

### aux

• `Readonly` **aux**: `Float32Array`<`ArrayBufferLike`\>

Spot: direction xyz + cosOuter. Capsule: end offset xyz + 0.

___

### capacity

• `Readonly` **capacity**: `number`

___

### colors

• `Readonly` **colors**: `Float32Array`<`ArrayBufferLike`\>

___

### flags

• `Readonly` **flags**: `Uint8Array`<`ArrayBufferLike`\>

___

### flickers

• `Readonly` **flickers**: `Float32Array`<`ArrayBufferLike`\>

Flicker speed, amplitude, phase, and the spot's inverse cos delta.

___

### intensities

• `Readonly` **intensities**: `Float32Array`<`ArrayBufferLike`\>

___

### positions

• `Readonly` **positions**: `Float32Array`<`ArrayBufferLike`\>

___

### priorityBiases

• `Readonly` **priorityBiases**: `Float32Array`<`ArrayBufferLike`\>

___

### ranges

• `Readonly` **ranges**: `Float32Array`<`ArrayBufferLike`\>

___

### revision

• **revision**: `number` = `1`

Bumped on any mutation that can change selection or packed data; the
clustering pass compares it to decide whether any work exists at all.

___

### shapes

• `Readonly` **shapes**: `Uint8Array`<`ArrayBufferLike`\>

___

### shares

• `Readonly` **shares**: `Float32Array`<`ArrayBufferLike`\>

## Methods

### add

▸ **add**(`descriptor`, `x`, `y`, `z`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `descriptor` | [`LocalLightDescriptor`](../interfaces/LocalLightDescriptor.md) |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`number`

___

### generationAt

▸ **generationAt**(`index`): `number`

Current generation of a slot, for state keyed to a light's lifetime
rather than its slot (selection hysteresis must not survive slot reuse).

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`number`

___

### handleAt

▸ **handleAt**(`index`): `number`

The handle a live slot answers to (meaningless for a free slot).

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`number`

___

### isEnabledAt

▸ **isEnabledAt**(`index`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `index` | `number` |

#### Returns

`boolean`

___

### remove

▸ **remove**(`handle`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |

#### Returns

`boolean`

___

### resolve

▸ **resolve**(`handle`): `number`

Slot index for a live handle, or `-1` for stale/invalid ones.

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |

#### Returns

`number`

___

### setColor

▸ **setColor**(`handle`, `color`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `color` | [`number`, `number`, `number`] |

#### Returns

`boolean`

___

### setDirection

▸ **setDirection**(`handle`, `x`, `y`, `z`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`boolean`

___

### setEnabled

▸ **setEnabled**(`handle`, `isOn`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `isOn` | `boolean` |

#### Returns

`boolean`

___

### setIntensity

▸ **setIntensity**(`handle`, `intensity`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `intensity` | `number` |

#### Returns

`boolean`

___

### setPosition

▸ **setPosition**(`handle`, `x`, `y`, `z`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`boolean`

___

### setRange

▸ **setRange**(`handle`, `range`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handle` | `number` |
| `range` | `number` |

#### Returns

`boolean`
