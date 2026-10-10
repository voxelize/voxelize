---
id: "MeshPipeline"
title: "Class: MeshPipeline"
sidebar_label: "MeshPipeline"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new MeshPipeline**(): [`MeshPipeline`](MeshPipeline.md)

#### Returns

[`MeshPipeline`](MeshPipeline.md)

## Accessors

### dirtyCount

• `get` **dirtyCount**(): `number`

#### Returns

`number`

## Methods

### expireStuckJobs

▸ **expireStuckJobs**(`nowMs`, `maxAgeMs`): `string`[]

The leak watchdog: release any in-flight generation older than
`maxAgeMs` and re-queue its key. Single-flight dispatch turns one
unsettled job into a chunk level that never re-meshes again for the
whole session, and every historical instance of that (a shed queue, a
dispatch path missing its release, a worker that died) has looked like
this exact symptom: a walkable chunk that stopped rendering hours into
a long session and stayed gone until reload. Expiry converts whichever
such path still exists — or gets written next — from a permanent hole
into a logged self-heal. Returns the expired keys for the caller to
report.

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowMs` | `number` |
| `maxAgeMs` | `number` |

#### Returns

`string`[]

___

### failJob

▸ **failJob**(`key`, `jobGeneration`): `void`

Release an in-flight generation that produced no mesh (worker bail-out).
Re-queues the key so remesh can retry instead of leaving a permanent
ghost mesh when voxel data already changed but geometry never applied.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `jobGeneration` | `number` |

#### Returns

`void`

___

### getDirtyKeys

▸ **getDirtyKeys**(`center?`): `string`[]

Dirty keys ready for dispatch: the urgent lane first in insertion order
(player edits stay latency-ordered), then regular keys nearest-first
around `center` so remesh work reaches the camera before the horizon.
Without a center the regular lane keeps insertion order.

#### Parameters

| Name | Type |
| :------ | :------ |
| `center?` | [`Coords2`](../#coords2) |

#### Returns

`string`[]

___

### hasAnyInFlightJobs

▸ **hasAnyInFlightJobs**(): `boolean`

#### Returns

`boolean`

___

### hasDirtyChunks

▸ **hasDirtyChunks**(): `boolean`

#### Returns

`boolean`

___

### hasDisplayed

▸ **hasDisplayed**(`key`): `boolean`

Whether some mesh of this section, current or not, has been applied.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### hasInFlightJob

▸ **hasInFlightJob**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### inFlightJobCount

▸ **inFlightJobCount**(): `number`

#### Returns

`number`

___

### isDirty

▸ **isDirty**(`key`): `boolean`

Whether a mesh job for this section is waiting to be dispatched.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### isUrgent

▸ **isUrgent**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### makeKey

▸ **makeKey**(`cx`, `cz`, `level`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`string`

___

### markFreshFromServer

▸ **markFreshFromServer**(`cx`, `cz`, `level`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### needsRemesh

▸ **needsRemesh**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### onJobComplete

▸ **onJobComplete**(`key`, `jobGeneration`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `jobGeneration` | `number` |

#### Returns

`boolean`

___

### onVoxelChange

▸ **onVoxelChange**(`cx`, `cz`, `level`, `isUrgent?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `cx` | `number` | `undefined` |
| `cz` | `number` | `undefined` |
| `level` | `number` | `undefined` |
| `isUrgent` | `boolean` | `false` |

#### Returns

`void`

___

### parseKey

▸ **parseKey**(`key`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

___

### remove

▸ **remove**(`cx`, `cz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### shouldStartJob

▸ **shouldStartJob**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

___

### startJob

▸ **startJob**(`key`, `nowMs?`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `nowMs` | `number` |

#### Returns

`number`
