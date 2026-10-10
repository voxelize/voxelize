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
| `options` | `Partial`<[`ArmOptions`](../#armoptions)\> |

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

### heldLightColor

• **heldLightColor**: `Color`

___

### isClickSwingEnabled

• **isClickSwingEnabled**: `boolean` = `true`

Whether a left click plays the default arm swing. Consumers that own the
left click and drive their own held-object animation (e.g. a gun with its
own recoil) can disable this so the melee swing does not fight and rotate
their viewmodel. Explicit [doSwing](Arm.md#doswing) calls are unaffected.

___

### options

• **options**: [`ArmOptions`](../#armoptions)

___

### viewCamera

• **viewCamera**: `PerspectiveCamera` = `null`

The camera the arm's scene is drawn with, which an object posed for a
[ArmObjectOptions.fixedFov](../#fixedfov) is held against.

## Accessors

### swingProgress

• `get` **swingProgress**(): `number`

How far through its swing the held object is, 0 to 1, or null when it
is not swinging.

#### Returns

`number`

## Methods

### connect

▸ **connect**(`inputs`, `namespace?`): () => `void`

Connect the arm to the given input manager. This will allow the arm to listen to left
and right clicks to play arm animations. This function returns a function that when called
unbinds the arm's keyboard inputs.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)<`any`\> | `undefined` | The [Inputs](Inputs.md) instance to bind the arm's keyboard inputs to. |
| `namespace` | `string` | `"*"` | The namespace to bind the arm's keyboard inputs to. |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### doSwing

▸ **doSwing**(): `boolean`

Swing what the arm holds and send the swing to the network, so peers
swing too. A request the swing in progress is not ready for (see
[ArmObjectOptions.swingRestartAfter](../#swingrestartafter)) does neither, so peers see
exactly the swings the holder sees. Returns whether a swing started.

#### Returns

`boolean`

___

### holdSwingAt

▸ **holdSwingAt**(`seconds`): `void`

Pin the held object's swing `seconds` into it, or release it with
`null`. A pinned swing shows that one frame, with no sway, until it is
released and the object is back at rest. For stills of a swing and the
tests that check one; play never needs it.

#### Parameters

| Name | Type |
| :------ | :------ |
| `seconds` | `number` |

#### Returns

`void`

___

### paintArm

▸ **paintArm**(`texture`): `void`

Paint the arm with a texture or color. Only works when showing the empty arm (no held object).

#### Parameters

| Name | Type |
| :------ | :------ |
| `texture` | `Color` \| `Texture`<`unknown`\> |

#### Returns

`void`

___

### setArmObject

▸ **setArmObject**(`object`, `animate`, `customType?`): `void`

Set a new object for the arm. If `animate` is true, the transition will be animated.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> | New object for the arm |
| `animate` | `boolean` | Whether to animate the transition |
| `customType?` | `string` | - |

#### Returns

`void`

___

### setShadowSelfBounds

▸ **setShadowSelfBounds**(`bounds`): `void`

The body the viewmodel belongs to, as its world-space bounding sphere
(`Character.shadowSelfBounds`), shared by reference so the body keeps it
current. With a placed viewmodel nothing inside it shades the arm or
the held object, which lets the body cast its own shadow from just
behind the eye. `null` for none.

#### Parameters

| Name | Type |
| :------ | :------ |
| `bounds` | `Vector4` |

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the arm's animation. Note that when a arm is attached to a control,
`update` is called automatically within the control's update loop.

#### Returns

`void`

___

### updateShadowUniforms

▸ **updateShadowUniforms**(`lightingUniforms`, `viewToWorld?`): `void`

Copy the frame's lighting into the arm's and the held object's shadows.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `lightingUniforms` | [`ShaderLightingUniforms`](../interfaces/ShaderLightingUniforms.md) | - |
| `viewToWorld?` | `Vector3` \| `Matrix4` | Where the viewmodel's scene sits in the world: the eye camera's world matrix times the viewmodel camera's inverse. The viewmodel is then shaded where it would be held, at [ArmOptions.shadowReach](../#shadowreach) of the distance it is drawn at, and nothing inside the body it belongs to ([setShadowSelfBounds](Arm.md#setshadowselfbounds)) shades any of its faces. A vector instead offsets the viewmodel's own, unrotated frame into the world. |

#### Returns

`void`
