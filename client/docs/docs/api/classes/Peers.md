---
id: "Peers"
title: "Class: Peers<C, T>"
sidebar_label: "Peers"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** manager for the peer clients in the same Voxelize world.

## Type parameters

| Name | Type |
| :------ | :------ |
| `C` | extends `Object3D` = `Object3D` |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

## Hierarchy

- `Group`

  ↳ **`Peers`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Properties

### ownID

• **ownID**: `string` = `""`

___

### ownUsername

• **ownUsername**: `string` = `""`

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-98)

___

### object

• `Optional` **object**: `Object3D`<`Event`\>

___

### params

• **params**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `countSelf` | `boolean` |

___

### createPeer

• **createPeer**: (`id`: `string`) => `C`

#### Type declaration

▸ (`id`): `C`

##### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

##### Returns

`C`

___

### onPeerUpdate

• **onPeerUpdate**: (`object`: `C`, `data`: `T`) => `void`

#### Type declaration

▸ (`object`, `data`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `C` |
| `data` | `T` |

##### Returns

`void`

## Constructors

### constructor

• **new Peers**<`C`, `T`\>(`object?`, `params?`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `C` | extends `Object3D`<`Event`, `C`\> = `Object3D`<`Event`\> |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

#### Parameters

| Name | Type |
| :------ | :------ |
| `object?` | `Object3D`<`Event`\> |
| `params` | `Object` |
| `params.countSelf` | `boolean` |

#### Overrides

Group.constructor

## Methods

### onPeerJoin

▸ **onPeerJoin**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

___

### onPeerLeave

▸ **onPeerLeave**(`id`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`void`

___

### onMessage

▸ **onMessage**(`message`, `__namedParameters`): `void`

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<{ `id`: `string`  }, `T`, `any`, `any`\> |
| `__namedParameters` | `Object` |
| `__namedParameters.username` | `string` |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-98)

___

### packInfo

▸ **packInfo**(): `PeerProtocol`<`T`\>

#### Returns

`PeerProtocol`<`T`\>

___

### update

▸ **update**(): `void`

#### Returns

`void`
