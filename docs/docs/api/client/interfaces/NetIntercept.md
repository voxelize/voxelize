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

- [`Chat`](../classes/Chat.md)
- [`Entities`](../classes/Entities.md)
- [`Events`](../classes/Events.md)
- [`Method`](../classes/Method.md)
- [`Peers`](../classes/Peers.md)
- [`RigidControls`](../classes/RigidControls.md)
- [`World`](../classes/World.md)

## Properties

### onMessage

• `Optional` **onMessage**: (`message`: `MessageProtocol`, `clientInfo`: \{ `id`: `string` ; `metadata?`: `Record`\<`string`, `any`\> ; `username`: `string`  }) => `void`

A listener to be implemented to handle incoming packets.

#### Type declaration

▸ (`message`, `clientInfo`): `void`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `MessageProtocol` | The message received from the server. |
| `clientInfo` | `Object` | The client information. |
| `clientInfo.id` | `string` | The client's ID. |
| `clientInfo.metadata?` | `Record`\<`string`, `any`\> | The client's metadata (device info, etc.). |
| `clientInfo.username` | `string` | The client's username. |

##### Returns

`void`

___

### packets

• `Optional` **packets**: `MessageProtocol`[]

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.
