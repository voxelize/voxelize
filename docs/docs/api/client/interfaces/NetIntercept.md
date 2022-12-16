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
- [`Events`](../classes/Events.md)
- [`Method`](../classes/Method.md)

## Properties

### onMessage

• `Optional` **onMessage**: (`message`: `MessageProtocol`<`any`, `any`, `any`, `any`, `any`\>, `clientInfo`: { `id`: `string` ; `username`: `string`  }) => `void`

#### Type declaration

▸ (`message`, `clientInfo`): `void`

A listener to be implemented to handle incoming packets.

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`, `any`\> | The message received from the server. |
| `clientInfo` | `Object` | The client information. |
| `clientInfo.id` | `string` | The client's ID. |
| `clientInfo.username` | `string` | The client's username. |

##### Returns

`void`

___

### packets

• `Optional` **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`, `any`\>[]

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.
