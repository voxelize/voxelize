---
id: "Events"
title: "Class: Events"
sidebar_label: "Events"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** manager for the events sent from the Voxelize server. Keep in
mind that one event can only have one listener!

## Hierarchy

- `Map`<`string`, [`EventHandler`](../modules.md#eventhandler)\>

  ↳ **`Events`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

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
| `callbackfn` | (`value`: [`EventHandler`](../modules.md#eventhandler), `key`: `string`, `map`: `Map`<`string`, [`EventHandler`](../modules.md#eventhandler)\>) => `void` |
| `thisArg?` | `any` |

#### Returns

`void`

#### Inherited from

Map.forEach

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

___

### [iterator]

▸ **[iterator]**(): `IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

Returns an iterable of entries in the map.

#### Returns

`IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

#### Inherited from

Map.\_\_@iterator@7804

___

### entries

▸ **entries**(): `IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

Returns an iterable of key, value pairs for every entry in the map.

#### Returns

`IterableIterator`<[`string`, [`EventHandler`](../modules.md#eventhandler)]\>

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

▸ **values**(): `IterableIterator`<[`EventHandler`](../modules.md#eventhandler)\>

Returns an iterable of values in the map

#### Returns

`IterableIterator`<[`EventHandler`](../modules.md#eventhandler)\>

#### Inherited from

Map.values

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

___

### addEventListener

▸ **addEventListener**(`name`, `handler`): `void`

Synonym for [on](Events.md#on), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler) | What to do when this event is received? |

#### Returns

`void`

___

### on

▸ **on**(`name`, `handler`): `void`

Synonym for [addEventListener](Events.md#addeventlistener), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler) | What to do when this event is received? |

#### Returns

`void`

## Properties

### size

• `Readonly` **size**: `number`

#### Inherited from

Map.size

___

### [toStringTag]

• `Readonly` **[toStringTag]**: `string`

#### Inherited from

Map.\_\_@toStringTag@7853

___

### [species]

▪ `Static` `Readonly` **[species]**: `MapConstructor`

#### Inherited from

Map.\_\_@species@7846

## Constructors

### constructor

• **new Events**(`entries?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `entries?` | readonly readonly [`string`, [`EventHandler`](../modules.md#eventhandler)][] |

#### Inherited from

Map<string, EventHandler\>.constructor

• **new Events**(`iterable?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `iterable?` | `Iterable`<readonly [`string`, [`EventHandler`](../modules.md#eventhandler)]\> |

#### Inherited from

Map<string, EventHandler\>.constructor