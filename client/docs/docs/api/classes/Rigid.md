---
id: "Rigid"
title: "Class: Rigid"
sidebar_label: "Rigid"
sidebar_position: 0
custom_edit_url: null
---

A rigid behavior makes the particle act like a rigid body in the voxel physics engine.

## Hierarchy

- `"three-nebula"`

  ↳ **`Rigid`**

## Properties

### size

• **size**: `number`

The size of the rigid particle.

___

### impulse

• **impulse**: `number`

The initial impulse of the rigid particle, which goes in a random direction with this impulse as
the magnitude of impulse.

___

### engine

• **engine**: `Engine`

A reference to the physics engine of the world for update purposes.

## Constructors

### constructor

• **new Rigid**(`size`, `impulse`, `engine`, `life?`, `easing?`, `isEnabled?`)

Creates a new rigid behavior.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `size` | `number` | `undefined` | The size of the rigid particle. |
| `impulse` | `number` | `undefined` | The initial impulse of the rigid particle. |
| `engine` | `Engine` | `undefined` | A reference to the physics engine of the world for update purposes. |
| `life?` | `unknown` | `undefined` | The life of the particle. |
| `easing?` | `unknown` | `undefined` | The easing function of the particle. |
| `isEnabled` | `boolean` | `true` | Whether the behavior is enabled. |

#### Overrides

Behaviour.constructor

## Methods

### initialize

▸ **initialize**(`particle`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `particle` | `any` |

#### Returns

`void`

___

### mutate

▸ **mutate**(`particle`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `particle` | `any` |

#### Returns

`void`
