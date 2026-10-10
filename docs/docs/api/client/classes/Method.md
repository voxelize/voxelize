---
id: "Method"
title: "Class: Method"
sidebar_label: "Method"
sidebar_position: 0
custom_edit_url: null
---

A caller for a method on the server.

TODO-DOC

# Example
```ts
const method = new VOXELIZE.Method();

// Register the method caller with the network.
network.register(method);

// Call a method on the server.
method.call("my-method", { hello: "world" });
```

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Properties

### packets

• **packets**: `MessageProtocol`<`any`, `any`, `any`, `any`\>[] = `[]`

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets)

## Methods

### call

▸ **call**(`name`, `payload?`): `MessageProtocol`<`any`, `any`, `any`, `any`\>

Call a defined method on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the method to call. |
| `payload` | `any` | The JSON serializable payload to send to the server. |

#### Returns

`MessageProtocol`<`any`, `any`, `any`, `any`\>

The queued packet. Callers that must know whether the command
  actually left the client can flush the network and then check the
  packet's absence from both this intercept's `packets` queue and
  `Network.isPacketPendingSend`.

___

### confirm

▸ **confirm**(`name`, `payload?`, `options?`): `Object`

Call a method and find out what the server did with it. The call goes
out between two pings: the server handles one client's messages in
order, so a reply about the call ([UNHANDLED_METHOD_REPLY](../#unhandled_method_reply),
[METHOD_REJECTED_REPLY](../#method_rejected_reply)) lands between the two pongs, and a call
that drew no reply by the second pong ran.

Needs this caller registered with the network, and goes out on the next
flush like any call.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `payload` | `any` |
| `options` | `Object` |
| `options.timeoutMs?` | `number` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `outcome` | `Promise`<[`MethodOutcome`](../#methodoutcome)\> |
| `packet` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

___

### onMessage

▸ **onMessage**(`message`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)
