---
id: "Chunks"
title: "Class: Chunks"
sidebar_label: "Chunks"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Map`<`string`, [`Chunk`](Chunk.md)\>

  ↳ **`Chunks`**

## Methods

### clear

▸ **clear**(): `void`

#### Returns

`void`

#### Inherited from

Map.clear

___

### delete

▸ **delete**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Inherited from

Map.delete

___

### forEach

▸ **forEach**(`callbackfn`, `thisArg?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callbackfn` | (`value`: [`Chunk`](Chunk.md), `key`: `string`, `map`: `Map`<`string`, [`Chunk`](Chunk.md)\>) => `void` |
| `thisArg?` | `any` |

#### Returns

`void`

#### Inherited from

Map.forEach

___

### get

▸ **get**(`key`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`Chunk`](Chunk.md)

#### Inherited from

Map.get

___

### has

▸ **has**(`key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`boolean`

#### Inherited from

Map.has

___

### set

▸ **set**(`key`, `value`): [`Chunks`](Chunks.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`Chunk`](Chunk.md) |

#### Returns

[`Chunks`](Chunks.md)

#### Inherited from

Map.set

___

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

Returns an iterable of entries in the map.

#### Returns

`IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Inherited from

Map.\_\_@iterator@11649

___

### entries

▸ **entries**(): `IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

Returns an iterable of key, value pairs for every entry in the map.

#### Returns

`IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Inherited from

Map.entries

___

### keys

▸ **keys**(): `IterableIterator`<`string`\>

Returns an iterable of keys in the map

#### Returns

`IterableIterator`<`string`\>

#### Inherited from

Map.keys

___

### values

▸ **values**(): `IterableIterator`<[`Chunk`](Chunk.md)\>

Returns an iterable of values in the map

#### Returns

`IterableIterator`<[`Chunk`](Chunk.md)\>

#### Inherited from

Map.values

## Properties

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

___

### [toStringTag]

• `Readonly` **[toStringTag]**: `string`

#### Inherited from

Map.\_\_@toStringTag@12176

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@12158

___

### requested

• **requested**: `Map`<`string`, `number`\>

___

### toRequest

• **toRequest**: `string`[] = `[]`

___

### toProcess

• **toProcess**: [`ChunkProtocol`, `number`][] = `[]`

___

### toUpdate

• **toUpdate**: [`BlockUpdate`](../modules.md#blockupdate-74)[] = `[]`

___

### toAdd

• **toAdd**: `string`[] = `[]`

___

### currentChunk

• **currentChunk**: [`Coords2`](../modules.md#coords2-74)

## Constructors

### constructor

• **new Chunks**(`entries?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `entries?` | readonly readonly [`string`, [`Chunk`](Chunk.md)][] |

#### Inherited from

Map<string, Chunk\>.constructor

• **new Chunks**(`iterable?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `iterable?` | `Iterable`<readonly [`string`, [`Chunk`](Chunk.md)]\> |

#### Inherited from

Map<string, Chunk\>.constructor
