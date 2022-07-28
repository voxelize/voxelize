[@voxelize/client](../README.md) / [Exports](../modules.md) / Chunks

# Class: Chunks

## Hierarchy

- `Map`<`string`, [`Chunk`](Chunk.md)\>

  ↳ **`Chunks`**

## Table of contents

### Constructors

- [constructor](Chunks.md#constructor)

### Properties

- [[toStringTag]](Chunks.md#[tostringtag])
- [currentChunk](Chunks.md#currentchunk)
- [requested](Chunks.md#requested)
- [size](Chunks.md#size)
- [toAdd](Chunks.md#toadd)
- [toProcess](Chunks.md#toprocess)
- [toRequest](Chunks.md#torequest)
- [toUpdate](Chunks.md#toupdate)
- [[species]](Chunks.md#[species])

### Methods

- [[iterator]](Chunks.md#[iterator])
- [clear](Chunks.md#clear)
- [delete](Chunks.md#delete)
- [entries](Chunks.md#entries)
- [forEach](Chunks.md#foreach)
- [get](Chunks.md#get)
- [has](Chunks.md#has)
- [keys](Chunks.md#keys)
- [set](Chunks.md#set)
- [values](Chunks.md#values)

## Constructors

### constructor

• **new Chunks**(`entries?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `entries?` | readonly readonly [`string`, [`Chunk`](Chunk.md)][] |

#### Inherited from

Map<string, Chunk\>.constructor

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:33

• **new Chunks**(`iterable?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `iterable?` | `Iterable`<readonly [`string`, [`Chunk`](Chunk.md)]\> |

#### Inherited from

Map<string, Chunk\>.constructor

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:161

## Properties

### [toStringTag]

• `Readonly` **[toStringTag]**: `string`

#### Inherited from

Map.\_\_@toStringTag@140

#### Defined in

node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts:135

___

### currentChunk

• **currentChunk**: [`Coords2`](../modules.md#coords2)

#### Defined in

[client/src/core/world/chunks.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L15)

___

### requested

• **requested**: `Set`<`string`\>

#### Defined in

[client/src/core/world/chunks.ts:9](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L9)

___

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:28

___

### toAdd

• **toAdd**: `string`[] = `[]`

#### Defined in

[client/src/core/world/chunks.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L13)

___

### toProcess

• **toProcess**: `ChunkProtocol`[] = `[]`

#### Defined in

[client/src/core/world/chunks.ts:11](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L11)

___

### toRequest

• **toRequest**: `string`[] = `[]`

#### Defined in

[client/src/core/world/chunks.ts:10](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L10)

___

### toUpdate

• **toUpdate**: [`BlockUpdate`](../modules.md#blockupdate)[] = `[]`

#### Defined in

[client/src/core/world/chunks.ts:12](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/chunks.ts#L12)

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@133

#### Defined in

node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts:317

## Methods

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Returns

`IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Inherited from

Map.\_\_@iterator@91

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:121

___

### clear

▸ **clear**(): `void`

#### Returns

`void`

#### Inherited from

Map.clear

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:22

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

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:23

___

### entries

▸ **entries**(): `IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Returns

`IterableIterator`<[`string`, [`Chunk`](Chunk.md)]\>

#### Inherited from

Map.entries

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:126

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

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:24

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

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:25

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

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:26

___

### keys

▸ **keys**(): `IterableIterator`<`string`\>

#### Returns

`IterableIterator`<`string`\>

#### Inherited from

Map.keys

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:131

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

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:27

___

### values

▸ **values**(): `IterableIterator`<[`Chunk`](Chunk.md)\>

#### Returns

`IterableIterator`<[`Chunk`](Chunk.md)\>

#### Inherited from

Map.values

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:136
