[@voxelize/client](../README.md) / [Exports](../modules.md) / RigidControls

# Class: RigidControls

## Hierarchy

- `EventEmitter`

  ↳ **`RigidControls`**

## Table of contents

### Properties

- [body](RigidControls.md#body)
- [camera](RigidControls.md#camera)
- [domElement](RigidControls.md#domelement)
- [euler](RigidControls.md#euler)
- [isLocked](RigidControls.md#islocked)
- [lockCallback](RigidControls.md#lockcallback)
- [lookBlock](RigidControls.md#lookblock)
- [lookBlockMesh](RigidControls.md#lookblockmesh)
- [movements](RigidControls.md#movements)
- [newLookBlockPosition](RigidControls.md#newlookblockposition)
- [newLookBlockScale](RigidControls.md#newlookblockscale)
- [newPosition](RigidControls.md#newposition)
- [object](RigidControls.md#object)
- [params](RigidControls.md#params)
- [quaternion](RigidControls.md#quaternion)
- [state](RigidControls.md#state)
- [targetBlock](RigidControls.md#targetblock)
- [unlockCallback](RigidControls.md#unlockcallback)
- [vector](RigidControls.md#vector)
- [world](RigidControls.md#world)
- [defaultMaxListeners](RigidControls.md#defaultmaxlisteners)

### Accessors

- [chunk](RigidControls.md#chunk)
- [ghostMode](RigidControls.md#ghostmode)
- [lookingAt](RigidControls.md#lookingat)
- [voxel](RigidControls.md#voxel)

### Methods

- [addListener](RigidControls.md#addlistener)
- [emit](RigidControls.md#emit)
- [eventNames](RigidControls.md#eventnames)
- [getDirection](RigidControls.md#getdirection)
- [getMaxListeners](RigidControls.md#getmaxlisteners)
- [listenerCount](RigidControls.md#listenercount)
- [listeners](RigidControls.md#listeners)
- [lock](RigidControls.md#lock)
- [lookAt](RigidControls.md#lookat)
- [moveRigidBody](RigidControls.md#moverigidbody)
- [off](RigidControls.md#off)
- [on](RigidControls.md#on)
- [onDocumentClick](RigidControls.md#ondocumentclick)
- [onKeyDown](RigidControls.md#onkeydown)
- [onKeyUp](RigidControls.md#onkeyup)
- [onLock](RigidControls.md#onlock)
- [onMouseMove](RigidControls.md#onmousemove)
- [onPointerlockChange](RigidControls.md#onpointerlockchange)
- [onPointerlockError](RigidControls.md#onpointerlockerror)
- [onUnlock](RigidControls.md#onunlock)
- [once](RigidControls.md#once)
- [prependListener](RigidControls.md#prependlistener)
- [prependOnceListener](RigidControls.md#prependoncelistener)
- [rawListeners](RigidControls.md#rawlisteners)
- [removeAllListeners](RigidControls.md#removealllisteners)
- [removeListener](RigidControls.md#removelistener)
- [resetMovements](RigidControls.md#resetmovements)
- [setMaxListeners](RigidControls.md#setmaxlisteners)
- [setPosition](RigidControls.md#setposition)
- [setupLookBlock](RigidControls.md#setuplookblock)
- [toggleGhostMode](RigidControls.md#toggleghostmode)
- [unlock](RigidControls.md#unlock)
- [updateLookBlock](RigidControls.md#updatelookblock)
- [updateRigidBody](RigidControls.md#updaterigidbody)
- [listenerCount](RigidControls.md#listenercount-1)

## Properties

### body

• **body**: `RigidBody`

#### Defined in

[client/src/core/controls.ts:374](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L374)

___

### camera

• **camera**: `PerspectiveCamera`

#### Defined in

[client/src/core/controls.ts:339](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L339)

___

### domElement

• **domElement**: `HTMLElement`

#### Defined in

[client/src/core/controls.ts:341](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L341)

___

### euler

• `Private` **euler**: `Euler`

#### Defined in

[client/src/core/controls.ts:420](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L420)

___

### isLocked

• **isLocked**: `boolean` = `false`

#### Defined in

[client/src/core/controls.ts:366](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L366)

___

### lockCallback

• `Private` **lockCallback**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Defined in

[client/src/core/controls.ts:417](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L417)

___

### lookBlock

• **lookBlock**: [`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/core/controls.ts:379](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L379)

___

### lookBlockMesh

• `Private` **lookBlockMesh**: `Group`

#### Defined in

[client/src/core/controls.ts:405](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L405)

___

### movements

• `Private` **movements**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `back` | `boolean` |
| `down` | `boolean` |
| `front` | `boolean` |
| `left` | `boolean` |
| `right` | `boolean` |
| `sprint` | `boolean` |
| `up` | `boolean` |

#### Defined in

[client/src/core/controls.ts:407](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L407)

___

### newLookBlockPosition

• `Private` **newLookBlockPosition**: `Vector3`

#### Defined in

[client/src/core/controls.ts:427](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L427)

___

### newLookBlockScale

• `Private` **newLookBlockScale**: `Vector3`

#### Defined in

[client/src/core/controls.ts:426](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L426)

___

### newPosition

• `Private` **newPosition**: `Vector3`

#### Defined in

[client/src/core/controls.ts:424](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L424)

___

### object

• **object**: `Group`

#### Defined in

[client/src/core/controls.ts:356](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L356)

___

### params

• **params**: [`RigidControlsParams`](../modules.md#rigidcontrolsparams)

#### Defined in

[client/src/core/controls.ts:351](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L351)

___

### quaternion

• `Private` **quaternion**: `Quaternion`

#### Defined in

[client/src/core/controls.ts:421](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L421)

___

### state

• **state**: [`RigidControlState`](../modules.md#rigidcontrolstate)

#### Defined in

[client/src/core/controls.ts:361](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L361)

___

### targetBlock

• **targetBlock**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `rotation` | `number` |  |
| `voxel` | [`Coords3`](../modules.md#coords3) |  |
| `yRotation` | `number` |  |

#### Defined in

[client/src/core/controls.ts:384](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L384)

___

### unlockCallback

• `Private` **unlockCallback**: () => `void`

#### Type declaration

▸ (): `void`

##### Returns

`void`

#### Defined in

[client/src/core/controls.ts:418](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L418)

___

### vector

• `Private` **vector**: `Vector3`

#### Defined in

[client/src/core/controls.ts:422](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L422)

___

### world

• **world**: [`World`](World.md)

#### Defined in

[client/src/core/controls.ts:346](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L346)

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

#### Defined in

node_modules/@types/events/index.d.ts:11

## Accessors

### chunk

• `get` **chunk**(): [`Coords2`](../modules.md#coords2)

#### Returns

[`Coords2`](../modules.md#coords2)

#### Defined in

[client/src/core/controls.ts:771](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L771)

___

### ghostMode

• `get` **ghostMode**(): `boolean`

#### Returns

`boolean`

#### Defined in

[client/src/core/controls.ts:757](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L757)

___

### lookingAt

• `get` **lookingAt**(): [`Block`](../modules.md#block)

#### Returns

[`Block`](../modules.md#block)

#### Defined in

[client/src/core/controls.ts:781](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L781)

___

### voxel

• `get` **voxel**(): [`Coords3`](../modules.md#coords3)

#### Returns

[`Coords3`](../modules.md#coords3)

#### Defined in

[client/src/core/controls.ts:764](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L764)

## Methods

### addListener

▸ **addListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:17

___

### emit

▸ **emit**(`type`, ...`args`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `...args` | `any`[] |

#### Returns

`boolean`

#### Defined in

node_modules/@types/events/index.d.ts:16

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

#### Defined in

node_modules/@types/events/index.d.ts:13

___

### getDirection

▸ **getDirection**(): `Vector3`

#### Returns

`Vector3`

#### Defined in

[client/src/core/controls.ts:591](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L591)

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

#### Defined in

node_modules/@types/events/index.d.ts:15

___

### listenerCount

▸ **listenerCount**(`type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`number`

#### Defined in

node_modules/@types/events/index.d.ts:26

___

### listeners

▸ **listeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Defined in

node_modules/@types/events/index.d.ts:25

___

### lock

▸ **lock**(`callback?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` |  |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:603](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L603)

___

### lookAt

▸ **lookAt**(`x`, `y`, `z`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:648](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L648)

___

### moveRigidBody

▸ `Private` **moveRigidBody**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:991](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L991)

___

### off

▸ **off**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:23

___

### on

▸ **on**(`event`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"lock"`` |
| `listener` | () => `void` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

[client/src/core/controls.ts:318](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L318)

▸ **on**(`event`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"unlock"`` |
| `listener` | () => `void` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

[client/src/core/controls.ts:319](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L319)

___

### onDocumentClick

▸ `Private` **onDocumentClick**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1343](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1343)

___

### onKeyDown

▸ `Private` **onKeyDown**(`__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `KeyboardEvent` |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1226](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1226)

___

### onKeyUp

▸ `Private` **onKeyUp**(`__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `KeyboardEvent` |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1264](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1264)

___

### onLock

▸ `Private` **onLock**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1348](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1348)

___

### onMouseMove

▸ `Private` **onMouseMove**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `MouseEvent` |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1298](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1298)

___

### onPointerlockChange

▸ `Private` **onPointerlockChange**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1317](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1317)

___

### onPointerlockError

▸ `Private` **onPointerlockError**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1339](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1339)

___

### onUnlock

▸ `Private` **onUnlock**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1352](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1352)

___

### once

▸ **once**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:19

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:20

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:21

___

### rawListeners

▸ **rawListeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Defined in

node_modules/@types/events/index.d.ts:27

___

### removeAllListeners

▸ **removeAllListeners**(`type?`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:24

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:22

___

### resetMovements

▸ **resetMovements**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:658](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L658)

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`RigidControls`](RigidControls.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`RigidControls`](RigidControls.md)

#### Defined in

node_modules/@types/events/index.d.ts:14

___

### setPosition

▸ **setPosition**(`x`, `y`, `z`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `x` | `number` |  |
| `y` | `number` |  |
| `z` | `number` |  |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:632](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L632)

___

### setupLookBlock

▸ `Private` **setupLookBlock**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:793](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L793)

___

### toggleGhostMode

▸ **toggleGhostMode**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:673](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L673)

___

### unlock

▸ **unlock**(`callback?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `callback?` | () => `void` |  |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:617](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L617)

___

### updateLookBlock

▸ `Private` **updateLookBlock**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:855](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L855)

___

### updateRigidBody

▸ `Private` **updateRigidBody**(`dt`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `dt` | `number` |

#### Returns

`void`

#### Defined in

[client/src/core/controls.ts:1053](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/controls.ts#L1053)

___

### listenerCount

▸ `Static` **listenerCount**(`emitter`, `type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` |
| `type` | `string` \| `number` |

#### Returns

`number`

#### Defined in

node_modules/@types/events/index.d.ts:10
