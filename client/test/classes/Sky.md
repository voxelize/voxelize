[@voxelize/client](../README.md) / [Exports](../modules.md) / Sky

# Class: Sky

## Hierarchy

- `Group`

  ↳ **`Sky`**

## Table of contents

### Constructors

- [constructor](Sky.md#constructor)

### Properties

- [animations](Sky.md#animations)
- [box](Sky.md#box)
- [castShadow](Sky.md#castshadow)
- [children](Sky.md#children)
- [customDepthMaterial](Sky.md#customdepthmaterial)
- [customDistanceMaterial](Sky.md#customdistancematerial)
- [dimension](Sky.md#dimension)
- [frustumCulled](Sky.md#frustumculled)
- [id](Sky.md#id)
- [isGroup](Sky.md#isgroup)
- [isObject3D](Sky.md#isobject3d)
- [layers](Sky.md#layers)
- [matrix](Sky.md#matrix)
- [matrixAutoUpdate](Sky.md#matrixautoupdate)
- [matrixWorld](Sky.md#matrixworld)
- [matrixWorldNeedsUpdate](Sky.md#matrixworldneedsupdate)
- [modelViewMatrix](Sky.md#modelviewmatrix)
- [name](Sky.md#name)
- [newBottomColor](Sky.md#newbottomcolor)
- [newMiddleColor](Sky.md#newmiddlecolor)
- [newTopColor](Sky.md#newtopcolor)
- [normalMatrix](Sky.md#normalmatrix)
- [onAfterRender](Sky.md#onafterrender)
- [onBeforeRender](Sky.md#onbeforerender)
- [parent](Sky.md#parent)
- [position](Sky.md#position)
- [quaternion](Sky.md#quaternion)
- [receiveShadow](Sky.md#receiveshadow)
- [renderOrder](Sky.md#renderorder)
- [rotation](Sky.md#rotation)
- [scale](Sky.md#scale)
- [type](Sky.md#type)
- [uBottomColor](Sky.md#ubottomcolor)
- [uMiddleColor](Sky.md#umiddlecolor)
- [uTopColor](Sky.md#utopcolor)
- [up](Sky.md#up)
- [userData](Sky.md#userdata)
- [uuid](Sky.md#uuid)
- [visible](Sky.md#visible)
- [DefaultMatrixAutoUpdate](Sky.md#defaultmatrixautoupdate)
- [DefaultUp](Sky.md#defaultup)

### Methods

- [add](Sky.md#add)
- [addEventListener](Sky.md#addeventlistener)
- [applyMatrix4](Sky.md#applymatrix4)
- [applyQuaternion](Sky.md#applyquaternion)
- [attach](Sky.md#attach)
- [clear](Sky.md#clear)
- [clone](Sky.md#clone)
- [copy](Sky.md#copy)
- [createSkyBox](Sky.md#createskybox)
- [createSkyShading](Sky.md#createskyshading)
- [dispatchEvent](Sky.md#dispatchevent)
- [getObjectById](Sky.md#getobjectbyid)
- [getObjectByName](Sky.md#getobjectbyname)
- [getObjectByProperty](Sky.md#getobjectbyproperty)
- [getWorldDirection](Sky.md#getworlddirection)
- [getWorldPosition](Sky.md#getworldposition)
- [getWorldQuaternion](Sky.md#getworldquaternion)
- [getWorldScale](Sky.md#getworldscale)
- [hasEventListener](Sky.md#haseventlistener)
- [localToWorld](Sky.md#localtoworld)
- [lookAt](Sky.md#lookat)
- [raycast](Sky.md#raycast)
- [remove](Sky.md#remove)
- [removeEventListener](Sky.md#removeeventlistener)
- [removeFromParent](Sky.md#removefromparent)
- [rotateOnAxis](Sky.md#rotateonaxis)
- [rotateOnWorldAxis](Sky.md#rotateonworldaxis)
- [rotateX](Sky.md#rotatex)
- [rotateY](Sky.md#rotatey)
- [rotateZ](Sky.md#rotatez)
- [setRotationFromAxisAngle](Sky.md#setrotationfromaxisangle)
- [setRotationFromEuler](Sky.md#setrotationfromeuler)
- [setRotationFromMatrix](Sky.md#setrotationfrommatrix)
- [setRotationFromQuaternion](Sky.md#setrotationfromquaternion)
- [toJSON](Sky.md#tojson)
- [translateOnAxis](Sky.md#translateonaxis)
- [translateX](Sky.md#translatex)
- [translateY](Sky.md#translatey)
- [translateZ](Sky.md#translatez)
- [traverse](Sky.md#traverse)
- [traverseAncestors](Sky.md#traverseancestors)
- [traverseVisible](Sky.md#traversevisible)
- [updateMatrix](Sky.md#updatematrix)
- [updateMatrixWorld](Sky.md#updatematrixworld)
- [updateWorldMatrix](Sky.md#updateworldmatrix)
- [worldToLocal](Sky.md#worldtolocal)

## Constructors

### constructor

• **new Sky**(`dimension`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `dimension` | `number` |

#### Overrides

Group.constructor

#### Defined in

[client/src/libs/sky.ts:148](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L148)

## Properties

### animations

• **animations**: `AnimationClip`[]

#### Inherited from

Group.animations

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:160

___

### box

• **box**: [`CanvasBox`](CanvasBox.md)

#### Defined in

[client/src/libs/sky.ts:132](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L132)

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

### dimension

• **dimension**: `number`

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

### newBottomColor

• `Private` **newBottomColor**: `Color`

#### Defined in

[client/src/libs/sky.ts:146](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L146)

___

### newMiddleColor

• `Private` **newMiddleColor**: `Color`

#### Defined in

[client/src/libs/sky.ts:145](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L145)

___

### newTopColor

• `Private` **newTopColor**: `Color`

#### Defined in

[client/src/libs/sky.ts:144](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L144)

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

### parent

• **parent**: `Object3D`<`Event`\>

#### Inherited from

Group.parent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:45

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

### uBottomColor

• **uBottomColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

#### Defined in

[client/src/libs/sky.ts:140](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L140)

___

### uMiddleColor

• **uMiddleColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

#### Defined in

[client/src/libs/sky.ts:137](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L137)

___

### uTopColor

• **uTopColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

#### Defined in

[client/src/libs/sky.ts:134](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L134)

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

▸ **add**(...`object`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Sky`](Sky.md)

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> |  |

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

▸ **applyQuaternion**(`quaternion`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.applyQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:222

___

### attach

▸ **attach**(`object`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.attach

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:352

___

### clear

▸ **clear**(): [`Sky`](Sky.md)

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.clear

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:347

___

### clone

▸ **clone**(`recursive?`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.clone

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:400

___

### copy

▸ **copy**(`source`, `recursive?`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | [`Sky`](Sky.md) | - |
| `recursive?` | `boolean` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.copy

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:407

___

### createSkyBox

▸ `Private` **createSkyBox**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/sky.ts:193](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L193)

___

### createSkyShading

▸ `Private` **createSkyShading**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/sky.ts:155](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sky.ts#L155)

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> |  |

#### Returns

`boolean`

#### Inherited from

Group.hasEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:37

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

▸ **remove**(...`object`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Sky`](Sky.md)

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> |  |

#### Returns

`void`

#### Inherited from

Group.removeEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:44

___

### removeFromParent

▸ **removeFromParent**(): [`Sky`](Sky.md)

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.removeFromParent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:342

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.rotateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:257

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.rotateOnWorldAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:264

___

### rotateX

▸ **rotateX**(`angle`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.rotateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:270

___

### rotateY

▸ **rotateY**(`angle`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.rotateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:276

___

### rotateZ

▸ **rotateZ**(`angle`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`Sky`](Sky.md)

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

▸ **translateOnAxis**(`axis`, `distance`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `distance` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.translateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:289

___

### translateX

▸ **translateX**(`distance`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.translateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:295

___

### translateY

▸ **translateY**(`distance`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

Group.translateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:301

___

### translateZ

▸ **translateZ**(`distance`): [`Sky`](Sky.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`Sky`](Sky.md)

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
