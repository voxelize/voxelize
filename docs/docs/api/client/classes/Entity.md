---
id: "Entity"
title: "Class: Entity<T>"
sidebar_label: "Entity"
sidebar_position: 0
custom_edit_url: null
---

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Hierarchy

- `Group`

  ↳ **`Entity`**

## Constructors

### constructor

• **new Entity**\<`T`\>(`id`): [`Entity`](Entity.md)\<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

[`Entity`](Entity.md)\<`T`\>

#### Overrides

Group.constructor

## Properties

### entId

• **entId**: `string`

___

### onCreate

• **onCreate**: (`data`: `T`) => `void`

Called when the entity is created.

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### onDelete

• **onDelete**: (`data`: `T`) => `void`

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### onUpdate

• **onUpdate**: (`data`: `T`) => `void`

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### update

• `Optional` **update**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`
