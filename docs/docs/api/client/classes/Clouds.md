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

When using [Clouds.update](Clouds.md#update), new clouds will be generated if the center of the grid
does not match the passed in position.

![Clouds](/img/docs/clouds.png)

## Hierarchy

- `Group`

  ↳ **`Clouds`**

## Constructors

### constructor

• **new Clouds**(`options?`): [`Clouds`](Clouds.md)

Create a new [Clouds](Clouds.md) instance, initializing it asynchronously automatically.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Partial`\<[`CloudsOptions`](../modules.md#cloudsoptions)\> | Parameters used to create a new [Clouds](Clouds.md) instance. |

#### Returns

[`Clouds`](Clouds.md)

#### Overrides

Group.constructor

## Properties

### isInitialized

• **isInitialized**: `boolean` = `false`

Whether or not are the clouds done generating.

___

### locatedCell

• **locatedCell**: [`Coords2`](../modules.md#coords2)

The cell that this cloud is currently centered around.

___

### material

• **material**: `ShaderMaterial`

The shard shader material used to render the clouds.

___

### meshes

• **meshes**: `Mesh`\<`BufferGeometry`\<`NormalBufferAttributes`\>, `Material` \| `Material`[], `Object3DEventMap`\>[][] = `[]`

A 2D array of cloud meshes. The first dimension is the x-axis, and the second dimension is the z-axis.

___

### options

• **options**: [`CloudsOptions`](../modules.md#cloudsoptions)

Parameters used to create a new [Clouds](Clouds.md) instance.

___

### xOffset

• **xOffset**: `number` = `0`

The x-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
position passed into [Clouds.update](Clouds.md#update).

___

### zOffset

• **zOffset**: `number` = `0`

The z-offset of the clouds since initialization. This is determined by diffing the `locatedCell` and the
position passed into [Clouds.update](Clouds.md#update).

## Methods

### reset

▸ **reset**(): `Promise`\<`void`\>

Reset the clouds to their initial state.

#### Returns

`Promise`\<`void`\>

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
