---
id: "NetIntercept"
title: "Interface: NetIntercept"
sidebar_label: "NetIntercept"
sidebar_position: 0
custom_edit_url: null
---

## Implemented by

- [`BlockBreakParticles`](../classes/BlockBreakParticles.md)
- [`Chat`](../classes/Chat.md)
- [`Entities`](../classes/Entities.md)
- [`Events`](../classes/Events.md)
- [`Peers`](../classes/Peers.md)
- [`World`](../classes/World.md)

## Methods

### onMessage

▸ **onMessage**(`message`, `clientInfo`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |
| `clientInfo` | `Object` |
| `clientInfo.username` | `string` |
| `clientInfo.id` | `string` |

#### Returns

`void`

## Properties

### packets

• `Optional` **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[]
