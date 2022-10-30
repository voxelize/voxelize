---
id: "RigidControls"
title: "Class: RigidControls"
sidebar_label: "RigidControls"
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

- `EventEmitter`

  ↳ **`RigidControls`**

## Methods

### on

▸ **on**(`event`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"lock"`` |
| `listener` | () => `void` |

#### Returns

[`RigidControls`](RigidControls.md)

▸ **on**(`event`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"unlock"`` |
| `listener` | () => `void` |

#### Returns

[`RigidControls`](RigidControls.md)

___

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

### teleport

▸ **teleport**(`vx`, `vy`, `vz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`void`

___

### teleportToTop

▸ **teleportToTop**(): `void`

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

___

### toggleFly

▸ **toggleFly**(): `void`

#### Returns

`void`

___

### attachCharacter

▸ **attachCharacter**(`character`, `newLerpFactor?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `character` | [`Character`](Character.md) | `undefined` |
| `newLerpFactor` | `number` | `1` |

#### Returns

`void`

___

### listenerCount

▸ `Static` **listenerCount**(`emitter`, `type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` |
| `type` | `string` \| `number` |

#### Returns

`number`

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

___

### emit

▸ **emit**(`type`, ...`args`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `...args` | `any`[] |

#### Returns

`boolean`

___

### addListener

▸ **addListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### once

▸ **once**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### off

▸ **off**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### removeAllListeners

▸ **removeAllListeners**(`type?`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`RigidControls`](RigidControls.md)

___

### listeners

▸ **listeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

___

### listenerCount

▸ **listenerCount**(`type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`number`

___

### rawListeners

▸ **rawListeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

## Properties

### camera

• **camera**: `PerspectiveCamera`

Reference linking to the Voxelize camera instance.

___

### inputs

• `Optional` **inputs**: [`Inputs`](Inputs.md)<`any`\>

___

### character

• `Optional` **character**: [`Character`](Character.md)

___

### domElement

• **domElement**: `HTMLElement`

___

### world

• **world**: [`World`](World.md)

Reference linking to the Voxelize world instance.

___

### params

• **params**: [`RigidControlsParams`](../modules.md#rigidcontrolsparams-98)

Parameters to initialize the Voxelize controls.

___

### object

• **object**: `Group`

A THREE.JS object, parent to the camera for pointerlock controls.

___

### state

• **state**: [`RigidControlState`](../modules.md#rigidcontrolstate-98)

The state of the control, indicating things like whether or not the client is running.

___

### isLocked

• **isLocked**: `boolean` = `false`

Flag indicating whether pointerlock controls have control over the cursor.

___

### body

• **body**: `RigidBody`

The physical rigid body of the client, dimensions described by:
- `params.bodyWidth`
- `params.bodyHeight`
- `params.bodyDepth`

___

### INPUT\_IDENTIFIER

▪ `Static` `Readonly` **INPUT\_IDENTIFIER**: ``"voxelize-rigid-controls"``

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

## Accessors

### ghostMode

• `get` **ghostMode**(): `boolean`

Whether if the client is in ghost mode. Ghost mode means client can fly through blocks.

#### Returns

`boolean`

___

### voxel

• `get` **voxel**(): [`Coords3`](../modules.md#coords3-98)

The voxel coordinates that the client is on.

#### Returns

[`Coords3`](../modules.md#coords3-98)

___

### position

• `get` **position**(): `Vector3`

#### Returns

`Vector3`

___

### chunk

• `get` **chunk**(): [`Coords2`](../modules.md#coords2-98)

The chunk that the client is situated in.

#### Returns

[`Coords2`](../modules.md#coords2-98)
