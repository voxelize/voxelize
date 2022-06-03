---
id: "Controls"
title: "Class: Controls"
sidebar_label: "Controls"
sidebar_position: 0
custom_edit_url: null
---

Inspired by THREE.JS's PointerLockControls, the main control of the game
so that the player can move freely around the world

## Hierarchy

- `EventDispatcher`

  ↳ **`Controls`**

## Properties

### params

• **params**: [`ControlsParams`](../modules.md#controlsparams-36)

An object storing parameters passed on `Controls` construction

**`memberof`** Controls

___

### object

• **object**: `Group`

A THREE.JS object, parent to the camera for pointerlock controls

**`memberof`** Controls

___

### state

• **state**: `BrainStateType` = `defaultBrainState`

___

### isLocked

• **isLocked**: `boolean` = `false`

Flag indicating whether pointerlock controls have control over mouse

**`memberof`** Controls

___

### body

• **body**: `RigidBody`

___

### lookBlock

• **lookBlock**: `Coords3`

___

### targetBlock

• **targetBlock**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `voxel` | `Coords3` |
| `rotation` | `number` |
| `yRotation` | `number` |

___

### client

• **client**: [`Client`](Client.md)

___

### getDirection

• **getDirection**: () => `Vector3`

#### Type declaration

▸ (): `Vector3`

##### Returns

`Vector3`

## Constructors

### constructor

• **new Controls**(`client`, `options?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `options` | `Partial`<[`ControlsParams`](../modules.md#controlsparams-36)\> |

#### Overrides

EventDispatcher.constructor

## Methods

### update

▸ **update**(): `void`

Update for the camera of the game, does the following:
- Move `controls.object` around according to input

**`memberof`** Controls

#### Returns

`void`

___

### connect

▸ **connect**(): `void`

Sets up all event listeners for controls, including:
- Mouse move event
- Pointer-lock events
- Canvas click event
- Key up/down events
- Control lock/unlock events

**`memberof`** Controls

#### Returns

`void`

___

### disconnect

▸ **disconnect**(): `void`

Removes all event listeners for controls, including:
- Mouse move event
- Pointer-lock events
- Canvas click event
- Key up/down events
- Control lock/unlock events

**`memberof`** Controls

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

Disposal of `Controls`, disconnects all event listeners

**`memberof`** Controls

#### Returns

`void`

___

### moveForward

▸ **moveForward**(`distance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `distance` | `number` |

#### Returns

`void`

___

### moveRight

▸ **moveRight**(`distance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `distance` | `number` |

#### Returns

`void`

___

### lock

▸ **lock**(`callback?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback?` | () => `void` |

#### Returns

`void`

___

### unlock

▸ **unlock**(`callback?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback?` | () => `void` |

#### Returns

`void`

___

### setPosition

▸ **setPosition**(`x`, `y`, `z`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`void`

___

### lookAt

▸ **lookAt**(`x`, `y`, `z`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### resetMovements

▸ **resetMovements**(): `void`

#### Returns

`void`

___

### toggleGhostMode

▸ **toggleGhostMode**(): `void`

#### Returns

`void`

## Accessors

### ghostMode

• `get` **ghostMode**(): `boolean`

#### Returns

`boolean`

___

### position

• `get` **position**(): `Coords3`

#### Returns

`Coords3`

___

### voxel

• `get` **voxel**(): `Coords3`

#### Returns

`Coords3`

___

### chunk

• `get` **chunk**(): `Coords2`

#### Returns

`Coords2`
