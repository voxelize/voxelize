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
- [BoundedLruMap](classes/BoundedLruMap.md)
- [BoxLayer](classes/BoxLayer.md)
- [CSMRenderer](classes/CSMRenderer.md)
- [CanvasBox](classes/CanvasBox.md)
- [Character](classes/Character.md)
- [Chunk](classes/Chunk.md)
- [ChunkPipeline](classes/ChunkPipeline.md)
- [ChunkRenderer](classes/ChunkRenderer.md)
- [ChunkSharedPool](classes/ChunkSharedPool.md)
- [Clouds](classes/Clouds.md)
- [Creature](classes/Creature.md)
- [Debug](classes/Debug.md)
- [Entity](classes/Entity.md)
- [EntityLivenessTracker](classes/EntityLivenessTracker.md)
- [Events](classes/Events.md)
- [FaceAnimation](classes/FaceAnimation.md)
- [ImageItemRenderer](classes/ImageItemRenderer.md)
- [ItemRegistry](classes/ItemRegistry.md)
- [ItemRenderer](classes/ItemRenderer.md)
- [ItemSlot](classes/ItemSlot.md)
- [ItemSlots](classes/ItemSlots.md)
- [LightCones](classes/LightCones.md)
- [MemoryPressureMonitor](classes/MemoryPressureMonitor.md)
- [MeshPipeline](classes/MeshPipeline.md)
- [Method](classes/Method.md)
- [NameTag](classes/NameTag.md)
- [Network](classes/Network.md)
- [Perspective](classes/Perspective.md)
- [Portrait](classes/Portrait.md)
- [Registry](classes/Registry.md)
- [Sky](classes/Sky.md)
- [SpriteText](classes/SpriteText.md)
- [ThreeUtils](classes/ThreeUtils.md)
- [VoxelInteract](classes/VoxelInteract.md)
- [WaterOptics](classes/WaterOptics.md)
- [WebRTCConnection](classes/WebRTCConnection.md)
- [WorkerPool](classes/WorkerPool.md)
- [WorkerTransfer](classes/WorkerTransfer.md)

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
- [EntityShadowUniforms](interfaces/EntityShadowUniforms.md)
- [ImageComp](interfaces/ImageComp.md)
- [ImageItemMeshData](interfaces/ImageItemMeshData.md)
- [ItemDef](interfaces/ItemDef.md)
- [NetIntercept](interfaces/NetIntercept.md)
- [ShaderLightingUniforms](interfaces/ShaderLightingUniforms.md)
- [TransparentMeshData](interfaces/TransparentMeshData.md)
- [UnderwaterFogSource](interfaces/UnderwaterFogSource.md)
- [UnderwaterFogUniforms](interfaces/UnderwaterFogUniforms.md)

## Type Aliases

### ArgMetadata

Ƭ **ArgMetadata**: `Object`

Metadata extracted from a Zod schema for UI purposes.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `defaultValue?` | `string` \| `number` \| `boolean` |
| `name` | `string` |
| `options?` | `string`[] |
| `required` | `boolean` |
| `tabComplete?` | (`currentValue`: `string`, `context`: [`TabCompleteContext`](modules.md#tabcompletecontext)) => `string`[] |
| `type` | ``"string"`` \| ``"number"`` \| ``"enum"`` \| ``"boolean"`` |

___

### ArmOptions

Ƭ **ArmOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `armColor?` | `string` \| `THREE.Color` |
| `armObject?` | `THREE.Object3D` |
| `armObjectOptions` | `ArmObjectOptions` |
| `armTexture?` | `THREE.Texture` |
| `blockObjectOptions?` | `ArmObjectOptions` |
| `customObjectOptions?` | `Record`\<`string`, `ArmObjectOptions`\> |
| `minOccluderDepth?` | `number` |
| `receiveHeldObjectShadows?` | `boolean` |
| `receiveShadows?` | `boolean` |

___

### ArmsOptions

Ƭ **ArmsOptions**: `ColorCanvasBoxOptions` & \{ `shoulderDrop?`: `number` ; `shoulderGap?`: `number`  }

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

### ArrowOptions

Ƭ **ArrowOptions**: `Object`

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

A function to programmatically draw on a canvas.

#### Type declaration

▸ (`context`, `canvas`): `void`

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
| `dynamicFn` | (`pos`: [`Coords3`](modules.md#coords3)) => \{ `aabbs`: [`Block`](modules.md#block)[``"aabbs"``] ; `faces`: [`Block`](modules.md#block)[``"faces"``] ; `isTransparent`: [`Block`](modules.md#block)[``"isTransparent"``]  } | - |
| `dynamicPatterns` | [`BlockDynamicPattern`](interfaces/BlockDynamicPattern.md)[] | - |
| `faces` | \{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `range`: [`UV`](modules.md#uv) ; `textureGroup`: `string` \| ``null``  }[] | A list of block face data that this block has. |
| `fluidFlowForce` | `number` | The force applied to entities in this fluid, pushing them in the flow direction. |
| `greenLightLevel` | `number` | The green light level of the block. |
| `groundFrictionMultiplier` | `number` | Multiplier applied to entity ground friction while standing on this block. 1 is normal grip; lower values are slipperier. |
| `id` | `number` | The block id. |
| `independentFaces` | `Set`\<`string`\> | A set of block face names that are independent (high resolution or animated). This is generated on the client side. |
| `isClimbable` | `boolean` | Whether or not can entities climb this block. |
| `isDynamic` | `boolean` | Whether or not does the block generate dynamic faces or AABB's. If this is true, the block will use `dynamicFn` to generate the faces and AABB's. |
| `isEmpty` | `boolean` | Whether or not is this block empty. By default, only "air" is empty. |
| `isEntity` | `boolean` | - |
| `isFluid` | `boolean` | Whether or not is the block a fluid block. |
| `isLight` | `boolean` | Whether or not is this block a light source. |
| `isOpaque` | `boolean` | Whether or not is this block opaque (not transparent). |
| `isPassable` | `boolean` | Whether or not should physics ignore this block. |
| `isSeeThrough` | `boolean` | Whether or not is this block see-through (can be opaque and see-through at the same time). |
| `isTransparent` | [`boolean`, `boolean`, `boolean`, `boolean`, `boolean`, `boolean`] | Whether or not is this block transparent viewing from all six sides. The sides are defined as PX, PY, PZ, NX, NY, NZ. |
| `isWaterlogged` | `boolean` | Whether or not is the block waterlogged (exists inside water). |
| `isolatedFaces` | `Set`\<`string`\> | - |
| `lightAttenuation` | `number` | Optical density for Beer-Lambert light transmission through this block. `0` keeps normal air rules. `1` is leaves-scale. `2` is water-scale. |
| `name` | `string` | The name of the block. |
| `redLightLevel` | `number` | The red light level of the block. |
| `rotatable` | `boolean` | Whether or not is the block rotatable. |
| `transparentStandalone` | `boolean` | - |
| `yRotatable` | `boolean` | Whether or not the block is rotatable around the y-axis (has to face either PX or NX). |
| `yRotatableSegments` | ``"All"`` \| ``"Eight"`` \| ``"Four"`` | - |

___

### BlockEntityUpdateData

Ƭ **BlockEntityUpdateData**\<`T`\>: `Object`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `etype` | `string` |
| `id` | `string` |
| `newValue` | `T` \| ``null`` |
| `oldValue` | `T` \| ``null`` |
| `operation` | `EntityOperation` |
| `voxel` | [`Coords3`](modules.md#coords3) |

___

### BlockEntityUpdateListener

Ƭ **BlockEntityUpdateListener**\<`T`\>: (`args`: [`BlockEntityUpdateData`](modules.md#blockentityupdatedata)\<`T`\>) => `void`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Type declaration

▸ (`args`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | [`BlockEntityUpdateData`](modules.md#blockentityupdatedata)\<`T`\> |

##### Returns

`void`

___

### BlockRule

Ƭ **BlockRule**: \{ `type`: ``"none"``  } \| \{ `type`: ``"simple"``  } & [`BlockSimpleRule`](modules.md#blocksimplerule) \| \{ `logic`: [`BlockRuleLogic`](enums/BlockRuleLogic.md) ; `rules`: [`BlockRule`](modules.md#blockrule)[] ; `type`: ``"combination"``  }

___

### BlockSimpleRule

Ƭ **BlockSimpleRule**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id?` | `number` |
| `offset` | [`Coords3`](modules.md#coords3) |
| `rotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `stage?` | `number` |

___

### BlockUpdate

Ƭ **BlockUpdate**: `Object`

A block update to make on the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation?` | `number` | The optional rotation of the updated block. |
| `stage?` | `number` | The optional stage of the updated block. |
| `type` | `number` | The voxel type. |
| `vx` | `number` | The voxel x-coordinate. |
| `vy` | `number` | The voxel y-coordinate. |
| `vz` | `number` | The voxel z-coordinate. |
| `yRotation?` | `number` | The optional y-rotation of the updated block. |

___

### BlockUpdateListener

Ƭ **BlockUpdateListener**: (`args`: \{ `newValue`: `number` ; `oldValue`: `number` ; `source`: ``"client"`` \| ``"server"`` ; `voxel`: [`Coords3`](modules.md#coords3)  }) => `void`

#### Type declaration

▸ (`args`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `args` | `Object` |
| `args.newValue` | `number` |
| `args.oldValue` | `number` |
| `args.source` | ``"client"`` \| ``"server"`` |
| `args.voxel` | [`Coords3`](modules.md#coords3) |

##### Returns

`void`

___

### BlockUpdateWithSource

Ƭ **BlockUpdateWithSource**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `source` | ``"client"`` \| ``"server"`` |
| `update` | [`BlockUpdate`](modules.md#blockupdate) |

___

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

___

### BoundingBox

Ƭ **BoundingBox**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `min` | [`Coords3`](modules.md#coords3) |
| `shape` | [`Coords3`](modules.md#coords3) |

___

### BoxSides

Ƭ **BoxSides**: ``"back"`` \| ``"front"`` \| ``"top"`` \| ``"bottom"`` \| ``"left"`` \| ``"right"`` \| ``"sides"`` \| ``"all"``

The sides of a canvas box.

`"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.

___

### CSSMeasurement

Ƭ **CSSMeasurement**: \`$\{number}$\{string}\`

A CSS measurement. E.g. "30px", "51em"

___

### CameraPerspective

Ƭ **CameraPerspective**: ``"px"`` \| ``"nx"`` \| ``"py"`` \| ``"ny"`` \| ``"pz"`` \| ``"nz"`` \| ``"pxy"`` \| ``"nxy"`` \| ``"pxz"`` \| ``"nxz"`` \| ``"pyz"`` \| ``"nyz"`` \| ``"pxyz"`` \| ``"nxyz"``

___

### CanvasBoxOptions

Ƭ **CanvasBoxOptions**: `Object`

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
| `receiveShadows?` | `boolean` | Whether this canvas box should receive shadows. Defaults to `false`. |
| `side` | `Side` | The side of the box to render. Defaults to `THREE.FrontSide`. |
| `transparent?` | `boolean` | Whether or not should this canvas box be rendered as transparent. Defaults to `false`. |
| `underwaterFog?` | `boolean` | Whether this canvas box tints toward the ambient water color while the camera is submerged, matching the underwater look of instanced entities. Defaults to `false`. |
| `width` | `number` | THe width of the box. Defaults to `1`. |
| `widthSegments` | `number` | The width segments of the box, which is the number of pixels of the canvases along the width. Defaults to `8`. |

___

### CharacterOptions

Ƭ **CharacterOptions**: `Object`

Parameters to create a character.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `arms?` | `Partial`\<[`ArmsOptions`](modules.md#armsoptions)\> | Parameters to create the character's arms. |
| `body?` | `Partial`\<[`BodyOptions`](modules.md#bodyoptions)\> | Parameters to create the character's body. |
| `head?` | `Partial`\<[`HeadOptions`](modules.md#headoptions)\> | Parameters to create the character's head. |
| `idleArmSwing?` | `number` | The speed at which the arms swing when the character is idle. Defaults to `0.06`. |
| `legs?` | `Partial`\<[`LegOptions`](modules.md#legoptions)\> | Parameters to create the character's legs. |
| `nameTagOptions?` | `Partial`\<[`NameTagOptions`](modules.md#nametagoptions)\> | - |
| `positionLerp?` | `number` | The lerp factor of the character's position change, expressed per frame at 60 FPS and renormalized to the real frame delta. Defaults to `0.7`. |
| `receiveShadows?` | `boolean` | Whether this character should receive shadows. Defaults to `false`. |
| `rotationLerp?` | `number` | The lerp factor of the character's rotation change, expressed per frame at 60 FPS and renormalized to the real frame delta. Defaults to `0.2`. |
| `swimEnterLerp?` | `number` | Lerp factor when entering the swimming pose. Defaults to `0.12`. |
| `swimExitLerp?` | `number` | Lerp factor when exiting the swimming pose. Defaults to `0.05`. |
| `swimmingSpeed?` | `number` | The speed at which the arms stroke when the character is swimming. Defaults to `1.8`. |
| `swingLerp?` | `number` | The lerp factor of the swinging motion of the arms and legs. Defaults to `0.8`. |
| `walkingSpeed?` | `number` | The speed at which the arms swing when the character is moving. Defaults to `1.4`. |

___

### ChunkDataEventData

Ƭ **ChunkDataEventData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chunk` | [`Chunk`](classes/Chunk.md) |
| `coords` | [`Coords2`](modules.md#coords2) |

___

### ChunkEventData

Ƭ **ChunkEventData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `allMeshes` | `Map`\<`number`, `Mesh`[]\> |
| `chunk` | [`Chunk`](classes/Chunk.md) |
| `coords` | [`Coords2`](modules.md#coords2) |

___

### ChunkMeshEventData

Ƭ **ChunkMeshEventData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chunk` | [`Chunk`](classes/Chunk.md) |
| `coords` | [`Coords2`](modules.md#coords2) |
| `level` | `number` |
| `meshes` | `Mesh`[] |

___

### ChunkMeshUpdateEventData

Ƭ **ChunkMeshUpdateEventData**: [`ChunkMeshEventData`](modules.md#chunkmesheventdata) & \{ `reason`: [`ChunkUpdateReason`](modules.md#chunkupdatereason)  }

___

### ChunkRequestCandidate

Ƭ **ChunkRequestCandidate**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `distanceSquared` | `number` |
| `isInView` | `boolean` |

___

### ChunkSharedPoolStats

Ƭ **ChunkSharedPoolStats**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `bytesAllocated` | `number` |
| `isActive` | `boolean` |
| `maxSlots` | `number` |
| `usedSlots` | `number` |

___

### ChunkStage

Ƭ **ChunkStage**: \{ `requestedAt`: `number` ; `retryCount`: `number` ; `stage`: ``"requested"``  } \| \{ `data`: `ChunkProtocol` ; `source`: ``"update"`` \| ``"load"`` ; `stage`: ``"processing"``  } \| \{ `chunk`: [`Chunk`](classes/Chunk.md) ; `stage`: ``"loaded"``  }

___

### ChunkUpdateEventData

Ƭ **ChunkUpdateEventData**: [`ChunkEventData`](modules.md#chunkeventdata) & \{ `reason`: [`ChunkUpdateReason`](modules.md#chunkupdatereason)  }

___

### ChunkUpdateReason

Ƭ **ChunkUpdateReason**: ``"voxel"`` \| ``"light"``

___

### ClickType

Ƭ **ClickType**: ``"left"`` \| ``"middle"`` \| ``"right"``

Three types of clicking for mouse input listening.

___

### CloudsOptions

Ƭ **CloudsOptions**: `Object`

Parameters used to create a new [Clouds](classes/Clouds.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `alpha` | `number` | The opacity of the clouds. Defaults to `0.8`. |
| `cloudHeight` | `number` | The y-height at which the clouds are generated. Defaults to `256`. |
| `color` | `string` | The color of the clouds. Defaults to `#fff`. |
| `count` | `number` | The number of cloud cells to generate, `count` * `count`. Defaults to `16`. |
| `dimensions` | [`Coords3`](modules.md#coords3) | The dimension of each cloud block. Defaults to `[20, 20, 20]`. |
| `endFadeFarRatio` | `number` | - |
| `endFadeNearRatio` | `number` | - |
| `falloff` | `number` | The noise falloff factor used to generate the clouds. Defaults to `0.9`. |
| `height` | `number` | The vertical count of how many cloud blocks are in a cloud cell. This is also used to determine the overall count of cloud blocks of all the clouds. Defaults to `3`. |
| `lerpFactor` | `number` | The lerp factor used to translate cloud blocks from their original position to their new position. Defaults to `0.3`. |
| `noiseScale` | `number` | The scale of the noise used to generate the clouds. Defaults to `0.08`. |
| `octaves` | `number` | The number of octaves used to generate the noise. Defaults to `5`. |
| `seed` | `number` | The seed used to generate the clouds. Defaults to `-1`. |
| `speedFactor` | `number` | The speed at which the clouds move. Defaults to `8`. |
| `threshold` | `number` | The threshold at which noise values are considered to be "cloudy" and should generate a new cloud block. Defaults to `0.05`. |
| `uCameraSubmersion?` | `ShaderUniform`\<`number`\> | - |
| `uCameraWaterPlaneY?` | `ShaderUniform`\<`number`\> | - |
| `uCloudEndFadeFar?` | `ShaderUniform`\<`number`\> | - |
| `uCloudEndFadeNear?` | `ShaderUniform`\<`number`\> | - |
| `uCloudFogDistanceScale?` | `ShaderUniform`\<`number`\> | - |
| `uFogColor?` | `ShaderUniform`\<`Color`\> | An object that is used as the uniform for the clouds fog color shader. |
| `uFogFar?` | `ShaderUniform`\<`number`\> | An object that is used as the uniform for the clouds fog far shader. |
| `uFogHeightDensity?` | `ShaderUniform`\<`number`\> | - |
| `uFogHeightOrigin?` | `ShaderUniform`\<`number`\> | - |
| `uFogNear?` | `ShaderUniform`\<`number`\> | An object that is used as the uniform for the clouds fog near shader. |
| `uSkyFogBottomColor?` | `ShaderUniform`\<`Color`\> | - |
| `uSkyFogDimension?` | `ShaderUniform`\<`number`\> | - |
| `uSkyFogExponent?` | `ShaderUniform`\<`number`\> | - |
| `uSkyFogExponent2?` | `ShaderUniform`\<`number`\> | - |
| `uSkyFogMiddleColor?` | `ShaderUniform`\<`Color`\> | - |
| `uSkyFogOffset?` | `ShaderUniform`\<`number`\> | - |
| `uSkyFogStrength?` | `ShaderUniform`\<`number`\> | - |
| `uSkyFogTopColor?` | `ShaderUniform`\<`Color`\> | - |
| `uSkyFogVoidOffset?` | `ShaderUniform`\<`number`\> | - |
| `uSunColor?` | `ShaderUniform`\<`Color`\> | - |
| `uSunDirection?` | `ShaderUniform`\<`Vector3`\> | - |
| `uSunlightIntensity?` | `ShaderUniform`\<`number`\> | - |
| `uUnderwaterAmbient?` | `ShaderUniform`\<`Color`\> | - |
| `width` | `number` | The horizontal count of how many cloud blocks are in a cloud cell. Defaults to `8`. |

___

### CommandInfo

Ƭ **CommandInfo**\<`T`\>: `Object`

Information about a command including its processor and documentation.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>\> = `ZodObject`\<`Record`\<`string`, `never`\>\> |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `aliases` | `string`[] |
| `args` | `T` |
| `category?` | `string` |
| `description` | `string` |
| `flags` | `string`[] |
| `isHidden` | `boolean` |
| `isTabCompletePreFiltered` | `boolean` |
| `process` | (`args`: `z.infer`\<`T`\>) => `void` |
| `tabComplete` | `Partial`\<`Record`\<`string`, (`currentValue`: `string`, `context`: [`TabCompleteContext`](modules.md#tabcompletecontext)) => `string`[]\>\> |

___

### CommandOptions

Ƭ **CommandOptions**\<`T`\>: `Object`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `ZodObject`\<`Record`\<`string`, `ZodTypeAny`\>\> = `ZodObject`\<`Record`\<`string`, `never`\>\> |

#### Type declaration

| Name | Type |
| :------ | :------ |
| `aliases?` | `string`[] |
| `args?` | `T` |
| `category?` | `string` |
| `description` | `string` |
| `flags?` | `string`[] |
| `isHidden?` | `boolean` |
| `isTabCompletePreFiltered?` | `boolean` |
| `tabComplete?` | `Partial`\<`Record`\<keyof `z.infer`\<`T`\>, (`currentValue`: `string`, `context`: [`TabCompleteContext`](modules.md#tabcompletecontext)) => `string`[]\>\> |

___

### Coords2

Ƭ **Coords2**: [`number`, `number`]

___

### Coords3

Ƭ **Coords3**: [`number`, `number`, `number`]

___

### CreatureBodyOptions

Ƭ **CreatureBodyOptions**: `ColorCanvasBoxOptions`

___

### CreatureHeadOptions

Ƭ **CreatureHeadOptions**: `ColorCanvasBoxOptions` & \{ `faceColor`: `Color` \| `string` ; `neckGap?`: `number`  }

___

### CreatureLegOptions

Ƭ **CreatureLegOptions**: `ColorCanvasBoxOptions` & \{ `betweenLegsGap?`: `number` ; `frontBackGap?`: `number`  }

___

### CreatureOptions

Ƭ **CreatureOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `body?` | `Partial`\<[`CreatureBodyOptions`](modules.md#creaturebodyoptions)\> |
| `head?` | `Partial`\<[`CreatureHeadOptions`](modules.md#creatureheadoptions)\> |
| `idleLegSwing?` | `number` |
| `legs?` | `Partial`\<[`CreatureLegOptions`](modules.md#creaturelegoptions)\> |
| `nameTagOptions?` | `Partial`\<[`NameTagOptions`](modules.md#nametagoptions)\> |
| `positionLerp?` | `number` |
| `rotationLerp?` | `number` |
| `swingLerp?` | `number` |
| `walkingSpeed?` | `number` |

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

___

### CustomChunkShaderMaterial

Ƭ **CustomChunkShaderMaterial**: `ShaderMaterial` & \{ `map`: `Texture`  }

Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
if you want to change its map, you also have to change its `uniforms.map`.

___

### DebugOptions

Ƭ **DebugOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `asyncPeriod?` | `number` |
| `containerId?` | `string` |
| `dataClass?` | `string` |
| `dataStyles?` | `StyleDecl` |
| `entriesClass?` | `string` |
| `entriesStyles?` | `StyleDecl` |
| `lineClass?` | `string` |
| `lineStyles?` | `StyleDecl` |
| `newLineStyles?` | `StyleDecl` |
| `onByDefault?` | `boolean` |
| `showVoxelize?` | `boolean` |
| `stats?` | `boolean` |
| `statsStyles?` | `StyleDecl` |

___

### DeepPartial

Ƭ **DeepPartial**\<`T`\>: \{ [P in keyof T]?: DeepPartial\<T[P]\> }

#### Type parameters

| Name |
| :------ |
| `T` |

___

### EntitiesOptions

Ƭ **EntitiesOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `stalenessTimeoutSeconds` | `number` | Seconds an entity may go without any server message before it is considered lost and released. Covers dropped out-of-range and delete notifications so no entity can stay frozen forever. |
| `streamSilenceGraceSeconds` | `number` | Seconds of total message silence after which staleness releases are suspended, so reconnects and tab suspensions do not purge live entities. |

___

### EntityLivenessOptions

Ƭ **EntityLivenessOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `stalenessTimeoutSeconds` | `number` | Seconds an entity may go without any message before it is considered lost and released. The server keep-alive cadence is roughly one second, so this should comfortably exceed several missed keep-alives. |
| `streamSilenceGraceSeconds` | `number` | Seconds of total message silence after which staleness judgment is suspended. A quiet stream means the connection itself is degraded (disconnect, tab suspension), not that individual entities were lost. |

___

### EntityMetadata

Ƭ **EntityMetadata**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `rigidBody?` | [`EntityRigidBodyMetadata`](modules.md#entityrigidbodymetadata) |

___

### EntityRigidBodyMetadata

Ƭ **EntityRigidBodyMetadata**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fluidRatio` | `number` |
| `isInFluid` | `boolean` |

___

### Event

Ƭ **Event**: `Object`

A Voxelize event from the server.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name to identify the event. |
| `payload?` | [`EventPayload`](modules.md#eventpayload) | Additional information of the event. |

___

### EventHandler

Ƭ **EventHandler**\<`TPayload`\>: (`payload`: `TPayload`) => `void`

The handler for an event sent from the Voxelize server.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TPayload` | [`EventPayload`](modules.md#eventpayload) |

#### Type declaration

▸ (`payload`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | `TPayload` |

##### Returns

`void`

___

### EventPayload

Ƭ **EventPayload**: `JsonPrimitive` \| \{ `[key: string]`: [`EventPayload`](modules.md#eventpayload) \| `undefined`;  } \| [`EventPayload`](modules.md#eventpayload)[]

___

### FindSimilarOptions

Ƭ **FindSimilarOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxSuggestions?` | `number` |

___

### FluidQuery

Ƭ **FluidQuery**: (`vx`: `number`, `vy`: `number`, `vz`: `number`) => `boolean`

#### Type declaration

▸ (`vx`, `vy`, `vz`): `boolean`

##### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

##### Returns

`boolean`

___

### FormatSuggestionOptions

Ƭ **FormatSuggestionOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxFallbackItems?` | `number` |

___

### HeadOptions

Ƭ **HeadOptions**: `ColorCanvasBoxOptions` & \{ `faceColor`: `Color` \| `string` ; `neckGap?`: `number`  }

___

### HeapReader

Ƭ **HeapReader**: () => [`HeapSample`](modules.md#heapsample) \| ``null``

Reads the current heap, or returns `null` when the engine exposes no heap
numbers at all (every non-Chromium browser).

#### Type declaration

▸ (): [`HeapSample`](modules.md#heapsample) \| ``null``

##### Returns

[`HeapSample`](modules.md#heapsample) \| ``null``

___

### HeapSample

Ƭ **HeapSample**: `Object`

A single reading of the renderer's JavaScript heap.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `limitBytes` | `number` |
| `usedBytes` | `number` |

___

### ImageResolver

Ƭ **ImageResolver**: (`name`: `string`) => `string`

#### Type declaration

▸ (`name`): `string`

##### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

##### Returns

`string`

___

### InputOccasion

Ƭ **InputOccasion**: ``"keydown"`` \| ``"keypress"`` \| ``"keyup"``

The occasion that the input should be fired.

___

### InputSpecifics

Ƭ **InputSpecifics**: `Object`

The specific options of the key to listen to.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `checkType?` | ``"key"`` \| ``"code"`` | The type of key to check for. Defaults to `key`. |
| `identifier?` | `string` | A special identifier to tag this input with. This is useful for removing specific inputs from the input listener later on. |
| `occasion?` | [`InputOccasion`](modules.md#inputoccasion) | The occasion that the input should be fired. Defaults to `keydown`. |

___

### ItemRendererFactory

Ƭ **ItemRendererFactory**: (`itemDef`: [`ItemDef`](interfaces/ItemDef.md), `world`: [`World`](classes/World.md)) => [`ItemRenderer`](classes/ItemRenderer.md)

#### Type declaration

▸ (`itemDef`, `world`): [`ItemRenderer`](classes/ItemRenderer.md)

##### Parameters

| Name | Type |
| :------ | :------ |
| `itemDef` | [`ItemDef`](interfaces/ItemDef.md) |
| `world` | [`World`](classes/World.md) |

##### Returns

[`ItemRenderer`](classes/ItemRenderer.md)

___

### ItemSlotsOptions

Ƭ **ItemSlotsOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `activatedByDefault` | `boolean` |
| `focusFirstByDefault` | `boolean` |
| `horizontalCount` | `number` |
| `perspective` | [`CameraPerspective`](modules.md#cameraperspective) |
| `scrollable?` | `boolean` |
| `slotClass` | `string` |
| `slotFocusClass` | `string` |
| `slotGap` | `number` |
| `slotHeight` | `number` |
| `slotHoverClass` | `string` |
| `slotMargin` | `number` |
| `slotPadding` | `number` |
| `slotStyles` | `Partial`\<`CSSStyleDeclaration`\> |
| `slotSubscriptClass` | `string` |
| `slotSubscriptStyles` | `Partial`\<`CSSStyleDeclaration`\> |
| `slotWidth` | `number` |
| `verticalCount` | `number` |
| `wrapperClass` | `string` |
| `wrapperPadding` | `number` |
| `wrapperStyles` | `Partial`\<`CSSStyleDeclaration`\> |
| `zoom` | `number` |

___

### LegOptions

Ƭ **LegOptions**: `ColorCanvasBoxOptions` & \{ `betweenLegsGap?`: `number`  }

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

### LightBatch

Ƭ **LightBatch**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `batchId` | `number` | - |
| `completedJobs` | `number` | - |
| `jobs` | [`LightJob`](modules.md#lightjob)[] | - |
| `pendingDispatch` | [`LightJob`](modules.md#lightjob)[] | Jobs of this batch that have not been handed to a worker yet. Dispatch serializes every chunk the job's bounding box covers, so jobs wait here as cheap descriptors instead of as multi-megabyte copies. |
| `results` | [`LightBatchResult`](modules.md#lightbatchresult)[] | - |
| `startSequenceId` | `number` | - |
| `totalJobs` | `number` | - |

___

### LightBatchResult

Ƭ **LightBatchResult**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `boundingBox` | [`BoundingBox`](modules.md#boundingbox) |
| `color` | [`LightColor`](modules.md#lightcolor) |
| `modifiedChunks` | [`LightWorkerModifiedChunk`](modules.md#lightworkermodifiedchunk)[] |

___

### LightColor

Ƭ **LightColor**: ``"RED"`` \| ``"GREEN"`` \| ``"BLUE"`` \| ``"SUNLIGHT"``

Sunlight or the color of torch light.

___

### LightConeInput

Ƭ **LightConeInput**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `angleDeg` | `number` | Full outer cone angle in degrees. |
| `color` | `Color` | - |
| `direction` | `Vector3` | - |
| `innerRatio` | `number` | Inner (full-brightness) cone angle as a fraction of the outer angle. |
| `intensity` | `number` | - |
| `origin` | `Vector3` | - |
| `range` | `number` | - |
| `scatterStrength` | `number` | - |
| `submersion` | `number` | 0 above water to 1 submerged; drives extinction and beam glow. |

___

### LightConeUniformBinding

Ƭ **LightConeUniformBinding**: [`LightConeUniforms`](modules.md#lightconeuniforms)[keyof [`LightConeUniforms`](modules.md#lightconeuniforms)]

___

### LightConeUniforms

Ƭ **LightConeUniforms**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `coneColors` | \{ `value`: `Color`[]  } |
| `coneColors.value` | `Color`[] |
| `coneCount` | \{ `value`: `number`  } |
| `coneCount.value` | `number` |
| `coneDirections` | \{ `value`: `Vector3`[]  } |
| `coneDirections.value` | `Vector3`[] |
| `coneOrigins` | \{ `value`: `Vector4`[]  } |
| `coneOrigins.value` | `Vector4`[] |
| `coneShapes` | \{ `value`: `Vector4`[]  } |
| `coneShapes.value` | `Vector4`[] |

___

### LightJob

Ƭ **LightJob**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `batchId` | `number` |
| `boundingBox` | [`BoundingBox`](modules.md#boundingbox) |
| `color` | [`LightColor`](modules.md#lightcolor) |
| `jobId` | `string` |
| `lightOps` | \{ `floods`: [`LightNode`](modules.md#lightnode)[] ; `removals`: [`Coords3`](modules.md#coords3)[]  } |
| `lightOps.floods` | [`LightNode`](modules.md#lightnode)[] |
| `lightOps.removals` | [`Coords3`](modules.md#coords3)[] |
| `retryCount` | `number` |
| `startSequenceId` | `number` |

___

### LightNode

Ƭ **LightNode**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `level` | `number` |
| `voxel` | [`Coords3`](modules.md#coords3) |

___

### LightOperations

Ƭ **LightOperations**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `floods` | \{ `blue`: [`LightNode`](modules.md#lightnode)[] ; `green`: [`LightNode`](modules.md#lightnode)[] ; `red`: [`LightNode`](modules.md#lightnode)[] ; `sunlight`: [`LightNode`](modules.md#lightnode)[]  } |
| `floods.blue` | [`LightNode`](modules.md#lightnode)[] |
| `floods.green` | [`LightNode`](modules.md#lightnode)[] |
| `floods.red` | [`LightNode`](modules.md#lightnode)[] |
| `floods.sunlight` | [`LightNode`](modules.md#lightnode)[] |
| `hasOperations` | `boolean` |
| `removals` | \{ `blue`: [`Coords3`](modules.md#coords3)[] ; `green`: [`Coords3`](modules.md#coords3)[] ; `red`: [`Coords3`](modules.md#coords3)[] ; `sunlight`: [`Coords3`](modules.md#coords3)[]  } |
| `removals.blue` | [`Coords3`](modules.md#coords3)[] |
| `removals.green` | [`Coords3`](modules.md#coords3)[] |
| `removals.red` | [`Coords3`](modules.md#coords3)[] |
| `removals.sunlight` | [`Coords3`](modules.md#coords3)[] |

___

### LightShinedOptions

Ƭ **LightShinedOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `lerpFactor` | `number` | The lerping factor of the brightness of each mesh. Defaults to `0.1`. |
| `maxBrightness` | `number` | The maximum brightness cap for the light effect. Defaults to `2.5`. |

___

### LightWorkerModifiedChunk

Ƭ **LightWorkerModifiedChunk**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](modules.md#coords2) |
| `lights` | `Uint32Array` |
| `maxY` | `number` |
| `minY` | `number` |

___

### LightWorkerResult

Ƭ **LightWorkerResult**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `appliedDeltas` | \{ `lastSequenceId`: `number`  } |
| `appliedDeltas.lastSequenceId` | `number` |
| `jobId` | `string` |
| `modifiedChunks` | [`LightWorkerModifiedChunk`](modules.md#lightworkermodifiedchunk)[] |

___

### MemoryPressureOptions

Ƭ **MemoryPressureOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `recoveryHeapRatio` | `number` | Ratio at or below which pressure is considered relieved. Kept under [MemoryPressureOptions.sheddingHeapRatio](modules.md#sheddingheapratio) so the monitor has hysteresis instead of flapping around a single threshold. |
| `sampleIntervalMs` | `number` | Milliseconds between heap samples. Zero or less disables the watchdog. |
| `shedCooldownMs` | `number` | Minimum milliseconds between two shed actions while pressure persists. |
| `sheddingHeapRatio` | `number` | `usedJSHeapSize / jsHeapSizeLimit` at or above which the renderer is treated as under pressure and load shedding begins. A worker that runs out of V8 heap takes the whole renderer process down with it, so this sits well below the limit rather than near it. |
| `sheddingSampleCount` | `number` | Consecutive over-threshold samples required before shedding engages, so one transient spike (a large chunk batch mid-flight) does not throw away work that was about to be collected anyway. |

___

### MemoryPressureStatus

Ƭ **MemoryPressureStatus**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `heapLimitBytes` | `number` | - |
| `heapRatio` | `number` | - |
| `heapUsedBytes` | `number` | - |
| `isHeapReadable` | `boolean` | False on engines that expose no heap numbers; the monitor stays inert. |
| `isUnderPressure` | `boolean` | - |
| `shedCount` | `number` | - |

___

### MemoryPressureVerdict

Ƭ **MemoryPressureVerdict**: ``"steady"`` \| ``"shed"`` \| ``"relieved"``

What a sample concluded: `shed` asks the owner to drop load now,
`relieved` says pressure is over, `steady` means do nothing.

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

### MeshTransferBenchmarkIteration

Ƭ **MeshTransferBenchmarkIteration**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `inputBytes` | `number` |
| `outputBytes` | `number` |
| `serializeMs` | `number` |
| `totalMs` | `number` |
| `workerMs` | `number` |

___

### MeshTransferBenchmarkModeResult

Ƭ **MeshTransferBenchmarkModeResult**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `avgSerializeMs` | `number` |
| `avgTotalMs` | `number` |
| `avgWorkerMs` | `number` |
| `isSharedArrayBufferAvailable` | `boolean` |
| `iterations` | [`MeshTransferBenchmarkIteration`](modules.md#meshtransferbenchmarkiteration)[] |
| `measuredIterations` | `number` |
| `p50TotalMs` | `number` |
| `p95TotalMs` | `number` |
| `strategy` | [`WorkerTransferStrategy`](modules.md#workertransferstrategy) |
| `totalInputBytes` | `number` |
| `totalOutputBytes` | `number` |
| `warmupIterations` | `number` |

___

### MeshTransferBenchmarkOptions

Ƭ **MeshTransferBenchmarkOptions**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level?` | `number` |
| `measuredIterations?` | `number` |
| `warmupIterations?` | `number` |

___

### MeshTransferBenchmarkResult

Ƭ **MeshTransferBenchmarkResult**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `serializeSpeedup` | `number` |
| `shared` | [`MeshTransferBenchmarkModeResult`](modules.md#meshtransferbenchmarkmoderesult) |
| `speedup` | `number` |
| `transfer` | [`MeshTransferBenchmarkModeResult`](modules.md#meshtransferbenchmarkmoderesult) |

___

### MeshTransferDispatch

Ƭ **MeshTransferDispatch**: (`cx`: `number`, `cz`: `number`, `level`: `number`) => `Promise`\<\{ `geometries`: `object`[] ; `inputBytes`: `number` ; `outputBytes`: `number` ; `serializeMs`: `number` ; `workerMs`: `number`  } \| ``null``\>

#### Type declaration

▸ (`cx`, `cz`, `level`): `Promise`\<\{ `geometries`: `object`[] ; `inputBytes`: `number` ; `outputBytes`: `number` ; `serializeMs`: `number` ; `workerMs`: `number`  } \| ``null``\>

##### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

##### Returns

`Promise`\<\{ `geometries`: `object`[] ; `inputBytes`: `number` ; `outputBytes`: `number` ; `serializeMs`: `number` ; `workerMs`: `number`  } \| ``null``\>

___

### MeshWorkerTransferSample

Ƭ **MeshWorkerTransferSample**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `at` | `number` |
| `inputBytes` | `number` |
| `outputBytes` | `number` |
| `serializeMs` | `number` |
| `strategy` | [`WorkerTransferStrategy`](modules.md#workertransferstrategy) |
| `totalMs` | `number` |
| `workerMs` | `number` |

___

### MeshWorkerTransferStats

Ƭ **MeshWorkerTransferStats**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `jobCount` | `number` |
| `recentSamples` | [`MeshWorkerTransferSample`](modules.md#meshworkertransfersample)[] |
| `strategy` | [`WorkerTransferStrategy`](modules.md#workertransferstrategy) |
| `totalInputBytes` | `number` |
| `totalOutputBytes` | `number` |
| `totalSerializeMs` | `number` |
| `totalWorkerMs` | `number` |

___

### NameTagOptions

Ƭ **NameTagOptions**: `Object`

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

### NetworkConnectionOptions

Ƭ **NetworkConnectionOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `reconnectTimeout?` | `number` | Milliseconds between reconnection attempts after the socket drops. Defaults to DEFAULT_RECONNECT_TIMEOUT_MS; pass 0 to disable automatic reconnection. |
| `secret?` | `string` | - |
| `useWebRTC?` | `boolean` | - |

___

### NetworkOptions

Ƭ **NetworkOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `joinRetryTimeout` | `number` | Milliseconds a (re)join handshake may await its INIT before the join request is sent again. |
| `maxBacklogFactor` | `number` | - |
| `maxPacketsPerTick` | `number` | - |
| `maxQueuedPackets` | `number` | Upper bound on buffered inbound packets. Beyond it the oldest packets are dropped: the interest/keep-alive protocol re-converges on fresh state, so bounded loss beats unbounded memory growth when processing stalls. |

___

### PartialRecord

Ƭ **PartialRecord**\<`K`, `T`\>: \{ [P in K]?: T }

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof `any` |
| `T` | `T` |

___

### PeersOptions

Ƭ **PeersOptions**: `Object`

Parameters to customize the peers manager.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `autoAddToSelf` | `boolean` | - |
| `countSelf` | `boolean` | Whether or not should the client themselves be counted as "updated". In other words, whether or not should the update function be called on the client's own data. Defaults to `false`. |
| `updateChildren` | `boolean` | Whether or not should the peers manager automatically call `update` on any children mesh. Defaults to `true`. |

___

### PerspectiveOptions

Ƭ **PerspectiveOptions**: `Object`

Parameters to create a new [Perspective](classes/Perspective.md) instance.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `blockMargin` | `number` | The margin between the camera and any block that the camera is colliding with. This prevents the camera from clipping into blocks. Defaults to `0.3`. |
| `ignoreFluids` | `boolean` | Whether or not should the camera ignore fluid block collisions. Defaults to `true`. |
| `ignoreSeeThrough` | `boolean` | Whether or not should the camera ignore see-through block collisions. Defaults to `true`. |
| `lerpFactor` | `number` | The lerping factor for the camera's position. Defaults to `0.5`. |
| `maxDistance` | `number` | The maximum distance the camera can go from the player's center. Defaults to `5`. |
| `swimDistanceBonus` | `number` | Extra camera distance while swimming in second/third person. Defaults to `3`. |

___

### PortraitOptions

Ƭ **PortraitOptions**: `Object`

Parameters to create a portrait with.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `height` | `number` | The height of the portrait canvas. Defaults to `100` pixels. |
| `lightRotationOffset` | `number` | The rotation around the y axis about the camera. This is used to calculate the position of the light. Defaults to `-Math.PI / 8`. |
| `perspective` | [`CameraPerspective`](modules.md#cameraperspective) | The position of where the camera should be looking at. Defaults to `pxyz`, which means that the camera will be looking at the center of the object from the positive x, y, and z axis scaled by the zoom. |
| `renderOnce` | `boolean` | Whether or not should this portrait only render once. Defaults to `false`. |
| `width` | `number` | The width of the portrait canvas. Defaults to `100` pixels. |
| `zoom` | `number` | The arbitrary zoom from the camera to the object. This is used to calculate the zoom of the camera. Defaults to `1`. |

___

### ProcessedUpdate

Ƭ **ProcessedUpdate**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `newBlock` | [`Block`](modules.md#block) |
| `newId` | `number` |
| `newRotation` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldBlock` | [`Block`](modules.md#block) |
| `oldId` | `number` |
| `oldRotation` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldStage` | `number` |
| `stage` | `number` |
| `voxel` | [`Coords3`](modules.md#coords3) |

___

### ProtocolWS

Ƭ **ProtocolWS**: `WebSocket` & \{ `sendEvent`: (`event`: `any`) => `void`  }

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

### RigidControlsOptions

Ƭ **RigidControlsOptions**: `Object`

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
| `crouchBodyHeight` | `number` | The height of the client's avatar when crouching. Defaults to `bodyHeight * 0.83`. |
| `crouchFactor` | `number` | The factor to the movement speed when crouch is applied. Defaults to `0.6`. |
| `eyeHeight` | `number` | The ratio to `bodyHeight` at which the camera is placed from the ground. Defaults at `0.9193548387096774`. |
| `fluidPushForce` | `number` | The force upwards when a client tries to jump in water. Defaults to `0.3`. |
| `flyClimbSpeedPenalty` | `number` | Fraction of fly speed lost at a straight-up climb when pitch steering is active, trading speed for altitude. Defaults to `0`. |
| `flyDiveSpeedBoost` | `number` | Extra speed multiplier granted at a straight-down dive when pitch steering is active. `1.2` means a vertical dive flies at `2.2x` the base fly speed. Scales quadratically with dive steepness. Defaults to `0`. |
| `flyForce` | `number` | The level of force at which a client flies at. Defaults to `80`. |
| `flyImpulse` | `number` | The level impulse of which a client flies at. Defaults to `2.5`. |
| `flyInertia` | `number` | The inertia of a client when they're flying. Defaults to `6`. |
| `flyPitchSteering` | `number` | How much the camera pitch steers fly movement, from `0` (movement stays horizontal) to `1` (movement follows the full look vector, elytra-style). Defaults to `0`. |
| `flySpeed` | `number` | The level of speed at which a client flies at. Defaults to `40`. |
| `initialDirection` | [`Coords3`](modules.md#coords3) | - |
| `initialPosition` | [`Coords3`](modules.md#coords3) | Initial position of the client. Defaults to `(0, 80, 10)`. |
| `jumpForce` | `number` | The level of force applied to the client when jumping. Defaults to `1`. |
| `jumpImpulse` | `number` | The level of impulse at which the client jumps upwards. Defaults to `8`. |
| `jumpTime` | `number` | The time, in milliseconds, that a client can be jumping. Defaults to `50`ms. |
| `maxPolarAngle` | `number` | Maximum polar angle that camera can look up to. Defaults to `Math.PI * 0.99` |
| `maxSpeed` | `number` | The maximum level of speed of a client. Default is `6` . |
| `minPolarAngle` | `number` | Minimum polar angle that camera can look down to. Defaults to `Math.PI * 0.01`. |
| `moveForce` | `number` | The level of force of which the client can move at. Default is `30`. |
| `positionLerp` | `number` | The interpolation factor of the client's position. Defaults to `1.0`. |
| `responsiveness` | `number` | The level of responsiveness of a client to movements. Default is `240`. |
| `restoreFootSnapEpsilon` | `number` | - |
| `rotationLerp` | `number` | The interpolation factor of the client's rotation. Defaults to `0.9`. |
| `runningFriction` | `number` | Default running friction of a client. Defaults to `0.1`. |
| `sensitivity` | `number` | The mouse sensitivity. Defaults to `100`. |
| `sprintFactor` | `number` | The factor to the movement speed when sprint is applied. Defaults to `1.4`. |
| `standingFriction` | `number` | Default standing friction of a client. Defaults to `4`. |
| `stepHeight` | `number` | How tall a client can step up. Defaults to `0.5`. |
| `stepLerp` | `number` | The interpolation factor when the client is auto-stepping. Defaults to `0.6`. |
| `swimAABBLerp` | `number` | Lerp factor for the swim hitbox height transition. Defaults to `0.08`. |
| `swimBodyHeight` | `number` | Collision height while swimming. Defaults to `0.4`. |
| `swimForce` | `number` | Force applied while swimming. Defaults to `28`. |
| `swimFriction` | `number` | Friction while swimming and moving. Defaults to `0.05`. |
| `swimIdleStandDelay` | `number` | Time without swim movement input before returning to an upright pose. Defaults to `3000`. |
| `swimRestoreGraceFrames` | `number` | Frames to keep the swim AABB after restoring a saved swimming session. Defaults to `2`. |
| `swimSpeed` | `number` | Target speed while swimming. Defaults to `4.5`. |
| `swimSubmersionRatio` | `number` | Minimum ratio of the body submerged before swimming mechanics activate. Defaults to `0.95`. |

___

### SkyOptions

Ƭ **SkyOptions**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `dimension` | `number` | The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension. |
| `lerpFactor` | `number` | The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color. set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods. |
| `textureBloomIntensity` | `number` | The emissive boost applied to painted sky texels above `textureBloomThreshold`. Defaults to `2.0`. |
| `textureBloomThreshold` | `number` | The luminance at which painted sky textures begin to feed bloom. Defaults to `0.72`. |
| `transitionSpan` | `number` | - |

___

### SkyShadingCycleData

Ƭ **SkyShadingCycleData**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `color` | \{ `bottom`: `Color` \| `string` ; `middle`: `Color` \| `string` ; `top`: `Color` \| `string`  } |
| `color.bottom` | `Color` \| `string` |
| `color.middle` | `Color` \| `string` |
| `color.top` | `Color` \| `string` |
| `name` | `string` |
| `skyOffset` | `number` |
| `start` | `number` |
| `voidOffset` | `number` |

___

### SlotContent

Ƭ **SlotContent**: \{ `type`: ``"empty"``  } \| \{ `count`: `number` ; `id`: `number` ; `type`: ``"block"``  } \| \{ `count`: `number` ; `data?`: `Record`\<`string`, `unknown`\> ; `id`: `number` ; `type`: ``"item"``  }

___

### SoundEffectEventHandler

Ƭ **SoundEffectEventHandler**: (`payload`: [`SoundEffectEventPayload`](modules.md#soundeffecteventpayload)) => `void`

#### Type declaration

▸ (`payload`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | [`SoundEffectEventPayload`](modules.md#soundeffecteventpayload) |

##### Returns

`void`

___

### SoundEffectEventPayload

Ƭ **SoundEffectEventPayload**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `pitch?` | `number` |
| `position?` | [`number`, `number`, `number`] |
| `radius?` | `number` |
| `sourceClientId?` | `string` |
| `volume?` | `number` |

___

### TabCompleteContext

Ƭ **TabCompleteContext**: `Object`

Options for adding a command.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `args` | `Record`\<`string`, `string`\> |

___

### TargetType

Ƭ **TargetType**: ``"All"`` \| ``"Player"`` \| ``"Entity"``

___

### TextureInfo

Ƭ **TextureInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `blockId` | `number` |
| `blockName` | `string` |
| `canvas` | `HTMLCanvasElement` \| ``null`` |
| `faceName` | `string` |
| `materialKey` | `string` |
| `range` | [`UV`](modules.md#uv) \| ``null`` |
| `type` | ``"shared"`` \| ``"independent"`` \| ``"isolated"`` |

___

### UV

Ƭ **UV**: `Object`

The UV range of a texture on the texture atlas.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `endU` | `number` | The ending U coordinate of the texture. |
| `endV` | `number` | The ending V coordinate of the texture. |
| `startU` | `number` | The starting U coordinate of the texture. |
| `startV` | `number` | The starting V coordinate of the texture. |

___

### VoxelDelta

Ƭ **VoxelDelta**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords3`](modules.md#coords3) |
| `newRotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `newStage?` | `number` |
| `newVoxel` | `number` |
| `oldRotation?` | [`BlockRotation`](classes/BlockRotation.md) |
| `oldStage?` | `number` |
| `oldVoxel` | `number` |
| `sequenceId` | `number` |
| `timestamp` | `number` |

___

### VoxelInteractOptions

Ƭ **VoxelInteractOptions**: `Object`

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
| `potentialVisuals` | `boolean` | **`Debug`** Whether or not should there be arrows indicating the potential block placement's orientations. Defaults to `false`. |
| `reachDistance` | `number` | The maximum distance of reach for the [VoxelInteract](classes/VoxelInteract.md) instance. Defaults to `32`. |

___

### WaterChannelCoefficients

Ƭ **WaterChannelCoefficients**: `Object`

Per-channel coefficients for Beer-Lambert water extinction, expressed per
block (~meter) of water. All water rendering derives from this one table.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `blue` | `number` |
| `green` | `number` |
| `red` | `number` |

___

### WaterColumnSample

Ƭ **WaterColumnSample**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `depth` | `number` |
| `surfaceY` | `number` |

___

### WaterOpticsFrameInput

Ƭ **WaterOpticsFrameInput**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `cameraX` | `number` |
| `cameraY` | `number` |
| `cameraZ` | `number` |
| `deltaSeconds` | `number` |
| `isFluidAt` | [`FluidQuery`](modules.md#fluidquery) |
| `sunStrength` | `number` |

___

### WorkerPoolJob

Ƭ **WorkerPoolJob**: `Object`

A worker pool job is queued to a worker pool and is executed by a worker.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `buffers?` | `Transferable`[] | Any array buffers (transferable) that are passed to the worker. |
| `message` | `any` | A JSON serializable object that is passed to the worker. |
| `resolve` | (`value`: `any`) => `void` | - |
| `timeoutMs?` | `number` | Milliseconds this job may run before its worker is presumed dead. A worker that OOMs mid-job dies without any error event, which used to leave the slot occupied and the job unresolved forever (frozen lighting/meshing). On timeout the worker is replaced and the job resolves `null`. |

___

### WorkerPoolOptions

Ƭ **WorkerPoolOptions**: `Object`

Parameters to create a worker pool.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `maxQueuedJobs?` | `number` | Jobs allowed to wait for a free worker before the oldest are shed (resolved `null`, exactly like a dead worker). Left undefined the queue is unbounded, which is only safe when the caller gates dispatch on [WorkerPool.availableCount](classes/WorkerPool.md#availablecount): every queued job holds its serialized payload alive, so a caller that enqueues faster than workers drain turns the queue into an unbounded allocation. Opt in only from callers that treat a `null` result as a retryable failure. |
| `maxWorker` | `number` | The maximum number of workers to create. Defaults to `8`. |
| `name?` | `string` | The name prefix for workers in this pool. Workers will be named `{name}-0`, `{name}-1`, etc. Shows up in DevTools for debugging. |

___

### WorkerTransferConfig

Ƭ **WorkerTransferConfig**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `maxRecentSamples` | `number` |
| `mode` | [`WorkerTransferMode`](modules.md#workertransfermode) |

___

### WorkerTransferMode

Ƭ **WorkerTransferMode**: ``"auto"`` \| [`WorkerTransferStrategy`](modules.md#workertransferstrategy)

___

### WorkerTransferStrategy

Ƭ **WorkerTransferStrategy**: ``"transfer"`` \| ``"shared"``

___

### WorldChunkEvents

Ƭ **WorldChunkEvents**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `chunk-data-loaded` | (`data`: [`ChunkDataEventData`](modules.md#chunkdataeventdata)) => `void` |
| `chunk-loaded` | (`data`: [`ChunkEventData`](modules.md#chunkeventdata)) => `void` |
| `chunk-mesh-loaded` | (`data`: [`ChunkMeshEventData`](modules.md#chunkmesheventdata)) => `void` |
| `chunk-mesh-unloaded` | (`data`: [`ChunkMeshEventData`](modules.md#chunkmesheventdata)) => `void` |
| `chunk-mesh-updated` | (`data`: [`ChunkMeshUpdateEventData`](modules.md#chunkmeshupdateeventdata)) => `void` |
| `chunk-unloaded` | (`data`: [`ChunkEventData`](modules.md#chunkeventdata)) => `void` |
| `chunk-updated` | (`data`: [`ChunkUpdateEventData`](modules.md#chunkupdateeventdata)) => `void` |

___

### WorldClientOptions

Ƭ **WorldClientOptions**: `Object`

The client-side options to create a world. These are client-side only and can be customized to specific use.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `chunkLoadExponent` | `number` | The exponent applied to the ratio that chunks are loaded, which would then be used to determine whether an angle to a chunk is worth loading. Defaults to `8`. |
| `chunkRerequestInterval` | `number` | The interval between each time a chunk is re-requested to the server. Defaults to `300` updates. |
| `chunkUniformsOverwrite` | `Partial`\<[`ChunkRenderer`](classes/ChunkRenderer.md)[``"uniforms"``]\> | The uniforms to overwrite the default chunk material uniforms. Defaults to `{}`. |
| `clientOnlyMeshing` | `boolean` | Whether to use client-only meshing. When true, chunks are always meshed locally. When false, server-provided meshes are used for initial chunk load. Defaults to `true`. |
| `cloudsOptions` | `Partial`\<[`CloudsOptions`](modules.md#cloudsoptions)\> | The options to create the clouds. Defaults to `{}`. |
| `defaultRenderRadius` | `number` | The default render radius of the world, in chunks. Change this through `world.renderRadius`. Defaults to `8` chunks. |
| `deltaRetentionTime` | `number` | How long to retain delta history in milliseconds. Defaults to 5000ms. |
| `fogFarRenderRatio` | `number` | Fraction of render distance where horizon fog fully hides terrain. Defaults to `0.78`. |
| `fogNearRenderRatio` | `number` | Fraction of render distance where horizon fog starts. Defaults to `0.45`. |
| `lightJobRetryLimit` | `number` | Maximum number of retries for stale light jobs before falling back to sync. Defaults to 3. |
| `lightJobTimeoutMs` | `number` | Milliseconds a light worker job may run before its worker is presumed dead (an OOMed worker dies without any error event) and replaced. Defaults to `20000`. |
| `maxChunkRequestsPerUpdate` | `number` | The maximum chunk requests this world can request from the server per world update. Defaults to `12` chunks. |
| `maxImmediateServerUpdates` | `number` | Server update batches larger than this are drained through the incremental per-frame update queue instead of being applied (and relit) synchronously in one shot. Defaults to `500` updates. |
| `maxLightWorkers` | `number` | Maximum concurrent light workers. Defaults to 2. |
| `maxLightsUpdateTime` | `number` | - |
| `maxMeshesPerUpdate` | `number` | - |
| `maxOptimisticClientUpdates` | `number` | Client batches larger than this skip the optimistic local apply (with its per-frame relight) and stream straight to the server; the world catches up from the server's tick-batched echo. Keeps bulk edits (WorldEdit) from freezing the tab and guarantees the whole batch is on the wire before any reload. Defaults to `4000` updates. |
| `maxProcessesPerUpdate` | `number` | The maximum amount of chunks received from the server that can be processed per world update. By process, it means to be turned into a `Chunk` instance. Defaults to `8` chunks. |
| `maxQueuedWorkerJobs` | `number` | Jobs allowed to wait for a free mesh or light worker before the oldest are shed. Dispatch is already gated on free worker slots, so this is the backstop that keeps a future caller from parking unbounded serialized chunk payloads in a pool queue. Defaults to `8`. |
| `maxUpdatesPerUpdate` | `number` | The maximum voxel updates that can be sent to the server per world update. Defaults to `1000` updates. |
| `maxUrgentMeshWorkers` | `number` | Dedicated mesh workers reserved for client-originated voxel edits. |
| `maxVoxelHistoryPerVoxel` | `number` | Previous values retained per voxel. Defaults to `4`. |
| `maxVoxelHistoryVoxels` | `number` | Distinct voxels tracked by [World.getPreviousValueAt](classes/World.md#getpreviousvalueat). The history is a debugging convenience, not gameplay state, so it evicts oldest-first instead of growing with every voxel a session ever edits. Defaults to `4096`. |
| `memoryPressure` | `Partial`\<[`MemoryPressureOptions`](modules.md#memorypressureoptions)\> | Renderer heap watchdog thresholds. See [MemoryPressureOptions](modules.md#memorypressureoptions). |
| `mergeChunkGeometries` | `boolean` | Whether to merge chunk geometries to reduce draw calls. Useful for mobile. Defaults to false. |
| `meshJobTimeoutMs` | `number` | Milliseconds a mesh worker job may run before its worker is presumed dead and replaced. Defaults to `30000`. |
| `minLightLevel` | `number` | The minimum light level even when sunlight and torch light levels are at zero. Defaults to `0.04`. |
| `skyOptions` | `Partial`\<[`SkyOptions`](modules.md#skyoptions)\> | The options to create the sky. Defaults to `{}`. |
| `statsSyncInterval` | `number` | The interval between each time the world requests the server for its stats. Defaults to 500ms. |
| `sunlightChangeSpan` | `number` | The fraction of the day that sunlight takes to change from appearing to disappearing or disappearing to appearing. Defaults to `0.1`. |
| `sunlightEndTimeFrac` | `number` | The fraction of the day that sunlight starts to disappear. Defaults to `0.7`. |
| `sunlightStartTimeFrac` | `number` | The fraction of the day that sunlight starts to appear. Defaults to `0.25`. |
| `textureUnitDimension` | `number` | The default dimension to a single unit of a block face texture. If any texture loaded is greater, it will be downscaled to this resolution. Defaults to `8` pixels. |
| `timeForceThreshold` | `number` | The threshold to force the server's time to the client's time. Defaults to `0.1`. |
| `useLightWorkers` | `boolean` | Whether to use web workers for light calculations. Defaults to true. |

___

### WorldFogRange

Ƭ **WorldFogRange**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `far` | `number` |
| `near` | `number` |

___

### WorldMemoryCounters

Ƭ **WorldMemoryCounters**: `Object`

A snapshot of every queue and in-flight set in the voxel update ->
relight -> remesh pipeline. See [World.getMemoryCounters](classes/World.md#getmemorycounters).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `activeLightBatchPendingJobs` | `number` |
| `activeLightBatchUndispatchedJobs` | `number` |
| `blockUpdatesQueue` | `number` |
| `blockUpdatesToEmit` | `number` |
| `lightJobHighWaterChunks` | `number` |
| `lightJobQueue` | `number` |
| `lightQueue` | `number` |
| `lightQueuedBytes` | `number` |
| `lightWorking` | `number` |
| `loadedChunks` | `number` |
| `memoryPressure` | [`MemoryPressureStatus`](modules.md#memorypressurestatus) |
| `meshDirtyKeys` | `number` |
| `meshInFlightJobs` | `number` |
| `meshQueue` | `number` |
| `meshQueuedBytes` | `number` |
| `meshWorking` | `number` |
| `urgentMeshQueue` | `number` |
| `urgentMeshQueuedBytes` | `number` |
| `urgentMeshWorking` | `number` |
| `voxelDeltaChunks` | `number` |
| `voxelDeltaTotal` | `number` |
| `voxelHistoryVoxels` | `number` |

___

### WorldOptions

Ƭ **WorldOptions**: [`WorldClientOptions`](modules.md#worldclientoptions) & [`WorldServerOptions`](modules.md#worldserveroptions)

The options to create a world. This consists of [WorldClientOptions](modules.md#worldclientoptions) and [WorldServerOptions](modules.md#worldserveroptions).

___

### WorldServerOptions

Ƭ **WorldServerOptions**: `Object`

The options defined on the server-side, passed to the client on network joining.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `airDrag` | `number` | The air drag of everything physical. |
| `chunkSize` | `number` | The width and depth of a chunk, in blocks. |
| `doesTickTime` | `boolean` | - |
| `fluidDensity` | `number` | The density of the fluid in this world. |
| `fluidDrag` | `number` | The fluid drag of everything physical. |
| `gravity` | `number`[] | The gravity of everything physical in this world. |
| `maxChunk` | [`number`, `number`] | The maximum chunk coordinate of this world, inclusive. |
| `maxHeight` | `number` | The height of a chunk, in blocks. |
| `maxLightLevel` | `number` | The maximum light level that propagates in this world, including sunlight and torch light. |
| `minBounceImpulse` | `number` | The minimum bouncing impulse of everything physical in this world. |
| `minChunk` | [`number`, `number`] | The minimum chunk coordinate of this world, inclusive. |
| `subChunks` | `number` | The number of sub-chunks that divides a chunk vertically. |
| `timePerDay` | `number` | The time per day in seconds. |
| `waterLevel` | `number` | The nominal water level of this world, in blocks. |

## Variables

### ABOVE\_SURFACE\_WATER\_FOG\_FRAGMENT

• `Const` **ABOVE\_SURFACE\_WATER\_FOG\_FRAGMENT**: `string`

The above-surface counterpart of [UNDERWATER_FOG_FRAGMENT](modules.md#underwater_fog_fragment): the same
Beer-Lambert in-scattering fog, but for water-exposed terrain seen from
outside the surface. It fades a submerged fragment toward the water's own
in-scattered color along the sub-surface segment of the view ray, so deep
or steeply-viewed bottoms go murky while shallow water stays readable —
reusing [WATER_VIEW_EXTINCTION](modules.md#water_view_extinction) and `uUnderwaterAmbient` so the view
from above matches the view from below.

Expects `outgoingLight`, `vWorldPosition`, `cameraPosition`, `uWaterLevel`,
`uCameraSubmersion`, `uUnderwaterAmbient`, and a `vWaterExposed` varying
(1.0 on faces in contact with fluid) in scope. `uWaterLevel` stands in for
the surface plane, matching the global waterline the rest of the chunk
shader assumes. Runs before sky/height fog so nearer air fog layers on top.

___

### BLUE\_LIGHT

• `Const` **BLUE\_LIGHT**: ``"BLUE"``

The string representation of blue light.

___

### BOX\_SIDES

• `Const` **BOX\_SIDES**: [`BoxSides`](modules.md#boxsides)[]

The six default faces of a canvas box.

___

### DEFAULT\_BLOCK\_MAX\_STACK

• `Const` **DEFAULT\_BLOCK\_MAX\_STACK**: ``64``

___

### ENTITY\_SHADOW\_FRAGMENT\_PARS

• `Const` **ENTITY\_SHADOW\_FRAGMENT\_PARS**: ``"\nuniform sampler2D uShadowMap0;\nuniform sampler2D uShadowMap1;\nuniform sampler2D uShadowMap2;\nuniform float uCascadeSplit0;\nuniform float uCascadeSplit1;\nuniform float uCascadeSplit2;\nuniform float uShadowBias;\nuniform float uShadowNormalBias;\nuniform float uShadowStrength;\nuniform float uSunlightIntensity;\nuniform vec3 uSunDirection;\nuniform vec3 uSunColor;\nuniform float uMinOccluderDepth;\n\nvarying vec4 vShadowCoord0;\nvarying vec4 vShadowCoord1;\nvarying vec4 vShadowCoord2;\nvarying float vViewDepth;\n\n\nconst vec2 SHADOW_POISSON_DISK[8] = vec2[8](\n  vec2(-0.94201624, -0.39906216),\n  vec2(0.94558609, -0.76890725),\n  vec2(-0.094184101, -0.92938870),\n  vec2(0.34495938, 0.29387760),\n  vec2(-0.91588581, 0.45771432),\n  vec2(-0.81544232, -0.87912464),\n  vec2(0.97484398, 0.75648379),\n  vec2(0.44323325, -0.97511554)\n);\n\n\n\nfloat shadowMapEdgeFade(vec3 coord) {\n  float fadeWidth = 0.08;\n  float fx = smoothstep(0.0, fadeWidth, coord.x) * smoothstep(0.0, fadeWidth, 1.0 - coord.x);\n  float fy = smoothstep(0.0, fadeWidth, coord.y) * smoothstep(0.0, fadeWidth, 1.0 - coord.y);\n  return fx * fy;\n}\n\nfloat sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;\n\n  shadow /= 5.0;\n  return mix(1.0, shadow, shadowMapEdgeFade(coord));\n}\n\nfloat sampleShadowMapPCSS(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float blockerSum = 0.0;\n  float blockerCount = 0.0;\n  float searchRadius = 3.0;\n  for (int i = 0; i < 4; i++) {\n    vec2 offset = SHADOW_POISSON_DISK[i * 2] * texelSize * searchRadius;\n    float sampleDepth = texture(shadowMap, coord.xy + offset).r;\n    float blockerDiff = coord.z - sampleDepth;\n    if (blockerDiff > bias && blockerDiff >= uMinOccluderDepth) {\n      blockerSum += sampleDepth;\n      blockerCount += 1.0;\n    }\n  }\n\n  if (blockerCount < 0.5) {\n    return 1.0;\n  }\n\n  float avgBlockerDepth = blockerSum / blockerCount;\n  float penumbraSize = (coord.z - avgBlockerDepth) / avgBlockerDepth;\n  float filterRadius = clamp(penumbraSize * 2.0, 1.0, 3.0);\n\n  float spatialNoise = fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n  float angle = spatialNoise * 6.283185;\n  float s = sin(angle);\n  float c = cos(angle);\n  mat2 rotation = mat2(c, -s, s, c);\n\n  float centerDepth = texture(shadowMap, coord.xy).r;\n  float centerDiff = coord.z - centerDepth;\n  float shadow = (centerDiff > bias && centerDiff >= uMinOccluderDepth) ? 0.0 : 1.0;\n  for (int i = 0; i < 8; i++) {\n    vec2 offset = rotation * SHADOW_POISSON_DISK[i] * texelSize * filterRadius;\n    float depth = texture(shadowMap, coord.xy + offset).r;\n    float depthDiff = coord.z - depth;\n    shadow += (depthDiff > bias && depthDiff >= uMinOccluderDepth) ? 0.0 : 1.0;\n  }\n\n  shadow /= 9.0;\n  return mix(1.0, shadow, shadowMapEdgeFade(coord));\n}\n\n\nfloat getEntityShadow(vec3 worldNormal) {\n  float effectiveStrength = uShadowStrength * uSunlightIntensity;\n  \n  if (effectiveStrength < 0.01) {\n    return 1.0;\n  }\n\n  float cosTheta = clamp(dot(worldNormal, uSunDirection), 0.0, 1.0);\n  float bias = uShadowBias + uShadowNormalBias * (1.0 - cosTheta);\n\n  float rawShadow = sampleShadowMapPCSS(uShadowMap0, vShadowCoord0, bias);\n\n  float maxEntityDist = uCascadeSplit1;\n  if (vViewDepth > maxEntityDist) {\n    return 1.0;\n  }\n  float fadeStart = maxEntityDist * 0.7;\n  if (vViewDepth > fadeStart) {\n    float t = (vViewDepth - fadeStart) / (maxEntityDist - fadeStart);\n    rawShadow = mix(rawShadow, 1.0, t);\n  }\n\n  float shadow = mix(1.0, rawShadow, effectiveStrength * 0.65);\n  return max(shadow, 0.6);\n}\n"``

___

### ENTITY\_SHADOW\_VERTEX\_MAIN

• `Const` **ENTITY\_SHADOW\_VERTEX\_MAIN**: ``"\nvec4 shadowWorldPos = vec4(worldPosition.xyz + uWorldOffset, 1.0);\nvShadowCoord0 = uShadowMatrix0 * shadowWorldPos;\nvShadowCoord1 = uShadowMatrix1 * shadowWorldPos;\nvShadowCoord2 = uShadowMatrix2 * shadowWorldPos;\nvec4 viewPos = viewMatrix * vec4(worldPosition.xyz, 1.0);\nvViewDepth = -viewPos.z;\n"``

___

### ENTITY\_SHADOW\_VERTEX\_PARS

• `Const` **ENTITY\_SHADOW\_VERTEX\_PARS**: ``"\nuniform mat4 uShadowMatrix0;\nuniform mat4 uShadowMatrix1;\nuniform mat4 uShadowMatrix2;\nuniform vec3 uWorldOffset;\n\nvarying vec4 vShadowCoord0;\nvarying vec4 vShadowCoord1;\nvarying vec4 vShadowCoord2;\nvarying float vViewDepth;\n"``

___

### GREEN\_LIGHT

• `Const` **GREEN\_LIGHT**: ``"GREEN"``

The string representation of green light.

___

### LIGHT\_CONES

• `Const` **LIGHT\_CONES**: `Readonly`\<\{ `lambertWrap`: ``0.25`` = 0.25; `maxCones`: ``3`` = 3; `minCosDelta`: ``0.001`` = 1e-3; `scatterSamples`: ``4`` = 4 }\>

Engine-side budget and falloff shaping for dynamic spot-light cones
(flashlights, vehicle headlights). The cone list is rebuilt every frame by
the game; shaders iterate a small fixed array so the cost stays flat.

___

### LIGHT\_CONES\_FUNCTIONS

• `Const` **LIGHT\_CONES\_FUNCTIONS**: `string`

Shared per-cone response: quadratic angular falloff between the inner and
outer cone, squared-quadratic distance falloff to zero at range, and
Beer-Lambert extinction from the cone origin scaled by the origin's
submersion so underwater beams die out physically while dry beams carry.

uConeOrigins[i] = (origin.xyz, submersion); uConeShapes[i] =
(cosOuter, 1/(cosInner-cosOuter), range, scatterStrength).

___

### LIGHT\_CONES\_SCATTER\_FRAGMENT

• `Const` **LIGHT\_CONES\_SCATTER\_FRAGMENT**: ``"\nif (uConeCount > 0) {\n  vec3 lcViewRay = vWorldPosition.xyz - cameraPosition;\n  float lcViewDist = max(length(lcViewRay), 1e-4);\n  gl_FragColor.rgb += lightConeScatter(cameraPosition, lcViewRay / lcViewDist, lcViewDist);\n}\n"``

Adds the in-scattered beam glow after fog. Expects `vWorldPosition`,
`cameraPosition`, and `gl_FragColor` in scope. Scatter strength is scaled
by each cone's submersion, so beams only bloom in the murk; in air the
cone remains a pure surface light.

___

### LIGHT\_CONES\_UNIFORM\_DECLARATIONS

• `Const` **LIGHT\_CONES\_UNIFORM\_DECLARATIONS**: `string`

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

### SCENE\_OVERLAY\_LAYER

• `Const` **SCENE\_OVERLAY\_LAYER**: ``30``

The dedicated render layer that all in-world overlay objects (sprite texts,
nametags, and other HUD-like scene decorations) live on. Cameras that should
display overlays must call `camera.layers.enable(SCENE_OVERLAY_LAYER)`;
disabling the layer on a camera renders a clean frame with no overlays,
which is how pure screenshots are captured.

___

### SHADER\_LIGHTING\_CHUNK\_SHADERS

• `Const` **SHADER\_LIGHTING\_CHUNK\_SHADERS**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fragment` | `string` |
| `vertex` | `string` |

___

### SHADER\_LIGHTING\_CROSS\_CHUNK\_SHADERS

• `Const` **SHADER\_LIGHTING\_CROSS\_CHUNK\_SHADERS**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fragment` | `string` |
| `vertex` | `string` |

___

### SHADER\_LIGHTING\_FLUID\_CHUNK\_SHADERS

• `Const` **SHADER\_LIGHTING\_FLUID\_CHUNK\_SHADERS**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fragment` | `string` |
| `vertex` | `string` |

___

### SHADOW\_POISSON\_DISK

• `Const` **SHADOW\_POISSON\_DISK**: ``"\nconst vec2 SHADOW_POISSON_DISK[8] = vec2[8](\n  vec2(-0.94201624, -0.39906216),\n  vec2(0.94558609, -0.76890725),\n  vec2(-0.094184101, -0.92938870),\n  vec2(0.34495938, 0.29387760),\n  vec2(-0.91588581, 0.45771432),\n  vec2(-0.81544232, -0.87912464),\n  vec2(0.97484398, 0.75648379),\n  vec2(0.44323325, -0.97511554)\n);\n"``

___

### SHADOW\_SAMPLE\_FUNCTIONS

• `Const` **SHADOW\_SAMPLE\_FUNCTIONS**: ``"\nfloat shadowMapEdgeFade(vec3 coord) {\n  float fadeWidth = 0.08;\n  float fx = smoothstep(0.0, fadeWidth, coord.x) * smoothstep(0.0, fadeWidth, 1.0 - coord.x);\n  float fy = smoothstep(0.0, fadeWidth, coord.y) * smoothstep(0.0, fadeWidth, 1.0 - coord.y);\n  return fx * fy;\n}\n\nfloat sampleShadowMapFast(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float shadow = (coord.z - bias > texture(shadowMap, coord.xy).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, -1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(-1.0, 1.0)).r) ? 0.0 : 1.0;\n  shadow += (coord.z - bias > texture(shadowMap, coord.xy + texelSize * vec2(1.0, 1.0)).r) ? 0.0 : 1.0;\n\n  shadow /= 5.0;\n  return mix(1.0, shadow, shadowMapEdgeFade(coord));\n}\n\nfloat sampleShadowMapPCSS(sampler2D shadowMap, vec4 shadowCoord, float bias) {\n  vec3 coord = shadowCoord.xyz / shadowCoord.w;\n  coord = coord * 0.5 + 0.5;\n\n  if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z < 0.0 || coord.z > 1.0) {\n    return 1.0;\n  }\n\n  vec2 texelSize = vec2(1.0) / vec2(textureSize(shadowMap, 0));\n\n  float blockerSum = 0.0;\n  float blockerCount = 0.0;\n  float searchRadius = 3.0;\n  for (int i = 0; i < 4; i++) {\n    vec2 offset = SHADOW_POISSON_DISK[i * 2] * texelSize * searchRadius;\n    float sampleDepth = texture(shadowMap, coord.xy + offset).r;\n    float blockerDiff = coord.z - sampleDepth;\n    if (blockerDiff > bias && blockerDiff >= uMinOccluderDepth) {\n      blockerSum += sampleDepth;\n      blockerCount += 1.0;\n    }\n  }\n\n  if (blockerCount < 0.5) {\n    return 1.0;\n  }\n\n  float avgBlockerDepth = blockerSum / blockerCount;\n  float penumbraSize = (coord.z - avgBlockerDepth) / avgBlockerDepth;\n  float filterRadius = clamp(penumbraSize * 2.0, 1.0, 3.0);\n\n  float spatialNoise = fract(sin(dot(coord.xy, vec2(12.9898, 78.233))) * 43758.5453);\n  float angle = spatialNoise * 6.283185;\n  float s = sin(angle);\n  float c = cos(angle);\n  mat2 rotation = mat2(c, -s, s, c);\n\n  float centerDepth = texture(shadowMap, coord.xy).r;\n  float centerDiff = coord.z - centerDepth;\n  float shadow = (centerDiff > bias && centerDiff >= uMinOccluderDepth) ? 0.0 : 1.0;\n  for (int i = 0; i < 8; i++) {\n    vec2 offset = rotation * SHADOW_POISSON_DISK[i] * texelSize * filterRadius;\n    float depth = texture(shadowMap, coord.xy + offset).r;\n    float depthDiff = coord.z - depth;\n    shadow += (depthDiff > bias && depthDiff >= uMinOccluderDepth) ? 0.0 : 1.0;\n  }\n\n  shadow /= 9.0;\n  return mix(1.0, shadow, shadowMapEdgeFade(coord));\n}\n"``

___

### SKY\_FOG\_COMMON\_UNIFORM\_DECLARATIONS

• `Const` **SKY\_FOG\_COMMON\_UNIFORM\_DECLARATIONS**: ``"\nuniform vec3 uFogColor;\nuniform float uFogNear;\nuniform float uFogFar;\nuniform float uFogHeightOrigin;\nuniform float uFogHeightDensity;\nuniform vec3 uSkyFogTopColor;\nuniform vec3 uSkyFogMiddleColor;\nuniform vec3 uSkyFogBottomColor;\nuniform float uSkyFogOffset;\nuniform float uSkyFogVoidOffset;\nuniform float uSkyFogExponent;\nuniform float uSkyFogExponent2;\nuniform float uSkyFogDimension;\nuniform float uSkyFogStrength;\nuniform float uChunkReveal;\n\nuniform float uCameraSubmersion;\nuniform float uCameraWaterPlaneY;\nuniform vec3 uUnderwaterAmbient;\n\n"``

Sky-fog uniforms minus the sun trio, for shaders whose lighting chunk
already declares `uSunDirection`, `uSunColor`, and `uSunlightIntensity`
(e.g. entity materials composing this alongside their shadow chunk).

___

### SKY\_FOG\_FRAGMENT

• `Const` **SKY\_FOG\_FRAGMENT**: `string`

___

### SKY\_FOG\_SUN\_UNIFORM\_DECLARATIONS

• `Const` **SKY\_FOG\_SUN\_UNIFORM\_DECLARATIONS**: ``"\nuniform vec3 uSunDirection;\nuniform vec3 uSunColor;\nuniform float uSunlightIntensity;\n"``

___

### SKY\_FOG\_UNIFORM\_DECLARATIONS

• `Const` **SKY\_FOG\_UNIFORM\_DECLARATIONS**: ``"\n\nuniform vec3 uFogColor;\nuniform float uFogNear;\nuniform float uFogFar;\nuniform float uFogHeightOrigin;\nuniform float uFogHeightDensity;\nuniform vec3 uSkyFogTopColor;\nuniform vec3 uSkyFogMiddleColor;\nuniform vec3 uSkyFogBottomColor;\nuniform float uSkyFogOffset;\nuniform float uSkyFogVoidOffset;\nuniform float uSkyFogExponent;\nuniform float uSkyFogExponent2;\nuniform float uSkyFogDimension;\nuniform float uSkyFogStrength;\nuniform float uChunkReveal;\n\nuniform float uCameraSubmersion;\nuniform float uCameraWaterPlaneY;\nuniform vec3 uUnderwaterAmbient;\n\n\n\nuniform vec3 uSunDirection;\nuniform vec3 uSunColor;\nuniform float uSunlightIntensity;\n\n"``

___

### SUNLIGHT

• `Const` **SUNLIGHT**: ``"SUNLIGHT"``

The string representation of sunlight.

___

### TRANSPARENT\_FLUID\_RENDER\_ORDER

• `Const` **TRANSPARENT\_FLUID\_RENDER\_ORDER**: ``100001``

___

### TRANSPARENT\_RENDER\_ORDER

• `Const` **TRANSPARENT\_RENDER\_ORDER**: ``100000``

___

### UNDERWATER\_FOG\_FRAGMENT

• `Const` **UNDERWATER\_FOG\_FRAGMENT**: `string`

Per-channel exponential (Beer-Lambert) fog along the camera's underwater
view path. Expects `vWorldPosition`, `cameraPosition`, and `gl_FragColor`
in scope. The path is clamped at the waterline plane so geometry above the
surface only receives fog for the submerged segment of the ray.

___

### UNDERWATER\_FOG\_UNIFORM\_DECLARATIONS

• `Const` **UNDERWATER\_FOG\_UNIFORM\_DECLARATIONS**: ``"\nuniform float uCameraSubmersion;\nuniform float uCameraWaterPlaneY;\nuniform vec3 uUnderwaterAmbient;\n"``

___

### VOXELIZE\_BUILTIN\_SOUND\_EFFECT\_EVENT

• `Const` **VOXELIZE\_BUILTIN\_SOUND\_EFFECT\_EVENT**: ``"vox-builtin:sound-effect"``

___

### VOXEL\_SUNLIGHT\_EXTINCTION\_PER\_WATER\_BLOCK

• `Const` **VOXEL\_SUNLIGHT\_EXTINCTION\_PER\_WATER\_BLOCK**: `number` = `-Math.log( LightUtils.BEER_LAMBERT_TRANSMITTANCE_NUM / LightUtils.BEER_LAMBERT_TRANSMITTANCE_DEN,)`

Extinction of the voxel sunlight encoding per water block, matching the
Beer-Lambert transmittance used by the light engine. The chunk shader uses
it to tell genuinely submerged fragments apart from dry ground that merely
sits below the nominal water level.

___

### WATER\_DOWNWELLING\_EXTINCTION\_GLSL

• `Const` **WATER\_DOWNWELLING\_EXTINCTION\_GLSL**: `string`

___

### WATER\_OPTICS

• `Const` **WATER\_OPTICS**: `Readonly`\<\{ `depthSmoothingSpeed`: ``7`` = 7; `downwellingExtinction`: \{ `blue`: `number` = 0.048; `green`: `number` = 0.1; `red`: `number` = 0.38 } ; `fluidSurfaceHeight`: ``0.875`` = 0.875; `lightFilterFloor`: ``0.04`` = 0.04; `maxSurfaceScanBlocks`: ``96`` = 96; `mediumWaveFadeEndBlocks`: ``128`` = 128; `mediumWaveFadeStartBlocks`: ``64`` = 64; `nightScatterFloor`: ``0.06`` = 0.06; `refractionFullStrengthCos`: ``0.85`` = 0.85; `refractionGrazingCutoffCos`: ``0.3`` = 0.3; `rippleFadeEndBlocks`: ``96`` = 96; `rippleFadeStartBlocks`: ``48`` = 48; `scatterFillBase`: ``0.03`` = 0.03; `scatterFillSunStrength`: ``0.2`` = 0.2; `skyFadeExtinction`: ``0.1`` = 0.1; `submersionFallSpeed`: ``11`` = 11; `submersionRiseSpeed`: ``16`` = 16; `surfaceAbsorptionScale`: ``0.55`` = 0.55; `surfaceScatterColor`: ``"#37b6c5"`` = "#37b6c5"; `viewExtinctionScale`: ``0.85`` = 0.85; `waterlineFadeDepth`: ``0.12`` = 0.12 }\>

The single source of truth for how water absorbs and scatters light.

Every underwater visual — fog color and density, terrain and entity light
attenuation, sky dome fading, first-person prop tinting — is derived from
these values so the whole scene stays physically coherent.

___

### WATER\_SURFACE\_SCATTER\_COLOR

• `Const` **WATER\_SURFACE\_SCATTER\_COLOR**: `Color`

___

### WATER\_SURFACE\_SCATTER\_GLSL

• `Const` **WATER\_SURFACE\_SCATTER\_GLSL**: `string`

___

### WATER\_VIEW\_EXTINCTION

• `Const` **WATER\_VIEW\_EXTINCTION**: [`WaterChannelCoefficients`](modules.md#waterchannelcoefficients)

___

### WATER\_VIEW\_EXTINCTION\_GLSL

• `Const` **WATER\_VIEW\_EXTINCTION\_GLSL**: `string`

___

### Y\_ROT\_MAP

• `Const` **Y\_ROT\_MAP**: [`number`, `number`][] = `[]`

A rotational map used to get the closest y-rotation representation to a y-rotation value.

Rotation value -> index

___

### Y\_ROT\_MAP\_EIGHT

• `Const` **Y\_ROT\_MAP\_EIGHT**: [`number`, `number`][] = `[]`

___

### Y\_ROT\_MAP\_FOUR

• `Const` **Y\_ROT\_MAP\_FOUR**: [`number`, `number`][] = `[]`

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
| `drawCrown` | [`ArtFunction`](modules.md#artfunction) |
| `drawMoon` | (`moonRadius`: `number`, `moonColor`: `string`, `phase`: `number`) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void` |
| `drawStars` | (`starCount`: `number`, `starColors`: `string`[]) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void` |
| `drawSun` | (`sunRadius`: `number`, `sunColor`: `string`) => (`context`: `CanvasRenderingContext2D`, `canvas`: `HTMLCanvasElement`) => `void` |

___

### customShaders

• `Const` **customShaders**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `sway` | (`options`: `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number`  }\>) => \{ `fragmentShader`: `string` = baseShaders.fragment; `vertexShader`: `string`  } |
| `swayCross` | (`options`: `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number`  }\>) => \{ `fragmentShader`: `string` = baseShaders.fragment; `vertexShader`: `string`  } |

___

### defaultArmsOptions

• `Const` **defaultArmsOptions**: [`ArmsOptions`](modules.md#armsoptions)

___

### defaultBodyOptions

• `Const` **defaultBodyOptions**: [`BodyOptions`](modules.md#bodyoptions)

___

### defaultCharacterOptions

• `Const` **defaultCharacterOptions**: [`CharacterOptions`](modules.md#characteroptions)

___

### defaultCreatureBodyOptions

• `Const` **defaultCreatureBodyOptions**: [`CreatureBodyOptions`](modules.md#creaturebodyoptions)

___

### defaultCreatureHeadOptions

• `Const` **defaultCreatureHeadOptions**: [`CreatureHeadOptions`](modules.md#creatureheadoptions)

___

### defaultCreatureLegOptions

• `Const` **defaultCreatureLegOptions**: [`CreatureLegOptions`](modules.md#creaturelegoptions)

___

### defaultCreatureOptions

• `Const` **defaultCreatureOptions**: [`CreatureOptions`](modules.md#creatureoptions)

___

### defaultHeadOptions

• `Const` **defaultHeadOptions**: [`HeadOptions`](modules.md#headoptions)

___

### defaultLegsOptions

• `Const` **defaultLegsOptions**: [`LegOptions`](modules.md#legoptions)

___

### defaultMemoryPressureOptions

• `Const` **defaultMemoryPressureOptions**: [`MemoryPressureOptions`](modules.md#memorypressureoptions)

___

### restArgsSchema

• `Const` **restArgsSchema**: `ZodObject`\<\{ `rest`: `ZodOptional`\<`ZodString`\>  }, ``"strip"``, `ZodTypeAny`, \{ `rest?`: `string`  }, \{ `rest?`: `string`  }\>

Schema for commands that take a free-form string input.
Use this for commands that need the raw rest string.

## Functions

### TRANSPARENT\_SORT

▸ **TRANSPARENT_SORT**(`object`): (`a`: `TransparentSortItem`, `b`: `TransparentSortItem`) => `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> |

#### Returns

`fn`

▸ (`a`, `b`): `number`

##### Parameters

| Name | Type |
| :------ | :------ |
| `a` | `TransparentSortItem` |
| `b` | `TransparentSortItem` |

##### Returns

`number`

___

### annotateIncomingMessages

▸ **annotateIncomingMessages**(`messages`, `byteSizes`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `messages` | `MessageProtocol`[] |
| `byteSizes` | `number`[] |

#### Returns

`void`

___

### blockSlot

▸ **blockSlot**(`id`, `count`): [`SlotContent`](modules.md#slotcontent)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `count` | `number` |

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### compareChunkRequestPriority

▸ **compareChunkRequestPriority**(`a`, `b`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `a` | [`ChunkRequestCandidate`](modules.md#chunkrequestcandidate) |
| `b` | [`ChunkRequestCandidate`](modules.md#chunkrequestcandidate) |

#### Returns

`number`

___

### configurePerfLogging

▸ **configurePerfLogging**(`isEnabled`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `isEnabled` | `boolean` |

#### Returns

`void`

___

### createEntityShadowUniforms

▸ **createEntityShadowUniforms**(): [`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md)

#### Returns

[`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md)

___

### createPerfTraceId

▸ **createPerfTraceId**(): `string`

#### Returns

`string`

___

### createSkyFogFragment

▸ **createSkyFogFragment**(`depthExpression?`): `string`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `depthExpression` | `string` | `"sqrt(dot(fogDiff, fogDiff))"` |

#### Returns

`string`

___

### createSwayShader

▸ **createSwayShader**(`baseShaders`, `options?`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `baseShaders` | `Object` |
| `baseShaders.fragment` | `string` |
| `baseShaders.vertex` | `string` |
| `options` | `Partial`\<\{ `amplitude`: `number` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number`  }\> |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `fragmentShader` | `string` |
| `vertexShader` | `string` |

___

### createUnderwaterFogUniforms

▸ **createUnderwaterFogUniforms**(): [`UnderwaterFogUniforms`](interfaces/UnderwaterFogUniforms.md)

#### Returns

[`UnderwaterFogUniforms`](interfaces/UnderwaterFogUniforms.md)

___

### cull

▸ **cull**(`array`, `options`): `Promise`\<[`MeshResultType`](modules.md#meshresulttype)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `array` | `NdArray`\<`number`[] \| `TypedArray` \| `GenericArray`\<`number`\>\> |
| `options` | [`CullOptionsType`](modules.md#culloptionstype) |

#### Returns

`Promise`\<[`MeshResultType`](modules.md#meshresulttype)\>

___

### decodeHeldObject

▸ **decodeHeldObject**(`raw`): [`SlotContent`](modules.md#slotcontent)

#### Parameters

| Name | Type |
| :------ | :------ |
| `raw` | `number` |

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### emptySlot

▸ **emptySlot**(): [`SlotContent`](modules.md#slotcontent)

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### encodeHeldObject

▸ **encodeHeldObject**(`slot`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](modules.md#slotcontent) |

#### Returns

`number`

___

### findSimilar

▸ **findSimilar**(`target`, `available`, `options?`): `string`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | `string` |
| `available` | `string`[] |
| `options` | [`FindSimilarOptions`](modules.md#findsimilaroptions) |

#### Returns

`string`[]

___

### formatSuggestion

▸ **formatSuggestion**(`suggestions`, `allAvailable`, `options?`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `suggestions` | `string`[] |
| `allAvailable` | `string`[] |
| `options` | [`FormatSuggestionOptions`](modules.md#formatsuggestionoptions) |

#### Returns

`string`

___

### getDownwellingTransmittance

▸ **getDownwellingTransmittance**(`depth`, `out`): `Color`

#### Parameters

| Name | Type |
| :------ | :------ |
| `depth` | `number` |
| `out` | `Color` |

#### Returns

`Color`

___

### getEffectiveScatterStrength

▸ **getEffectiveScatterStrength**(`sunStrength`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `sunStrength` | `number` |

#### Returns

`number`

___

### getImageComp

▸ **getImageComp**(`item`): [`ImageComp`](interfaces/ImageComp.md) \| `undefined`

#### Parameters

| Name | Type |
| :------ | :------ |
| `item` | [`ItemDef`](interfaces/ItemDef.md) |

#### Returns

[`ImageComp`](interfaces/ImageComp.md) \| `undefined`

___

### getItemComponent

▸ **getItemComponent**\<`T`\>(`item`, `key`): `T` \| `undefined`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `item` | [`ItemDef`](interfaces/ItemDef.md) |
| `key` | `string` |

#### Returns

`T` \| `undefined`

___

### getMeshTransferStatus

▸ **getMeshTransferStatus**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `isCrossOriginIsolated` | `boolean` |
| `isSharedArrayBufferAvailable` | `boolean` |
| `mode` | [`WorkerTransferMode`](modules.md#workertransfermode) |
| `pool` | [`ChunkSharedPoolStats`](modules.md#chunksharedpoolstats) |
| `stats` | [`MeshWorkerTransferStats`](modules.md#meshworkertransferstats) \| `Record`\<[`WorkerTransferStrategy`](modules.md#workertransferstrategy), [`MeshWorkerTransferStats`](modules.md#meshworkertransferstats)\> |
| `strategy` | [`WorkerTransferStrategy`](modules.md#workertransferstrategy) |

___

### getSlotData

▸ **getSlotData**\<`T`\>(`slot`, `key`): `T` \| `undefined`

#### Type parameters

| Name |
| :------ |
| `T` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](modules.md#slotcontent) |
| `key` | `string` |

#### Returns

`T` \| `undefined`

___

### getSlotDurability

▸ **getSlotDurability**(`slot`): `number` \| `undefined`

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](modules.md#slotcontent) |

#### Returns

`number` \| `undefined`

___

### getUnderwaterAmbientColor

▸ **getUnderwaterAmbientColor**(`depth`, `sunStrength`, `out`): `Color`

#### Parameters

| Name | Type |
| :------ | :------ |
| `depth` | `number` |
| `sunStrength` | `number` |
| `out` | `Color` |

#### Returns

`Color`

___

### hasItemComponent

▸ **hasItemComponent**(`item`, `key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `item` | [`ItemDef`](interfaces/ItemDef.md) |
| `key` | `string` |

#### Returns

`boolean`

___

### hasSlotData

▸ **hasSlotData**(`slot`, `key`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](modules.md#slotcontent) |
| `key` | `string` |

#### Returns

`boolean`

___

### isPerfLogging

▸ **isPerfLogging**(): `boolean`

#### Returns

`boolean`

___

### itemSlot

▸ **itemSlot**(`id`, `count`, `data?`): [`SlotContent`](modules.md#slotcontent)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `count` | `number` |
| `data` | `Record`\<`string`, `unknown`\> |

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### itemSlotWithDurability

▸ **itemSlotWithDurability**(`id`, `count`, `durability`): [`SlotContent`](modules.md#slotcontent)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `count` | `number` |
| `durability` | `number` |

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### logChatRendered

▸ **logChatRendered**(`chat`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

#### Returns

`void`

___

### logChatWireSend

▸ **logChatWireSend**(`message`, `byteSize`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol` |
| `byteSize` | `number` |

#### Returns

`void`

___

### logIncomingMessage

▸ **logIncomingMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol` |

#### Returns

`void`

___

### logPerf

▸ **logPerf**(`event`, `fields?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `string` |
| `fields` | `Record`\<`string`, `PerfField`\> |

#### Returns

`void`

___

### makeSceneColorTexture

▸ **makeSceneColorTexture**(`width?`, `height?`, `isSRGB?`): `FramebufferTexture`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `width` | `number` | `1` |
| `height` | `number` | `1` |
| `isSRGB` | `boolean` | `false` |

#### Returns

`FramebufferTexture`

___

### measureWaterColumn

▸ **measureWaterColumn**(`isFluidAt`, `x`, `y`, `z`): [`WaterColumnSample`](modules.md#watercolumnsample) \| ``null``

#### Parameters

| Name | Type |
| :------ | :------ |
| `isFluidAt` | [`FluidQuery`](modules.md#fluidquery) |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

[`WaterColumnSample`](modules.md#watercolumnsample) \| ``null``

___

### prepareTransparentMesh

▸ **prepareTransparentMesh**(`mesh`): [`TransparentMeshData`](interfaces/TransparentMeshData.md) \| ``null``

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Mesh`\<`BufferGeometry`\<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\> |

#### Returns

[`TransparentMeshData`](interfaces/TransparentMeshData.md) \| ``null``

___

### readChromiumHeap

▸ **readChromiumHeap**(): [`HeapSample`](modules.md#heapsample)

#### Returns

[`HeapSample`](modules.md#heapsample)

___

### requestWorkerAnimationFrame

▸ **requestWorkerAnimationFrame**(`callback`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | () => `void` |

#### Returns

`number`

___

### runMeshTransferBenchmark

▸ **runMeshTransferBenchmark**(`dispatch`, `getChunk`, `options`): `Promise`\<[`MeshTransferBenchmarkResult`](modules.md#meshtransferbenchmarkresult)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `dispatch` | [`MeshTransferDispatch`](modules.md#meshtransferdispatch) |
| `getChunk` | (`cx`: `number`, `cz`: `number`) => [`Chunk`](classes/Chunk.md) |
| `options` | [`MeshTransferBenchmarkOptions`](modules.md#meshtransferbenchmarkoptions) |

#### Returns

`Promise`\<[`MeshTransferBenchmarkResult`](modules.md#meshtransferbenchmarkresult)\>

___

### setPerfWorld

▸ **setPerfWorld**(`world`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

#### Returns

`void`

___

### setSlotData

▸ **setSlotData**\<`T`\>(`slot`, `key`, `value`): [`SlotContent`](modules.md#slotcontent)

#### Type parameters

| Name |
| :------ |
| `T` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](modules.md#slotcontent) |
| `key` | `string` |
| `value` | `T` |

#### Returns

[`SlotContent`](modules.md#slotcontent)

___

### setWorkerInterval

▸ **setWorkerInterval**(`func`, `interval`): () => `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `func` | () => `void` |
| `interval` | `number` |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### setupTransparentSorting

▸ **setupTransparentSorting**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> |

#### Returns

`void`

___

### sortTransparentMesh

▸ **sortTransparentMesh**(`mesh`, `data`, `camera`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Mesh`\<`BufferGeometry`\<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\> |
| `data` | [`TransparentMeshData`](interfaces/TransparentMeshData.md) |
| `camera` | `Camera` |

#### Returns

`void`

___

### stampChatPerf

▸ **stampChatPerf**(`chat`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `chat` | `ChatProtocol` |

#### Returns

`void`

___

### updateEntityShadowUniforms

▸ **updateEntityShadowUniforms**(`target`, `source`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | [`EntityShadowUniforms`](interfaces/EntityShadowUniforms.md) |
| `source` | [`ShaderLightingUniforms`](interfaces/ShaderLightingUniforms.md) |

#### Returns

`void`

___

### updateUnderwaterFogUniforms

▸ **updateUnderwaterFogUniforms**(`target`, `source`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | [`UnderwaterFogUniforms`](interfaces/UnderwaterFogUniforms.md) |
| `source` | [`UnderwaterFogSource`](interfaces/UnderwaterFogSource.md) |

#### Returns

`void`
