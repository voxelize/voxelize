---
id: "System"
title: "Class: System"
sidebar_label: "System"
sidebar_position: 0
custom_edit_url: null
---

Represents the logic that transforms component data of an entity from its current state to its next state. A system
runs on entities that have a specific set of component types.

## Properties

### sysId

• `Readonly` **sysId**: `number`

Unique identifier of an instance of this system

___

### frequence

• **frequence**: `number`

The maximum times per second this system should be updated

## Methods

### beforeUpdateAll

▸ `Optional` **beforeUpdateAll**(`time`): `void`

Invoked before updating entities available for this system. It is only invoked when there are entities with the
characteristics expected by this system.

#### Parameters

| Name | Type |
| :------ | :------ |
| `time` | `number` |

#### Returns

`void`

___

### update

▸ `Optional` **update**(`entity`, `time`, `delta`): `void`

Invoked in updates, limited to the value set in the "frequency" attribute

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |
| `time` | `number` |
| `delta` | `number` |

#### Returns

`void`

___

### afterUpdateAll

▸ `Optional` **afterUpdateAll**(`time`, `entities`): `void`

Invoked after performing update of entities available for this system. It is only invoked when there are entities
with the characteristics expected by this system.

#### Parameters

| Name | Type |
| :------ | :------ |
| `time` | `number` |
| `entities` | [`Entity`](Entity.md)[] |

#### Returns

`void`

___

### change

▸ `Optional` **change**(`entity`, `added?`, `removed?`): `void`

Invoked when an expected feature of this system is added or removed from the entity

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |
| `added?` | [`Component`](Component.md)<`any`\> |
| `removed?` | [`Component`](Component.md)<`any`\> |

#### Returns

`void`

___

### enter

▸ `Optional` **enter**(`entity`): `void`

Invoked when:
a) An entity with the characteristics (components) expected by this system is added in the world;
b) This system is added in the world and this world has one or more entities with the characteristics expected by
this system;
c) An existing entity in the same world receives a new component at runtime and all of its new components match
the standard expected by this system.

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |

#### Returns

`void`

___

### exit

▸ `Optional` **exit**(`entity`): `void`

Invoked when:
a) An entity with the characteristics (components) expected by this system is removed from the world;
b) This system is removed from the world and this world has one or more entities with the characteristics
expected by this system;
c) An existing entity in the same world loses a component at runtime and its new component set no longer matches
the standard expected by this system

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |

#### Returns

`void`

## Constructors

### constructor

• **new System**(`componentTypes`, `frequence?`)

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `componentTypes` | `number`[] | `undefined` | IDs of the types of components this system expects the entity to have before it can act on. If you want to create a system that acts on all entities, enter [-1] |
| `frequence` | `number` | `0` | The maximum times per second this system should be updated. Defaults 0 |
