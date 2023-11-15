# Calling Methods

In Voxelize, you can define custom methods that can be called from the client. These methods perform actions on specific worlds, and can be used to create custom game logic.

Unlike events, method runs world-wide and is not related to location.

## Defining a Server Method

```rust title="Server Method Definition"
// The payload is a JSON object
#[derive(Serialize, Deserialize)]
struct MyMethodPayload {
  test: String,
}

let world = server.create_world("my_world", &config).expect("Failed to create world");

world.set_method_handle("my_method", |world, client_id, payload| {
  let data: MyMethodPayload = serde_json::from_value(payload).expect("Failed to parse payload");

  // Do something with the world and payload
});
```

## Calling a Server Method

```ts title="Client Method Call"
const method = new VOXELIZE.Method();

network.register(method);

method.call("my_method", {
  test: "Hello World"
})
```

## Difference between Methods and Events

Methods are intended to be used for actions that change the state of the world. For example, a method could be used to print a message to the console, or to spawn a new entity.

On the other hand, events are intended to be reactive. For example, an event could be used to notify the client that a new entity has been spawned, or that a player has been hit.