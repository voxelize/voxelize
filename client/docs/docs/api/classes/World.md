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

There are a couple important components that are by default created by the world:
- [World.registry](World.md#registry-384): A block registry that handles block textures and block instances.
- [World.chunks](World.md#chunks-384): A chunk manager that stores all the chunks in the world.
- [World.physics](World.md#physics-384): A physics engine that handles voxel AABB physics simulation of client-side physics.
- [World.loader](World.md#loader-384): An asset loader that handles loading textures and other assets.
- [World.atlas](World.md#atlas-384): A texture atlas that handles texture packing.

One thing to keep in mind that there are no specific setters like `setVoxelByVoxel` or `setVoxelRotationByVoxel`.
This is because, instead, you should use `updateVoxel` and `updateVoxels` to update voxels.

# Example
```ts
const world = new VOXELIZE.World();

// Update a voxel in the world across the network.
world.updateVoxel({
  vx: 0,
  vy: 0,
  vz: 0,
  type: 12,
});

// Register the interceptor with the network.
network.register(world);

// Register an image to block sides.
world.registry.applyTextureByName({
  name: "Test",
  sides: VOXELIZE.ALL_FACES,
  data: "https://example.com/test.png"
});

// Update the world every frame.
world.update(controls.object.position);
```

![World](/img/world.png)

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
| `coords` | [`Coords2`](../modules.md#coords2-384) | The chunk coordinates to listen to. |
| `listener` | (`chunk`: [`Chunk`](Chunk.md)) => `void` | The listener to add. |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata-384) | The data of the texture and where the texture is applying to. |

#### Returns

`void`

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata-384)[] | List of data to load into the game before the game starts. |

#### Returns

`void`

___

### getBlockAABBsByVoxel

▸ **getBlockAABBsByVoxel**(`vx`, `vy`, `vz`, `ignoreFluid?`): `AABB`[]

Get the block AABBs by the given 3D voxel coordinate.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `vx` | `number` | `undefined` | The voxel's X position. |
| `vy` | `number` | `undefined` | The voxel's Y position. |
| `vz` | `number` | `undefined` | The voxel's Z position. |
| `ignoreFluid` | `boolean` | `false` | Whether to ignore fluid blocks. |

#### Returns

`AABB`[]

The AABB of the block at the given coordinate.

___

### getBlockAABBsByWorld

▸ **getBlockAABBsByWorld**(`wx`, `wy`, `wz`, `ignoreFluid?`): `AABB`[]

Get the block AABBs by the given 3D world coordinate.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `wx` | `number` | `undefined` | The voxel's un-floored X position. |
| `wy` | `number` | `undefined` | The voxel's un-floored Y position. |
| `wz` | `number` | `undefined` | The voxel's un-floored Z position. |
| `ignoreFluid` | `boolean` | `false` | Whether to ignore fluid blocks. |

#### Returns

`AABB`[]

The AABB of the block at the given coordinate.

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-384)

Get the block information by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block-384)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-384)

Get the block information by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block-384)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block-384)

Reverse engineer to get the block information from a texture name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

[`Block`](../modules.md#block-384)

___

### getBlockByVoxel

▸ **getBlockByVoxel**(`vx`, `vy`, `vz`): [`Block`](../modules.md#block-384)

Get the block data at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

[`Block`](../modules.md#block-384)

The block type data at the given coordinate.

___

### getBlockByWorld

▸ **getBlockByWorld**(`wx`, `wy`, `wz`): [`Block`](../modules.md#block-384)

Get the block data at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

[`Block`](../modules.md#block-384)

The block type data at the given coordinate.

___

### getChunk

▸ **getChunk**(`cx`, `cz`): [`Chunk`](Chunk.md)

Get a chunk instance by its 2D coordinates.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The 2D chunk X position. |
| `cz` | `number` | The 2D chunk Z position. |

#### Returns

[`Chunk`](Chunk.md)

The chunk at the given coordinate.

___

### getChunkByName

▸ **getChunkByName**(`name`): [`Chunk`](Chunk.md)

Get a chunk instance by its coordinate representation.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The 2D coordinate representation of the chunk. |

#### Returns

[`Chunk`](Chunk.md)

The chunk at the given coordinate.

___

### getChunkByVoxel

▸ **getChunkByVoxel**(`vx`, `vy`, `vz`): [`Chunk`](Chunk.md)

Get a chunk by a 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

[`Chunk`](Chunk.md)

The chunk at the given voxel coordinate.

___

### getLightColorByVoxel

▸ **getLightColorByVoxel**(`vx`, `vy`, `vz`): `Color`

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

### getLightColorByWorld

▸ **getLightColorByWorld**(`wx`, `wy`, `wz`): `Color`

Get a color instance that represents what an object would be like if it
were rendered at the given 3D world coordinate. This is useful to dynamically
shade objects based on their position in the world. Also used in [LightShined](LightShined.md).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`Color`

The voxel's light color at the given coordinate.

___

### getMaxHeightByVoxel

▸ **getMaxHeightByVoxel**(`vx`, `vz`): `number`

Get the maximum height of the block column at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`number`

The max height at the given coordinate.

___

### getMaxHeightByWorld

▸ **getMaxHeightByWorld**(`wx`, `wz`): `number`

Get the maximum height of the block column at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`number`

The max height at the given coordinate.

___

### getMinBrightness

▸ **getMinBrightness**(): `number`

Get the uniform value of the minimum brightness at sunlight `0` voxels.

#### Returns

`number`

The minimum brightness of the chunk.

___

### getPreviousVoxelByVoxel

▸ **getPreviousVoxelByVoxel**(`vx`, `vy`, `vz`): `number`

Get the previous voxel ID before the latest update was made.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`number`

The voxel ID that was previously at the given coordinate.

___

### getPreviousVoxelByWorld

▸ **getPreviousVoxelByWorld**(`wx`, `wy`, `wz`): `number`

Get the previous voxel ID before the latest update was made.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`number`

The voxel ID that was previously at the given coordinate.

___

### getSunlightByVoxel

▸ **getSunlightByVoxel**(`vx`, `vy`, `vz`): `number`

Get the voxel's sunlight level at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`number`

The voxel's sunlight level at the given coordinate.

___

### getSunlightByWorld

▸ **getSunlightByWorld**(`wx`, `wy`, `wz`): `number`

Get the voxel's sunlight level at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`number`

The voxel's sunlight level at the given coordinate.

___

### getSunlightIntensity

▸ **getSunlightIntensity**(): `number`

Get the uniform value of the intensity of sunlight.

#### Returns

`number`

The intensity of the sun.

___

### getTorchLightByVoxel

▸ **getTorchLightByVoxel**(`vx`, `vy`, `vz`, `color`): `number`

Get the voxel's torch light level at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |
| `color` | [`LightColor`](../modules.md#lightcolor-384) | The color of the torch light to get. |

#### Returns

`number`

The voxel's torch light level at the given coordinate.

___

### getTorchLightByWorld

▸ **getTorchLightByWorld**(`wx`, `wy`, `wz`, `color`): `number`

Get the voxel's torch light level at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |
| `color` | [`LightColor`](../modules.md#lightcolor-384) | The color of the torch light to get. |

#### Returns

`number`

The voxel's torch light level at the given coordinate.

___

### getVoxelByVoxel

▸ **getVoxelByVoxel**(`vx`, `vy`, `vz`): `number`

Get the voxel ID at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`number`

The voxel's ID at the given coordinate.

___

### getVoxelByWorld

▸ **getVoxelByWorld**(`wx`, `wy`, `wz`): `number`

Get the voxel ID at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`number`

The voxel's ID at the given coordinate.

___

### getVoxelRotationByVoxel

▸ **getVoxelRotationByVoxel**(`vx`, `vy`, `vz`): [`BlockRotation`](BlockRotation.md)

Get the voxel rotation at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

[`BlockRotation`](BlockRotation.md)

The voxel's rotation at the given coordinate.

___

### getVoxelRotationByWorld

▸ **getVoxelRotationByWorld**(`wx`, `wy`, `wz`): [`BlockRotation`](BlockRotation.md)

Get the voxel rotation at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

[`BlockRotation`](BlockRotation.md)

The voxel's rotation at the given coordinate.

___

### getVoxelStageByVoxel

▸ **getVoxelStageByVoxel**(`vx`, `vy`, `vz`): `number`

Get the voxel's stage at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`number`

The voxel stage at the given coordinate.

___

### getVoxelStageByWorld

▸ **getVoxelStageByWorld**(`wx`, `wy`, `wz`): `number`

Get the voxel's stage at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`number`

The voxel stage at the given coordinate.

___

### isChunkInView

▸ **isChunkInView**(`cx`, `cz`, `dx`, `dz`): `boolean`

This checks if the chunk is within the given x/z directions by testing of the given chunk
coordinate is within `3 * Math.PI / 5` radians of the given direction.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `cx` | `number` | The chunk's X position. |
| `cz` | `number` | The chunk's Z position. |
| `dx` | `number` | The x direction that is being checked. |
| `dz` | `number` | The z direction that is being checked. |

#### Returns

`boolean`

Whether or not the chunk is within the render view.

___

### isWithinWorld

▸ **isWithinWorld**(`cx`, `cz`): `boolean`

Whether or not if this chunk coordinate is within (inclusive) the world's bounds. That is, if this chunk coordinate
is within [WorldServerParams.minChunk](../modules.md#worldserverparams-384) and [WorldServerParams.maxChunk](../modules.md#worldserverparams-384).

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

▸ **makeBlockMesh**(`id`): `Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

Get a mesh of the model of the given block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block. |

#### Returns

`Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

A 3D mesh of the block model.

___

### reset

▸ **reset**(): `void`

Reset the world's chunk and block caches.

#### Returns

`void`

___

### setFogColor

▸ **setFogColor**(`color`): `void`

Set the fog color that is applied to the chunks.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `Color` | The color reference to link the fog to. |

#### Returns

`void`

___

### setFogDistance

▸ **setFogDistance**(`distance`): `void`

Set the farthest distance for the fog. Fog starts fogging up the chunks 50% from the farthest.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | The maximum distance that the fog fully fogs up. |

#### Returns

`void`

___

### setMinBrightness

▸ **setMinBrightness**(`minBrightness`): `void`

Set the uniform value of the minimum brightness at sunlight level of `0` voxels.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `minBrightness` | `number` | The minimum brightness value. |

#### Returns

`void`

___

### setSunlightIntensity

▸ **setSunlightIntensity**(`intensity`): `void`

Set the uniform value of the intensity of sunlight.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `intensity` | `number` | The intensity of the sun. |

#### Returns

`void`

___

### update

▸ **update**(`center`): `void`

The updater of the world. This requests the chunks around the given coordinates and meshes any
new chunks that are received from the server. This should be called every frame.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `center` | `Vector3` | The center of the update. That is, the center that the chunks should    be requested around. |

#### Returns

`void`

___

### updateVoxel

▸ **updateVoxel**(`vx`, `vy`, `vz`, `type`, `rotation?`, `yRotation?`): `void`

This sends a block update to the server and updates across the network. Block updates are queued to
[World.chunks.toUpdate](World.md#chunks-384) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams-384) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
- Rotation: [PX_ROTATION](../modules.md#px_rotation-384) | [NX_ROTATION](../modules.md#nx_rotation-384) | [PY_ROTATION](../modules.md#py_rotation-384) | [NY_ROTATION](../modules.md#ny_rotation-384) | [PZ_ROTATION](../modules.md#pz_rotation-384) | [NZ_ROTATION](../modules.md#nz_rotation-384)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments-384) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block-384) (Same for if
block is not [Block.yRotatable](../modules.md#block-384)).

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
[World.chunks.toUpdate](World.md#chunks-384) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams-384) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:

- Rotation: [PX_ROTATION](../modules.md#px_rotation-384) | [NX_ROTATION](../modules.md#nx_rotation-384) | [PY_ROTATION](../modules.md#py_rotation-384) | [NY_ROTATION](../modules.md#ny_rotation-384) | [PZ_ROTATION](../modules.md#pz_rotation-384) | [NZ_ROTATION](../modules.md#nz_rotation-384)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments-384) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block-384) (Same for if
block is not [Block.yRotatable](../modules.md#block-384)).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `updates` | [`BlockUpdate`](../modules.md#blockupdate-384)[] | A list of updates to send to the server. |

#### Returns

`void`

## Properties

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

The generated texture atlas built from all registered block textures.

___

### blockCache

• **blockCache**: `Map`<`string`, `number`\>

This is a map that keeps track of the block IDs before they are updated to any new block IDs.
Use [World.getPreviousVoxelByVoxel](World.md#getpreviousvoxelbyvoxel-384) and [World.getPreviousVoxelByWorld](World.md#getpreviousvoxelbyworld-384) to get the previous
block ID, if it exists.

___

### chunks

• **chunks**: [`Chunks`](Chunks.md)

A chunk manager that stores useful information about chunks, such as the chunk mesh and chunk data.

___

### initialized

• **initialized**: `boolean` = `false`

Whether or not this world is connected to a server and has configurations and block data loaded from the server.

___

### loader

• **loader**: `Loader`

An asset loader that handles loading textures and other assets.

___

### materials

• **materials**: `Object` = `{}`

The shared material instances for chunks.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-384) | The chunk material that is used to render the opaque portions of the chunk meshes. |
| `transparent?` | { `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial-384) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial-384)  } | The chunk materials that are used to render the transparent portions of the chunk meshes. This consists of two sides of the chunk mesh, front and back. |
| `transparent.back` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-384) | The back side of the chunk mesh's transparent material. |
| `transparent.front` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-384) | The front side of the chunk mesh's transparent material. |

___

### params

• **params**: [`WorldParams`](../modules.md#worldparams-384) = `{}`

Parameters to configure the world. This is a combination of the client-side parameters, [WorldClientParams](../modules.md#worldclientparams-384),
and the server-side parameters, [WorldServerParams](../modules.md#worldserverparams-384). The server-side parameters are defined on the server, and
are sent to the client when the client connects to the server.

___

### physics

• **physics**: `Engine`

A voxel AABB physics engine that handles physics simulation of client-side physics. You can use `world.physics.iterateBody`
individually to iterate over a rigid body.

___

### registry

• **registry**: [`Registry`](Registry.md)

The block registry that handles block textures and block instances.

___

### uniforms

• **uniforms**: `Object`

The WebGL uniforms that are used in the chunk shader.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `ao` | { `value`: `Vector4`  } | The ambient occlusion levels that are applied onto the chunk meshes. Check out [this article](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/) for more information on ambient occlusion for voxel worlds. Defaults to `new Vector4(100.0, 170.0, 210.0, 255.0)`. |
| `ao.value` | `Vector4` | The value passed into the chunk shader. |
| `atlas` | { `value`: `Texture`  } | The 2D texture atlas that is used to render the chunk. This will be set after [World.atlas](World.md#atlas-384) is generated. |
| `atlas.value` | `Texture` | The value passed into the chunk shader. |
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

## Constructors

### constructor

• **new World**(`params?`)

Create a new world instance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Partial`<[`WorldClientParams`](../modules.md#worldclientparams-384)\> | The client-side parameters to configure the world. |

#### Overrides

Scene.constructor

## Accessors

### renderRadius

• `get` **renderRadius**(): `number`

The render radius that this world is requesting chunks at.

#### Returns

`number`

• `set` **renderRadius**(`radius`): `void`

Set the render radius that this world is requesting chunks at.

#### Parameters

| Name | Type |
| :------ | :------ |
| `radius` | `number` |

#### Returns

`void`
