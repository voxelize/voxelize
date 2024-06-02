---
id: "VoxelInteract"
title: "Class: VoxelInteract"
sidebar_label: "VoxelInteract"
sidebar_position: 0
custom_edit_url: null
---

The VoxelInteract class is used to interact with voxels in the [World](World.md) instance. It consists of two main parts:

- [VoxelInteract.potential](VoxelInteract.md#potential): The potential block placement. This is the data of a block's orientation that can be placed.
- [VoxelInteract.target](VoxelInteract.md#target): The targeted block. This is the voxel that the camera is looking at.

You can use these two properties to place blocks, remove blocks, and more.

# Example
```ts
// Create a new VoxelInteract instance.
const voxelInteract = new VoxelInteract(camera, world);

// Add the voxel interact to the scene.
world.add(voxelInteract);

// Set the target block to air.
if (voxelInteract.target) {
  const [vx, vy, vz] = voxelInteract.target;
  world.updateVoxel(vx, vy, vz, 0);
}

// Update the interaction every frame.
voxelInteract.update();
```

![VoxelInteract](/img/docs/voxel-interact.png)

## Hierarchy

- `Group`

  ↳ **`VoxelInteract`**

## Constructors

### constructor

• **new VoxelInteract**(`object`, `world`, `options?`): [`VoxelInteract`](VoxelInteract.md)

Create a new VoxelInteract instance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> | The object that the interactions should be raycasting from. |
| `world` | [`World`](World.md)\<`any`\> | The [World](World.md) instance that the interactions should be raycasting in. |
| `options` | `Partial`\<[`VoxelInteractOptions`](../modules.md#voxelinteractoptions)\> | Parameters to customize the [VoxelInteract](VoxelInteract.md) instance. |

#### Returns

[`VoxelInteract`](VoxelInteract.md)

#### Overrides

Group.constructor

## Properties

### active

• **active**: `boolean` = `true`

Whether or not is this [VoxelInteract](VoxelInteract.md) instance currently active.

___

### object

• **object**: `Object3D`\<`Object3DEventMap`\>

The object that the interactions should be raycasting from.

___

### options

• **options**: [`VoxelInteractOptions`](../modules.md#voxelinteractoptions)

Parameters to customize the [VoxelInteract](VoxelInteract.md) instance.

___

### potential

• **potential**: `Object`

The potential orientation and location of the block placement. If no block placement is possible, this will be `null`.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation` | `number` | The rotation that the block placement's major axis should be facing. |
| `voxel` | [`Coords3`](../modules.md#coords3) | The 3D coordinates of the potential block placement. |
| `yRotation` | `number` | The rotation along the Y axis that the block placement's major axis should be facing. This only works if rotation is [PY_ROTATION](../modules.md#py_rotation) or [NY_ROTATION](../modules.md#ny_rotation). |
| `yRotation4` | `number` | - |
| `yRotation8` | `number` | - |

___

### target

• **target**: [`Coords3`](../modules.md#coords3)

The targeted voxel coordinates of the block that the camera is looking at. If no block is targeted, this will be `null`.

___

### world

• **world**: [`World`](World.md)\<`any`\>

The [World](World.md) instance that the interactions should be raycasting in.

## Accessors

### lookingAt

• `get` **lookingAt**(): [`Block`](../modules.md#block)

Get the voxel ID of the targeted voxel. `null` if no voxel is targeted.

#### Returns

[`Block`](../modules.md#block)

## Methods

### toggle

▸ **toggle**(`force?`): `void`

Toggle on/off of this [VoxelInteract](VoxelInteract.md) instance.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `force` | `any` | `null` | Whether or not should it be a forceful toggle on/off. Defaults to `null`. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Raycasts from the given object's position and direction to find the targeted voxel and potential block placement.
If no block is targeted, then [VoxelInteract.target](VoxelInteract.md#target) and [VoxelInteract.potential](VoxelInteract.md#potential) will both be `null`.

#### Returns

`void`
