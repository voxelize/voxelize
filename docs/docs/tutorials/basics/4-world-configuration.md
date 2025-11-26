---
sidebar_position: 4
---

# World Configuration

Configure world boundaries, time cycles, physics, and performance settings.

## Chunk Boundaries

Set the world size with chunk coordinates:

```rust title="Bounded World"
let config = WorldConfig::new()
    .min_chunk([-10, -10])
    .max_chunk([10, 10])
    .build();
```

This creates a 20x20 chunk world (320x320 blocks with default 16-block chunks).

For infinite worlds, skip the boundaries:

```rust title="Infinite World"
let config = WorldConfig::new().build();
```

## Time and Day Cycle

```rust title="Time Settings"
let config = WorldConfig::new()
    .time_per_day(24000)
    .default_time(6000)
    .build();
```

- `time_per_day` - Ticks for a full day/night cycle
- `default_time` - Starting time (0 = midnight, 12000 = noon)

## Performance Settings

```rust title="Performance Limits"
let config = WorldConfig::new()
    .max_chunks_per_tick(4)
    .max_updates_per_tick(100)
    .max_light_level(15)
    .build();
```

## Physics

```rust title="Collision Settings"
let config = WorldConfig::new()
    .collision_repulsion(1.0)
    .client_collision_repulsion(0.2)
    .build();
```

## Persistence

```rust title="Save Configuration"
let config = WorldConfig::new()
    .saving(true)
    .save_dir("worlds/my-world")
    .save_interval(1000)
    .build();
```

## Updated Code

```rust title="src/main.rs"
use voxelize::{Block, Registry, Server, Voxelize, World, WorldConfig};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let dirt = Block::new("Dirt").id(1).build();
    let stone = Block::new("Stone").id(2).build();
    let grass_block = Block::new("Grass Block").id(3).build();

    let config = WorldConfig::new()
        .min_chunk([-10, -10])
        .max_chunk([10, 10])
        .build();

    let mut world = World::new("tutorial", &config);

    let mut registry = Registry::new();
    registry.register_blocks(&[dirt, stone, grass_block]);

    let mut server = Server::new()
        .port(4000)
        .registry(&registry)
        .build();

    server
        .add_world(world)
        .expect("Failed to add world to server");

    Voxelize::run(server).await
}
```
