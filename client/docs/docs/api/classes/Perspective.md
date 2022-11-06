---
id: "Perspective"
title: "Class: Perspective"
sidebar_label: "Perspective"
sidebar_position: 0
custom_edit_url: null
---

A class that allows you to switch between first, second and third person perspectives for
a [RigidControls](RigidControls.md) instance. By default, the key to switch between perspectives is <kbd>C</kbd>.

# Example
```ts
// Initialize the perspective with the rigid controls.
const perspective = new VOXELIZE.Perspective(controls, world);

// Bind the keyboard inputs to switch between perspectives.
perspective.connect(inputs, "in-game");

// Switch to the first person perspective.
perspective.state = "third";

// Update the perspective every frame.
perspective.update();
```

## Properties

### INPUT\_IDENTIFIER

▪ `Static` `Readonly` **INPUT\_IDENTIFIER**: ``"voxelize-perspective"``

This is the identifier that is used to bind the perspective's keyboard inputs
when [Perspective.connect](Perspective.md#connect-480) is called.

___

### controls

• **controls**: [`RigidControls`](RigidControls.md)

The rigid controls that this perspective instance is attached to.

___

### inputs

• `Optional` **inputs**: [`Inputs`](Inputs.md)<`any`\>

The input manager that binds the perspective's keyboard inputs.

___

### onChangeState

• **onChangeState**: (`state`: ``"first"`` \| ``"second"`` \| ``"third"``) => `void`

#### Type declaration

▸ (`state`): `void`

A method that can be implemented and is called when the perspective's state changes.

##### Parameters

| Name | Type |
| :------ | :------ |
| `state` | ``"first"`` \| ``"second"`` \| ``"third"`` |

##### Returns

`void`

___

### params

• **params**: [`PerspectiveParams`](../modules.md#perspectiveparams-480)

Parameters to configure the perspective.

___

### world

• **world**: [`World`](World.md)

The world that this perspective instance is working with.

## Methods

### connect

▸ **connect**(`inputs`, `namespace?`): `void`

Connect the perspective to the given input manager. This will bind the perspective's keyboard inputs, which
by default is <kbd>C</kbd> to switch between perspectives.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)<`any`\> | `undefined` | The [Inputs](Inputs.md) instance to bind the perspective's keyboard inputs to. |
| `namespace` | `string` | `"*"` | The namespace to bind the perspective's keyboard inputs to. |

#### Returns

`void`

___

### toggle

▸ **toggle**(): `void`

Toggle between the first, second and third person perspectives. The order goes from first person to
third person and then to second person.

#### Returns

`void`

___

### update

▸ **update**(): `void`

This updates the perspective. Internally, if the perspective isn't in first person, it raycasts to find the closest
block and then ensures that the camera is not clipping into any blocks.

#### Returns

`void`

## Constructors

### constructor

• **new Perspective**(`controls`, `world`, `params?`)

Create a new perspective instance that is attached to the given rigid controls. The default
perspective is the first person perspective.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `controls` | [`RigidControls`](RigidControls.md) | The rigid controls that this perspective instance is attached to. |
| `world` | [`World`](World.md) | The world that this perspective instance is working with. |
| `params` | `Partial`<[`PerspectiveParams`](../modules.md#perspectiveparams-480)\> | Parameters to configure the perspective. |

## Accessors

### state

• `get` **state**(): ``"first"`` \| ``"second"`` \| ``"third"``

Getter for the perspective's state.

#### Returns

``"first"`` \| ``"second"`` \| ``"third"``

• `set` **state**(`state`): `void`

Setter for the perspective's state. This will call [Perspective.onChangeState](Perspective.md#onchangestate-480) if it is implemented.

#### Parameters

| Name | Type |
| :------ | :------ |
| `state` | ``"first"`` \| ``"second"`` \| ``"third"`` |

#### Returns

`void`
