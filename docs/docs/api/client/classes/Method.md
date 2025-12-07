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

• **packets**: `MessageProtocol`\<`any`, `any`, `any`, `any`\>[] = `[]`

An array of packets to be sent to the server. These packets will be
sent to the server after every `network.flush()` call.

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[packets](../interfaces/NetIntercept.md#packets)

## Methods

### call

▸ **call**(`name`, `payload?`): `void`

Call a defined method on the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the method to call. |
| `payload` | `any` | The JSON serializable payload to send to the server. |

#### Returns

`void`
