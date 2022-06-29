---
id: "modules"
title: "@voxelize/client"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Classes

- [Camera](classes/Camera.md)
- [Chat](classes/Chat.md)
- [Clock](classes/Clock.md)
- [Container](classes/Container.md)
- [Controls](classes/Controls.md)
- [Debug](classes/Debug.md)
- [BaseEntity](classes/BaseEntity.md)
- [Entities](classes/Entities.md)
- [Inputs](classes/Inputs.md)
- [Loader](classes/Loader.md)
- [Network](classes/Network.md)
- [Particles](classes/Particles.md)
- [Peers](classes/Peers.md)
- [Physics](classes/Physics.md)
- [Registry](classes/Registry.md)
- [Rendering](classes/Rendering.md)
- [Settings](classes/Settings.md)
- [World](classes/World.md)
- [Client](classes/Client.md)
- [BlockRotation](classes/BlockRotation.md)
- [CanvasBox](classes/CanvasBox.md)
- [ChatHistory](classes/ChatHistory.md)
- [ChatMessage](classes/ChatMessage.md)
- [ChunkMesh](classes/ChunkMesh.md)
- [Chunk](classes/Chunk.md)
- [Chunks](classes/Chunks.md)
- [Clouds](classes/Clouds.md)
- [Entity](classes/Entity.md)
- [Component](classes/Component.md)
- [System](classes/System.md)
- [ECS](classes/ECS.md)
- [Head](classes/Head.md)
- [ImageVoxelizer](classes/ImageVoxelizer.md)
- [NameTag](classes/NameTag.md)
- [Peer](classes/Peer.md)
- [Sky](classes/Sky.md)
- [TextureAtlas](classes/TextureAtlas.md)
- [WorkerPool](classes/WorkerPool.md)

## Type Aliases

### CameraParams

Ƭ **CameraParams**: `Object`

Parameters to initialize the Voxelize [Camera](classes/Camera.md).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `fov` | `number` | Default camera field of view. Defaults to `90`. |
| `near` | `number` | Default nearest distance camera can render. Defaults to `0.1`. |
| `far` | `number` | Default farthest distance camera can render. Defaults to `2000`. |
| `lerpFactor` | `number` | Lerp factor of camera FOV/zoom change. Defaults to `0.7`. |

___

### ChatParams

Ƭ **ChatParams**: `Object`

Parameters to initialize the Voxelize [Chat](classes/Chat.md).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `align` | ``"left"`` \| ``"center"`` \| ``"right"`` | Alignment of the chat. Defaults to `left`. |
| `borderRadius` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | Border radius of both the radius and the message list. Defaults to `4px`. |
| `connectionMessage` | `string` | The message sent when a connection is made. Defaults to `Connected to world! Try /help`. |
| `disconnectionMessage` | `string` | The message sent when connection is lost. Defaults to `World disconnected. Reconnecting...`. |
| `disappearTimeout` | `number` | The timeout for chat to disappear once input is closed in milliseconds. Defaults to `2000`. |
| `gap` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | The gap between the input and the message list. Defaults to `26px`. |
| `helpText` | `string` | A text message that is sent to the client frontend-only when '/help' is typed in the chat. |
| `inputHeight` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | Height of the chat input. Defaults to `29px`. |
| `inputWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | Width of the chat input, not regarding the margins. Defaults to `100%`. |
| `margin` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | The margin of the chat to the viewport in pixels. Defaults to `8px`. |
| `messagesWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-12) | The default width of the message list. Defaults to `40vw`. |
| `commandSymbol` | `string` | Symbol to activate typing a command, needs to be 1 character long! Defaults to `/`. |

___

### ClockParams

Ƭ **ClockParams**: `Object`

Parameters to initialize the Voxelize [Clock](classes/Clock.md).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxDelta` | `number` | The maximum delta allowed for each game loop. Defaults to `0.3`. |

___

### ContainerParams

Ƭ **ContainerParams**: `Object`

Parameters to initialize the Voxelize [Container](classes/Container.md).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `domElement` | `HTMLElement` | The DOM element that wraps all Voxelize UI components. |
| `canvas` | `HTMLCanvasElement` | The `HTMLCanvasElement` that Voxelize draws on. |
| `crosshairStyles?` | `CSSStyleDeclaration` | The styles applied to the crosshair. |

___

### ControlState

Ƭ **ControlState**: `Object`

The state of which a Voxelize [Controls](classes/Controls.md) is in.

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

### ControlsParams

Ƭ **ControlsParams**: `Object`

Parameters to initialize the Voxelize [Controls](classes/Controls.md).

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `sensitivity` | `number` | The mouse sensitivity. Defaults to `100`. |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `lookBlockScale` | `number` | The scale of the outline of the looking block. Defaults to `1.002`. |
| `lookBlockColor` | `string` | The color of the outline of the looking block. Defaults to `black`. |
| `lookBlockLerp` | `number` | The interpolation factor of the looking block changing. Defaults to `1`, immediate changes. |
| `reachDistance` | `number` | The maximum distance a client can reach a block. Defaults to `32`. |
| `initialPosition` | [`Coords3`](modules.md#coords3-12) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `bodyWidth` | `number` | The width of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | `number` | The height of the client's avatar. Defaults to `1.8` blocks. |
| `bodyDepth` | `number` | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `eyeHeight` | `number` | The height from the ground at which the camera of the client is placed at. Defaults at `0.8`. |
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
| `airMoveMult` | `number` | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `airJumps` | `number` | How many times can a client jump in the air. Defaults to `0`. |

___

### Formatter

Ƭ **Formatter**: (`input`: `any`) => `string`

#### Type declaration

▸ (`input`): `string`

Formats any values into a presentable string representation.

##### Parameters

| Name | Type |
| :------ | :------ |
| `input` | `any` |

##### Returns

`string`

___

### NewEntity

Ƭ **NewEntity**: () => [`BaseEntity`](classes/BaseEntity.md)

#### Type declaration

• ()

Creating a new [BaseEntity](classes/BaseEntity.md).

___

### EntitiesParams

Ƭ **EntitiesParams**: `Object`

Parameters to customizing the Voxelize [Entities](classes/Entities.md) map.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `lerpFactor` | `number` | The default interpolation factor for all entities. Defaults to `0.7`. |

___

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

Three types of clicking for mouse input listening.

___

### InputNamespace

Ƭ **InputNamespace**: ``"in-game"`` \| ``"chat"`` \| ``"inventory"`` \| ``"menu"`` \| ``"*"``

Different namespaces that the [Inputs](classes/Inputs.md) is in.
- `in-game`: Keys registered in-game will be fired.
- `chat`: Keys registered for the chat will be fired.
- `menu`: Keys registered otherwise will be fired.
- `*`: Keys will be fired no matter what.

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
| `reconnectTimeout` | `number` | On disconnection, the timeout to attempt to reconnect. Defaults to 5000. |

___

### ParticleParams

Ƭ **ParticleParams**: `Object`

Parameters to initialize **a group of** particles.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `count` | `number` | Number of particles spawned in this group. |
| `force` | `number` | The magnitude of the default force applied to each particle. |
| `timeout` | `number` | The time until this particle is discarded. |
| `gravity` | `boolean` | Whether or not this particle is effected by gravity. |
| `fadeTimeout` | `number` | The time for the particle to fade away once the timeout is reached. |
| `scale` | `number` | The scale of each particles. |
| `impulseFunc` | (`f`: `number`) => [`Coords3`](modules.md#coords3-12) | A function returning a 3-element array that modifies the force applied on each particle. |
| `update` | (`g`: [`ParticleGroup`](modules.md#particlegroup-12)) => `void` | A function used to update the particles. |

___

### ParticleGroup

Ƭ **ParticleGroup**: `Object`

An object storing the data for a group of particles.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `mesh` | `Points` | The ThreeJS Points instance for rendering. |
| `bodies` | `RigidBody`[] | The rigid bodies of the particles, allowing them to act physically. |
| `params` | [`ParticleParams`](modules.md#particleparams-12) | Parameters used to initialize this particle group. |

___

### PeersParams

Ƭ **PeersParams**: `Object`

Parameters to initialize the [Peers](classes/Peers.md) manager for Voxelize.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `lerpFactor` | `number` | The interpolation factor between each peer update. Defaults to 0.6. |
| `headColor` | `string` | The background color of the peer head mesh. Defaults to `#94d0cc`. |
| `headDimension` | `number` | The dimension of the peer head mesh. Defaults to 0.4. |
| `maxNameDistance` | `number` | The maximum distance, in blocks, at which the peer's nametag will still be rendered. Defaults to 50 voxels. |
| `fontFace` | `string` | The font for the peer's nametag. Defaults to `monospace`. |

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.

___

### TextureData

Ƭ **TextureData**: `Object`

Data passed to [applyTextureByName](classes/Registry.md#applytexturebyname-12) or [applyTexturesByNames](classes/Registry.md#applytexturesbynames-12) to load a block texture.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to load. E.g. "Dirt". |
| `side` | [`BlockFace`](modules.md#blockface-12) | The side that this data loads onto. |
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

### RenderingParams

Ƭ **RenderingParams**: `Object`

Parameters to initialize the rendering pipeline.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `clearColor` | `string` | The color behind the sky, the default color clients see. Defaults to `#000`. |

___

### SettingsField

Ƭ **SettingsField**: `number` \| `boolean`

___

### WorldInitParams

Ƭ **WorldInitParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `skyDimension` | `number` |
| `inViewRadius` | `number` |
| `maxRequestsPerTick` | `number` |
| `maxProcessesPerTick` | `number` |
| `maxUpdatesPerTick` | `number` |
| `maxAddsPerTick` | `number` |
| `skyFaces` | [`PartialRecord`](modules.md#partialrecord-12)<[`BoxSides`](modules.md#boxsides-12), `SkyFace`\> |
| `clouds` | `Partial`<[`CloudsParams`](modules.md#cloudsparams-12)\> \| `boolean` |

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

### ServerChunk

Ƭ **ServerChunk**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `z` | `number` |
| `id` | `string` |
| `lights` | `Uint32Array` |
| `voxels` | `Uint32Array` |
| `meshes` | [`ServerMesh`](modules.md#servermesh-12)[] |

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
| `dimensions` | [`Coords3`](modules.md#coords3-12) |
| `threshold` | `number` |
| `lerpFactor` | `number` |
| `speedFactor` | `number` |
| `color` | `string` |
| `alpha` | `number` |
| `seed` | `number` |
| `count` | `number` |
| `octaves` | `number` |
| `falloff` | `number` |
| `uFogNear` | { `value`: `number`  } |
| `uFogNear.value` | `number` |
| `uFogFar` | { `value`: `number`  } |
| `uFogFar.value` | `number` |
| `uFogColor` | { `value`: `Color`  } |
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
| `min` | [`Coords3`](modules.md#coords3-12) |
| `max` | [`Coords3`](modules.md#coords3-12) |
| `realMin` | [`Coords3`](modules.md#coords3-12) |
| `realMax` | [`Coords3`](modules.md#coords3-12) |
| `dimensions` | [`Coords3`](modules.md#coords3-12) |

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

### ImageVoxelizerParams

Ƭ **ImageVoxelizerParams**: `Object`

Parameters to process an image voxelization.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `width` | `number` | The width, in blocks, of the voxelized image. Defaults to `64`. |
| `height` | `number` | The height, in blocks, of the voxelized image. Defaults to `64`. |
| `lockedRatio` | `boolean` | Whether or not should the ratio between width and height be locked. If true, the width would be ignored and be later determined form the height. Defaults to `false`. |
| `voxel?` | [`Coords3`](modules.md#coords3-12) | The voxel at which to offset the voxelizer at. |
| `orientation` | ``"x"`` \| ``"z"`` | Which direction to place the voxelized image. |

___

### PeerParams

Ƭ **PeerParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lerpFactor` | `number` |
| `headColor` | `string` |
| `headDimension` | `number` |
| `maxNameDistance` | `number` |
| `fontFace` | `string` |

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

### AllFaces

Ƭ **AllFaces**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `all` | `string` |

___

### ThreeFaces

Ƭ **ThreeFaces**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `top` | `string` |
| `side` | `string` |
| `bottom` | `string` |

___

### SixFaces

Ƭ **SixFaces**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `px` | `string` |
| `py` | `string` |
| `pz` | `string` |
| `nx` | `string` |
| `ny` | `string` |
| `nz` | `string` |

___

### PlantFaces

Ƭ **PlantFaces**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `diagonal` | `string` |

___

### BlockFace

Ƭ **BlockFace**: keyof [`AllFaces`](modules.md#allfaces-12) \| keyof [`ThreeFaces`](modules.md#threefaces-12) \| keyof [`SixFaces`](modules.md#sixfaces-12) \| keyof [`PlantFaces`](modules.md#plantfaces-12)

A face/side of the block.
- `all`: All 6 sides of the block.
- `top`, `side`, `bottom`: Three types of sides of the block.
- `px`, `py`, `pz`, `nx`, `ny`, `nz`: Six faces of a block.
- `diagonal`: The diagonal face, used for plants.

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
| `isSolid` | `boolean` |
| `isTransparent` | `boolean` |
| `transparentStandalone` | `boolean` |
| `faces` | [`BlockFace`](modules.md#blockface-12)[] |
| `aabbs` | `AABB`[] |

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

### Coords2

Ƭ **Coords2**: [`number`, `number`]

___

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

___

### ServerMesh

Ƭ **ServerMesh**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `opaque?` | [`MeshData`](modules.md#meshdata-12) |
| `transparent?` | [`MeshData`](modules.md#meshdata-12) |
| `level` | `number` |

___

### MeshData

Ƭ **MeshData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `positions` | `Float32Array` |
| `indices` | `Int32Array` |
| `uvs` | `Float32Array` |
| `lights` | `Int32Array` |

___

### BaseWorldParams

Ƭ **BaseWorldParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chunkSize` | `number` |
| `maxHeight` | `number` |
| `maxLightLevel` | `number` |

___

### MESSAGE\_TYPE

Ƭ **MESSAGE\_TYPE**: ``"ERROR"`` \| ``"SERVER"`` \| ``"PLAYER"`` \| ``"INFO"``

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

A CSS measurement. E.g. "30px", "51em"

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `type` | `number` |
| `rotation?` | [`BlockRotation`](classes/BlockRotation.md) |

## Variables

### DirtyFlag

• `Const` **DirtyFlag**: [`ComponentClassType`](modules.md#componentclasstype-12)<`unknown`\>

___

### EntityFlag

• `Const` **EntityFlag**: [`ComponentClassType`](modules.md#componentclasstype-12)<`unknown`\>

___

### ClientFlag

• `Const` **ClientFlag**: [`ComponentClassType`](modules.md#componentclasstype-12)<`unknown`\>

___

### ChunkFlag

• `Const` **ChunkFlag**: [`ComponentClassType`](modules.md#componentclasstype-12)<`unknown`\>

___

### HeadingComponent

• `Const` **HeadingComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`Vector3`\>

___

### IDComponent

• `Const` **IDComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`string`\>

___

### MeshComponent

• `Const` **MeshComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`Object3D`<`Event`\>\>

___

### MetadataComponent

• `Const` **MetadataComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<{ `[key: string]`: `any`;  }\>

___

### NameComponent

• `Const` **NameComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`string`\>

___

### Position3DComponent

• `Const` **Position3DComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`Vector3`\>

___

### TargetComponent

• `Const` **TargetComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`Vector3`\>

___

### TypeComponent

• `Const` **TypeComponent**: [`ComponentClassType`](modules.md#componentclasstype-12)<`string`\>

___

### defaultBlock

• `Const` **defaultBlock**: [`Block`](modules.md#block-12)

## Functions

### cull

▸ **cull**(`array`, `options`): `Promise`<[`MeshResultType`](modules.md#meshresulttype-12)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype-12) |

#### Returns

`Promise`<[`MeshResultType`](modules.md#meshresulttype-12)\>

___

### raycast

▸ **raycast**(`getVoxel`, `origin`, `direction`, `maxD`, `hitPos?`, `hitNorm?`): ``true`` \| ``0``

#### Parameters

| Name | Type |
| :------ | :------ |
| `getVoxel` | `GetVoxel` |
| `origin` | [`Coords3`](modules.md#coords3-12) |
| `direction` | [`Coords3`](modules.md#coords3-12) |
| `maxD` | `number` |
| `hitPos` | [`Coords3`](modules.md#coords3-12) |
| `hitNorm` | [`Coords3`](modules.md#coords3-12) |

#### Returns

``true`` \| ``0``

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
