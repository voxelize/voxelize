---
id: "Entity"
title: "Class: Entity<T>"
sidebar_label: "Entity"
sidebar_position: 0
custom_edit_url: null
---

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

## Hierarchy

- `Group`

  ↳ **`Entity`**

## Properties

### DEFAULT\_MATRIX\_AUTO\_UPDATE

▪ `Static` **DEFAULT\_MATRIX\_AUTO\_UPDATE**: `boolean`

The default setting for [matrixAutoUpdate](Entity.md#matrixautoupdate-14) for newly created Object3Ds.

#### Inherited from

Group.DEFAULT\_MATRIX\_AUTO\_UPDATE

___

### DEFAULT\_MATRIX\_WORLD\_AUTO\_UPDATE

▪ `Static` **DEFAULT\_MATRIX\_WORLD\_AUTO\_UPDATE**: `boolean`

The default setting for [matrixWorldAutoUpdate](Entity.md#matrixworldautoupdate-14) for newly created Object3Ds.

#### Inherited from

Group.DEFAULT\_MATRIX\_WORLD\_AUTO\_UPDATE

___

### DEFAULT\_UP

▪ `Static` **DEFAULT\_UP**: `Vector3`

The default [up](Entity.md#up-14) direction for objects, also used as the default position for DirectionalLight,
HemisphereLight and Spotlight (which creates lights shining from the top down).

Set to ( 0, 1, 0 ) by default.

#### Inherited from

Group.DEFAULT\_UP

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`Default`**

[]

#### Inherited from

Group.animations

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`Default`**

false

#### Inherited from

Group.castShadow

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`Default`**

[]

#### Inherited from

Group.children

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

Group.customDepthMaterial

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

Group.customDistanceMaterial

___

### entId

• **entId**: `string`

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`Default`**

true

#### Inherited from

Group.frustumCulled

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

Group.id

___

### isGroup

• `Readonly` **isGroup**: ``true``

#### Inherited from

Group.isGroup

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

Group.isObject3D

___

### layers

• **layers**: `Layers`

**`Default`**

new THREE.Layers()

#### Inherited from

Group.layers

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`Default`**

new THREE.Matrix4()

#### Inherited from

Group.matrix

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and
scale every frame and also recalculates the matrixWorld property. Default is Object3D.DEFAULT_MATRIX_AUTO_UPDATE (true).

#### Inherited from

Group.matrixAutoUpdate

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`Default`**

new THREE.Matrix4()

#### Inherited from

Group.matrixWorld

___

### matrixWorldAutoUpdate

• **matrixWorldAutoUpdate**: `boolean`

If set, then the renderer checks every frame if the object and its children need matrix updates.
When it isn't, then you have to maintain all matrices in the object and its children yourself.
Default is Object3D.DEFAULT_MATRIX_WORLD_AUTO_UPDATE (true).

#### Inherited from

Group.matrixWorldAutoUpdate

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`Default`**

false

#### Inherited from

Group.matrixWorldNeedsUpdate

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`Default`**

new THREE.Matrix4()

#### Inherited from

Group.modelViewMatrix

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`Default`**

''

#### Inherited from

Group.name

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`Default`**

new THREE.Matrix3()

#### Inherited from

Group.normalMatrix

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

Group.onAfterRender

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

Group.onBeforeRender

___

### onCreate

• **onCreate**: (`data`: `T`) => `void`

#### Type declaration

▸ (`data`): `void`

Called when the entity is created.

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### onDelete

• **onDelete**: (`data`: `T`) => `void`

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### onUpdate

• **onUpdate**: (`data`: `T`) => `void`

#### Type declaration

▸ (`data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `T` |

##### Returns

`void`

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`Default`**

null

#### Inherited from

Group.parent

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`Default`**

new THREE.Vector3()

#### Inherited from

Group.position

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`Default`**

new THREE.Quaternion()

#### Inherited from

Group.quaternion

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`Default`**

false

#### Inherited from

Group.receiveShadow

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`Default`**

0

#### Inherited from

Group.renderOrder

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`Default`**

new THREE.Euler()

#### Inherited from

Group.rotation

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`Default`**

new THREE.Vector3()

#### Inherited from

Group.scale

___

### type

• **type**: ``"Group"``

#### Inherited from

Group.type

___

### up

• **up**: `Vector3`

This is used by the [lookAt](Entity.md#lookat-14) method, for example, to determine the orientation of the result.

Default is Object3D.DEFAULT_UP - that is, `( 0, 1, 0 )`.

**`Default`**

Object3D.DEFAULT_UP

#### Inherited from

Group.up

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`Default`**

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Group.userData

___

### uuid

• **uuid**: `string`

#### Inherited from

Group.uuid

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`Default`**

true

#### Inherited from

Group.visible

## Methods

### add

▸ **add**(...`object`): [`Entity`](Entity.md)<`T`\>

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.add

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
| `listener` | `EventListener`<`Event`, `T`, [`Entity`](Entity.md)<`T`\>\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

Group.addEventListener

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

Group.applyMatrix4

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`Entity`](Entity.md)<`T`\>

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.applyQuaternion

___

### attach

▸ **attach**(`object`): [`Entity`](Entity.md)<`T`\>

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.attach

___

### clear

▸ **clear**(): [`Entity`](Entity.md)<`T`\>

Removes all child objects.

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.clear

___

### clone

▸ **clone**(`recursive?`): [`Entity`](Entity.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.clone

___

### copy

▸ **copy**(`source`, `recursive?`): [`Entity`](Entity.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`Entity`](Entity.md)<`T`\> |
| `recursive?` | `boolean` |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.copy

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

Group.dispatchEvent

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

Group.getObjectById

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

Group.getObjectByName

___

### getObjectByProperty

▸ **getObjectByProperty**(`name`, `value`): `Object3D`<`Event`\>

Searches through an object and its children, starting with the object itself,
and returns the first with a property that matches the value given.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | the property name to search for. |
| `value` | `any` | value of the given property. |

#### Returns

`Object3D`<`Event`\>

#### Inherited from

Group.getObjectByProperty

___

### getObjectsByProperty

▸ **getObjectsByProperty**(`name`, `value`): `Object3D`<`Event`\>[]

Searches through an object and its children, starting with the object itself,
and returns all the objects with a property that matches the value given.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | the property name to search for. |
| `value` | `any` | value of the given property. |

#### Returns

`Object3D`<`Event`\>[]

#### Inherited from

Group.getObjectsByProperty

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
| `listener` | `EventListener`<`Event`, `T`, [`Entity`](Entity.md)<`T`\>\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

Group.hasEventListener

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

Group.localToWorld

___

### lookAt

▸ **lookAt**(`vector`): `void`

Optionally, the x, y and z components of the world space position.
Rotates the object to face a point in world space.
This method does not support objects having non-uniformly-scaled parent(s).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `vector` | `Vector3` | A world vector to look at. |

#### Returns

`void`

#### Inherited from

Group.lookAt

▸ **lookAt**(`x`, `y`, `z`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`void`

#### Inherited from

Group.lookAt

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

___

### remove

▸ **remove**(...`object`): [`Entity`](Entity.md)<`T`\>

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.remove

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
| `listener` | `EventListener`<`Event`, `T`, [`Entity`](Entity.md)<`T`\>\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

Group.removeEventListener

___

### removeFromParent

▸ **removeFromParent**(): [`Entity`](Entity.md)<`T`\>

Removes this object from its current parent.

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.removeFromParent

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`Entity`](Entity.md)<`T`\>

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.rotateOnAxis

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`Entity`](Entity.md)<`T`\>

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.rotateOnWorldAxis

___

### rotateX

▸ **rotateX**(`angle`): [`Entity`](Entity.md)<`T`\>

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.rotateX

___

### rotateY

▸ **rotateY**(`angle`): [`Entity`](Entity.md)<`T`\>

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.rotateY

___

### rotateZ

▸ **rotateZ**(`angle`): [`Entity`](Entity.md)<`T`\>

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.rotateZ

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

Group.setRotationFromAxisAngle

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

Group.setRotationFromEuler

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

Group.setRotationFromMatrix

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

Group.setRotationFromQuaternion

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

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`Entity`](Entity.md)<`T`\>

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.translateOnAxis

___

### translateX

▸ **translateX**(`distance`): [`Entity`](Entity.md)<`T`\>

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.translateX

___

### translateY

▸ **translateY**(`distance`): [`Entity`](Entity.md)<`T`\>

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.translateY

___

### translateZ

▸ **translateZ**(`distance`): [`Entity`](Entity.md)<`T`\>

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Entity`](Entity.md)<`T`\>

#### Inherited from

Group.translateZ

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

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

Group.updateMatrix

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

Group.updateMatrixWorld

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

Group.updateWorldMatrix

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

Group.worldToLocal

## Constructors

### constructor

• **new Entity**<`T`\>(`id`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `any` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Overrides

Group.constructor
