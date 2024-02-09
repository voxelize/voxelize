# Handling Events

In Voxelize, you can define custom events that can be sent from the server to the client. These events can be used to create custom game logic.

Different from methods, events are location based. This means that events fired by client A will only be received by clients that have the chunk that client A is in loaded. This is useful for creating custom game logic that is only relevant to a specific area.

By default, events that do not have a handle will be directly broadcasted to all clients through the `EventsSystem`. This can be used to create custom events that are not handled by the server.

## Defining a Server Event

```rust title="Server Event Definition"
#[derive(Serialize, Deserialize)]
struct MyEvent1Payload {
  test: String,
}

#[derive(Serialize, Deserialize)]
struct MyEvent2Payload {
  test: String,
}

let world = server.create_world("my_world", &config).expect("Failed to create world");

world.set_event_handle("my_event_1", |world, client_id, payload| {
  let data: MyEvent1Payload = serde_json::from_value(payload).expect("Failed to parse payload");

  // Do something with the world and payload
});
```

## Sending a Server Event

```ts title="Client Event Receive"
const events = new VOXELIZE.Events();

events.on("my_event_2", (payload) => {
  console.log(payload.test);
});

network.register(events);

events.emit("my_event_1", {
  test: "Hello World"
});
```

In this situation, since only the `my_event_1` event has a handle, only the `my_event_1` event will be handled by the server. Also, by the default behavior, `my_event_2` will be broadcasted to all clients.