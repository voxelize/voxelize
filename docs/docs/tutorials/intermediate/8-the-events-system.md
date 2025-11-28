---
sidebar_position: 8
---

# The Events System

Events are location-based messages that broadcast to nearby clients. Unlike methods which are world-wide RPC calls, events only reach clients who have the originating chunk loaded.

## How Events Work

1. Client emits an event
2. Server receives and determines the client's current chunk
3. Event broadcasts to all clients with that chunk loaded
4. Or, server can handle the event with a custom handler

## Client-Side Events

### Setting Up

```ts title="Events Setup"
import * as VOXELIZE from "@voxelize/core";

const events = new VOXELIZE.Events();

network.register(events);
```

### Emitting Events

```ts title="Emitting an Event"
events.emit("attack", {
  targetId: "enemy-123",
  damage: 10,
});
```

### Listening for Events

```ts title="Listening for Events"
events.on("explosion", (payload) => {
  const { position, radius } = payload;
  createExplosionEffect(position, radius);
});

events.on("player-hit", (payload) => {
  const { playerId, damage } = payload;
  showDamageIndicator(playerId, damage);
});
```

### Removing Listeners

```ts title="Removing Listeners"
const handler = (payload: any) => {
  console.log(payload);
};

events.on("my-event", handler);
events.off("my-event", handler);
```

## Server-Side Events

### Handling Events

Handle events on the server instead of broadcasting:

```rust title="Server Event Handler"
#[derive(Serialize, Deserialize)]
struct AttackPayload {
    target_id: String,
    damage: i32,
}

world.set_event_handle("attack", |world, client_id, payload| {
    let data: AttackPayload = serde_json::from_str(payload)
        .expect("Invalid attack payload");

    // Process the attack
    // Find target entity and apply damage
});
```

### Dispatching Events

Dispatch events from the server:

```rust title="Dispatching Events"
use voxelize::{Event, Vec2};

world.events_mut().dispatch(
    Event::new("explosion")
        .payload(serde_json::json!({
            "position": [10.0, 64.0, 10.0],
            "radius": 5.0,
        }))
        .location(Vec2(0, 0))  // Chunk coordinates
        .build()
);
```

### Broadcast to All

To broadcast to all clients regardless of location:

```rust title="Broadcasting to All"
world.events_mut().dispatch(
    Event::new("server-announcement")
        .payload(serde_json::json!({
            "message": "Server restarting in 5 minutes",
        }))
        .build()
);
```

## Event vs Method

| Feature          | Event                         | Method              |
| ---------------- | ----------------------------- | ------------------- |
| Scope            | Location-based                | World-wide          |
| Default behavior | Broadcast to nearby           | Requires handler    |
| Use case         | Visual effects, local actions | State changes, RPCs |

## Example: Hit Effect

Client emits hit event:

```ts title="Client Hit Event"
function onPlayerHit(targetId: string) {
  events.emit("player-hit", {
    targetId,
    attackerId: network.clientId,
  });
}
```

Server processes and broadcasts:

```rust title="Server Hit Handler"
world.set_event_handle("player-hit", |world, client_id, payload| {
    let data: HitPayload = serde_json::from_str(payload).unwrap();

    // Apply damage to target
    // ...

    // Get attacker position for effect location
    let client = world.clients().get(client_id).unwrap();
    let pos = world.read_component::<PositionComp>()
        .get(client.entity)
        .unwrap();

    // Broadcast hit effect to nearby players
    let chunk = world.read_component::<CurrentChunkComp>()
        .get(client.entity)
        .unwrap()
        .coords
        .clone();

    world.events_mut().dispatch(
        Event::new("hit-effect")
            .payload(serde_json::json!({
                "position": [pos.0.0, pos.0.1, pos.0.2],
                "targetId": data.target_id,
            }))
            .location(chunk)
            .build()
    );
});
```

Client renders effect:

```ts title="Client Hit Effect"
events.on("hit-effect", (payload) => {
  const { position, targetId } = payload;
  playHitSound(position);
  showHitParticles(position);
});
```

## Example: Block Break Effect

```ts title="Block Break Event"
events.on("block-break", (payload) => {
  const { voxel, blockId } = payload;
  const [vx, vy, vz] = voxel;

  const particles = createBlockParticles(blockId);
  particles.position.set(vx + 0.5, vy + 0.5, vz + 0.5);
  world.add(particles);

  setTimeout(() => {
    world.remove(particles);
  }, 1000);
});
```

Read on to learn about [method handling](./method-handling).



