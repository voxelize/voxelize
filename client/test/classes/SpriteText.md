[@voxelize/client](../README.md) / [Exports](../modules.md) / SpriteText

# Class: SpriteText

## Hierarchy

- `Sprite`

  ↳ **`SpriteText`**

  ↳↳ [`NameTag`](NameTag.md)

## Table of contents

### Constructors

- [constructor](SpriteText.md#constructor)

### Properties

- [\_backgroundColor](SpriteText.md#_backgroundcolor)
- [\_borderColor](SpriteText.md#_bordercolor)
- [\_borderRadius](SpriteText.md#_borderradius)
- [\_borderWidth](SpriteText.md#_borderwidth)
- [\_canvas](SpriteText.md#_canvas)
- [\_fontFace](SpriteText.md#_fontface)
- [\_fontSize](SpriteText.md#_fontsize)
- [\_fontWeight](SpriteText.md#_fontweight)
- [\_padding](SpriteText.md#_padding)
- [\_strokeColor](SpriteText.md#_strokecolor)
- [\_strokeWidth](SpriteText.md#_strokewidth)
- [\_text](SpriteText.md#_text)
- [\_textHeight](SpriteText.md#_textheight)
- [animations](SpriteText.md#animations)
- [castShadow](SpriteText.md#castshadow)
- [center](SpriteText.md#center)
- [children](SpriteText.md#children)
- [customDepthMaterial](SpriteText.md#customdepthmaterial)
- [customDistanceMaterial](SpriteText.md#customdistancematerial)
- [frustumCulled](SpriteText.md#frustumculled)
- [geometry](SpriteText.md#geometry)
- [id](SpriteText.md#id)
- [isObject3D](SpriteText.md#isobject3d)
- [isSprite](SpriteText.md#issprite)
- [layers](SpriteText.md#layers)
- [material](SpriteText.md#material)
- [matrix](SpriteText.md#matrix)
- [matrixAutoUpdate](SpriteText.md#matrixautoupdate)
- [matrixWorld](SpriteText.md#matrixworld)
- [matrixWorldNeedsUpdate](SpriteText.md#matrixworldneedsupdate)
- [modelViewMatrix](SpriteText.md#modelviewmatrix)
- [name](SpriteText.md#name)
- [normalMatrix](SpriteText.md#normalmatrix)
- [onAfterRender](SpriteText.md#onafterrender)
- [onBeforeRender](SpriteText.md#onbeforerender)
- [parent](SpriteText.md#parent)
- [position](SpriteText.md#position)
- [quaternion](SpriteText.md#quaternion)
- [receiveShadow](SpriteText.md#receiveshadow)
- [renderOrder](SpriteText.md#renderorder)
- [rotation](SpriteText.md#rotation)
- [scale](SpriteText.md#scale)
- [type](SpriteText.md#type)
- [up](SpriteText.md#up)
- [userData](SpriteText.md#userdata)
- [uuid](SpriteText.md#uuid)
- [visible](SpriteText.md#visible)
- [DefaultMatrixAutoUpdate](SpriteText.md#defaultmatrixautoupdate)
- [DefaultUp](SpriteText.md#defaultup)

### Accessors

- [backgroundColor](SpriteText.md#backgroundcolor)
- [borderColor](SpriteText.md#bordercolor)
- [borderRadius](SpriteText.md#borderradius)
- [borderWidth](SpriteText.md#borderwidth)
- [fontFace](SpriteText.md#fontface)
- [fontSize](SpriteText.md#fontsize)
- [fontWeight](SpriteText.md#fontweight)
- [padding](SpriteText.md#padding)
- [strokeColor](SpriteText.md#strokecolor)
- [strokeWidth](SpriteText.md#strokewidth)
- [text](SpriteText.md#text)
- [textHeight](SpriteText.md#textheight)

### Methods

- [add](SpriteText.md#add)
- [addEventListener](SpriteText.md#addeventlistener)
- [applyMatrix4](SpriteText.md#applymatrix4)
- [applyQuaternion](SpriteText.md#applyquaternion)
- [attach](SpriteText.md#attach)
- [clear](SpriteText.md#clear)
- [clone](SpriteText.md#clone)
- [copy](SpriteText.md#copy)
- [dispatchEvent](SpriteText.md#dispatchevent)
- [generate](SpriteText.md#generate)
- [getObjectById](SpriteText.md#getobjectbyid)
- [getObjectByName](SpriteText.md#getobjectbyname)
- [getObjectByProperty](SpriteText.md#getobjectbyproperty)
- [getWorldDirection](SpriteText.md#getworlddirection)
- [getWorldPosition](SpriteText.md#getworldposition)
- [getWorldQuaternion](SpriteText.md#getworldquaternion)
- [getWorldScale](SpriteText.md#getworldscale)
- [hasEventListener](SpriteText.md#haseventlistener)
- [localToWorld](SpriteText.md#localtoworld)
- [lookAt](SpriteText.md#lookat)
- [raycast](SpriteText.md#raycast)
- [remove](SpriteText.md#remove)
- [removeEventListener](SpriteText.md#removeeventlistener)
- [removeFromParent](SpriteText.md#removefromparent)
- [rotateOnAxis](SpriteText.md#rotateonaxis)
- [rotateOnWorldAxis](SpriteText.md#rotateonworldaxis)
- [rotateX](SpriteText.md#rotatex)
- [rotateY](SpriteText.md#rotatey)
- [rotateZ](SpriteText.md#rotatez)
- [setRotationFromAxisAngle](SpriteText.md#setrotationfromaxisangle)
- [setRotationFromEuler](SpriteText.md#setrotationfromeuler)
- [setRotationFromMatrix](SpriteText.md#setrotationfrommatrix)
- [setRotationFromQuaternion](SpriteText.md#setrotationfromquaternion)
- [toJSON](SpriteText.md#tojson)
- [translateOnAxis](SpriteText.md#translateonaxis)
- [translateX](SpriteText.md#translatex)
- [translateY](SpriteText.md#translatey)
- [translateZ](SpriteText.md#translatez)
- [traverse](SpriteText.md#traverse)
- [traverseAncestors](SpriteText.md#traverseancestors)
- [traverseVisible](SpriteText.md#traversevisible)
- [updateMatrix](SpriteText.md#updatematrix)
- [updateMatrixWorld](SpriteText.md#updatematrixworld)
- [updateWorldMatrix](SpriteText.md#updateworldmatrix)
- [worldToLocal](SpriteText.md#worldtolocal)

## Constructors

### constructor

• **new SpriteText**(`text?`, `textHeight?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `text` | `string` | `""` |
| `textHeight` | `number` | `10` |

#### Overrides

Sprite.constructor

#### Defined in

[client/src/libs/sprite-text.ts:24](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L24)

## Properties

### \_backgroundColor

• `Private` **\_backgroundColor**: `string` \| ``false``

#### Defined in

[client/src/libs/sprite-text.ts:8](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L8)

___

### \_borderColor

• `Private` **\_borderColor**: `string` = `"white"`

#### Defined in

[client/src/libs/sprite-text.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L13)

___

### \_borderRadius

• `Private` **\_borderRadius**: `number` = `0`

#### Defined in

[client/src/libs/sprite-text.ts:12](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L12)

___

### \_borderWidth

• `Private` **\_borderWidth**: `number` = `0`

#### Defined in

[client/src/libs/sprite-text.ts:11](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L11)

___

### \_canvas

• `Private` **\_canvas**: `HTMLCanvasElement`

#### Defined in

[client/src/libs/sprite-text.ts:22](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L22)

___

### \_fontFace

• `Private` **\_fontFace**: `string` = `"Arial"`

#### Defined in

[client/src/libs/sprite-text.ts:18](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L18)

___

### \_fontSize

• `Private` **\_fontSize**: `number` = `90`

#### Defined in

[client/src/libs/sprite-text.ts:19](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L19)

___

### \_fontWeight

• `Private` **\_fontWeight**: `string` = `"normal"`

#### Defined in

[client/src/libs/sprite-text.ts:20](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L20)

___

### \_padding

• `Private` **\_padding**: `number` = `0`

#### Defined in

[client/src/libs/sprite-text.ts:10](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L10)

___

### \_strokeColor

• `Private` **\_strokeColor**: `string` = `"white"`

#### Defined in

[client/src/libs/sprite-text.ts:16](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L16)

___

### \_strokeWidth

• `Private` **\_strokeWidth**: `number` = `0`

#### Defined in

[client/src/libs/sprite-text.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L15)

___

### \_text

• `Private` **\_text**: `string`

#### Defined in

[client/src/libs/sprite-text.ts:6](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L6)

___

### \_textHeight

• `Private` **\_textHeight**: `number`

#### Defined in

[client/src/libs/sprite-text.ts:7](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L7)

___

### animations

• **animations**: `AnimationClip`[]

#### Inherited from

Sprite.animations

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:160

___

### castShadow

• **castShadow**: `boolean`

#### Inherited from

Sprite.castShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:133

___

### center

• **center**: `Vector2`

#### Inherited from

Sprite.center

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:16

___

### children

• **children**: `Object3D`<`Event`\>[]

#### Inherited from

Sprite.children

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:51

___

### customDepthMaterial

• **customDepthMaterial**: `Material`

#### Inherited from

Sprite.customDepthMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:174

___

### customDistanceMaterial

• **customDistanceMaterial**: `Material`

#### Inherited from

Sprite.customDistanceMaterial

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:179

___

### frustumCulled

• **frustumCulled**: `boolean`

#### Inherited from

Sprite.frustumCulled

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:146

___

### geometry

• **geometry**: `BufferGeometry`

#### Inherited from

Sprite.geometry

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:14

___

### id

• **id**: `number`

#### Inherited from

Sprite.id

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:26

___

### isObject3D

• `Readonly` **isObject3D**: ``true``

#### Inherited from

Sprite.isObject3D

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:185

___

### isSprite

• `Readonly` **isSprite**: ``true``

#### Inherited from

Sprite.isSprite

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:12

___

### layers

• **layers**: `Layers`

#### Inherited from

Sprite.layers

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:121

___

### material

• **material**: `SpriteMaterial`

#### Inherited from

Sprite.material

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:15

___

### matrix

• **matrix**: `Matrix4`

#### Inherited from

Sprite.matrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:97

___

### matrixAutoUpdate

• **matrixAutoUpdate**: `boolean`

#### Inherited from

Sprite.matrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:110

___

### matrixWorld

• **matrixWorld**: `Matrix4`

#### Inherited from

Sprite.matrixWorld

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:103

___

### matrixWorldNeedsUpdate

• **matrixWorldNeedsUpdate**: `boolean`

#### Inherited from

Sprite.matrixWorldNeedsUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:116

___

### modelViewMatrix

• `Readonly` **modelViewMatrix**: `Matrix4`

#### Inherited from

Sprite.modelViewMatrix

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:86

___

### name

• **name**: `string`

#### Inherited from

Sprite.name

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:34

___

### normalMatrix

• `Readonly` **normalMatrix**: `Matrix3`

#### Inherited from

Sprite.normalMatrix

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

Sprite.onAfterRender

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

Sprite.onBeforeRender

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:190

___

### parent

• **parent**: `Object3D`<`Event`\>

#### Inherited from

Sprite.parent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:45

___

### position

• `Readonly` **position**: `Vector3`

#### Inherited from

Sprite.position

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:63

___

### quaternion

• `Readonly` **quaternion**: `Quaternion`

#### Inherited from

Sprite.quaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:75

___

### receiveShadow

• **receiveShadow**: `boolean`

#### Inherited from

Sprite.receiveShadow

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:139

___

### renderOrder

• **renderOrder**: `number`

#### Inherited from

Sprite.renderOrder

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:154

___

### rotation

• `Readonly` **rotation**: `Euler`

#### Inherited from

Sprite.rotation

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:69

___

### scale

• `Readonly` **scale**: `Vector3`

#### Inherited from

Sprite.scale

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:81

___

### type

• **type**: ``"Sprite"``

#### Inherited from

Sprite.type

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:11

___

### up

• **up**: `Vector3`

#### Inherited from

Sprite.up

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:57

___

### userData

• **userData**: `Object`

#### Index signature

▪ [key: `string`]: `any`

#### Inherited from

Sprite.userData

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:166

___

### uuid

• **uuid**: `string`

#### Inherited from

Sprite.uuid

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:28

___

### visible

• **visible**: `boolean`

#### Inherited from

Sprite.visible

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:127

___

### DefaultMatrixAutoUpdate

▪ `Static` **DefaultMatrixAutoUpdate**: `boolean`

#### Inherited from

Sprite.DefaultMatrixAutoUpdate

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:212

___

### DefaultUp

▪ `Static` **DefaultUp**: `Vector3`

#### Inherited from

Sprite.DefaultUp

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:211

## Accessors

### backgroundColor

• `get` **backgroundColor**(): `string` \| ``false``

#### Returns

`string` \| ``false``

#### Defined in

[client/src/libs/sprite-text.ts:48](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L48)

• `set` **backgroundColor**(`color`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| ``false`` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:51](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L51)

___

### borderColor

• `get` **borderColor**(): `string`

#### Returns

`string`

#### Defined in

[client/src/libs/sprite-text.ts:76](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L76)

• `set` **borderColor**(`borderColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderColor` | `string` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:79](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L79)

___

### borderRadius

• `get` **borderRadius**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:69](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L69)

• `set` **borderRadius**(`borderRadius`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderRadius` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:72](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L72)

___

### borderWidth

• `get` **borderWidth**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:62](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L62)

• `set` **borderWidth**(`borderWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderWidth` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:65](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L65)

___

### fontFace

• `get` **fontFace**(): `string`

#### Returns

`string`

#### Defined in

[client/src/libs/sprite-text.ts:83](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L83)

• `set` **fontFace**(`fontFace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontFace` | `string` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:86](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L86)

___

### fontSize

• `get` **fontSize**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:90](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L90)

• `set` **fontSize**(`fontSize`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontSize` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:93](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L93)

___

### fontWeight

• `get` **fontWeight**(): `string`

#### Returns

`string`

#### Defined in

[client/src/libs/sprite-text.ts:97](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L97)

• `set` **fontWeight**(`fontWeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontWeight` | `string` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:100](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L100)

___

### padding

• `get` **padding**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:55](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L55)

• `set` **padding**(`padding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `padding` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:58](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L58)

___

### strokeColor

• `get` **strokeColor**(): `string`

#### Returns

`string`

#### Defined in

[client/src/libs/sprite-text.ts:111](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L111)

• `set` **strokeColor**(`strokeColor`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeColor` | `string` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:114](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L114)

___

### strokeWidth

• `get` **strokeWidth**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:104](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L104)

• `set` **strokeWidth**(`strokeWidth`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeWidth` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:107](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L107)

___

### text

• `get` **text**(): `string`

#### Returns

`string`

#### Defined in

[client/src/libs/sprite-text.ts:34](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L34)

• `set` **text**(`text`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:37](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L37)

___

### textHeight

• `get` **textHeight**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/sprite-text.ts:41](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L41)

• `set` **textHeight**(`textHeight`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `textHeight` | `number` |

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:44](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L44)

## Methods

### add

▸ **add**(...`object`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.add

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
| `listener` | `EventListener`<`Event`, `T`, [`SpriteText`](SpriteText.md)\> |  |

#### Returns

`void`

#### Inherited from

Sprite.addEventListener

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

Sprite.applyMatrix4

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:217

___

### applyQuaternion

▸ **applyQuaternion**(`quaternion`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `quaternion` | `Quaternion` |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.applyQuaternion

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:222

___

### attach

▸ **attach**(`object`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.attach

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:352

___

### clear

▸ **clear**(): [`SpriteText`](SpriteText.md)

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.clear

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:347

___

### clone

▸ **clone**(`recursive?`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `recursive?` | `boolean` |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.clone

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:400

___

### copy

▸ **copy**(`source`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `source` | [`SpriteText`](SpriteText.md) |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.copy

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

Sprite.dispatchEvent

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:50

___

### generate

▸ `Private` **generate**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/sprite-text.ts:119](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/sprite-text.ts#L119)

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

Sprite.getObjectById

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

Sprite.getObjectByName

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

Sprite.getObjectByProperty

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

Sprite.getWorldDirection

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

Sprite.getWorldPosition

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

Sprite.getWorldQuaternion

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

Sprite.getWorldScale

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
| `listener` | `EventListener`<`Event`, `T`, [`SpriteText`](SpriteText.md)\> |  |

#### Returns

`boolean`

#### Inherited from

Sprite.hasEventListener

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

Sprite.localToWorld

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

Sprite.lookAt

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

Sprite.raycast

#### Defined in

node_modules/@types/three/src/objects/Sprite.d.ts:18

___

### remove

▸ **remove**(...`object`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `...object` | `Object3D`<`Event`\>[] |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.remove

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
| `listener` | `EventListener`<`Event`, `T`, [`SpriteText`](SpriteText.md)\> |  |

#### Returns

`void`

#### Inherited from

Sprite.removeEventListener

#### Defined in

node_modules/@types/three/src/core/EventDispatcher.d.ts:44

___

### removeFromParent

▸ **removeFromParent**(): [`SpriteText`](SpriteText.md)

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.removeFromParent

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:342

___

### rotateOnAxis

▸ **rotateOnAxis**(`axis`, `angle`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.rotateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:257

___

### rotateOnWorldAxis

▸ **rotateOnWorldAxis**(`axis`, `angle`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `angle` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.rotateOnWorldAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:264

___

### rotateX

▸ **rotateX**(`angle`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.rotateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:270

___

### rotateY

▸ **rotateY**(`angle`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.rotateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:276

___

### rotateZ

▸ **rotateZ**(`angle`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `angle` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.rotateZ

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

Sprite.setRotationFromAxisAngle

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

Sprite.setRotationFromEuler

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

Sprite.setRotationFromMatrix

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

Sprite.setRotationFromQuaternion

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

Sprite.toJSON

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:398

___

### translateOnAxis

▸ **translateOnAxis**(`axis`, `distance`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `axis` | `Vector3` |  |
| `distance` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.translateOnAxis

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:289

___

### translateX

▸ **translateX**(`distance`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.translateX

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:295

___

### translateY

▸ **translateY**(`distance`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.translateY

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:301

___

### translateZ

▸ **translateZ**(`distance`): [`SpriteText`](SpriteText.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `distance` | `number` |  |

#### Returns

[`SpriteText`](SpriteText.md)

#### Inherited from

Sprite.translateZ

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

Sprite.traverse

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

Sprite.traverseAncestors

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

Sprite.traverseVisible

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:377

___

### updateMatrix

▸ **updateMatrix**(): `void`

#### Returns

`void`

#### Inherited from

Sprite.updateMatrix

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

Sprite.updateMatrixWorld

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

Sprite.updateWorldMatrix

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

Sprite.worldToLocal

#### Defined in

node_modules/@types/three/src/core/Object3D.d.ts:319
