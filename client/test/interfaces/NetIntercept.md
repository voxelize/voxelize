[@voxelize/client](../README.md) / [Exports](../modules.md) / NetIntercept

# Interface: NetIntercept

## Implemented by

- [`Chat`](../classes/Chat.md)
- [`Entities`](../classes/Entities.md)
- [`Events`](../classes/Events.md)
- [`Peers`](../classes/Peers.md)
- [`World`](../classes/World.md)

## Table of contents

### Properties

- [packets](NetIntercept.md#packets)

### Methods

- [onMessage](NetIntercept.md#onmessage)

## Properties

### packets

• `Optional` **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[]

#### Defined in

[client/src/core/network/intercept.ts:9](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/intercept.ts#L9)

## Methods

### onMessage

▸ **onMessage**(`message`, `clientInfo`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |
| `clientInfo` | `Object` |
| `clientInfo.id` | `string` |
| `clientInfo.username` | `string` |

#### Returns

`void`

#### Defined in

[client/src/core/network/intercept.ts:4](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/network/intercept.ts#L4)
