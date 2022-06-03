---
id: "Entities"
title: "Class: Entities"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Map`<`string`, [`BaseEntity`](BaseEntity.md)\>

  ↳ **`Entities`**

## Properties

### params

• **params**: [`EntitiesParams`](../modules.md#entitiesparams-126)

___

### knownTypes

• **knownTypes**: `Map`<`string`, [`NewEntity`](../modules.md#newentity-126)\>

___

### client

• **client**: [`Client`](Client.md)

___

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

___

### [toStringTag]

• `Readonly` **[toStringTag]**: `string`

#### Inherited from

Map.\_\_@toStringTag@10001

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@10520

## Constructors

### constructor

• **new Entities**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`EntitiesParams`](../modules.md#entitiesparams-126)\> |

#### Overrides

Map&lt;string, BaseEntity\&gt;.constructor

## Methods

### onEvent

▸ **onEvent**(`__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `any` |

#### Returns

`void`

___

### registerEntity

▸ **registerEntity**(`type`, `protocol`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `protocol` | [`NewEntity`](../modules.md#newentity-126) |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`

___

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
| `callbackfn` | (`value`: [`BaseEntity`](BaseEntity.md), `key`: `string`, `map`: `Map`<`string`, [`BaseEntity`](BaseEntity.md)\>) => `void` |
| `thisArg?` | `any` |

#### Returns

`void`

#### Inherited from

Map.forEach

___

### get

▸ **get**(`key`): [`BaseEntity`](BaseEntity.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

[`BaseEntity`](BaseEntity.md)

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

▸ **set**(`key`, `value`): [`Entities`](Entities.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | [`BaseEntity`](BaseEntity.md) |

#### Returns

[`Entities`](Entities.md)

#### Inherited from

Map.set

___

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`BaseEntity`](BaseEntity.md)]\>

Returns an iterable of entries in the map.

#### Returns

`IterableIterator`<[`string`, [`BaseEntity`](BaseEntity.md)]\>

#### Inherited from

Map.\_\_@iterator@10005

___

### entries

▸ **entries**(): `IterableIterator`<[`string`, [`BaseEntity`](BaseEntity.md)]\>

Returns an iterable of key, value pairs for every entry in the map.

#### Returns

`IterableIterator`<[`string`, [`BaseEntity`](BaseEntity.md)]\>

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

▸ **values**(): `IterableIterator`<[`BaseEntity`](BaseEntity.md)\>

Returns an iterable of values in the map

#### Returns

`IterableIterator`<[`BaseEntity`](BaseEntity.md)\>

#### Inherited from

Map.values
