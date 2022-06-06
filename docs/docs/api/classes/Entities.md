---
id: "Entities"
title: "Class: Entities"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** map representing living entities on the server.

## Hierarchy

- `Map`<`string`, [`BaseEntity`](BaseEntity.md)\>

  ↳ **`Entities`**

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`EntitiesParams`](../modules.md#entitiesparams)

Parameters to customize the Voxelize entities.

## Methods

### registerEntity

▸ **registerEntity**(`type`, `protocol`): `void`

Register a new entity to be rendered.

Example: Register a plain entity called `Test`.
```ts
class TestEntity extends BaseEntity {}

client.entities.registerEntity("Test", TestEntity);
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `string` | The name of the type of the new entity. |
| `protocol` | [`NewEntity`](../modules.md#newentity) | The class protocol to create a new entity. |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

Reset the entities map.

**`internal`**

#### Returns

`void`
