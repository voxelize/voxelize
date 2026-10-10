---
id: "BlockProfileTable"
title: "Class: BlockProfileTable"
sidebar_label: "BlockProfileTable"
sidebar_position: 0
custom_edit_url: null
---

Per-block-id lookup the scan hot loop runs against: a byte LUT for the
"is this an emitter" test and a resolved profile for everything after.
Rebuilt only when the block registry or a declared profile changes.

## Constructors

### constructor

• **new BlockProfileTable**(`blocks`, `declared`, `maxLightLevel`): [`BlockProfileTable`](BlockProfileTable.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `blocks` | `Iterable`<[`EmitterBlock`](../interfaces/EmitterBlock.md), `any`, `any`\> |
| `declared` | `Map`<`number`, [`BlockLightProfile`](../interfaces/BlockLightProfile.md)\> |
| `maxLightLevel` | `number` |

#### Returns

[`BlockProfileTable`](BlockProfileTable.md)

## Properties

### isLightById

• `Readonly` **isLightById**: `Uint8Array`<`ArrayBufferLike`\>

___

### version

• `Readonly` **version**: `number`

Which build of the table this is. A section scanned under an older
version must treat every registered emitter as stale even when its
voxel signature is unchanged — the profile *behind* the signature
changed, and the registered descriptor is a copy of the old one. This
is what makes `setBlockProfile` timing-independent: declared before,
during, or after chunk streaming, live emitters converge on the
declared profile through the ordinary rescan queue.

## Methods

### profileFor

▸ **profileFor**(`id`): `ResolvedProfile`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`ResolvedProfile`
