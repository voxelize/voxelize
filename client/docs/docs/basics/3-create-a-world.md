---
sidebar_position: 3
---

# Create a World

With a server and two blocks, we are ready to create our first world. 

## What are Chunks?

Chunks are columns of blocks that make up an entire Voxelize world. By default, a chunk is 16x256x16 in dimension. A Voxelize world can be infinite because the world only generates the chunks around the clients, and as the client moves, more chunks are generated.

Chunks have their own coordinate system, separate from the voxel coordinate system. Voxel coordinates are 3D, and chunk coordinates are 2D. For example, if the chunk size is 16 blocks wide, the voxel `(1, 1, 1)` would reside in the chunk `(0, 0)`, and the voxel `(17, 1, 1)` would reside in chunk `(1, 0)`. If chunk has a max height of 256, a voxel coordinate such as `(17, 256, 1)` would be invalid since the valid y-coordinate range would be `0` - `256`.

The concept of chunk allows Voxelize to organize data and run things in parallel

## World Configuration

Voxelize worlds are configured through `WorldConfig`s. It defines how the world should be run.

```rust title="server/main.rs"
// highlight-next-line
use voxelize::{Block, Registry, Server, Voxelize, WorldConfig};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
	// ... Creating the server

	// highlight-start
    let config = WorldConfig::new()
        .min_chunk([-1, -1])
        .max_chunk([1, 1])
        .build();
	// highlight-end

	// ... Running the server
}
```

The snippet above creates a configuration for a world that generates only 9 chunks, from `(-1, -1)` to `(1, 1)` inclusively.

Here are the properties that can be configured in a world config:
- `max_clients`: The maximum amount of clients a world can hold.
- `chunk_size`: The horizontal dimension of each chunk.
- `max_height`: The maximum height of the world, in other words the vertical dimension of each chunk.
- `min_chunk`: The minimum inclusive chunk on this world.
- `max_chunk`: The maximum inclusive chunk on this world.
- `max_light_level`: The maximum level of light that can be propagated.
- `max_updates_per_tick`: The maximum chunks to be processed per tick. Tweak if the server's too heavy.
- `max_response_per_tick`: The maximum chunk response per tick to prevent network bottle-necking.
- `water_level`: The water level of the world. Can be used in the terrain generation.
- `gravity`: Three dimensional gravity.
- `min_bounce_impulse`: The minimum impulse to start bouncing.
- `air_drag`: Drag of the air in the voxelize world.
- `fluid_drag`: Drag of the fluid in the voxelize world.
- `fluid_density`: Density of the fluid in the voxelize world.
- `seed`: Seed of the voxelize world, used in `SeededTerrain`.
- `terrain`: A set of noise parameters that can be used to generate the terrain shape.
- `saving`: Whether or not should the world be saved.
- `save_dir`: The directory to save the world at.
- `save_interval`: The rate at which the world is being saved at.
