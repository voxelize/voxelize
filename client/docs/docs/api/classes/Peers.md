---
id: "Peers"
title: "Class: Peers<T>"
sidebar_label: "Peers"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** manager for the peer clients in the same Voxelize world.

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

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

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets-4)

___

### object

• **object**: `Object3D`<`Event`\>

___

### onPeerJoin

• **onPeerJoin**: (`id`: `string`) => `void`

#### Type declaration

▸ (`id`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

##### Returns

`void`

___

### onPeerUpdate

• **onPeerUpdate**: (`peer`: `PeerProtocol`<`T`\>) => `void`

#### Type declaration

▸ (`peer`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `peer` | `PeerProtocol`<`T`\> |

##### Returns

`void`

___

### onPeerLeave

• **onPeerLeave**: (`id`: `string`) => `void`

#### Type declaration

▸ (`id`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

##### Returns

`void`

## Constructors

### constructor

• **new Peers**<`T`\>(`object`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`<`Event`\> |

## Methods

### onMessage

▸ **onMessage**(`message`, `__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<{ `id`: `string`  }, `T`, `any`, `any`\> |
| `__namedParameters` | `Object` |
| `__namedParameters.username` | `string` |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-4)

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

___

### directionToQuaternion

▸ `Static` **directionToQuaternion**(`dx`, `dy`, `dz`): `Quaternion`

#### Parameters

| Name | Type |
| :------ | :------ |
| `dx` | `number` |
| `dy` | `number` |
| `dz` | `number` |

#### Returns

`Quaternion`
