---
id: "Entities"
title: "Class: Entities<T>"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** map representing living entities on the server.

## Type parameters

| Name |
| :------ |
| `T` |

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

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

## Methods

### onMessage

▸ **onMessage**(`message`): `void`

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `T`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-14)
