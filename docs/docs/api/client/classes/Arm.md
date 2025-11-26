---
id: "Arm"
title: "Class: Arm"
sidebar_label: "Arm"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Group`

  ↳ **`Arm`**

## Constructors

### constructor

• **new Arm**(`options?`): [`Arm`](Arm.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`ArmOptions`](../modules.md#armoptions)\> |

#### Returns

[`Arm`](Arm.md)

#### Overrides

THREE.Group.constructor

## Properties

### emitSwingEvent

• **emitSwingEvent**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### options

• **options**: [`ArmOptions`](../modules.md#armoptions)

## Methods

### connect

▸ **connect**(`inputs`, `namespace?`): () => `void`

Connect the arm to the given input manager. This will allow the arm to listen to left
and right clicks to play arm animations. This function returns a function that when called
unbinds the arm's keyboard inputs.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)\<`any`\> | `undefined` | The [Inputs](Inputs.md) instance to bind the arm's keyboard inputs to. |
| `namespace` | `string` | `"*"` | The namespace to bind the arm's keyboard inputs to. |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### doSwing

▸ **doSwing**(): `void`

Perform an arm swing by playing the swing animation and sending an event to the network.

#### Returns

`void`

___

### paintArm

▸ **paintArm**(`texture`): `void`

Paint the arm with a texture or color. Only works when showing the empty arm (no held object).

#### Parameters

| Name | Type |
| :------ | :------ |
| `texture` | `Color` \| `Texture` |

#### Returns

`void`

___

### setArmObject

▸ **setArmObject**(`object`, `animate`, `customType?`): `void`

Set a new object for the arm. If `animate` is true, the transition will be animated.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> | New object for the arm |
| `animate` | `boolean` | Whether to animate the transition |
| `customType?` | `string` | - |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the arm's animation. Note that when a arm is attached to a control,
`update` is called automatically within the control's update loop.

#### Returns

`void`
