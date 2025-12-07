---
id: "RigidControls"
title: "Class: RigidControls"
sidebar_label: "RigidControls"
sidebar_position: 0
custom_edit_url: null
---

Inspired by THREE.JS's PointerLockControls, a rigid body based first person controls.

## Example
```ts
// Create the controls.
const controls = new RigidControls(
  camera,
  renderer.domElement,
  world
);

// Printing the voxel that the client is in.
console.log(controls.voxel);

// Call the controls update function in the render loop.
controls.update();
```

## Hierarchy

- `EventEmitter`

  ↳ **`RigidControls`**

  ↳↳ [`MobileRigidControls`](MobileRigidControls.md)

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new RigidControls**(`camera`, `domElement`, `world`, `options?`): [`RigidControls`](RigidControls.md)

Construct a Voxelize rigid body based first person controls. This adds a rigid body
to the world's physics engine, and applies movement to the camera.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `camera` | `PerspectiveCamera` | The camera to apply the controls to. |
| `domElement` | `HTMLElement` | The DOM element to apply the controls to. |
| `world` | [`World`](World.md)\<`any`\> | The world to apply the controls to. |
| `options` | `Partial`\<[`RigidControlsOptions`](../modules.md#rigidcontrolsoptions)\> | The options to initialize the controls with. |

#### Returns

[`RigidControls`](RigidControls.md)

#### Overrides

EventEmitter.constructor

## Properties

### INPUT\_IDENTIFIER

▪ `Static` `Readonly` **INPUT\_IDENTIFIER**: ``"voxelize-rigid-controls"``

This is the identifier that is used to bind the rigid controls' keyboard inputs
when [RigidControls.connect](RigidControls.md#connect) is called.

___

### arm

• `Optional` **arm**: [`Arm`](Arm.md)

A potential link to a [Arm](Arm.md) instance. This can be added by
calling [RigidControls.attachArm](RigidControls.md#attacharm) to add a mesh for the first person
view.

___

### body

• **body**: `RigidBody`

The physical rigid body of the client, dimensions described by:
- `options.bodyWidth`
- `options.bodyHeight`
- `options.bodyDepth`

___

### camera

• **camera**: `PerspectiveCamera`

Reference linking to the Voxelize camera instance.

___

### character

• `Optional` **character**: [`Character`](Character.md)

A potential link to a [Character](Character.md) instance. This can be added by
calling [RigidControls.attachCharacter](RigidControls.md#attachcharacter) to add a mesh for 2nd and 3rd person
view.

___

### domElement

• **domElement**: `HTMLElement`

The DOM element that pointerlock controls are applied to.

___

### inputs

• `Optional` **inputs**: [`Inputs`](Inputs.md)\<`any`\>

Reference linking to the Voxelize [Inputs](Inputs.md) instance. You can link an inputs manager by calling
[RigidControls.connect](RigidControls.md#connect), which registers the keyboard inputs for the controls.

___

### isLocked

• **isLocked**: `boolean` = `false`

Flag indicating whether pointerlock controls have control over the cursor.

___

### movements

• **movements**: `Object`

Whether or not the client has certain movement potentials. For example, if the forward
key is pressed, then "front" would be `true`. Vice versa for "back".

#### Type declaration

| Name | Type |
| :------ | :------ |
| `back` | `boolean` |
| `down` | `boolean` |
| `front` | `boolean` |
| `left` | `boolean` |
| `right` | `boolean` |
| `sprint` | `boolean` |
| `up` | `boolean` |

___

### object

• **object**: `Group`\<`Object3DEventMap`\>

A THREE.JS object, parent to the camera for pointerlock controls.

___

### options

• **options**: [`RigidControlsOptions`](../modules.md#rigidcontrolsoptions)

Parameters to initialize the Voxelize controls.

___

### ownID

• **ownID**: `string` = `""`

The client's own peer ID. This is set when the client first connects to the server.

___

### state

• **state**: [`RigidControlState`](../modules.md#rigidcontrolstate)

The state of the control, indicating things like whether or not the client is running.

___

### world

• **world**: [`World`](World.md)\<`any`\>

Reference linking to the Voxelize world instance.

## Accessors

### chunk

• `get` **chunk**(): [`Coords2`](../modules.md#coords2)

The chunk that the client is situated in.

#### Returns

[`Coords2`](../modules.md#coords2)

___

### flyMode

• `get` **flyMode**(): `boolean`

Whether if the client is in fly mode. Fly mode means client can fly but not through blocks.

#### Returns

`boolean`

___

### ghostMode

• `get` **ghostMode**(): `boolean`

Whether if the client is in ghost mode. Ghost mode means client can fly through blocks.

#### Returns

`boolean`

___

### position

• `get` **position**(): `Vector3`

The 3D world coordinates that the client is at. This is where the bottom of the client's body is located.

#### Returns

`Vector3`

___

### voxel

• `get` **voxel**(): [`Coords3`](../modules.md#coords3)

The voxel coordinates that the client is at. This is where the bottom of the client's body is located,
floored to the voxel coordinate.

#### Returns

[`Coords3`](../modules.md#coords3)

## Methods

### attachArm

▸ **attachArm**(`arm`): `void`

Attach a [Arm](Arm.md) to this controls instance. This can be seen in 1st person mode.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `arm` | [`Arm`](Arm.md) | The [Arm](Arm.md) to attach to this controls instance. |

#### Returns

`void`

___

### attachCharacter

▸ **attachCharacter**(`character`, `newLerpFactor?`): `void`

Attach a [Character](Character.md) to this controls instance. This can be seen in 2nd/3rd person mode.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `character` | [`Character`](Character.md) | `undefined` | The [Character](Character.md) to attach to this controls instance. |
| `newLerpFactor` | `number` | `1` | The new lerp factor to use for the character. |

#### Returns

`void`

___

### connect

▸ **connect**(`inputs`, `namespace?`): () => `void`

Sets up all event listeners for controls, including:
- Mouse move event
- Pointer-lock events
- Canvas click event
- Key up/down events
- Control lock/unlock events

This function returns a function that can be called to disconnect the controls.
Keep in mind that if [Inputs.remap](Inputs.md#remap) is used to remap any controls, they will
not be unbound when the returned function is called.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)\<`any`\> | `undefined` |
| `namespace` | `string` | `"*"` |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

**`Options`**

inputs [Inputs](Inputs.md) instance to bind the controls to.

**`Options`**

namespace The namespace to bind the controls to.

___

### getDirection

▸ **getDirection**(): `Vector3`

Get the direction that the client is looking at.

#### Returns

`Vector3`

___

### lock

▸ **lock**(`callback?`): `void`

Lock the cursor to the game, calling `requestPointerLock` on the dom element.
Needs to be called within a DOM event listener callback!

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` | Callback to be run once done. |

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

### moveForward

▸ **moveForward**(`distance`): `void`

Move the client forward/backward by a certain distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance to move forward by. |

#### Returns

`void`

___

### moveRight

▸ **moveRight**(`distance`): `void`

Move the client left/right by a certain distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance to move left/right by. |

#### Returns

`void`

___

### on

▸ **on**(`event`, `listener`): [`RigidControls`](RigidControls.md)

An event handler for when the pointerlock is locked/unlocked.
The events supported so far are:
- `lock`: When the pointerlock is locked.
- `unlock`: When the pointerlock is unlocked.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | ``"lock"`` \| ``"unlock"`` | The event name, either `lock` or `unlock`. |
| `listener` | () => `void` | The listener to call when the event is emitted. |

#### Returns

[`RigidControls`](RigidControls.md)

The controls instance for chaining.

#### Overrides

EventEmitter.on

___

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`\<`any`, `any`, `any`, [`number`, `number`, `number`]\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

___

### reset

▸ **reset**(): `void`

Reset the controls instance. This will reset the camera's position and rotation, and reset all movements.

#### Returns

`void`

___

### resetMovements

▸ **resetMovements**(): `void`

Reset all of the control's movements.

#### Returns

`void`

___

### teleport

▸ **teleport**(`vx`, `vy`, `vz`): `void`

Teleport this rigid controls to a new voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The x voxel coordinate to teleport to. |
| `vy` | `number` | The y voxel coordinate to teleport to. |
| `vz` | `number` | The z voxel coordinate to teleport to. |

#### Returns

`void`

___

### teleportToTop

▸ **teleportToTop**(`vx?`, `vz?`, `yOffset?`): `void`

Teleport the rigid controls to the top of this voxel column.

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `vx?` | `number` | `undefined` |
| `vz?` | `number` | `undefined` |
| `yOffset` | `number` | `0` |

#### Returns

`void`

___

### toggleFly

▸ **toggleFly**(): `void`

Toggle fly mode. Fly mode is like ghost mode, but the client can't fly through blocks.

#### Returns

`void`

___

### toggleGhostMode

▸ **toggleGhostMode**(): `void`

Toggle ghost mode. Ghost mode is when a client can fly through blocks.

#### Returns

`void`

___

### unlock

▸ **unlock**(`callback?`): `void`

Unlock the cursor from the game, calling `exitPointerLock` on the HTML document.
Needs to be called within a DOM event listener callback!

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` | Callback to be run once done. |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update for the camera of the game. This should be called in the game update loop.
What this does is that it updates the rigid body, and then interpolates the camera's position and rotation
to the new position and rotation. If a character is attached, then the character is also updated.
If the arm is attached, then the arm is also updated.

#### Returns

`void`
