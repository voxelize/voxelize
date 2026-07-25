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

▸ **getDirtyKeys**(): `string`[]

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

▸ **startJob**(`key`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`number`
