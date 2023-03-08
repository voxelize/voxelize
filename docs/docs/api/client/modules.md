---
id: "modules"
title: "@voxelize/client"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Core Classes

- [Chat](classes/Chat.md)
- [Entities](classes/Entities.md)
- [Inputs](classes/Inputs.md)
- [Loader](classes/Loader.md)
- [Network](classes/Network.md)
- [Peers](classes/Peers.md)
- [RigidControls](classes/RigidControls.md)
- [World](classes/World.md)

## Effects Classes

- [BlockOverlayEffect](classes/BlockOverlayEffect.md)
- [ColorText](classes/ColorText.md)
- [LightShined](classes/LightShined.md)

## Other Classes

- [AnimatedTexture](classes/AnimatedTexture.md)
- [Arrow](classes/Arrow.md)
- [AtlasTexture](classes/AtlasTexture.md)
- [BlockRotation](classes/BlockRotation.md)
- [BoxLayer](classes/BoxLayer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Character](classes/Character.md)
- [Clouds](classes/Clouds.md)
- [Debug](classes/Debug.md)
- [Entity](classes/Entity.md)
- [Events](classes/Events.md)
- [FaceAnimation](classes/FaceAnimation.md)
- [ItemSlot](classes/ItemSlot.md)
- [ItemSlots](classes/ItemSlots.md)
- [Method](classes/Method.md)
- [NameTag](classes/NameTag.md)
- [Perspective](classes/Perspective.md)
- [Portrait](classes/Portrait.md)
- [Registry](classes/Registry.md)
- [Shadow](classes/Shadow.md)
- [Shadows](classes/Shadows.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [VoxelInteract](classes/VoxelInteract.md)
- [WorkerPool](classes/WorkerPool.md)

## Utils Classes

- [BlockUtils](classes/BlockUtils.md)
- [ChunkUtils](classes/ChunkUtils.md)
- [DOMUtils](classes/DOMUtils.md)
- [LightUtils](classes/LightUtils.md)
- [MathUtils](classes/MathUtils.md)

## Interfaces

- [NetIntercept](interfaces/NetIntercept.md)

## Type Aliases

### ArmsParams

Ƭ **ArmsParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-4) & { `shoulderDrop?`: `number` ; `shoulderGap?`: `number`  }

Parameters to create a character's arms.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  widthSegments: 8,
  height: 0.5 * CHARACTER_SCALE,
  heightSegments: 16,
  depth: 0.25 * CHARACTER_SCALE,
  depthSegments: 8,
  shoulderGap: 0.05 * CHARACTER_SCALE,
  shoulderDrop: 0.25 * CHARACTER_SCALE,
}
```

___

### ArrowParams

Ƭ **ArrowParams**: `Object`

Parameters to create an arrow.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `string` \| `Color` | The color of the arrow. Defaults to `red`. |
| `coneHeight` | `number` | The height of the head of the arrow. Defaults to `0.2`. |
| `coneRadius` | `number` | The radius of the head of the arrow. Defaults to `0.2`. |
| `height` | `number` | The height of the body of the arrow. Defaults to `0.8`. |
| `radius` | `number` | The radius of the body of the arrow. Defaults to `0.1`. |

___

### ArtFunction

Ƭ **ArtFunction**: (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void`

#### Type declaration

▸ (`context`, `canvas`): `void`

A function to programmatically draw on a canvas.

##### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |
| `canvas` | `HTMLCanvasElement` |

##### Returns

`void`

___

### Block

Ƭ **Block**: `Object`

A block type in the world. This is defined by the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `aabbs` | `AABB`[] | A list of axis-aligned bounding boxes that this block has. |
| `blueLightLevel` | `number` | The blue light level of the block. |
| `dynamicFn` | (`pos`: [`Coords3`](modules.md#coords3-4), `world`: [`World`](classes/World.md)) => { `aabbs`: [`Block`](modules.md#block-4)[``"aabbs"``] ; `faces`: [`Block`](modules.md#block-4)[``"faces"``] ; `isTransparent`: [`Block`](modules.md#block-4)[``"isTransparent"``]  } | If this block is dynamic, this function will be called to generate the faces and AABB's. By default, this just returns the faces and AABB's that are defined in the block data. |
| `faces` | { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `independent`: `boolean` ; `name`: `string` ; `range`: [`TextureRange`](modules.md#texturerange-4)  }[] | A list of block face data that this block has. |
| `greenLightLevel` | `number` | The green light level of the block. |
| `id` | `number` | The block id. |
| `independentFaces` | `Set`<`string`\> | A set of block face names that are independent (high resolution or animated). This is generated on the client side. |
| `isDynamic` | `boolean` | Whether or not does the block generate dynamic faces or AABB's. If this is true, the block will use `dynamicFn` to generate the faces and AABB's. |
| `isEmpty` | `boolean` | Whether or not is this block empty. By default, only "air" is empty. |
| `isFluid` | `boolean` | Whether or not is the block a fluid block. |
| `isLight` | `boolean` | Whether or not is this block a light source. |
| `isOpaque` | `boolean` | Whether or not is this block opaque (not transparent). |
| `isPassable` | `boolean` | Whether or not should physics ignore this block. |
| `isSeeThrough` | `boolean` | Whether or not is this block see-through (can be opaque and see-through at the same time). |
| `isTransparent` | `boolean`[] | Whether or not is this block transparent viewing from all six sides. The sides are defined as PX, PY, PZ, NX, NY, NZ. |
| `lightReduce` | `boolean` | Whether or not should light reduce by 1 going through this block. |
| `name` | `string` | The name of the block. |
| `redLightLevel` | `number` | The red light level of the block. |
| `rotatable` | `boolean` | Whether or not is the block rotatable. |
| `yRotatable` | `boolean` | Whether or not the block is rotatable around the y-axis (has to face either PX or NX). |

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

A block update to make on the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation?` | `number` | The optional rotation of the updated block. |
| `type` | `number` | The voxel type. |
| `vx` | `number` | The voxel x-coordinate. |
| `vy` | `number` | The voxel y-coordinate. |
| `vz` | `number` | The voxel z-coordinate. |
| `yRotation?` | `number` | The optional y-rotation of the updated block. |

___

### BodyParams

Ƭ **BodyParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-4)

Parameters to create a character's body.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 1 * CHARACTER_SCALE,
  widthSegments: 16,
}
```
where `CHARACTER_SCALE` is 0.9.

___

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"sides"`` \| ``"all"``

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

A CSS measurement. E.g. "30px", "51em"

___

### CameraPerspective

Ƭ **CameraPerspective**: ``"px"`` \| ``"nx"`` \| ``"py"`` \| ``"ny"`` \| ``"pz"`` \| ``"nz"`` \| ``"pxy"`` \| ``"nxy"`` \| ``"pxz"`` \| ``"nxz"`` \| ``"pyz"`` \| ``"nyz"`` \| ``"pxyz"`` \| ``"nxyz"``

___

### CanvasBoxParams

Ƭ **CanvasBoxParams**: `Object`

Parameters to create a canvas box.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `depth?` | `number` | The depth of the box. Defaults to whatever `width` is. |
| `depthSegments?` | `number` | The depth segments of the box, which is the number of pixels of the canvases along the depth. Defaults to whatever `widthSegments` is. |
| `gap` | `number` | The gap between the layers of the box. Defaults to `0`. |
| `height?` | `number` | The height of the box. Defaults to whatever `width` is. |
| `heightSegments?` | `number` | The height segments of the box, which is the number of pixels of the canvases along the height. Defaults to whatever `widthSegments` is. |
| `layers` | `number` | The number of layers of this box. Defaults to `1`. |
| `side` | `Side` | The side of the box to render. Defaults to `THREE.FrontSide`. |
| `transparent?` | `boolean` | Whether or not should this canvas box be rendered as transparent. Defaults to `false`. |
| `width` | `number` | THe width of the box. Defaults to `1`. |
| `widthSegments` | `number` | The width segments of the box, which is the number of pixels of the canvases along the width. Defaults to `8`. |

___

### CharacterParams

Ƭ **CharacterParams**: `Object`

Parameters to create a character.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `arms?` | `Partial`<[`ArmsParams`](modules.md#armsparams-4)\> | Parameters to create the character's arms. |
| `body?` | `Partial`<[`BodyParams`](modules.md#bodyparams-4)\> | Parameters to create the character's body. |
| `head?` | `Partial`<[`HeadParams`](modules.md#headparams-4)\> | Parameters to create the character's head. |
| `idleArmSwing?` | `number` | The speed at which the arms swing when the character is idle. Defaults to `0.06`. |
| `legs?` | `Partial`<[`LegParams`](modules.md#legparams-4)\> | Parameters to create the character's legs. |
| `positionLerp?` | `number` | The lerp factor of the character's position change. Defaults to `0.7`. |
| `rotationLerp?` | `number` | The lerp factor of the character's rotation change. Defaults to `0.2`. |
| `swingLerp?` | `number` | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`. |
| `walkingSpeed?` | `number` | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |

___

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

Three types of clicking for mouse input listening.

___

### CloudsParams

Ƭ **CloudsParams**: `Object`

Parameters used to create a new [Clouds](classes/Clouds.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `alpha` | `number` | The opacity of the clouds. Defaults to `0.8`. |
| `cloudHeight` | `number` | The y-height at which the clouds are generated. Defaults to `256`. |
| `color` | `string` | The color of the clouds. Defaults to `#fff`. |
| `count` | `number` | The number of cloud cells to generate, `count` * `count`. Defaults to `16`. |
| `dimensions` | [`Coords3`](modules.md#coords3-4) | The dimension of each cloud block. Defaults to `[20, 20, 20]`. |
| `falloff` | `number` | The noise falloff factor used to generate the clouds. Defaults to `0.9`. |
| `height` | `number` | The vertical count of how many cloud blocks are in a cloud cell. This is also used to determine the overall count of cloud blocks of all the clouds. Defaults to `3`. |
| `lerpFactor` | `number` | The lerp factor used to translate cloud blocks from their original position to their new position. Defaults to `0.3`. |
| `noiseScale` | `number` | The scale of the noise used to generate the clouds. Defaults to `0.08`. |
| `octaves` | `number` | The number of octaves used to generate the noise. Defaults to `5`. |
| `seed` | `number` | The seed used to generate the clouds. Defaults to `-1`. |
| `speedFactor` | `number` | The speed at which the clouds move. Defaults to `8`. |
| `threshold` | `number` | The threshold at which noise values are considered to be "cloudy" and should generate a new cloud block. Defaults to `0.05`. |
| `uFogColor?` | { `value`: `Color`  } | An object that is used as the uniform for the clouds fog color shader. |
| `uFogColor.value` | `Color` | - |
| `uFogFar?` | { `value`: `number`  } | An object that is used as the uniform for the clouds fog far shader. |
| `uFogFar.value` | `number` | - |
| `uFogNear?` | { `value`: `number`  } | An object that is used as the uniform for the clouds fog near shader. |
| `uFogNear.value` | `number` | - |
| `width` | `number` | The horizontal count of how many cloud blocks are in a cloud cell. Defaults to `8`. |

___

### CommandProcessor

Ƭ **CommandProcessor**: (`rest`: `string`) => `void`

#### Type declaration

▸ (`rest`): `void`

A process that gets run when a command is triggered.

##### Parameters

| Name | Type |
| :------ | :------ |
| `rest` | `string` |

##### Returns

`void`

___

### Coords2

Ƭ **Coords2**: [`number`, `number`]

___

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

___

### CullOptionsType

Ƭ **CullOptionsType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `dimensions` | [`Coords3`](modules.md#coords3-4) |
| `max` | [`Coords3`](modules.md#coords3-4) |
| `min` | [`Coords3`](modules.md#coords3-4) |
| `realMax` | [`Coords3`](modules.md#coords3-4) |
| `realMin` | [`Coords3`](modules.md#coords3-4) |

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
if you want to change its map, you also have to change its `uniforms.map`.

___

### DebugParams

Ƭ **DebugParams**: `Object`

Parameters to create a [Debug](classes/Debug.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `asyncPeriod` | `number` | - |
| `dataClass` | `string` | A class to add to the wrapper of the top-left debug panel. |
| `dataStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of the top-left debug panel. |
| `entriesClass` | `string` | A class to add to the wrapper of all debug entries. |
| `entryStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of all debug entries. |
| `lineClass` | `string` | A class to add to each of the debug entry line (top left). |
| `lineStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to each of the debug entry line (top left). |
| `onByDefault` | `boolean` | Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`. You can toggle the debug panel by calling [toggle](classes/Debug.md#toggle-4). |
| `showVoxelize` | `boolean` | Whether or not should `Voxelize x.x.x` be displayed in the top-left debug panel. Defaults to `true`. |
| `stats` | `boolean` | Whether or not should [stats.js](https://github.com/mrdoob/stats.js/) be enabled. Defaults to `true`. |

___

### DeepPartial

Ƭ **DeepPartial**<`T`\>: { [P in keyof T]?: DeepPartial<T[P]\> }

#### Type parameters

| Name |
| :------ |
| `T` |

___

### Event

Ƭ **Event**: `Object`

A Voxelize event from the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name to identify the event. |
| `payload?` | `any` | Additional information of the event. |

___

### EventHandler

Ƭ **EventHandler**: (`payload`: `any` \| ``null``) => `void`

#### Type declaration

▸ (`payload`): `void`

The handler for an event sent from the Voxelize server.

##### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | `any` \| ``null`` |

##### Returns

`void`

___

### HeadParams

Ƭ **HeadParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-4) & { `neckGap?`: `number`  }

Parameters to create a character's head.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.5 * CHARACTER_SCALE,
  widthSegments: 16,
  height: 0.25 * CHARACTER_SCALE,
  heightSegments: 8,
  depth: 0.5 * CHARACTER_SCALE,
  depthSegments: 16,
  neckGap: 0.05 * CHARACTER_SCALE,
}
```
where `CHARACTER_SCALE` is 0.9.

___

### InputOccasion

Ƭ **InputOccasion**: ``"keydown"`` \| ``"keypress"`` \| ``"keyup"``

The occasion that the input should be fired.

___

### InputSpecifics

Ƭ **InputSpecifics**: `Object`

The specific parameters of the key to listen to.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `identifier?` | `string` | A special identifier to tag this input with. This is useful for removing specific inputs from the input listener later on. |
| `occasion?` | [`InputOccasion`](modules.md#inputoccasion-4) | The occasion that the input should be fired. Defaults to `keydown`. |

___

### ItemSlotsParams

Ƭ **ItemSlotsParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `activatedByDefault` | `boolean` |
| `focusFirstByDefault` | `boolean` |
| `horizontalCount` | `number` |
| `perspective` | [`CameraPerspective`](modules.md#cameraperspective-4) |
| `slotClass` | `string` |
| `slotFocusClass` | `string` |
| `slotHoverClass` | `string` |
| `slotStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `slotSubscriptClass` | `string` |
| `slotSubscriptStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `verticalCount` | `number` |
| `wrapperClass` | `string` |
| `wrapperStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `zoom` | `number` |

___

### LegParams

Ƭ **LegParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-4) & { `betweenLegsGap?`: `number`  }

Parameters to create the legs of a character.
Defaults to:
```ts
{
  gap: 0.1 * CHARACTER_SCALE,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25 * CHARACTER_SCALE,
  widthSegments: 3,
  height: 0.25 * CHARACTER_SCALE,
  heightSegments: 3,
  depth: 0.25 * CHARACTER_SCALE,
  depthSegments: 3,
  betweenLegsGap: 0.2 * CHARACTER_SCALE,
}
```
where `CHARACTER_SCALE` is 0.9.

___

### LightColor

Ƭ **LightColor**: ``"RED"`` \| ``"GREEN"`` \| ``"BLUE"`` \| ``"SUNLIGHT"``

Sunlight or the color of torch light.

___

### LightShinedParams

Ƭ **LightShinedParams**: `Object`

Parameters to create a light shine effect.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `lerpFactor` | `number` | The lerping factor of the brightness of each mesh. Defaults to `0.1`. |

___

### MeshResultType

Ƭ **MeshResultType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `indices` | `Float32Array` |
| `normals` | `Float32Array` |
| `positions` | `Float32Array` |

___

### NameTagParams

Ƭ **NameTagParams**: `Object`

Parameters to create a name tag.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `backgroundColor?` | `string` | The background color of the name tag. Defaults to `0x00000077`. |
| `color?` | `string` | The color of the name tag. Defaults to `0xffffff`. |
| `fontFace?` | `string` | The font face to create the name tag. Defaults to `"monospace"`. |
| `fontSize?` | `number` | The font size to create the name tag. Defaults to `0.1`. |
| `yOffset?` | `number` | The y-offset of the nametag moved upwards. Defaults to `0`. |

___

### NetworkParams

Ƭ **NetworkParams**: `Object`

Parameters to customize the connection to a Voxelize server. For example, setting a secret
key to authenticate the connection with the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `reconnectTimeout?` | `number` | On disconnection, the timeout to attempt to reconnect. Defaults to 5000. |
| `secret?` | `string` | The secret to joining a server, a key that if set on the server, then must be provided to connect to the server successfully. |

___

### PartialRecord

Ƭ **PartialRecord**<`K`, `T`\>: { [P in K]?: T }

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof `any` |
| `T` | `T` |

___

### PeersParams

Ƭ **PeersParams**: `Object`

Parameters to customize the peers manager.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `countSelf` | `boolean` | Whether or not should the client themselves be counted as "updated". In other words, whether or not should the update function be called on the client's own data. Defaults to `false`. |
| `updateChildren` | `boolean` | Whether or not should the peers manager automatically call `update` on any children mesh. Defaults to `true`. |

___

### PerspectiveParams

Ƭ **PerspectiveParams**: `Object`

Parameters to create a new [Perspective](classes/Perspective.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `blockMargin` | `number` | The margin between the camera and any block that the camera is colliding with. This prevents the camera from clipping into blocks. Defaults to `0.3`. |
| `ignoreFluids` | `boolean` | Whether or not should the camera ignore fluid block collisions. Defaults to `true`. |
| `ignoreSeeThrough` | `boolean` | Whether or not should the camera ignore see-through block collisions. Defaults to `true`. |
| `lerpFactor` | `number` | The lerping factor for the camera's position. Defaults to `0.5`. |
| `maxDistance` | `number` | The maximum distance the camera can go from the player's center. Defaults to `5`. |

___

### PortraitParams

Ƭ **PortraitParams**: `Object`

Parameters to create a portrait with.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `height` | `number` | The height of the portrait canvas. Defaults to `100` pixels. |
| `lightRotationOffset` | `number` | The rotation around the y axis about the camera. This is used to calculate the position of the light. Defaults to `-Math.PI / 8`. |
| `perspective` | [`CameraPerspective`](modules.md#cameraperspective-4) | The position of where the camera should be looking at. Defaults to `pxyz`, which means that the camera will be looking at the center of the object from the positive x, y, and z axis scaled by the zoom. |
| `renderOnce` | `boolean` | Whether or not should this portrait only render once. Defaults to `false`. |
| `width` | `number` | The width of the portrait canvas. Defaults to `100` pixels. |
| `zoom` | `number` | The arbitrary zoom from the camera to the object. This is used to calculate the zoom of the camera. Defaults to `1`. |

___

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & { `sendEvent`: (`event`: `any`) => `void`  }

A custom WebSocket type that supports protocol buffer sending.

___

### RigidControlState

Ƭ **RigidControlState**: `Object`

The state of which a Voxelize Controls is in.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `crouching` | `boolean` | Whether if the client is attempting to crouch, if the crouch key is pressed. Defaults to `false`. |
| `currentJumpTime` | `number` | The current amount of time spent in the air from jump. Defaults to `0`. |
| `heading` | `number` | In radians, the heading y-rotation of the client. Defaults to `0`. |
| `isJumping` | `boolean` | Whether or not is the client jumping, in the air. Defaults to `false`. |
| `jumpCount` | `number` | How many times has the client jumped. Defaults to `0`. |
| `jumping` | `boolean` | Whether if the client is attempting to jump, if the jump key is pressed. Defaults to `false`. |
| `running` | `boolean` | Whether if the client is running. Defaults to `false`. |
| `sprinting` | `boolean` | Whether if the client is attempting to sprint, if the sprint key is pressed. Defaults to `false`. |

___

### RigidControlsParams

Ƭ **RigidControlsParams**: `Object`

Parameters to initialize the Voxelize Controls.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airJumps` | `number` | How many times can a client jump in the air. Defaults to `0`. |
| `airMoveMult` | `number` | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `alwaysSprint` | `boolean` | Sprint factor would be on always. Defaults to `false`. |
| `bodyDepth` | `number` | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | `number` | The height of the client's avatar. Defaults to `1.55` blocks. |
| `bodyWidth` | `number` | The width of the client's avatar. Defaults to `0.8` blocks. |
| `crouchFactor` | `number` | The factor to the movement speed when crouch is applied. Defaults to `0.6`. |
| `eyeHeight` | `number` | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.9193548387096774`. |
| `fluidPushForce` | `number` | The force upwards when a client tries to jump in water. Defaults to `0.3`. |
| `flyForce` | `number` | The level of force at which a client flies at. Defaults to `80`. |
| `flyImpulse` | `number` | The level impulse of which a client flies at. Defaults to `2.5`. |
| `flyInertia` | `number` | The inertia of a client when they're flying. Defaults to `6`. |
| `flySpeed` | `number` | The level of speed at which a client flies at. Defaults to `40`. |
| `initialPosition` | [`Coords3`](modules.md#coords3-4) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `maxSpeed` | `number` | The maximum level of speed of a client. Default is `6` . |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `moveForce` | `number` | The level of force of which the client can move at. Default is `30`. |
| `positionLerp` | `number` | The interpolation factor of the client's position. Defaults to `1.0`. |
| `responsiveness` | `number` | The level of responsiveness of a client to movements. Default is `240`. |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `runningFriction` | `number` | Default running friction of a client. Defaults to `0.1`. |
| `sensitivity` | `number` | The mouse sensitivity. Defaults to `100`. |
| `sprintFactor` | `number` | The factor to the movement speed when sprint is applied. Defaults to `1.4`. |
| `standingFriction` | `number` | Default standing friction of a client. Defaults to `4`. |
| `stepHeight` | `number` | How tall a client can step up. Defaults to `0.5`. |
| `stepLerp` | `number` | The interpolation factor when the client is auto-stepping. Defaults to `0.6`. |

___

### ShadowParams

Ƭ **ShadowParams**: `Object`

Parameters to create a shadow.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxDistance` | `number` | The maximum distance from the object to the ground to cast a shadow. The shadow's scale scales inversely with distance. Defaults to `10`. |
| `maxRadius` | `number` | The maximum radius the shadow can have. That is, the radius of the shadow when the object is on the ground. Defaults to `0.5`. |

___

### TextureRange

Ƭ **TextureRange**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `endU` | `number` |
| `endV` | `number` |
| `startU` | `number` |
| `startV` | `number` |

___

### VoxelInteractParams

Ƭ **VoxelInteractParams**: `Object`

Parameters to customize the [VoxelInteract](classes/VoxelInteract.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `highlightColor` | `Color` | The color of the highlight. Defaults to `0xffffff`. |
| `highlightLerp` | `number` | The lerping factor of the highlight. Defaults to `0.8`. |
| `highlightOpacity` | `number` | The opacity of the highlight. Defaults to `0.8`. |
| `highlightScale` | `number` | The scale of the block highlight. Defaults to `1.002`. |
| `highlightType` | ``"box"`` \| ``"outline"`` | The type of the block highlight. Box would be a semi-transparent box, while outline would be 12 lines that outline the block's AABB union. Defaults to `"box"`. |
| `ignoreFluids` | `boolean` | Whether or not should the [VoxelInteract](classes/VoxelInteract.md) instance ignore fluids when raycasting. Defaults to `true`. |
| `inverseDirection` | `boolean` | Whether or not should the [VoxelInteract](classes/VoxelInteract.md) instance reverse the raycasting direction. Defaults to `false`. |
| `potentialVisuals` | `boolean` | **`Debug`**  Whether or not should there be arrows indicating the potential block placement's orientations. Defaults to `false`. |
| `reachDistance` | `number` | The maximum distance of reach for the [VoxelInteract](classes/VoxelInteract.md) instance. Defaults to `32`. |

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

A worker pool job is queued to a worker pool and is executed by a worker.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `buffers?` | `ArrayBufferLike`[] | Any array buffers (transferable) that are passed to the worker. |
| `message` | `any` | A JSON serializable object that is passed to the worker. |
| `resolve` | (`value`: `any`) => `void` | A callback that is called when the worker has finished executing the job. |

___

### WorkerPoolParams

Ƭ **WorkerPoolParams**: `Object`

Parameters to create a worker pool.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxWorker` | `number` | The maximum number of workers to create. Defaults to `8`. |

___

### WorldClientParams

Ƭ **WorldClientParams**: `Object`

The client-side parameters to create a world. These are client-side only and can be customized to specific use.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `defaultRenderRadius` | `number` | The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks. |
| `generateMeshes` | `boolean` | Whether or not should the world generate ThreeJS meshes. Defaults to `true`. |
| `inViewPower` | `number` | - |
| `inViewRadius` | `number` | - |
| `maxProcessesPerTick` | `number` | The maximum amount of chunks received from the server that can be processed per tick. Defaults to `8` chunks. |
| `maxRequestsPerTick` | `number` | The maximum chunk requests this world can request from the server per tick. Defaults to `4` chunks. |
| `maxUpdatesPerTick` | `number` | The maximum voxel updates that can be sent to the server. Defaults to `1000` updates. |
| `minBrightness` | `number` | The minimum brightness of the chunk mesh even at sunlight and torch light level 0. Defaults to `0.04`. |
| `rerequestTicks` | `number` | The ticks until a chunk should be re-requested to the server. Defaults to `300` ticks. |
| `textureDimension` | `number` | The default dimension to a block texture. If any texture loaded is greater, it will be downscaled to this resolution. |

___

### WorldParams

Ƭ **WorldParams**: [`WorldClientParams`](modules.md#worldclientparams-4) & [`WorldServerParams`](modules.md#worldserverparams-4)

___

### WorldServerParams

Ƭ **WorldServerParams**: `Object`

The parameters defined on the server-side, passed to the client on connection.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airDrag` | `number` | The air drag of everything physical. |
| `chunkSize` | `number` | The width and depth of a chunk, in blocks. |
| `fluidDensity` | `number` | - |
| `fluidDrag` | `number` | - |
| `gravity` | `number`[] | The gravity of everything physical in this world. |
| `maxChunk` | [`number`, `number`] | The maximum chunk coordinate of this world, inclusive. |
| `maxHeight` | `number` | The height of a chunk, in blocks. |
| `maxLightLevel` | `number` | The maximum light level that propagates in this world, including sunlight and torch light. |
| `minBounceImpulse` | `number` | The minimum bouncing impulse of everything physical in this world. |
| `minChunk` | [`number`, `number`] | The minimum chunk coordinate of this world, inclusive. |
| `subChunks` | `number` | The amount of sub-chunks that divides a chunk vertically. |

## Variables

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: ``"BLUE"``

The string representation of blue light.

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: [`BoxSides`](modules.md#boxsides-4)[]

The six default faces of a canvas box.

___

### DEFAULT\_CHUNK\_SHADERS

• `Const` **DEFAULT\_CHUNK\_SHADERS**: `Object`

This is the default shaders used for the chunks.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fragment` | `string` |
| `vertex` | `string` |

___

### GREEN\_LIGHT

• `Const` **GREEN\_LIGHT**: ``"GREEN"``

The string representation of green light.

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: ``3``

The numerical representation of the negative X rotation.

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: ``1``

The numerical representation of the negative Y rotation.

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: ``5``

The numerical representation of the negative Z rotation.

___

### OPAQUE\_RENDER\_ORDER

• `Const` **OPAQUE\_RENDER\_ORDER**: ``100``

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: ``2``

The numerical representation of the positive X rotation.

___

### PY\_ROTATION

• `Const` **PY\_ROTATION**: ``0``

The numerical representation of the positive Y rotation.

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: ``4``

The numerical representation of the positive Z rotation.

___

### RED\_LIGHT

• `Const` **RED\_LIGHT**: ``"RED"``

The string representation of red light.

___

### SUNLIGHT

• `Const` **SUNLIGHT**: ``"SUNLIGHT"``

The string representation of sunlight.

___

### TRANSPARENT\_RENDER\_ORDER

• `Const` **TRANSPARENT\_RENDER\_ORDER**: ``100000``

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: `any`[] = `[]`

A rotational map used to get the closest y-rotation representation to a y-rotation value.

___

### Y\_ROT\_SEGMENTS

• `Const` **Y\_ROT\_SEGMENTS**: ``16``

The amount of Y-rotation segments should be allowed for y-rotatable blocks. In other words,
the amount of times the block can be rotated around the y-axis within 360 degrees.

The accepted Y-rotation values will be from `0` to `Y_ROTATION_SEGMENTS - 1`.

___

### artFunctions

• `Const` **artFunctions**: `Object`

A preset of art functions to draw on canvas boxes.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `drawCrown` | [`ArtFunction`](modules.md#artfunction-4) |
| `drawSun` | [`ArtFunction`](modules.md#artfunction-4) |

___

### customShaders

• `Const` **customShaders**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `sway` | (`params`: `Partial`<{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number`  }\>) => { `fragmentShader`: `string` = DEFAULT\_CHUNK\_SHADERS.fragment; `vertexShader`: `string`  } |

## Functions

### TRANSPARENT\_SORT

▸ **TRANSPARENT_SORT**(`object`): (`a`: `any`, `b`: `any`) => `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

`fn`

▸ (`a`, `b`): `number`

##### Parameters

| Name | Type |
| :------ | :------ |
| `a` | `any` |
| `b` | `any` |

##### Returns

`number`

___

### cull

▸ **cull**(`array`, `options`): `Promise`<[`MeshResultType`](modules.md#meshresulttype-4)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype-4) |

#### Returns

`Promise`<[`MeshResultType`](modules.md#meshresulttype-4)\>
