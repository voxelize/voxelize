[@voxelize/client](../README.md) / [Exports](../modules.md) / Peers

# Class: Peers<T\>

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | { `direction`: `number`[] ; `position`: `number`[]  } |

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Table of contents

### Constructors

- [constructor](Peers.md#constructor)

### Properties

- [object](Peers.md#object)
- [onPeerJoin](Peers.md#onpeerjoin)
- [onPeerLeave](Peers.md#onpeerleave)
- [onPeerUpdate](Peers.md#onpeerupdate)
- [ownID](Peers.md#ownid)
- [ownUsername](Peers.md#ownusername)
- [packets](Peers.md#packets)

### Methods

- [onMessage](Peers.md#onmessage)
- [packInfo](Peers.md#packinfo)
- [update](Peers.md#update)
- [directionToQuaternion](Peers.md#directiontoquaternion)

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

#### Defined in

[client/src/core/peers.ts:20](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L20)

## Properties

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

#### Defined in

[client/src/core/peers.ts:22](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L22)

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

#### Defined in

[client/src/core/peers.ts:24](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L24)

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

#### Defined in

[client/src/core/peers.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L23)

___

### ownID

• **ownID**: `string` = `""`

#### Defined in

[client/src/core/peers.ts:15](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L15)

___

### ownUsername

• **ownUsername**: `string` = `""`

#### Defined in

[client/src/core/peers.ts:16](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L16)

___

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets)

#### Defined in

[client/src/core/peers.ts:18](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L18)

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

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

#### Defined in

[client/src/core/peers.ts:26](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L26)

___

### packInfo

▸ **packInfo**(): `PeerProtocol`<`T`\>

#### Returns

`PeerProtocol`<`T`\>

#### Defined in

[client/src/core/peers.ts:65](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L65)

___

### update

▸ **update**(): `void`

#### Returns

`void`

#### Defined in

[client/src/core/peers.ts:85](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L85)

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

#### Defined in

[client/src/core/peers.ts:94](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/peers.ts#L94)
