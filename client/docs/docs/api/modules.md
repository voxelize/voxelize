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

## Other Classes

- [Chat](classes/Chat.md)
- [Entities](classes/Entities.md)
- [Events](classes/Events.md)
- [TextureAtlas](classes/TextureAtlas.md)
- [BlockRotation](classes/BlockRotation.md)
- [ChunkMesh](classes/ChunkMesh.md)
- [Chunk](classes/Chunk.md)
- [Chunks](classes/Chunks.md)
- [BoxLayer](classes/BoxLayer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Clouds](classes/Clouds.md)
- [ColorText](classes/ColorText.md)
- [Entity](classes/Entity.md)
- [Component](classes/Component.md)
- [System](classes/System.md)
- [ECS](classes/ECS.md)
- [Head](classes/Head.md)
- [ImageVoxelizer](classes/ImageVoxelizer.md)
- [NameTag](classes/NameTag.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [WorkerPool](classes/WorkerPool.md)
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

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: ``1``

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: ``2``

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: ``3``

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: ``4``

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: ``5``

___

### Y\_000\_ROTATION

• `Const` **Y\_000\_ROTATION**: ``0``

___

### Y\_045\_ROTATION

• `Const` **Y\_045\_ROTATION**: ``1``

___

### Y\_090\_ROTATION

• `Const` **Y\_090\_ROTATION**: ``2``

___

### Y\_135\_ROTATION

• `Const` **Y\_135\_ROTATION**: ``3``

___

### Y\_180\_ROTATION

• `Const` **Y\_180\_ROTATION**: ``4``

___

### Y\_225\_ROTATION

• `Const` **Y\_225\_ROTATION**: ``5``

___

### Y\_270\_ROTATION

• `Const` **Y\_270\_ROTATION**: ``6``

___

### Y\_315\_ROTATION

• `Const` **Y\_315\_ROTATION**: ``7``

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: `number`[][]

___

### defaultParams

• `Const` **defaultParams**: [`CanvasBoxParams`](modules.md#canvasboxparams)

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: `string`[]

___

### RedLight

• `Const` **RedLight**: ``"RED"``

___

### GreenLight

• `Const` **GreenLight**: ``"GREEN"``

___

### BlueLight

• `Const` **BlueLight**: ``"BLUE"``

___

### Sunlight

• `Const` **Sunlight**: ``"SUNLIGHT"``

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
| `lookBlockScale` | `number` | The scale of the outline of the looking block. Defaults to `1.002`. |
| `lookBlockColor` | `string` | The color of the outline of the looking block. Defaults to `black`. |
| `lookBlockLerp` | `number` | The interpolation factor of the looking block changing. Defaults to `1`, immediate changes. |
| `lookInGhostMode` | `boolean` | Allow client to look at blocks even in ghost mode. Defaults to `false`. |
| `reachDistance` | `number` | The maximum distance a client can reach a block. Defaults to `32`. |
| `initialPosition` | [`Coords3`](modules.md#coords3) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `positionLerp` | `number` | The interpolation factor of the client's position. Defaults to `0.9`. |
| `bodyWidth` | `number` | The width of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | `number` | The height of the client's avatar. Defaults to `1.8` blocks. |
| `bodyDepth` | `number` | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `eyeHeight` | `number` | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.8`. |
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
| `alwaysSprint` | `boolean` | Sprint factor would be on always. |
| `airMoveMult` | `number` | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `airJumps` | `number` | How many times can a client jump in the air. Defaults to `0`. |

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

Parameters to initializing a Voxelize [Network](classes/Network.md) connection to the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `serverURL` | `string` | The HTTP url to the backend. Example: `http://localhost:4000` |
| `reconnectTimeout?` | `number` | On disconnection, the timeout to attempt to reconnect. Defaults to 5000. |
| `secret?` | `string` | The secret to joining a server. |

___

### Block

Ƭ **Block**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `name` | `string` |
| `redLightLevel` | `number` |
| `greenLightLevel` | `number` |
| `blueLightLevel` | `number` |
| `rotatable` | `boolean` |
| `yRotatable` | `boolean` |
| `isBlock` | `boolean` |
| `isEmpty` | `boolean` |
| `isFluid` | `boolean` |
| `isLight` | `boolean` |
| `isPlant` | `boolean` |
| `isPlantable` | `boolean` |
| `isOpaque` | `boolean` |
| `isSeeThrough` | `boolean` |
| `isPxTransparent` | `boolean` |
| `isNxTransparent` | `boolean` |
| `isPyTransparent` | `boolean` |
| `isNyTransparent` | `boolean` |
| `isPzTransparent` | `boolean` |
| `isNzTransparent` | `boolean` |
| `transparentStandalone` | `boolean` |
| `faces` | { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `name`: `string`  }[] |
| `aabbs` | `AABB`[] |

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
| `rotation?` | [`BlockRotation`](classes/BlockRotation.md) | The optional rotation of the updated block. |

___

### SkyFace

Ƭ **SkyFace**: [`ArtFunction`](modules.md#artfunction) \| `Color` \| `string` \| ``null``

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
| `defaultRenderRadius` | `number` |
| `defaultDeleteRadius` | `number` |
| `textureDimension` | `number` |

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

Ƭ **WorldParams**: [`WorldClientParams`](modules.md#worldclientparams) & [`WorldServerParams`](modules.md#worldserverparams)

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

Data passed to [applyTextureByName](classes/World.md#applytexturebyname) or [applyTexturesByNames](classes/World.md#applytexturesbynames) to load a block texture.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to load. E.g. "Dirt". |
| `sides` | `string`[] | The sides that this data loads onto. |
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

### CanvasBoxParams

Ƭ **CanvasBoxParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `gap` | `number` |
| `layers` | `number` |
| `width` | `number` |
| `dimension` | `number` |
| `side` | `Side` |

___

### ArtFunction

Ƭ **ArtFunction**: (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`, `width?`: `number`, `dimension?`: `number`) => `void`

#### Type declaration

▸ (`context`, `canvas`, `width?`, `dimension?`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |
| `canvas` | `HTMLCanvasElement` |
| `width?` | `number` |
| `dimension?` | `number` |

##### Returns

`void`

___

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"all"`` \| ``"sides"``

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
| `dimensions` | [`Coords3`](modules.md#coords3) |
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
| `min` | [`Coords3`](modules.md#coords3) |
| `max` | [`Coords3`](modules.md#coords3) |
| `realMin` | [`Coords3`](modules.md#coords3) |
| `realMax` | [`Coords3`](modules.md#coords3) |
| `dimensions` | [`Coords3`](modules.md#coords3) |

___

### Susbcription

Ƭ **Susbcription**: (`entity`: [`Entity`](classes/Entity.md), `added?`: [`Component`](classes/Component.md)<`any`\>, `removed?`: [`Component`](classes/Component.md)<`any`\>) => `void`

#### Type declaration

▸ (`entity`, `added?`, `removed?`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](classes/Entity.md) |
| `added?` | [`Component`](classes/Component.md)<`any`\> |
| `removed?` | [`Component`](classes/Component.md)<`any`\> |

##### Returns

`void`

___

### ComponentClassType

Ƭ **ComponentClassType**<`P`\>: (`data?`: `P`) => [`Component`](classes/Component.md)<`P`\> & { `type`: `number` ; `getAll`: (`entity`: [`Entity`](classes/Entity.md)) => [`Component`](classes/Component.md)<`P`\>[] ; `get`: (`entity`: [`Entity`](classes/Entity.md)) => [`Component`](classes/Component.md)<`P`\>  }

Force typing

#### Type parameters

| Name |
| :------ |
| `P` |

___

### EventCallback

Ƭ **EventCallback**: (`data`: `any`, `entities`: `Iterator`<[`Entity`](classes/Entity.md)\>) => `void`

#### Type declaration

▸ (`data`, `entities`): `void`

System callback

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |
| `entities` | `Iterator`<[`Entity`](classes/Entity.md)\> |

##### Returns

`void`

___

### HeadParams

Ƭ **HeadParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `headDimension` | `number` |
| `headColor` | `string` |

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

## Functions

### cull

▸ **cull**(`array`, `options`): `Promise`<[`MeshResultType`](modules.md#meshresulttype)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype) |

#### Returns

`Promise`<[`MeshResultType`](modules.md#meshresulttype)\>

___

### drawSun

▸ **drawSun**(`context`, `canvas`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `context` | `CanvasRenderingContext2D` |
| `canvas` | `HTMLCanvasElement` |

#### Returns

`void`
