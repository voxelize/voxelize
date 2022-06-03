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

### mesher

• **mesher**: [`Mesher`](Mesher.md)

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
