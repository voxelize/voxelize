---
id: "BoxLayer"
title: "Class: BoxLayer"
sidebar_label: "BoxLayer"
sidebar_position: 0
custom_edit_url: null
---

A layer of a canvas box. This is a group of six canvases that are rendered as a single mesh.

## Hierarchy

- `Mesh`

  ↳ **`BoxLayer`**

## Properties

### materials

• **materials**: `Map`<`string`, `MeshBasicMaterial`\>

The materials of the six faces of this box layer.

___

### width

• **width**: `number`

The width of the box layer.

___

### height

• **height**: `number`

The height of the box layer.

___

### depth

• **depth**: `number`

The depth of the box layer.

___

### widthSegments

• **widthSegments**: `number`

The width segments of the box layer.

___

### heightSegments

• **heightSegments**: `number`

The height segments of the box layer.

___

### depthSegments

• **depthSegments**: `number`

The depth segments of the box layer.

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

Mesh.id

___

### uuid

• **uuid**: `string`

#### Inherited from

Mesh.uuid

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`default`** ''

#### Inherited from

Mesh.name

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`default`** null

#### Inherited from

Mesh.parent

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`default`** []

#### Inherited from

Mesh.children

___

### up

• **up**: `Vector3`

Up direction.

**`default`** THREE.Object3D.DefaultUp.clone()

#### Inherited from

Mesh.up

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`default`** new THREE.Vector3()

#### Inherited from

Mesh.position

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`default`** new THREE.Euler()

#### Inherited from

Mesh.rotation

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`default`** new THREE.Quaternion()

#### Inherited from

Mesh.quaternion

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`default`** new THREE.Vector3()

#### Inherited from

Mesh.scale

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`default`** new THREE.Matrix4()

#### Inherited from

Mesh.modelViewMatrix

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`default`** new THREE.Matrix3()

#### Inherited from

Mesh.normalMatrix

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

Mesh.matrix

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

Mesh.matrixWorld

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and scale every frame and also
recalculates the matrixWorld property.

**`default`** THREE.Object3D.DefaultMatrixAutoUpdate

#### Inherited from

Mesh.matrixAutoUpdate

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`default`** false

#### Inherited from

Mesh.matrixWorldNeedsUpdate

___

### layers

• **layers**: `Layers`

**`default`** new THREE.Layers()

#### Inherited from

Mesh.layers

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`default`** true

#### Inherited from

Mesh.visible

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`default`** false

#### Inherited from

Mesh.castShadow

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`default`** false

#### Inherited from

Mesh.receiveShadow

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`default`** true

#### Inherited from

Mesh.frustumCulled

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`default`** 0

#### Inherited from

Mesh.renderOrder

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`default`** []

#### Inherited from

Mesh.animations

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`default`** {}

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Mesh.userData

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

Mesh.customDepthMaterial

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

Mesh.customDistanceMaterial

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

Mesh.isObject3D

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

Mesh.onBeforeRender

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

Mesh.onAfterRender

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

Mesh.DefaultUp

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

Mesh.DefaultMatrixAutoUpdate

___

### geometry

• **geometry**: `BufferGeometry`

#### Inherited from

Mesh.geometry

___

### material

• **material**: `Material` \| `Material`[]

#### Inherited from

Mesh.material

___

### morphTargetInfluences

• `Optional` **morphTargetInfluences**: `number`[]

#### Inherited from

Mesh.morphTargetInfluences

___

### morphTargetDictionary

• `Optional` **morphTargetDictionary**: `Object`

#### Index signature

▪ [key: `string`]: `number`

#### Inherited from

Mesh.morphTargetDictionary

___

### isMesh

• `Readonly` **isMesh**: ``true``

#### Inherited from

Mesh.isMesh

___

### type

• **type**: `string`

#### Inherited from

Mesh.type

## Constructors

### constructor

• **new BoxLayer**(`width`, `height`, `depth`, `widthSegments`, `heightSegments`, `depthSegments`, `side`, `transparent`)

Create a six-sided canvas box layer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `width` | `number` | The width of the box layer. |
| `height` | `number` | The height of the box layer. |
| `depth` | `number` | The depth of the box layer. |
| `widthSegments` | `number` | The width segments of the box layer. |
| `heightSegments` | `number` | The height segments of the box layer. |
| `depthSegments` | `number` | The depth segments of the box layer. |
| `side` | `Side` | The side of the box layer to render. |
| `transparent` | `boolean` | Whether or not should this canvas box be rendered as transparent. |

#### Overrides

Mesh.constructor

## Methods

### paint

▸ **paint**(`side`, `art`): `void`

Add art to the canvas(s) of this box layer.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-394) \| [`BoxSides`](../modules.md#boxsides-394)[] | The side(s) of the box layer to draw on. |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-394) \| `Color` | The art or art function to draw on the box layer's side. |

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
| `listener` | `EventListener`<`Event`, `T`, [`BoxLayer`](BoxLayer.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

Mesh.addEventListener

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
| `listener` | `EventListener`<`Event`, `T`, [`BoxLayer`](BoxLayer.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

Mesh.hasEventListener

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
| `listener` | `EventListener`<`Event`, `T`, [`BoxLayer`](BoxLayer.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

Mesh.removeEventListener

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

Mesh.dispatchEvent

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

Mesh.applyMatrix4

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`BoxLayer`](BoxLayer.md)

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.applyQuaternion

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

Mesh.setRotationFromAxisAngle

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

Mesh.setRotationFromEuler

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

Mesh.setRotationFromMatrix

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

Mesh.setRotationFromQuaternion

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`BoxLayer`](BoxLayer.md)

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.rotateOnAxis

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`BoxLayer`](BoxLayer.md)

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.rotateOnWorldAxis

___

### rotateX

▸ **rotateX**(`angle`): [`BoxLayer`](BoxLayer.md)

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.rotateX

___

### rotateY

▸ **rotateY**(`angle`): [`BoxLayer`](BoxLayer.md)

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.rotateY

___

### rotateZ

▸ **rotateZ**(`angle`): [`BoxLayer`](BoxLayer.md)

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.rotateZ

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`BoxLayer`](BoxLayer.md)

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.translateOnAxis

___

### translateX

▸ **translateX**(`distance`): [`BoxLayer`](BoxLayer.md)

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.translateX

___

### translateY

▸ **translateY**(`distance`): [`BoxLayer`](BoxLayer.md)

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.translateY

___

### translateZ

▸ **translateZ**(`distance`): [`BoxLayer`](BoxLayer.md)

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.translateZ

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

Mesh.localToWorld

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

Mesh.worldToLocal

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

Mesh.lookAt

___

### add

▸ **add**(...`object`): [`BoxLayer`](BoxLayer.md)

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.add

___

### remove

▸ **remove**(...`object`): [`BoxLayer`](BoxLayer.md)

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.remove

___

### removeFromParent

▸ **removeFromParent**(): [`BoxLayer`](BoxLayer.md)

Removes this object from its current parent.

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.removeFromParent

___

### clear

▸ **clear**(): [`BoxLayer`](BoxLayer.md)

Removes all child objects.

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.clear

___

### attach

▸ **attach**(`object`): [`BoxLayer`](BoxLayer.md)

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.attach

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

Mesh.getObjectById

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

Mesh.getObjectByName

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

Mesh.getObjectByProperty

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

Mesh.getWorldPosition

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

Mesh.getWorldQuaternion

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

Mesh.getWorldScale

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

Mesh.getWorldDirection

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

Mesh.traverse

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

Mesh.traverseVisible

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

Mesh.traverseAncestors

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

Mesh.updateMatrix

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

Mesh.updateMatrixWorld

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

Mesh.updateWorldMatrix

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

Mesh.toJSON

___

### clone

▸ **clone**(`recursive?`): [`BoxLayer`](BoxLayer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.clone

___

### copy

▸ **copy**(`source`, `recursive?`): [`BoxLayer`](BoxLayer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`BoxLayer`](BoxLayer.md) |
| `recursive?` | `boolean` |

#### Returns

[`BoxLayer`](BoxLayer.md)

#### Inherited from

Mesh.copy

___

### updateMorphTargets

▸ **updateMorphTargets**(): `void`

#### Returns

`void`

#### Inherited from

Mesh.updateMorphTargets

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

Mesh.raycast
