---
id: "BaseEntity"
title: "Class: BaseEntity"
sidebar_label: "BaseEntity"
sidebar_position: 0
custom_edit_url: null
---

The base class of an entity in the ECS on the client-side. Entities are all
server based, meaning that other than the entity `mesh` field, mutating values
within does not affect the actual entities living on the server.

## Hierarchy

- [`Entity`](Entity.md)

  ↳ **`BaseEntity`**

## Properties

### id

• **id**: `string`

The ID of the entity, used for data syncing.

___

### type

• **type**: `string`

The type of the entity, used to differentiate entities.

___

### LERP\_FACTOR

▪ `Static` **LERP\_FACTOR**: `number` = `1`

The **shared** interpolation factor of all entities.

___

### onCreation

• `Optional` **onCreation**: (`client`: [`Client`](Client.md)) => `void`

#### Type declaration

▸ (`client`): `void`

If implemented, gets called when a new entity of this type is created.

##### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

##### Returns

`void`

___

### onDeletion

• `Optional` **onDeletion**: (`client`: [`Client`](Client.md)) => `void`

#### Type declaration

▸ (`client`): `void`

If implemented, gets called when a new entity of this type is deleted.

##### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

##### Returns

`void`

## Constructors

### constructor

• **new BaseEntity**()

Construct a new entity with some preset ECS components:
- [EntityFlag](../modules.md#entityflag)
- [MeshComponent](../modules.md#meshcomponent)
- [Position3DComponent](../modules.md#position3dcomponent)
- [HeadingComponent](../modules.md#headingcomponent)
- [TargetComponent](../modules.md#targetcomponent)
- [MetadataComponent](../modules.md#metadatacomponent)

#### Overrides

[Entity](Entity.md).[constructor](Entity.md#constructor)

## Accessors

### mesh

• `get` **mesh**(): `Object3D`<`Event`\>

Get the position of the entity.

#### Returns

`Object3D`<`Event`\>

• `set` **mesh**(`mesh`): `void`

Set the position of the entity.

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Object3D`<`Event`\> |

#### Returns

`void`
