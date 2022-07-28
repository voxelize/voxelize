[@voxelize/client](README.md) / Exports

# @voxelize/client

## Table of contents

### Core Classes

- [Inputs](classes/Inputs.md)
- [Network](classes/Network.md)
- [Peers](classes/Peers.md)
- [Registry](classes/Registry.md)
- [RigidControls](classes/RigidControls.md)
- [World](classes/World.md)

### Other Classes

- [BlockRotation](classes/BlockRotation.md)
- [BlockUtils](classes/BlockUtils.md)
- [BoxLayer](classes/BoxLayer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Chat](classes/Chat.md)
- [Chunk](classes/Chunk.md)
- [ChunkMesh](classes/ChunkMesh.md)
- [ChunkUtils](classes/ChunkUtils.md)
- [Chunks](classes/Chunks.md)
- [Clouds](classes/Clouds.md)
- [ColorText](classes/ColorText.md)
- [Component](classes/Component.md)
- [DOMUtils](classes/DOMUtils.md)
- [ECS](classes/ECS.md)
- [Entities](classes/Entities.md)
- [Entity](classes/Entity.md)
- [Events](classes/Events.md)
- [Head](classes/Head.md)
- [ImageVoxelizer](classes/ImageVoxelizer.md)
- [LightUtils](classes/LightUtils.md)
- [MathUtils](classes/MathUtils.md)
- [NameTag](classes/NameTag.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [System](classes/System.md)
- [TextureAtlas](classes/TextureAtlas.md)
- [WorkerPool](classes/WorkerPool.md)

### Interfaces

- [NetIntercept](interfaces/NetIntercept.md)

### Type Aliases

- [ArtFunction](modules.md#artfunction)
- [Block](modules.md#block)
- [BlockUpdate](modules.md#blockupdate)
- [BoxSides](modules.md#boxsides)
- [CSSMeasurement](modules.md#cssmeasurement)
- [CanvasBoxParams](modules.md#canvasboxparams)
- [ClickType](modules.md#clicktype)
- [CloudsParams](modules.md#cloudsparams)
- [CommandProcessor](modules.md#commandprocessor)
- [ComponentClassType](modules.md#componentclasstype)
- [Coords2](modules.md#coords2)
- [Coords3](modules.md#coords3)
- [CullOptionsType](modules.md#culloptionstype)
- [CustomShaderMaterial](modules.md#customshadermaterial)
- [DeepPartial](modules.md#deeppartial)
- [Event](modules.md#event)
- [EventCallback](modules.md#eventcallback)
- [EventHandler](modules.md#eventhandler)
- [HeadParams](modules.md#headparams)
- [ImageVoxelizerParams](modules.md#imagevoxelizerparams)
- [InputOccasion](modules.md#inputoccasion)
- [LightColor](modules.md#lightcolor)
- [MeshResultType](modules.md#meshresulttype)
- [NetworkParams](modules.md#networkparams)
- [PartialRecord](modules.md#partialrecord)
- [ProtocolWS](modules.md#protocolws)
- [RegistryParams](modules.md#registryparams)
- [RigidControlState](modules.md#rigidcontrolstate)
- [RigidControlsParams](modules.md#rigidcontrolsparams)
- [SkyFace](modules.md#skyface)
- [Susbcription](modules.md#susbcription)
- [TextureData](modules.md#texturedata)
- [TextureRange](modules.md#texturerange)
- [WorkerPoolJob](modules.md#workerpooljob)
- [WorkerPoolParams](modules.md#workerpoolparams)
- [WorldClientParams](modules.md#worldclientparams)
- [WorldParams](modules.md#worldparams)
- [WorldServerParams](modules.md#worldserverparams)

### Variables

- [BOX\_SIDES](modules.md#box_sides)
- [BlueLight](modules.md#bluelight)
- [GreenLight](modules.md#greenlight)
- [NX\_ROTATION](modules.md#nx_rotation)
- [NY\_ROTATION](modules.md#ny_rotation)
- [NZ\_ROTATION](modules.md#nz_rotation)
- [OPAQUE\_RENDER\_ORDER](modules.md#opaque_render_order)
- [PX\_ROTATION](modules.md#px_rotation)
- [PY\_ROTATION](modules.md#py_rotation)
- [PZ\_ROTATION](modules.md#pz_rotation)
- [RedLight](modules.md#redlight)
- [Sunlight](modules.md#sunlight)
- [TRANSPARENT\_RENDER\_ORDER](modules.md#transparent_render_order)
- [Y\_000\_ROTATION](modules.md#y_000_rotation)
- [Y\_045\_ROTATION](modules.md#y_045_rotation)
- [Y\_090\_ROTATION](modules.md#y_090_rotation)
- [Y\_135\_ROTATION](modules.md#y_135_rotation)
- [Y\_180\_ROTATION](modules.md#y_180_rotation)
- [Y\_225\_ROTATION](modules.md#y_225_rotation)
- [Y\_270\_ROTATION](modules.md#y_270_rotation)
- [Y\_315\_ROTATION](modules.md#y_315_rotation)
- [Y\_ROT\_MAP](modules.md#y_rot_map)
- [defaultParams](modules.md#defaultparams)

### Functions

- [cull](modules.md#cull)
- [drawSun](modules.md#drawsun)

## Type Aliases

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

#### Defined in

[client/src/libs/canvas-box.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L23)

___

### Block

Ƭ **Block**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `aabbs` | `AABB`[] |
| `blueLightLevel` | `number` |
| `faces` | { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `name`: `string`  }[] |
| `greenLightLevel` | `number` |
| `id` | `number` |
| `isBlock` | `boolean` |
| `isEmpty` | `boolean` |
| `isFluid` | `boolean` |
| `isLight` | `boolean` |
| `isNxTransparent` | `boolean` |
| `isNyTransparent` | `boolean` |
| `isNzTransparent` | `boolean` |
| `isOpaque` | `boolean` |
| `isPlant` | `boolean` |
| `isPlantable` | `boolean` |
| `isPxTransparent` | `boolean` |
| `isPyTransparent` | `boolean` |
| `isPzTransparent` | `boolean` |
| `isSeeThrough` | `boolean` |
| `name` | `string` |
| `redLightLevel` | `number` |
| `rotatable` | `boolean` |
| `transparentStandalone` | `boolean` |
| `yRotatable` | `boolean` |

#### Defined in

[client/src/core/world/block.ts:5](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L5)

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation?` | [`BlockRotation`](classes/BlockRotation.md) |  |
| `type` | `number` |  |
| `vx` | `number` |  |
| `vy` | `number` |  |
| `vz` | `number` |  |

#### Defined in

[client/src/core/world/block.ts:39](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L39)

___

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"all"`` \| ``"sides"``

#### Defined in

[client/src/libs/canvas-box.ts:30](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L30)

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

#### Defined in

[client/src/types.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/types.ts#L15)

___

### CanvasBoxParams

Ƭ **CanvasBoxParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |
| `gap` | `number` |
| `layers` | `number` |
| `side` | `Side` |
| `width` | `number` |

#### Defined in

[client/src/libs/canvas-box.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L15)

___

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

#### Defined in

[client/src/core/inputs.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L8)

___

### CloudsParams

Ƭ **CloudsParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `alpha` | `number` |
| `color` | `string` |
| `count` | `number` |
| `dimensions` | [`Coords3`](modules.md#coords3) |
| `falloff` | `number` |
| `height` | `number` |
| `lerpFactor` | `number` |
| `octaves` | `number` |
| `scale` | `number` |
| `seed` | `number` |
| `speedFactor` | `number` |
| `threshold` | `number` |
| `uFogColor?` | { `value`: `Color`  } |
| `uFogColor.value` | `Color` |
| `uFogFar?` | { `value`: `number`  } |
| `uFogFar.value` | `number` |
| `uFogNear?` | { `value`: `number`  } |
| `uFogNear.value` | `number` |
| `width` | `number` |
| `worldHeight` | `number` |

#### Defined in

[client/src/libs/clouds.ts:22](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L22)

___

### CommandProcessor

Ƭ **CommandProcessor**: (`rest`: `string`) => `void`

#### Type declaration

▸ (`rest`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `rest` | `string` |

##### Returns

`void`

#### Defined in

[client/src/core/chat.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/chat.ts#L8)

___

### ComponentClassType

Ƭ **ComponentClassType**<`P`\>: (`data?`: `P`) => [`Component`](classes/Component.md)<`P`\> & { `type`: `number` ; `get`: (`entity`: [`Entity`](classes/Entity.md)) => [`Component`](classes/Component.md)<`P`\> ; `getAll`: (`entity`: [`Entity`](classes/Entity.md)) => [`Component`](classes/Component.md)<`P`\>[]  }

#### Type parameters

| Name |
| :------ |
| `P` |

#### Defined in

[client/src/libs/ecs.ts:238](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L238)

___

### Coords2

Ƭ **Coords2**: [`number`, `number`]

#### Defined in

[client/src/types.ts:9](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/types.ts#L9)

___

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

#### Defined in

[client/src/types.ts:10](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/types.ts#L10)

___

### CullOptionsType

Ƭ **CullOptionsType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `dimensions` | [`Coords3`](modules.md#coords3) |
| `max` | [`Coords3`](modules.md#coords3) |
| `min` | [`Coords3`](modules.md#coords3) |
| `realMax` | [`Coords3`](modules.md#coords3) |
| `realMin` | [`Coords3`](modules.md#coords3) |

#### Defined in

[client/src/libs/cull.ts:14](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/cull.ts#L14)

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

#### Defined in

[client/src/core/world/index.ts:43](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L43)

___

### DeepPartial

Ƭ **DeepPartial**<`T`\>: { [P in keyof T]?: DeepPartial<T[P]\> }

#### Type parameters

| Name |
| :------ |
| `T` |

#### Defined in

[client/src/types.ts:1](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/types.ts#L1)

___

### Event

Ƭ **Event**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |
| `payload?` | `any` |  |

#### Defined in

[client/src/core/events.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/events.ts#L8)

___

### EventCallback

Ƭ **EventCallback**: (`data`: `any`, `entities`: `Iterator`<[`Entity`](classes/Entity.md)\>) => `void`

#### Type declaration

▸ (`data`, `entities`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |
| `entities` | `Iterator`<[`Entity`](classes/Entity.md)\> |

##### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:318](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L318)

___

### EventHandler

Ƭ **EventHandler**: (`payload`: `any` \| ``null``) => `void`

#### Type declaration

▸ (`payload`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | `any` \| ``null`` |

##### Returns

`void`

#### Defined in

[client/src/core/events.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/events.ts#L23)

___

### HeadParams

Ƭ **HeadParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `headColor` | `string` |
| `headDimension` | `number` |

#### Defined in

[client/src/libs/head.ts:5](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/head.ts#L5)

___

### ImageVoxelizerParams

Ƭ **ImageVoxelizerParams**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `height` | `number` |  |
| `lockedRatio` | `boolean` |  |
| `orientation` | ``"x"`` \| ``"z"`` |  |
| `width` | `number` |  |

#### Defined in

[client/src/libs/image-voxelizer.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/image-voxelizer.ts#L8)

___

### InputOccasion

Ƭ **InputOccasion**: ``"keydown"`` \| ``"keypress"`` \| ``"keyup"``

#### Defined in

[client/src/core/inputs.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L13)

___

### LightColor

Ƭ **LightColor**: ``"RED"`` \| ``"GREEN"`` \| ``"BLUE"`` \| ``"SUNLIGHT"``

#### Defined in

[client/src/utils/light-utils.ts:40](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/light-utils.ts#L40)

___

### MeshResultType

Ƭ **MeshResultType**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `indices` | `Float32Array` |
| `normals` | `Float32Array` |
| `positions` | `Float32Array` |

#### Defined in

[client/src/libs/cull.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/cull.ts#L8)

___

### NetworkParams

Ƭ **NetworkParams**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `reconnectTimeout?` | `number` |  |
| `secret?` | `string` |  |
| `serverURL` | `string` |  |

#### Defined in

[client/src/core/network/index.ts:29](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L29)

___

### PartialRecord

Ƭ **PartialRecord**<`K`, `T`\>: { [P in K]?: T }

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof `any` |
| `T` | `T` |

#### Defined in

[client/src/types.ts:5](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/types.ts#L5)

___

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & { `sendEvent`: (`event`: `any`) => `void`  }

#### Defined in

[client/src/core/network/index.ts:19](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/index.ts#L19)

___

### RegistryParams

Ƭ **RegistryParams**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dimension` | `number` |  |

#### Defined in

[client/src/core/world/registry.ts:36](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L36)

___

### RigidControlState

Ƭ **RigidControlState**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `crouching` | `boolean` |  |
| `currentJumpTime` | `number` |  |
| `heading` | `number` |  |
| `isJumping` | `boolean` |  |
| `jumpCount` | `number` |  |
| `jumping` | `boolean` |  |
| `running` | `boolean` |  |
| `sprinting` | `boolean` |  |

#### Defined in

[client/src/core/controls.ts:65](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L65)

___

### RigidControlsParams

Ƭ **RigidControlsParams**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airJumps` | `number` |  |
| `airMoveMult` | `number` |  |
| `alwaysSprint` | `boolean` |  |
| `bodyDepth` | `number` |  |
| `bodyHeight` | `number` |  |
| `bodyWidth` | `number` |  |
| `eyeHeight` | `number` |  |
| `flyForce` | `number` |  |
| `flyImpulse` | `number` |  |
| `flyInertia` | `number` |  |
| `flySpeed` | `number` |  |
| `initialPosition` | [`Coords3`](modules.md#coords3) |  |
| `jumpForce` | `number` |  |
| `jumpImpulse` | `number` |  |
| `jumpTime` | `number` |  |
| `lookBlockColor` | `string` |  |
| `lookBlockLerp` | `number` |  |
| `lookBlockScale` | `number` |  |
| `lookInGhostMode` | `boolean` |  |
| `maxPolarAngle` | `number` |  |
| `maxSpeed` | `number` |  |
| `minPolarAngle` | `number` |  |
| `moveForce` | `number` |  |
| `positionLerp` | `number` |  |
| `reachDistance` | `number` |  |
| `responsiveness` | `number` |  |
| `rotationLerp` | `number` |  |
| `runningFriction` | `number` |  |
| `sensitivity` | `number` |  |
| `sprintFactor` | `number` |  |
| `standingFriction` | `number` |  |

#### Defined in

[client/src/core/controls.ts:122](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L122)

___

### SkyFace

Ƭ **SkyFace**: [`ArtFunction`](modules.md#artfunction) \| `Color` \| `string` \| ``null``

#### Defined in

[client/src/core/world/index.ts:38](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L38)

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

#### Defined in

[client/src/libs/ecs.ts:139](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L139)

___

### TextureData

Ƭ **TextureData**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `string` \| `Color` |  |
| `name` | `string` |  |
| `sides` | `string`[] |  |

#### Defined in

[client/src/core/world/registry.ts:16](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L16)

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

#### Defined in

[client/src/core/world/registry.ts:6](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/registry.ts#L6)

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `buffers?` | `ArrayBufferLike`[] |
| `message` | `any` |
| `resolve` | (`value`: `any`) => `void` |

#### Defined in

[client/src/libs/worker-pool.ts:1](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L1)

___

### WorkerPoolParams

Ƭ **WorkerPoolParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxWorker` | `number` |

#### Defined in

[client/src/libs/worker-pool.ts:7](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L7)

___

### WorldClientParams

Ƭ **WorldClientParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `defaultDeleteRadius` | `number` |
| `defaultRenderRadius` | `number` |
| `inViewRadius` | `number` |
| `maxAddsPerTick` | `number` |
| `maxProcessesPerTick` | `number` |
| `maxRequestsPerTick` | `number` |
| `maxUpdatesPerTick` | `number` |
| `textureDimension` | `number` |

#### Defined in

[client/src/core/world/index.ts:47](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L47)

___

### WorldParams

Ƭ **WorldParams**: [`WorldClientParams`](modules.md#worldclientparams) & [`WorldServerParams`](modules.md#worldserverparams)

#### Defined in

[client/src/core/world/index.ts:84](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L84)

___

### WorldServerParams

Ƭ **WorldServerParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `airDrag` | `number` |
| `chunkSize` | `number` |
| `fluidDensity` | `number` |
| `fluidDrag` | `number` |
| `gravity` | `number`[] |
| `maxChunk` | [`number`, `number`] |
| `maxHeight` | `number` |
| `maxLightLevel` | `number` |
| `minBounceImpulse` | `number` |
| `minChunk` | [`number`, `number`] |
| `subChunks` | `number` |

#### Defined in

[client/src/core/world/index.ts:58](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L58)

## Variables

### BOX\_SIDES

• `Const` **BOX\_SIDES**: `string`[]

#### Defined in

[client/src/libs/canvas-box.ts:48](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L48)

___

### BlueLight

• `Const` **BlueLight**: ``"BLUE"``

#### Defined in

[client/src/utils/light-utils.ts:37](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/light-utils.ts#L37)

___

### GreenLight

• `Const` **GreenLight**: ``"GREEN"``

#### Defined in

[client/src/utils/light-utils.ts:36](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/light-utils.ts#L36)

___

### NX\_ROTATION

• `Const` **NX\_ROTATION**: ``3``

#### Defined in

[client/src/core/world/block.ts:69](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L69)

___

### NY\_ROTATION

• `Const` **NY\_ROTATION**: ``1``

#### Defined in

[client/src/core/world/block.ts:67](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L67)

___

### NZ\_ROTATION

• `Const` **NZ\_ROTATION**: ``5``

#### Defined in

[client/src/core/world/block.ts:71](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L71)

___

### OPAQUE\_RENDER\_ORDER

• `Const` **OPAQUE\_RENDER\_ORDER**: ``100``

#### Defined in

[client/src/common.ts:2](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/common.ts#L2)

___

### PX\_ROTATION

• `Const` **PX\_ROTATION**: ``2``

#### Defined in

[client/src/core/world/block.ts:68](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L68)

___

### PY\_ROTATION

• `Const` **PY\_ROTATION**: ``0``

#### Defined in

[client/src/core/world/block.ts:66](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L66)

___

### PZ\_ROTATION

• `Const` **PZ\_ROTATION**: ``4``

#### Defined in

[client/src/core/world/block.ts:70](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L70)

___

### RedLight

• `Const` **RedLight**: ``"RED"``

#### Defined in

[client/src/utils/light-utils.ts:35](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/light-utils.ts#L35)

___

### Sunlight

• `Const` **Sunlight**: ``"SUNLIGHT"``

#### Defined in

[client/src/utils/light-utils.ts:38](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/utils/light-utils.ts#L38)

___

### TRANSPARENT\_RENDER\_ORDER

• `Const` **TRANSPARENT\_RENDER\_ORDER**: ``100000``

#### Defined in

[client/src/common.ts:1](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/common.ts#L1)

___

### Y\_000\_ROTATION

• `Const` **Y\_000\_ROTATION**: ``0``

#### Defined in

[client/src/core/world/block.ts:73](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L73)

___

### Y\_045\_ROTATION

• `Const` **Y\_045\_ROTATION**: ``1``

#### Defined in

[client/src/core/world/block.ts:74](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L74)

___

### Y\_090\_ROTATION

• `Const` **Y\_090\_ROTATION**: ``2``

#### Defined in

[client/src/core/world/block.ts:75](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L75)

___

### Y\_135\_ROTATION

• `Const` **Y\_135\_ROTATION**: ``3``

#### Defined in

[client/src/core/world/block.ts:76](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L76)

___

### Y\_180\_ROTATION

• `Const` **Y\_180\_ROTATION**: ``4``

#### Defined in

[client/src/core/world/block.ts:77](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L77)

___

### Y\_225\_ROTATION

• `Const` **Y\_225\_ROTATION**: ``5``

#### Defined in

[client/src/core/world/block.ts:78](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L78)

___

### Y\_270\_ROTATION

• `Const` **Y\_270\_ROTATION**: ``6``

#### Defined in

[client/src/core/world/block.ts:79](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L79)

___

### Y\_315\_ROTATION

• `Const` **Y\_315\_ROTATION**: ``7``

#### Defined in

[client/src/core/world/block.ts:80](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L80)

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: `number`[][]

#### Defined in

[client/src/core/world/block.ts:82](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/block.ts#L82)

___

### defaultParams

• `Const` **defaultParams**: [`CanvasBoxParams`](modules.md#canvasboxparams)

#### Defined in

[client/src/libs/canvas-box.ts:40](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/canvas-box.ts#L40)

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

#### Defined in

[client/src/libs/cull.ts:26](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/cull.ts#L26)

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

#### Defined in

[client/src/libs/sky.ts:86](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L86)
