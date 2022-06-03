---
id: "Iterator"
title: "Class: Iterator<T>"
sidebar_label: "Iterator"
sidebar_position: 0
custom_edit_url: null
---

Utility class for asynchronous access to a list

## Type parameters

| Name |
| :------ |
| `T` |

## Constructors

### constructor

• **new Iterator**<`T`\>(`next`)

#### Type parameters

| Name |
| :------ |
| `T` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `next` | (`i`: `number`) => `void` \| `T` |

## Methods

### each

▸ **each**(`cb`): `void`

Allows iterate across all items

#### Parameters

| Name | Type |
| :------ | :------ |
| `cb` | (`item`: `T`) => `boolean` \| `void` |

#### Returns

`void`

___

### find

▸ **find**(`test`): `T`

returns the value of the first element that satisfies the provided testing function.

#### Parameters

| Name | Type |
| :------ | :------ |
| `test` | (`item`: `T`) => `boolean` |

#### Returns

`T`

___

### filter

▸ **filter**(`test`): `T`[]

creates a array with all elements that pass the test implemented by the provided function.

#### Parameters

| Name | Type |
| :------ | :------ |
| `test` | (`item`: `T`) => `boolean` |

#### Returns

`T`[]

___

### map

▸ **map**<`P`\>(`cb`): `P`[]

creates a new array with the results of calling a provided function on every element in this iterator.

#### Type parameters

| Name |
| :------ |
| `P` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `cb` | (`item`: `T`) => `P` |

#### Returns

`P`[]
