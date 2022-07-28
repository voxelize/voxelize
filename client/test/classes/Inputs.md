[@voxelize/client](../README.md) / [Exports](../modules.md) / Inputs

# Class: Inputs<T\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `string` |

## Hierarchy

- `EventEmitter`

  ↳ **`Inputs`**

## Table of contents

### Properties

- [clickCallbacks](Inputs.md#clickcallbacks)
- [combos](Inputs.md#combos)
- [mouseUnbinds](Inputs.md#mouseunbinds)
- [namespace](Inputs.md#namespace)
- [scrollCallbacks](Inputs.md#scrollcallbacks)
- [unbinds](Inputs.md#unbinds)
- [defaultMaxListeners](Inputs.md#defaultmaxlisteners)

### Methods

- [add](Inputs.md#add)
- [addListener](Inputs.md#addlistener)
- [bind](Inputs.md#bind)
- [click](Inputs.md#click)
- [emit](Inputs.md#emit)
- [eventNames](Inputs.md#eventnames)
- [getMaxListeners](Inputs.md#getmaxlisteners)
- [initClickListener](Inputs.md#initclicklistener)
- [initScrollListener](Inputs.md#initscrolllistener)
- [listenerCount](Inputs.md#listenercount)
- [listeners](Inputs.md#listeners)
- [off](Inputs.md#off)
- [on](Inputs.md#on)
- [once](Inputs.md#once)
- [prependListener](Inputs.md#prependlistener)
- [prependOnceListener](Inputs.md#prependoncelistener)
- [rawListeners](Inputs.md#rawlisteners)
- [removeAllListeners](Inputs.md#removealllisteners)
- [removeListener](Inputs.md#removelistener)
- [reset](Inputs.md#reset)
- [scroll](Inputs.md#scroll)
- [setMaxListeners](Inputs.md#setmaxlisteners)
- [setNamespace](Inputs.md#setnamespace)
- [listenerCount](Inputs.md#listenercount-1)

## Properties

### clickCallbacks

• `Private` **clickCallbacks**: `Map`<[`ClickType`](../modules.md#clicktype), `ClickCallbacks`\>

#### Defined in

[client/src/core/inputs.ts:52](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L52)

___

### combos

• `Private` **combos**: `Map`<`string`, `string`\>

#### Defined in

[client/src/core/inputs.ts:51](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L51)

___

### mouseUnbinds

• `Private` **mouseUnbinds**: () => `void`[] = `[]`

#### Defined in

[client/src/core/inputs.ts:56](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L56)

___

### namespace

• **namespace**: `T`

#### Defined in

[client/src/core/inputs.ts:49](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L49)

___

### scrollCallbacks

• `Private` **scrollCallbacks**: `ScrollCallbacks` = `[]`

#### Defined in

[client/src/core/inputs.ts:53](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L53)

___

### unbinds

• `Private` **unbinds**: `Map`<`string`, () => `void`\>

#### Defined in

[client/src/core/inputs.ts:55](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L55)

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

#### Defined in

node_modules/@types/events/index.d.ts:11

## Methods

### add

▸ `Private` **add**(`name`, `combo`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `combo` | `string` |

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:220](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L220)

___

### addListener

▸ **addListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:17

___

### bind

▸ **bind**(`name`, `callback`, `namespace`, `specifics?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` |  |
| `callback` | () => `void` |  |
| `namespace` | `T` |  |
| `specifics` | `Object` |  |
| `specifics.element?` | `HTMLElement` |  |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion) |  |

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:118](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L118)

___

### click

▸ **click**(`type`, `callback`, `namespace`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | [`ClickType`](../modules.md#clicktype) |  |
| `callback` | () => `void` |  |
| `namespace` | `T` |  |

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:89](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L89)

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

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

#### Defined in

node_modules/@types/events/index.d.ts:15

___

### initClickListener

▸ `Private` **initClickListener**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:179](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L179)

___

### initScrollListener

▸ `Private` **initScrollListener**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:204](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L204)

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

### off

▸ **off**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:23

___

### on

▸ **on**(`event`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"namespace"`` |
| `listener` | (`namespace`: `string`) => `void` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

[client/src/core/inputs.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L23)

___

### once

▸ **once**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:19

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:20

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

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

▸ **removeAllListeners**(`type?`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:24

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:22

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:174](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L174)

___

### scroll

▸ **scroll**(`up`, `down`, `namespace`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `up` | (`delta?`: `number`) => `void` |  |
| `down` | (`delta?`: `number`) => `void` |  |
| `namespace` | `T` |  |

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:100](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L100)

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`Inputs`](Inputs.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`Inputs`](Inputs.md)<`T`\>

#### Defined in

node_modules/@types/events/index.d.ts:14

___

### setNamespace

▸ **setNamespace**(`namespace`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `namespace` | `T` |  |

#### Returns

`void`

#### Defined in

[client/src/core/inputs.ts:164](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/inputs.ts#L164)

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
