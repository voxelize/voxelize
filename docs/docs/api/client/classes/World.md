---
id: "World"
title: "Class: World<T>"
sidebar_label: "World"
sidebar_position: 0
custom_edit_url: null
---

A Voxelize world handles the chunk loading and rendering, as well as any 3D objects.
**This class extends the [ThreeJS `Scene` class](https://threejs.org/docs/#api/en/scenes/Scene).**
This means that you can add any ThreeJS objects to the world, and they will be rendered. The world
also implements [NetIntercept](../interfaces/NetIntercept.md), which means it intercepts chunk-related packets from the server
and constructs chunk meshes from them.

There are a couple components that are by default created by the world that holds data:
- [World.registry](World.md#registry): A block registry that handles block textures and block instances.
- World.chunks: A chunk manager that stores all the chunks in the world.
- [World.physics](World.md#physics): A physics engine that handles voxel AABB physics simulation of client-side physics.
- [World.loader](World.md#loader): An asset loader that handles loading textures and other assets.
- [World.sky](World.md#sky): A sky that can render the sky and the sun.
- [World.clouds](World.md#clouds): A clouds that renders the cubical clouds.

One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.

# Example
```ts
const world = new VOXELIZE.World();

// Update the voxel at `(0, 0, 0)` to a voxel type `12` in the world across the network.
world.updateVoxel(0, 0, 0, 12)

// Register the interceptor with the network.
network.register(world);

// Register an image to block sides.
world.applyBlockTexture("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");

// Update the world every frame.
world.update(controls.position);
```

![World](/img/docs/world.png)

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Hierarchy

- `Scene`

  ↳ **`World`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new World**<`T`\>(`options?`): [`World`](World.md)<`T`\>

Create a new Voxelize world.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `options` | `Partial`<[`WorldOptions`](../#worldoptions)\> | The options to create the world. |

#### Returns

[`World`](World.md)<`T`\>

#### Overrides

Scene.constructor

## Properties

### blockAnimations

• **blockAnimations**: [`BlockAnimations`](BlockAnimations.md)

How animated blocks (`Block.isAnimated`: doors, and whatever else moves
between its states) swing from one state's geometry into the next. The
game registers a [BlockAnimation](../#blockanimation) per block name; the engine
tracks each such voxel's mesh across remeshes and drives the motion.

___

### blockTextureGeneration

• **blockTextureGeneration**: `number` = `0`

How many times a block texture has been written, bumped by every texture
API. Every atlas slot starts life as the magenta-and-black unknown
checker, and painting is spread over the load (image loads resolve
whenever they resolve), so anything that samples the atlas into its own
table has to be able to tell that its table predates the paint. Compare
this against the value read when the table was built; unequal means
rebuild.

___

### chunkPipeline

• **chunkPipeline**: [`ChunkPipeline`](ChunkPipeline.md)

Pipeline for chunk lifecycle state machine (request -> processing -> loaded).

___

### chunkRenderer

• **chunkRenderer**: [`ChunkRenderer`](ChunkRenderer.md)

Chunk rendering state (materials, uniforms).

___

### clouds

• **clouds**: [`Clouds`](Clouds.md)

The clouds that renders the cubical clouds.

___

### csmRenderer

• **csmRenderer**: [`CSMRenderer`](CSMRenderer.md) = `null`

The CSM (Cascaded Shadow Map) renderer for shader-based lighting.

___

### extraInitData

• **extraInitData**: `Record`<`string`, `unknown`\> = `{}`

___

### farTerrain

• **farTerrain**: [`FarTerrain`](FarTerrain.md)

Coarse terrain past the loaded chunks, drawn from server-sampled tiles
when the world serves them (`farTerrain` in the INIT options) and
`farTerrainDistance` is above 0. See [FarTerrain](FarTerrain.md).

___

### isInitialized

• **isInitialized**: `boolean` = `false`

Whether or not this world is connected to the server and initialized with data from the server.

___

### items

• **items**: [`ItemRegistry`](ItemRegistry.md)

The item registry that holds all item definitions and provides utility methods for item operations.

___

### lightCones

• **lightCones**: [`LightCones`](LightCones.md)

Shared dynamic spot-cone lighting (flashlights, vehicle headlights).
The game rebuilds the cone list every frame; chunk materials bind these
uniforms at creation.

___

### loader

• **loader**: [`Loader`](Loader.md)

An asset loader to load in things like textures, images, GIFs and audio buffers.

___

### localLights

• **localLights**: [`LocalLights`](LocalLights.md)

Local light emitters: block-anchored sources scanned out of chunks plus
game-registered dynamic sources, clustered into the chunk shaders. The
game declares semantic block profiles and dynamic lights; the engine
owns scanning, selection, culling, and GPU representation.

___

### meshApplyStats

• **meshApplyStats**: [`MeshApplyStats`](../#meshapplystats)

Running cost of applying mesh results on the main thread; see
[MeshApplyStats](../#meshapplystats).

___

### meshPipeline

• **meshPipeline**: [`MeshPipeline`](MeshPipeline.md)

Pipeline for mesh generation with ordering guarantees.

___

### meshTransfer

• `Readonly` **meshTransfer**: `Object`

Configure and inspect mesh worker buffer transfer (transfer vs SharedArrayBuffer).

#### Type declaration

| Name | Type |
| :------ | :------ |
| `benchmark` | (`options`: [`MeshTransferBenchmarkOptions`](../#meshtransferbenchmarkoptions)) => `Promise`<[`MeshTransferBenchmarkResult`](../#meshtransferbenchmarkresult)\> |
| `configure` | (`config`: \{ `mode?`: [`WorkerTransferMode`](../#workertransfermode)  }) => `void` |
| `getMode` | () => [`WorkerTransferMode`](../#workertransfermode) |
| `getStats` | () => [`MeshWorkerTransferStats`](../#meshworkertransferstats) \| `Record`<[`WorkerTransferStrategy`](../#workertransferstrategy), [`MeshWorkerTransferStats`](../#meshworkertransferstats)\> |
| `getStatus` | () => \{ `isCrossOriginIsolated`: `boolean` ; `isSharedArrayBufferAvailable`: `boolean` ; `mode`: [`WorkerTransferMode`](../#workertransfermode) ; `pool`: [`ChunkSharedPoolStats`](../#chunksharedpoolstats) ; `stats`: [`MeshWorkerTransferStats`](../#meshworkertransferstats) \| `Record`<[`WorkerTransferStrategy`](../#workertransferstrategy), [`MeshWorkerTransferStats`](../#meshworkertransferstats)\> ; `strategy`: [`WorkerTransferStrategy`](../#workertransferstrategy)  } |
| `getStrategy` | () => [`WorkerTransferStrategy`](../#workertransferstrategy) |
| `isSharedArrayBufferAvailable` | () => `boolean` |
| `resetStats` | () => `void` |
| `setStrategy` | (`strategy`: ``"transfer"`` \| ``"shared"``) => `void` |

___

### options

• **options**: [`WorldOptions`](../#worldoptions)

The options to create the world.

___

### orderIndependent

• **orderIndependent**: [`OrderIndependentTransparency`](OrderIndependentTransparency.md) = `null`

The blended layers' accumulation, when
WorldClientOptions.orderIndependentTransparency is set; `null`
draws the sorted pipeline.

___

### physics

• **physics**: `Engine`

The voxel physics engine using `@voxelize/physics-engine`.

___

### regionArenas

• **regionArenas**: [`ChunkRegionArenas`](ChunkRegionArenas.md) = `null`

Region buffer arenas batching the shared-opaque bucket, one
`BatchedMesh` per region; `null` until the first opaque section lands or
when WorldClientOptions.regionArenas disables batching.

___

### registry

• **registry**: [`Registry`](Registry.md)

The block registry that holds all block data, such as texture and block properties.

___

### shaderClock

• `Readonly` **shaderClock**: [`ShaderClock`](ShaderClock.md)

The clock chunk shaders animate on (waves, sway, flicker, animated
atlas frames): the shared clock, slewed and wrapped for the GPU, so
every player sees the same wave at the same moment.

___

### sky

• **sky**: [`Sky`](Sky.md)

The sky that renders the sky and the sun.

___

### swayProfileTable

• `Readonly` **swayProfileTable**: `Uniform`<`any`\>

Flat vec4-pair table behind the shared cutout buckets' sway shader; see
[createSwayTableShader](../#createswaytableshader). Slot 0 stays zeroed as the "no sway"
profile.

___

### waterOptics

• **waterOptics**: [`WaterOptics`](WaterOptics.md)

The camera-driven underwater optics state, updated via
[World.updateWaterOptics](World.md#updatewateroptics).

___

### waterOpticsFluidFilter

• **waterOpticsFluidFilter**: (`block`: [`Block`](../#block)) => `boolean` = `null`

Which fluid blocks count as water for the camera's underwater optics.
`null` (the default) treats every fluid as water. A game with other
fluids (lava) returns false for them, so a camera inside one does not
get water fog, sky fade and the backside water surface.

#### Type declaration

▸ (`block`): `boolean`

##### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../#block) |

##### Returns

`boolean`

## Accessors

### day

• `get` **day**(): `number`

Days the world clock has completed. With [World.time](World.md#time) it forms
[World.sharedClock](World.md#sharedclock); on its own it is what a moon phase or a
"day N" readout would count.

#### Returns

`number`

___

### deleteRadius

• `get` **deleteRadius**(): `number`

#### Returns

`number`

___

### disposed

• `get` **disposed**(): `boolean`

Whether [dispose](World.md#dispose) has run. A disposed world is a corpse: its
workers are gone and its chunks released, and anything still holding it
is holding the whole scene graph in memory for nothing.

#### Returns

`boolean`

___

### farTerrainDistance

• `get` **farTerrainDistance**(): `number`

How far the far-terrain layer reaches past the viewer, in blocks; 0
turns it off. Takes effect only in a world that serves far terrain.
The fog range follows it. See `WorldOptions.farTerrainDistance`.

#### Returns

`number`

• `set` **farTerrainDistance**(`distance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `distance` | `number` |

#### Returns

`void`

___

### fogDistance

• `get` **fogDistance**(): `number`

A fixed fog distance in blocks, independent of `renderRadius`; `null`
when fog is still derived from the radius. See
`WorldOptions.fogDistance`.

#### Returns

`number`

• `set` **fogDistance**(`distance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `distance` | `number` |

#### Returns

`void`

___

### renderRadius

• `get` **renderRadius**(): `number`

#### Returns

`number`

• `set` **renderRadius**(`radius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `radius` | `number` |

#### Returns

`void`

___

### sectionVisibilityStats

• `get` **sectionVisibilityStats**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `constrained` | `number` |
| `isComplete` | `boolean` |
| `reached` | `number` |
| `sections` | `number` |
| `visible` | `number` |

___

### sharedClock

• `get` **sharedClock**(): `number`

Seconds since the world's clock began: `day * timePerDay + time`. Unlike
[World.time](World.md#time) it never wraps at midnight, and every client of a
world agrees on it to within the STATS sync threshold, which makes it
the clock for cosmetic motion all players must see alike — cloud drift,
the shooting-star schedule. A `/time` jump moves it within the current
day, so those effects jump with the sky rather than diverging from it.

A world whose clock is frozen (`doesTickTime` false) has no shared game
clock at all, so the wall clock stands in: clients agree to within their
NTP skew, which is all a cosmetic schedule needs.

#### Returns

`number`

___

### time

• `get` **time**(): `number`

#### Returns

`number`

• `set` **time**(`time`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `time` | `number` |

#### Returns

`void`

## Methods

### addBlockEntityUpdateListener

▸ **addBlockEntityUpdateListener**(`listener`): () => `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `listener` | [`BlockEntityUpdateListener`](../#blockentityupdatelistener)<`T`\> |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### addBlockUpdateListener

▸ **addBlockUpdateListener**(`listener`): () => `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `listener` | [`BlockUpdateListener`](../#blockupdatelistener) |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### addChunkInitListener

▸ **addChunkInitListener**(`coords`, `listener`): () => `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../#coords2) |
| `listener` | (`chunk`: [`Chunk`](Chunk.md)) => `void` |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### adoptOrderIndependentMaterials

▸ **adoptOrderIndependentMaterials**(`materials`): `Material`[]

Adopts every material in `materials` that can accumulate, and makes the
texel forks of the see-through chunk materials among them, so a warmup
compiles the programs play draws with (a material adopted after it
compiled compiles again). Returns the forks: no scene holds them until
a mesh's textures call for one, so a warmup has to draw them itself.

#### Parameters

| Name | Type |
| :------ | :------ |
| `materials` | `Iterable`<`Material`, `any`, `any`\> |

#### Returns

`Material`[]

___

### applyBlockFrames

▸ **applyBlockFrames**(`idOrName`, `faceNames`, `keyframes`, `fadeFrames?`): `Promise`<`void`\>

Apply a set of keyframes to a block. This will load the keyframes from the sources and start the animation
to play the keyframes on the block's texture atlas.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | `undefined` | The ID or name of the block. |
| `faceNames` | `string` \| `string`[] | `undefined` | The face name or names to apply the texture to. |
| `keyframes` | [`number`, `string` \| `Color` \| `HTMLImageElement`][] | `undefined` | The keyframes to apply to the texture. |
| `fadeFrames` | `number` | `0` | The number of frames to fade between each keyframe. |

#### Returns

`Promise`<`void`\>

___

### applyBlockGif

▸ **applyBlockGif**(`idOrName`, `faceNames`, `source`, `interval?`): `Promise`<`void`\>

Apply a GIF animation to a block. This will load the GIF from the source and start the animation
using [applyBlockFrames](World.md#applyblockframes) internally.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `idOrName` | `string` | `undefined` | The ID or name of the block. |
| `faceNames` | `string` \| `string`[] | `undefined` | The face name or names to apply the texture to. |
| `source` | `string` | `undefined` | The source of the GIF. Note that this must be a GIF file ending with `.gif`. |
| `interval` | `number` | `66.666667` | The interval between each frame of the GIF in milliseconds. Defaults to `66.666667ms`. |

#### Returns

`Promise`<`void`\>

___

### applyBlockTexture

▸ **applyBlockTexture**(`idOrName`, `faceNames`, `source`): `void`

Apply a texture to a face or faces of a block. This will automatically load the image from the source
and draw it onto the block's texture atlas.

An isolated face, whose pixels belong to a voxel, takes this as its
default — what the face looks like where there is no voxel to ask, which
is every display mesh: a held block, a drop, an inventory thumbnail.
[applyBlockTextureAt](World.md#applyblocktextureat) still overrides it per voxel.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | The ID or name of the block. |
| `faceNames` | `string` \| `string`[] | The face names to apply the texture to. |
| `source` | `string` \| `Color` \| `Texture`<`unknown`\> \| `HTMLImageElement` | The source of the texture. |

#### Returns

`void`

**`Deprecated`**

When applying the same texture to multiple faces, use texture groups instead
for better atlas efficiency. Define texture_group on the server-side block faces and use
[applyTextureGroup](World.md#applytexturegroup) or [applyTextureGroups](World.md#applytexturegroups) on the client.

___

### applyBlockTextureAt

▸ **applyBlockTextureAt**(`idOrName`, `faceName`, `source`, `voxel`): [`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `faceName` | `string` |
| `source` | `string` \| `Color` \| `Texture`<`unknown`\> \| `HTMLImageElement` |
| `voxel` | [`Coords3`](../#coords3) |

#### Returns

[`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

___

### applyBlockTextures

▸ **applyBlockTextures**(`data`): `Promise`<`void`[]\>

Apply multiple block textures at once. See [applyBlockTexture](World.md#applyblocktexture) for more information.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `data` | \{ `faceNames`: `string` \| `string`[] ; `idOrName`: `string` \| `number` ; `source`: `string` \| `Color`  }[] | The data to apply the block textures. |

#### Returns

`Promise`<`void`[]\>

A promise that resolves when all the textures are applied.

**`Deprecated`**

When applying the same texture to multiple faces, use texture groups instead
for better atlas efficiency. Define texture_group on the server-side block faces and use
[applyTextureGroup](World.md#applytexturegroup) or [applyTextureGroups](World.md#applytexturegroups) on the client.

___

### applyTextureGroup

▸ **applyTextureGroup**(`groupName`, `source`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `groupName` | `string` |
| `source` | `string` \| `Color` \| `Texture`<`unknown`\> \| `HTMLImageElement` |

#### Returns

`any`

___

### applyTextureGroups

▸ **applyTextureGroups**(`data`): `Promise`<`any`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | \{ `groupName`: `string` ; `source`: `string` \| `Color` \| `Texture`<`unknown`\> \| `HTMLImageElement`  }[] |

#### Returns

`Promise`<`any`[]\>

___

### benchmarkMeshTransfer

▸ **benchmarkMeshTransfer**(`options`): `Promise`<[`MeshTransferBenchmarkResult`](../#meshtransferbenchmarkresult)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`MeshTransferBenchmarkOptions`](../#meshtransferbenchmarkoptions) |

#### Returns

`Promise`<[`MeshTransferBenchmarkResult`](../#meshtransferbenchmarkresult)\>

___

### customizeBlockDynamic

▸ **customizeBlockDynamic**(`idOrName`, `fn`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `fn` | (`pos`: [`Coords3`](../#coords3)) => \{ `aabbs`: `AABB`[] ; `faces`: \{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `emissive?`: `number` ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `pigmentMask?`: `number` ; `range`: [`UV`](../#uv) ; `regionalTint?`: `boolean` ; `stageTintMask?`: `number` ; `textureGroup`: `string`  }[] ; `isTransparent`: [`boolean`, `boolean`, `boolean`, `boolean`, `boolean`, `boolean`]  } |

#### Returns

`void`

___

### customizeMaterialShaders

▸ **customizeMaterialShaders**(`idOrName`, `faceName?`, `data?`): [`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | `undefined` |
| `faceName` | `string` | `null` |
| `data` | `Object` | `undefined` |
| `data.fragmentShader` | `string` | `undefined` |
| `data.uniforms?` | `Object` | `undefined` |
| `data.vertexShader` | `string` | `undefined` |

#### Returns

[`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### expandCoupledUpdates

▸ **expandCoupledUpdates**(`updates`): [`BlockUpdate`](../#blockupdate)[]

Expand a batch of updates so every coupled unit it touches changes
whole — the mirror of the server's update intake, run on every batch
`updateVoxels` receives. Exposed so a caller can learn the outcome of a
placement before committing to it (an anchor whose partner voxel is
occupied expands to nothing); the result is idempotent, so it can be
handed straight back to [World.updateVoxels](World.md#updatevoxels). See
[expandCoupledUpdates](../#expandcoupledupdates).

#### Parameters

| Name | Type |
| :------ | :------ |
| `updates` | [`BlockUpdate`](../#blockupdate)[] |

#### Returns

[`BlockUpdate`](../#blockupdate)[]

___

### fillUnpaintedSurfaces

▸ **fillUnpaintedSurfaces**(`options?`): [`TextureFillResult`](../#texturefillresult)

Dress every surface still on the unknown checker: an isolated face in
its default if that has landed, everything else in
`options.unpaintedFallbackColor`. The census keeps reporting them as
`fallback`, so a stage made presentable this way does not pass for a
finished one.

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Object` |
| `options.color?` | `string` |

#### Returns

[`TextureFillResult`](../#texturefillresult)

___

### floodLight

▸ **floodLight**(`queue`, `color`, `min?`, `max?`): `void`

Propagate light nodes outward through the loaded chunks. The algorithm
itself lives in "./lighting" and senses the world through the
[VoxelLightVolume](../interfaces/VoxelLightVolume.md) slice this class satisfies.

#### Parameters

| Name | Type |
| :------ | :------ |
| `queue` | [`LightNode`](../#lightnode)[] |
| `color` | [`LightColor`](../#lightcolor) |
| `min?` | [`Coords3`](../#coords3) |
| `max?` | [`Coords3`](../#coords3) |

#### Returns

`void`

___

### getAABBOverride

▸ **getAABBOverride**(`voxel`): `AABB`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |

#### Returns

`AABB`[]

___

### getAABBOverrideOwner

▸ **getAABBOverrideOwner**(`voxel`): [`Coords3`](../#coords3)

The block voxel an override cell answers for, when it has one.

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |

#### Returns

[`Coords3`](../#coords3)

___

### getBaseFogRange

▸ **getBaseFogRange**(): [`WorldFogRange`](../#worldfogrange)

#### Returns

[`WorldFogRange`](../#worldfogrange)

___

### getBlockAABBsAt

▸ **getBlockAABBsAt**(`vx`, `vy`, `vz`): `AABB`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`AABB`[]

___

### getBlockAABBsByIdAt

▸ **getBlockAABBsByIdAt**(`id`, `vx`, `vy`, `vz`): `AABB`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`AABB`[]

___

### getBlockAABBsForDynamicPatterns

▸ **getBlockAABBsForDynamicPatterns**(`vx`, `vy`, `vz`, `dynamicPatterns`): \{ `aabb`: `AABB` ; `worldSpace`: `boolean`  }[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `dynamicPatterns` | [`BlockDynamicPattern`](../interfaces/BlockDynamicPattern.md)[] |

#### Returns

\{ `aabb`: `AABB` ; `worldSpace`: `boolean`  }[]

___

### getBlockAt

▸ **getBlockAt**(`px`, `py`, `pz`): [`Block`](../#block)

Get the block type data by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

[`Block`](../#block)

The block at the given position, or null if it does not exist.

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../#block)

Get the block type data by a block id. Unknown ids resolve to air
(logged once per id) so a server/client registry gap can never take
down meshing, lighting, or the agent bridge.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The block id. |

#### Returns

[`Block`](../#block)

The block data for the given id, or air if it is unknown.

___

### getBlockByIdSafe

▸ **getBlockByIdSafe**(`id`): [`Block`](../#block)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

[`Block`](../#block)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../#block)

Get the block type data by a block name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The block name. |

#### Returns

[`Block`](../#block)

The block data for the given name, or null if it does not exist.

___

### getBlockEntityDataAt

▸ **getBlockEntityDataAt**(`px`, `py`, `pz`): `T`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`T`

___

### getBlockEntityIdAt

▸ **getBlockEntityIdAt**(`px`, `py`, `pz`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`string`

___

### getBlockFaceMaterial

▸ **getBlockFaceMaterial**(`idOrName`, `faceName?`, `voxel?`): [`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `faceName?` | `string` |
| `voxel?` | [`Coords3`](../#coords3) |

#### Returns

[`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

___

### getBlockFacesByFaceNames

▸ **getBlockFacesByFaceNames**(`id`, `faceNames`, `warnUnknown?`): \{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `emissive?`: `number` ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `pigmentMask?`: `number` ; `range`: [`UV`](../#uv) ; `regionalTint?`: `boolean` ; `stageTintMask?`: `number` ; `textureGroup`: `string`  }[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `id` | `number` | `undefined` |
| `faceNames` | `string` \| `RegExp` \| `string`[] | `undefined` |
| `warnUnknown` | `boolean` | `false` |

#### Returns

\{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `emissive?`: `number` ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `pigmentMask?`: `number` ; `range`: [`UV`](../#uv) ; `regionalTint?`: `boolean` ; `stageTintMask?`: `number` ; `textureGroup`: `string`  }[]

___

### getBlockFacesForDynamicPatterns

▸ **getBlockFacesForDynamicPatterns**(`blockId`, `dynamicPatterns`): \{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `emissive?`: `number` ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `pigmentMask?`: `number` ; `range`: [`UV`](../#uv) ; `regionalTint?`: `boolean` ; `stageTintMask?`: `number` ; `textureGroup`: `string`  }[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `blockId` | `number` |
| `dynamicPatterns` | [`BlockDynamicPattern`](../interfaces/BlockDynamicPattern.md)[] |

#### Returns

\{ `corners`: \{ `pos`: [`number`, `number`, `number`] ; `uv`: `number`[]  }[] ; `dir`: [`number`, `number`, `number`] ; `emissive?`: `number` ; `independent`: `boolean` ; `isolated`: `boolean` ; `name`: `string` ; `pigmentMask?`: `number` ; `range`: [`UV`](../#uv) ; `regionalTint?`: `boolean` ; `stageTintMask?`: `number` ; `textureGroup`: `string`  }[]

___

### getBlockOf

▸ **getBlockOf**(`idOrName`): [`Block`](../#block)

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |

#### Returns

[`Block`](../#block)

___

### getBlockPassableForDynamicPatterns

▸ **getBlockPassableForDynamicPatterns**(`vx`, `vy`, `vz`, `dynamicPatterns`, `defaultPassable`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `dynamicPatterns` | [`BlockDynamicPattern`](../interfaces/BlockDynamicPattern.md)[] |
| `defaultPassable` | `boolean` |

#### Returns

`boolean`

___

### getBranchAABBsAt

▸ **getBranchAABBsAt**(`block`, `vx`, `vy`, `vz`): `AABB`[]

The boxes the branch voxel of `block` at `vx, vy, vz` is drawn and
collides as, in blocks of the voxel: its core and an arm toward each
joined neighbour (see `branch.ts`). Empty for a block that is not a
branch.

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../#block) |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`AABB`[]

___

### getChunkByCoords

▸ **getChunkByCoords**(`cx`, `cz`): [`Chunk`](Chunk.md)

Get a chunk by its 2D coordinates.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The x coordinate of the chunk. |
| `cz` | `number` | The z coordinate of the chunk. |

#### Returns

[`Chunk`](Chunk.md)

The chunk at the given coordinates, or undefined if it does not exist.

___

### getChunkByName

▸ **getChunkByName**(`name`): [`Chunk`](Chunk.md)

Get a chunk by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the chunk to get. |

#### Returns

[`Chunk`](Chunk.md)

The chunk with the given name, or undefined if it does not exist.

___

### getChunkByPosition

▸ **getChunkByPosition**(`px`, `py`, `pz`): [`Chunk`](Chunk.md)

Get a chunk that contains a given position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

[`Chunk`](Chunk.md)

The chunk that contains the position at the given position, or undefined if it does not exist.

___

### getChunkStatus

▸ **getChunkStatus**(`cx`, `cz`): ``"requested"`` \| ``"processing"`` \| ``"loaded"`` \| ``"to request"``

Get the status of a chunk.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The x 2D coordinate of the chunk. |
| `cz` | `number` | The z 2D coordinate of the chunk. |

#### Returns

``"requested"`` \| ``"processing"`` \| ``"loaded"`` \| ``"to request"``

The status of the chunk.

___

### getIsolatedBlockMaterialAt

▸ **getIsolatedBlockMaterialAt**(`voxel`, `faceName`, `defaultDimension?`): [`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |
| `faceName` | `string` |
| `defaultDimension?` | `number` |

#### Returns

[`CustomChunkShaderMaterial`](../#customchunkshadermaterial)

___

### getLightColorAt

▸ **getLightColorAt**(`vx`, `vy`, `vz`): `Color`

Get a color instance that represents what an object would be like
if it were rendered at the given 3D voxel coordinate. This is useful
to dynamically shade objects based on their position in the world. Also
used in [LightShined](LightShined.md).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`Color`

The voxel's light color at the given coordinate.

___

### getLightValuesAt

▸ **getLightValuesAt**(`vx`, `vy`, `vz`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `blue` | `number` |
| `green` | `number` |
| `red` | `number` |
| `sunlight` | `number` |

___

### getMaxHeightAt

▸ **getMaxHeightAt**(`px`, `pz`): `number`

Get the highest block at a x/z position. Highest block means the first block counting downwards that
isn't empty (`isEmpty`).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`number`

The highest block at the given position, or 0 if it does not exist.

___

### getMemoryCounters

▸ **getMemoryCounters**(): [`WorldMemoryCounters`](../#worldmemorycounters)

Live sizes of every queue and in-flight set in the voxel update ->
relight -> remesh pipeline, plus the bytes of serialized chunk payloads
parked in worker queues. This is the memory-pressure dashboard for
debugging update-flood OOMs (mass terrain edits): sample it while
carving and watch which stage balloons.

#### Returns

[`WorldMemoryCounters`](../#worldmemorycounters)

___

### getPreviousValueAt

▸ **getPreviousValueAt**(`px`, `py`, `pz`, `count?`): `number`

Get the previous value of a voxel by a 3D world position.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `px` | `number` | `undefined` | The x coordinate of the position. |
| `py` | `number` | `undefined` | The y coordinate of the position. |
| `pz` | `number` | `undefined` | The z coordinate of the position. |
| `count` | `number` | `1` | By how much to look back in the history. Defaults to `1`. |

#### Returns

`number`

___

### getRawVoxelAt

▸ **getRawVoxelAt**(`px`, `py`, `pz`): `number`

The whole packed voxel word at a 3D world position — id, rotation,
stage and waterlogging together — or 0 where no chunk is loaded. For
callers that compare voxel states as a unit; `getVoxelAt` and its
siblings unpack one field each.

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`number`

___

### getSunlightAt

▸ **getSunlightAt**(`px`, `py`, `pz`): `number`

Get a voxel sunlight by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`number`

The voxel sunlight at the given position, or 0 if it does not exist.

___

### getTextureInfo

▸ **getTextureInfo**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `sharedAtlas` | \{ `canvas`: `HTMLCanvasElement` ; `countPerSide`: `number`  } |
| `sharedAtlas.canvas` | `HTMLCanvasElement` |
| `sharedAtlas.countPerSide` | `number` |
| `textures` | [`TextureInfo`](../#textureinfo)[] |

___

### getTorchLightAt

▸ **getTorchLightAt**(`px`, `py`, `pz`, `color`): `number`

Get a voxel torch light by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |
| `color` | [`LightColor`](../#lightcolor) | The color of the torch light. |

#### Returns

`number`

The voxel torchlight at the given position, or 0 if it does not exist.

___

### getVoxelAt

▸ **getVoxelAt**(`px`, `py`, `pz`): `number`

Get a voxel by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`number`

The voxel at the given position, or 0 if it does not exist.

___

### getVoxelRotationAt

▸ **getVoxelRotationAt**(`px`, `py`, `pz`): [`BlockRotation`](BlockRotation.md)

Get a voxel rotation by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

[`BlockRotation`](BlockRotation.md)

The voxel rotation at the given position, or the default rotation if it does not exist.

___

### getVoxelStageAt

▸ **getVoxelStageAt**(`px`, `py`, `pz`): `number`

Get a voxel stage by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`number`

The voxel stage at the given position, or 0 if it does not exist.

___

### getVoxelWaterlogLevelAt

▸ **getVoxelWaterlogLevelAt**(`px`, `py`, `pz`): `number`

The level of waterlogging fluid held by the voxel at a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`number`

___

### getVoxelWaterloggedAt

▸ **getVoxelWaterloggedAt**(`px`, `py`, `pz`): `boolean`

Whether the voxel at a 3D world position holds the world's waterlogging
fluid alongside its block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`boolean`

___

### hasCustomBlockMaterial

▸ **hasCustomBlockMaterial**(`id`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`boolean`

___

### initialize

▸ **initialize**(): `Promise`<`void`\>

Initialize the world with the data received from the server. This includes populating
the registry, setting the options, and creating the texture atlas.

#### Returns

`Promise`<`void`\>

___

### isCameraSubmerged

▸ **isCameraSubmerged**(): `boolean`

Whether the camera is under water, by the same smoothed submersion the
water shaders read: which side of the water a see-through layer in the
camera's medium draws on (`TRANSPARENT_SORT`).

#### Returns

`boolean`

___

### isChunkInView

▸ **isChunkInView**(`center`, `target`, `direction`, `threshold`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | [`Coords2`](../#coords2) |
| `target` | [`Coords2`](../#coords2) |
| `direction` | `Vector3` |
| `threshold` | `number` |

#### Returns

`boolean`

___

### isFluidOrWaterloggedAt

▸ **isFluidOrWaterloggedAt**(`vx`, `vy`, `vz`): `boolean`

Whether the voxel at a world position holds water: either it is a fluid
block or a block waterlogged with the world's fluid. Reads the packed
voxel word once off the chunk instead of resolving the chunk twice (once
for the waterlogging bit, once for the block).

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`boolean`

___

### isWithinWorld

▸ **isWithinWorld**(`cx`, `cz`): `boolean`

Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
is within [WorldServerOptions.minChunk](../#worldserveroptions) and [WorldServerOptions.maxChunk](../#worldserveroptions).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The chunk's X position. |
| `cz` | `number` | The chunk's Z position. |

#### Returns

`boolean`

Whether or not this chunk is within the bounds of the world.

___

### makeBlockMesh

▸ **makeBlockMesh**(`idOrName`, `options?`): `Group`<`Object3DEventMap`\>

Get a mesh of the model of the given block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | - |
| `options` | `Partial`<\{ `cached`: `boolean` ; `centered`: `boolean` ; `crumbs`: `boolean` ; `material`: ``"basic"`` \| ``"standard"`` ; `separateFaces`: `boolean`  }\> | The options of creating this block mesh. |

#### Returns

`Group`<`Object3DEventMap`\>

A 3D mesh (group) of the block model.

___

### measureWaterColumnAt

▸ **measureWaterColumnAt**(`x`, `y`, `z`): [`WaterColumnSample`](../#watercolumnsample)

The water column standing over a point — its depth below the resting
surface and where that surface sits — or `null` when the point is not
in water. See [measureWaterColumn](../#measurewatercolumn) for the walk itself.

A column is one (x, z), so it lives in exactly one chunk: the chunk
resolves once and every block of the walk is a raw read off it. The
per-block `getBlockAt` walk this replaces paid a chunk name lookup and
a registry lookup for every block between the point and the surface,
so a fish forty blocks down cost forty of each, several times a second.

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

[`WaterColumnSample`](../#watercolumnsample)

___

### meshChunkLocally

▸ **meshChunkLocally**(`cx`, `cz`, `level`, `generation?`, `isPriority?`): `Promise`<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `cx` | `number` | `undefined` |
| `cz` | `number` | `undefined` |
| `level` | `number` | `undefined` |
| `generation?` | `number` | `undefined` |
| `isPriority` | `boolean` | `false` |

#### Returns

`Promise`<`void`\>

___

### meshVoxelBox

▸ **meshVoxelBox**(`box`): `Promise`<[`VoxelBoxMesh`](../#voxelboxmesh)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `box` | [`VoxelBoxInput`](../#voxelboxinput) |

#### Returns

`Promise`<[`VoxelBoxMesh`](../#voxelboxmesh)\>

___

### off

▸ **off**<`K`\>(`event`, `listener`): `this`

Unregister a typed event listener for chunk lifecycle events.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof [`WorldChunkEvents`](../#worldchunkevents) |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `K` | The event name to stop listening to. |
| `listener` | [`WorldChunkEvents`](../#worldchunkevents)[`K`] | The callback function to remove. |

#### Returns

`this`

The world instance for chaining.

___

### on

▸ **on**<`K`\>(`event`, `listener`): `this`

Register a typed event listener for chunk lifecycle events.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof [`WorldChunkEvents`](../#worldchunkevents) |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `K` | The event name to listen to. |
| `listener` | [`WorldChunkEvents`](../#worldchunkevents)[`K`] | The callback function to execute when the event is emitted. |

#### Returns

`this`

The world instance for chaining.

___

### onContextRestored

▸ **onContextRestored**(): `void`

GPU context restored: every chunk atlas already mirrors its animated
patches onto its own backing canvas as they draw (`AtlasTexture.
commitAnimationPatch`), so re-uploading it is just `needsUpdate = true`
on the texture three.js already holds — nothing to rebuild from
scratch. Local lights pack their own GPU-resident grids and shadow
atlas outside three's texture pipeline, so they get their own hook.
Wire this to the canvas's `webglcontextrestored` event (after calling
`preventDefault()` in a `webglcontextlost` listener — without it the
browser never attempts to restore the context at all).

#### Returns

`void`

___

### onDispose

▸ **onDispose**(`callback`): () => `void`

Tie a resource to this world's lifetime: `callback` runs once when the
world is disposed (at once, if it already has been). For timers, DOM
listeners and other things that close over the world from outside the
scene graph -- a texture repainted on an interval, a subscription -- and
would otherwise outlive it. A page that mounts a second world (a
hot-reload remount) keeps every such closure of the first alive, and the
world behind it, until the tab is reloaded.

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | () => `void` |

#### Returns

`fn`

A function that unregisters the callback.

▸ (): `void`

##### Returns

`void`

___

### once

▸ **once**<`K`\>(`event`, `listener`): `this`

Register a one-time typed event listener for chunk lifecycle events.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `K` | extends keyof [`WorldChunkEvents`](../#worldchunkevents) |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `K` | The event name to listen to once. |
| `listener` | [`WorldChunkEvents`](../#worldchunkevents)[`K`] | The callback function to execute when the event is emitted. |

#### Returns

`this`

The world instance for chaining.

___

### orderIndependentBandOf

▸ **orderIndependentBandOf**(`object`, `material`): `number`

See [TransparentMediumSource.orderIndependentBandOf](../interfaces/TransparentMediumSource.md#orderindependentbandof).

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Object3DEventMap`\> |
| `material` | `Material` |

#### Returns

`number`

___

### prepareTransparency

▸ **prepareTransparency**(`renderer`, `camera`): `void`

Call once a frame with the camera the scene is about to render with,
before that render. Drawing order-independently, it draws the depth of
the water in view (the surface the blended layers are split at, see
`OrderIndependentSeparator`), arms the accumulation for that camera,
and re-plans the see-through meshes when a block texture was written
since (a texture can gain or lose its translucent texels). Sorted, it
draws the depth of the water near the panes in view (`WaterDepthPass`);
a frame without it draws every pane before the water.

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `camera` | `Camera` |

#### Returns

`void`

___

### raycastVoxels

▸ **raycastVoxels**(`origin`, `direction`, `maxDistance`, `options?`): `Object`

Raycast through the world of voxels and return the details of the first block intersection.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `origin` | [`Coords3`](../#coords3) | The origin of the ray. |
| `direction` | [`Coords3`](../#coords3) | The direction of the ray. |
| `maxDistance` | `number` | The maximum distance of the ray. |
| `options` | `Object` | The options for the ray. |
| `options.ignoreFluids?` | `boolean` | Whether or not to ignore fluids. Defaults to `true`. |
| `options.ignoreList?` | `number`[] | A list of blocks to ignore. Defaults to `[]`. |
| `options.ignorePassables?` | `boolean` | Whether or not to ignore passable blocks. Defaults to `false`. |
| `options.ignoreSeeThrough?` | `boolean` | Whether or not to ignore see through blocks. Defaults to `false`. |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `normal` | `number`[] |
| `point` | `number`[] |
| `voxel` | `number`[] |

___

### removeAABBOverride

▸ **removeAABBOverride**(`voxel`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |

#### Returns

`void`

___

### removeLight

▸ **removeLight**(`voxel`, `color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |
| `color` | [`LightColor`](../#lightcolor) |

#### Returns

`void`

___

### removeLightsBatch

▸ **removeLightsBatch**(`voxels`, `color`): `void`

Batch remove light from multiple voxels that previously emitted the same light color.
This drastically improves performance when many contiguous light sources are removed at once.

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxels` | [`Coords3`](../#coords3)[] |
| `color` | [`LightColor`](../#lightcolor) |

#### Returns

`void`

___

### renderShadowMaps

▸ **renderShadowMaps**(`renderer`, `entities?`, `instancePools?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `entities?` | `Object3D`<`Object3DEventMap`\>[] |
| `instancePools?` | `Group`<`Object3DEventMap`\>[] |

#### Returns

`void`

___

### setAABBOverride

▸ **setAABBOverride**(`voxel`, `aabbs`, `owner?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |
| `aabbs` | `AABB`[] |
| `owner?` | [`Coords3`](../#coords3) |

#### Returns

`void`

___

### setBlockEntityDataAt

▸ **setBlockEntityDataAt**(`px`, `py`, `pz`, `data`, `options?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `data` | `T` |
| `options?` | `Object` |
| `options.replace?` | `boolean` |

#### Returns

`void`

___

### setBlockSway

▸ **setBlockSway**(`idOrName`, `options?`): `void`

Register a sway profile for a cutout block instead of compiling it a
bespoke material: the block stays in its shared cutout bucket and its
quads carry the profile's index into the table
[createSwayTableShader](../#createswaytableshader) reads. Parameter defaults mirror
[createSwayShader](../#createswayshader); `isCrossShaded` selects the flattened
cross-quad shading the dedicated cross materials used to bake in.

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `options` | `Partial`<\{ `amplitude`: `number` ; `isCrossShaded`: `boolean` ; `rooted`: `boolean` ; `scale`: `number` ; `speed`: `number` ; `yScale`: `number`  }\> |

#### Returns

`void`

___

### setBlockTextureFiltering

▸ **setBlockTextureFiltering**(`mode`): `void`

Flips how every chunk atlas samples at glancing angles, live: no world
rebuild, no chunk remesh, just the texture's filter/mip state (see
`AtlasTexture.applyFiltering`, `WorldOptions.blockTextureFiltering`).
Meant for an A/B run — flip it, hold a pose, measure, flip it back.

#### Parameters

| Name | Type |
| :------ | :------ |
| `mode` | ``"nearest"`` \| ``"mip-aniso"`` |

#### Returns

`void`

___

### setResolutionOf

▸ **setResolutionOf**(`idOrName`, `faceNames`, `resolution`): `Promise`<`void`\>

Apply a resolution to a block. This will set the resolution of the block's texture atlas.
Keep in mind that this face or faces must be independent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | The ID or name of the block. |
| `faceNames` | `string` \| `string`[] | The face name or names to apply the resolution to. |
| `resolution` | `number` \| \{ `x`: `number` ; `y`: `number`  } | The resolution to apply to the block, in pixels. |

#### Returns

`Promise`<`void`\>

___

### setSectionReveal

▸ **setSectionReveal**(`cx`, `cz`, `level`, `reveal`): `boolean`

Draw a section partway through its own fog color: `0` is pure fog tint
(the sky-dome gradient it would vanish into at distance), `1` is the
section as itself. The terrain fade-in drives this per frame.

Reaches both render paths of a section. Its shared-opaque geometry lives
in a region arena slot, whose per-instance batching color carries the
value into `vChunkReveal`; everything else is a per-section mesh on a
shared material, which gets the value through a per-draw `uChunkReveal`
that is reset after each draw so the same material draws every other
chunk unrevealed. Returns whether the section had anything to draw.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `reveal` | `number` |

#### Returns

`boolean`

___

### setShowGreedyDebug

▸ **setShowGreedyDebug**(`show`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `show` | `boolean` |

#### Returns

`void`

___

### setSunlightAt

▸ **setSunlightAt**(`px`, `py`, `pz`, `level`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### setTorchLightAt

▸ **setTorchLightAt**(`px`, `py`, `pz`, `level`, `color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `level` | `number` |
| `color` | [`LightColor`](../#lightcolor) |

#### Returns

`void`

___

### setVoxelAt

▸ **setVoxelAt**(`px`, `py`, `pz`, `voxel`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `voxel` | `number` |

#### Returns

`void`

___

### setVoxelRotationAt

▸ **setVoxelRotationAt**(`px`, `py`, `pz`, `rotation`): `void`

Set a voxel rotation at a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |
| `rotation` | [`BlockRotation`](BlockRotation.md) | The rotation to set. |

#### Returns

`void`

___

### setVoxelStageAt

▸ **setVoxelStageAt**(`px`, `py`, `pz`, `stage`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `stage` | `number` |

#### Returns

`void`

___

### setVoxelWaterlogLevelAt

▸ **setVoxelWaterlogLevelAt**(`px`, `py`, `pz`, `level`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### setVoxelWaterloggedAt

▸ **setVoxelWaterloggedAt**(`px`, `py`, `pz`, `isWaterlogged`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |
| `isWaterlogged` | `boolean` |

#### Returns

`void`

___

### textureCensus

▸ **textureCensus**(): [`TextureCensus`](../#texturecensus)

What every block surface is wearing right now: atlas slots, own-texture
face defaults, and every voxel's isolated face, with the ones not yet
in their own art listed worst first. The harness asserts on this after
a load; a human would otherwise be hunting the scene for magenta.

#### Returns

[`TextureCensus`](../#texturecensus)

___

### transparentMediumAt

▸ **transparentMediumAt**(`x`, `y`, `z`): [`TransparentMedium`](../#transparentmedium)

The medium at a world position, for `TRANSPARENT_SORT`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

[`TransparentMedium`](../#transparentmedium)

___

### update

▸ **update**(`position?`, `direction?`, `camera?`, `isSpectating?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `position` | `Vector3` | `undefined` |
| `direction` | `Vector3` | `undefined` |
| `camera?` | `Camera` | `undefined` |
| `isSpectating` | `boolean` | `false` |

#### Returns

`void`

___

### updateShaderLighting

▸ **updateShaderLighting**(`camera`, `position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `camera` | `Camera` |
| `position` | `Vector3` |

#### Returns

`void`

___

### updateSkyAndClouds

▸ **updateSkyAndClouds**(`position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |

#### Returns

`void`

___

### updateVoxel

▸ **updateVoxel**(`vx`, `vy`, `vz`, `type`, `options`): `void`

This sends a block update to the server and updates across the network. Block updates are queued to
World.chunks | World.chunks.toUpdate and scaffolded to the server [WorldClientOptions.maxUpdatesPerUpdate](../#worldclientoptions) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
- Rotation: [PX_ROTATION](../#px_rotation) | [NX_ROTATION](../#nx_rotation) | [PY_ROTATION](../#py_rotation) | [NY_ROTATION](../#ny_rotation) | [PZ_ROTATION](../#pz_rotation) | [NZ_ROTATION](../#nz_rotation)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../#y_rot_segments) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../#block) (Same for if
block is not [Block.yRotatable](../#block)).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |
| `type` | `number` | The type of the voxel. |
| `options` | `Object` | The options for the voxel. |
| `options.rotation?` | `number` | The major axis rotation of the voxel. |
| `options.source?` | ``"client"`` \| ``"server"`` | Whether the update is from the client or server. Defaults to "client". |
| `options.stage?` | `number` | The stage of the voxel. |
| `options.yRotation?` | `number` | The Y rotation on the major axis. Applies to blocks with major axis of PY or NY. |

#### Returns

`void`

___

### updateVoxels

▸ **updateVoxels**(`updates`, `source?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `updates` | [`BlockUpdate`](../#blockupdate)[] | `undefined` |
| `source` | ``"client"`` \| ``"server"`` | `"client"` |

#### Returns

`void`

___

### updateWaterOptics

▸ **updateWaterOptics**(`cameraPosition`, `deltaSeconds`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cameraPosition` | `Vector3` |
| `deltaSeconds` | `number` |

#### Returns

`void`
