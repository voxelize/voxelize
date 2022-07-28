[@voxelize/client](../README.md) / [Exports](../modules.md) / NameTag

# Class: NameTag

## Hierarchy

- [`SpriteText`](SpriteText.md)

  ↳ **`NameTag`**

## Table of contents

### Constructors

- [constructor](NameTag.md#constructor)

### Properties

- [animations](NameTag.md#animations)
- [castShadow](NameTag.md#castshadow)
- [center](NameTag.md#center)
- [children](NameTag.md#children)
- [customDepthMaterial](NameTag.md#customdepthmaterial)
- [customDistanceMaterial](NameTag.md#customdistancematerial)
- [frustumCulled](NameTag.md#frustumculled)
- [geometry](NameTag.md#geometry)
- [id](NameTag.md#id)
- [isObject3D](NameTag.md#isobject3d)
- [isSprite](NameTag.md#issprite)
- [layers](NameTag.md#layers)
- [material](NameTag.md#material)
- [matrix](NameTag.md#matrix)
- [matrixAutoUpdate](NameTag.md#matrixautoupdate)
- [matrixWorld](NameTag.md#matrixworld)
- [matrixWorldNeedsUpdate](NameTag.md#matrixworldneedsupdate)
- [mesh](NameTag.md#mesh)
- [modelViewMatrix](NameTag.md#modelviewmatrix)
- [name](NameTag.md#name)
- [normalMatrix](NameTag.md#normalmatrix)
- [onAfterRender](NameTag.md#onafterrender)
- [onBeforeRender](NameTag.md#onbeforerender)
- [parent](NameTag.md#parent)
- [position](NameTag.md#position)
- [quaternion](NameTag.md#quaternion)
- [receiveShadow](NameTag.md#receiveshadow)
- [renderOrder](NameTag.md#renderorder)
- [rotation](NameTag.md#rotation)
- [scale](NameTag.md#scale)
- [type](NameTag.md#type)
- [up](NameTag.md#up)
- [userData](NameTag.md#userdata)
- [uuid](NameTag.md#uuid)
- [visible](NameTag.md#visible)
- [DefaultMatrixAutoUpdate](NameTag.md#defaultmatrixautoupdate)
- [DefaultUp](NameTag.md#defaultup)

### Accessors

- [backgroundColor](NameTag.md#backgroundcolor)
- [borderColor](NameTag.md#bordercolor)
- [borderRadius](NameTag.md#borderradius)
- [borderWidth](NameTag.md#borderwidth)
- [fontFace](NameTag.md#fontface)
- [fontSize](NameTag.md#fontsize)
- [fontWeight](NameTag.md#fontweight)
- [padding](NameTag.md#padding)
- [strokeColor](NameTag.md#strokecolor)
- [strokeWidth](NameTag.md#strokewidth)
- [text](NameTag.md#text)
- [textHeight](NameTag.md#textheight)

### Methods

- [add](NameTag.md#add)
- [addEventListener](NameTag.md#addeventlistener)
- [applyMatrix4](NameTag.md#applymatrix4)
- [applyQuaternion](NameTag.md#applyquaternion)
- [attach](NameTag.md#attach)
- [clear](NameTag.md#clear)
- [clone](NameTag.md#clone)
- [copy](NameTag.md#copy)
- [dispatchEvent](NameTag.md#dispatchevent)
- [getObjectById](NameTag.md#getobjectbyid)
- [getObjectByName](NameTag.md#getobjectbyname)
- [getObjectByProperty](NameTag.md#getobjectbyproperty)
- [getWorldDirection](NameTag.md#getworlddirection)
- [getWorldPosition](NameTag.md#getworldposition)
- [getWorldQuaternion](NameTag.md#getworldquaternion)
- [getWorldScale](NameTag.md#getworldscale)
- [hasEventListener](NameTag.md#haseventlistener)
- [localToWorld](NameTag.md#localtoworld)
- [lookAt](NameTag.md#lookat)
- [raycast](NameTag.md#raycast)
- [remove](NameTag.md#remove)
- [removeEventListener](NameTag.md#removeeventlistener)
- [removeFromParent](NameTag.md#removefromparent)
- [rotateOnAxis](NameTag.md#rotateonaxis)
- [rotateOnWorldAxis](NameTag.md#rotateonworldaxis)
- [rotateX](NameTag.md#rotatex)
- [rotateY](NameTag.md#rotatey)
- [rotateZ](NameTag.md#rotatez)
- [setRotationFromAxisAngle](NameTag.md#setrotationfromaxisangle)
- [setRotationFromEuler](NameTag.md#setrotationfromeuler)
- [setRotationFromMatrix](NameTag.md#setrotationfrommatrix)
- [setRotationFromQuaternion](NameTag.md#setrotationfromquaternion)
- [toJSON](NameTag.md#tojson)
- [translateOnAxis](NameTag.md#translateonaxis)
- [translateX](NameTag.md#translatex)
- [translateY](NameTag.md#translatey)
- [translateZ](NameTag.md#translatez)
- [traverse](NameTag.md#traverse)
- [traverseAncestors](NameTag.md#traverseancestors)
- [traverseVisible](NameTag.md#traversevisible)
- [updateMatrix](NameTag.md#updatematrix)
- [updateMatrixWorld](NameTag.md#updatematrixworld)
- [updateWorldMatrix](NameTag.md#updateworldmatrix)
- [worldToLocal](NameTag.md#worldtolocal)

## Constructors

### constructor

• **new NameTag**(`text`, `__namedParameters?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |
| `__namedParameters` | `Object` |
| `__namedParameters.backgroundColor?` | `string` |
| `__namedParameters.fontFace?` | `string` |
| `__namedParameters.fontSize?` | `number` |
| `__namedParameters.yOffset?` | `number` |

#### Overrides

[SpriteText](SpriteText.md).[constructor](SpriteText.md#constructor)

#### Defined in

[client/src/libs/nametag.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/nametag.ts#L8)

## Properties

### animations

• **animations**: `AnimationClip`[]

#### Inherited from

[SpriteText](SpriteText.md).[animations](SpriteText.md#animations)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:160

___

### castShadow

• **castShadow**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[castShadow](SpriteText.md#castshadow)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:133

___

### center

• **center**: `Vector2`

#### Inherited from

[SpriteText](SpriteText.md).[center](SpriteText.md#center)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:16

___

### children

• **children**: `Object3D`<`Event`\>[]

#### Inherited from

[SpriteText](SpriteText.md).[children](SpriteText.md#children)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:51

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

#### Inherited from

[SpriteText](SpriteText.md).[customDepthMaterial](SpriteText.md#customdepthmaterial)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:174

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

#### Inherited from

[SpriteText](SpriteText.md).[customDistanceMaterial](SpriteText.md#customdistancematerial)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:179

___

### frustumCulled

• **frustumCulled**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[frustumCulled](SpriteText.md#frustumculled)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:146

___

### geometry

• **geometry**: `BufferGeometry`

#### Inherited from

[SpriteText](SpriteText.md).[geometry](SpriteText.md#geometry)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:14

___

### id

• **id**: `number`

#### Inherited from

[SpriteText](SpriteText.md).[id](SpriteText.md#id)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:26

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

#### Inherited from

[SpriteText](SpriteText.md).[isObject3D](SpriteText.md#isobject3d)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:185

___

### isSprite

• `Readonly` **isSprite**: ``true``

#### Inherited from

[SpriteText](SpriteText.md).[isSprite](SpriteText.md#issprite)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:12

___

### layers

• **layers**: `Layers`

#### Inherited from

[SpriteText](SpriteText.md).[layers](SpriteText.md#layers)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:121

___

### material

• **material**: `SpriteMaterial`

#### Inherited from

[SpriteText](SpriteText.md).[material](SpriteText.md#material)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:15

___

### matrix

• **matrix**: `Matrix4`

#### Inherited from

[SpriteText](SpriteText.md).[matrix](SpriteText.md#matrix)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:97

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[matrixAutoUpdate](SpriteText.md#matrixautoupdate)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:110

___

### matrixWorld

• **matrixWorld**: `Matrix4`

#### Inherited from

[SpriteText](SpriteText.md).[matrixWorld](SpriteText.md#matrixworld)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:103

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[matrixWorldNeedsUpdate](SpriteText.md#matrixworldneedsupdate)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:116

___

### mesh

• **mesh**: [`SpriteText`](SpriteText.md)

#### Defined in

[client/src/libs/nametag.ts:6](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/nametag.ts#L6)

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

#### Inherited from

[SpriteText](SpriteText.md).[modelViewMatrix](SpriteText.md#modelviewmatrix)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:86

___

### name

• **name**: `string`

#### Inherited from

[SpriteText](SpriteText.md).[name](SpriteText.md#name)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:34

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

#### Inherited from

[SpriteText](SpriteText.md).[normalMatrix](SpriteText.md#normalmatrix)

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

[SpriteText](SpriteText.md).[onAfterRender](SpriteText.md#onafterrender)

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

[SpriteText](SpriteText.md).[onBeforeRender](SpriteText.md#onbeforerender)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:190

___

### parent

• **parent**: `Object3D`<`Event`\>

#### Inherited from

[SpriteText](SpriteText.md).[parent](SpriteText.md#parent)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:45

___

### position

• `Readonly` **position**: `Vector3`

#### Inherited from

[SpriteText](SpriteText.md).[position](SpriteText.md#position)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:63

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

#### Inherited from

[SpriteText](SpriteText.md).[quaternion](SpriteText.md#quaternion)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:75

___

### receiveShadow

• **receiveShadow**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[receiveShadow](SpriteText.md#receiveshadow)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:139

___

### renderOrder

• **renderOrder**: `number`

#### Inherited from

[SpriteText](SpriteText.md).[renderOrder](SpriteText.md#renderorder)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:154

___

### rotation

• `Readonly` **rotation**: `Euler`

#### Inherited from

[SpriteText](SpriteText.md).[rotation](SpriteText.md#rotation)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:69

___

### scale

• `Readonly` **scale**: `Vector3`

#### Inherited from

[SpriteText](SpriteText.md).[scale](SpriteText.md#scale)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:81

___

### type

• **type**: ``"Sprite"``

#### Inherited from

[SpriteText](SpriteText.md).[type](SpriteText.md#type)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:11

___

### up

• **up**: `Vector3`

#### Inherited from

[SpriteText](SpriteText.md).[up](SpriteText.md#up)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:57

___

### userData

• **userData**: `Object`

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

[SpriteText](SpriteText.md).[userData](SpriteText.md#userdata)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:166

___

### uuid

• **uuid**: `string`

#### Inherited from

[SpriteText](SpriteText.md).[uuid](SpriteText.md#uuid)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:28

___

### visible

• **visible**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[visible](SpriteText.md#visible)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:127

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

[SpriteText](SpriteText.md).[DefaultMatrixAutoUpdate](SpriteText.md#defaultmatrixautoupdate)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:212

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

[SpriteText](SpriteText.md).[DefaultUp](SpriteText.md#defaultup)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:211

## Accessors

### backgroundColor

• `get` **backgroundColor**(): `string` \| ``false``

#### Returns

`string` \| ``false``

#### Inherited from

SpriteText.backgroundColor

#### Defined in

[client/src/libs/sprite-text.ts:48](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L48)

• `set` **backgroundColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| ``false`` |

#### Returns

`void`

#### Inherited from

SpriteText.backgroundColor

#### Defined in

[client/src/libs/sprite-text.ts:51](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L51)

___

### borderColor

• `get` **borderColor**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.borderColor

#### Defined in

[client/src/libs/sprite-text.ts:76](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L76)

• `set` **borderColor**(`borderColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderColor` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.borderColor

#### Defined in

[client/src/libs/sprite-text.ts:79](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L79)

___

### borderRadius

• `get` **borderRadius**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.borderRadius

#### Defined in

[client/src/libs/sprite-text.ts:69](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L69)

• `set` **borderRadius**(`borderRadius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderRadius` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.borderRadius

#### Defined in

[client/src/libs/sprite-text.ts:72](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L72)

___

### borderWidth

• `get` **borderWidth**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.borderWidth

#### Defined in

[client/src/libs/sprite-text.ts:62](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L62)

• `set` **borderWidth**(`borderWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderWidth` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.borderWidth

#### Defined in

[client/src/libs/sprite-text.ts:65](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L65)

___

### fontFace

• `get` **fontFace**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.fontFace

#### Defined in

[client/src/libs/sprite-text.ts:83](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L83)

• `set` **fontFace**(`fontFace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontFace` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.fontFace

#### Defined in

[client/src/libs/sprite-text.ts:86](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L86)

___

### fontSize

• `get` **fontSize**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.fontSize

#### Defined in

[client/src/libs/sprite-text.ts:90](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L90)

• `set` **fontSize**(`fontSize`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontSize` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.fontSize

#### Defined in

[client/src/libs/sprite-text.ts:93](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L93)

___

### fontWeight

• `get` **fontWeight**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.fontWeight

#### Defined in

[client/src/libs/sprite-text.ts:97](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L97)

• `set` **fontWeight**(`fontWeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontWeight` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.fontWeight

#### Defined in

[client/src/libs/sprite-text.ts:100](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L100)

___

### padding

• `get` **padding**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.padding

#### Defined in

[client/src/libs/sprite-text.ts:55](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L55)

• `set` **padding**(`padding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `padding` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.padding

#### Defined in

[client/src/libs/sprite-text.ts:58](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L58)

___

### strokeColor

• `get` **strokeColor**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.strokeColor

#### Defined in

[client/src/libs/sprite-text.ts:111](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L111)

• `set` **strokeColor**(`strokeColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeColor` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.strokeColor

#### Defined in

[client/src/libs/sprite-text.ts:114](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L114)

___

### strokeWidth

• `get` **strokeWidth**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.strokeWidth

#### Defined in

[client/src/libs/sprite-text.ts:104](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L104)

• `set` **strokeWidth**(`strokeWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeWidth` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.strokeWidth

#### Defined in

[client/src/libs/sprite-text.ts:107](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L107)

___

### text

• `get` **text**(): `string`

#### Returns

`string`

#### Inherited from

SpriteText.text

#### Defined in

[client/src/libs/sprite-text.ts:34](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L34)

• `set` **text**(`text`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`void`

#### Inherited from

SpriteText.text

#### Defined in

[client/src/libs/sprite-text.ts:37](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L37)

___

### textHeight

• `get` **textHeight**(): `number`

#### Returns

`number`

#### Inherited from

SpriteText.textHeight

#### Defined in

[client/src/libs/sprite-text.ts:41](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L41)

• `set` **textHeight**(`textHeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `textHeight` | `number` |

#### Returns

`void`

#### Inherited from

SpriteText.textHeight

#### Defined in

[client/src/libs/sprite-text.ts:44](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L44)

## Methods

### add

▸ **add**(...`object`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[add](SpriteText.md#add)

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> |  |

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[addEventListener](SpriteText.md#addeventlistener)

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

[SpriteText](SpriteText.md).[applyMatrix4](SpriteText.md#applymatrix4)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:217

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[applyQuaternion](SpriteText.md#applyquaternion)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:222

___

### attach

▸ **attach**(`object`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[attach](SpriteText.md#attach)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:352

___

### clear

▸ **clear**(): [`NameTag`](NameTag.md)

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[clear](SpriteText.md#clear)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:347

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

[SpriteText](SpriteText.md).[clone](SpriteText.md#clone)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:400

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

[SpriteText](SpriteText.md).[copy](SpriteText.md#copy)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:19

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

[SpriteText](SpriteText.md).[dispatchEvent](SpriteText.md#dispatchevent)

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

[SpriteText](SpriteText.md).[getObjectById](SpriteText.md#getobjectbyid)

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

[SpriteText](SpriteText.md).[getObjectByName](SpriteText.md#getobjectbyname)

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

[SpriteText](SpriteText.md).[getObjectByProperty](SpriteText.md#getobjectbyproperty)

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

[SpriteText](SpriteText.md).[getWorldDirection](SpriteText.md#getworlddirection)

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

[SpriteText](SpriteText.md).[getWorldPosition](SpriteText.md#getworldposition)

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

[SpriteText](SpriteText.md).[getWorldQuaternion](SpriteText.md#getworldquaternion)

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

[SpriteText](SpriteText.md).[getWorldScale](SpriteText.md#getworldscale)

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> |  |

#### Returns

`boolean`

#### Inherited from

[SpriteText](SpriteText.md).[hasEventListener](SpriteText.md#haseventlistener)

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

[SpriteText](SpriteText.md).[localToWorld](SpriteText.md#localtoworld)

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

[SpriteText](SpriteText.md).[lookAt](SpriteText.md#lookat)

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

[SpriteText](SpriteText.md).[raycast](SpriteText.md#raycast)

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:18

___

### remove

▸ **remove**(...`object`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[remove](SpriteText.md#remove)

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
| `listener` | `EventListener`<`Event`, `T`, [`NameTag`](NameTag.md)\> |  |

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[removeEventListener](SpriteText.md#removeeventlistener)

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:44

___

### removeFromParent

▸ **removeFromParent**(): [`NameTag`](NameTag.md)

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[removeFromParent](SpriteText.md#removefromparent)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:342

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateOnAxis](SpriteText.md#rotateonaxis)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:257

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateOnWorldAxis](SpriteText.md#rotateonworldaxis)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:264

___

### rotateX

▸ **rotateX**(`angle`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateX](SpriteText.md#rotatex)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:270

___

### rotateY

▸ **rotateY**(`angle`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateY](SpriteText.md#rotatey)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:276

___

### rotateZ

▸ **rotateZ**(`angle`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[rotateZ](SpriteText.md#rotatez)

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

[SpriteText](SpriteText.md).[setRotationFromAxisAngle](SpriteText.md#setrotationfromaxisangle)

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

[SpriteText](SpriteText.md).[setRotationFromEuler](SpriteText.md#setrotationfromeuler)

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

[SpriteText](SpriteText.md).[setRotationFromMatrix](SpriteText.md#setrotationfrommatrix)

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

[SpriteText](SpriteText.md).[setRotationFromQuaternion](SpriteText.md#setrotationfromquaternion)

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

[SpriteText](SpriteText.md).[toJSON](SpriteText.md#tojson)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:398

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `distance` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateOnAxis](SpriteText.md#translateonaxis)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:289

___

### translateX

▸ **translateX**(`distance`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateX](SpriteText.md#translatex)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:295

___

### translateY

▸ **translateY**(`distance`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateY](SpriteText.md#translatey)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:301

___

### translateZ

▸ **translateZ**(`distance`): [`NameTag`](NameTag.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`NameTag`](NameTag.md)

#### Inherited from

[SpriteText](SpriteText.md).[translateZ](SpriteText.md#translatez)

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

[SpriteText](SpriteText.md).[traverse](SpriteText.md#traverse)

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

[SpriteText](SpriteText.md).[traverseAncestors](SpriteText.md#traverseancestors)

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

[SpriteText](SpriteText.md).[traverseVisible](SpriteText.md#traversevisible)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:377

___

### updateMatrix

▸ **updateMatrix**(): `void`

#### Returns

`void`

#### Inherited from

[SpriteText](SpriteText.md).[updateMatrix](SpriteText.md#updatematrix)

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

[SpriteText](SpriteText.md).[updateMatrixWorld](SpriteText.md#updatematrixworld)

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

[SpriteText](SpriteText.md).[updateWorldMatrix](SpriteText.md#updateworldmatrix)

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

[SpriteText](SpriteText.md).[worldToLocal](SpriteText.md#worldtolocal)

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:319
