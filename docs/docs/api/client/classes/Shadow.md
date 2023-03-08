---
id: "Shadow"
title: "Class: Shadow"
sidebar_label: "Shadow"
sidebar_position: 0
custom_edit_url: null
---

A shadow that is just a circle underneath an object that scales smaller with distance. Shadows ignore fluids.

## Hierarchy

- `Mesh`

  ↳ **`Shadow`**

## Properties

### GEOMETRY

▪ `Static` `Readonly` **GEOMETRY**: `CircleGeometry`

The shared geometry for all shadows.

___

### MATERIAL

▪ `Static` `Readonly` **MATERIAL**: `MeshBasicMaterial`

The shared material for all shadows.

___

### Y\_OFFSET

▪ `Static` `Readonly` **Y\_OFFSET**: ``0.01``

The y-offset of the shadow from the ground.

___

### params

• **params**: [`ShadowParams`](../modules.md#shadowparams-4)

The parameters of the shadow.

___

### world

• **world**: [`World`](World.md)

The world to cast shadows in.

## Constructors

### constructor

• **new Shadow**(`world`, `params?`)

Create a shadow instance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `world` | [`World`](World.md) | The world to cast shadows in. |
| `params` | `Partial`<[`ShadowParams`](../modules.md#shadowparams-4)\> | The parameters of the shadow. |

#### Overrides

Mesh.constructor

## Methods

### update

▸ **update**(): `void`

This raycasts from the shadow's parent to the ground and determines the shadow's scale by the distance.

#### Returns

`void`
