[@voxelize/client](../README.md) / [Exports](../modules.md) / World

# Class: World

## Hierarchy

- `Scene`

  ↳ **`World`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Table of contents

### Constructors

- [constructor](World.md#constructor)

### Properties

- [\_renderRadius](World.md#_renderradius)
- [animations](World.md#animations)
- [atlas](World.md#atlas)
- [autoUpdate](World.md#autoupdate)
- [background](World.md#background)
- [blockCache](World.md#blockcache)
- [callTick](World.md#calltick)
- [castShadow](World.md#castshadow)
- [children](World.md#children)
- [chunks](World.md#chunks)
- [customDepthMaterial](World.md#customdepthmaterial)
- [customDistanceMaterial](World.md#customdistancematerial)
- [environment](World.md#environment)
- [fog](World.md#fog)
- [frustumCulled](World.md#frustumculled)
- [id](World.md#id)
- [isObject3D](World.md#isobject3d)
- [isScene](World.md#isscene)
- [layers](World.md#layers)
- [loader](World.md#loader)
- [materials](World.md#materials)
- [matrix](World.md#matrix)
- [matrixAutoUpdate](World.md#matrixautoupdate)
- [matrixWorld](World.md#matrixworld)
- [matrixWorldNeedsUpdate](World.md#matrixworldneedsupdate)
- [modelViewMatrix](World.md#modelviewmatrix)
- [name](World.md#name)
- [normalMatrix](World.md#normalmatrix)
- [onAfterRender](World.md#onafterrender)
- [onBeforeRender](World.md#onbeforerender)
- [overrideMaterial](World.md#overridematerial)
- [packets](World.md#packets)
- [params](World.md#params)
- [parent](World.md#parent)
- [physics](World.md#physics)
- [position](World.md#position)
- [quaternion](World.md#quaternion)
- [receiveShadow](World.md#receiveshadow)
- [registry](World.md#registry)
- [renderOrder](World.md#renderorder)
- [rotation](World.md#rotation)
- [scale](World.md#scale)
- [type](World.md#type)
- [uniforms](World.md#uniforms)
- [up](World.md#up)
- [userData](World.md#userdata)
- [uuid](World.md#uuid)
- [visible](World.md#visible)
- [DefaultMatrixAutoUpdate](World.md#defaultmatrixautoupdate)
- [DefaultUp](World.md#defaultup)

### Accessors

- [renderRadius](World.md#renderradius)

### Methods

- [add](World.md#add)
- [addChunks](World.md#addchunks)
- [addEventListener](World.md#addeventlistener)
- [applyMatrix4](World.md#applymatrix4)
- [applyQuaternion](World.md#applyquaternion)
- [applyTextureByName](World.md#applytexturebyname)
- [applyTexturesByNames](World.md#applytexturesbynames)
- [attach](World.md#attach)
- [calculateCurrChunk](World.md#calculatecurrchunk)
- [canPlace](World.md#canplace)
- [clear](World.md#clear)
- [clone](World.md#clone)
- [copy](World.md#copy)
- [dispatchEvent](World.md#dispatchevent)
- [emitServerUpdates](World.md#emitserverupdates)
- [getBlockById](World.md#getblockbyid)
- [getBlockByName](World.md#getblockbyname)
- [getBlockByTextureName](World.md#getblockbytexturename)
- [getBlockByVoxel](World.md#getblockbyvoxel)
- [getChunk](World.md#getchunk)
- [getChunkByName](World.md#getchunkbyname)
- [getChunkByVoxel](World.md#getchunkbyvoxel)
- [getObjectById](World.md#getobjectbyid)
- [getObjectByName](World.md#getobjectbyname)
- [getObjectByProperty](World.md#getobjectbyproperty)
- [getSunlightByVoxel](World.md#getsunlightbyvoxel)
- [getTorchLightByVoxel](World.md#gettorchlightbyvoxel)
- [getVoxelByVoxel](World.md#getvoxelbyvoxel)
- [getVoxelByWorld](World.md#getvoxelbyworld)
- [getVoxelRotationByVoxel](World.md#getvoxelrotationbyvoxel)
- [getVoxelStageByVoxel](World.md#getvoxelstagebyvoxel)
- [getWorldDirection](World.md#getworlddirection)
- [getWorldPosition](World.md#getworldposition)
- [getWorldQuaternion](World.md#getworldquaternion)
- [getWorldScale](World.md#getworldscale)
- [handleServerChunk](World.md#handleserverchunk)
- [hasEventListener](World.md#haseventlistener)
- [isChunkInView](World.md#ischunkinview)
- [isWithinWorld](World.md#iswithinworld)
- [loadAtlas](World.md#loadatlas)
- [localToWorld](World.md#localtoworld)
- [lookAt](World.md#lookat)
- [maintainChunks](World.md#maintainchunks)
- [makeBlockMesh](World.md#makeblockmesh)
- [makeShaderMaterial](World.md#makeshadermaterial)
- [meshChunk](World.md#meshchunk)
- [meshChunks](World.md#meshchunks)
- [onMessage](World.md#onmessage)
- [raycast](World.md#raycast)
- [remove](World.md#remove)
- [removeEventListener](World.md#removeeventlistener)
- [removeFromParent](World.md#removefromparent)
- [requestChunks](World.md#requestchunks)
- [reset](World.md#reset)
- [rotateOnAxis](World.md#rotateonaxis)
- [rotateOnWorldAxis](World.md#rotateonworldaxis)
- [rotateX](World.md#rotatex)
- [rotateY](World.md#rotatey)
- [rotateZ](World.md#rotatez)
- [setFogDistance](World.md#setfogdistance)
- [setParams](World.md#setparams)
- [setRotationFromAxisAngle](World.md#setrotationfromaxisangle)
- [setRotationFromEuler](World.md#setrotationfromeuler)
- [setRotationFromMatrix](World.md#setrotationfrommatrix)
- [setRotationFromQuaternion](World.md#setrotationfromquaternion)
- [setupPhysics](World.md#setupphysics)
- [surroundChunks](World.md#surroundchunks)
- [toJSON](World.md#tojson)
- [translateOnAxis](World.md#translateonaxis)
- [translateX](World.md#translatex)
- [translateY](World.md#translatey)
- [translateZ](World.md#translatez)
- [traverse](World.md#traverse)
- [traverseAncestors](World.md#traverseancestors)
- [traverseVisible](World.md#traversevisible)
- [update](World.md#update)
- [updateMatrix](World.md#updatematrix)
- [updateMatrixWorld](World.md#updatematrixworld)
- [updatePhysics](World.md#updatephysics)
- [updateVoxel](World.md#updatevoxel)
- [updateVoxels](World.md#updatevoxels)
- [updateWorldMatrix](World.md#updateworldmatrix)
- [worldToLocal](World.md#worldtolocal)

## Constructors

### constructor

• **new World**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`WorldClientParams`](../modules.md#worldclientparams)\> |

#### Overrides

Scene.constructor

#### Defined in

[client/src/core/world/index.ts:168](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L168)

## Properties

### \_renderRadius

• `Private` **\_renderRadius**: `number` = `8`

#### Defined in

[client/src/core/world/index.ts:164](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L164)

___

### animations

• **animations**: `AnimationClip`[]

#### Inherited from

Scene.animations

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:160

___

### atlas

• **atlas**: [`TextureAtlas`](TextureAtlas.md)

#### Defined in

[client/src/core/world/index.ts:100](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L100)

___

### autoUpdate

• **autoUpdate**: `boolean`

#### Inherited from

Scene.autoUpdate

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:34

___

### background

• **background**: `Texture` \| `Color`

#### Inherited from

Scene.background

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:39

___

### blockCache

• **blockCache**: `Map`<`string`, `number`\>

#### Defined in

[client/src/core/world/index.ts:148](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L148)

___

### callTick

• `Private` **callTick**: `number` = `0`

#### Defined in

[client/src/core/world/index.ts:166](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L166)

___

### castShadow

• **castShadow**: `boolean`

#### Inherited from

Scene.castShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:133

___

### children

• **children**: `Object3D`<`Event`\>[]

#### Inherited from

Scene.children

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:51

___

### chunks

• **chunks**: [`Chunks`](Chunks.md)

#### Defined in

[client/src/core/world/index.ts:93](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L93)

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

#### Inherited from

Scene.customDepthMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:174

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

#### Inherited from

Scene.customDistanceMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:179

___

### environment

• **environment**: `Texture`

#### Inherited from

Scene.environment

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:44

___

### fog

• **fog**: `FogBase`

#### Inherited from

Scene.fog

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:23

___

### frustumCulled

• **frustumCulled**: `boolean`

#### Inherited from

Scene.frustumCulled

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:146

___

### id

• **id**: `number`

#### Inherited from

Scene.id

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:26

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

#### Inherited from

Scene.isObject3D

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:185

___

### isScene

• `Readonly` **isScene**: ``true``

#### Inherited from

Scene.isScene

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:46

___

### layers

• **layers**: `Layers`

#### Inherited from

Scene.layers

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:121

___

### loader

• **loader**: `Loader`

#### Defined in

[client/src/core/world/index.ts:162](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L162)

___

### materials

• **materials**: `Object` = `{}`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `opaque?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial) |
| `transparent?` | [`CustomShaderMaterial`](../modules.md#customshadermaterial) |

#### Defined in

[client/src/core/world/index.ts:155](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L155)

___

### matrix

• **matrix**: `Matrix4`

#### Inherited from

Scene.matrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:97

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

#### Inherited from

Scene.matrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:110

___

### matrixWorld

• **matrixWorld**: `Matrix4`

#### Inherited from

Scene.matrixWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:103

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

#### Inherited from

Scene.matrixWorldNeedsUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:116

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

#### Inherited from

Scene.modelViewMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:86

___

### name

• **name**: `string`

#### Inherited from

Scene.name

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:34

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

#### Inherited from

Scene.normalMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:91

___

### onAfterRender

• **onAfterRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

#### Type declaration

▸ (`renderer`, `scene`, `camera`, `geometry`, `material`, `group`): `void`

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:202

___

### onBeforeRender

• **onBeforeRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

#### Type declaration

▸ (`renderer`, `scene`, `camera`, `geometry`, `material`, `group`): `void`

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:190

___

### overrideMaterial

• **overrideMaterial**: `Material`

#### Inherited from

Scene.overrideMaterial

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:29

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets)

#### Defined in

[client/src/core/world/index.ts:160](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L160)

___

### params

• **params**: [`WorldParams`](../modules.md#worldparams) = `{}`

#### Defined in

[client/src/core/world/index.ts:91](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L91)

___

### parent

• **parent**: `Object3D`<`Event`\>

#### Inherited from

Scene.parent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:45

___

### physics

• **physics**: `Engine`

#### Defined in

[client/src/core/world/index.ts:95](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L95)

___

### position

• `Readonly` **position**: `Vector3`

#### Inherited from

Scene.position

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:63

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

#### Inherited from

Scene.quaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:75

___

### receiveShadow

• **receiveShadow**: `boolean`

#### Inherited from

Scene.receiveShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:139

___

### registry

• **registry**: [`Registry`](Registry.md)

#### Defined in

[client/src/core/world/index.ts:150](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L150)

___

### renderOrder

• **renderOrder**: `number`

#### Inherited from

Scene.renderOrder

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:154

___

### rotation

• `Readonly` **rotation**: `Euler`

#### Inherited from

Scene.rotation

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:69

___

### scale

• `Readonly` **scale**: `Vector3`

#### Inherited from

Scene.scale

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:81

___

### type

• **type**: ``"Scene"``

#### Inherited from

Scene.type

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:17

___

### uniforms

• **uniforms**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `ao` | { `value`: `Vector4`  } |
| `ao.value` | `Vector4` |
| `atlas` | { `value`: `Texture`  } |
| `atlas.value` | `Texture` |
| `fogColor` | { `value`: `Color`  } |
| `fogColor.value` | `Color` |
| `fogFar` | { `value`: `number`  } |
| `fogFar.value` | `number` |
| `fogNear` | { `value`: `number`  } |
| `fogNear.value` | `number` |
| `minLight` | { `value`: `number`  } |
| `minLight.value` | `number` |
| `sunlight` | { `value`: `number`  } |
| `sunlight.value` | `number` |

#### Defined in

[client/src/core/world/index.ts:102](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L102)

___

### up

• **up**: `Vector3`

#### Inherited from

Scene.up

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:57

___

### userData

• **userData**: `Object`

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Scene.userData

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:166

___

### uuid

• **uuid**: `string`

#### Inherited from

Scene.uuid

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:28

___

### visible

• **visible**: `boolean`

#### Inherited from

Scene.visible

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:127

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

Scene.DefaultMatrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:212

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

Scene.DefaultUp

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:211

## Accessors

### renderRadius

• `get` **renderRadius**(): `number`

#### Returns

`number`

#### Defined in

[client/src/core/world/index.ts:535](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L535)

• `set` **renderRadius**(`radius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `radius` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:539](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L539)

## Methods

### add

▸ **add**(...`object`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.add

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:332

___

### addChunks

▸ `Private` **addChunks**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:771](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L771)

___

### addEventListener

▸ **addEventListener**<`T`\>(`type`, `listener`): `void`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` |  |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> |  |

#### Returns

`void`

#### Inherited from

Scene.addEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:30

___

### applyMatrix4

▸ **applyMatrix4**(`matrix`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `matrix` | `Matrix4` |

#### Returns

`void`

#### Inherited from

Scene.applyMatrix4

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:217

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.applyQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:222

___

### applyTextureByName

▸ **applyTextureByName**(`texture`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `texture` | [`TextureData`](../modules.md#texturedata) |  |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:285](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L285)

___

### applyTexturesByNames

▸ **applyTexturesByNames**(`textures`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textures` | [`TextureData`](../modules.md#texturedata)[] |  |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:274](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L274)

___

### attach

▸ **attach**(`object`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.attach

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:352

___

### calculateCurrChunk

▸ `Private` **calculateCurrChunk**(`center`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | `Vector3` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:544](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L544)

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

#### Defined in

[client/src/core/world/index.ts:464](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L464)

___

### clear

▸ **clear**(): [`World`](World.md)

#### Returns

[`World`](World.md)

#### Inherited from

Scene.clear

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:347

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:400

___

### copy

▸ **copy**(`source`, `recursive?`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | [`World`](World.md) | - |
| `recursive?` | `boolean` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.copy

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:407

___

### dispatchEvent

▸ **dispatchEvent**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `Event` |

#### Returns

`void`

#### Inherited from

Scene.dispatchEvent

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:50

___

### emitServerUpdates

▸ `Private` **emitServerUpdates**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:555](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L555)

___

### getBlockById

▸ **getBlockById**(`id`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/index.ts:310](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L310)

___

### getBlockByName

▸ **getBlockByName**(`name`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/index.ts:301](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L301)

___

### getBlockByTextureName

▸ **getBlockByTextureName**(`textureName`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `textureName` | `string` |  |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/index.ts:319](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L319)

___

### getBlockByVoxel

▸ **getBlockByVoxel**(`vx`, `vy`, `vz`): [`Block`](../modules.md#block)

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/world/index.ts:434](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L434)

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

#### Defined in

[client/src/core/world/index.ts:377](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L377)

___

### getChunkByName

▸ **getChunkByName**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

#### Defined in

[client/src/core/world/index.ts:381](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L381)

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

#### Defined in

[client/src/core/world/index.ts:385](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L385)

___

### getObjectById

▸ **getObjectById**(`id`): `Object3D`<`Event`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `number` |  |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Scene.getObjectById

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:358

___

### getObjectByName

▸ **getObjectByName**(`name`): `Object3D`<`Event`\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Scene.getObjectByName

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:364

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:366

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

#### Defined in

[client/src/core/world/index.ts:417](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L417)

___

### getTorchLightByVoxel

▸ **getTorchLightByVoxel**(`vx`, `vy`, `vz`, `color`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `color` | [`LightColor`](../modules.md#lightcolor) |

#### Returns

`number`

#### Defined in

[client/src/core/world/index.ts:423](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L423)

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

#### Defined in

[client/src/core/world/index.ts:394](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L394)

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

#### Defined in

[client/src/core/world/index.ts:400](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L400)

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

#### Defined in

[client/src/core/world/index.ts:405](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L405)

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

#### Defined in

[client/src/core/world/index.ts:411](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L411)

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:371

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:368

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:369

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:370

___

### handleServerChunk

▸ `Private` **handleServerChunk**(`data`, `urgent?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `data` | `ChunkProtocol` | `undefined` |
| `urgent` | `boolean` | `false` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:873](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L873)

___

### hasEventListener

▸ **hasEventListener**<`T`\>(`type`, `listener`): `boolean`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` |  |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> |  |

#### Returns

`boolean`

#### Inherited from

Scene.hasEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:37

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

#### Defined in

[client/src/core/world/index.ts:450](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L450)

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

#### Defined in

[client/src/core/world/index.ts:439](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L439)

___

### loadAtlas

▸ `Private` **loadAtlas**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:823](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L823)

___

### localToWorld

▸ **localToWorld**(`vector`): `Vector3`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `Vector3` |  |

#### Returns

`Vector3`

#### Inherited from

Scene.localToWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:313

___

### lookAt

▸ **lookAt**(`vector`, `y?`, `z?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `number` \| `Vector3` |  |
| `y?` | `number` | - |
| `z?` | `number` | - |

#### Returns

`void`

#### Inherited from

Scene.lookAt

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:327

___

### maintainChunks

▸ `Private` **maintainChunks**(`center`, `direction?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | `Vector3` |
| `direction?` | `Vector3` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:784](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L784)

___

### makeBlockMesh

▸ **makeBlockMesh**(`id`): `Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

`Mesh`<`BufferGeometry`, `MeshBasicMaterial`\>

#### Defined in

[client/src/core/world/index.ts:470](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L470)

___

### makeShaderMaterial

▸ `Private` **makeShaderMaterial**(): [`CustomShaderMaterial`](../modules.md#customshadermaterial)

#### Returns

[`CustomShaderMaterial`](../modules.md#customshadermaterial)

#### Defined in

[client/src/core/world/index.ts:881](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L881)

___

### meshChunk

▸ `Private` **meshChunk**(`data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `ChunkProtocol` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:750](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L750)

___

### meshChunks

▸ `Private` **meshChunks**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:741](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L741)

___

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<{ `blocks`: [`Block`](../modules.md#block)[] ; `params`: [`WorldServerParams`](../modules.md#worldserverparams) ; `ranges`: { `[key: string]`: [`TextureRange`](../modules.md#texturerange);  }  }, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

#### Defined in

[client/src/core/world/index.ts:189](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L189)

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:373

___

### remove

▸ **remove**(...`object`): [`World`](World.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.remove

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:337

___

### removeEventListener

▸ **removeEventListener**<`T`\>(`type`, `listener`): `void`

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | `T` |  |
| `listener` | `EventListener`<`Event`, `T`, [`World`](World.md)\> |  |

#### Returns

`void`

#### Inherited from

Scene.removeEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:44

___

### removeFromParent

▸ **removeFromParent**(): [`World`](World.md)

#### Returns

[`World`](World.md)

#### Inherited from

Scene.removeFromParent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:342

___

### requestChunks

▸ `Private` **requestChunks**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:725](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L725)

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:254](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L254)

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:257

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateOnWorldAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:264

___

### rotateX

▸ **rotateX**(`angle`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:270

___

### rotateY

▸ **rotateY**(`angle`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:276

___

### rotateZ

▸ **rotateZ**(`angle`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.rotateZ

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:282

___

### setFogDistance

▸ **setFogDistance**(`distance`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:352](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L352)

___

### setParams

▸ **setParams**(`data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | [`WorldServerParams`](../modules.md#worldserverparams) |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:341](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L341)

___

### setRotationFromAxisAngle

▸ **setRotationFromAxisAngle**(`axis`, `angle`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromAxisAngle

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:230

___

### setRotationFromEuler

▸ **setRotationFromEuler**(`euler`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `euler` | `Euler` |  |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromEuler

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:236

___

### setRotationFromMatrix

▸ **setRotationFromMatrix**(`m`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `m` | `Matrix4` |  |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:244

___

### setRotationFromQuaternion

▸ **setRotationFromQuaternion**(`q`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `q` | `Quaternion` |  |

#### Returns

`void`

#### Inherited from

Scene.setRotationFromQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:250

___

### setupPhysics

▸ `Private` **setupPhysics**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:681](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L681)

___

### surroundChunks

▸ `Private` **surroundChunks**(`direction?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `direction?` | `Vector3` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:600](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L600)

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

#### Defined in

node_modules/@types/three/src/scenes/Scene.d.ts:48

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `distance` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:289

___

### translateX

▸ **translateX**(`distance`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:295

___

### translateY

▸ **translateY**(`distance`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:301

___

### translateZ

▸ **translateZ**(`distance`): [`World`](World.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`World`](World.md)

#### Inherited from

Scene.translateZ

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:307

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:375

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:379

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

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:377

___

### update

▸ **update**(`center`, `delta`, `direction?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `center` | `Vector3` |
| `delta` | `number` |
| `direction?` | `Vector3` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:515](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L515)

___

### updateMatrix

▸ **updateMatrix**(): `void`

#### Returns

`void`

#### Inherited from

Scene.updateMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:384

___

### updateMatrixWorld

▸ **updateMatrixWorld**(`force?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `force?` | `boolean` |

#### Returns

`void`

#### Inherited from

Scene.updateMatrixWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:389

___

### updatePhysics

▸ `Private` **updatePhysics**(`delta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `delta` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:701](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L701)

___

### updateVoxel

▸ **updateVoxel**(`vx`, `vy`, `vz`, `type`, `rotation?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `vx` | `number` |
| `vy` | `number` |
| `vz` | `number` |
| `type` | `number` |
| `rotation?` | [`BlockRotation`](BlockRotation.md) |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:359](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L359)

___

### updateVoxels

▸ **updateVoxels**(`updates`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `updates` | [`BlockUpdate`](../modules.md#blockupdate)[] |

#### Returns

`void`

#### Defined in

[client/src/core/world/index.ts:369](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/world/index.ts#L369)

___

### updateWorldMatrix

▸ **updateWorldMatrix**(`updateParents`, `updateChildren`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `updateParents` | `boolean` |  |
| `updateChildren` | `boolean` |  |

#### Returns

`void`

#### Inherited from

Scene.updateWorldMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:396

___

### worldToLocal

▸ **worldToLocal**(`vector`): `Vector3`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `Vector3` |  |

#### Returns

`Vector3`

#### Inherited from

Scene.worldToLocal

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:319
