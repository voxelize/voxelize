---
id: "Entities"
title: "Class: Entities<T>"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

A network interceptor that can be used to handle `ENTITY` messages. This is useful
for creating custom entities that can be sent over the network.

TODO-DOCS

# Example
```ts
const entities = new VOXELIZE.Entities<{ position: VOXELIZE.Coords3 }>();

// Define the behavior to handle an entity message.
entities.onEntity = ({ id, type, metadata }) => {
  // Do something about `metadata.position`.
};

// Register the interceptor with the network.
network.register(entities);
```

## Type parameters

| Name | Description |
| :------ | :------ |
| `T` | The type of metadata to expect, needs to be serializable. |

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

The handler for any incoming entity data from the server.

##### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | `EntityProtocol`<`T`\> |

##### Returns

`void`
