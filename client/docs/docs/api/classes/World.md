---
id: "World"
title: "Class: World"
sidebar_label: "World"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Scene`

  ↳ **`World`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Properties

### params

• **params**: [`WorldParams`](../modules.md#worldparams-210) = `{}`

___

### initialized

• **initialized**: `boolean` = `false`

___

### chunks

• **chunks**: [`Chunks`](Chunks.md)

___

### physics

• **physics**: `Engine`

___

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

The generated texture atlas built from all registered block textures.

___

### uniforms

• **uniforms**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fogColor` | { `value`: `Color`  } |
| `fogColor.value` | `Color` |
| `fogNear` | { `value`: `number`  } |
| `fogNear.value` | `number` |
| `fogFar` | { `value`: `number`  } |
| `fogFar.value` | `number` |
| `atlas` | { `value`: `Texture`  } |
| `atlas.value` | `Texture` |
| `ao` | { `value`: `Vector4`  } |
| `ao.value` | `Vector4` |
| `minBrightness` | { `value`: `number`  } |
| `minBrightness.value` | `number` |
| `sunlightIntensity` | { `value`: `number`  } |
| `sunlightIntensity.value` | `number` |

___

### blockCache

• **blockCache**: `Map`<`string`, `number`\>

___

### registry

• **registry**: [`Registry`](Registry.md)

___

### materials

• **materials**: `Object` = `{}`

The shared material instances for chunks.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-210) |
| `transparent?` | { `front`: [`CustomShaderMaterial`](../modules.md#customshadermaterial-210) ; `back`: [`CustomShaderMaterial`](../modules.md#customshadermaterial-210)  } |
| `transparent.front` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-210) |
| `transparent.back` | [`CustomShaderMaterial`](../modules.md#customshadermaterial-210) |

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-210)

___

### loader

• **loader**: `Loader`

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

Scene.id

___

### uuid

• **uuid**: `string`

#### Inherited from

Scene.uuid

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`default`** ''

#### Inherited from

Scene.name

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`default`** null

#### Inherited from

Scene.parent

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`default`** []

#### Inherited from

Scene.children

___

### up

• **up**: `Vector3`

Up direction.

**`default`** THREE.Object3D.DefaultUp.clone()

#### Inherited from

Scene.up

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`default`** new THREE.Vector3()

#### Inherited from

Scene.position

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`default`** new THREE.Euler()

#### Inherited from

Scene.rotation

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`default`** new THREE.Quaternion()

#### Inherited from

Scene.quaternion

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`default`** new THREE.Vector3()

#### Inherited from

Scene.scale

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`default`** new THREE.Matrix4()

#### Inherited from

Scene.modelViewMatrix

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`default`** new THREE.Matrix3()

#### Inherited from

Scene.normalMatrix

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

Scene.matrix

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

Scene.matrixWorld

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and scale every frame and also
recalculates the matrixWorld property.

**`default`** THREE.Object3D.DefaultMatrixAutoUpdate

#### Inherited from

Scene.matrixAutoUpdate

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`default`** false

#### Inherited from

Scene.matrixWorldNeedsUpdate

___

### layers

• **layers**: `Layers`

**`default`** new THREE.Layers()

#### Inherited from

Scene.layers

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`default`** true

#### Inherited from

Scene.visible

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`default`** false

#### Inherited from

Scene.castShadow

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`default`** false

#### Inherited from

Scene.receiveShadow

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`default`** true

#### Inherited from

Scene.frustumCulled

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`default`** 0

#### Inherited from

Scene.renderOrder

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`default`** []

#### Inherited from

Scene.animations

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`default`** {}

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Scene.userData

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

Scene.customDepthMaterial

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

Scene.customDistanceMaterial

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

Scene.isObject3D

___

### onBeforeRender

• **onBeforeRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

#### Type declaration

▸ (`renderer`, `scene`, `camera`, `geometry`, `material`, `group`): `void`

Calls before rendering object

##### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `scene` | `Scene` |
| `camera` | `Camera` |
| `geometry` | `BufferGeometry` |
| `material` | `Material` |
| `group` | `Group` |

##### Returns

`void`

#### Inherited from

Scene.onBeforeRender

___

### onAfterRender

• **onAfterRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

#### Type declaration

▸ (`renderer`, `scene`, `camera`, `geometry`, `material`, `group`): `void`

Calls after rendering object

##### Parameters

| Name | Type |
| :------ | :------ |
| `renderer` | `WebGLRenderer` |
| `scene` | `Scene` |
| `camera` | `Camera` |
| `geometry` | `BufferGeometry` |
| `material` | `Material` |
| `group` | `Group` |

##### Returns

`void`

#### Inherited from

Scene.onAfterRender

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

Scene.DefaultUp

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

Scene.DefaultMatrixAutoUpdate

___

### type

• **type**: ``"Scene"``

#### Inherited from

Scene.type

___

### fog

• **fog**: `FogBase`

A fog instance defining the type of fog that affects everything rendered in the scene. Default is null.

**`default`** null

#### Inherited from

Scene.fog

___

### overrideMaterial

• **overrideMaterial**: `Material`

If not null, it will force everything in the scene to be rendered with that material. Default is null.

**`default`** null

#### Inherited from

Scene.overrideMaterial

___

### autoUpdate

• **autoUpdate**: `boolean`

**`default`** true

#### Inherited from

Scene.autoUpdate

___

### background

• **background**: `Texture` \| `Color`

**`default`** null

#### Inherited from

Scene.background

___

### environment

• **environment**: `Texture`

**`default`** null

#### Inherited from

Scene.environment

___

### isScene

• `Readonly` **isScene**: ``true``

#### Inherited from

Scene.isScene

## Constructors

### constructor

• **new World**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`WorldClientParams`](../modules.md#worldclientparams-210)\> |

#### Overrides

Scene.constructor

## Methods

### onMessage

▸ **onMessage**(`message`): `void`

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<{ `blocks`: [`Block`](../modules.md#block-210)[] ; `ranges`: { `[key: string]`: [`TextureRange`](../modules.md#texturerange-210);  } ; `params`: [`WorldServerParams`](../modules.md#worldserverparams-210)  }, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-210)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

Apply a list of textures to a list of blocks' faces. The textures are loaded in before the game starts.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata-210)[] | List of data to load into the game before the game starts. |

#### Returns

`void`

___

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

Apply a texture onto a face/side of a block.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata-210) | The data of the texture and where the texture is applying to. |

#### Returns

`void`

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block-210)

Get the block information by its name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the block to get. |

#### Returns

[`Block`](../modules.md#block-210)

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block-210)

Get the block information by its ID.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | The ID of the block to get. |

#### Returns

[`Block`](../modules.md#block-210)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block-210)

Reverse engineer to get the block information from a texture name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` | The texture name that the block has. |

#### Returns

[`Block`](../modules.md#block-210)

___

### setParams

▸ **setParams**(`data`): `void`

Applies the server settings onto this world.
Caution: do not call this after game started!

**`memberof`** World

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | [`WorldServerParams`](../modules.md#worldserverparams-210) |

#### Returns

`void`

___

### setFogDistance

▸ **setFogDistance**(`distance`): `void`

Set the farthest distance for the fog. Fog starts fogging up 50% from the farthest.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | The maximum distance that the fog fully fogs up. |

#### Returns

`void`

___

### setFogColor

▸ **setFogColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `Color` |

#### Returns

`void`

___

### updateVoxel

▸ **updateVoxel**(`vx`, `vy`, `vz`, `type`, `rotation?`, `yRotation?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `vx` | `number` | `undefined` |
| `vy` | `number` | `undefined` |
| `vz` | `number` | `undefined` |
| `type` | `number` | `undefined` |
| `rotation` | `number` | `PY_ROTATION` |
| `yRotation` | `number` | `0` |

#### Returns

`void`

___

### updateVoxels

▸ **updateVoxels**(`updates`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `updates` | [`BlockUpdate`](../modules.md#blockupdate-210)[] |

#### Returns

`void`

___

### getChunk

▸ **getChunk**(`cx`, `cz`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

[`Chunk`](Chunk.md)

___

### getChunkByName

▸ **getChunkByName**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### getChunkByVoxel

▸ **getChunkByVoxel**(`vx`, `vy`, `vz`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Chunk`](Chunk.md)

___

### getVoxelByVoxel

▸ **getVoxelByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getVoxelByWorld

▸ **getVoxelByWorld**(`wx`, `wy`, `wz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wy` | `number` |
| `wz` | `number` |

#### Returns

`number`

___

### getVoxelRotationByVoxel

▸ **getVoxelRotationByVoxel**(`vx`, `vy`, `vz`): [`BlockRotation`](BlockRotation.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`BlockRotation`](BlockRotation.md)

___

### getVoxelStageByVoxel

▸ **getVoxelStageByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getSunlightByVoxel

▸ **getSunlightByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getLightColorByVoxel

▸ **getLightColorByVoxel**(`vx`, `vy`, `vz`): `Color`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`Color`

___

### getLightColorByWorld

▸ **getLightColorByWorld**(`wx`, `wy`, `wz`): `Color`

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wy` | `number` |
| `wz` | `number` |

#### Returns

`Color`

___

### getTorchLightByVoxel

▸ **getTorchLightByVoxel**(`vx`, `vy`, `vz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `color` | [`LightColor`](../modules.md#lightcolor-210) |

#### Returns

`number`

___

### getBlockByVoxel

▸ **getBlockByVoxel**(`vx`, `vy`, `vz`): [`Block`](../modules.md#block-210)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Block`](../modules.md#block-210)

___

### getBlockByWorld

▸ **getBlockByWorld**(`wx`, `wy`, `wz`): [`Block`](../modules.md#block-210)

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wy` | `number` |
| `wz` | `number` |

#### Returns

[`Block`](../modules.md#block-210)

___

### getMaxHeightByVoxel

▸ **getMaxHeightByVoxel**(`vx`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getMaxHeightByWorld

▸ **getMaxHeightByWorld**(`wx`, `wz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wz` | `number` |

#### Returns

`number`

___

### getPreviousVoxelByVoxel

▸ **getPreviousVoxelByVoxel**(`vx`, `vy`, `vz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

`number`

___

### getPreviousVoxelByWorld

▸ **getPreviousVoxelByWorld**(`wx`, `wy`, `wz`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `wx` | `number` |
| `wy` | `number` |
| `wz` | `number` |

#### Returns

`number`

___

### getBlockAABBsByVoxel

▸ **getBlockAABBsByVoxel**(`vx`, `vy`, `vz`, `ignoreFluid?`): `AABB`[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `vx` | `number` | `undefined` |
| `vy` | `number` | `undefined` |
| `vz` | `number` | `undefined` |
| `ignoreFluid` | `boolean` | `false` |

#### Returns

`AABB`[]

___

### getBlockAABBsByWorld

▸ **getBlockAABBsByWorld**(`wx`, `wy`, `wz`, `ignoreFluid?`): `AABB`[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `wx` | `number` | `undefined` |
| `wy` | `number` | `undefined` |
| `wz` | `number` | `undefined` |
| `ignoreFluid` | `boolean` | `false` |

#### Returns

`AABB`[]

___

### setMinBrightness

▸ **setMinBrightness**(`minBrightness`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `minBrightness` | `number` |

#### Returns

`void`

___

### getSunlightIntensity

▸ **getSunlightIntensity**(): `number`

#### Returns

`number`

___

### setSunlightIntensity

▸ **setSunlightIntensity**(`intensity`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `intensity` | `number` |

#### Returns

`void`

___

### addChunkInitListener

▸ **addChunkInitListener**(`coords`, `listener`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2-210) |
| `listener` | (`chunk`: [`Chunk`](Chunk.md)) => `void` |

#### Returns

`void`

___

### isWithinWorld

▸ **isWithinWorld**(`cx`, `cz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`boolean`

___

### isChunkInView

▸ **isChunkInView**(`cx`, `cz`, `dx`, `dz`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `dx` | `number` |
| `dz` | `number` |

#### Returns

`boolean`

___

### canPlace

▸ **canPlace**(`vx`, `vy`, `vz`, `type`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `type` | `number` |

#### Returns

`boolean`

___

### makeBlockMesh

▸ **makeBlockMesh**(`id`): `Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

___

### update

▸ **update**(`center`, `delta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | `Vector3` |
| `delta` | `number` |

#### Returns

`void`

___

### addEventListener

▸ **addEventListener**<`T`\>(`type`, `listener`): `void`

Adds a listener to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

Scene.addEventListener

___

### hasEventListener

▸ **hasEventListener**<`T`\>(`type`, `listener`): `boolean`

Checks if listener is added to an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of event to listen to. |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

Scene.hasEventListener

___

### removeEventListener

▸ **removeEventListener**<`T`\>(`type`, `listener`): `void`

Removes a listener from an event type.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` | The type of the listener that gets removed. |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

Scene.removeEventListener

___

### dispatchEvent

▸ **dispatchEvent**(`event`): `void`

Fire an event type.

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `Event` |

#### Returns

`void`

#### Inherited from

Scene.dispatchEvent

___

### applyMatrix4

▸ **applyMatrix4**(`matrix`): `void`

Applies the matrix transform to the object and updates the object's position, rotation and scale.

#### Parameters

| Name | Type |
| :------ | :------ |
| `matrix` | `Matrix4` |

#### Returns

`void`

#### Inherited from

Scene.applyMatrix4

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`World`](World.md)

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.applyQuaternion

___

### setRotationFromAxisAngle

▸ **setRotationFromAxisAngle**(`axis`, `angle`): `void`

axis -- A normalized vector in object space.
angle -- angle in radians

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | angle in radians |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromAxisAngle

___

### setRotationFromEuler

▸ **setRotationFromEuler**(`euler`): `void`

Calls setRotationFromEuler(euler) on the .quaternion.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `euler` | `Euler` | Euler angle specifying rotation amount. |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromEuler

___

### setRotationFromMatrix

▸ **setRotationFromMatrix**(`m`): `void`

Calls setFromRotationMatrix(m) on the .quaternion.

Note that this assumes that the upper 3x3 of m is a pure rotation matrix (i.e, unscaled).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `m` | `Matrix4` | rotate the quaternion by the rotation component of the matrix. |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromMatrix

___

### setRotationFromQuaternion

▸ **setRotationFromQuaternion**(`q`): `void`

Copy the given quaternion into .quaternion.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `q` | `Quaternion` | normalized Quaternion |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromQuaternion

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`World`](World.md)

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateOnAxis

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`World`](World.md)

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateOnWorldAxis

___

### rotateX

▸ **rotateX**(`angle`): [`World`](World.md)

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateX

___

### rotateY

▸ **rotateY**(`angle`): [`World`](World.md)

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateY

___

### rotateZ

▸ **rotateZ**(`angle`): [`World`](World.md)

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateZ

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`World`](World.md)

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateOnAxis

___

### translateX

▸ **translateX**(`distance`): [`World`](World.md)

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateX

___

### translateY

▸ **translateY**(`distance`): [`World`](World.md)

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateY

___

### translateZ

▸ **translateZ**(`distance`): [`World`](World.md)

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateZ

___

### localToWorld

▸ **localToWorld**(`vector`): `Vector3`

Updates the vector from local space to world space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `Vector3` | A local vector. |

#### Returns

`Vector3`

#### Inherited from

Scene.localToWorld

___

### worldToLocal

▸ **worldToLocal**(`vector`): `Vector3`

Updates the vector from world space to local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `Vector3` | A world vector. |

#### Returns

`Vector3`

#### Inherited from

Scene.worldToLocal

___

### lookAt

▸ **lookAt**(`vector`, `y?`, `z?`): `void`

Optionally, the x, y and z components of the world space position.
Rotates the object to face a point in world space.
This method does not support objects having non-uniformly-scaled parent(s).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `number` \| `Vector3` | A world vector to look at. |
| `y?` | `number` | - |
| `z?` | `number` | - |

#### Returns

`void`

#### Inherited from

Scene.lookAt

___

### add

▸ **add**(...`object`): [`World`](World.md)

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.add

___

### remove

▸ **remove**(...`object`): [`World`](World.md)

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.remove

___

### removeFromParent

▸ **removeFromParent**(): [`World`](World.md)

Removes this object from its current parent.

#### Returns

[`World`](World.md)

#### Inherited from

Scene.removeFromParent

___

### clear

▸ **clear**(): [`World`](World.md)

Removes all child objects.

#### Returns

[`World`](World.md)

#### Inherited from

Scene.clear

___

### attach

▸ **attach**(`object`): [`World`](World.md)

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.attach

___

### getObjectById

▸ **getObjectById**(`id`): `Object3D`<`Event`\>

Searches through the object's children and returns the first with a matching id.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` | Unique number of the object instance |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Scene.getObjectById

___

### getObjectByName

▸ **getObjectByName**(`name`): `Object3D`<`Event`\>

Searches through the object's children and returns the first with a matching name.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | String to match to the children's Object3d.name property. |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Scene.getObjectByName

___

### getObjectByProperty

▸ **getObjectByProperty**(`name`, `value`): `Object3D`<`Event`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `value` | `string` |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Scene.getObjectByProperty

___

### getWorldPosition

▸ **getWorldPosition**(`target`): `Vector3`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | `Vector3` |

#### Returns

`Vector3`

#### Inherited from

Scene.getWorldPosition

___

### getWorldQuaternion

▸ **getWorldQuaternion**(`target`): `Quaternion`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | `Quaternion` |

#### Returns

`Quaternion`

#### Inherited from

Scene.getWorldQuaternion

___

### getWorldScale

▸ **getWorldScale**(`target`): `Vector3`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | `Vector3` |

#### Returns

`Vector3`

#### Inherited from

Scene.getWorldScale

___

### getWorldDirection

▸ **getWorldDirection**(`target`): `Vector3`

#### Parameters

| Name | Type |
| :------ | :------ |
| `target` | `Vector3` |

#### Returns

`Vector3`

#### Inherited from

Scene.getWorldDirection

___

### raycast

▸ **raycast**(`raycaster`, `intersects`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `raycaster` | `Raycaster` |
| `intersects` | `Intersection`<`Object3D`<`Event`\>\>[] |

#### Returns

`void`

#### Inherited from

Scene.raycast

___

### traverse

▸ **traverse**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`object`: `Object3D`<`Event`\>) => `any` |

#### Returns

`void`

#### Inherited from

Scene.traverse

___

### traverseVisible

▸ **traverseVisible**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`object`: `Object3D`<`Event`\>) => `any` |

#### Returns

`void`

#### Inherited from

Scene.traverseVisible

___

### traverseAncestors

▸ **traverseAncestors**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`object`: `Object3D`<`Event`\>) => `any` |

#### Returns

`void`

#### Inherited from

Scene.traverseAncestors

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

Scene.updateMatrix

___

### updateMatrixWorld

▸ **updateMatrixWorld**(`force?`): `void`

Updates global transform of the object and its children.

#### Parameters

| Name | Type |
| :------ | :------ |
| `force?` | `boolean` |

#### Returns

`void`

#### Inherited from

Scene.updateMatrixWorld

___

### updateWorldMatrix

▸ **updateWorldMatrix**(`updateParents`, `updateChildren`): `void`

Updates the global transform of the object.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `updateParents` | `boolean` | recursively updates global transform of ancestors. |
| `updateChildren` | `boolean` | recursively updates global transform of descendants. |

#### Returns

`void`

#### Inherited from

Scene.updateWorldMatrix

___

### clone

▸ **clone**(`recursive?`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.clone

___

### copy

▸ **copy**(`source`, `recursive?`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`World`](World.md) |
| `recursive?` | `boolean` |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.copy

___

### toJSON

▸ **toJSON**(`meta?`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `meta?` | `any` |

#### Returns

`any`

#### Inherited from

Scene.toJSON

## Accessors

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
