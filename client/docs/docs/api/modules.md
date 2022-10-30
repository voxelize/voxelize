---
id: "modules"
title: "@voxelize/client"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Core Classes

- [RigidControls](classes/RigidControls.md)
- [Inputs](classes/Inputs.md)
- [Network](classes/Network.md)
- [Peers](classes/Peers.md)
- [World](classes/World.md)
- [Registry](classes/Registry.md)

## Effects Classes

- [BlockOverlayEffect](classes/BlockOverlayEffect.md)
- [LightShined](classes/LightShined.md)

## Other Classes

- [Chat](classes/Chat.md)
- [Entities](classes/Entities.md)
- [Events](classes/Events.md)
- [TextureAtlas](classes/TextureAtlas.md)
- [BlockRotation](classes/BlockRotation.md)
- [ChunkMesh](classes/ChunkMesh.md)
- [Chunk](classes/Chunk.md)
- [Chunks](classes/Chunks.md)
- [Arrow](classes/Arrow.md)
- [BoxLayer](classes/BoxLayer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Character](classes/Character.md)
- [Clouds](classes/Clouds.md)
- [ColorText](classes/ColorText.md)
- [Debug](classes/Debug.md)
- [ImageVoxelizer](classes/ImageVoxelizer.md)
- [NameTag](classes/NameTag.md)
- [Rigid](classes/Rigid.md)
- [Perspective](classes/Perspective.md)
- [Shadow](classes/Shadow.md)
- [Shadows](classes/Shadows.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [VoxelInteract](classes/VoxelInteract.md)
- [WorkerPool](classes/WorkerPool.md)

## Particles Classes

- [BlockBreakParticles](classes/BlockBreakParticles.md)

## Utils Classes

- [BlockUtils](classes/BlockUtils.md)
- [ChunkUtils](classes/ChunkUtils.md)
- [DOMUtils](classes/DOMUtils.md)
- [LightUtils](classes/LightUtils.md)
- [MathUtils](classes/MathUtils.md)

## Interfaces

- [NetIntercept](interfaces/NetIntercept.md)

## Variables

### TRANSPARENT\_RENDER\_ORDER

• `Const` **TRANSPARENT\_RENDER\_ORDER**: ``100000``

___

### OPAQUE\_RENDER\_ORDER

• `Const` **OPAQUE\_RENDER\_ORDER**: ``100``

___

### PY\_ROTATION

• `Const` **PY\_ROTATION**: ``0``

The numerical representation of the positive Y rotation.

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: ``1``

The numerical representation of the negative Y rotation.

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: ``2``

The numerical representation of the positive X rotation.

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: ``3``

The numerical representation of the negative X rotation.

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: ``4``

The numerical representation of the positive Z rotation.

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: ``5``

The numerical representation of the negative Z rotation.

___

### Y\_ROT\_SEGMENTS

• `Const` **Y\_ROT\_SEGMENTS**: ``16``

The amount of Y-rotation segments should be allowed for y-rotatable blocks. In other words,
the amount of times the block can be rotated around the y-axis within 360 degrees.

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: `any`[] = `[]`

A rotational map used to get the closest y-rotation representation to a y-rotation value.

___

### ALL\_FACES

• `Const` **ALL\_FACES**: `string`[]

___

### SIDE\_FACES

• `Const` **SIDE\_FACES**: `string`[]

___

### DIAGONAL\_FACES

• `Const` **DIAGONAL\_FACES**: `string`[]

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: [`BoxSides`](modules.md#boxsides-556)[]

The six default faces of a canvas box.

___

### artFunctions

• `Const` **artFunctions**: `Object`

A preset of art functions to draw on canvas boxes.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `drawCrown` | [`ArtFunction`](modules.md#artfunction-556) |
| `drawSun` | [`ArtFunction`](modules.md#artfunction-556) |

___

### RED\_LIGHT

• `Const` **RED\_LIGHT**: ``"RED"``

The string representation of red light.

___

### GREEN\_LIGHT

• `Const` **GREEN\_LIGHT**: ``"GREEN"``

The string representation of green light.

___

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: ``"BLUE"``

The string representation of blue light.

___

### SUNLIGHT

• `Const` **SUNLIGHT**: ``"SUNLIGHT"``

The string representation of sunlight.

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

▸ **cull**(`array`, `options`): `Promise`<[`MeshResultType`](modules.md#meshresulttype-556)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype-556) |

#### Returns

`Promise`<[`MeshResultType`](modules.md#meshresulttype-556)\>

## Type Aliases

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

### RigidControlState

Ƭ **RigidControlState**: `Object`

The state of which a Voxelize {@link Controls} is in.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `heading` | `number` | In radians, the heading y-rotation of the client. Defaults to `0`. |
| `running` | `boolean` | Whether if the client is running. Defaults to `false`. |
| `jumping` | `boolean` | Whether if the client is attempting to jump, if the jump key is pressed. Defaults to `false`. |
| `sprinting` | `boolean` | Whether if the client is attempting to sprint, if the sprint key is pressed. Defaults to `false`. |
| `crouching` | `boolean` | Whether if the client is attempting to crouch, if the crouch key is pressed. Defaults to `false`. |
| `jumpCount` | `number` | How many times has the client jumped. Defaults to `0`. |
| `isJumping` | `boolean` | Whether or not is the client jumping, in the air. Defaults to `false`. |
| `currentJumpTime` | `number` | The current amount of time spent in the air from jump. Defaults to `0`. |

___

### RigidControlsParams

Ƭ **RigidControlsParams**: `Object`

Parameters to initialize the Voxelize {@link Controls}.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `sensitivity` | `number` | The mouse sensitivity. Defaults to `100`. |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `initialPosition` | [`Coords3`](modules.md#coords3-556) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `fluidPushForce` | `number` | The force upwards when a client tries to jump in water. Defaults to `0.3`. |
| `positionLerp` | `number` | The interpolation factor of the client's position. Defaults to `0.9`. |
| `bodyWidth` | `number` | The width of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | `number` | The height of the client's avatar. Defaults to `1.55` blocks. |
| `bodyDepth` | `number` | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `eyeHeight` | `number` | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.919`. |
| `maxSpeed` | `number` | The maximum level of speed of a client. Default is `6` . |
| `moveForce` | `number` | The level of force of which the client can move at. Default is `30`. |
| `responsiveness` | `number` | The level of responsiveness of a client to movements. Default is `240`. |
| `runningFriction` | `number` | Default running friction of a client. Defaults to `0.1`. |
| `standingFriction` | `number` | Default standing friction of a client. Defaults to `4`. |
| `flySpeed` | `number` | The level of speed at which a client flies at. Defaults to `40`. |
| `flyForce` | `number` | The level of force at which a client flies at. Defaults to `80`. |
| `flyImpulse` | `number` | The level impulse of which a client flies at. Defaults to `2.5`. |
| `flyInertia` | `number` | The inertia of a client when they're flying. Defaults to `6`. |
| `sprintFactor` | `number` | The factor to the movement speed when sprint is applied. Defaults to `1.4`. |
| `crouchFactor` | `number` | The factor to the movement speed when crouch is applied. Defaults to `0.6`. |
| `alwaysSprint` | `boolean` | Sprint factor would be on always. |
| `airMoveMult` | `number` | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `airJumps` | `number` | How many times can a client jump in the air. Defaults to `0`. |
| `stepHeight` | `number` | How tall a client can step up. Defaults to `0.5`. |

___

### Event

Ƭ **Event**: `Object`

A Voxelize event.

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

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

Three types of clicking for mouse input listening.

___

### InputOccasion

Ƭ **InputOccasion**: ``"keydown"`` \| ``"keypress"`` \| ``"keyup"``

The occasion that the input should be fired.

___

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & { `sendEvent`: (`event`: `any`) => `void`  }

A custom WebSocket type that supports protocol buffer sending.

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

### TextureAtlasParams

Ƭ **TextureAtlasParams**: `Object`

Parameters to create a new texture atlas.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `countPerSide` | `number` | The number of block textures on each side of the atlas. |
| `dimension` | `number` | The dimension of each block texture. |

___

### Block

Ƭ **Block**: `Object`

A block type in the world.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The block id. |
| `name` | `string` | The name of the block. |
| `redLightLevel` | `number` | The red light level of the block. |
| `greenLightLevel` | `number` | The green light level of the block. |
| `blueLightLevel` | `number` | The blue light level of the block. |
| `rotatable` | `boolean` | Whether or not is the block rotatable. |
| `yRotatable` | `boolean` | Whether or not the block is rotatable around the y-axis (has to face either PX or NX). |
| `isEmpty` | `boolean` | Whether or not is this block empty. By default, only "air" is empty. |
| `isFluid` | `boolean` | Whether or not is the block a fluid block. |
| `isLight` | `boolean` | Whether or not is this block a light source. |
| `isPassable` | `boolean` | Whether or not should physics ignore this block. |
| `isOpaque` | `boolean` | Whether or not is this block opaque (not transparent). |
| `isSeeThrough` | `boolean` | Whether or not is this block see-through (can be opaque and see-through at the same time). |
| `isPxTransparent` | `boolean` | Whether or not is this block transparent on the positive x direction. |
| `isNxTransparent` | `boolean` | Whether or not is this block transparent on the negative x direction. |
| `isPyTransparent` | `boolean` | Whether or not is this block transparent on the positive y direction. |
| `isNyTransparent` | `boolean` | Whether or not is this block transparent on the negative y direction. |
| `isPzTransparent` | `boolean` | Whether or not is this block transparent on the positive z direction. |
| `isNzTransparent` | `boolean` | Whether or not is this block transparent on the negative z direction. |
| `faces` | { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `name`: `string`  }[] | A list of block face data that this block has. |
| `aabbs` | `AABB`[] | A list of axis-aligned bounding boxes that this block has. |
| `lightReduce` | `boolean` | Whether or not should light reduce by 1 going through this block. |

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

A block update to make on the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel x-coordinate. |
| `vy` | `number` | The voxel y-coordinate. |
| `vz` | `number` | The voxel z-coordinate. |
| `type` | `number` | The voxel type. |
| `rotation?` | `number` | The optional rotation of the updated block. |
| `yRotation?` | `number` | The optional y-rotation of the updated block. |

___

### SkyFace

Ƭ **SkyFace**: [`ArtFunction`](modules.md#artfunction-556) \| `Color` \| `string` \| ``null``

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.

___

### WorldClientParams

Ƭ **WorldClientParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `inViewRadius` | `number` |
| `maxRequestsPerTick` | `number` |
| `maxProcessesPerTick` | `number` |
| `maxUpdatesPerTick` | `number` |
| `maxAddsPerTick` | `number` |
| `minBrightness` | `number` |
| `rerequestTicks` | `number` |
| `defaultRenderRadius` | `number` |
| `defaultDeleteRadius` | `number` |
| `textureDimension` | `number` |
| `updateTimeout` | `number` |

___

### WorldServerParams

Ƭ **WorldServerParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `subChunks` | `number` |
| `chunkSize` | `number` |
| `maxHeight` | `number` |
| `maxLightLevel` | `number` |
| `minChunk` | [`number`, `number`] |
| `maxChunk` | [`number`, `number`] |
| `gravity` | `number`[] |
| `minBounceImpulse` | `number` |
| `airDrag` | `number` |
| `fluidDrag` | `number` |
| `fluidDensity` | `number` |

___

### WorldParams

Ƭ **WorldParams**: [`WorldClientParams`](modules.md#worldclientparams-556) & [`WorldServerParams`](modules.md#worldserverparams-556)

___

### TextureRange

Ƭ **TextureRange**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `startU` | `number` |
| `endU` | `number` |
| `startV` | `number` |
| `endV` | `number` |

___

### TextureData

Ƭ **TextureData**: `Object`

Data passed to [applyTextureByName](classes/World.md#applytexturebyname-556) or [applyTexturesByNames](classes/World.md#applytexturesbynames-556) to load a block texture.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to load. E.g. "Dirt". |
| `sides` | `string`[] \| `string` | The sides that this data loads onto. |
| `data` | `string` \| `Color` | Either the URL to the source image, or a ThreeJS color instance. |

___

### RegistryParams

Ƭ **RegistryParams**: `Object`

Parameters to initialize the registry.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dimension` | `number` | The dimension of each registered block texture. Defaults to `8`. |

___

### ArrowParams

Ƭ **ArrowParams**: `Object`

Parameters to create an arrow.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `radius` | `number` | The radius of the body of the arrow. Defaults to `0.1`. |
| `height` | `number` | The height of the body of the arrow. Defaults to `0.8`. |
| `coneRadius` | `number` | The radius of the head of the arrow. Defaults to `0.2`. |
| `coneHeight` | `number` | The height of the head of the arrow. Defaults to `0.2`. |
| `color` | `string` \| `Color` | The color of the arrow. Defaults to `red`. |

___

### CanvasBoxParams

Ƭ **CanvasBoxParams**: `Object`

Parameters to create a canvas box.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `gap` | `number` | The gap between the layers of the box. Defaults to `0`. |
| `layers` | `number` | The number of layers of this box. Defaults to `1`. |
| `width` | `number` | THe width of the box. Defaults to `1`. |
| `height?` | `number` | The height of the box. Defaults to `1`. |
| `depth?` | `number` | The depth of the box. Defaults to `1`. |
| `widthSegments` | `number` | The width segments of the box, which is the number of pixels of the canvases along the width. Defaults to `8`. |
| `heightSegments?` | `number` | The height segments of the box, which is the number of pixels of the canvases along the height. Defaults to `8`. |
| `depthSegments?` | `number` | The depth segments of the box, which is the number of pixels of the canvases along the depth. Defaults to `8`. |
| `side` | `Side` | The side of the box to render. Defaults to `THREE.FrontSide`. |
| `transparent?` | `boolean` | Whether or not should this canvas box be rendered as transparent. Defaults to `false`. |

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

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"sides"`` \| ``"all"``

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

___

### HeadParams

Ƭ **HeadParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-556) & { `neckGap?`: `number`  }

Parameters to create a character's head.
Defaults to:
```ts
{
  gap: 0.1,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.5,
  widthSegments: 16,
  height: 0.25,
  heightSegments: 8,
  depth: 0.5,
  depthSegments: 16,
  neckGap: 0.05,
}
```

___

### BodyParams

Ƭ **BodyParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-556)

Parameters to create a character's body.
Defaults to:
```ts
{
  gap: 0.1,
  layers: 1,
  side: THREE.DoubleSide,
  width: 1,
  widthSegments: 16,
}
```

___

### LegParams

Ƭ **LegParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-556) & { `betweenLegsGap?`: `number`  }

Parameters to create the legs of a character.
Defaults to:
```ts
{
  gap: 0.1,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25,
  widthSegments: 3,
  height: 0.25,
  heightSegments: 3,
  depth: 0.25,
  depthSegments: 3,
  betweenLegsGap: 0.2,
}
```

___

### ArmsParams

Ƭ **ArmsParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-556) & { `shoulderDrop?`: `number` ; `shoulderGap?`: `number`  }

Parameters to create a character's arms.
Defaults to:
```ts
{
  gap: 0.1,
  layers: 1,
  side: THREE.DoubleSide,
  width: 0.25,
  widthSegments: 8,
  height: 0.5,
  heightSegments: 16,
  depth: 0.25,
  depthSegments: 8,
  shoulderGap: 0.05,
  shoulderDrop: 0.25,
}
```

___

### CharacterParams

Ƭ **CharacterParams**: `Object`

Parameters to create a character.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `swingLerp?` | `number` | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`. |
| `walkingSpeed?` | `number` | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |
| `idleArmSwing?` | `number` | The speed at which the arms swing when the character is idle. Defaults to `0.06`. |
| `positionLerp?` | `number` | The lerp factor of the character's position change. Defaults to `0.7`. |
| `rotationLerp?` | `number` | The lerp factor of the character's rotation change. Defaults to `0.2`. |
| `head?` | `Partial`<[`HeadParams`](modules.md#headparams-556)\> | Parameters to create the character's head. |
| `body?` | `Partial`<[`BodyParams`](modules.md#bodyparams-556)\> | Parameters to create the character's body. |
| `legs?` | `Partial`<[`LegParams`](modules.md#legparams-556)\> | Parameters to create the character's legs. |
| `arms?` | `Partial`<[`ArmsParams`](modules.md#armsparams-556)\> | Parameters to create the character's arms. |

___

### CloudsParams

Ƭ **CloudsParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `scale` | `number` |
| `width` | `number` |
| `height` | `number` |
| `worldHeight` | `number` |
| `dimensions` | [`Coords3`](modules.md#coords3-556) |
| `threshold` | `number` |
| `lerpFactor` | `number` |
| `speedFactor` | `number` |
| `color` | `string` |
| `alpha` | `number` |
| `seed` | `number` |
| `count` | `number` |
| `octaves` | `number` |
| `falloff` | `number` |
| `uFogNear?` | { `value`: `number`  } |
| `uFogNear.value` | `number` |
| `uFogFar?` | { `value`: `number`  } |
| `uFogFar.value` | `number` |
| `uFogColor?` | { `value`: `Color`  } |
| `uFogColor.value` | `Color` |

___

### MeshResultType

Ƭ **MeshResultType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `positions` | `Float32Array` |
| `normals` | `Float32Array` |
| `indices` | `Float32Array` |

___

### CullOptionsType

Ƭ **CullOptionsType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `min` | [`Coords3`](modules.md#coords3-556) |
| `max` | [`Coords3`](modules.md#coords3-556) |
| `realMin` | [`Coords3`](modules.md#coords3-556) |
| `realMax` | [`Coords3`](modules.md#coords3-556) |
| `dimensions` | [`Coords3`](modules.md#coords3-556) |

___

### DebugParams

Ƭ **DebugParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `stats` | `boolean` |
| `tweakpane` | `boolean` |
| `onByDefault` | `boolean` |
| `entryStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `entryClass` | `string` |
| `lineStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `lineClass` | `string` |
| `dataStyles` | `Partial`<`CSSStyleDeclaration`\> |
| `dataClass` | `string` |
| `showVoxelize` | `boolean` |

___

### LightShinedParams

Ƭ **LightShinedParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lerpFactor` | `number` |

___

### ImageVoxelizerParams

Ƭ **ImageVoxelizerParams**: `Object`

Parameters to process an image voxelization.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `width` | `number` | The width, in blocks, of the voxelized image. Defaults to `64`. |
| `height` | `number` | The height, in blocks, of the voxelized image. Defaults to `64`. |
| `lockedRatio` | `boolean` | Whether or not should the ratio between width and height be locked. If true, the width would be ignored and be later determined form the height. Defaults to `false`. |
| `orientation` | ``"x"`` \| ``"z"`` | Which direction to place the voxelized image. |

___

### BlockBreakParticlesParams

Ƭ **BlockBreakParticlesParams**: `Object`

Parameters to create a block break particle system.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `minCount` | `number` | The minimum count of a particle to be emitted per block break. Defaults to `15`. |
| `maxCount` | `number` | The maximum count of a particle to be emitted per block break. Defaults to `25`. |
| `capSize` | `number` | The maximum block breaks for a regular particle emission. Otherwise, a burst is emitted. Defaults to `5`. |
| `capScale` | `number` | The scale of which the lifespans of the particles that are emitted in bursts are scaled. Defaults to `0.1`. |
| `scale` | `number` | The size of the rigid particles. Defaults to `0.1`. |
| `impulse` | `number` | The initial impulse of the rigid particles. Defaults to `3`. |
| `minLife` | `number` | The minimum lifespan of the particles. Defaults to `2`. |
| `maxLife` | `number` | The maximum lifespan of the particles. Defaults to `4`. |
| `zoneWidth` | `number` | Around the center of the block break, the dimension of the box-sized zone in which the particles are emitted from. Defaults to `1`. |

___

### PerspectiveParams

Ƭ **PerspectiveParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxDistance` | `number` |
| `blockMargin` | `number` |
| `lerpFactor` | `number` |

___

### ShadowParams

Ƭ **ShadowParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxDistance` | `number` |
| `maxRadius` | `number` |

___

### VoxelInteractParams

Ƭ **VoxelInteractParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `reachDistance` | `number` |
| `ignoreFluid` | `boolean` |
| `inverseDirection` | `boolean` |
| `highlightScale` | `number` |
| `highlightType` | ``"box"`` \| ``"outline"`` |
| `highlightLerp` | `number` |
| `highlightColor` | `Color` |
| `highlightOpacity` | `number` |
| `potentialVisuals` | `boolean` |

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `message` | `any` |
| `buffers?` | `ArrayBufferLike`[] |
| `resolve` | (`value`: `any`) => `void` |

___

### WorkerPoolParams

Ƭ **WorkerPoolParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxWorker` | `number` |

___

### DeepPartial

Ƭ **DeepPartial**<`T`\>: { [P in keyof T]?: DeepPartial<T[P]\> }

#### Type parameters

| Name |
| :------ |
| `T` |

___

### PartialRecord

Ƭ **PartialRecord**<`K`, `T`\>: { [P in K]?: T }

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof `any` |
| `T` | `T` |

___

### Coords2

Ƭ **Coords2**: [`number`, `number`]

___

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

A CSS measurement. E.g. "30px", "51em"

___

### LightColor

Ƭ **LightColor**: ``"RED"`` \| ``"GREEN"`` \| ``"BLUE"`` \| ``"SUNLIGHT"``

Sunlight or the color of torch light.
