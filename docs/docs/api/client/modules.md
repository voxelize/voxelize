---
id: "modules"
title: "@voxelize/core"
sidebar_label: "Exports"
sidebar_position: 0.5
custom_edit_url: null
---

## Enumerations

- [BlockRuleLogic](enums/BlockRuleLogic.md)

## Core Classes

- [Chat](classes/Chat.md)
- [Entities](classes/Entities.md)
- [Inputs](classes/Inputs.md)
- [Loader](classes/Loader.md)
- [MobileRigidControls](classes/MobileRigidControls.md)
- [Peers](classes/Peers.md)
- [RigidControls](classes/RigidControls.md)
- [World](classes/World.md)

## Effects Classes

- [BlockOverlayEffect](classes/BlockOverlayEffect.md)
- [ColorText](classes/ColorText.md)
- [LightShined](classes/LightShined.md)

## Other Classes

- [AnimationUtils](classes/AnimationUtils.md)
- [Arm](classes/Arm.md)
- [Arrow](classes/Arrow.md)
- [AtlasTexture](classes/AtlasTexture.md)
- [BlockRotation](classes/BlockRotation.md)
- [BoxLayer](classes/BoxLayer.md)
- [CSMRenderer](classes/CSMRenderer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Character](classes/Character.md)
- [Chunk](classes/Chunk.md)
- [ChunkPipeline](classes/ChunkPipeline.md)
- [ChunkRenderer](classes/ChunkRenderer.md)
- [Clouds](classes/Clouds.md)
- [Creature](classes/Creature.md)
- [Debug](classes/Debug.md)
- [Entity](classes/Entity.md)
- [Events](classes/Events.md)
- [FaceAnimation](classes/FaceAnimation.md)
- [ItemSlot](classes/ItemSlot.md)
- [ItemSlots](classes/ItemSlots.md)
- [LightSourceRegistry](classes/LightSourceRegistry.md)
- [LightVolume](classes/LightVolume.md)
- [MeshPipeline](classes/MeshPipeline.md)
- [Method](classes/Method.md)
- [NameTag](classes/NameTag.md)
- [Network](classes/Network.md)
- [Perspective](classes/Perspective.md)
- [Portrait](classes/Portrait.md)
- [Registry](classes/Registry.md)
- [Shadow](classes/Shadow.md)
- [Shadows](classes/Shadows.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [ThreeUtils](classes/ThreeUtils.md)
- [VoxelInteract](classes/VoxelInteract.md)
- [WebRTCConnection](classes/WebRTCConnection.md)
- [WorkerPool](classes/WorkerPool.md)

## Utils Classes

- [BlockUtils](classes/BlockUtils.md)
- [ChunkUtils](classes/ChunkUtils.md)
- [DOMUtils](classes/DOMUtils.md)
- [LightUtils](classes/LightUtils.md)
- [MathUtils](classes/MathUtils.md)

## Interfaces

- [BlockConditionalPart](interfaces/BlockConditionalPart.md)
- [BlockDynamicPattern](interfaces/BlockDynamicPattern.md)
- [CSMConfig](interfaces/CSMConfig.md)
- [DynamicLight](interfaces/DynamicLight.md)
- [EntityShadowUniforms](interfaces/EntityShadowUniforms.md)
- [LightRegion](interfaces/LightRegion.md)
- [LightVolumeConfig](interfaces/LightVolumeConfig.md)
- [NetIntercept](interfaces/NetIntercept.md)
- [ShaderLightingUniforms](interfaces/ShaderLightingUniforms.md)
- [TransparentMeshData](interfaces/TransparentMeshData.md)

## Type Aliases

### ArgMetadata

Ƭ **ArgMetadata**: `Object`

Metadata extracted from a Zod schema for UI purposes.

#### Type declaration

| Name            | Type                                                |
| :-------------- | :-------------------------------------------------- |
| `defaultValue?` | `string` \| `number` \| `boolean`                   |
| `name`          | `string`                                            |
| `options?`      | `string`[]                                          |
| `required`      | `boolean`                                           |
| `type`          | `"string"` \| `"number"` \| `"enum"` \| `"boolean"` |

---

### ArmOptions

Ƭ **ArmOptions**: `Object`

#### Type declaration

| Name                   | Type                                     |
| :--------------------- | :--------------------------------------- |
| `armColor?`            | `string` \| `THREE.Color`                |
| `armObject?`           | `THREE.Object3D`                         |
| `armObjectOptions`     | `ArmObjectOptions`                       |
| `armTexture?`          | `THREE.Texture`                          |
| `blockObjectOptions?`  | `ArmObjectOptions`                       |
| `customObjectOptions?` | `Record`\<`string`, `ArmObjectOptions`\> |
| `receiveShadows?`      | `boolean`                                |

---

### ArmsOptions

Ƭ **ArmsOptions**: `ColorCanvasBoxOptions` & \{ `shoulderDrop?`: `number` ; `shoulderGap?`: `number` }

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

---

### ArrowOptions

Ƭ **ArrowOptions**: `Object`

Parameters to create an arrow.

#### Type declaration

| Name         | Type                | Description                                             |
| :----------- | :------------------ | :------------------------------------------------------ |
| `color`      | `string` \| `Color` | The color of the arrow. Defaults to `red`.              |
| `coneHeight` | `number`            | The height of the head of the arrow. Defaults to `0.2`. |
| `coneRadius` | `number`            | The radius of the head of the arrow. Defaults to `0.2`. |
| `height`     | `number`            | The height of the body of the arrow. Defaults to `0.8`. |
| `radius`     | `number`            | The radius of the body of the arrow. Defaults to `0.1`. |

---

### ArtFunction

Ƭ **ArtFunction**: (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void`

A function to programmatically draw on a canvas.

#### Type declaration

▸ (`context`, `canvas`): `void`

##### Parameters

| Name      | Type                       |
| :-------- | :------------------------- |
| `context` | `CanvasRenderingContext2D` |
| `canvas`  | `HTMLCanvasElement`        |

##### Returns

`void`

---

### Block

Ƭ **Block**: `Object`

A block type in the world. This is defined by the server.

#### Type declaration

| Name                    | Type                                                                                                                                                                                                                                                                  | Description                                                                                                                                       |
| :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `aabbs`                 | `AABB`[]                                                                                                                                                                                                                                                              | A list of axis-aligned bounding boxes that this block has.                                                                                        |
| `blueLightLevel`        | `number`                                                                                                                                                                                                                                                              | The blue light level of the block.                                                                                                                |
| `dynamicFn`             | (`pos`: [`Coords3`](modules.md#coords3)) => \{ `aabbs`: [`Block`](modules.md#block)[``"aabbs"``] ; `faces`: [`Block`](modules.md#block)[``"faces"``] ; `isTransparent`: [`Block`](modules.md#block)[``"isTransparent"``] }                                            | -                                                                                                                                                 |
| `dynamicPatterns`       | [`BlockDynamicPattern`](interfaces/BlockDynamicPattern.md)[]                                                                                                                                                                                                          | -                                                                                                                                                 |
| `faces`                 | \{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[] }[] ; `dir`: [`number`, `number`, `number`] ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `range`: [`UV`](modules.md#uv) ; `textureGroup`: `string` \| `null` }[] | A list of block face data that this block has.                                                                                                    |
| `fluidFlowForce`        | `number`                                                                                                                                                                                                                                                              | The force applied to entities in this fluid, pushing them in the flow direction.                                                                  |
| `greenLightLevel`       | `number`                                                                                                                                                                                                                                                              | The green light level of the block.                                                                                                               |
| `id`                    | `number`                                                                                                                                                                                                                                                              | The block id.                                                                                                                                     |
| `independentFaces`      | `Set`\<`string`\>                                                                                                                                                                                                                                                     | A set of block face names that are independent (high resolution or animated). This is generated on the client side.                               |
| `isClimbable`           | `boolean`                                                                                                                                                                                                                                                             | Whether or not can entities climb this block.                                                                                                     |
| `isDynamic`             | `boolean`                                                                                                                                                                                                                                                             | Whether or not does the block generate dynamic faces or AABB's. If this is true, the block will use `dynamicFn` to generate the faces and AABB's. |
| `isEmpty`               | `boolean`                                                                                                                                                                                                                                                             | Whether or not is this block empty. By default, only "air" is empty.                                                                              |
| `isEntity`              | `boolean`                                                                                                                                                                                                                                                             | -                                                                                                                                                 |
| `isFluid`               | `boolean`                                                                                                                                                                                                                                                             | Whether or not is the block a fluid block.                                                                                                        |
| `isLight`               | `boolean`                                                                                                                                                                                                                                                             | Whether or not is this block a light source.                                                                                                      |
| `isOpaque`              | `boolean`                                                                                                                                                                                                                                                             | Whether or not is this block opaque (not transparent).                                                                                            |
| `isPassable`            | `boolean`                                                                                                                                                                                                                                                             | Whether or not should physics ignore this block.                                                                                                  |
| `isSeeThrough`          | `boolean`                                                                                                                                                                                                                                                             | Whether or not is this block see-through (can be opaque and see-through at the same time).                                                        |
| `isTransparent`         | [`boolean`, `boolean`, `boolean`, `boolean`, `boolean`, `boolean`]                                                                                                                                                                                                    | Whether or not is this block transparent viewing from all six sides. The sides are defined as PX, PY, PZ, NX, NY, NZ.                             |
| `isWaterlogged`         | `boolean`                                                                                                                                                                                                                                                             | Whether or not is the block waterlogged (exists inside water).                                                                                    |
| `isolatedFaces`         | `Set`\<`string`\>                                                                                                                                                                                                                                                     | -                                                                                                                                                 |
| `lightReduce`           | `boolean`                                                                                                                                                                                                                                                             | Whether or not should light reduce by 1 going through this block.                                                                                 |
| `name`                  | `string`                                                                                                                                                                                                                                                              | The name of the block.                                                                                                                            |
| `redLightLevel`         | `number`                                                                                                                                                                                                                                                              | The red light level of the block.                                                                                                                 |
| `rotatable`             | `boolean`                                                                                                                                                                                                                                                             | Whether or not is the block rotatable.                                                                                                            |
| `transparentStandalone` | `boolean`                                                                                                                                                                                                                                                             | -                                                                                                                                                 |
| `yRotatable`            | `boolean`                                                                                                                                                                                                                                                             | Whether or not the block is rotatable around the y-axis (has to face either PX or NX).                                                            |
| `yRotatableSegments`    | `"All"` \| `"Eight"` \| `"Four"`                                                                                                                                                                                                                                      | -                                                                                                                                                 |

---

### BlockEntityUpdateData

Ƭ **BlockEntityUpdateData**\<`T`\>: `Object`

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Type declaration

| Name        | Type                            |
| :---------- | :------------------------------ |
| `etype`     | `string`                        |
| `id`        | `string`                        |
| `newValue`  | `T` \| `null`                   |
| `oldValue`  | `T` \| `null`                   |
| `operation` | `EntityOperation`               |
| `voxel`     | [`Coords3`](modules.md#coords3) |

---

### BlockEntityUpdateListener

Ƭ **BlockEntityUpdateListener**\<`T`\>: (`args`: [`BlockEntityUpdateData`](modules.md#blockentityupdatedata)\<`T`\>) => `void`

#### Type parameters

| Name |
| :--- |
| `T`  |

#### Type declaration

▸ (`args`): `void`

##### Parameters

| Name   | Type                                                               |
| :----- | :----------------------------------------------------------------- |
| `args` | [`BlockEntityUpdateData`](modules.md#blockentityupdatedata)\<`T`\> |

##### Returns

`void`

---

### BlockRule

Ƭ **BlockRule**: \{ `type`: `"none"` } \| \{ `type`: `"simple"` } & [`BlockSimpleRule`](modules.md#blocksimplerule) \| \{ `logic`: [`BlockRuleLogic`](enums/BlockRuleLogic.md) ; `rules`: [`BlockRule`](modules.md#blockrule)[] ; `type`: `"combination"` }

---

### BlockSimpleRule

Ƭ **BlockSimpleRule**: `Object`

#### Type declaration

| Name        | Type                                        |
| :---------- | :------------------------------------------ |
| `id?`       | `number`                                    |
| `offset`    | [`Coords3`](modules.md#coords3)             |
| `rotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `stage?`    | `number`                                    |

---

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

A block update to make on the server.

#### Type declaration

| Name         | Type     | Description                                   |
| :----------- | :------- | :-------------------------------------------- |
| `rotation?`  | `number` | The optional rotation of the updated block.   |
| `stage?`     | `number` | The optional stage of the updated block.      |
| `type`       | `number` | The voxel type.                               |
| `vx`         | `number` | The voxel x-coordinate.                       |
| `vy`         | `number` | The voxel y-coordinate.                       |
| `vz`         | `number` | The voxel z-coordinate.                       |
| `yRotation?` | `number` | The optional y-rotation of the updated block. |

---

### BlockUpdateListener

Ƭ **BlockUpdateListener**: (`args`: \{ `newValue`: `number` ; `oldValue`: `number` ; `voxel`: [`Coords3`](modules.md#coords3) }) => `void`

#### Type declaration

▸ (`args`): `void`

##### Parameters

| Name            | Type                            |
| :-------------- | :------------------------------ |
| `args`          | `Object`                        |
| `args.newValue` | `number`                        |
| `args.oldValue` | `number`                        |
| `args.voxel`    | [`Coords3`](modules.md#coords3) |

##### Returns

`void`

---

### BlockUpdateWithSource

Ƭ **BlockUpdateWithSource**: `Object`

#### Type declaration

| Name     | Type                                    |
| :------- | :-------------------------------------- |
| `source` | `"client"` \| `"server"`                |
| `update` | [`BlockUpdate`](modules.md#blockupdate) |

---

### BodyOptions

Ƭ **BodyOptions**: `ColorCanvasBoxOptions`

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

---

### BoundingBox

Ƭ **BoundingBox**: `Object`

#### Type declaration

| Name    | Type                            |
| :------ | :------------------------------ |
| `min`   | [`Coords3`](modules.md#coords3) |
| `shape` | [`Coords3`](modules.md#coords3) |

---

### BoxSides

Ƭ **BoxSides**: `"back"` \| `"front"` \| `"top"` \| `"bottom"` \| `"left"` \| `"right"` \| `"sides"` \| `"all"`

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

---

### CSSMeasurement

Ƭ **CSSMeasurement**: \`$\{number}$\{string}\`

A CSS measurement. E.g. "30px", "51em"

---

### CameraPerspective

Ƭ **CameraPerspective**: `"px"` \| `"nx"` \| `"py"` \| `"ny"` \| `"pz"` \| `"nz"` \| `"pxy"` \| `"nxy"` \| `"pxz"` \| `"nxz"` \| `"pyz"` \| `"nyz"` \| `"pxyz"` \| `"nxyz"`

---

### CanvasBoxOptions

Ƭ **CanvasBoxOptions**: `Object`

Parameters to create a canvas box.

#### Type declaration

| Name              | Type      | Description                                                                                                                              |
| :---------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `depth?`          | `number`  | The depth of the box. Defaults to whatever `width` is.                                                                                   |
| `depthSegments?`  | `number`  | The depth segments of the box, which is the number of pixels of the canvases along the depth. Defaults to whatever `widthSegments` is.   |
| `gap`             | `number`  | The gap between the layers of the box. Defaults to `0`.                                                                                  |
| `height?`         | `number`  | The height of the box. Defaults to whatever `width` is.                                                                                  |
| `heightSegments?` | `number`  | The height segments of the box, which is the number of pixels of the canvases along the height. Defaults to whatever `widthSegments` is. |
| `layers`          | `number`  | The number of layers of this box. Defaults to `1`.                                                                                       |
| `receiveShadows?` | `boolean` | Whether this canvas box should receive shadows. Defaults to `false`.                                                                     |
| `side`            | `Side`    | The side of the box to render. Defaults to `THREE.FrontSide`.                                                                            |
| `transparent?`    | `boolean` | Whether or not should this canvas box be rendered as transparent. Defaults to `false`.                                                   |
| `width`           | `number`  | THe width of the box. Defaults to `1`.                                                                                                   |
| `widthSegments`   | `number`  | The width segments of the box, which is the number of pixels of the canvases along the width. Defaults to `8`.                           |

---

### CharacterOptions

Ƭ **CharacterOptions**: `Object`

Parameters to create a character.

#### Type declaration

| Name              | Type                                                       | Description                                                                        |
| :---------------- | :--------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| `arms?`           | `Partial`\<[`ArmsOptions`](modules.md#armsoptions)\>       | Parameters to create the character's arms.                                         |
| `body?`           | `Partial`\<[`BodyOptions`](modules.md#bodyoptions)\>       | Parameters to create the character's body.                                         |
| `head?`           | `Partial`\<[`HeadOptions`](modules.md#headoptions)\>       | Parameters to create the character's head.                                         |
| `idleArmSwing?`   | `number`                                                   | The speed at which the arms swing when the character is idle. Defaults to `0.06`.  |
| `legs?`           | `Partial`\<[`LegOptions`](modules.md#legoptions)\>         | Parameters to create the character's legs.                                         |
| `nameTagOptions?` | `Partial`\<[`NameTagOptions`](modules.md#nametagoptions)\> | -                                                                                  |
| `positionLerp?`   | `number`                                                   | The lerp factor of the character's position change. Defaults to `0.7`.             |
| `receiveShadows?` | `boolean`                                                  | Whether this character should receive shadows. Defaults to `false`.                |
| `rotationLerp?`   | `number`                                                   | The lerp factor of the character's rotation change. Defaults to `0.2`.             |
| `swingLerp?`      | `number`                                                   | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`.    |
| `walkingSpeed?`   | `number`                                                   | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |

---

### ChunkDataEventData

Ƭ **ChunkDataEventData**: `Object`

#### Type declaration

| Name     | Type                            |
| :------- | :------------------------------ |
| `chunk`  | [`Chunk`](classes/Chunk.md)     |
| `coords` | [`Coords2`](modules.md#coords2) |

---

### ChunkEventData

Ƭ **ChunkEventData**: `Object`

#### Type declaration

| Name        | Type                            |
| :---------- | :------------------------------ |
| `allMeshes` | `Map`\<`number`, `Mesh`[]\>     |
| `chunk`     | [`Chunk`](classes/Chunk.md)     |
| `coords`    | [`Coords2`](modules.md#coords2) |

---

### ChunkMeshEventData

Ƭ **ChunkMeshEventData**: `Object`

#### Type declaration

| Name     | Type                            |
| :------- | :------------------------------ |
| `chunk`  | [`Chunk`](classes/Chunk.md)     |
| `coords` | [`Coords2`](modules.md#coords2) |
| `level`  | `number`                        |
| `meshes` | `Mesh`[]                        |

---

### ChunkMeshUpdateEventData

Ƭ **ChunkMeshUpdateEventData**: [`ChunkMeshEventData`](modules.md#chunkmesheventdata) & \{ `reason`: [`ChunkUpdateReason`](modules.md#chunkupdatereason) }

---

### ChunkStage

Ƭ **ChunkStage**: \{ `requestedAt`: `number` ; `retryCount`: `number` ; `stage`: `"requested"` } \| \{ `data`: `ChunkProtocol` ; `source`: `"update"` \| `"load"` ; `stage`: `"processing"` } \| \{ `chunk`: [`Chunk`](classes/Chunk.md) ; `stage`: `"loaded"` }

---

### ChunkUpdateEventData

Ƭ **ChunkUpdateEventData**: [`ChunkEventData`](modules.md#chunkeventdata) & \{ `reason`: [`ChunkUpdateReason`](modules.md#chunkupdatereason) }

---

### ChunkUpdateReason

Ƭ **ChunkUpdateReason**: `"voxel"` \| `"light"`

---

### ClickType

Ƭ **ClickType**: `"left"` \| `"middle"` \| `"right"`

Three types of clicking for mouse input listening.

---

### CloudsOptions

Ƭ **CloudsOptions**: `Object`

Parameters used to create a new [Clouds](classes/Clouds.md) instance.

#### Type declaration

| Name              | Type                            | Description                                                                                                                                                           |
| :---------------- | :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alpha`           | `number`                        | The opacity of the clouds. Defaults to `0.8`.                                                                                                                         |
| `cloudHeight`     | `number`                        | The y-height at which the clouds are generated. Defaults to `256`.                                                                                                    |
| `color`           | `string`                        | The color of the clouds. Defaults to `#fff`.                                                                                                                          |
| `count`           | `number`                        | The number of cloud cells to generate, `count` \* `count`. Defaults to `16`.                                                                                          |
| `dimensions`      | [`Coords3`](modules.md#coords3) | The dimension of each cloud block. Defaults to `[20, 20, 20]`.                                                                                                        |
| `falloff`         | `number`                        | The noise falloff factor used to generate the clouds. Defaults to `0.9`.                                                                                              |
| `height`          | `number`                        | The vertical count of how many cloud blocks are in a cloud cell. This is also used to determine the overall count of cloud blocks of all the clouds. Defaults to `3`. |
| `lerpFactor`      | `number`                        | The lerp factor used to translate cloud blocks from their original position to their new position. Defaults to `0.3`.                                                 |
| `noiseScale`      | `number`                        | The scale of the noise used to generate the clouds. Defaults to `0.08`.                                                                                               |
| `octaves`         | `number`                        | The number of octaves used to generate the noise. Defaults to `5`.                                                                                                    |
| `seed`            | `number`                        | The seed used to generate the clouds. Defaults to `-1`.                                                                                                               |
| `speedFactor`     | `number`                        | The speed at which the clouds move. Defaults to `8`.                                                                                                                  |
| `threshold`       | `number`                        | The threshold at which noise values are considered to be "cloudy" and should generate a new cloud block. Defaults to `0.05`.                                          |
| `uFogColor?`      | \{ `value`: `Color` }           | An object that is used as the uniform for the clouds fog color shader.                                                                                                |
| `uFogColor.value` | `Color`                         | -                                                                                                                                                                     |
| `uFogFar?`        | \{ `value`: `number` }          | An object that is used as the uniform for the clouds fog far shader.                                                                                                  |
| `uFogFar.value`   | `number`                        | -                                                                                                                                                                     |
| `uFogNear?`       | \{ `value`: `number` }          | An object that is used as the uniform for the clouds fog near shader.                                                                                                 |
| `uFogNear.value`  | `number`                        | -                                                                                                                                                                     |
| `width`           | `number`                        | The horizontal count of how many cloud blocks are in a cloud cell. Defaults to `8`.                                                                                   |

---

### CommandInfo

Ƭ **CommandInfo**\<`T`\>: `Object`

Information about a command including its processor and documentation.

#### Type parameters

| Name | Type                                                                                                     |
| :--- | :------------------------------------------------------------------------------------------------------- |
| `T`  | extends `ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>\> = `ZodObject`\<`Record`\<`string`, `never`\>\> |

#### Type declaration

| Name          | Type                                 |
| :------------ | :----------------------------------- |
| `aliases`     | `string`[]                           |
| `args`        | `T`                                  |
| `category?`   | `string`                             |
| `description` | `string`                             |
| `flags`       | `string`[]                           |
| `process`     | (`args`: `z.infer`\<`T`\>) => `void` |

---

### CommandOptions

Ƭ **CommandOptions**\<`T`\>: `Object`

Options for adding a command.

#### Type parameters

| Name | Type                                                                                                     |
| :--- | :------------------------------------------------------------------------------------------------------- |
| `T`  | extends `ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>\> = `ZodObject`\<`Record`\<`string`, `never`\>\> |

#### Type declaration

| Name          | Type       |
| :------------ | :--------- |
| `aliases?`    | `string`[] |
| `args?`       | `T`        |
| `category?`   | `string`   |
| `description` | `string`   |
| `flags?`      | `string`[] |

---

### Coords2

Ƭ **Coords2**: [`number`, `number`]

---

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

---

### CreatureBodyOptions

Ƭ **CreatureBodyOptions**: `ColorCanvasBoxOptions`

---

### CreatureHeadOptions

Ƭ **CreatureHeadOptions**: `ColorCanvasBoxOptions` & \{ `faceColor`: `Color` \| `string` ; `neckGap?`: `number` }

---

### CreatureLegOptions

Ƭ **CreatureLegOptions**: `ColorCanvasBoxOptions` & \{ `betweenLegsGap?`: `number` ; `frontBackGap?`: `number` }

---

### CreatureOptions

Ƭ **CreatureOptions**: `Object`

#### Type declaration

| Name              | Type                                                                 |
| :---------------- | :------------------------------------------------------------------- |
| `body?`           | `Partial`\<[`CreatureBodyOptions`](modules.md#creaturebodyoptions)\> |
| `head?`           | `Partial`\<[`CreatureHeadOptions`](modules.md#creatureheadoptions)\> |
| `idleLegSwing?`   | `number`                                                             |
| `legs?`           | `Partial`\<[`CreatureLegOptions`](modules.md#creaturelegoptions)\>   |
| `nameTagOptions?` | `Partial`\<[`NameTagOptions`](modules.md#nametagoptions)\>           |
| `positionLerp?`   | `number`                                                             |
| `rotationLerp?`   | `number`                                                             |
| `swingLerp?`      | `number`                                                             |
| `walkingSpeed?`   | `number`                                                             |

---

### CullOptionsType

Ƭ **CullOptionsType**: `Object`

#### Type declaration

| Name         | Type                            |
| :----------- | :------------------------------ |
| `dimensions` | [`Coords3`](modules.md#coords3) |
| `max`        | [`Coords3`](modules.md#coords3) |
| `min`        | [`Coords3`](modules.md#coords3) |
| `realMax`    | [`Coords3`](modules.md#coords3) |
| `realMin`    | [`Coords3`](modules.md#coords3) |

---

### CustomChunkShaderMaterial

Ƭ **CustomChunkShaderMaterial**: `ShaderMaterial` & \{ `map`: `Texture` }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
if you want to change its map, you also have to change its `uniforms.map`.

---

### DebugOptions

Ƭ **DebugOptions**: `Object`

Parameters to create a [Debug](classes/Debug.md) instance.

#### Type declaration

| Name            | Type                               | Description                                                                                                                                                                               |
| :-------------- | :--------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asyncPeriod`   | `number`                           | -                                                                                                                                                                                         |
| `containerId`   | `string`                           | -                                                                                                                                                                                         |
| `dataClass`     | `string`                           | A class to add to the wrapper of the top-left debug panel.                                                                                                                                |
| `dataStyles`    | `Partial`\<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of the top-left debug panel.                                                                                                                               |
| `entriesClass`  | `string`                           | A class to add to the wrapper of all debug entries.                                                                                                                                       |
| `entriesStyles` | `Partial`\<`CSSStyleDeclaration`\> | Styles to apply to the wrapper of all debug entries.                                                                                                                                      |
| `lineClass`     | `string`                           | A class to add to each of the debug entry line (top left).                                                                                                                                |
| `lineStyles`    | `Partial`\<`CSSStyleDeclaration`\> | Styles to apply to each of the debug entry line (top left).                                                                                                                               |
| `newLineStyles` | `Partial`\<`CSSStyleDeclaration`\> | -                                                                                                                                                                                         |
| `onByDefault`   | `boolean`                          | Whether or not should the debug panel be displayed by default when the page loads. Defaults to `true`. You can toggle the debug panel by calling [Debug.toggle](classes/Debug.md#toggle). |
| `showVoxelize`  | `boolean`                          | Whether or not should `Voxelize x.x.x` be displayed in the top-left debug panel. Defaults to `true`.                                                                                      |
| `stats`         | `boolean`                          | Whether or not should [stats.js](https://github.com/mrdoob/stats.js/) be enabled. Defaults to `true`.                                                                                     |
| `statsStyles`   | `Partial`\<`CSSStyleDeclaration`\> | -                                                                                                                                                                                         |

---

### DeepPartial

Ƭ **DeepPartial**\<`T`\>: \{ [P in keyof T]?: DeepPartial\<T[P]\> }

#### Type parameters

| Name |
| :--- |
| `T`  |

---

### Event

Ƭ **Event**: `Object`

A Voxelize event from the server.

#### Type declaration

| Name       | Type     | Description                          |
| :--------- | :------- | :----------------------------------- |
| `name`     | `string` | The name to identify the event.      |
| `payload?` | `any`    | Additional information of the event. |

---

### EventHandler

Ƭ **EventHandler**: (`payload`: `any` \| `null`) => `void`

The handler for an event sent from the Voxelize server.

#### Type declaration

▸ (`payload`): `void`

##### Parameters

| Name      | Type            |
| :-------- | :-------------- |
| `payload` | `any` \| `null` |

##### Returns

`void`

---

### FindSimilarOptions

Ƭ **FindSimilarOptions**: `Object`

#### Type declaration

| Name              | Type     |
| :---------------- | :------- |
| `maxSuggestions?` | `number` |

---

### FormatSuggestionOptions

Ƭ **FormatSuggestionOptions**: `Object`

#### Type declaration

| Name                | Type     |
| :------------------ | :------- |
| `maxFallbackItems?` | `number` |

---

### HeadOptions

Ƭ **HeadOptions**: `ColorCanvasBoxOptions` & \{ `faceColor`: `Color` \| `string` ; `neckGap?`: `number` }

---

### InputOccasion

Ƭ **InputOccasion**: `"keydown"` \| `"keypress"` \| `"keyup"`

The occasion that the input should be fired.

---

### InputSpecifics

Ƭ **InputSpecifics**: `Object`

The specific options of the key to listen to.

#### Type declaration

| Name          | Type                                        | Description                                                                                                                |
| :------------ | :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------- |
| `checkType?`  | `"key"` \| `"code"`                         | The type of key to check for. Defaults to `key`.                                                                           |
| `identifier?` | `string`                                    | A special identifier to tag this input with. This is useful for removing specific inputs from the input listener later on. |
| `occasion?`   | [`InputOccasion`](modules.md#inputoccasion) | The occasion that the input should be fired. Defaults to `keydown`.                                                        |

---

### ItemSlotsOptions

Ƭ **ItemSlotsOptions**: `Object`

#### Type declaration

| Name                  | Type                                                |
| :-------------------- | :-------------------------------------------------- |
| `activatedByDefault`  | `boolean`                                           |
| `focusFirstByDefault` | `boolean`                                           |
| `horizontalCount`     | `number`                                            |
| `perspective`         | [`CameraPerspective`](modules.md#cameraperspective) |
| `scrollable?`         | `boolean`                                           |
| `slotClass`           | `string`                                            |
| `slotFocusClass`      | `string`                                            |
| `slotGap`             | `number`                                            |
| `slotHeight`          | `number`                                            |
| `slotHoverClass`      | `string`                                            |
| `slotMargin`          | `number`                                            |
| `slotPadding`         | `number`                                            |
| `slotStyles`          | `Partial`\<`CSSStyleDeclaration`\>                  |
| `slotSubscriptClass`  | `string`                                            |
| `slotSubscriptStyles` | `Partial`\<`CSSStyleDeclaration`\>                  |
| `slotWidth`           | `number`                                            |
| `verticalCount`       | `number`                                            |
| `wrapperClass`        | `string`                                            |
| `wrapperPadding`      | `number`                                            |
| `wrapperStyles`       | `Partial`\<`CSSStyleDeclaration`\>                  |
| `zoom`                | `number`                                            |

---

### LegOptions

Ƭ **LegOptions**: `ColorCanvasBoxOptions` & \{ `betweenLegsGap?`: `number` }

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

---

### LightBatch

Ƭ **LightBatch**: `Object`

#### Type declaration

| Name              | Type                                                |
| :---------------- | :-------------------------------------------------- |
| `batchId`         | `number`                                            |
| `completedJobs`   | `number`                                            |
| `jobs`            | [`LightJob`](modules.md#lightjob)[]                 |
| `results`         | [`LightBatchResult`](modules.md#lightbatchresult)[] |
| `startSequenceId` | `number`                                            |
| `totalJobs`       | `number`                                            |

---

### LightBatchResult

Ƭ **LightBatchResult**: `Object`

#### Type declaration

| Name             | Type                                                                       |
| :--------------- | :------------------------------------------------------------------------- |
| `boundingBox`    | [`BoundingBox`](modules.md#boundingbox)                                    |
| `color`          | [`LightColor`](modules.md#lightcolor)                                      |
| `modifiedChunks` | \{ `coords`: [`Coords2`](modules.md#coords2) ; `lights`: `Uint32Array` }[] |

---

### LightColor

Ƭ **LightColor**: `"RED"` \| `"GREEN"` \| `"BLUE"` \| `"SUNLIGHT"`

Sunlight or the color of torch light.

---

### LightJob

Ƭ **LightJob**: `Object`

#### Type declaration

| Name                | Type                                                                                                 |
| :------------------ | :--------------------------------------------------------------------------------------------------- |
| `batchId`           | `number`                                                                                             |
| `boundingBox`       | [`BoundingBox`](modules.md#boundingbox)                                                              |
| `color`             | [`LightColor`](modules.md#lightcolor)                                                                |
| `jobId`             | `string`                                                                                             |
| `lightOps`          | \{ `floods`: [`LightNode`](modules.md#lightnode)[] ; `removals`: [`Coords3`](modules.md#coords3)[] } |
| `lightOps.floods`   | [`LightNode`](modules.md#lightnode)[]                                                                |
| `lightOps.removals` | [`Coords3`](modules.md#coords3)[]                                                                    |
| `retryCount`        | `number`                                                                                             |
| `startSequenceId`   | `number`                                                                                             |

---

### LightNode

Ƭ **LightNode**: `Object`

#### Type declaration

| Name    | Type                            |
| :------ | :------------------------------ |
| `level` | `number`                        |
| `voxel` | [`Coords3`](modules.md#coords3) |

---

### LightOperations

Ƭ **LightOperations**: `Object`

#### Type declaration

| Name                | Type                                                                                                                                                                                                   |
| :------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floods`            | \{ `blue`: [`LightNode`](modules.md#lightnode)[] ; `green`: [`LightNode`](modules.md#lightnode)[] ; `red`: [`LightNode`](modules.md#lightnode)[] ; `sunlight`: [`LightNode`](modules.md#lightnode)[] } |
| `floods.blue`       | [`LightNode`](modules.md#lightnode)[]                                                                                                                                                                  |
| `floods.green`      | [`LightNode`](modules.md#lightnode)[]                                                                                                                                                                  |
| `floods.red`        | [`LightNode`](modules.md#lightnode)[]                                                                                                                                                                  |
| `floods.sunlight`   | [`LightNode`](modules.md#lightnode)[]                                                                                                                                                                  |
| `hasOperations`     | `boolean`                                                                                                                                                                                              |
| `removals`          | \{ `blue`: [`Coords3`](modules.md#coords3)[] ; `green`: [`Coords3`](modules.md#coords3)[] ; `red`: [`Coords3`](modules.md#coords3)[] ; `sunlight`: [`Coords3`](modules.md#coords3)[] }                 |
| `removals.blue`     | [`Coords3`](modules.md#coords3)[]                                                                                                                                                                      |
| `removals.green`    | [`Coords3`](modules.md#coords3)[]                                                                                                                                                                      |
| `removals.red`      | [`Coords3`](modules.md#coords3)[]                                                                                                                                                                      |
| `removals.sunlight` | [`Coords3`](modules.md#coords3)[]                                                                                                                                                                      |

---

### LightShinedOptions

Ƭ **LightShinedOptions**: `Object`

#### Type declaration

| Name            | Type     | Description                                                           |
| :-------------- | :------- | :-------------------------------------------------------------------- |
| `lerpFactor`    | `number` | The lerping factor of the brightness of each mesh. Defaults to `0.1`. |
| `maxBrightness` | `number` | The maximum brightness cap for the light effect. Defaults to `2.5`.   |

---

### LightWorkerResult

Ƭ **LightWorkerResult**: `Object`

#### Type declaration

| Name                           | Type                                                                       |
| :----------------------------- | :------------------------------------------------------------------------- |
| `appliedDeltas`                | \{ `lastSequenceId`: `number` }                                            |
| `appliedDeltas.lastSequenceId` | `number`                                                                   |
| `jobId`                        | `string`                                                                   |
| `modifiedChunks`               | \{ `coords`: [`Coords2`](modules.md#coords2) ; `lights`: `Uint32Array` }[] |

---

### MeshResultType

Ƭ **MeshResultType**: `Object`

#### Type declaration

| Name        | Type           |
| :---------- | :------------- |
| `indices`   | `Float32Array` |
| `normals`   | `Float32Array` |
| `positions` | `Float32Array` |

---

### NameTagOptions

Ƭ **NameTagOptions**: `Object`

Parameters to create a name tag.

#### Type declaration

| Name               | Type     | Description                                                      |
| :----------------- | :------- | :--------------------------------------------------------------- |
| `backgroundColor?` | `string` | The background color of the name tag. Defaults to `0x00000077`.  |
| `color?`           | `string` | The color of the name tag. Defaults to `0xffffff`.               |
| `fontFace?`        | `string` | The font face to create the name tag. Defaults to `"monospace"`. |
| `fontSize?`        | `number` | The font size to create the name tag. Defaults to `0.1`.         |
| `yOffset?`         | `number` | The y-offset of the nametag moved upwards. Defaults to `0`.      |

---

### NetworkConnectionOptions

Ƭ **NetworkConnectionOptions**: `Object`

#### Type declaration

| Name                | Type      |
| :------------------ | :-------- |
| `reconnectTimeout?` | `number`  |
| `secret?`           | `string`  |
| `useWebRTC?`        | `boolean` |

---

### NetworkOptions

Ƭ **NetworkOptions**: `Object`

#### Type declaration

| Name                | Type     |
| :------------------ | :------- |
| `maxBacklogFactor`  | `number` |
| `maxPacketsPerTick` | `number` |

---

### PartialRecord

Ƭ **PartialRecord**\<`K`, `T`\>: \{ [P in K]?: T }

#### Type parameters

| Name | Type                |
| :--- | :------------------ |
| `K`  | extends keyof `any` |
| `T`  | `T`                 |

---

### PeersOptions

Ƭ **PeersOptions**: `Object`

Parameters to customize the peers manager.

#### Type declaration

| Name             | Type      | Description                                                                                                                                                                             |
| :--------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autoAddToSelf`  | `boolean` | -                                                                                                                                                                                       |
| `countSelf`      | `boolean` | Whether or not should the client themselves be counted as "updated". In other words, whether or not should the update function be called on the client's own data. Defaults to `false`. |
| `updateChildren` | `boolean` | Whether or not should the peers manager automatically call `update` on any children mesh. Defaults to `true`.                                                                           |

---

### PerspectiveOptions

Ƭ **PerspectiveOptions**: `Object`

Parameters to create a new [Perspective](classes/Perspective.md) instance.

#### Type declaration

| Name               | Type      | Description                                                                                                                                           |
| :----------------- | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockMargin`      | `number`  | The margin between the camera and any block that the camera is colliding with. This prevents the camera from clipping into blocks. Defaults to `0.3`. |
| `ignoreFluids`     | `boolean` | Whether or not should the camera ignore fluid block collisions. Defaults to `true`.                                                                   |
| `ignoreSeeThrough` | `boolean` | Whether or not should the camera ignore see-through block collisions. Defaults to `true`.                                                             |
| `lerpFactor`       | `number`  | The lerping factor for the camera's position. Defaults to `0.5`.                                                                                      |
| `maxDistance`      | `number`  | The maximum distance the camera can go from the player's center. Defaults to `5`.                                                                     |

---

### PortraitOptions

Ƭ **PortraitOptions**: `Object`

Parameters to create a portrait with.

#### Type declaration

| Name                  | Type                                                | Description                                                                                                                                                                                               |
| :-------------------- | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `height`              | `number`                                            | The height of the portrait canvas. Defaults to `100` pixels.                                                                                                                                              |
| `lightRotationOffset` | `number`                                            | The rotation around the y axis about the camera. This is used to calculate the position of the light. Defaults to `-Math.PI / 8`.                                                                         |
| `perspective`         | [`CameraPerspective`](modules.md#cameraperspective) | The position of where the camera should be looking at. Defaults to `pxyz`, which means that the camera will be looking at the center of the object from the positive x, y, and z axis scaled by the zoom. |
| `renderOnce`          | `boolean`                                           | Whether or not should this portrait only render once. Defaults to `false`.                                                                                                                                |
| `width`               | `number`                                            | The width of the portrait canvas. Defaults to `100` pixels.                                                                                                                                               |
| `zoom`                | `number`                                            | The arbitrary zoom from the camera to the object. This is used to calculate the zoom of the camera. Defaults to `1`.                                                                                      |

---

### ProcessedUpdate

Ƭ **ProcessedUpdate**: `Object`

#### Type declaration

| Name          | Type                                        |
| :------------ | :------------------------------------------ |
| `newBlock`    | [`Block`](modules.md#block)                 |
| `newId`       | `number`                                    |
| `newRotation` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldBlock`    | [`Block`](modules.md#block)                 |
| `oldId`       | `number`                                    |
| `oldRotation` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldStage`    | `number`                                    |
| `stage`       | `number`                                    |
| `voxel`       | [`Coords3`](modules.md#coords3)             |

---

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & \{ `sendEvent`: (`event`: `any`) => `void` }

---

### RigidControlState

Ƭ **RigidControlState**: `Object`

The state of which a Voxelize Controls is in.

#### Type declaration

| Name              | Type      | Description                                                                                       |
| :---------------- | :-------- | :------------------------------------------------------------------------------------------------ |
| `crouching`       | `boolean` | Whether if the client is attempting to crouch, if the crouch key is pressed. Defaults to `false`. |
| `currentJumpTime` | `number`  | The current amount of time spent in the air from jump. Defaults to `0`.                           |
| `heading`         | `number`  | In radians, the heading y-rotation of the client. Defaults to `0`.                                |
| `isJumping`       | `boolean` | Whether or not is the client jumping, in the air. Defaults to `false`.                            |
| `jumpCount`       | `number`  | How many times has the client jumped. Defaults to `0`.                                            |
| `jumping`         | `boolean` | Whether if the client is attempting to jump, if the jump key is pressed. Defaults to `false`.     |
| `running`         | `boolean` | Whether if the client is running. Defaults to `false`.                                            |
| `sprinting`       | `boolean` | Whether if the client is attempting to sprint, if the sprint key is pressed. Defaults to `false`. |

---

### RigidControlsOptions

Ƭ **RigidControlsOptions**: `Object`

Parameters to initialize the Voxelize Controls.

#### Type declaration

| Name               | Type                            | Description                                                                                                |
| :----------------- | :------------------------------ | :--------------------------------------------------------------------------------------------------------- |
| `airJumps`         | `number`                        | How many times can a client jump in the air. Defaults to `0`.                                              |
| `airMoveMult`      | `number`                        | The factor applied to the movements of the client in air, such as while half-jump. Defaults to `0.7`.      |
| `alwaysSprint`     | `boolean`                       | Sprint factor would be on always. Defaults to `false`.                                                     |
| `bodyDepth`        | `number`                        | The depth of the client's avatar. Defaults to `0.8` blocks.                                                |
| `bodyHeight`       | `number`                        | The height of the client's avatar. Defaults to `1.55` blocks.                                              |
| `bodyWidth`        | `number`                        | The width of the client's avatar. Defaults to `0.8` blocks.                                                |
| `crouchFactor`     | `number`                        | The factor to the movement speed when crouch is applied. Defaults to `0.6`.                                |
| `eyeHeight`        | `number`                        | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.9193548387096774`. |
| `fluidPushForce`   | `number`                        | The force upwards when a client tries to jump in water. Defaults to `0.3`.                                 |
| `flyForce`         | `number`                        | The level of force at which a client flies at. Defaults to `80`.                                           |
| `flyImpulse`       | `number`                        | The level impulse of which a client flies at. Defaults to `2.5`.                                           |
| `flyInertia`       | `number`                        | The inertia of a client when they're flying. Defaults to `6`.                                              |
| `flySpeed`         | `number`                        | The level of speed at which a client flies at. Defaults to `40`.                                           |
| `initialDirection` | [`Coords3`](modules.md#coords3) | -                                                                                                          |
| `initialPosition`  | [`Coords3`](modules.md#coords3) | Initial position of the client. Defaults to `(0, 80, 10)`.                                                 |
| `jumpForce`        | `number`                        | The level of force applied to the client when jumping. Defaults to `1`.                                    |
| `jumpImpulse`      | `number`                        | The level of impulse at which the client jumps upwards. Defaults to `8`.                                   |
| `jumpTime`         | `number`                        | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms.                               |
| `maxPolarAngle`    | `number`                        | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99`                               |
| `maxSpeed`         | `number`                        | The maximum level of speed of a client. Default is `6` .                                                   |
| `minPolarAngle`    | `number`                        | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`.                            |
| `moveForce`        | `number`                        | The level of force of which the client can move at. Default is `30`.                                       |
| `positionLerp`     | `number`                        | The interpolation factor of the client's position. Defaults to `1.0`.                                      |
| `responsiveness`   | `number`                        | The level of responsiveness of a client to movements. Default is `240`.                                    |
| `rotationLerp`     | `number`                        | The interpolation factor of the client's rotation. Defaults to `0.9`.                                      |
| `runningFriction`  | `number`                        | Default running friction of a client. Defaults to `0.1`.                                                   |
| `sensitivity`      | `number`                        | The mouse sensitivity. Defaults to `100`.                                                                  |
| `sprintFactor`     | `number`                        | The factor to the movement speed when sprint is applied. Defaults to `1.4`.                                |
| `standingFriction` | `number`                        | Default standing friction of a client. Defaults to `4`.                                                    |
| `stepHeight`       | `number`                        | How tall a client can step up. Defaults to `0.5`.                                                          |
| `stepLerp`         | `number`                        | The interpolation factor when the client is auto-stepping. Defaults to `0.6`.                              |

---

### ShadowOptions

Ƭ **ShadowOptions**: `Object`

Parameters to create a shadow.

#### Type declaration

| Name          | Type     | Description                                                                                                                               |
| :------------ | :------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `maxDistance` | `number` | The maximum distance from the object to the ground to cast a shadow. The shadow's scale scales inversely with distance. Defaults to `10`. |
| `maxRadius`   | `number` | The maximum radius the shadow can have. That is, the radius of the shadow when the object is on the ground. Defaults to `0.5`.            |

---

### SkyOptions

Ƭ **SkyOptions**: `Object`

#### Type declaration

| Name             | Type     | Description                                                                                                                                                                                               |
| :--------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dimension`      | `number` | The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.                                                                                                                  |
| `lerpFactor`     | `number` | The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color. set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods. |
| `transitionSpan` | `number` | -                                                                                                                                                                                                         |

---

### SkyShadingCycleData

Ƭ **SkyShadingCycleData**: `Object`

#### Type declaration

| Name           | Type                                                                                            |
| :------------- | :---------------------------------------------------------------------------------------------- |
| `color`        | \{ `bottom`: `Color` \| `string` ; `middle`: `Color` \| `string` ; `top`: `Color` \| `string` } |
| `color.bottom` | `Color` \| `string`                                                                             |
| `color.middle` | `Color` \| `string`                                                                             |
| `color.top`    | `Color` \| `string`                                                                             |
| `name`         | `string`                                                                                        |
| `skyOffset`    | `number`                                                                                        |
| `start`        | `number`                                                                                        |
| `voidOffset`   | `number`                                                                                        |

---

### TargetType

Ƭ **TargetType**: `"All"` \| `"Player"` \| `"Entity"`

---

### TextureInfo

Ƭ **TextureInfo**: `Object`

#### Type declaration

| Name          | Type                                          |
| :------------ | :-------------------------------------------- |
| `blockId`     | `number`                                      |
| `blockName`   | `string`                                      |
| `canvas`      | `HTMLCanvasElement` \| `null`                 |
| `faceName`    | `string`                                      |
| `materialKey` | `string`                                      |
| `range`       | [`UV`](modules.md#uv) \| `null`               |
| `type`        | `"shared"` \| `"independent"` \| `"isolated"` |

---

### UV

Ƭ **UV**: `Object`

The UV range of a texture on the texture atlas.

#### Type declaration

| Name     | Type     | Description                               |
| :------- | :------- | :---------------------------------------- |
| `endU`   | `number` | The ending U coordinate of the texture.   |
| `endV`   | `number` | The ending V coordinate of the texture.   |
| `startU` | `number` | The starting U coordinate of the texture. |
| `startV` | `number` | The starting V coordinate of the texture. |

---

### VoxelDelta

Ƭ **VoxelDelta**: `Object`

#### Type declaration

| Name           | Type                                        |
| :------------- | :------------------------------------------ |
| `coords`       | [`Coords3`](modules.md#coords3)             |
| `newRotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `newStage?`    | `number`                                    |
| `newVoxel`     | `number`                                    |
| `oldRotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldStage?`    | `number`                                    |
| `oldVoxel`     | `number`                                    |
| `sequenceId`   | `number`                                    |
| `timestamp`    | `number`                                    |

---

### VoxelInteractOptions

Ƭ **VoxelInteractOptions**: `Object`

Parameters to customize the [VoxelInteract](classes/VoxelInteract.md) instance.

#### Type declaration

| Name               | Type                   | Description                                                                                                                                                     |
| :----------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `highlightColor`   | `Color`                | The color of the highlight. Defaults to `0xffffff`.                                                                                                             |
| `highlightLerp`    | `number`               | The lerping factor of the highlight. Defaults to `0.8`.                                                                                                         |
| `highlightOpacity` | `number`               | The opacity of the highlight. Defaults to `0.8`.                                                                                                                |
| `highlightScale`   | `number`               | The scale of the block highlight. Defaults to `1.002`.                                                                                                          |
| `highlightType`    | `"box"` \| `"outline"` | The type of the block highlight. Box would be a semi-transparent box, while outline would be 12 lines that outline the block's AABB union. Defaults to `"box"`. |
| `ignoreFluids`     | `boolean`              | Whether or not should the [VoxelInteract](classes/VoxelInteract.md) instance ignore fluids when raycasting. Defaults to `true`.                                 |
| `inverseDirection` | `boolean`              | Whether or not should the [VoxelInteract](classes/VoxelInteract.md) instance reverse the raycasting direction. Defaults to `false`.                             |
| `potentialVisuals` | `boolean`              | **`Debug`** Whether or not should there be arrows indicating the potential block placement's orientations. Defaults to `false`.                                 |
| `reachDistance`    | `number`               | The maximum distance of reach for the [VoxelInteract](classes/VoxelInteract.md) instance. Defaults to `32`.                                                     |

---

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

A worker pool job is queued to a worker pool and is executed by a worker.

#### Type declaration

| Name       | Type                       | Description                                                     |
| :--------- | :------------------------- | :-------------------------------------------------------------- |
| `buffers?` | `ArrayBufferLike`[]        | Any array buffers (transferable) that are passed to the worker. |
| `message`  | `any`                      | A JSON serializable object that is passed to the worker.        |
| `resolve`  | (`value`: `any`) => `void` | -                                                               |

---

### WorkerPoolOptions

Ƭ **WorkerPoolOptions**: `Object`

Parameters to create a worker pool.

#### Type declaration

| Name        | Type     | Description                                                                                                                      |
| :---------- | :------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `maxWorker` | `number` | The maximum number of workers to create. Defaults to `8`.                                                                        |
| `name?`     | `string` | The name prefix for workers in this pool. Workers will be named `{name}-0`, `{name}-1`, etc. Shows up in DevTools for debugging. |

---

### WorldChunkEvents

Ƭ **WorldChunkEvents**: `Object`

#### Type declaration

| Name                  | Type                                                                                  |
| :-------------------- | :------------------------------------------------------------------------------------ |
| `chunk-data-loaded`   | (`data`: [`ChunkDataEventData`](modules.md#chunkdataeventdata)) => `void`             |
| `chunk-loaded`        | (`data`: [`ChunkEventData`](modules.md#chunkeventdata)) => `void`                     |
| `chunk-mesh-loaded`   | (`data`: [`ChunkMeshEventData`](modules.md#chunkmesheventdata)) => `void`             |
| `chunk-mesh-unloaded` | (`data`: [`ChunkMeshEventData`](modules.md#chunkmesheventdata)) => `void`             |
| `chunk-mesh-updated`  | (`data`: [`ChunkMeshUpdateEventData`](modules.md#chunkmeshupdateeventdata)) => `void` |
| `chunk-unloaded`      | (`data`: [`ChunkEventData`](modules.md#chunkeventdata)) => `void`                     |
| `chunk-updated`       | (`data`: [`ChunkUpdateEventData`](modules.md#chunkupdateeventdata)) => `void`         |

---

### WorldClientOptions

Ƭ **WorldClientOptions**: `Object`

The client-side options to create a world. These are client-side only and can be customized to specific use.

#### Type declaration

| Name                        | Type                                                                     | Description                                                                                                                                                                                                          |
| :-------------------------- | :----------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chunkLoadExponent`         | `number`                                                                 | The exponent applied to the ratio that chunks are loaded, which would then be used to determine whether an angle to a chunk is worth loading. Defaults to `8`.                                                       |
| `chunkRerequestInterval`    | `number`                                                                 | The interval between each time a chunk is re-requested to the server. Defaults to `300` updates.                                                                                                                     |
| `chunkUniformsOverwrite`    | `Partial`\<[`ChunkRenderer`](classes/ChunkRenderer.md)[``"uniforms"``]\> | The uniforms to overwrite the default chunk material uniforms. Defaults to `{}`.                                                                                                                                     |
| `clientOnlyMeshing`         | `boolean`                                                                | Whether to use client-only meshing. When true, chunks are always meshed locally. When false, server-provided meshes are used for initial chunk load. Defaults to `true`.                                             |
| `cloudsOptions`             | `Partial`\<[`CloudsOptions`](modules.md#cloudsoptions)\>                 | The options to create the clouds. Defaults to `{}`.                                                                                                                                                                  |
| `defaultRenderRadius`       | `number`                                                                 | The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks.                                                                                                 |
| `deltaRetentionTime`        | `number`                                                                 | How long to retain delta history in milliseconds. Defaults to 5000ms.                                                                                                                                                |
| `lightJobRetryLimit`        | `number`                                                                 | Maximum number of retries for stale light jobs before falling back to sync. Defaults to 3.                                                                                                                           |
| `maxChunkRequestsPerUpdate` | `number`                                                                 | The maximum chunk requests this world can request from the server per world update. Defaults to `12` chunks.                                                                                                         |
| `maxLightWorkers`           | `number`                                                                 | Maximum concurrent light workers. Defaults to 2.                                                                                                                                                                     |
| `maxLightsUpdateTime`       | `number`                                                                 | -                                                                                                                                                                                                                    |
| `maxMeshesPerUpdate`        | `number`                                                                 | -                                                                                                                                                                                                                    |
| `maxProcessesPerUpdate`     | `number`                                                                 | The maximum amount of chunks received from the server that can be processed per world update. By process, it means to be turned into a `Chunk` instance. Defaults to `8` chunks.                                     |
| `maxUpdatesPerUpdate`       | `number`                                                                 | The maximum voxel updates that can be sent to the server per world update. Defaults to `1000` updates.                                                                                                               |
| `mergeChunkGeometries`      | `boolean`                                                                | Whether to merge chunk geometries to reduce draw calls. Useful for mobile. Defaults to false.                                                                                                                        |
| `minLightLevel`             | `number`                                                                 | The minimum light level even when sunlight and torch light levels are at zero. Defaults to `0.04`.                                                                                                                   |
| `shaderBasedLighting`       | `boolean`                                                                | Whether shader-based lighting is enabled for this world. When enabled, lighting uses GPU shaders with cascaded shadow maps. CPU light propagation still runs to provide sunlight exposure data. Defaults to `false`. |
| `skyOptions`                | `Partial`\<[`SkyOptions`](modules.md#skyoptions)\>                       | The options to create the sky. Defaults to `{}`.                                                                                                                                                                     |
| `statsSyncInterval`         | `number`                                                                 | The interval between each time the world requests the server for its stats. Defaults to 500ms.                                                                                                                       |
| `sunlightChangeSpan`        | `number`                                                                 | The fraction of the day that sunlight takes to change from appearing to disappearing or disappearing to appearing. Defaults to `0.1`.                                                                                |
| `sunlightEndTimeFrac`       | `number`                                                                 | The fraction of the day that sunlight starts to disappear. Defaults to `0.7`.                                                                                                                                        |
| `sunlightStartTimeFrac`     | `number`                                                                 | The fraction of the day that sunlight starts to appear. Defaults to `0.25`.                                                                                                                                          |
| `textureUnitDimension`      | `number`                                                                 | The default dimension to a single unit of a block face texture. If any texture loaded is greater, it will be downscaled to this resolution. Defaults to `8` pixels.                                                  |
| `timeForceThreshold`        | `number`                                                                 | The threshold to force the server's time to the client's time. Defaults to `0.1`.                                                                                                                                    |
| `useLightWorkers`           | `boolean`                                                                | Whether to use web workers for light calculations. Defaults to true.                                                                                                                                                 |

---

### WorldOptions

Ƭ **WorldOptions**: [`WorldClientOptions`](modules.md#worldclientoptions) & [`WorldServerOptions`](modules.md#worldserveroptions)

The options to create a world. This consists of [WorldClientOptions](modules.md#worldclientoptions) and [WorldServerOptions](modules.md#worldserveroptions).

---

### WorldServerOptions

Ƭ **WorldServerOptions**: `Object`

The options defined on the server-side, passed to the client on network joining.

#### Type declaration

| Name               | Type                 | Description                                                                                |
| :----------------- | :------------------- | :----------------------------------------------------------------------------------------- |
| `airDrag`          | `number`             | The air drag of everything physical.                                                       |
| `chunkSize`        | `number`             | The width and depth of a chunk, in blocks.                                                 |
| `doesTickTime`     | `boolean`            | -                                                                                          |
| `fluidDensity`     | `number`             | The density of the fluid in this world.                                                    |
| `fluidDrag`        | `number`             | The fluid drag of everything physical.                                                     |
| `gravity`          | `number`[]           | The gravity of everything physical in this world.                                          |
| `greedyMeshing`    | `boolean`            | Whether greedy meshing is enabled for this world.                                          |
| `maxChunk`         | [`number`, `number`] | The maximum chunk coordinate of this world, inclusive.                                     |
| `maxHeight`        | `number`             | The height of a chunk, in blocks.                                                          |
| `maxLightLevel`    | `number`             | The maximum light level that propagates in this world, including sunlight and torch light. |
| `minBounceImpulse` | `number`             | The minimum bouncing impulse of everything physical in this world.                         |
| `minChunk`         | [`number`, `number`] | The minimum chunk coordinate of this world, inclusive.                                     |
| `subChunks`        | `number`             | The number of sub-chunks that divides a chunk vertically.                                  |
| `timePerDay`       | `number`             | The time per day in seconds.                                                               |

## Variables

### BLUE_LIGHT

• `Const` **BLUE_LIGHT**: `"BLUE"`

The string representation of blue light.

---

### BOX_SIDES

• `Const` **BOX_SIDES**: [`BoxSides`](modules.md#boxsides)[]

The six default faces of a canvas box.

---

### DEFAULT_CHUNK_SHADERS

• `Const` **DEFAULT_CHUNK_SHADERS**: `Object`

This is the default shaders used for the chunks.

#### Type declaration

| Name       | Type     |
| :--------- | :------- |
| `fragment` | `string` |
| `vertex`   | `string` |

---

### ENTITY_SHADOW_FRAGMENT_PARS

• `Const` **ENTITY_SHADOW_FRAGMENT_PARS**: `"\nuniform sampler2D uShadowMap0;\nuniform sampler2D uShadowMap1;\nuniform sampler2D uShadowMap2;\nuniform float uCascadeSplit0;\nuniform float uCascadeSplit1;\nuniform float uCascadeSplit2;\nuniform float uShadowBias;\nuniform float uShadowStrength;\nuniform float uSunlightIntensity;\nuniform vec3 uSunDirection;\n\nvarying vec4 vShadowCoord0;\nvarying vec4 vShadowCoord1;\nvarying vec4 vShadowCoord2;\nvarying float vViewDepth;\n\n\nconst vec2 SHADOW_POISSON_DISK[8] = vec2[8](\n  vec2(-0.94201624, -0.39906216),\n  vec2(0.94558609, -0.76890725),\n  vec2(-0.094184101, -0.92938870),\n  vec2(0.34495938, 0.29387760),\n  vec2(-0.91588581, 0.45771432),\n  vec2(-0.81544232, -0.87912464),\n  vec2(0.97484398, 0.75648379),\n  vec2(0.44323325, -0.97511554)\n);\n\n\n\nfloat sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;\n\n  return shadow / 5.0;\n}\n\nfloat sampleShadowMapPCSS(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float blockerSum = 0.0;\n  float blockerCount = 0.0;\n  float searchRadius = 3.0;\n  for (int i = 0; i < 4; i++) {\n    vec2 offset = SHADOW_POISSON_DISK[i * 2] * texelSize * searchRadius;\n    float sampleDepth = texture(shadowMap, coord.xy + offset).r;\n    if (sampleDepth < coord.z - bias) {\n      blockerSum += sampleDepth;\n      blockerCount += 1.0;\n    }\n  }\n\n  if (blockerCount < 0.5) {\n    return 1.0;\n  }\n\n  float avgBlockerDepth = blockerSum / blockerCount;\n  float penumbraSize = (coord.z - avgBlockerDepth) / avgBlockerDepth;\n  float filterRadius = clamp(penumbraSize * 2.0, 1.0, 3.0);\n\n  float spatialNoise = fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n  float angle = spatialNoise * 6.283185;\n  float s = sin(angle);\n  float c = cos(angle);\n  mat2 rotation = mat2(c, -s, s, c);\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  for (int i = 0; i < 8; i++) {\n    vec2 offset = rotation * SHADOW_POISSON_DISK[i] * texelSize * filterRadius;\n    float depth = texture(shadowMap, coord.xy + offset).r;\n    shadow += (coord.z - bias > depth) ? 0.0 : 1.0;\n  }\n\n  return shadow / 9.0;\n}\n\n\nfloat getEntityShadow(vec3 worldNormal) {\n  float effectiveStrength = uShadowStrength * uSunlightIntensity;\n  \n  if (effectiveStrength < 0.01) {\n    return 1.0;\n  }\n\n  float NdotL = dot(normalize(worldNormal), normalize(uSunDirection));\n  // Large fixed bias to prevent self-shadowing on small entities like characters\n  // This ensures entity doesn't shadow itself while still receiving terrain shadows\n  float bias = uShadowBias + 0.05;\n  float blendRegion = 0.1;\n\n  float rawShadow;\n  if (vViewDepth < uCascadeSplit0) {\n    float shadow0 = sampleShadowMapPCSS(uShadowMap0, vShadowCoord0, bias);\n    float blendStart = uCascadeSplit0 * (1.0 - blendRegion);\n    if (vViewDepth > blendStart) {\n      float shadow1 = sampleShadowMapPCSS(uShadowMap1, vShadowCoord1, bias * 1.5);\n      float t = (vViewDepth - blendStart) / (uCascadeSplit0 - blendStart);\n      rawShadow = mix(shadow0, shadow1, t);\n    } else {\n      rawShadow = shadow0;\n    }\n  } else if (vViewDepth < uCascadeSplit1) {\n    float shadow1 = sampleShadowMapPCSS(uShadowMap1, vShadowCoord1, bias * 1.5);\n    float blendStart = uCascadeSplit1 * (1.0 - blendRegion);\n    if (vViewDepth > blendStart) {\n      float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, bias * 2.0);\n      float t = (vViewDepth - blendStart) / (uCascadeSplit1 - blendStart);\n      rawShadow = mix(shadow1, shadow2, t);\n    } else {\n      rawShadow = shadow1;\n    }\n  } else if (vViewDepth < uCascadeSplit2) {\n    float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, bias * 2.0);\n    float fadeStart = uCascadeSplit2 * (1.0 - blendRegion);\n    if (vViewDepth > fadeStart) {\n      float t = (vViewDepth - fadeStart) / (uCascadeSplit2 - fadeStart);\n      rawShadow = mix(shadow2, 1.0, t);\n    } else {\n      rawShadow = shadow2;\n    }\n  } else {\n    return 1.0;\n  }\n\n  float shadow = mix(1.0, rawShadow, effectiveStrength);\n  return max(shadow, 0.4);\n}\n"`

---

### ENTITY_SHADOW_VERTEX_MAIN

• `Const` **ENTITY_SHADOW_VERTEX_MAIN**: `"\nvec4 worldPos4 = vec4(worldPosition.xyz, 1.0);\nvShadowCoord0 = uShadowMatrix0 * worldPos4;\nvShadowCoord1 = uShadowMatrix1 * worldPos4;\nvShadowCoord2 = uShadowMatrix2 * worldPos4;\nvec4 viewPos = viewMatrix * worldPos4;\nvViewDepth = -viewPos.z;\n"`

---

### ENTITY_SHADOW_VERTEX_PARS

• `Const` **ENTITY_SHADOW_VERTEX_PARS**: `"\nuniform mat4 uShadowMatrix0;\nuniform mat4 uShadowMatrix1;\nuniform mat4 uShadowMatrix2;\n\nvarying vec4 vShadowCoord0;\nvarying vec4 vShadowCoord1;\nvarying vec4 vShadowCoord2;\nvarying float vViewDepth;\n"`

---

### GREEN_LIGHT

• `Const` **GREEN_LIGHT**: `"GREEN"`

The string representation of green light.

---

### NX_ROTATION

• `Const` **NX_ROTATION**: `3`

The numerical representation of the negative X rotation.

---

### NY_ROTATION

• `Const` **NY_ROTATION**: `1`

The numerical representation of the negative Y rotation.

---

### NZ_ROTATION

• `Const` **NZ_ROTATION**: `5`

The numerical representation of the negative Z rotation.

---

### OPAQUE_RENDER_ORDER

• `Const` **OPAQUE_RENDER_ORDER**: `100`

---

### PX_ROTATION

• `Const` **PX_ROTATION**: `2`

The numerical representation of the positive X rotation.

---

### PY_ROTATION

• `Const` **PY_ROTATION**: `0`

The numerical representation of the positive Y rotation.

---

### PZ_ROTATION

• `Const` **PZ_ROTATION**: `4`

The numerical representation of the positive Z rotation.

---

### RED_LIGHT

• `Const` **RED_LIGHT**: `"RED"`

The string representation of red light.

---

### SHADER_LIGHTING_CHUNK_SHADERS

• `Const` **SHADER_LIGHTING_CHUNK_SHADERS**: `Object`

#### Type declaration

| Name       | Type     |
| :--------- | :------- |
| `fragment` | `string` |
| `vertex`   | `string` |

---

### SHADER_LIGHTING_CROSS_CHUNK_SHADERS

• `Const` **SHADER_LIGHTING_CROSS_CHUNK_SHADERS**: `Object`

#### Type declaration

| Name       | Type     |
| :--------- | :------- |
| `fragment` | `string` |
| `vertex`   | `string` |

---

### SHADOW_POISSON_DISK

• `Const` **SHADOW_POISSON_DISK**: `"\nconst vec2 SHADOW_POISSON_DISK[8] = vec2[8](\n  vec2(-0.94201624, -0.39906216),\n  vec2(0.94558609, -0.76890725),\n  vec2(-0.094184101, -0.92938870),\n  vec2(0.34495938, 0.29387760),\n  vec2(-0.91588581, 0.45771432),\n  vec2(-0.81544232, -0.87912464),\n  vec2(0.97484398, 0.75648379),\n  vec2(0.44323325, -0.97511554)\n);\n"`

---

### SHADOW_SAMPLE_FUNCTIONS

• `Const` **SHADOW_SAMPLE_FUNCTIONS**: `"\nfloat sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;\n\n  return shadow / 5.0;\n}\n\nfloat sampleShadowMapPCSS(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float blockerSum = 0.0;\n  float blockerCount = 0.0;\n  float searchRadius = 3.0;\n  for (int i = 0; i < 4; i++) {\n    vec2 offset = SHADOW_POISSON_DISK[i * 2] * texelSize * searchRadius;\n    float sampleDepth = texture(shadowMap, coord.xy + offset).r;\n    if (sampleDepth < coord.z - bias) {\n      blockerSum += sampleDepth;\n      blockerCount += 1.0;\n    }\n  }\n\n  if (blockerCount < 0.5) {\n    return 1.0;\n  }\n\n  float avgBlockerDepth = blockerSum / blockerCount;\n  float penumbraSize = (coord.z - avgBlockerDepth) / avgBlockerDepth;\n  float filterRadius = clamp(penumbraSize * 2.0, 1.0, 3.0);\n\n  float spatialNoise = fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n  float angle = spatialNoise * 6.283185;\n  float s = sin(angle);\n  float c = cos(angle);\n  mat2 rotation = mat2(c, -s, s, c);\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  for (int i = 0; i < 8; i++) {\n    vec2 offset = rotation * SHADOW_POISSON_DISK[i] * texelSize * filterRadius;\n    float depth = texture(shadowMap, coord.xy + offset).r;\n    shadow += (coord.z - bias > depth) ? 0.0 : 1.0;\n  }\n\n  return shadow / 9.0;\n}\n"`

---

### SUNLIGHT

• `Const` **SUNLIGHT**: `"SUNLIGHT"`

The string representation of sunlight.

---

### TRANSPARENT_FLUID_RENDER_ORDER

• `Const` **TRANSPARENT_FLUID_RENDER_ORDER**: `100001`

---

### TRANSPARENT_RENDER_ORDER

• `Const` **TRANSPARENT_RENDER_ORDER**: `100000`

---

### Y_ROT_MAP

• `Const` **Y_ROT_MAP**: [`number`, `number`][] = `[]`

A rotational map used to get the closest y-rotation representation to a y-rotation value.

Rotation value -> index

---

### Y_ROT_MAP_EIGHT

• `Const` **Y_ROT_MAP_EIGHT**: [`number`, `number`][] = `[]`

---

### Y_ROT_MAP_FOUR

• `Const` **Y_ROT_MAP_FOUR**: [`number`, `number`][] = `[]`

---

### Y_ROT_SEGMENTS

• `Const` **Y_ROT_SEGMENTS**: `16`

The amount of Y-rotation segments should be allowed for y-rotatable blocks. In other words,
the amount of times the block can be rotated around the y-axis within 360 degrees.

The accepted Y-rotation values will be from `0` to `Y_ROTATION_SEGMENTS - 1`.

---

### artFunctions

• `Const` **artFunctions**: `Object`

A preset of art functions to draw on canvas boxes.

#### Type declaration

| Name        | Type                                                                                                                                                   |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawCrown` | [`ArtFunction`](modules.md#artfunction)                                                                                                                |
| `drawMoon`  | (`moonRadius`: `number`, `moonColor`: `string`, `phase`: `number`) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void` |
| `drawStars` | (`starCount`: `number`, `starColors`: `string`[]) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void`                  |
| `drawSun`   | (`sunRadius`: `number`, `sunColor`: `string`) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void`                      |

---

### customShaders

• `Const` **customShaders**: `Object`

#### Type declaration

| Name                   | Type                                                                                                                                                                                                                        |
| :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sway`                 | (`options`: `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number` }\>) => \{ `fragmentShader`: `string` = baseShaders.fragment; `vertexShader`: `string` } |
| `swayCrossShaderBased` | (`options`: `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number` }\>) => \{ `fragmentShader`: `string` = baseShaders.fragment; `vertexShader`: `string` } |
| `swayShaderBased`      | (`options`: `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number` }\>) => \{ `fragmentShader`: `string` = baseShaders.fragment; `vertexShader`: `string` } |

---

### defaultArmsOptions

• `Const` **defaultArmsOptions**: [`ArmsOptions`](modules.md#armsoptions)

---

### defaultBodyOptions

• `Const` **defaultBodyOptions**: [`BodyOptions`](modules.md#bodyoptions)

---

### defaultCharacterOptions

• `Const` **defaultCharacterOptions**: [`CharacterOptions`](modules.md#characteroptions)

---

### defaultCreatureBodyOptions

• `Const` **defaultCreatureBodyOptions**: [`CreatureBodyOptions`](modules.md#creaturebodyoptions)

---

### defaultCreatureHeadOptions

• `Const` **defaultCreatureHeadOptions**: [`CreatureHeadOptions`](modules.md#creatureheadoptions)

---

### defaultCreatureLegOptions

• `Const` **defaultCreatureLegOptions**: [`CreatureLegOptions`](modules.md#creaturelegoptions)

---

### defaultCreatureOptions

• `Const` **defaultCreatureOptions**: [`CreatureOptions`](modules.md#creatureoptions)

---

### defaultHeadOptions

• `Const` **defaultHeadOptions**: [`HeadOptions`](modules.md#headoptions)

---

### defaultLegsOptions

• `Const` **defaultLegsOptions**: [`LegOptions`](modules.md#legoptions)

---

### restArgsSchema

• `Const` **restArgsSchema**: `ZodObject`\<\{ `rest`: `ZodOptional`\<`ZodString`\> }, `"strip"`, `ZodTypeAny`, \{ `rest?`: `string` }, \{ `rest?`: `string` }\>

Schema for commands that take a free-form string input.
Use this for commands that need the raw rest string.

## Functions

### TRANSPARENT_SORT

▸ **TRANSPARENT_SORT**(`object`): (`a`: `any`, `b`: `any`) => `number`

#### Parameters

| Name     | Type                             |
| :------- | :------------------------------- |
| `object` | `Object3D`\<`Object3DEventMap`\> |

#### Returns

`fn`

▸ (`a`, `b`): `number`

##### Parameters

| Name | Type  |
| :--- | :---- |
| `a`  | `any` |
| `b`  | `any` |

##### Returns

`number`

---

### createEntityShadowUniforms

▸ **createEntityShadowUniforms**(): [`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md)

#### Returns

[`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md)

---

### createSwayShader

▸ **createSwayShader**(`baseShaders`, `options?`): `Object`

#### Parameters

| Name                   | Type                                                                                                                       |
| :--------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `baseShaders`          | `Object`                                                                                                                   |
| `baseShaders.fragment` | `string`                                                                                                                   |
| `baseShaders.vertex`   | `string`                                                                                                                   |
| `options`              | `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number` }\> |

#### Returns

`Object`

| Name             | Type     |
| :--------------- | :------- |
| `fragmentShader` | `string` |
| `vertexShader`   | `string` |

---

### cull

▸ **cull**(`array`, `options`): `Promise`\<[`MeshResultType`](modules.md#meshresulttype)\>

#### Parameters

| Name      | Type                                                                  |
| :-------- | :-------------------------------------------------------------------- |
| `array`   | `NdArray`\<`number`[] \| `TypedArray` \| `GenericArray`\<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype)                       |

#### Returns

`Promise`\<[`MeshResultType`](modules.md#meshresulttype)\>

---

### findSimilar

▸ **findSimilar**(`target`, `available`, `options?`): `string`[]

#### Parameters

| Name        | Type                                                  |
| :---------- | :---------------------------------------------------- |
| `target`    | `string`                                              |
| `available` | `string`[]                                            |
| `options`   | [`FindSimilarOptions`](modules.md#findsimilaroptions) |

#### Returns

`string`[]

---

### formatSuggestion

▸ **formatSuggestion**(`suggestions`, `allAvailable`, `options?`): `string`

#### Parameters

| Name           | Type                                                            |
| :------------- | :-------------------------------------------------------------- |
| `suggestions`  | `string`[]                                                      |
| `allAvailable` | `string`[]                                                      |
| `options`      | [`FormatSuggestionOptions`](modules.md#formatsuggestionoptions) |

#### Returns

`string`

---

### prepareTransparentMesh

▸ **prepareTransparentMesh**(`mesh`): [`TransparentMeshData`](interfaces/TransparentMeshData.md) \| `null`

#### Parameters

| Name   | Type                                                                                                   |
| :----- | :----------------------------------------------------------------------------------------------------- |
| `mesh` | `Mesh`\<`BufferGeometry`\<`NormalBufferAttributes`\>, `Material` \| `Material`[], `Object3DEventMap`\> |

#### Returns

[`TransparentMeshData`](interfaces/TransparentMeshData.md) \| `null`

---

### requestWorkerAnimationFrame

▸ **requestWorkerAnimationFrame**(`callback`): `number`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `callback` | () => `void` |

#### Returns

`number`

---

### setWorkerInterval

▸ **setWorkerInterval**(`func`, `interval`): () => `void`

#### Parameters

| Name       | Type         |
| :--------- | :----------- |
| `func`     | () => `void` |
| `interval` | `number`     |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

---

### setupTransparentSorting

▸ **setupTransparentSorting**(`object`): `void`

#### Parameters

| Name     | Type                             |
| :------- | :------------------------------- |
| `object` | `Object3D`\<`Object3DEventMap`\> |

#### Returns

`void`

---

### sortTransparentMesh

▸ **sortTransparentMesh**(`mesh`, `data`, `camera`): `void`

#### Parameters

| Name     | Type                                                                                                   |
| :------- | :----------------------------------------------------------------------------------------------------- |
| `mesh`   | `Mesh`\<`BufferGeometry`\<`NormalBufferAttributes`\>, `Material` \| `Material`[], `Object3DEventMap`\> |
| `data`   | [`TransparentMeshData`](interfaces/TransparentMeshData.md)                                             |
| `camera` | `Camera`                                                                                               |

#### Returns

`void`

---

### updateEntityShadowUniforms

▸ **updateEntityShadowUniforms**(`target`, `source`): `void`

#### Parameters

| Name     | Type                                                             |
| :------- | :--------------------------------------------------------------- |
| `target` | [`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md)     |
| `source` | [`ShaderLightingUniforms`](interfaces/ShaderLightingUniforms.md) |

#### Returns

`void`
