---
id: "EntityLivenessTracker"
title: "Class: EntityLivenessTracker"
sidebar_label: "EntityLivenessTracker"
sidebar_position: 0
custom_edit_url: null
---

Tracks when each entity last received a message, distinguishing per-entity
silence (a lost entity that should be released) from whole-stream silence
(a degraded connection where nothing should be released).

## Constructors

### constructor

• **new EntityLivenessTracker**(`options`): [`EntityLivenessTracker`](EntityLivenessTracker.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`EntityLivenessOptions`](../modules.md#entitylivenessoptions) |

#### Returns

[`EntityLivenessTracker`](EntityLivenessTracker.md)

## Methods

### collectStale

▸ **collectStale**(`nowSeconds`): `string`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowSeconds` | `number` |

#### Returns

`string`[]

___

### forget

▸ **forget**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

___

### touchEntity

▸ **touchEntity**(`id`, `nowSeconds`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `nowSeconds` | `number` |

#### Returns

`void`

___

### touchStream

▸ **touchStream**(`nowSeconds`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowSeconds` | `number` |

#### Returns

`void`
