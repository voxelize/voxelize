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
- [registry](World.md#registry): A block registry that handles block textures and block instances.
- [chunks](World.md#chunks): A chunk manager that stores all the chunks in the world.
- [physics](World.md#physics): A physics engine that handles voxel AABB physics simulation of client-side physics.
- [loader](World.md#loader): An asset loader that handles loading textures and other assets.
- [atlas](World.md#atlas): A texture atlas that handles texture packing.

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
world.applyTextureByName("Test", VOXELIZE.ALL_FACES, "https://example.com/test.png");

// Update the world every frame.
world.update(controls.object.position);
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
| `coords` | [`Coords2`](../modules.md#coords2) | The chunk coordinates to listen to. |
| `listener` | (`chunk`: [`Chunk`](Chunk.md)) => `void` | The listener to add. |

#### Returns

`void`

___

### applyBlockAnimationByName

▸ **applyBlockAnimationByName**(`name`, `sides`, `keyframes`, `fadeFrames?`): `void`

Apply a block animation to a block.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `name` | `string` | `undefined` | The name of the block to apply the animation to. |
| `sides` | `string` \| `string`[] | `undefined` | The side(s) of the block to apply the animation to. |
| `keyframes` | [`number`, `string` \| `Color`][] | `undefined` | The keyframes of the animation. The first element is the duration of the animation, and the second element is the source to the texture to apply. |
| `fadeFrames` | `number` | `0` | The number of frames to fade between keyframes. |

#### Returns

`void`

___

### applyBlockGifByName

▸ **applyBlockGifByName**(`name`, `sides`, `source`, `interval?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `name` | `string` | `undefined` |
| `sides` | `string` \| `string`[] | `undefined` |
| `source` | `string` | `undefined` |
| `interval` | `number` | `66.6666667` |

#### Returns

`void`

___

### applyResolutionByName

▸ **applyResolutionByName**(`name`, `sides`, `resolution`): `void`

Apply a resolution to a block face type. Otherwise, the resolution will be the same as the texture
parameter resolution.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to apply the resolution to. |
| `sides` | `string` \| `string`[] | - |
| `resolution` | `number` | The resolution of the block. |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`name`, `sides`, `data`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `sides` | `string` \| `string`[] |
| `data` | `string` \| `Color` |

#### Returns

`void`

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata)[] | List of data to load into the game before the game starts. |

#### Returns

`void`

___

### getBlockAABBsByVoxel

▸ **getBlockAABBsByVoxel**(`vx`, `vy`, `vz`): `AABB`[]

Get the block AABBs by the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

`AABB`[]

The AABB of the block at the given coordinate.

___

### getBlockAABBsByWorld

▸ **getBlockAABBsByWorld**(`wx`, `wy`, `wz`): `AABB`[]

Get the block AABBs by the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

`AABB`[]

The AABB of the block at the given coordinate.

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block)

Get the block information by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block)

Get the block information by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): `Object`

Reverse engineer to get the block information from a texture name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../modules.md#block) |
| `side` | `string` |

___

### getBlockByVoxel

▸ **getBlockByVoxel**(`vx`, `vy`, `vz`): [`Block`](../modules.md#block)

Get the block data at the given 3D voxel coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vx` | `number` | The voxel's X position. |
| `vy` | `number` | The voxel's Y position. |
| `vz` | `number` | The voxel's Z position. |

#### Returns

[`Block`](../modules.md#block)

The block type data at the given coordinate.

___

### getBlockByWorld

▸ **getBlockByWorld**(`wx`, `wy`, `wz`): [`Block`](../modules.md#block)

Get the block data at the given 3D world coordinate.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `wx` | `number` | The voxel's un-floored X position. |
| `wy` | `number` | The voxel's un-floored Y position. |
| `wz` | `number` | The voxel's un-floored Z position. |

#### Returns

[`Block`](../modules.md#block)

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

### getHighResTextureByIdentifier

▸ **getHighResTextureByIdentifier**(`identifier`): [`TextureAtlas`](TextureAtlas.md)

Get the high resolution texture atlas of a certain block face by identifier.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `identifier` | `string` | The identifier of the block face. |

#### Returns

[`TextureAtlas`](TextureAtlas.md)

The [TextureAtlas](TextureAtlas.md) instance linked to the block face.

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

### getMaterialByIdentifier

▸ **getMaterialByIdentifier**(`identifier`, `transparent?`): { `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial)  } \| [`CustomShaderMaterial`](../modules.md#customshadermaterial)

Get a material by a given block ID. If this material does not exist, it will be created.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `identifier` | `string` | `undefined` | The identifier of the block. |
| `transparent` | `boolean` | `false` | - |

#### Returns

{ `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial)  } \| [`CustomShaderMaterial`](../modules.md#customshadermaterial)

The material instances related to the block.

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
| `color` | [`LightColor`](../modules.md#lightcolor) | The color of the torch light to get. |

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
| `color` | [`LightColor`](../modules.md#lightcolor) | The color of the torch light to get. |

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
is within [WorldServerParams.minChunk](../modules.md#worldserverparams) and [WorldServerParams.maxChunk](../modules.md#worldserverparams).

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

### overwriteBlockDynamicByName

▸ **overwriteBlockDynamicByName**(`name`, `fn`): `void`

Overwrite the dynamic function for the block. That is, the function that is called to generate different AABBs and block faces
for the block based on different conditions.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block. |
| `fn` | (`pos`: [`Coords3`](../modules.md#coords3), `world`: [`World`](World.md)) => { `aabbs`: `AABB`[] ; `faces`: { `corners`: { `pos`: `number`[] ; `uv`: `number`[]  }[] ; `dir`: `number`[] ; `highRes`: `boolean` ; `name`: `string`  }[] ; `isTransparent`: `boolean`[]  } | The dynamic function to use for the block. |

#### Returns

`void`

___

### overwriteMaterialByIdentifier

▸ **overwriteMaterialByIdentifier**(`identifier`, `transparent?`, `data?`): { `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial)  } \| [`CustomShaderMaterial`](../modules.md#customshadermaterial)

Overwrite the chunk shader for a certain block within all chunks. This is useful for, for example, making
blocks such as grass to wave in the wind. Keep in mind that higher resolution block faces are separated from
its vanilla counterpart. In other words, with this method, you can only overwrite the material of the block
faces that has not been separated or turned into higher resolution.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `identifier` | `string` | `undefined` | The identifier of the block face. By default, should be the block's name. |
| `transparent` | `boolean` | `false` | - |
| `data` | `Object` | `undefined` | - |
| `data.fragmentShader` | `string` | `undefined` | - |
| `data.uniforms?` | `Object` | `undefined` | - |
| `data.vertexShader` | `string` | `undefined` | - |

#### Returns

{ `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial)  } \| [`CustomShaderMaterial`](../modules.md#customshadermaterial)

___

### raycastVoxels

▸ **raycastVoxels**(`origin`, `direction`, `maxDistance`, `options?`): `Object`

Raycast through the world of voxels and return the details of the first block intersection.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `origin` | [`Coords3`](../modules.md#coords3) | The origin of the ray. |
| `direction` | [`Coords3`](../modules.md#coords3) | The direction of the ray. |
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
[World.chunks.toUpdate](World.md#chunks) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:
- Rotation: [PX_ROTATION](../modules.md#px_rotation) | [NX_ROTATION](../modules.md#nx_rotation) | [PY_ROTATION](../modules.md#py_rotation) | [NY_ROTATION](../modules.md#ny_rotation) | [PZ_ROTATION](../modules.md#pz_rotation) | [NZ_ROTATION](../modules.md#nz_rotation)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block) (Same for if
block is not [Block.yRotatable](../modules.md#block)).

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
[World.chunks.toUpdate](World.md#chunks) and scaffolded to the server [WorldClientParams.maxUpdatesPerTick](../modules.md#worldclientparams) times
per tick. Keep in mind that for rotation and y-rotation, the value should be one of the following:

- Rotation: [PX_ROTATION](../modules.md#px_rotation) | [NX_ROTATION](../modules.md#nx_rotation) | [PY_ROTATION](../modules.md#py_rotation) | [NY_ROTATION](../modules.md#ny_rotation) | [PZ_ROTATION](../modules.md#pz_rotation) | [NZ_ROTATION](../modules.md#nz_rotation)
- Y-rotation: 0 to [Y_ROT_SEGMENTS](../modules.md#y_rot_segments) - 1.

This ignores blocks that are not defined, and also ignores rotations for blocks that are not [Block.rotatable](../modules.md#block) (Same for if
block is not [Block.yRotatable](../modules.md#block)).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `updates` | [`BlockUpdate`](../modules.md#blockupdate)[] | A list of updates to send to the server. |

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
Use [getPreviousVoxelByVoxel](World.md#getpreviousvoxelbyvoxel) and [getPreviousVoxelByWorld](World.md#getpreviousvoxelbyworld) to get the previous
block ID, if it exists.

___

### chunks

• **chunks**: [`Chunks`](Chunks.md)

A chunk manager that stores useful information about chunks, such as the chunk mesh and chunk data.

___

### highResTextures

• **highResTextures**: `Map`<`string`, [`TextureAtlas`](TextureAtlas.md)\>

A map of specific high-resolution block faces.

___

### highResolutions

• **highResolutions**: `Map`<`string`, `number`\>

The resolutions of the texture atlases for each high-resolution block face type.

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

• **materials**: `Object`

The shared material instances for chunks.

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `opaque` | `Map`<`string`, [`CustomShaderMaterial`](../modules.md#customshadermaterial)\> | The chunk material that is used to render the opaque portions of the chunk meshes. |
| `transparent` | `Map`<`string`, { `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial) ; `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial)  }\> | The chunk materials that are used to render the transparent portions of the chunk meshes. This is a map of the block ID (identifier) to the material instances (front & back). |

___

### params

• **params**: [`WorldParams`](../modules.md#worldparams) = `{}`

Parameters to configure the world. This is a combination of the client-side parameters, [WorldClientParams](../modules.md#worldclientparams),
and the server-side parameters, [WorldServerParams](../modules.md#worldserverparams). The server-side parameters are defined on the server, and
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
| `atlas` | { `value`: `Texture`  } | The 2D texture atlas that is used to render the chunk. This will be set after [atlas](World.md#atlas) is generated. |
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
| `time` | { `value`: `number`  } | The time constant `performance.now()` that is used to animate the world. Defaults to `performance.now()`. |
| `time.value` | `number` | The value passed into the chunk shader. |

## Constructors

### constructor

• **new World**(`params?`)

Create a new world instance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `params` | `Partial`<[`WorldClientParams`](../modules.md#worldclientparams)\> | The client-side parameters to configure the world. |

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
