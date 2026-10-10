---
id: "SectionVisibilityGraph"
title: "Class: SectionVisibilityGraph"
sidebar_label: "SectionVisibilityGraph"
sidebar_position: 0
custom_edit_url: null
---

Sodium-style section traversal graph. Each meshed section reports which of
its face pairs see each other through non-opaque voxels; a per-frame BFS
from the camera's section walks the graph, only continuing through a
section when the face it entered connects to the face it wants to leave by,
and never doubling back toward the camera. Sections the walk cannot reach
are occluded — enclosed interiors stop paying for the terrain around them.

## Constructors

### constructor

• **new SectionVisibilityGraph**(`options`): [`SectionVisibilityGraph`](SectionVisibilityGraph.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`SectionVisibilityGraphOptions`](../#sectionvisibilitygraphoptions) |

#### Returns

[`SectionVisibilityGraph`](SectionVisibilityGraph.md)

## Accessors

### isComplete

• `get` **isComplete**(): `boolean`

Whether the last [walk](SectionVisibilityGraph.md#walk) started from a loaded section. When the
camera stands outside the graph the walk cannot claim anything is hidden,
and callers must fall back to frustum-only culling.

#### Returns

`boolean`

___

### sectionCount

• `get` **sectionCount**(): `number`

#### Returns

`number`

___

### stats

• `get` **stats**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `constrained` | `number` |
| `isComplete` | `boolean` |
| `reached` | `number` |
| `sections` | `number` |
| `visible` | `number` |

## Methods

### addChunk

▸ **addChunk**(`cx`, `cz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### clear

▸ **clear**(): `void`

#### Returns

`void`

___

### isSectionReached

▸ **isSectionReached**(`cx`, `cz`, `level`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`boolean`

___

### isSectionVisible

▸ **isSectionVisible**(`cx`, `cz`, `level`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`boolean`

___

### removeChunk

▸ **removeChunk**(`cx`, `cz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### setConnectivity

▸ **setConnectivity**(`cx`, `cz`, `level`, `connectivity`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `connectivity` | `number` |

#### Returns

`void`

___

### walk

▸ **walk**(`cameraPosition`, `projectionScreenMatrix`, `fogFar`, `isSuspended?`): `void`

Runs the traversal for the current camera. The walk itself follows only
connectivity — frustum and fog decide which reached sections count as
visible, never where the walk may go, so the reached set stays a pure
"an air path exists" answer that shadow-safe chunks can trust. `fogFar`
(in blocks, horizontal) is the fully-fogged distance; `Infinity` disables
fog culling.

`isSuspended` is the caller saying the air-path proof does not hold for
this view: a noclip camera inside rock sees through the unmeshed faces
between solid voxels, so connectivity is no evidence that anything is
hidden. The walk then reports incomplete and callers fall back to
frustum-only culling. A noclip camera in open air is not suspended; it
sees exactly what a walking player at the same eye would.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `cameraPosition` | `Vector3` | `undefined` |
| `projectionScreenMatrix` | `Matrix4` | `undefined` |
| `fogFar` | `number` | `undefined` |
| `isSuspended` | `boolean` | `false` |

#### Returns

`void`
