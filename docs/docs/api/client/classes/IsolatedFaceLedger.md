---
id: "IsolatedFaceLedger"
title: "Class: IsolatedFaceLedger<TMaterial>"
sidebar_label: "IsolatedFaceLedger"
sidebar_position: 0
custom_edit_url: null
---

Every per-voxel isolated-face material the world has made, with what it
is wearing. The world consults it to answer the census, to hand a face
its default the moment that default is painted (a chunk can mesh before
the registry's textures land), and to fill what is still unknown.

## Type parameters

| Name |
| :------ |
| `TMaterial` |

## Constructors

### constructor

• **new IsolatedFaceLedger**<`TMaterial`\>(): [`IsolatedFaceLedger`](IsolatedFaceLedger.md)<`TMaterial`\>

#### Type parameters

| Name |
| :------ |
| `TMaterial` |

#### Returns

[`IsolatedFaceLedger`](IsolatedFaceLedger.md)<`TMaterial`\>

## Accessors

### size

• `get` **size**(): `number`

#### Returns

`number`

## Methods

### clear

▸ **clear**(): `void`

#### Returns

`void`

___

### entries

▸ **entries**(): \{ `entry`: [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\> ; `key`: `string`  }[]

#### Returns

\{ `entry`: [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\> ; `key`: `string`  }[]

___

### entriesForFace

▸ **entriesForFace**(`blockId`, `faceName`, `state?`): \{ `entry`: [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\> ; `key`: `string`  }[]

The entries for one block face in a given state.

#### Parameters

| Name | Type |
| :------ | :------ |
| `blockId` | `number` |
| `faceName` | `string` |
| `state?` | [`SurfaceState`](../#surfacestate) |

#### Returns

\{ `entry`: [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\> ; `key`: `string`  }[]

___

### get

▸ **get**(`key`): [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\>

___

### note

▸ **note**(`key`, `entry`, `state`, `now`): [`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\>

Record a material's current dress. A material seen for the first time
is registered; one already known only changes state, so a paint after
a seed reads `painted` and a seed after a paint never demotes it.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `entry` | `Omit`<[`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\>, ``"state"`` \| ``"createdAt"``\> |
| `state` | [`SurfaceState`](../#surfacestate) |
| `now` | `number` |

#### Returns

[`IsolatedFaceEntry`](../#isolatedfaceentry)<`TMaterial`\>

___

### remove

▸ **remove**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`
