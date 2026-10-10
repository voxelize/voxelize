---
id: "VoxelBoxWork"
title: "Class: VoxelBoxWork"
sidebar_label: "VoxelBoxWork"
sidebar_position: 0
custom_edit_url: null
---

Work every voxel box being built shares, in order, a slice per frame: the
frame-paced drain (`createBudgetedDrain`, made by `createDrain`) runs units
until the slice has spent its budget, so however many boxes bake at once
(a felled tree bakes several) the frame pays one budget for all of them. A
unit that throws fails its own run, loudly, never the drain.

## Constructors

### constructor

• **new VoxelBoxWork**(`options`): [`VoxelBoxWork`](VoxelBoxWork.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Object` | - |
| `options.createDrain` | (`work`: () => [`BudgetedWorkOutcome`](../#budgetedworkoutcome)) => \{ `schedule`: () => `void`  } | - |
| `options.now` | () => `number` | - |
| `options.sliceGapMs` | `number` | A pause between units longer than this starts a new slice. |

#### Returns

[`VoxelBoxWork`](VoxelBoxWork.md)

## Methods

### run

▸ **run**(`units`): `Promise`<[`VoxelBoxWorkCost`](../#voxelboxworkcost)\>

Queues `units`, resolving once they have all run.

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | () => `void`[] |

#### Returns

`Promise`<[`VoxelBoxWorkCost`](../#voxelboxworkcost)\>
