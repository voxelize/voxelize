---
id: "Client"
title: "Class: Client"
sidebar_label: "Client"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `EventEmitter`

  ↳ **`Client`**

## Properties

### id

• **id**: `string` = `""`

___

### name

• **name**: `string` = `"test"`

___

### network

• **network**: [`Network`](Network.md)

___

### ecs

• **ecs**: [`ECS`](ECS.md)

___

### debug

• **debug**: [`Debug`](Debug.md)

___

### loader

• **loader**: [`Loader`](Loader.md)

___

### container

• **container**: [`Container`](Container.md)

___

### rendering

• **rendering**: [`Rendering`](Rendering.md)

___

### inputs

• **inputs**: [`Inputs`](Inputs.md)

___

### clock

• **clock**: [`Clock`](Clock.md)

___

### controls

• **controls**: [`Controls`](Controls.md)

___

### camera

• **camera**: [`Camera`](Camera.md)

___

### world

• **world**: [`World`](World.md)

___

### peers

• **peers**: [`Peers`](Peers.md)

___

### entities

• **entities**: [`Entities`](Entities.md)

___

### registry

• **registry**: [`Registry`](Registry.md)

___

### settings

• **settings**: [`Settings`](Settings.md)

___

### physics

• **physics**: [`Physics`](Physics.md)

___

### particles

• **particles**: [`Particles`](Particles.md)

___

### chat

• **chat**: [`Chat`](Chat.md)

___

### joined

• **joined**: `boolean` = `false`

___

### loaded

• **loaded**: `boolean` = `false`

___

### ready

• **ready**: `boolean` = `false`

___

### connectionPromise

• **connectionPromise**: `Promise`<`boolean`\> = `null`

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

#### Inherited from

EventEmitter.defaultMaxListeners

## Constructors

### constructor

• **new Client**(`params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | `ClientParams` |

#### Overrides

EventEmitter.constructor

## Methods

### connect

▸ **connect**(`__namedParameters`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `Object` |
| `__namedParameters.serverURL?` | `string` |
| `__namedParameters.reconnectTimeout?` | `number` |

#### Returns

`Promise`<`boolean`\>

___

### disconnect

▸ **disconnect**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### join

▸ **join**(`world`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | `string` |

#### Returns

`void`

___

### leave

▸ **leave**(): `void`

#### Returns

`void`

___

### setName

▸ **setName**(`name`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

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

#### Inherited from

EventEmitter.listenerCount

___

### eventNames

▸ **eventNames**(): (`string` \| `number`)[]

#### Returns

(`string` \| `number`)[]

#### Inherited from

EventEmitter.eventNames

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.setMaxListeners

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

#### Returns

`number`

#### Inherited from

EventEmitter.getMaxListeners

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

#### Inherited from

EventEmitter.emit

___

### addListener

▸ **addListener**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.addListener

___

### on

▸ **on**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.on

___

### once

▸ **once**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.once

___

### prependListener

▸ **prependListener**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.prependListener

___

### prependOnceListener

▸ **prependOnceListener**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.prependOnceListener

___

### removeListener

▸ **removeListener**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.removeListener

___

### off

▸ **off**(`type`, `listener`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |
| `listener` | `Listener` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.off

___

### removeAllListeners

▸ **removeAllListeners**(`type?`): [`Client`](Client.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `type?` | `string` \| `number` |

#### Returns

[`Client`](Client.md)

#### Inherited from

EventEmitter.removeAllListeners

___

### listeners

▸ **listeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Inherited from

EventEmitter.listeners

___

### listenerCount

▸ **listenerCount**(`type`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`number`

#### Inherited from

EventEmitter.listenerCount

___

### rawListeners

▸ **rawListeners**(`type`): `Listener`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` \| `number` |

#### Returns

`Listener`[]

#### Inherited from

EventEmitter.rawListeners
