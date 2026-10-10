---
id: "StaticGroup"
title: "Class: StaticGroup"
sidebar_label: "StaticGroup"
sidebar_position: 0
custom_edit_url: null
---

A container whose contents never move once they are in it. It skips the
per-frame world-matrix walk of its own subtree, and only walks it when
something has been added — which is what [StaticGroup.updateMatrixWorld](StaticGroup.md#updatematrixworld)
with `force` means here.

A chunk holds one of these because a loaded disc is thousands of meshes at
fixed positions, and three.js has no way to say "this branch is settled": the
renderer walks every node of the scene every frame regardless.

## Hierarchy

- `Group`

  ↳ **`StaticGroup`**

## Constructors

### constructor

• **new StaticGroup**(): [`StaticGroup`](StaticGroup.md)

Creates a new Group.

#### Returns

[`StaticGroup`](StaticGroup.md)

#### Inherited from

Group.constructor

## Methods

### markMatrixDirty

▸ **markMatrixDirty**(): `void`

Re-arms the subtree walk after geometry is added or repositioned.

#### Returns

`void`

___

### updateMatrixWorld

▸ **updateMatrixWorld**(`force?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `force?` | `boolean` |

#### Returns

`void`

#### Overrides

Group.updateMatrixWorld
