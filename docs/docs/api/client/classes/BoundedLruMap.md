---
id: "BoundedLruMap"
title: "Class: BoundedLruMap<K, V>"
sidebar_label: "BoundedLruMap"
sidebar_position: 0
custom_edit_url: null
---

A `Map` that forgets its least-recently-used entry once it is full.

Caches keyed by voxel, chunk or block coordinate are the most common way a
renderer grows without bound: the key space is effectively infinite over a
session, so a plain `Map` retains one entry per coordinate the player ever
touched. Reaching for this instead makes the bound explicit and gives the
cache a capacity that lives in an option field.

## Type parameters

| Name |
| :------ |
| `K` |
| `V` |

## Constructors

### constructor

• **new BoundedLruMap**\<`K`, `V`\>(`capacity`): [`BoundedLruMap`](BoundedLruMap.md)\<`K`, `V`\>

#### Type parameters

| Name |
| :------ |
| `K` |
| `V` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `capacity` | `number` | Entries retained before the least-recently-used one is evicted. A capacity below one disables the cache entirely. |

#### Returns

[`BoundedLruMap`](BoundedLruMap.md)\<`K`, `V`\>

## Properties

### capacity

• `Readonly` **capacity**: `number`

Entries retained before the least-recently-used one is
evicted. A capacity below one disables the cache entirely.

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

### delete

▸ **delete**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `K` |

#### Returns

`boolean`

___

### get

▸ **get**(`key`): `V`

Read an entry and mark it most-recently-used.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `K` |

#### Returns

`V`

___

### has

▸ **has**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `K` |

#### Returns

`boolean`

___

### peek

▸ **peek**(`key`): `V`

Read an entry without affecting eviction order.

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `K` |

#### Returns

`V`

___

### set

▸ **set**(`key`, `value`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `K` |
| `value` | `V` |

#### Returns

`void`

___

### values

▸ **values**(): `IterableIterator`\<`V`, `any`, `any`\>

Entries from least- to most-recently-used.

#### Returns

`IterableIterator`\<`V`, `any`, `any`\>
