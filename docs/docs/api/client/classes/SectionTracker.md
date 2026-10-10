---
id: "SectionTracker"
title: "Class: SectionTracker"
sidebar_label: "SectionTracker"
sidebar_position: 0
custom_edit_url: null
---

Owns the static (block-anchored) side of the light registry: which
emitters exist per chunk section, individually or aggregated into proxy
records for dense fields like lava. Rescans are whole-section and diff
against what is registered, so an untouched emitter keeps its handle —
and with it its selection hysteresis — across neighboring edits.

## Constructors

### constructor

• **new SectionTracker**(`registry`, `chunkSize`, `maxHeight`, `subChunks`): [`SectionTracker`](SectionTracker.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `registry` | [`LightSourceRegistry`](LightSourceRegistry.md) |
| `chunkSize` | `number` |
| `maxHeight` | `number` |
| `subChunks` | `number` |

#### Returns

[`SectionTracker`](SectionTracker.md)

## Accessors

### trackedSectionCount

• `get` **trackedSectionCount**(): `number`

#### Returns

`number`

## Methods

### releaseAll

▸ **releaseAll**(): `void`

#### Returns

`void`

___

### releaseSection

▸ **releaseSection**(`key`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`void`

___

### rescanSection

▸ **rescanSection**(`key`, `chunk`, `sectionY`, `table`): `void`

Scan one section of a loaded chunk and reconcile the registry with what
is actually there. Safe to call for load, edit, and re-load alike.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `chunk` | [`ScannableChunk`](../interfaces/ScannableChunk.md) |
| `sectionY` | `number` |
| `table` | [`BlockProfileTable`](BlockProfileTable.md) |

#### Returns

`void`

___

### sectionKey

▸ **sectionKey**(`cx`, `cz`, `sectionY`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `sectionY` | `number` |

#### Returns

`string`

___

### trackedSections

▸ **trackedSections**(): `IterableIterator`<`string`, `any`, `any`\>

#### Returns

`IterableIterator`<`string`, `any`, `any`\>
