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

• **new Entity**<`T`\>(`id`): [`Entity`](Entity.md)<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Overrides

Group.constructor

## Properties

### entId

• **entId**: `string`

___

### entType

• **entType**: `string` = `""`

___

### metadata

• **metadata**: `T` = `null`

___

### onCreate

• **onCreate**: (`data`: `T`) => `void`

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

### setHidden

• `Optional` **setHidden**: (`hidden`: `boolean`) => `void`

#### Type declaration

▸ (`hidden`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `hidden` | `boolean` |

##### Returns

`void`

___

### snapToTarget

• `Optional` **snapToTarget**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### update

• `Optional` **update**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### updateFrozen

• `Optional` **updateFrozen**: () => `void`

Called each frame in place of `update` while the server holds the
entity frozen. The pose holds, but state that belongs to the world
rather than the pose — the voxel light an instance is shaded with —
should keep tracking it, or a creature frozen at dusk stays lit as
it was when it froze (or as the pool's default, if it streamed in
frozen).

#### Type declaration

▸ (): `void`

##### Returns

`void`
