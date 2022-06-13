---
id: "Physics"
title: "Class: Physics"
sidebar_label: "Physics"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** physics engine for Voxelize using [@voxelize/voxel-physics-engine](https://github.com/shaoruu/voxel-physics-engine).

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### core

• **core**: `Engine`

The core physics engine.

## Methods

### addBody

▸ **addBody**(`options`): `RigidBody`

Add a physical body to the Voxelize client-side world.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Partial`<`BodyOptions`\> | Options for adding a new physical rigid body. |

#### Returns

`RigidBody`

___

### removeBody

▸ **removeBody**(`body`): `void`

Remove a rigid body from the Voxelize client-side world.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `body` | `RigidBody` | The rigid body to remove. |

#### Returns

`void`

## Accessors

### bodies

• `get` **bodies**(): `RigidBody`[]

A list of rigid bodies in this physics engine.

#### Returns

`RigidBody`[]
