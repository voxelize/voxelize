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
- [Chunk](classes/Chunk.md)
- [Chunks](classes/Chunks.md)
- [Entity](classes/Entity.md)
- [Component](classes/Component.md)
- [System](classes/System.md)
- [ECS](classes/ECS.md)
- [Head](classes/Head.md)
- [NameTag](classes/NameTag.md)
- [Peer](classes/Peer.md)
- [Sky](classes/Sky.md)
- [TextureAtlas](classes/TextureAtlas.md)
- [WorkerPool](classes/WorkerPool.md)

## Type Aliases

### CameraParams

Ƭ **CameraParams**: `Object`

Parameters to initialize the Voxelize camera.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `fov` | `number` | Default camera field of view. Defaults to `90`. |
| `near` | `number` | Default nearest distance camera can render. Defaults to `0.1`. |
| `far` | `number` | Default farthest distance camera can render. Defaults to `2000`. |
| `lerpFactor` | `number` | Lerp factor of camera FOV/zoom change. Defaults to `0.7`. |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `0`. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI` |

___

### ChatParams

Ƭ **ChatParams**: `Object`

Parameters to initialize the Voxelize chat.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `align` | ``"left"`` \| ``"center"`` \| ``"right"`` | Alignment of the chat. Defaults to `left`. |
| `borderRadius` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | Border radius of both the radius and the message list. Defaults to `4px`. |
| `connectionMessage` | `string` | The message sent when a connection is made. Defaults to `Connected to world! Try /help`. |
| `disconnectionMessage` | `string` | The message sent when connection is lost. Defaults to `World disconnected. Reconnecting...`. |
| `disappearTimeout` | `number` | The timeout for chat to disappear once input is closed in milliseconds. Defaults to `2000`. |
| `gap` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | The gap between the input and the message list. Defaults to `26px`. |
| `helpText` | `string` | A text message that is sent to the client frontend-only when '/help' is typed in the chat. |
| `inputHeight` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | Height of the chat input. Defaults to `29px`. |
| `inputWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | Width of the chat input, not regarding the margins. Defaults to `100%`. |
| `margin` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | The margin of the chat to the viewport in pixels. Defaults to `8px`. |
| `messagesWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-114) | The default width of the message list. Defaults to `40vw`. |
| `commandSymbol` | `string` | Symbol to activate typing a command, needs to be 1 character long! Defaults to '/'. |

___

### ClockParams

Ƭ **ClockParams**: `Object`

Parameters to initialize the Voxelize clock.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxDelta` | `number` | The maximum delta allowed for each game loop. Defaults to 0.3. |

___

### ContainerParams

Ƭ **ContainerParams**: `Object`

Parameters to initialize the Voxelize container.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `domElement` | `HTMLElement` | The DOM element that wraps all Voxelize UI components. |
| `canvas` | `HTMLCanvasElement` | The `HTMLCanvasElement` that Voxelize draws on. |
| `crosshairStyles?` | `CSSStyleDeclaration` | The styles applied to the crosshair. |

___

### ControlsParams

Ƭ **ControlsParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `sensitivity` | `number` |
| `acceleration` | `number` |
| `flyingInertia` | `number` |
| `minPolarAngle` | `number` |
| `maxPolarAngle` | `number` |
| `lookBlockScale` | `number` |
| `lookBlockColor` | `string` |
| `lookBlockLerp` | `number` |
| `reachDistance` | `number` |
| `initialPosition` | [`Coords3`](modules.md#coords3-114) |
| `rotationLerp` | `number` |
| `bodyWidth` | `number` |
| `bodyHeight` | `number` |
| `bodyDepth` | `number` |
| `eyeHeight` | `number` |
| `maxSpeed` | `number` |
| `moveForce` | `number` |
| `responsiveness` | `number` |
| `runningFriction` | `number` |
| `standingFriction` | `number` |
| `flySpeed` | `number` |
| `flyForce` | `number` |
| `flyImpulse` | `number` |
| `flyInertia` | `number` |
| `sprintFactor` | `number` |
| `airMoveMult` | `number` |
| `jumpImpulse` | `number` |
| `jumpForce` | `number` |
| `jumpTime` | `number` |
| `airJumps` | `number` |

___

### NewEntity

Ƭ **NewEntity**: () => [`BaseEntity`](classes/BaseEntity.md)

#### Type declaration

• ()

___

### EntitiesParams

Ƭ **EntitiesParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lerpFactor` | `number` |

___

### NetworkParams

Ƭ **NetworkParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `serverURL` | `string` |
| `reconnectTimeout` | `number` |
| `maxPacketsPerTick` | `number` |

___

### PeersParams

Ƭ **PeersParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lerpFactor` | `number` |
| `headColor` | `string` |
| `headDimension` | `number` |
| `maxNameDistance` | `number` |
| `fontFace` | `string` |

___

### PhysicsParams

Ƭ **PhysicsParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `gravity` | `number`[] |
| `minBounceImpulse` | `number` |
| `airDrag` | `number` |
| `fluidDrag` | `number` |
| `fluidDensity` | `number` |

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

___

### RegistryParams

Ƭ **RegistryParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |

___

### RenderingParams

Ƭ **RenderingParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `clearColor` | `string` |

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
| `maxAddsPerTick` | `number` |
| `skyFaces` | [`PartialRecord`](modules.md#partialrecord-114)<[`BoxSides`](modules.md#boxsides-114), `SkyFace`\> |

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
| `heightMap` | `Uint32Array` |
| `mesh` | [`ServerMesh`](modules.md#servermesh-114) |

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

Ƭ **BlockFace**: keyof [`AllFaces`](modules.md#allfaces-114) \| keyof [`ThreeFaces`](modules.md#threefaces-114) \| keyof [`SixFaces`](modules.md#sixfaces-114) \| keyof [`PlantFaces`](modules.md#plantfaces-114)

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
| `faces` | [`BlockFace`](modules.md#blockface-114)[] |
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
| `opaque?` | [`MeshData`](modules.md#meshdata-114) |
| `transparent?` | [`MeshData`](modules.md#meshdata-114) |

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

## Variables

### DirtyFlag

• `Const` **DirtyFlag**: [`ComponentClassType`](modules.md#componentclasstype-114)<`unknown`\>

___

### EntityFlag

• `Const` **EntityFlag**: [`ComponentClassType`](modules.md#componentclasstype-114)<`unknown`\>

___

### ClientFlag

• `Const` **ClientFlag**: [`ComponentClassType`](modules.md#componentclasstype-114)<`unknown`\>

___

### ChunkFlag

• `Const` **ChunkFlag**: [`ComponentClassType`](modules.md#componentclasstype-114)<`unknown`\>

___

### HeadingComponent

• `Const` **HeadingComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`Vector3`\>

___

### IDComponent

• `Const` **IDComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`string`\>

___

### MeshComponent

• `Const` **MeshComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`Object3D`<`Event`\>\>

___

### MetadataComponent

• `Const` **MetadataComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<{ `[key: string]`: `any`;  }\>

___

### NameComponent

• `Const` **NameComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`string`\>

___

### Position3DComponent

• `Const` **Position3DComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`Vector3`\>

___

### TargetComponent

• `Const` **TargetComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`Vector3`\>

___

### TypeComponent

• `Const` **TypeComponent**: [`ComponentClassType`](modules.md#componentclasstype-114)<`string`\>

___

### defaultBlock

• `Const` **defaultBlock**: [`Block`](modules.md#block-114)

## Functions

### raycast

▸ **raycast**(`getVoxel`, `origin`, `direction`, `maxD`, `hitPos?`, `hitNorm?`): ``true`` \| ``0``

#### Parameters

| Name | Type |
| :------ | :------ |
| `getVoxel` | `GetVoxel` |
| `origin` | [`Coords3`](modules.md#coords3-114) |
| `direction` | [`Coords3`](modules.md#coords3-114) |
| `maxD` | `number` |
| `hitPos` | [`Coords3`](modules.md#coords3-114) |
| `hitNorm` | [`Coords3`](modules.md#coords3-114) |

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
