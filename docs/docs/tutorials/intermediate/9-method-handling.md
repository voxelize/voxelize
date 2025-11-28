---
sidebar_position: 9
---

# Method Handling

Methods are world-wide RPC calls from client to server. They're used for actions that affect game state, like spawning entities, updating inventories, or changing world settings.

## Client-Side Methods

### Setting Up

```ts title="Method Setup"
import * as VOXELIZE from "@voxelize/core";

const method = new VOXELIZE.Method();

network.register(method);
```

### Calling Methods

```ts title="Calling a Method"
method.call("spawn-bot", {
  position: [10, 80, 10],
  name: "Bob",
  personality: "follower",
});
```

### With Callbacks

```ts title="Method with Callback"
method.call("get-inventory", { playerId: "player-123" }, (response) => {
  console.log("Inventory:", response);
});
```

## Server-Side Methods

### Defining Handlers

```rust title="Method Handler"
use serde::{Serialize, Deserialize};

#[derive(Deserialize)]
struct SpawnBotPayload {
    position: Vec3<f32>,
    name: String,
    personality: String,
}

world.set_method_handle("spawn-bot", |world, client_id, payload| {
    let data: SpawnBotPayload = serde_json::from_str(payload)
        .expect("Invalid spawn-bot payload");

    let mut metadata = MetadataComp::default();
    metadata.set("name", &data.name);
    metadata.set("personality", &data.personality);

    world.spawn_entity_with_metadata("bot", &data.position, metadata);
});
```

### Accessing Client Info

The handler receives the calling client's ID:

```rust title="Using Client ID"
world.set_method_handle("teleport-home", |world, client_id, _| {
    let client = world.clients().get(client_id).unwrap();
    let entity = client.entity;

    let mut positions = world.write_component::<PositionComp>();
    if let Some(pos) = positions.get_mut(entity) {
        pos.0.set(0.0, 100.0, 0.0);
    }

    let mut bodies = world.write_component::<RigidBodyComp>();
    if let Some(body) = bodies.get_mut(entity) {
        body.0.set_position(0.0, 100.0, 0.0);
    }
});
```

### Responding to Methods

Send a response back to the client:

```rust title="Method Response"
use voxelize::{Message, MessageType, ClientFilter};

world.set_method_handle("get-stats", |world, client_id, _| {
    let stats = world.stats().get_stats();

    world.write_resource::<MessageQueue>().push((
        Message::new(&MessageType::Method)
            .method("get-stats", &serde_json::to_string(&stats).unwrap())
            .build(),
        ClientFilter::Direct(client_id.to_owned()),
    ));
});
```

## Built-in Methods

Voxelize includes some built-in methods:

| Method                            | Description                        |
| --------------------------------- | ---------------------------------- |
| `vox-builtin:get-stats`           | Get world stats (time, tick count) |
| `vox-builtin:set-time`            | Set the world time                 |
| `vox-builtin:update-block-entity` | Update block entity JSON data      |

```ts title="Using Built-in Methods"
// Set world time to noon
method.call("vox-builtin:set-time", { time: 1200 });

// Get current stats
method.call("vox-builtin:get-stats", {});
```

## Example: Inventory System

Server-side inventory method:

```rust title="Inventory Method"
#[derive(Deserialize)]
struct UpdateSlotPayload {
    slot: usize,
    item_id: u32,
    count: u32,
}

world.set_method_handle("update-slot", |world, client_id, payload| {
    let data: UpdateSlotPayload = serde_json::from_str(payload).unwrap();

    let client = world.clients().get(client_id).unwrap();
    let entity = client.entity;

    let mut inventories = world.write_component::<InventoryComp>();
    if let Some(inv) = inventories.get_mut(entity) {
        inv.set_slot(data.slot, data.item_id, data.count);
    }
});
```

Client-side usage:

```ts title="Client Inventory Update"
function setInventorySlot(slot: number, itemId: number, count: number) {
  method.call("update-slot", { slot, item_id: itemId, count });
}
```

## Example: Chat Commands

Handle chat commands via methods:

```rust title="Command Method"
world.set_command_handle(|world, client_id, command| {
    let parts: Vec<&str> = command.split_whitespace().collect();

    match parts.get(0) {
        Some(&"spawn") => {
            if let Some(&entity_type) = parts.get(1) {
                // Get player position
                let client = world.clients().get(client_id).unwrap();
                let pos = world.read_component::<PositionComp>()
                    .get(client.entity)
                    .unwrap()
                    .0
                    .clone();

                world.spawn_entity_at(entity_type, &pos);
            }
        }
        Some(&"time") => {
            if let Some(time_str) = parts.get(1) {
                if let Ok(time) = time_str.parse::<f32>() {
                    world.stats_mut().set_time(time);
                }
            }
        }
        _ => {}
    }
});
```

## Method vs Event

| Feature          | Method          | Event                         |
| ---------------- | --------------- | ----------------------------- |
| Direction        | Client → Server | Bidirectional                 |
| Scope            | World-wide      | Location-based                |
| Handler required | Yes             | No (broadcasts by default)    |
| Use case         | State changes   | Visual effects, notifications |

Read on to learn about [chat and colored text](./chat-and-colored-text).



