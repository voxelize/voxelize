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
- [Mesher](classes/Mesher.md)
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
- [Iterator](classes/Iterator.md)
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

Parameters to customize the Voxelize camera.

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

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

Test test test

___

### ChatParams

Ƭ **ChatParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `gap` | [`CSSMeasurement`](modules.md#cssmeasurement-56) |
| `margin` | `number` |
| `align` | ``"left"`` \| ``"center"`` \| ``"right"`` |
| `messagesWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-56) |
| `inputWidth` | [`CSSMeasurement`](modules.md#cssmeasurement-56) |
| `inputHeight` | [`CSSMeasurement`](modules.md#cssmeasurement-56) |
| `borderRadius` | [`CSSMeasurement`](modules.md#cssmeasurement-56) |
| `disappearTimeout` | `number` |
| `connectionMessage` | `string` |
| `disconnectionMessage` | `string` |
| `helpText` | `string` |

___

### ContainerParams

Ƭ **ContainerParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `domElement` | `HTMLElement` |
| `canvas` | `HTMLCanvasElement` |

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
| `initialPosition` | `Coords3` |
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
| `skyFaces` | `PartialRecord`<[`BoxSides`](modules.md#boxsides-56), `SkyFace`\> |

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
| `mesh` | `ServerMesh` |

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

Ƭ **EventCallback**: (`data`: `any`, `entities`: [`Iterator`](classes/Iterator.md)<[`Entity`](classes/Entity.md)\>) => `void`

#### Type declaration

▸ (`data`, `entities`): `void`

System callback

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |
| `entities` | [`Iterator`](classes/Iterator.md)<[`Entity`](classes/Entity.md)\> |

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

## Variables

### DirtyFlag

• `Const` **DirtyFlag**: [`ComponentClassType`](modules.md#componentclasstype-56)<`unknown`\>

___

### EntityFlag

• `Const` **EntityFlag**: [`ComponentClassType`](modules.md#componentclasstype-56)<`unknown`\>

___

### ClientFlag

• `Const` **ClientFlag**: [`ComponentClassType`](modules.md#componentclasstype-56)<`unknown`\>

___

### ChunkFlag

• `Const` **ChunkFlag**: [`ComponentClassType`](modules.md#componentclasstype-56)<`unknown`\>

___

### HeadingComponent

• `Const` **HeadingComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`Vector3`\>

___

### IDComponent

• `Const` **IDComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`string`\>

___

### MeshComponent

• `Const` **MeshComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`Object3D`<`Event`\>\>

___

### MetadataComponent

• `Const` **MetadataComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<{ `[key: string]`: `any`;  }\>

___

### NameComponent

• `Const` **NameComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`string`\>

___

### Position3DComponent

• `Const` **Position3DComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`Vector3`\>

___

### TargetComponent

• `Const` **TargetComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`Vector3`\>

___

### TypeComponent

• `Const` **TypeComponent**: [`ComponentClassType`](modules.md#componentclasstype-56)<`string`\>

## Functions

### raycast

▸ **raycast**(`getVoxel`, `origin`, `direction`, `maxD`, `hitPos?`, `hitNorm?`): ``true`` \| ``0``

#### Parameters

| Name | Type |
| :------ | :------ |
| `getVoxel` | `GetVoxel` |
| `origin` | `Coords3` |
| `direction` | `Coords3` |
| `maxD` | `number` |
| `hitPos` | `Coords3` |
| `hitNorm` | `Coords3` |

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
