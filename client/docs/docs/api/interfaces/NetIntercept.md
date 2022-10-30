---
id: "NetIntercept"
title: "Interface: NetIntercept"
sidebar_label: "NetIntercept"
sidebar_position: 0
custom_edit_url: null
---

An interceptor for the network layer. When registered to a network
instance, the network instance will run through all network packets
through the interceptor, and also allowing the interceptor to send
packets to the server.

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

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> | The message received from the server. |
| `clientInfo` | `Object` | The client information. |
| `clientInfo.username` | `string` | - |
| `clientInfo.id` | `string` | - |

#### Returns

`void`

## Properties

### packets

• `Optional` **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[]

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.
