---
id: "ECS"
title: "Class: ECS"
sidebar_label: "ECS"
sidebar_position: 0
custom_edit_url: null
---

The very definition of the ECS. Also called Admin or Manager in other implementations.

## Properties

### System

▪ `Static` **System**: typeof [`System`](System.md) = `System`

___

### Entity

▪ `Static` **Entity**: typeof [`Entity`](Entity.md) = `Entity`

___

### Component

▪ `Static` **Component**: typeof [`Component`](Component.md) = `Component`

___

### timeScale

• **timeScale**: `number` = `1`

Allows you to apply slow motion effect on systems execution. When timeScale is 1, the timestamp and delta
parameters received by the systems are consistent with the actual timestamp. When timeScale is 0.5, the values
received by systems will be half of the actual value.

ATTENTION! The systems continue to be invoked obeying their normal frequencies, what changes is only the values
received in the timestamp and delta parameters.

## Constructors

### constructor

• **new ECS**(`systems?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `systems?` | [`System`](System.md)[] |

## Methods

### destroy

▸ **destroy**(): `void`

Remove all entities and systems

#### Returns

`void`

___

### getEntity

▸ **getEntity**(`entId`): [`Entity`](Entity.md)

Get an entity by id

#### Parameters

| Name | Type |
| :------ | :------ |
| `entId` | `number` |

#### Returns

[`Entity`](Entity.md)

___

### addEntity

▸ **addEntity**(`entity`): `void`

Add an entity to this world

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |

#### Returns

`void`

___

### removeEntity

▸ **removeEntity**(`idOrInstance`): `void`

Remove an entity from this world

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrInstance` | `number` \| [`Entity`](Entity.md) |

#### Returns

`void`

___

### addSystem

▸ **addSystem**(`system`): `void`

Add a system in this world

#### Parameters

| Name | Type |
| :------ | :------ |
| `system` | [`System`](System.md) |

#### Returns

`void`

___

### removeSystem

▸ **removeSystem**(`system`): `void`

Remove a system from this world

#### Parameters

| Name | Type |
| :------ | :------ |
| `system` | [`System`](System.md) |

#### Returns

`void`

___

### query

▸ **query**(`componentTypes`): `Iterator`<[`Entity`](Entity.md)\>

Allows you to search for all entities that have a specific set of components.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `componentTypes` | `number`[] | Enter [-1] to list all entities |

#### Returns

`Iterator`<[`Entity`](Entity.md)\>

___

### update

▸ **update**(): `void`

Invokes the "update" method of the systems in this world.

#### Returns

`void`
