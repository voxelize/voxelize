[@voxelize/client](../README.md) / [Exports](../modules.md) / Clouds

# Class: Clouds

## Hierarchy

- `Group`

  ↳ **`Clouds`**

## Table of contents

### Constructors

- [constructor](Clouds.md#constructor)

### Properties

- [animations](Clouds.md#animations)
- [array](Clouds.md#array)
- [castShadow](Clouds.md#castshadow)
- [children](Clouds.md#children)
- [customDepthMaterial](Clouds.md#customdepthmaterial)
- [customDistanceMaterial](Clouds.md#customdistancematerial)
- [frustumCulled](Clouds.md#frustumculled)
- [id](Clouds.md#id)
- [initialized](Clouds.md#initialized)
- [isGroup](Clouds.md#isgroup)
- [isObject3D](Clouds.md#isobject3d)
- [layers](Clouds.md#layers)
- [locatedCell](Clouds.md#locatedcell)
- [material](Clouds.md#material)
- [matrix](Clouds.md#matrix)
- [matrixAutoUpdate](Clouds.md#matrixautoupdate)
- [matrixWorld](Clouds.md#matrixworld)
- [matrixWorldNeedsUpdate](Clouds.md#matrixworldneedsupdate)
- [meshes](Clouds.md#meshes)
- [modelViewMatrix](Clouds.md#modelviewmatrix)
- [name](Clouds.md#name)
- [newPosition](Clouds.md#newposition)
- [normalMatrix](Clouds.md#normalmatrix)
- [onAfterRender](Clouds.md#onafterrender)
- [onBeforeRender](Clouds.md#onbeforerender)
- [params](Clouds.md#params)
- [parent](Clouds.md#parent)
- [pool](Clouds.md#pool)
- [position](Clouds.md#position)
- [quaternion](Clouds.md#quaternion)
- [receiveShadow](Clouds.md#receiveshadow)
- [renderOrder](Clouds.md#renderorder)
- [rotation](Clouds.md#rotation)
- [scale](Clouds.md#scale)
- [type](Clouds.md#type)
- [up](Clouds.md#up)
- [userData](Clouds.md#userdata)
- [uuid](Clouds.md#uuid)
- [visible](Clouds.md#visible)
- [xOffset](Clouds.md#xoffset)
- [zOffset](Clouds.md#zoffset)
- [DefaultMatrixAutoUpdate](Clouds.md#defaultmatrixautoupdate)
- [DefaultUp](Clouds.md#defaultup)

### Methods

- [add](Clouds.md#add)
- [addEventListener](Clouds.md#addeventlistener)
- [applyMatrix4](Clouds.md#applymatrix4)
- [applyQuaternion](Clouds.md#applyquaternion)
- [attach](Clouds.md#attach)
- [clear](Clouds.md#clear)
- [clone](Clouds.md#clone)
- [copy](Clouds.md#copy)
- [dispatchEvent](Clouds.md#dispatchevent)
- [getObjectById](Clouds.md#getobjectbyid)
- [getObjectByName](Clouds.md#getobjectbyname)
- [getObjectByProperty](Clouds.md#getobjectbyproperty)
- [getWorldDirection](Clouds.md#getworlddirection)
- [getWorldPosition](Clouds.md#getworldposition)
- [getWorldQuaternion](Clouds.md#getworldquaternion)
- [getWorldScale](Clouds.md#getworldscale)
- [hasEventListener](Clouds.md#haseventlistener)
- [initialize](Clouds.md#initialize)
- [localToWorld](Clouds.md#localtoworld)
- [lookAt](Clouds.md#lookat)
- [makeCell](Clouds.md#makecell)
- [move](Clouds.md#move)
- [raycast](Clouds.md#raycast)
- [remove](Clouds.md#remove)
- [removeEventListener](Clouds.md#removeeventlistener)
- [removeFromParent](Clouds.md#removefromparent)
- [reset](Clouds.md#reset)
- [rotateOnAxis](Clouds.md#rotateonaxis)
- [rotateOnWorldAxis](Clouds.md#rotateonworldaxis)
- [rotateX](Clouds.md#rotatex)
- [rotateY](Clouds.md#rotatey)
- [rotateZ](Clouds.md#rotatez)
- [setRotationFromAxisAngle](Clouds.md#setrotationfromaxisangle)
- [setRotationFromEuler](Clouds.md#setrotationfromeuler)
- [setRotationFromMatrix](Clouds.md#setrotationfrommatrix)
- [setRotationFromQuaternion](Clouds.md#setrotationfromquaternion)
- [shiftX](Clouds.md#shiftx)
- [shiftZ](Clouds.md#shiftz)
- [toJSON](Clouds.md#tojson)
- [translateOnAxis](Clouds.md#translateonaxis)
- [translateX](Clouds.md#translatex)
- [translateY](Clouds.md#translatey)
- [translateZ](Clouds.md#translatez)
- [traverse](Clouds.md#traverse)
- [traverseAncestors](Clouds.md#traverseancestors)
- [traverseVisible](Clouds.md#traversevisible)
- [update](Clouds.md#update)
- [updateMatrix](Clouds.md#updatematrix)
- [updateMatrixWorld](Clouds.md#updatematrixworld)
- [updateWorldMatrix](Clouds.md#updateworldmatrix)
- [worldToLocal](Clouds.md#worldtolocal)

## Constructors

### constructor

• **new Clouds**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`CloudsParams`](../modules.md#cloudsparams)\> |

#### Overrides

Group.constructor

#### Defined in

[client/src/libs/clouds.ts:82](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L82)

## Properties

### animations

• **animations**: `AnimationClip`[]

#### Inherited from

Group.animations

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:160

___

### array

• **array**: `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\>

#### Defined in

[client/src/libs/clouds.ts:66](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L66)

___

### castShadow

• **castShadow**: `boolean`

#### Inherited from

Group.castShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:133

___

### children

• **children**: `Object3D`<`Event`\>[]

#### Inherited from

Group.children

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:51

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

#### Inherited from

Group.customDepthMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:174

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

#### Inherited from

Group.customDistanceMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:179

___

### frustumCulled

• **frustumCulled**: `boolean`

#### Inherited from

Group.frustumCulled

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:146

___

### id

• **id**: `number`

#### Inherited from

Group.id

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:26

___

### initialized

• **initialized**: `boolean` = `false`

#### Defined in

[client/src/libs/clouds.ts:68](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L68)

___

### isGroup

• `Readonly` **isGroup**: ``true``

#### Inherited from

Group.isGroup

#### Defined in

node_modules/@types/three/src/objects/Group.d.ts:6

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

#### Inherited from

Group.isObject3D

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:185

___

### layers

• **layers**: `Layers`

#### Inherited from

Group.layers

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:121

___

### locatedCell

• `Private` **locatedCell**: `number`[]

#### Defined in

[client/src/libs/clouds.ts:75](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L75)

___

### material

• **material**: `ShaderMaterial`

#### Defined in

[client/src/libs/clouds.ts:67](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L67)

___

### matrix

• **matrix**: `Matrix4`

#### Inherited from

Group.matrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:97

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

#### Inherited from

Group.matrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:110

___

### matrixWorld

• **matrixWorld**: `Matrix4`

#### Inherited from

Group.matrixWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:103

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

#### Inherited from

Group.matrixWorldNeedsUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:116

___

### meshes

• **meshes**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>[][] = `[]`

#### Defined in

[client/src/libs/clouds.ts:71](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L71)

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

#### Inherited from

Group.modelViewMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:86

___

### name

• **name**: `string`

#### Inherited from

Group.name

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:34

___

### newPosition

• `Private` **newPosition**: `Vector3`

#### Defined in

[client/src/libs/clouds.ts:76](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L76)

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

#### Inherited from

Group.normalMatrix

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

Group.onAfterRender

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

Group.onBeforeRender

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:190

___

### params

• **params**: [`CloudsParams`](../modules.md#cloudsparams)

#### Defined in

[client/src/libs/clouds.ts:69](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L69)

___

### parent

• **parent**: `Object3D`<`Event`\>

#### Inherited from

Group.parent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:45

___

### pool

• `Private` **pool**: [`WorkerPool`](WorkerPool.md)

#### Defined in

[client/src/libs/clouds.ts:78](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L78)

___

### position

• `Readonly` **position**: `Vector3`

#### Inherited from

Group.position

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:63

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

#### Inherited from

Group.quaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:75

___

### receiveShadow

• **receiveShadow**: `boolean`

#### Inherited from

Group.receiveShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:139

___

### renderOrder

• **renderOrder**: `number`

#### Inherited from

Group.renderOrder

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:154

___

### rotation

• `Readonly` **rotation**: `Euler`

#### Inherited from

Group.rotation

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:69

___

### scale

• `Readonly` **scale**: `Vector3`

#### Inherited from

Group.scale

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:81

___

### type

• **type**: ``"Group"``

#### Inherited from

Group.type

#### Defined in

node_modules/@types/three/src/objects/Group.d.ts:5

___

### up

• **up**: `Vector3`

#### Inherited from

Group.up

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:57

___

### userData

• **userData**: `Object`

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Group.userData

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:166

___

### uuid

• **uuid**: `string`

#### Inherited from

Group.uuid

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:28

___

### visible

• **visible**: `boolean`

#### Inherited from

Group.visible

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:127

___

### xOffset

• `Private` **xOffset**: `number` = `0`

#### Defined in

[client/src/libs/clouds.ts:73](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L73)

___

### zOffset

• `Private` **zOffset**: `number` = `0`

#### Defined in

[client/src/libs/clouds.ts:74](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L74)

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

Group.DefaultMatrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:212

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

Group.DefaultUp

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:211

## Methods

### add

▸ **add**(...`object`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.add

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:332

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
| `listener` | `EventListener`<`Event`, `T`, [`Clouds`](Clouds.md)\> |  |

#### Returns

`void`

#### Inherited from

Group.addEventListener

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

Group.applyMatrix4

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:217

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.applyQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:222

___

### attach

▸ **attach**(`object`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.attach

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:352

___

### clear

▸ **clear**(): [`Clouds`](Clouds.md)

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.clear

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:347

___

### clone

▸ **clone**(`recursive?`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.clone

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:400

___

### copy

▸ **copy**(`source`, `recursive?`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | [`Clouds`](Clouds.md) | - |
| `recursive?` | `boolean` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.copy

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

Group.dispatchEvent

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:50

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

Group.getObjectById

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

Group.getObjectByName

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

Group.getObjectByProperty

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:366

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

Group.getWorldDirection

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

Group.getWorldPosition

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

Group.getWorldQuaternion

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

Group.getWorldScale

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:370

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
| `listener` | `EventListener`<`Event`, `T`, [`Clouds`](Clouds.md)\> |  |

#### Returns

`boolean`

#### Inherited from

Group.hasEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:37

___

### initialize

▸ **initialize**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

#### Defined in

[client/src/libs/clouds.ts:116](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L116)

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

Group.localToWorld

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

Group.lookAt

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:327

___

### makeCell

▸ `Private` **makeCell**(`x`, `z`, `mesh?`): `Promise`<`Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `z` | `number` |
| `mesh?` | `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\> |

#### Returns

`Promise`<`Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>\>

#### Defined in

[client/src/libs/clouds.ts:227](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L227)

___

### move

▸ **move**(`delta`, `position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `delta` | `number` |
| `position` | `Vector3` |

#### Returns

`void`

#### Defined in

[client/src/libs/clouds.ts:144](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L144)

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

Group.raycast

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:373

___

### remove

▸ **remove**(...`object`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.remove

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
| `listener` | `EventListener`<`Event`, `T`, [`Clouds`](Clouds.md)\> |  |

#### Returns

`void`

#### Inherited from

Group.removeEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:44

___

### removeFromParent

▸ **removeFromParent**(): [`Clouds`](Clouds.md)

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.removeFromParent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:342

___

### reset

▸ **reset**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

#### Defined in

[client/src/libs/clouds.ts:134](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L134)

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.rotateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:257

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.rotateOnWorldAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:264

___

### rotateX

▸ **rotateX**(`angle`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.rotateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:270

___

### rotateY

▸ **rotateY**(`angle`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.rotateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:276

___

### rotateZ

▸ **rotateZ**(`angle`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.rotateZ

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:282

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

Group.setRotationFromAxisAngle

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

Group.setRotationFromEuler

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

Group.setRotationFromMatrix

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

Group.setRotationFromQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:250

___

### shiftX

▸ `Private` **shiftX**(`direction?`): `Promise`<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `direction` | `number` | `1` |

#### Returns

`Promise`<`void`\>

#### Defined in

[client/src/libs/clouds.ts:182](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L182)

___

### shiftZ

▸ `Private` **shiftZ**(`direction?`): `Promise`<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `direction` | `number` | `1` |

#### Returns

`Promise`<`void`\>

#### Defined in

[client/src/libs/clouds.ts:204](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L204)

___

### toJSON

▸ **toJSON**(`meta?`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `meta?` | `Object` |
| `meta.geometries` | `any` |
| `meta.images` | `any` |
| `meta.materials` | `any` |
| `meta.textures` | `any` |

#### Returns

`any`

#### Inherited from

Group.toJSON

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:398

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `distance` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.translateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:289

___

### translateX

▸ **translateX**(`distance`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.translateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:295

___

### translateY

▸ **translateY**(`distance`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.translateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:301

___

### translateZ

▸ **translateZ**(`distance`): [`Clouds`](Clouds.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Clouds`](Clouds.md)

#### Inherited from

Group.translateZ

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

Group.traverse

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

Group.traverseAncestors

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

Group.traverseVisible

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:377

___

### update

▸ **update**(`position`, `delta`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |
| `delta` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/clouds.ts:176](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/clouds.ts#L176)

___

### updateMatrix

▸ **updateMatrix**(): `void`

#### Returns

`void`

#### Inherited from

Group.updateMatrix

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

Group.updateMatrixWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:389

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

Group.updateWorldMatrix

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

Group.worldToLocal

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:319
