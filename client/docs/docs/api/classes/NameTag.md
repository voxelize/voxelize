---
id: "NameTag"
title: "Class: NameTag"
sidebar_label: "NameTag"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`SpriteText`](SpriteText.md)

  ↳ **`NameTag`**

## Properties

### mesh

• **mesh**: [`SpriteText`](SpriteText.md)

___

### id

• **id**: `number`

Unique number of this object instance.

#### Inherited from

[SpriteText](SpriteText.md).[id](SpriteText.md#id-4)

___

### uuid

• **uuid**: `string`

#### Inherited from

[SpriteText](SpriteText.md).[uuid](SpriteText.md#uuid-4)

___

### name

• **name**: `string`

Optional name of the object (doesn't need to be unique).

**`default`** ''

#### Inherited from

[SpriteText](SpriteText.md).[name](SpriteText.md#name-4)

___

### parent

• **parent**: `Object3D`<`Event`\>

Object's parent in the scene graph.

**`default`** null

#### Inherited from

[SpriteText](SpriteText.md).[parent](SpriteText.md#parent-4)

___

### children

• **children**: `Object3D`<`Event`\>[]

Array with object's children.

**`default`** []

#### Inherited from

[SpriteText](SpriteText.md).[children](SpriteText.md#children-4)

___

### up

• **up**: `Vector3`

Up direction.

**`default`** THREE.Object3D.DefaultUp.clone()

#### Inherited from

[SpriteText](SpriteText.md).[up](SpriteText.md#up-4)

___

### position

• `Readonly` **position**: `Vector3`

Object's local position.

**`default`** new THREE.Vector3()

#### Inherited from

[SpriteText](SpriteText.md).[position](SpriteText.md#position-4)

___

### rotation

• `Readonly` **rotation**: `Euler`

Object's local rotation (Euler angles), in radians.

**`default`** new THREE.Euler()

#### Inherited from

[SpriteText](SpriteText.md).[rotation](SpriteText.md#rotation-4)

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

Object's local rotation as a Quaternion.

**`default`** new THREE.Quaternion()

#### Inherited from

[SpriteText](SpriteText.md).[quaternion](SpriteText.md#quaternion-4)

___

### scale

• `Readonly` **scale**: `Vector3`

Object's local scale.

**`default`** new THREE.Vector3()

#### Inherited from

[SpriteText](SpriteText.md).[scale](SpriteText.md#scale-4)

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

**`default`** new THREE.Matrix4()

#### Inherited from

[SpriteText](SpriteText.md).[modelViewMatrix](SpriteText.md#modelviewmatrix-4)

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

**`default`** new THREE.Matrix3()

#### Inherited from

[SpriteText](SpriteText.md).[normalMatrix](SpriteText.md#normalmatrix-4)

___

### matrix

• **matrix**: `Matrix4`

Local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

[SpriteText](SpriteText.md).[matrix](SpriteText.md#matrix-4)

___

### matrixWorld

• **matrixWorld**: `Matrix4`

The global transform of the object. If the Object3d has no parent, then it's identical to the local transform.

**`default`** new THREE.Matrix4()

#### Inherited from

[SpriteText](SpriteText.md).[matrixWorld](SpriteText.md#matrixworld-4)

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

When this is set, it calculates the matrix of position, (rotation or quaternion) and scale every frame and also
recalculates the matrixWorld property.

**`default`** THREE.Object3D.DefaultMatrixAutoUpdate

#### Inherited from

[SpriteText](SpriteText.md).[matrixAutoUpdate](SpriteText.md#matrixautoupdate-4)

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

When this is set, it calculates the matrixWorld in that frame and resets this property to false.

**`default`** false

#### Inherited from

[SpriteText](SpriteText.md).[matrixWorldNeedsUpdate](SpriteText.md#matrixworldneedsupdate-4)

___

### layers

• **layers**: `Layers`

**`default`** new THREE.Layers()

#### Inherited from

[SpriteText](SpriteText.md).[layers](SpriteText.md#layers-4)

___

### visible

• **visible**: `boolean`

Object gets rendered if true.

**`default`** true

#### Inherited from

[SpriteText](SpriteText.md).[visible](SpriteText.md#visible-4)

___

### castShadow

• **castShadow**: `boolean`

Gets rendered into shadow map.

**`default`** false

#### Inherited from

[SpriteText](SpriteText.md).[castShadow](SpriteText.md#castshadow-4)

___

### receiveShadow

• **receiveShadow**: `boolean`

Material gets baked in shadow receiving.

**`default`** false

#### Inherited from

[SpriteText](SpriteText.md).[receiveShadow](SpriteText.md#receiveshadow-4)

___

### frustumCulled

• **frustumCulled**: `boolean`

When this is set, it checks every frame if the object is in the frustum of the camera before rendering the object.
If set to false the object gets rendered every frame even if it is not in the frustum of the camera.

**`default`** true

#### Inherited from

[SpriteText](SpriteText.md).[frustumCulled](SpriteText.md#frustumculled-4)

___

### renderOrder

• **renderOrder**: `number`

Overrides the default rendering order of scene graph objects, from lowest to highest renderOrder.
Opaque and transparent objects remain sorted independently though.
When this property is set for an instance of Group, all descendants objects will be sorted and rendered together.

**`default`** 0

#### Inherited from

[SpriteText](SpriteText.md).[renderOrder](SpriteText.md#renderorder-4)

___

### animations

• **animations**: `AnimationClip`[]

Array with animation clips.

**`default`** []

#### Inherited from

[SpriteText](SpriteText.md).[animations](SpriteText.md#animations-4)

___

### userData

• **userData**: `Object`

An object that can be used to store custom data about the Object3d. It should not hold references to functions as these will not be cloned.

**`default`** {}

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

[SpriteText](SpriteText.md).[userData](SpriteText.md#userdata-4)

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

Custom depth material to be used when rendering to the depth map. Can only be used in context of meshes.
When shadow-casting with a DirectionalLight or SpotLight, if you are (a) modifying vertex positions in
the vertex shader, (b) using a displacement map, (c) using an alpha map with alphaTest, or (d) using a
transparent texture with alphaTest, you must specify a customDepthMaterial for proper shadows.

#### Inherited from

[SpriteText](SpriteText.md).[customDepthMaterial](SpriteText.md#customdepthmaterial-4)

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

Same as customDepthMaterial, but used with PointLight.

#### Inherited from

[SpriteText](SpriteText.md).[customDistanceMaterial](SpriteText.md#customdistancematerial-4)

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

Used to check whether this or derived classes are Object3Ds. Default is true.
You should not change this, as it is used internally for optimisation.

#### Inherited from

[SpriteText](SpriteText.md).[isObject3D](SpriteText.md#isobject3d-4)

___

### onBeforeRender

• **onBeforeRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

Calls before rendering object

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

[SpriteText](SpriteText.md).[onBeforeRender](SpriteText.md#onbeforerender-4)

___

### onAfterRender

• **onAfterRender**: (`renderer`: `WebGLRenderer`, `scene`: `Scene`, `camera`: `Camera`, `geometry`: `BufferGeometry`, `material`: `Material`, `group`: `Group`) => `void`

Calls after rendering object

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

[SpriteText](SpriteText.md).[onAfterRender](SpriteText.md#onafterrender-4)

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

[SpriteText](SpriteText.md).[DefaultUp](SpriteText.md#defaultup-4)

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[DefaultMatrixAutoUpdate](SpriteText.md#defaultmatrixautoupdate-4)

___

### type

• **type**: ``"Sprite"``

#### Inherited from

[SpriteText](SpriteText.md).[type](SpriteText.md#type-4)

___

### isSprite

• `Readonly` **isSprite**: ``true``

#### Inherited from

[SpriteText](SpriteText.md).[isSprite](SpriteText.md#issprite-4)

___

### geometry

• **geometry**: `BufferGeometry`

#### Inherited from

[SpriteText](SpriteText.md).[geometry](SpriteText.md#geometry-4)

___

### material

• **material**: `SpriteMaterial`

#### Inherited from

[SpriteText](SpriteText.md).[material](SpriteText.md#material-4)

___

### center

• **center**: `Vector2`

#### Inherited from

[SpriteText](SpriteText.md).[center](SpriteText.md#center-4)

## Constructors

### constructor

• **new NameTag**(`text`, `__namedParameters?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |
| `__namedParameters` | `Object` |
| `__namedParameters.fontFace?` | `string` |
| `__namedParameters.fontSize?` | `number` |
| `__namedParameters.yOffset?` | `number` |
| `__namedParameters.backgroundColor?` | `string` |

#### Overrides

[SpriteText](SpriteText.md).[constructor](SpriteText.md#constructor-4)

## Accessors

### text

• `get` **text**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.text

• `set` **text**(`text`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.text

___

### textHeight

• `get` **textHeight**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.textHeight

• `set` **textHeight**(`textHeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `textHeight` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.textHeight

___

### backgroundColor

• `get` **backgroundColor**(): `string` \| ``false``

#### Returns

`string` \| ``false``

#### Inherited from

SpriteText.backgroundColor

• `set` **backgroundColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| ``false`` |

#### Returns

`void`

#### Inherited from

SpriteText.backgroundColor

___

### padding

• `get` **padding**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.padding

• `set` **padding**(`padding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `padding` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.padding

___

### borderWidth

• `get` **borderWidth**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.borderWidth

• `set` **borderWidth**(`borderWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderWidth` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.borderWidth

___

### borderRadius

• `get` **borderRadius**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.borderRadius

• `set` **borderRadius**(`borderRadius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderRadius` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.borderRadius

___

### borderColor

• `get` **borderColor**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.borderColor

• `set` **borderColor**(`borderColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderColor` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.borderColor

___

### fontFace

• `get` **fontFace**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.fontFace

• `set` **fontFace**(`fontFace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontFace` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.fontFace

___

### fontSize

• `get` **fontSize**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.fontSize

• `set` **fontSize**(`fontSize`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontSize` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.fontSize

___

### fontWeight

• `get` **fontWeight**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.fontWeight

• `set` **fontWeight**(`fontWeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontWeight` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.fontWeight

___

### strokeWidth

• `get` **strokeWidth**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.strokeWidth

• `set` **strokeWidth**(`strokeWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeWidth` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.strokeWidth

___

### strokeColor

• `get` **strokeColor**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.strokeColor

• `set` **strokeColor**(`strokeColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeColor` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.strokeColor

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> | The function that gets called when the event is fired. |

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[addEventListener](SpriteText.md#addeventlistener-4)

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> | The function that gets called when the event is fired. |

#### Returns

`boolean`

#### Inherited from

[SpriteText](SpriteText.md).[hasEventListener](SpriteText.md#haseventlistener-4)

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> | The listener function that gets removed. |

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[removeEventListener](SpriteText.md#removeeventlistener-4)

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

[SpriteText](SpriteText.md).[dispatchEvent](SpriteText.md#dispatchevent-4)

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

[SpriteText](SpriteText.md).[applyMatrix4](SpriteText.md#applymatrix4-4)

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`NameTag`](NameTag.md)

Applies the rotation represented by the quaternion to the object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[applyQuaternion](SpriteText.md#applyquaternion-4)

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

[SpriteText](SpriteText.md).[setRotationFromAxisAngle](SpriteText.md#setrotationfromaxisangle-4)

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

[SpriteText](SpriteText.md).[setRotationFromEuler](SpriteText.md#setrotationfromeuler-4)

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

[SpriteText](SpriteText.md).[setRotationFromMatrix](SpriteText.md#setrotationfrommatrix-4)

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

[SpriteText](SpriteText.md).[setRotationFromQuaternion](SpriteText.md#setrotationfromquaternion-4)

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`NameTag`](NameTag.md)

Rotate an object along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateOnAxis](SpriteText.md#rotateonaxis-4)

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`NameTag`](NameTag.md)

Rotate an object along an axis in world space. The axis is assumed to be normalized. Method Assumes no rotated parent.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `angle` | `number` | The angle in radians. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateOnWorldAxis](SpriteText.md#rotateonworldaxis-4)

___

### rotateX

▸ **rotateX**(`angle`): [`NameTag`](NameTag.md)

Rotates the object around x axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateX](SpriteText.md#rotatex-4)

___

### rotateY

▸ **rotateY**(`angle`): [`NameTag`](NameTag.md)

Rotates the object around y axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateY](SpriteText.md#rotatey-4)

___

### rotateZ

▸ **rotateZ**(`angle`): [`NameTag`](NameTag.md)

Rotates the object around z axis in local space.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` | the angle to rotate in radians. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateZ](SpriteText.md#rotatez-4)

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`NameTag`](NameTag.md)

Translate an object by distance along an axis in object space. The axis is assumed to be normalized.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` | A normalized vector in object space. |
| `distance` | `number` | The distance to translate. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateOnAxis](SpriteText.md#translateonaxis-4)

___

### translateX

▸ **translateX**(`distance`): [`NameTag`](NameTag.md)

Translates object along x axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateX](SpriteText.md#translatex-4)

___

### translateY

▸ **translateY**(`distance`): [`NameTag`](NameTag.md)

Translates object along y axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateY](SpriteText.md#translatey-4)

___

### translateZ

▸ **translateZ**(`distance`): [`NameTag`](NameTag.md)

Translates object along z axis by distance.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` | Distance. |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateZ](SpriteText.md#translatez-4)

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

[SpriteText](SpriteText.md).[localToWorld](SpriteText.md#localtoworld-4)

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

[SpriteText](SpriteText.md).[worldToLocal](SpriteText.md#worldtolocal-4)

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

[SpriteText](SpriteText.md).[lookAt](SpriteText.md#lookat-4)

___

### add

▸ **add**(...`object`): [`NameTag`](NameTag.md)

Adds object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[add](SpriteText.md#add-4)

___

### remove

▸ **remove**(...`object`): [`NameTag`](NameTag.md)

Removes object as child of this object.

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[remove](SpriteText.md#remove-4)

___

### removeFromParent

▸ **removeFromParent**(): [`NameTag`](NameTag.md)

Removes this object from its current parent.

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[removeFromParent](SpriteText.md#removefromparent-4)

___

### clear

▸ **clear**(): [`NameTag`](NameTag.md)

Removes all child objects.

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[clear](SpriteText.md#clear-4)

___

### attach

▸ **attach**(`object`): [`NameTag`](NameTag.md)

Adds object as a child of this, while maintaining the object's world transform.

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[attach](SpriteText.md#attach-4)

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

[SpriteText](SpriteText.md).[getObjectById](SpriteText.md#getobjectbyid-4)

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

[SpriteText](SpriteText.md).[getObjectByName](SpriteText.md#getobjectbyname-4)

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

[SpriteText](SpriteText.md).[getObjectByProperty](SpriteText.md#getobjectbyproperty-4)

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

[SpriteText](SpriteText.md).[getWorldPosition](SpriteText.md#getworldposition-4)

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

[SpriteText](SpriteText.md).[getWorldQuaternion](SpriteText.md#getworldquaternion-4)

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

[SpriteText](SpriteText.md).[getWorldScale](SpriteText.md#getworldscale-4)

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

[SpriteText](SpriteText.md).[getWorldDirection](SpriteText.md#getworlddirection-4)

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

[SpriteText](SpriteText.md).[traverse](SpriteText.md#traverse-4)

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

[SpriteText](SpriteText.md).[traverseVisible](SpriteText.md#traversevisible-4)

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

[SpriteText](SpriteText.md).[traverseAncestors](SpriteText.md#traverseancestors-4)

___

### updateMatrix

▸ **updateMatrix**(): `void`

Updates local transform.

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[updateMatrix](SpriteText.md#updatematrix-4)

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

[SpriteText](SpriteText.md).[updateMatrixWorld](SpriteText.md#updatematrixworld-4)

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

[SpriteText](SpriteText.md).[updateWorldMatrix](SpriteText.md#updateworldmatrix-4)

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

[SpriteText](SpriteText.md).[toJSON](SpriteText.md#tojson-4)

___

### clone

▸ **clone**(`recursive?`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[clone](SpriteText.md#clone-4)

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

[SpriteText](SpriteText.md).[raycast](SpriteText.md#raycast-4)

___

### copy

▸ **copy**(`source`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`NameTag`](NameTag.md) |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[copy](SpriteText.md#copy-4)
