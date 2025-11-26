---
sidebar_position: 4
---

# World Configuration

Before adding chunk generation, let's explore the world configuration options that control how your voxel world behaves.

## WorldConfig Builder

`WorldConfig` uses the builder pattern to set options:

```rust title="src/main.rs"
let config = WorldConfig::new()
    .min_chunk([-10, -10])
    .max_chunk([10, 10])
    .build();
```

## Chunk Boundaries

Define the world's extent with chunk coordinates:

```rust title="World Boundaries"
let config = WorldConfig::new()
    .min_chunk([-50, -50])  // Southwest corner
    .max_chunk([50, 50])    // Northeast corner
    .build();
```

This creates a 100x100 chunk world (1600x1600 blocks with default 16-block chunks).

For an infinite world, omit the boundaries:

```rust title="Infinite World"
let config = WorldConfig::new().build();  // No boundaries
```

## Chunk Dimensions

Configure chunk size and height:

```rust title="Chunk Dimensions"
let config = WorldConfig::new()
    .chunk_size(16)     // Width/depth in blocks (default: 16)
    .max_height(256)    // Maximum Y coordinate (default: 256)
    .sub_chunks(8)      // Vertical divisions for rendering (default: 8)
    .build();
```

## Time and Day Cycle

Control the day/night cycle:

```rust title="Time Configuration"
let config = WorldConfig::new()
    .time_per_day(24000)    // Ticks per full day cycle
    .default_time(6000)     // Starting time (0 = midnight, 12000 = noon)
    .build();
```

## Performance Tuning

Adjust processing limits per tick:

```rust title="Performance Settings"
let config = WorldConfig::new()
    .max_chunks_per_tick(4)      // Chunks to generate per tick
    .max_updates_per_tick(100)   // Voxel updates to process per tick
    .max_light_level(15)         // Maximum light propagation
    .build();
```

## Physics Settings

Configure entity physics:

```rust title="Physics Configuration"
let config = WorldConfig::new()
    .collision_repulsion(1.0)          // Entity-entity push strength
    .client_collision_repulsion(0.2)   // Player-entity push strength
    .build();
```

## Persistence

Enable world saving:

```rust title="Saving Configuration"
let config = WorldConfig::new()
    .saving(true)
    .save_dir("worlds/my-world")
    .save_interval(1000)  // Ticks between saves
    .build();
```

## Preloading

Pre-generate chunks before players join:

```rust title="Preloading"
let config = WorldConfig::new()
    .preload(true)
    .preload_radius(5)  // Chunks to preload from origin
    .build();
```

## Chat Commands

Configure the command prefix:

```rust title="Command Symbol"
let config = WorldConfig::new()
    .command_symbol("/")  // Messages starting with "/" are commands
    .build();
```

## Progress Check

Here's our updated code with configuration:

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
        .time_per_day(24000)
        .max_chunks_per_tick(4)
        .build();

    let mut world = World::new("tutorial", &config);

    let mut registry = Registry::new();
    registry.register_blocks(&[dirt, stone, grass_block]);

    let mut server = Server::new().port(4000).registry(&registry).build();

    server
        .add_world(world)
        .expect("Failed to add world to server");

    Voxelize::run(server).await
}
```

The world is configured but still empty. In the next chapter, we'll add chunk generation to populate it with terrain.
