---
id: "Clouds"
title: "Class: Clouds"
sidebar_label: "Clouds"
sidebar_position: 0
custom_edit_url: null
---

A class that generates and manages clouds. Clouds are essentially a 2D grid of cells that contain further sub-grids of
cloud blocks. This 2D grid move altogether in the `+x` direction, and is generated at the start asynchronously using
web workers using simplex noise.

When using [Clouds.update](Clouds.md#update-128), new clouds will be generated if the center of the grid
does not match the passed in position.

![Clouds](/img/clouds.png)

## Hierarchy

- `Group`

  ↳ **`Clouds`**

## Constructors

### constructor

• **new Clouds**(`params?`)

Create a new [Clouds](Clouds.md) instance, initializing it asynchronously automatically.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Partial`<[`CloudsParams`](../modules.md#cloudsparams-128)\> | Parameters used to create a new [Clouds](Clouds.md) instance. |

#### Overrides

Group.constructor

## Properties

### initialized

• **initialized**: `boolean` = `false`

Whether or not are the clouds done generating.

___

### locatedCell

• **locatedCell**: `number`[]

The cell that this cloud is currently centered around.

___

### material

• **material**: `ShaderMaterial`

The shard shader material used to render the clouds.

___

### meshes

• **meshes**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>[][] = `[]`

A 2D array of cloud meshes. The first dimension is the x-axis, and the second dimension is the z-axis.

___

### params

• **params**: [`CloudsParams`](../modules.md#cloudsparams-128)

Parameters used to create a new [Clouds](Clouds.md) instance.

___

### xOffset

• **xOffset**: `number` = `0`

The x-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
position passed into [Clouds.update](Clouds.md#update-128).

___

### zOffset

• **zOffset**: `number` = `0`

The z-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
position passed into [Clouds.update](Clouds.md#update-128).

## Methods

### reset

▸ **reset**(): `Promise`<`void`\>

Reset the clouds to their initial state.

#### Returns

`Promise`<`void`\>

___

### update

▸ **update**(`position`): `void`

Move the clouds to centering around the passed in position. If there aren't enough cloud
cells at any side, new clouds are generated.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `position` | `Vector3` | The new position that this cloud should be centered around. |

#### Returns

`void`
