---
id: "Arrow"
title: "Class: Arrow"
sidebar_label: "Arrow"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `ArrowHelper`

  ↳ **`Arrow`**

## Properties

### params

• **params**: [`ArrowParams`](../modules.md#arrowparams-98)

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

ArrowHelper.id

___

### uuid

• **uuid**: `string`

#### Inherited from

ArrowHelper.uuid

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`default`** ''

#### Inherited from

ArrowHelper.name

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`default`** null

#### Inherited from

ArrowHelper.parent

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`default`** []

#### Inherited from

ArrowHelper.children

___

### up

• **up**: `Vector3`

Up direction.

**`default`** THREE.Object3D.DefaultUp.clone()

#### Inherited from

ArrowHelper.up

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`default`** new THREE.Vector3()

#### Inherited from

ArrowHelper.position

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`default`** new THREE.Euler()

#### Inherited from

ArrowHelper.rotation

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`default`** new THREE.Quaternion()

#### Inherited from

ArrowHelper.quaternion

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`default`** new THREE.Vector3()

#### Inherited from

ArrowHelper.scale

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`default`** new THREE.Matrix4()

#### Inherited from

ArrowHelper.modelViewMatrix

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`default`** new THREE.Matrix3()

#### Inherited from

ArrowHelper.normalMatrix

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

ArrowHelper.matrix

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

ArrowHelper.matrixWorld

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and scale every frame and also
recalculates the matrixWorld property.

**`default`** THREE.Object3D.DefaultMatrixAutoUpdate

#### Inherited from

ArrowHelper.matrixAutoUpdate

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`default`** false

#### Inherited from

ArrowHelper.matrixWorldNeedsUpdate

___

### layers

• **layers**: `Layers`

**`default`** new THREE.Layers()

#### Inherited from

ArrowHelper.layers

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`default`** true

#### Inherited from

ArrowHelper.visible

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`default`** false

#### Inherited from

ArrowHelper.castShadow

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`default`** false

#### Inherited from

ArrowHelper.receiveShadow

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`default`** true

#### Inherited from

ArrowHelper.frustumCulled

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`default`** 0

#### Inherited from

ArrowHelper.renderOrder

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`default`** []

#### Inherited from

ArrowHelper.animations

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`default`** {}

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

ArrowHelper.userData

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

ArrowHelper.customDepthMaterial

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

ArrowHelper.customDistanceMaterial

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

ArrowHelper.isObject3D

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

ArrowHelper.onBeforeRender

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

ArrowHelper.onAfterRender

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

ArrowHelper.DefaultUp

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

ArrowHelper.DefaultMatrixAutoUpdate

___

### type

• **type**: `string`

**`default`** 'ArrowHelper'

#### Inherited from

ArrowHelper.type

___

### line

• **line**: `Line`<`BufferGeometry`, `Material` \| `Material`[]\>

Contains the line part of the arrowHelper.

#### Inherited from

ArrowHelper.line

___

### cone

• **cone**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>

Contains the cone part of the arrowHelper.

#### Inherited from

ArrowHelper.cone

## Constructors

### constructor

• **new Arrow**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `Partial`<[`ArrowParams`](../modules.md#arrowparams-98)\> |

#### Overrides

ArrowHelper.constructor

## Methods

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
| `listener` | `EventListener`<`Event`, `T`, [`Arrow`](Arrow.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

ArrowHelper.addEventListener

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
| `listener` | `EventListener`<`Event`, `T`, [`Arrow`](Arrow.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

ArrowHelper.hasEventListener

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
| `listener` | `EventListener`<`Event`, `T`, [`Arrow`](Arrow.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

ArrowHelper.removeEventListener

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

ArrowHelper.dispatchEvent

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

ArrowHelper.applyMatrix4

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`Arrow`](Arrow.md)

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.applyQuaternion

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

ArrowHelper.setRotationFromAxisAngle

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

ArrowHelper.setRotationFromEuler

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

ArrowHelper.setRotationFromMatrix

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

ArrowHelper.setRotationFromQuaternion

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`Arrow`](Arrow.md)

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.rotateOnAxis

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`Arrow`](Arrow.md)

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.rotateOnWorldAxis

___

### rotateX

▸ **rotateX**(`angle`): [`Arrow`](Arrow.md)

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.rotateX

___

### rotateY

▸ **rotateY**(`angle`): [`Arrow`](Arrow.md)

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.rotateY

___

### rotateZ

▸ **rotateZ**(`angle`): [`Arrow`](Arrow.md)

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.rotateZ

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`Arrow`](Arrow.md)

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.translateOnAxis

___

### translateX

▸ **translateX**(`distance`): [`Arrow`](Arrow.md)

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.translateX

___

### translateY

▸ **translateY**(`distance`): [`Arrow`](Arrow.md)

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.translateY

___

### translateZ

▸ **translateZ**(`distance`): [`Arrow`](Arrow.md)

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.translateZ

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

ArrowHelper.localToWorld

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

ArrowHelper.worldToLocal

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

ArrowHelper.lookAt

___

### add

▸ **add**(...`object`): [`Arrow`](Arrow.md)

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.add

___

### remove

▸ **remove**(...`object`): [`Arrow`](Arrow.md)

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.remove

___

### removeFromParent

▸ **removeFromParent**(): [`Arrow`](Arrow.md)

Removes this object from its current parent.

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.removeFromParent

___

### clear

▸ **clear**(): [`Arrow`](Arrow.md)

Removes all child objects.

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.clear

___

### attach

▸ **attach**(`object`): [`Arrow`](Arrow.md)

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.attach

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

ArrowHelper.getObjectById

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

ArrowHelper.getObjectByName

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

ArrowHelper.getObjectByProperty

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

ArrowHelper.getWorldPosition

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

ArrowHelper.getWorldQuaternion

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

ArrowHelper.getWorldScale

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

ArrowHelper.getWorldDirection

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

ArrowHelper.raycast

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

ArrowHelper.traverse

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

ArrowHelper.traverseVisible

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

ArrowHelper.traverseAncestors

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

ArrowHelper.updateMatrix

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

ArrowHelper.updateMatrixWorld

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

ArrowHelper.updateWorldMatrix

___

### toJSON

▸ **toJSON**(`meta?`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `meta?` | `Object` |
| `meta.geometries` | `any` |
| `meta.materials` | `any` |
| `meta.textures` | `any` |
| `meta.images` | `any` |

#### Returns

`any`

#### Inherited from

ArrowHelper.toJSON

___

### clone

▸ **clone**(`recursive?`): [`Arrow`](Arrow.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.clone

___

### copy

▸ **copy**(`source`, `recursive?`): [`Arrow`](Arrow.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`Arrow`](Arrow.md) |
| `recursive?` | `boolean` |

#### Returns

[`Arrow`](Arrow.md)

#### Inherited from

ArrowHelper.copy

___

### setDirection

▸ **setDirection**(`dir`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `dir` | `Vector3` | The desired direction. Must be a unit vector. |

#### Returns

`void`

#### Inherited from

ArrowHelper.setDirection

___

### setLength

▸ **setLength**(`length`, `headLength?`, `headWidth?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `length` | `number` | The desired length. |
| `headLength?` | `number` | - |
| `headWidth?` | `number` | - |

#### Returns

`void`

#### Inherited from

ArrowHelper.setLength

___

### setColor

▸ **setColor**(`color`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `color` | `ColorRepresentation` | The desired color. |

#### Returns

`void`

#### Inherited from

ArrowHelper.setColor
