---
id: "Shadows"
title: "Class: Shadows"
sidebar_label: "Shadows"
sidebar_position: 0
custom_edit_url: null
---

A manager for all shadows in the world. Shadows should be updated every frame.

# Example
```ts
// Create a shadow manager.
const shadows = new VOXELIZE.Shadows(world);

// Add a shadow to an object managed by the shadow manager.
shadows.add(object);

// Update the shadows every frame.
shadows.update();
```

## Hierarchy

- `Array`\<[`Shadow`](Shadow.md)\>

  ↳ **`Shadows`**

## Constructors

### constructor

• **new Shadows**(`world`): [`Shadows`](Shadows.md)

Create a shadow manager.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `world` | [`World`](World.md)\<`any`\> | The world to cast shadows in. |

#### Returns

[`Shadows`](Shadows.md)

#### Overrides

Array\&lt;Shadow\&gt;.constructor

## Properties

### enabled

• **enabled**: `boolean` = `true`

Whether shadows are enabled. When disabled, all shadows are hidden.

___

### world

• **world**: [`World`](World.md)\<`any`\>

The world to cast shadows in.

## Methods

### add

▸ **add**(`object`, `options?`): `void`

Add a shadow to an object under the shadow manager.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> | The object to add a shadow to. |
| `options` | `Partial`\<[`ShadowOptions`](../modules.md#shadowoptions)\> | The options of the shadow. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Loops through all tracked shadows and updates them. This should be called every frame.
This also removes any shadows that are no longer attached to an object or whose parent
is no longer in the scene.

#### Returns

`void`
