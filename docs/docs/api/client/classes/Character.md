---
id: "Character"
title: "Class: Character"
sidebar_label: "Character"
sidebar_position: 0
custom_edit_url: null
---

The default Voxelize character. This can be used in `Peers.createPeer` to apply characters onto
multiplayer peers. This can also be **attached** to a `RigidControls` instance to have a character
follow the controls.

When `character.set` is called, the character's head will be lerp to the new rotation first, then the
body will be lerp to the new rotation. This is to create a more natural looking of character rotation.

# Example
```ts
const character = new VOXELIZE.Character();

// Set the nametag content.
character.username = "<placeholder>";

// Load a texture to paint on the face.
world.loader.addTexture(FunnyImageSrc, (texture) => {
  character.head.paint("front", texture);
})

// Attach the character to a rigid controls.
controls.attachCharacter(character);
```

![Character](/img/docs/character.png)

## Hierarchy

- `Group`

  ↳ **`Character`**

## Constructors

### constructor

• **new Character**(`options?`): [`Character`](Character.md)

Create a new Voxelize character.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Partial`<[`CharacterOptions`](../#characteroptions)\> | Parameters to create a Voxelize character. |

#### Returns

[`Character`](Character.md)

#### Overrides

Group.constructor

## Properties

### body

• **body**: [`CanvasBox`](CanvasBox.md)

The actual body mesh as a paint-able `CanvasBox`.

___

### bodyGroup

• **bodyGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's body.

___

### extraData

• **extraData**: `any` = `null`

Somewhere to store whatever you want.

___

### head

• **head**: [`CanvasBox`](CanvasBox.md)

The actual head mesh as a paint-able `CanvasBox`.

___

### headGroup

• **headGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's head.

___

### leftArm

• **leftArm**: [`CanvasBox`](CanvasBox.md)

The actual left arm mesh as a paint-able `CanvasBox`.

___

### leftArmGroup

• **leftArmGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's left arm.

___

### leftLeg

• **leftLeg**: [`CanvasBox`](CanvasBox.md)

The actual left leg mesh as a paint-able `CanvasBox`.

___

### leftLegGroup

• **leftLegGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's left leg.

___

### nametag

• **nametag**: [`NameTag`](NameTag.md)

The nametag of the character that floats right above the head.

___

### newBodyDirection

• **newBodyDirection**: `Quaternion`

The new body direction of the character. This is used to lerp the character's body rotation.

___

### newDirection

• **newDirection**: `Quaternion`

The new head direction of the character. This is used to lerp the character's head rotation.

___

### newPosition

• **newPosition**: `Vector3`

The new position of the character. This is used to lerp the character's position

___

### onIdle

• **onIdle**: () => `void`

A listener called when a character stops moving.

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### onMove

• **onMove**: () => `void`

A listener called when a character starts moving.

#### Type declaration

▸ (): `void`

##### Returns

`void`

___

### options

• **options**: [`CharacterOptions`](../#characteroptions)

Parameters to create a Voxelize character.

___

### rideOffset

• `Readonly` **rideOffset**: `Vector3`

The render-only translation produced by hinging the ride attitude at
the seat. It is baked into `position` while riding, so consumers that
derive anchors from `position` (e.g. mount attachment) should subtract
it to recover the raw tracked position.

___

### rightArm

• **rightArm**: [`CanvasBox`](CanvasBox.md)

The actual right arm mesh as a paint-able `CanvasBox`.

___

### rightArmGroup

• **rightArmGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's right arm.

___

### rightLeg

• **rightLeg**: [`CanvasBox`](CanvasBox.md)

The actual right leg mesh as a paint-able `CanvasBox`.

___

### rightLegGroup

• **rightLegGroup**: `Group`<`Object3DEventMap`\>

The sub-mesh holding the character's right leg.

___

### shadowSelfBounds

• `Readonly` **shadowSelfBounds**: `Vector4`

The body's bounding sphere in world space (centre xyz, radius w). Every
part's entity shadow uniforms read it as `uShadowSelfBounds`, so no face
is shaded by the body it belongs to while anything beyond the body
still shades it. Kept current by [update](Character.md#update) and
[updateShadowUniforms](Character.md#updateshadowuniforms); [bindShadowSelfBounds](Character.md#bindshadowselfbounds) shares it
with an accessory's uniforms.

___

### speed

• **speed**: `number` = `0`

The speed where the character has detected movements at. When speed is 0, the
arms swing slowly in idle mode, and when speed is greater than 0, the arms swing
faster depending on the passed-in options.

## Accessors

### armColor

• `get` **armColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **armColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### bodyColor

• `get` **bodyColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **bodyColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### eyeHeight

• `get` **eyeHeight**(): `number`

Get the height at which the eye of the character is situated at.

#### Returns

`number`

___

### faceColor

• `get` **faceColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **faceColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### headColor

• `get` **headColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **headColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### isCrouching

• `get` **isCrouching**(): `boolean`

#### Returns

`boolean`

___

### isSitting

• `get` **isSitting**(): `boolean`

#### Returns

`boolean`

___

### isSwimming

• `get` **isSwimming**(): `boolean`

#### Returns

`boolean`

___

### legColor

• `get` **legColor**(): `string` \| `Color`

#### Returns

`string` \| `Color`

• `set` **legColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| `Color` |

#### Returns

`void`

___

### totalHeight

• `get` **totalHeight**(): `number`

Get the total height of the character, in other words, the sum of the heights of
the head, body, and legs.

#### Returns

`number`

___

### username

• `get` **username**(): `string`

Get the content of the nametag of the character.

#### Returns

`string`

• `set` **username**(`username`): `void`

Change the content of the user's nametag. If the nametag is empty, nothing will be rendered.

#### Parameters

| Name | Type |
| :------ | :------ |
| `username` | `string` |

#### Returns

`void`

## Methods

### bindShadowSelfBounds

▸ **bindShadowSelfBounds**(`uniforms`): `void`

Have `uniforms` read this body's [shadowSelfBounds](Character.md#shadowselfbounds): for an
accessory with a shadowed material of its own (armour, a hat), so it is
shaded like the body it is worn on.

#### Parameters

| Name | Type |
| :------ | :------ |
| `uniforms` | [`EntityShadowUniforms`](../interfaces/EntityShadowUniforms.md) |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

Free the GPU resources this character owns: every canvas box layer
under it (its six body parts and any hat, cape or extra hung on them)
and every sprite label (the nametag, a speech bubble). Objects held in
the hands are left alone: they are usually clones of cached block
meshes that share geometry and materials with the rest of the world.
Call once, after the character has left the scene for good.

#### Returns

`void`

___

### fitShadowSelfBounds

▸ **fitShadowSelfBounds**(): `void`

Grow [shadowSelfBounds](Character.md#shadowselfbounds) to hold every mesh under the parts as
posed now: for a body whose attachments reach past its anatomical boxes
(splayed legs, a tail, a crest). Call once the body is built; the reach
is measured in the body's own frame, so it turns and scales with it.

#### Returns

`void`

___

### playArmSwingAnimation

▸ **playArmSwingAnimation**(): `void`

Play the "swing" animation.

#### Returns

`void`

___

### refreshShadowSelfBounds

▸ **refreshShadowSelfBounds**(): `void`

Recompute [shadowSelfBounds](Character.md#shadowselfbounds) from the current pose: a sphere about
the middle of the body that holds every part however the arms swing,
carried, turned and scaled with the root (a swimmer lies along it, a
fallen body rolls with it).

#### Returns

`void`

___

### set

▸ **set**(`position`, `direction`): `void`

Set the character's position and direction that its body is situated at and the head is looking
at. This uses `MathUtils.directionToQuaternion` to slerp the head's rotation to the new direction.

The `update` needs to be called to actually lerp to the new position and rotation.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `position` | `number`[] | The new position of the character. |
| `direction` | `number`[] | The new direction of the character. |

#### Returns

`void`

___

### setArmHoldingObject

▸ **setArmHoldingObject**(`object`, `side?`): `void`

Set the character's arm holding object.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> | `undefined` | The object to set as the arm holding object. |
| `side` | ``"left"`` \| ``"right"`` | `"right"` | - |

#### Returns

`void`

___

### setCrouching

▸ **setCrouching**(`crouching`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `crouching` | `boolean` |

#### Returns

`void`

___

### setRideAttitude

▸ **setRideAttitude**(`attitude`, `pivotDrop`, `seatDisplacement?`): `void`

Drive the character's whole-body lean from the mount it is riding, so
the rider stays perpendicular to the mount's back instead of bolt
upright. The rotation hinges at the seat, `pivotDrop` below the
character's origin, keeping the rider planted while the torso pitches
and rolls. The head keeps tracking the look direction in world space.

Push this every frame while riding; the body eases back upright once
pushes stop.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `attitude` | `Quaternion` | The world-space tilt of the mount (yaw-conjugated, i.e. without the mount's heading baked in). |
| `pivotDrop` | `number` | Distance from the character's origin down to the seat. |
| `seatDisplacement?` | `Vector3` | World-space offset from the physics-derived seat to the mount's rendered seat (rotation of the saddle about the mount's center, render-only bobbing, etc.), so the rider stays glued to the rendered mesh rather than floating at the raw seat point. |

#### Returns

`void`

___

### setSitting

▸ **setSitting**(`sitting`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `sitting` | `boolean` |

#### Returns

`void`

___

### setSwimming

▸ **setSwimming**(`swimming`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `swimming` | `boolean` |

#### Returns

`void`

___

### snapToTarget

▸ **snapToTarget**(): `void`

#### Returns

`void`

___

### update

▸ **update**(): `void`

Update the character's animation and rotation. After `set` is called, `update` must be called to
actually lerp to the new position and rotation. Note that when a character is attached to a control,
`update` is called automatically within the control's update loop.

#### Returns

`void`

___

### updateShadowUniforms

▸ **updateShadowUniforms**(`lightingUniforms`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `lightingUniforms` | [`ShaderLightingUniforms`](../interfaces/ShaderLightingUniforms.md) |

#### Returns

`void`
