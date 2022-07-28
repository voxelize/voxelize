[@voxelize/client](../README.md) / [Exports](../modules.md) / Entities

# Class: Entities<T\>

## Type parameters

| Name |
| :------ |
| `T` |

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Table of contents

### Constructors

- [constructor](Entities.md#constructor)

### Properties

- [onEntity](Entities.md#onentity)

### Methods

- [onMessage](Entities.md#onmessage)

## Constructors

### constructor

• **new Entities**<`T`\>()

#### Type parameters

| Name |
| :------ |
| `T` |

## Properties

### onEntity

• **onEntity**: (`entity`: `EntityProtocol`<`T`\>) => `void`

#### Type declaration

▸ (`entity`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | `EntityProtocol`<`T`\> |

##### Returns

`void`

#### Defined in

[client/src/core/entities.ts:11](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/entities.ts#L11)

## Methods

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `T`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

#### Defined in

[client/src/core/entities.ts:13](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/core/entities.ts#L13)
