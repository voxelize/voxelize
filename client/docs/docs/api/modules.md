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
- [Network](classes/Network.md)
- [Peers](classes/Peers.md)
- [Registry](classes/Registry.md)
- [RigidControls](classes/RigidControls.md)
- [World](classes/World.md)

## Effects Classes

- [BlockBreakParticles](classes/BlockBreakParticles.md)
- [BlockOverlayEffect](classes/BlockOverlayEffect.md)
- [ColorText](classes/ColorText.md)
- [LightShined](classes/LightShined.md)

## Other Classes

- [Arrow](classes/Arrow.md)
- [BlockRotation](classes/BlockRotation.md)
- [BoxLayer](classes/BoxLayer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Character](classes/Character.md)
- [Chunk](classes/Chunk.md)
- [ChunkMesh](classes/ChunkMesh.md)
- [Chunks](classes/Chunks.md)
- [Clouds](classes/Clouds.md)
- [Debug](classes/Debug.md)
- [Events](classes/Events.md)
- [ImageVoxelizer](classes/ImageVoxelizer.md)
- [NameTag](classes/NameTag.md)
- [Perspective](classes/Perspective.md)
- [Rigid](classes/Rigid.md)
- [Shadow](classes/Shadow.md)
- [Shadows](classes/Shadows.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [TextureAtlas](classes/TextureAtlas.md)
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

## Variables

### ALL\_FACES

• `Const` **ALL\_FACES**: `string`[]

The default symbols for 6-faced block face data.

___

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: ``"BLUE"``

The string representation of blue light.

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: [`BoxSides`](modules.md#boxsides-156)[]

The six default faces of a canvas box.

___

### DIAGONAL\_FACES

• `Const` **DIAGONAL\_FACES**: `string`[]

The default symbols for two diagonal sides.

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

### SIDE\_FACES

• `Const` **SIDE\_FACES**: `string`[]

The default symbols for the 4 sides excluding the top and bottom.

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

___

### artFunctions

• `Const` **artFunctions**: `Object`

A preset of art functions to draw on canvas boxes.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `drawCrown` | [`ArtFunction`](modules.md#artfunction-156) |
| `drawSun` | [`ArtFunction`](modules.md#artfunction-156) |

## Type Aliases

### ArmsParams

Ƭ **ArmsParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-156) & { `shoulderDrop?`: `number` ; `shoulderGap?`: `number`  }

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

A block type in the world.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `aabbs` | `AABB`[] | A list of axis-aligned bounding boxes that this block has. |
| `blueLightLevel` | `number` | The blue light level of the block. |
| `faces` | { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `name`: `string`  }[] | A list of block face data that this block has. |
| `greenLightLevel` | `number` | The green light level of the block. |
| `id` | `number` | The block id. |
| `isEmpty` | `boolean` | Whether or not is this block empty. By default, only "air" is empty. |
| `isFluid` | `boolean` | Whether or not is the block a fluid block. |
| `isLight` | `boolean` | Whether or not is this block a light source. |
| `isNxTransparent` | `boolean` | Whether or not is this block transparent on the negative x direction. |
| `isNyTransparent` | `boolean` | Whether or not is this block transparent on the negative y direction. |
| `isNzTransparent` | `boolean` | Whether or not is this block transparent on the negative z direction. |
| `isOpaque` | `boolean` | Whether or not is this block opaque (not transparent). |
| `isPassable` | `boolean` | Whether or not should physics ignore this block. |
| `isPxTransparent` | `boolean` | Whether or not is this block transparent on the positive x direction. |
| `isPyTransparent` | `boolean` | Whether or not is this block transparent on the positive y direction. |
| `isPzTransparent` | `boolean` | Whether or not is this block transparent on the positive z direction. |
| `isSeeThrough` | `boolean` | Whether or not is this block see-through (can be opaque and see-through at the same time). |
| `lightReduce` | `boolean` | Whether or not should light reduce by 1 going through this block. |
| `name` | `string` | The name of the block. |
| `redLightLevel` | `number` | The red light level of the block. |
| `rotatable` | `boolean` | Whether or not is the block rotatable. |
| `yRotatable` | `boolean` | Whether or not the block is rotatable around the y-axis (has to face either PX or NX). |

___

### BlockBreakParticlesParams

Ƭ **BlockBreakParticlesParams**: `Object`

Parameters to create a block break particle system.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `capScale` | `number` | The scale of which the lifespans of the particles that are emitted in bursts are scaled. Defaults to `0.1`. |
| `capSize` | `number` | The maximum block breaks for a regular particle emission. Otherwise, a burst is emitted. Defaults to `5`. |
| `impulse` | `number` | The initial impulse of the rigid particles. Defaults to `3`. |
| `maxCount` | `number` | The maximum count of a particle to be emitted per block break. Defaults to `25`. |
| `maxLife` | `number` | The maximum lifespan of the particles. Defaults to `4`. |
| `minCount` | `number` | The minimum count of a particle to be emitted per block break. Defaults to `15`. |
| `minLife` | `number` | The minimum lifespan of the particles. Defaults to `2`. |
| `scale` | `number` | The size of the rigid particles. Defaults to `0.1`. |
| `zoneWidth` | `number` | Around the center of the block break, the dimension of the box-sized zone in which the particles are emitted from. Defaults to `1`. |

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

Ƭ **BodyParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-156)

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

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"sides"`` \| ``"all"``

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`${number}${string}\`

A CSS measurement. E.g. "30px", "51em"

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
| `arms?` | `Partial`<[`ArmsParams`](modules.md#armsparams-156)\> | Parameters to create the character's arms. |
| `body?` | `Partial`<[`BodyParams`](modules.md#bodyparams-156)\> | Parameters to create the character's body. |
| `head?` | `Partial`<[`HeadParams`](modules.md#headparams-156)\> | Parameters to create the character's head. |
| `idleArmSwing?` | `number` | The speed at which the arms swing when the character is idle. Defaults to `0.06`. |
| `legs?` | `Partial`<[`LegParams`](modules.md#legparams-156)\> | Parameters to create the character's legs. |
| `positionLerp?` | `number` | The lerp factor of the character's position change. Defaults to `0.7`. |
| `rotationLerp?` | `number` | The lerp factor of the character's rotation change. Defaults to `0.2`. |
| `swingLerp?` | `number` | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`. |
| `walkingSpeed?` | `number` | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |

___

### ChunkParams

Ƭ **ChunkParams**: `Object`

Parameters to construct a new chunk.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxHeight` | `number` | The vertical height of the chunk, in blocks. This configuration is loaded from the server's world config. |
| `size` | `number` | The horizontal dimensions of the chunk, in blocks. This configuration is loaded from the server's world config. |
| `subChunks` | `number` | The vertical segments of the chunk, in blocks. This configuration is loaded from the server's world config. |

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
| `dimensions` | [`Coords3`](modules.md#coords3-156) | The dimension of each cloud block. Defaults to `[20, 20, 20]`. |
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
| `dimensions` | [`Coords3`](modules.md#coords3-156) |
| `max` | [`Coords3`](modules.md#coords3-156) |
| `min` | [`Coords3`](modules.md#coords3-156) |
| `realMax` | [`Coords3`](modules.md#coords3-156) |
| `realMin` | [`Coords3`](modules.md#coords3-156) |

___

### CustomShaderMaterial

Ƭ **CustomShaderMaterial**: `ShaderMaterial` & { `map`: `Texture`  }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.

___

### DebugParams

Ƭ **DebugParams**: `Object`

Parameters to create a [Debug](classes/Debug.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dataClass` | `string` | A class to add to the wrapper of the top-left debug panel. |
| `dataStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of the top-left debug panel. |
| `entryClass` | `string` | A class to add to the wrapper of all debug entries. |
| `entryStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of all debug entries. |
| `lineClass` | `string` | A class to add to each of the debug entry line (top left). |
| `lineStyles` | `Partial`<`CSSStyleDeclaration`\> | Styles to apply to each of the debug entry line (top left). |
| `onByDefault` | `boolean` | Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`. You can toggle the debug panel by calling [Debug.toggle](classes/Debug.md#toggle-156). |
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

Ƭ **HeadParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-156) & { `neckGap?`: `number`  }

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

### ImageVoxelizerParams

Ƭ **ImageVoxelizerParams**: `Object`

Parameters to process an image voxelization.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `height` | `number` | The height, in blocks, of the voxelized image. Defaults to `64`. |
| `lockedRatio` | `boolean` | Whether or not should the ratio between width and height be locked. If true, the width would be ignored and be later determined form the height. Defaults to `false`. |
| `orientation` | ``"x"`` \| ``"z"`` | Which direction to place the voxelized image. |
| `width` | `number` | The width, in blocks, of the voxelized image. Defaults to `64`. |

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
| `occasion?` | [`InputOccasion`](modules.md#inputoccasion-156) | The occasion that the input should be fired. Defaults to `keydown`. |

___

### LegParams

Ƭ **LegParams**: [`CanvasBoxParams`](modules.md#canvasboxparams-156) & { `betweenLegsGap?`: `number`  }

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

#### Type declaration

| Name | Type |
| :------ | :------ |
| `blockMargin` | `number` |
| `lerpFactor` | `number` |
| `maxDistance` | `number` |

___

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & { `sendEvent`: (`event`: `any`) => `void`  }

A custom WebSocket type that supports protocol buffer sending.

___

### RegistryParams

Ƭ **RegistryParams**: `Object`

Parameters to initialize the registry.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dimension` | `number` | The dimension of each registered block texture. Defaults to `8`. |

___

### RigidControlState

Ƭ **RigidControlState**: `Object`

The state of which a Voxelize {@link Controls} is in.

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

Parameters to initialize the Voxelize {@link Controls}.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airJumps` | `number` | How many times can a client jump in the air. Defaults to `0`. |
| `airMoveMult` | `number` | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`. |
| `alwaysSprint` | `boolean` | Sprint factor would be on always. |
| `bodyDepth` | `number` | The depth of the client's avatar. Defaults to `0.8` blocks. |
| `bodyHeight` | `number` | The height of the client's avatar. Defaults to `1.55` blocks. |
| `bodyWidth` | `number` | The width of the client's avatar. Defaults to `0.8` blocks. |
| `crouchFactor` | `number` | The factor to the movement speed when crouch is applied. Defaults to `0.6`. |
| `eyeHeight` | `number` | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.919`. |
| `fluidPushForce` | `number` | The force upwards when a client tries to jump in water. Defaults to `0.3`. |
| `flyForce` | `number` | The level of force at which a client flies at. Defaults to `80`. |
| `flyImpulse` | `number` | The level impulse of which a client flies at. Defaults to `2.5`. |
| `flyInertia` | `number` | The inertia of a client when they're flying. Defaults to `6`. |
| `flySpeed` | `number` | The level of speed at which a client flies at. Defaults to `40`. |
| `initialPosition` | [`Coords3`](modules.md#coords3-156) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `maxSpeed` | `number` | The maximum level of speed of a client. Default is `6` . |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `moveForce` | `number` | The level of force of which the client can move at. Default is `30`. |
| `positionLerp` | `number` | The interpolation factor of the client's position. Defaults to `0.9`. |
| `responsiveness` | `number` | The level of responsiveness of a client to movements. Default is `240`. |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `runningFriction` | `number` | Default running friction of a client. Defaults to `0.1`. |
| `sensitivity` | `number` | The mouse sensitivity. Defaults to `100`. |
| `sprintFactor` | `number` | The factor to the movement speed when sprint is applied. Defaults to `1.4`. |
| `standingFriction` | `number` | Default standing friction of a client. Defaults to `4`. |
| `stepHeight` | `number` | How tall a client can step up. Defaults to `0.5`. |

___

### ShadowParams

Ƭ **ShadowParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxDistance` | `number` |
| `maxRadius` | `number` |

___

### SkyFace

Ƭ **SkyFace**: [`ArtFunction`](modules.md#artfunction-156) \| `Color` \| `string` \| ``null``

___

### TextureAtlasParams

Ƭ **TextureAtlasParams**: `Object`

Parameters to create a new [TextureAtlas](classes/TextureAtlas.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `countPerSide` | `number` | The number of block textures on each side of the atlas. |
| `dimension` | `number` | The dimension of each block texture. |

___

### TextureData

Ƭ **TextureData**: `Object`

Data passed to [applyTextureByName](classes/World.md#applytexturebyname-156) or [applyTexturesByNames](classes/World.md#applytexturesbynames-156) to load a block texture.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | `string` \| `Color` | Either the URL to the source image, or a ThreeJS color instance. |
| `name` | `string` | The name of the block to load. E.g. "Dirt". |
| `sides` | `string`[] \| `string` | The sides that this data loads onto. |

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

#### Type declaration

| Name | Type |
| :------ | :------ |
| `highlightColor` | `Color` |
| `highlightLerp` | `number` |
| `highlightOpacity` | `number` |
| `highlightScale` | `number` |
| `highlightType` | ``"box"`` \| ``"outline"`` |
| `ignoreFluid` | `boolean` |
| `inverseDirection` | `boolean` |
| `potentialVisuals` | `boolean` |
| `reachDistance` | `number` |

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `buffers?` | `ArrayBufferLike`[] |
| `message` | `any` |
| `resolve` | (`value`: `any`) => `void` |

___

### WorkerPoolParams

Ƭ **WorkerPoolParams**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxWorker` | `number` |

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
| `minBrightness` | `number` |
| `rerequestTicks` | `number` |
| `textureDimension` | `number` |
| `updateTimeout` | `number` |

___

### WorldParams

Ƭ **WorldParams**: [`WorldClientParams`](modules.md#worldclientparams-156) & [`WorldServerParams`](modules.md#worldserverparams-156)

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

___

### cull

▸ **cull**(`array`, `options`): `Promise`<[`MeshResultType`](modules.md#meshresulttype-156)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype-156) |

#### Returns

`Promise`<[`MeshResultType`](modules.md#meshresulttype-156)\>
