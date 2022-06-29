---
id: "Controls"
title: "Class: Controls"
sidebar_label: "Controls"
sidebar_position: 0
custom_edit_url: null
---

Inspired by THREE.JS's PointerLockControls, the **built-in** main control of the game
so that the player can move freely around the world.

## Example
Printing the voxel that the client is in:
```ts
console.log(client.controls.voxel);
```

## Hierarchy

- `EventDispatcher`

  ↳ **`Controls`**

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`ControlsParams`](../modules.md#controlsparams-66)

Parameters to initialize the Voxelize controls.

___

### object

• **object**: `Group`

A THREE.JS object, parent to the camera for pointerlock controls.

___

### state

• **state**: [`ControlState`](../modules.md#controlstate-66)

The state of the control, indicating things like whether or not the client is running.

___

### isLocked

• **isLocked**: `boolean` = `false`

Flag indicating whether pointerlock controls have control over the cursor.

___

### hand

• **hand**: `string` = `""`

The type of block that the player is currently holding. Defaults to whatever the block of ID 1 is.

___

### body

• **body**: `RigidBody`

The physical rigid body of the client, dimensions described by:
- `params.bodyWidth`
- `params.bodyHeight`
- `params.bodyDepth`

___

### lookBlock

• **lookBlock**: [`Coords3`](../modules.md#coords3-66)

The voxel at which the client is looking at.

___

### targetBlock

• **targetBlock**: `Object`

The block that a client can potentially place at.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxel` | [`Coords3`](../modules.md#coords3-66) | The coordinates of the potentially placeable block. Defaults to `(0, 0, 0)`. |
| `rotation` | `number` | The rotation of the block that may be placed. |
| `yRotation` | `number` | The rotation on the y-axis of the block that may be placed. |

## Methods

### getDirection

▸ **getDirection**(): `Vector3`

Get the direction that the client is looking at.

#### Returns

`Vector3`

___

### lock

▸ **lock**(`callback?`): `void`

Lock the cursor to the game, calling `requestPointerLock` on `client.container.domElement`.
Needs to be called within a DOM event listener callback!

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` | Callback to be run once done. |

#### Returns

`void`

___

### unlock

▸ **unlock**(`callback?`): `void`

Unlock the cursor from the game, calling `exitPointerLock` on `document`. Needs to be
called within a DOM event listener callback!

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` | Callback to be run once done. |

#### Returns

`void`

___

### setPosition

▸ **setPosition**(`x`, `y`, `z`): `void`

Set the position of the client.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `x` | `number` | X-coordinate to be at. |
| `y` | `number` | Y-coordinate to be at. |
| `z` | `number` | Z-coordinate to be at. |

#### Returns

`void`

___

### lookAt

▸ **lookAt**(`x`, `y`, `z`): `void`

Make the client look at a coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `x` | `number` | X-coordinate to look at. |
| `y` | `number` | Y-coordinate to look at. |
| `z` | `number` | Z-coordinate to look at. |

#### Returns

`void`

___

### resetMovements

▸ **resetMovements**(): `void`

Reset all of the control's movements.

#### Returns

`void`

___

### toggleGhostMode

▸ **toggleGhostMode**(): `void`

Toggle ghost mode. Ghost mode is when a client can fly through blocks.

#### Returns

`void`

## Accessors

### ghostMode

• `get` **ghostMode**(): `boolean`

Whether if the client is in ghost mode. Ghost mode means client can fly through blocks.

#### Returns

`boolean`

___

### position

• `get` **position**(): [`Coords3`](../modules.md#coords3-66)

The 3D position that the client is at.

#### Returns

[`Coords3`](../modules.md#coords3-66)

___

### voxel

• `get` **voxel**(): [`Coords3`](../modules.md#coords3-66)

The voxel coordinates that the client is on.

#### Returns

[`Coords3`](../modules.md#coords3-66)

___

### chunk

• `get` **chunk**(): [`Coords2`](../modules.md#coords2-66)

The chunk that the client is situated in.

#### Returns

[`Coords2`](../modules.md#coords2-66)
