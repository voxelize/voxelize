---
id: "Events"
title: "Class: Events"
sidebar_label: "Events"
sidebar_position: 0
custom_edit_url: null
---

A manager for events interacting with the Voxelize server. This is useful
for defined game events that are sent from or need to be broadcasted to
the server.

Multiple listeners may register for the same event name; each is called
when that event arrives. Use [off](Events.md#off) to remove a specific listener.

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

▸ **addEventListener**\<`TPayload`\>(`name`, `handler`): `void`

Synonym for [on](Events.md#on), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TPayload` | [`EventPayload`](../modules.md#eventpayload) |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler)\<`TPayload`\> | What to do when this event is received? |

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
| `payload` | [`EventPayload`](../modules.md#eventpayload) | The payload to send with the event. |

#### Returns

`void`

___

### emitSoundEffect

▸ **emitSoundEffect**(`payload`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `payload` | [`SoundEffectEventPayload`](../modules.md#soundeffecteventpayload) |

#### Returns

`void`

___

### off

▸ **off**\<`TPayload`\>(`name`, `handler`): `void`

Remove a previously registered listener. No-op if the handler was not
registered for this name.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TPayload` | [`EventPayload`](../modules.md#eventpayload) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `handler` | [`EventHandler`](../modules.md#eventhandler)\<`TPayload`\> |

#### Returns

`void`

___

### on

▸ **on**\<`TPayload`\>(`name`, `handler`): `void`

Synonym for [addEventListener](Events.md#addeventlistener), adds a listener to a Voxelize server event.
If the payload cannot be parsed by JSON, `null` is set.

Multiple handlers may share the same event name; later registrations are
no longer canceled.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TPayload` | [`EventPayload`](../modules.md#eventpayload) |

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the event to listen on. Case sensitive. |
| `handler` | [`EventHandler`](../modules.md#eventhandler)\<`TPayload`\> | What to do when this event is received? |

#### Returns

`void`

___

### onSoundEffect

▸ **onSoundEffect**(`handler`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`SoundEffectEventHandler`](../modules.md#soundeffecteventhandler) |

#### Returns

`void`

___

### removeEventListener

▸ **removeEventListener**\<`TPayload`\>(`name`, `handler`): `void`

Synonym for [off](Events.md#off).

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TPayload` | [`EventPayload`](../modules.md#eventpayload) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `handler` | [`EventHandler`](../modules.md#eventhandler)\<`TPayload`\> |

#### Returns

`void`
