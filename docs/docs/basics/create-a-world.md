---
sidebar_position: 3
---

# Create a World

Now that we have a server and a set of blocks, it's time for us to create our first world!

## What are Chunks?

Chunks are columns of blocks (voxels) that make up the world, by default 16 \* 16 \* 256 in dimension. A voxel world can be infinite because the world only generates the chunks around the player, and as the player moves, more chunks are generated.

Each chunk has its own coordinate, separate from the voxel coordinates. Voxel coordinates are 3D, and chunk coordinates are 2D. For example, the voxel `(1,1,1)` would reside in the chunk `(0,0)`, and the voxel `(17,1,1)` would reside in chunk `(1,0)`.

The concept of chunk allows Voxelize to organize data, and run things in parallel.

## World Configuration

A world's most important part is the configuration. It defines how the world should be run.

```rust title="server/main.rs" {2,9-13}
use voxelize::{
    world::{registry::Registry, voxels::block::Block, WorldConfig},
    Server, Voxelize,
};

fn main() {
    // ... Create the server

    let config = WorldConfig::new()
        .min_chunk([-1, -1])
        .max_chunk([1, 1])
        .build();

    // ... Running the server
}
```

The snippet above creates a world that has a total of 9 chunks from `(-1,-1)` to `(1,1)`.

Here are the things that developers can configure:

- `max_clients`: The maximum amount of clients a world can hold.
- `chunk_size`: The horizontal dimension of each chunk.
- `max_height`: The maximum height of the world, in other words the vertical dimension of each chunk.
- `min_chunk`: The minimum inclusive chunk on this world.
- `max_chunk`: The maximum inclusive chunk on this world.
- `max_light_level`: The maximum level of light that can be propagated.
- `max_updates_per_tick`: The maximum chunks to be processed per tick. Tweak if the server's too heavy.
- `max_response_per_tick`: The maximum chunk response per tick to prevent bottle-necking.
- `preload_radius`: The radius around `(0,0)` to be preloaded.
- `water_level`: The water level of the world. Can be used in the terrain generation.
- `gravity`: Three dimensional gravity.
- `min_bounce_impulse`: The minimum impulse to start bouncing.
- `air_drag`: Drag of the air in the voxelize world.
- `fluid_drag`: Drag of the fluid in the voxelize world.
- `fluid_density`: Density of the fluid in the voxelize world.
- `seed`: Seed of the voxelize world, used in `SeededTerrain`.
- `terrain`: A set of noise parameters that can be used to generate the terrain shape.

## World Creation

Now that we have a configuration, we can then use it to create a Voxelize world.

There are two ways of doing so:

```rust title="server/main.rs"
// Method 1
use voxelize::world::World;

let world = World::new("Test", &config);

// Method 2
let world = server.create_world("Test", &config).unwrap();
```

Now we have a world, it's time to populate the chunks with blocks!
