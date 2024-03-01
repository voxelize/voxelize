---
id: "Events"
title: "Class: Events"
sidebar_label: "Events"
sidebar_position: 0
custom_edit_url: null
---

A manager for any events interacting with the Voxelize server. This is useful
for any defined game events that are sent from or needs to be broadcasted to
the server.

# Example
```ts
const events = new VOXELIZE.Events();

// Define the behavior to handle a game-over event. Keep in mind that this
// event is most likely sent from the server, so check out the documentations
// for creating and emitting custom events fullstack.
events.on("game-over", (payload) => {
  // Do something about the game over event.
});

// Register the interceptor with the network.
network.register(events);
```

TODO-DOC

## Hierarchy

- `Map`\<`string`, [`EventHandler`](../modules.md#eventhandler)\>

  ↳ **`Events`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Constructors

### constructor

• **new Events**(): [`Events`](Events.md)

Creates a new instance of the Voxelize event manager.

#### Returns

[`Events`](Events.md)

#### Overrides

Map\&lt;string, EventHandler\&gt;.constructor

## Methods

### addEventListener

▸ **addEventListener**(`name`, `handler`): `void`

Synonym for [on](Events.md#on), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler) | What to do when this event is received? |

#### Returns

`void`

___

### emit

▸ **emit**(`name`, `payload?`): `void`

Emit an event to the server.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to emit. |
| `payload` | `any` | The payload to send with the event. |

#### Returns

`void`

___

### on

▸ **on**(`name`, `handler`): `void`

Synonym for [addEventListener](Events.md#addeventlistener), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler) | What to do when this event is received? |

#### Returns

`void`
