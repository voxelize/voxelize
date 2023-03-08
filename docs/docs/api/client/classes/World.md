---
id: "World"
title: "Class: World"
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
- [registry](World.md#registry-4): A block registry that handles block textures and block instances.
- [chunks](World.md#chunks-4): A chunk manager that stores all the chunks in the world.
- [physics](World.md#physics-4): A physics engine that handles voxel AABB physics simulation of client-side physics.
- [loader](World.md#loader-4): An asset loader that handles loading textures and other assets.

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

## Hierarchy

- `Scene`

  ↳ **`World`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Methods

### addChunkInitListener

▸ **addChunkInitListener**(`coords`, `listener`): `void`

Add a listener to a chunk. This listener will be called when this chunk is loaded and ready to be rendered.
This is useful for, for example, teleporting the player to the top of the chunk when the player just joined.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2-4) | The chunk coordinates to listen to. |
| `listener` | (`chunk`: `Chunk`) => `void` | The listener to add. |

#### Returns

`void`

___

### applyBlockFrames

▸ **applyBlockFrames**(`idOrName`, `faceNames`, `keyframes`, `fadeFrames?`): `Promise`<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | `undefined` |
| `faceNames` | `string` \| `string`[] | `undefined` |
| `keyframes` | [`number`, `string` \| `HTMLImageElement` \| `Color`][] | `undefined` |
| `fadeFrames` | `number` | `0` |

#### Returns

`Promise`<`void`\>

___

### applyBlockGif

▸ **applyBlockGif**(`idOrName`, `faceNames`, `source`, `interval?`): `Promise`<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `idOrName` | `string` | `undefined` |
| `faceNames` | `string` \| `string`[] | `undefined` |
| `source` | `string` | `undefined` |
| `interval` | `number` | `66.6666667` |

#### Returns

`Promise`<`void`\>

___

### applyBlockTexture

▸ **applyBlockTexture**(`idOrName`, `faceNames`, `source`): `Promise`<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `faceNames` | `string` \| `string`[] |
| `source` | `string` \| `Texture` \| `HTMLImageElement` \| `Color` |

#### Returns

`Promise`<`void`\>

___

### applyBlockTextures

▸ **applyBlockTextures**(`data`): `Promise`<`void`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | { `faceNames`: `string` \| `string`[] ; `idOrName`: `string` \| `number` ; `source`: `string` \| `Color`  }[] |

#### Returns

`Promise`<`void`[]\>

___

### customizeBlockDynamic

▸ **customizeBlockDynamic**(`idOrName`, `fn`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `fn` | (`pos`: [`Coords3`](../modules.md#coords3-4), `world`: [`World`](World.md)) => { `aabbs`: `AABB`[] ; `faces`: { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `independent`: `boolean` ; `name`: `string` ; `range`: [`TextureRange`](../modules.md#texturerange-4)  }[] ; `isTransparent`: `boolean`[]  } |

#### Returns

`void`

___

### customizeMaterialShaders

▸ **customizeMaterialShaders**(`idOrName`, `faceName?`, `data?`): [`CustomShaderMaterial`](../modules.md#customshadermaterial-4)

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

[`CustomShaderMaterial`](../modules.md#customshadermaterial-4)

___

### getBlockAt

▸ **getBlockAt**(`px`, `py`, `pz`): [`Block`](../modules.md#block-4)

Get the block type data by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

[`Block`](../modules.md#block-4)

The block at the given position, or null if it does not exist.

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-4)

Get the block type data by a block id.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The block id. |

#### Returns

[`Block`](../modules.md#block-4)

The block data for the given id, or null if it does not exist.

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-4)

Get the block type data by a block name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The block name. |

#### Returns

[`Block`](../modules.md#block-4)

The block data for the given name, or null if it does not exist.

___

### getBlockOf

▸ **getBlockOf**(`idOrName`): [`Block`](../modules.md#block-4)

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |

#### Returns

[`Block`](../modules.md#block-4)

___

### getChunkByCoords

▸ **getChunkByCoords**(`cx`, `cz`): `Chunk`

Get a chunk by its 2D coordinates.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The x coordinate of the chunk. |
| `cz` | `number` | The z coordinate of the chunk. |

#### Returns

`Chunk`

The chunk at the given coordinates, or undefined if it does not exist.

___

### getChunkByName

▸ **getChunkByName**(`name`): `Chunk`

Get a chunk by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the chunk to get. |

#### Returns

`Chunk`

The chunk with the given name, or undefined if it does not exist.

___

### getChunkByPosition

▸ **getChunkByPosition**(`px`, `py`, `pz`): `Chunk`

Get a chunk that contains a given position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |

#### Returns

`Chunk`

The chunk that contains the position at the given position, or undefined if it does not exist.

___

### getChunkStatus

▸ **getChunkStatus**(`cx`, `cz`): ``"to request"`` \| ``"requested"`` \| ``"processing"`` \| ``"loaded"``

Get the status of a chunk.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The x 2D coordinate of the chunk. |
| `cz` | `number` | The z 2D coordinate of the chunk. |

#### Returns

``"to request"`` \| ``"requested"`` \| ``"processing"`` \| ``"loaded"``

The status of the chunk.

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

### getMaterial

▸ **getMaterial**(`idOrName`, `faceName?`): [`CustomShaderMaterial`](../modules.md#customshadermaterial-4)

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `faceName?` | `string` |

#### Returns

[`CustomShaderMaterial`](../modules.md#customshadermaterial-4)

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

### getTorchLightAt

▸ **getTorchLightAt**(`px`, `py`, `pz`, `color`): `number`

Get a voxel torch light by a 3D world position.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `px` | `number` | The x coordinate of the position. |
| `py` | `number` | The y coordinate of the position. |
| `pz` | `number` | The z coordinate of the position. |
| `color` | [`LightColor`](../modules.md#lightcolor-4) | The color of the torch light. |

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

### init

▸ **init**(): `Promise`<`void`\>

Initialize the world with the data received from the server. This includes populating
the registry, setting the parameters, and creating the texture atlas.

#### Returns

`Promise`<`void`\>

___

### isChunkInView

▸ **isChunkInView**(`center`, `target`, `direction`, `threshold`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | [`Coords2`](../modules.md#coords2-4) |
| `target` | [`Coords2`](../modules.md#coords2-4) |
| `direction` | `Vector3` |
| `threshold` | `number` |

#### Returns

`boolean`

___

### isWithinWorld

▸ **isWithinWorld**(`cx`, `cz`): `boolean`

Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
is within [WorldServerParams.minChunk](../modules.md#worldserverparams-4) and [WorldServerParams.maxChunk](../modules.md#worldserverparams-4).

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

▸ **makeBlockMesh**(`idOrName`, `params?`): `Group`

Get a mesh of the model of the given block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrName` | `string` \| `number` | - |
| `params` | `Partial`<{ `crumbs`: `boolean` ; `material`: ``"basic"`` \| ``"standard"`` ; `separateFaces`: `boolean`  }\> | The params of creating this block mesh. |

#### Returns

`Group`

A 3D mesh (group) of the block model.

___

### raycastVoxels

▸ **raycastVoxels**(`origin`, `direction`, `maxDistance`, `options?`): `Object`

Raycast through the world of voxels and return the details of the first block intersection.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `origin` | [`Coords3`](../modules.md#coords3-4) | The origin of the ray. |
| `direction` | [`Coords3`](../modules.md#coords3-4) | The direction of the ray. |
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

### setResolutionOf

▸ **setResolutionOf**(`idOrName`, `faceNames`, `resolution`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `idOrName` | `string` \| `number` |
| `faceNames` | `string` \| `string`[] |
| `resolution` | `number` |

#### Returns

`void`

___

### update

▸ **update**(`position?`, `direction?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |
| `direction` | `Vector3` |

#### Returns

`void`

___

### updateVoxel

▸ **updateVoxel**(`vx`, `vy`, `vz`, `type`, `rotation?`, `yRotation?`): `void`

This sends a block update to the server and updates across the network. Block updates are queued to
[World.chunks.toUpdate](World.md#chunks-4) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams-4) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
- Rotation: [PX_ROTATION](../modules.md#px_rotation-4) | [NX_ROTATION](../modules.md#nx_rotation-4) | [PY_ROTATION](../modules.md#py_rotation-4) | [NY_ROTATION](../modules.md#ny_rotation-4) | [PZ_ROTATION](../modules.md#pz_rotation-4) | [NZ_ROTATION](../modules.md#nz_rotation-4)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments-4) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block-4) (Same for if
block is not [Block.yRotatable](../modules.md#block-4)).

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `vx` | `number` | `undefined` | The voxel's X position. |
| `vy` | `number` | `undefined` | The voxel's Y position. |
| `vz` | `number` | `undefined` | The voxel's Z position. |
| `type` | `number` | `undefined` | The type of the voxel. |
| `rotation` | `number` | `PY_ROTATION` | The major axis rotation of the voxel. |
| `yRotation` | `number` | `0` | The Y rotation on the major axis. Applies to blocks with major axis of PY or NY. |

#### Returns

`void`

___

### updateVoxels

▸ **updateVoxels**(`updates`): `void`

This sends a list of block updates to the server and updates across the network. Block updates are queued to
[World.chunks.toUpdate](World.md#chunks-4) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams-4) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:

- Rotation: [PX_ROTATION](../modules.md#px_rotation-4) | [NX_ROTATION](../modules.md#nx_rotation-4) | [PY_ROTATION](../modules.md#py_rotation-4) | [NY_ROTATION](../modules.md#ny_rotation-4) | [PZ_ROTATION](../modules.md#pz_rotation-4) | [NZ_ROTATION](../modules.md#nz_rotation-4)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments-4) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block-4) (Same for if
block is not [Block.yRotatable](../modules.md#block-4)).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `updates` | [`BlockUpdate`](../modules.md#blockupdate-4)[] | A list of updates to send to the server. |

#### Returns

`void`

## Properties

### chunks

• **chunks**: `Chunks`

The manager that holds all chunk-related data.

___

### initialized

• **initialized**: `boolean` = `false`

Whether or not this world is connected to the server and initialized with server data.

___

### loader

• **loader**: [`Loader`](Loader.md)

An asset loader to load in things like textures, images, GIFs and audio buffers.

___

### materialStore

• **materialStore**: `Map`<`string`, [`CustomShaderMaterial`](../modules.md#customshadermaterial-4)\>

A map of all block faces to their corresponding ThreeJS shader materials. This also holds their corresponding textures.

___

### params

• **params**: [`WorldParams`](../modules.md#worldparams-4)

The parameters to create the world.

___

### physics

• **physics**: `Engine`

The voxel physics engine using `@voxelize/physics-engine`.

___

### registry

• **registry**: [`Registry`](Registry.md)

The block registry that holds all block data.

___

### uniforms

• **uniforms**: `Object`

The WebGL uniforms that are used in the chunk shader.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `ao` | { `value`: `Vector4`  } | The ambient occlusion levels that are applied onto the chunk meshes. Check out [this article](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/) for more information on ambient occlusion for voxel worlds. Defaults to `new Vector4(100.0, 170.0, 210.0, 255.0)`. |
| `ao.value` | `Vector4` | The value passed into the chunk shader. |
| `fogColor` | { `value`: `Color`  } | The fog color that is applied onto afar chunks. It is recommended to set this to the middle color of the sky. Defaults to a new THREE.JS white color instance. |
| `fogColor.value` | `Color` | The value passed into the chunk shader. |
| `fogFar` | { `value`: `number`  } | The far distance of the fog. Defaults to `200` units. |
| `fogFar.value` | `number` | The value passed into the chunk shader. |
| `fogNear` | { `value`: `number`  } | The near distance of the fog. Defaults to `100` units. |
| `fogNear.value` | `number` | The value passed into the chunk shader. |
| `minBrightness` | { `value`: `number`  } | The minimum brightness of the world at light level `0`. Defaults to `0.2`. |
| `minBrightness.value` | `number` | The value passed into the chunk shader. |
| `sunlightIntensity` | { `value`: `number`  } | The sunlight intensity of the world. Changing this to `0` would effectively simulate night time in Voxelize. Defaults to `1.0`. |
| `sunlightIntensity.value` | `number` | The value passed into the chunk shader. |
| `time` | { `value`: `number`  } | The time constant `performance.now()` that is used to animate the world. Defaults to `performance.now()`. |
| `time.value` | `number` | The value passed into the chunk shader. |

## Constructors

### constructor

• **new World**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`WorldParams`](../modules.md#worldparams-4)\> |

#### Overrides

Scene.constructor

## Accessors

### deleteRadius

• `get` **deleteRadius**(): `number`

#### Returns

`number`

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
