---
id: "Sky"
title: "Class: Sky"
sidebar_label: "Sky"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`CanvasBox`](CanvasBox.md)

  ↳ **`Sky`**

## Properties

### params

• **params**: [`CanvasBoxParams`](../modules.md#canvasboxparams-210)

#### Inherited from

[CanvasBox](CanvasBox.md).[params](CanvasBox.md#params-210)

___

### boxLayers

• **boxLayers**: [`BoxLayer`](BoxLayer.md)[] = `[]`

#### Inherited from

[CanvasBox](CanvasBox.md).[boxLayers](CanvasBox.md#boxlayers-210)

___

### width

• **width**: `number`

#### Inherited from

[CanvasBox](CanvasBox.md).[width](CanvasBox.md#width-210)

___

### height

• **height**: `number`

#### Inherited from

[CanvasBox](CanvasBox.md).[height](CanvasBox.md#height-210)

___

### depth

• **depth**: `number`

#### Inherited from

[CanvasBox](CanvasBox.md).[depth](CanvasBox.md#depth-210)

___

### scaleColor

• **scaleColor**: (`multiplier`: `number`) => `void`

#### Type declaration

▸ (`multiplier`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `multiplier` | `number` |

##### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[scaleColor](CanvasBox.md#scalecolor-210)

___

### uTopColor

• **uTopColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uMiddleColor

• **uMiddleColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### uBottomColor

• **uBottomColor**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `value` | `Color` |

___

### dimension

• **dimension**: `number` = `2000`

___

### lerpFactor

• **lerpFactor**: `number` = `0.01`

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

[CanvasBox](CanvasBox.md).[id](CanvasBox.md#id-210)

___

### uuid

• **uuid**: `string`

#### Inherited from

[CanvasBox](CanvasBox.md).[uuid](CanvasBox.md#uuid-210)

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`default`** ''

#### Inherited from

[CanvasBox](CanvasBox.md).[name](CanvasBox.md#name-210)

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`default`** null

#### Inherited from

[CanvasBox](CanvasBox.md).[parent](CanvasBox.md#parent-210)

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`default`** []

#### Inherited from

[CanvasBox](CanvasBox.md).[children](CanvasBox.md#children-210)

___

### up

• **up**: `Vector3`

Up direction.

**`default`** THREE.Object3D.DefaultUp.clone()

#### Inherited from

[CanvasBox](CanvasBox.md).[up](CanvasBox.md#up-210)

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`default`** new THREE.Vector3()

#### Inherited from

[CanvasBox](CanvasBox.md).[position](CanvasBox.md#position-210)

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`default`** new THREE.Euler()

#### Inherited from

[CanvasBox](CanvasBox.md).[rotation](CanvasBox.md#rotation-210)

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`default`** new THREE.Quaternion()

#### Inherited from

[CanvasBox](CanvasBox.md).[quaternion](CanvasBox.md#quaternion-210)

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`default`** new THREE.Vector3()

#### Inherited from

[CanvasBox](CanvasBox.md).[scale](CanvasBox.md#scale-210)

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`default`** new THREE.Matrix4()

#### Inherited from

[CanvasBox](CanvasBox.md).[modelViewMatrix](CanvasBox.md#modelviewmatrix-210)

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`default`** new THREE.Matrix3()

#### Inherited from

[CanvasBox](CanvasBox.md).[normalMatrix](CanvasBox.md#normalmatrix-210)

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

[CanvasBox](CanvasBox.md).[matrix](CanvasBox.md#matrix-210)

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

[CanvasBox](CanvasBox.md).[matrixWorld](CanvasBox.md#matrixworld-210)

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and scale every frame and also
recalculates the matrixWorld property.

**`default`** THREE.Object3D.DefaultMatrixAutoUpdate

#### Inherited from

[CanvasBox](CanvasBox.md).[matrixAutoUpdate](CanvasBox.md#matrixautoupdate-210)

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`default`** false

#### Inherited from

[CanvasBox](CanvasBox.md).[matrixWorldNeedsUpdate](CanvasBox.md#matrixworldneedsupdate-210)

___

### layers

• **layers**: `Layers`

**`default`** new THREE.Layers()

#### Inherited from

[CanvasBox](CanvasBox.md).[layers](CanvasBox.md#layers-210)

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`default`** true

#### Inherited from

[CanvasBox](CanvasBox.md).[visible](CanvasBox.md#visible-210)

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`default`** false

#### Inherited from

[CanvasBox](CanvasBox.md).[castShadow](CanvasBox.md#castshadow-210)

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`default`** false

#### Inherited from

[CanvasBox](CanvasBox.md).[receiveShadow](CanvasBox.md#receiveshadow-210)

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`default`** true

#### Inherited from

[CanvasBox](CanvasBox.md).[frustumCulled](CanvasBox.md#frustumculled-210)

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`default`** 0

#### Inherited from

[CanvasBox](CanvasBox.md).[renderOrder](CanvasBox.md#renderorder-210)

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`default`** []

#### Inherited from

[CanvasBox](CanvasBox.md).[animations](CanvasBox.md#animations-210)

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`default`** {}

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

[CanvasBox](CanvasBox.md).[userData](CanvasBox.md#userdata-210)

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

[CanvasBox](CanvasBox.md).[customDepthMaterial](CanvasBox.md#customdepthmaterial-210)

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

[CanvasBox](CanvasBox.md).[customDistanceMaterial](CanvasBox.md#customdistancematerial-210)

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

[CanvasBox](CanvasBox.md).[isObject3D](CanvasBox.md#isobject3d-210)

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

[CanvasBox](CanvasBox.md).[onBeforeRender](CanvasBox.md#onbeforerender-210)

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

[CanvasBox](CanvasBox.md).[onAfterRender](CanvasBox.md#onafterrender-210)

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

[CanvasBox](CanvasBox.md).[DefaultUp](CanvasBox.md#defaultup-210)

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

[CanvasBox](CanvasBox.md).[DefaultMatrixAutoUpdate](CanvasBox.md#defaultmatrixautoupdate-210)

___

### type

• **type**: ``"Group"``

#### Inherited from

[CanvasBox](CanvasBox.md).[type](CanvasBox.md#type-210)

___

### isGroup

• `Readonly` **isGroup**: ``true``

#### Inherited from

[CanvasBox](CanvasBox.md).[isGroup](CanvasBox.md#isgroup-210)

## Methods

### makeBoxes

▸ **makeBoxes**(): `void`

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[makeBoxes](CanvasBox.md#makeboxes-210)

___

### paint

▸ **paint**(`side`, `art`, `layer?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `side` | [`BoxSides`](../modules.md#boxsides-210) \| [`BoxSides`](../modules.md#boxsides-210)[] | `undefined` |
| `art` | `Texture` \| [`ArtFunction`](../modules.md#artfunction-210) \| `Color` | `undefined` |
| `layer` | `number` | `0` |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[paint](CanvasBox.md#paint-210)

___

### getMiddleColor

▸ **getMiddleColor**(): `Color`

#### Returns

`Color`

___

### update

▸ **update**(`position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[addEventListener](CanvasBox.md#addeventlistener-210)

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

[CanvasBox](CanvasBox.md).[hasEventListener](CanvasBox.md#haseventlistener-210)

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
| `listener` | `EventListener`<`Event`, `T`, [`Sky`](Sky.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[removeEventListener](CanvasBox.md#removeeventlistener-210)

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

[CanvasBox](CanvasBox.md).[dispatchEvent](CanvasBox.md#dispatchevent-210)

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

[CanvasBox](CanvasBox.md).[applyMatrix4](CanvasBox.md#applymatrix4-210)

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`Sky`](Sky.md)

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[applyQuaternion](CanvasBox.md#applyquaternion-210)

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

[CanvasBox](CanvasBox.md).[setRotationFromAxisAngle](CanvasBox.md#setrotationfromaxisangle-210)

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

[CanvasBox](CanvasBox.md).[setRotationFromEuler](CanvasBox.md#setrotationfromeuler-210)

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

[CanvasBox](CanvasBox.md).[setRotationFromMatrix](CanvasBox.md#setrotationfrommatrix-210)

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

[CanvasBox](CanvasBox.md).[setRotationFromQuaternion](CanvasBox.md#setrotationfromquaternion-210)

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`Sky`](Sky.md)

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[rotateOnAxis](CanvasBox.md#rotateonaxis-210)

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`Sky`](Sky.md)

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[rotateOnWorldAxis](CanvasBox.md#rotateonworldaxis-210)

___

### rotateX

▸ **rotateX**(`angle`): [`Sky`](Sky.md)

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[rotateX](CanvasBox.md#rotatex-210)

___

### rotateY

▸ **rotateY**(`angle`): [`Sky`](Sky.md)

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[rotateY](CanvasBox.md#rotatey-210)

___

### rotateZ

▸ **rotateZ**(`angle`): [`Sky`](Sky.md)

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[rotateZ](CanvasBox.md#rotatez-210)

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`Sky`](Sky.md)

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[translateOnAxis](CanvasBox.md#translateonaxis-210)

___

### translateX

▸ **translateX**(`distance`): [`Sky`](Sky.md)

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[translateX](CanvasBox.md#translatex-210)

___

### translateY

▸ **translateY**(`distance`): [`Sky`](Sky.md)

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[translateY](CanvasBox.md#translatey-210)

___

### translateZ

▸ **translateZ**(`distance`): [`Sky`](Sky.md)

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[translateZ](CanvasBox.md#translatez-210)

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

[CanvasBox](CanvasBox.md).[localToWorld](CanvasBox.md#localtoworld-210)

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

[CanvasBox](CanvasBox.md).[worldToLocal](CanvasBox.md#worldtolocal-210)

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

[CanvasBox](CanvasBox.md).[lookAt](CanvasBox.md#lookat-210)

___

### add

▸ **add**(...`object`): [`Sky`](Sky.md)

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[add](CanvasBox.md#add-210)

___

### remove

▸ **remove**(...`object`): [`Sky`](Sky.md)

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[remove](CanvasBox.md#remove-210)

___

### removeFromParent

▸ **removeFromParent**(): [`Sky`](Sky.md)

Removes this object from its current parent.

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[removeFromParent](CanvasBox.md#removefromparent-210)

___

### clear

▸ **clear**(): [`Sky`](Sky.md)

Removes all child objects.

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[clear](CanvasBox.md#clear-210)

___

### attach

▸ **attach**(`object`): [`Sky`](Sky.md)

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[attach](CanvasBox.md#attach-210)

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

[CanvasBox](CanvasBox.md).[getObjectById](CanvasBox.md#getobjectbyid-210)

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

[CanvasBox](CanvasBox.md).[getObjectByName](CanvasBox.md#getobjectbyname-210)

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

[CanvasBox](CanvasBox.md).[getObjectByProperty](CanvasBox.md#getobjectbyproperty-210)

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

[CanvasBox](CanvasBox.md).[getWorldPosition](CanvasBox.md#getworldposition-210)

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

[CanvasBox](CanvasBox.md).[getWorldQuaternion](CanvasBox.md#getworldquaternion-210)

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

[CanvasBox](CanvasBox.md).[getWorldScale](CanvasBox.md#getworldscale-210)

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

[CanvasBox](CanvasBox.md).[getWorldDirection](CanvasBox.md#getworlddirection-210)

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

[CanvasBox](CanvasBox.md).[raycast](CanvasBox.md#raycast-210)

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

[CanvasBox](CanvasBox.md).[traverse](CanvasBox.md#traverse-210)

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

[CanvasBox](CanvasBox.md).[traverseVisible](CanvasBox.md#traversevisible-210)

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

[CanvasBox](CanvasBox.md).[traverseAncestors](CanvasBox.md#traverseancestors-210)

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

[CanvasBox](CanvasBox.md).[updateMatrix](CanvasBox.md#updatematrix-210)

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

[CanvasBox](CanvasBox.md).[updateMatrixWorld](CanvasBox.md#updatematrixworld-210)

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

[CanvasBox](CanvasBox.md).[updateWorldMatrix](CanvasBox.md#updateworldmatrix-210)

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

[CanvasBox](CanvasBox.md).[toJSON](CanvasBox.md#tojson-210)

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

[CanvasBox](CanvasBox.md).[clone](CanvasBox.md#clone-210)

___

### copy

▸ **copy**(`source`, `recursive?`): [`Sky`](Sky.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`Sky`](Sky.md) |
| `recursive?` | `boolean` |

#### Returns

[`Sky`](Sky.md)

#### Inherited from

[CanvasBox](CanvasBox.md).[copy](CanvasBox.md#copy-210)

## Accessors

### boxMaterials

• `get` **boxMaterials**(): `Map`<`string`, `MeshBasicMaterial`\>

#### Returns

`Map`<`string`, `MeshBasicMaterial`\>

#### Inherited from

CanvasBox.boxMaterials

## Constructors

### constructor

• **new Sky**(`dimension?`, `lerpFactor?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `dimension` | `number` | `2000` |
| `lerpFactor` | `number` | `0.01` |

#### Overrides

[CanvasBox](CanvasBox.md).[constructor](CanvasBox.md#constructor-210)
