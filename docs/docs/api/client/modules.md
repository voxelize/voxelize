---
id: "modules"
title: "@voxelize/client"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Core Classes

- [Chat](classes/Chat.md)
- [InputManager](classes/InputManager.md)
- [Network](classes/Network.md)

## Other Classes

- [BlockRotation](classes/BlockRotation.md)
- [Debug](classes/Debug.md)
- [Events](classes/Events.md)
- [FreeCameraKeyboardInput](classes/FreeCameraKeyboardInput.md)
- [Method](classes/Method.md)
- [WorkerPool](classes/WorkerPool.md)
- [World](classes/World.md)

## Utils Classes

- [BlockUtils](classes/BlockUtils.md)
- [ChunkUtils](classes/ChunkUtils.md)
- [DOMUtils](classes/DOMUtils.md)
- [LightUtils](classes/LightUtils.md)
- [MathUtils](classes/MathUtils.md)

## Interfaces

- [NetIntercept](interfaces/NetIntercept.md)

## Variables

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: ``"BLUE"``

The string representation of blue light.

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

## Type Aliases

### Block

Ƭ **Block**: `Object`

A block type in the world. This is defined by the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `aabbs` | `AABB`[] | A list of axis-aligned bounding boxes that this block has. |
| `blueLightLevel` | `number` | The blue light level of the block. |
| `dynamicFn` | (`pos`: [`Coords3`](modules.md#coords3-2), `world`: [`World`](classes/World.md)) => { `aabbs`: [`Block`](modules.md#block-2)[``"aabbs"``] ; `faces`: [`Block`](modules.md#block-2)[``"faces"``] ; `isTransparent`: [`Block`](modules.md#block-2)[``"isTransparent"``]  } | If this block is dynamic, this function will be called to generate the faces and AABB's. By default, this just returns the faces and AABB's that are defined in the block data. |
| `faces` | { `animated`: `boolean` ; `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `highRes`: `boolean` ; `independent`: `boolean` ; `name`: `string`  }[] | A list of block face data that this block has. |
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

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

A CSS measurement. E.g. "30px", "51em"

___

### CameraPerspective

Ƭ **CameraPerspective**: ``"px"`` \| ``"nx"`` \| ``"py"`` \| ``"ny"`` \| ``"pz"`` \| ``"nz"`` \| ``"pxy"`` \| ``"nxy"`` \| ``"pxz"`` \| ``"nxz"`` \| ``"pyz"`` \| ``"nyz"`` \| ``"pxyz"`` \| ``"nxyz"``

___

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

Three types of clicking for mouse input listening.

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

### DebugParams

Ƭ **DebugParams**: `Object`

Parameters to create a [Debug](classes/Debug.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dataClass` | `string` | A class to add to the wrapper of the top-left debug panel. |
| `dataStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of the top-left debug panel. |
| `entriesClass` | `string` | A class to add to the wrapper of all debug entries. |
| `entryStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of all debug entries. |
| `lineClass` | `string` | A class to add to each of the debug entry line (top left). |
| `lineStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to each of the debug entry line (top left). |
| `onByDefault` | `boolean` | Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`. You can toggle the debug panel by calling [toggle](classes/Debug.md#toggle-2). |
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
| `occasion?` | [`InputOccasion`](modules.md#inputoccasion-2) | The occasion that the input should be fired. Defaults to `keydown`. |

___

### LightColor

Ƭ **LightColor**: ``"RED"`` \| ``"GREEN"`` \| ``"BLUE"`` \| ``"SUNLIGHT"``

Sunlight or the color of torch light.

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

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & { `sendEvent`: (`event`: `any`) => `void`  }

A custom WebSocket type that supports protocol buffer sending.

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
