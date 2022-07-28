[@voxelize/client](../README.md) / [Exports](../modules.md) / Events

# Class: Events

## Hierarchy

- `Map`<`string`, [`EventHandler`](../modules.md#eventhandler)\>

  ↳ **`Events`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Table of contents

### Constructors

- [constructor](Events.md#constructor)

### Properties

- [[toStringTag]](Events.md#[tostringtag])
- [size](Events.md#size)
- [[species]](Events.md#[species])

### Methods

- [[iterator]](Events.md#[iterator])
- [addEventListener](Events.md#addeventlistener)
- [clear](Events.md#clear)
- [delete](Events.md#delete)
- [entries](Events.md#entries)
- [forEach](Events.md#foreach)
- [get](Events.md#get)
- [has](Events.md#has)
- [keys](Events.md#keys)
- [on](Events.md#on)
- [onMessage](Events.md#onmessage)
- [set](Events.md#set)
- [values](Events.md#values)

## Constructors

### constructor

• **new Events**(`entries?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `entries?` | readonly readonly [`string`, [`EventHandler`](../modules.md#eventhandler)][] |

#### Inherited from

Map<string, EventHandler\>.constructor

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:33

• **new Events**(`iterable?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `iterable?` | `Iterable`<readonly [`string`, [`EventHandler`](../modules.md#eventhandler)]\> |

#### Inherited from

Map<string, EventHandler\>.constructor

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

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:28

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@133

#### Defined in

node_modules/typescript/lib/lib.es2015.symbol.wellknown.d.ts:317

## Methods

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

#### Returns

`IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

#### Inherited from

Map.\_\_@iterator@91

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:121

___

### addEventListener

▸ **addEventListener**(`name`, `handler`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |
| `handler` | [`EventHandler`](../modules.md#eventhandler) |  |

#### Returns

`void`

#### Defined in

[client/src/core/events.ts:51](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/events.ts#L51)

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

▸ **entries**(): `IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

#### Returns

`IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

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
| `callbackfn` | (`value`: [`EventHandler`](../modules.md#eventhandler), `key`: `string`, `map`: `Map`<`string`, [`EventHandler`](../modules.md#eventhandler)\>) => `void` |
| `thisArg?` | `any` |

#### Returns

`void`

#### Inherited from

Map.forEach

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:24

___

### get

▸ **get**(`key`): [`EventHandler`](../modules.md#eventhandler)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`EventHandler`](../modules.md#eventhandler)

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

### on

▸ **on**(`name`, `handler`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |
| `handler` | [`EventHandler`](../modules.md#eventhandler) |  |

#### Returns

`void`

#### Defined in

[client/src/core/events.ts:62](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/events.ts#L62)

___

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

#### Defined in

[client/src/core/events.ts:30](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/events.ts#L30)

___

### set

▸ **set**(`key`, `value`): [`Events`](Events.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`EventHandler`](../modules.md#eventhandler) |

#### Returns

[`Events`](Events.md)

#### Inherited from

Map.set

#### Defined in

node_modules/typescript/lib/lib.es2015.collection.d.ts:27

___

### values

▸ **values**(): `IterableIterator`<[`EventHandler`](../modules.md#eventhandler)\>

#### Returns

`IterableIterator`<[`EventHandler`](../modules.md#eventhandler)\>

#### Inherited from

Map.values

#### Defined in

node_modules/typescript/lib/lib.es2015.iterable.d.ts:136
