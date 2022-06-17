---
id: "Entity"
title: "Class: Entity"
sidebar_label: "Entity"
sidebar_position: 0
custom_edit_url: null
---

Representation of an entity in ECS

## Hierarchy

- **`Entity`**

  ↳ [`BaseEntity`](BaseEntity.md)

## Properties

### entId

• **entId**: `number`

___

### active

• **active**: `boolean` = `true`

Informs if the entity is active

## Constructors

### constructor

• **new Entity**()

## Methods

### subscribe

▸ **subscribe**(`handler`): () => [`Entity`](Entity.md)

Allows interested parties to receive information when this entity's component list is updated

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`Susbcription`](../modules.md#susbcription-48) |

#### Returns

`fn`

▸ (): [`Entity`](Entity.md)

Allows interested parties to receive information when this entity's component list is updated

##### Returns

[`Entity`](Entity.md)

___

### add

▸ **add**(`component`): `void`

Add a component to this entity

#### Parameters

| Name | Type |
| :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |

#### Returns

`void`

___

### remove

▸ **remove**(`component`): `void`

Removes a component's reference from this entity

#### Parameters

| Name | Type |
| :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |

#### Returns

`void`
