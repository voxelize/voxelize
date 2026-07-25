---
id: "Entities"
title: "Class: Entities"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

A network interceptor that can be used to handle `ENTITY` messages. This is useful
for creating custom entities that can be sent over the network.

TODO-DOCS

# Example
```ts
const entities = new VOXELIZE.Entities();

// Define an entity type.
class MyEntity extends VOXELIZE.Entity<{ position: VOXELIZE.Coords3 }> {
  onUpdate = (data) => {
    // Do something with `data.position`.
  };
}

// Register the entity type.
entities.setClass("my-entity", MyEntity);

// Register the interceptor with the network.
network.register(entities);
```

## Hierarchy

- `Group`

  ↳ **`Entities`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Entities**(`options?`): [`Entities`](Entities.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`EntitiesOptions`](../modules.md#entitiesoptions)\> |

#### Returns

[`Entities`](Entities.md)

#### Overrides

Group.constructor

## Properties

### map

• **map**: `Map`\<`string`, [`Entity`](Entity.md)\<`any`\>\>

___

### options

• **options**: [`EntitiesOptions`](../modules.md#entitiesoptions)

___

### types

• **types**: `Map`\<`string`, (`id`: `string`) => [`Entity`](Entity.md)\<`any`\> \| (`id`: `string`) => [`Entity`](Entity.md)\<`any`\>\>

## Methods

### getEntityById

▸ **getEntityById**(`id`): [`Entity`](Entity.md)\<`any`\>

Get an entity instance by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | The ID of the entity to get. |

#### Returns

[`Entity`](Entity.md)\<`any`\>

The entity object with the given ID.

___

### setClass

▸ **setClass**(`type`, `entity`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `entity` | (`id`: `string`) => [`Entity`](Entity.md)\<`any`\> \| (`id`: `string`) => [`Entity`](Entity.md)\<`any`\> |

#### Returns

`void`

___

### snapAllToTarget

▸ **snapAllToTarget**(): `void`

#### Returns

`void`

___

### update

▸ **update**(`cameraPos?`, `renderDistance?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cameraPos?` | `Vector3` |
| `renderDistance?` | `number` |

#### Returns

`void`
