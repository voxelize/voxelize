---
id: "LightShined"
title: "Class: LightShined"
sidebar_label: "LightShined"
sidebar_position: 0
custom_edit_url: null
---

A class that allows mesh to dynamically change brightness based on the voxel light level at their position.

By default, `VOXELIZE.Shadow` and `VOXELIZE.NameTag` is ignored by this effect.

# Example
```ts
// Create a light shined effect manager.
const lightShined = new VOXELIZE.LightShined();

// Add the effect to a mesh.
lightShined.add(character);

// In the render loop, update the effect.
lightShined.update();
```

![Example](/img/light-shined.png)

## Methods

### add

▸ **add**(`obj`): `void`

Add an object to be affected by this effect.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `obj` | `Object3D`<`Event`\> | A THREE.JS object to be shined on. |

#### Returns

`void`

___

### ignore

▸ **ignore**(...`types`): `void`

Ignore a certain type of object from being affected by this effect.

**`example`**
```ts
// Ignore all shadows. (This is done by default)
lightShined.ignore(VOXELIZE.Shadow);
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `...types` | `any`[] | A type or a list of types to be ignored by this effect. |

#### Returns

`void`

___

### remove

▸ **remove**(`obj`): `void`

Remove an object from being affected by this effect

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `obj` | `Object3D`<`Event`\> | The object to be removed from the effect. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the light shined effect. This fetches the light level at the position of
each object and recursively updates the brightness of the object.

This should be called in the render loop.

#### Returns

`void`

## Constructors

### constructor

• **new LightShined**(`world`, `params?`)

Construct a light shined effect manager.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `world` | [`World`](World.md) | The world that the effect is applied to. |
| `params` | `Partial`<[`LightShinedParams`](../modules.md#lightshinedparams-94)\> | Parameters to customize the effect. |

## Properties

### ignored

• **ignored**: `Set`<`any`\>

A list of types that are ignored by this effect.

___

### list

• **list**: `Set`<`Object3D`<`Event`\>\>

A list of meshes that are effected by this effect.

___

### params

• **params**: [`LightShinedParams`](../modules.md#lightshinedparams-94)

Parameters to customize the effect.

___

### world

• **world**: [`World`](World.md)
