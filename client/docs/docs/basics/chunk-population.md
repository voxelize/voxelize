---
sidebar_position: 4
---

# Chunk Population

In this chapter, we learn about how to populate blocks into empty chunks, in parallel.

## Chunk Stage

To populate chunks, developers define a list of chunk stages that each chunk has to go through. For example, there could be a `TreeStage` that places trees on each chunk, or there could be a `WaterStage` that fills water up to the sea level.

In this tutorial, we are going to define a `FlatlandStage`, which simply populates the world with a flat land. (_Hint: This stage actually comes built-in in Voxelize!_)

Let's set up the flat land stage first:

```rust title="server/main.rs"
// ...
pub struct FlatlandStage {
    /// The height of the flat land.
    height: i32,

    /// Block type of the top of the flat land.
    top: u32,

    /// Block type of the middle of the flat land.
    middle: u32,

    /// Block type of the bottom of the flat land.
    bottom: u32,
}

impl FlatlandStage {
    pub fn new(height: i32, top: u32, middle: u32, bottom: u32) -> Self {
        Self {
            height,
            top,
            middle,
            bottom,
        }
    }
}
// ...
```

Chunk stages all implement the `ChunkStage` trait, so let's do that next:

```rust title="server/main.rs"
use voxelize::{
    Block, ChunkStage, Registry, ResourceResults, Server, Space, VoxelAccess, Voxelize, WorldConfig,
};
```

:::note

- `VoxelAccess` allows developers to use chunk data access methods such as `set_voxel`.
- `Vec3` is a 3-number data structure used across Voxelize.

:::

Implement what the flat land stage does:

```rust title="server/main.rs"
// ...
impl ChunkStage for FlatlandStage {
    fn name(&self) -> String {
        "Flatland".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: ResourceResults, _: Option<Space>) -> Chunk {
        // Minimum coordinates of the chunk.
        let Vec3(min_x, _, min_z) = chunk.min;

        // Maximum coordinates of the chunk.
        let Vec3(max_x, _, max_z) = chunk.max;

        // Loop through all voxels up to the defined height.
        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..self.height {
                    // Set voxels conditionally.
                    if vy == 0 {
                        chunk.set_voxel(vx, vy, vz, self.bottom);
                    } else if vy == self.height - 1 {
                        chunk.set_voxel(vx, vy, vz, self.top);
                    } else {
                        chunk.set_voxel(vx, vy, vz, self.middle);
                    }
                }
            }
        }

        // Return the chunk instance for it to progress to the next stage.
        chunk
    }
}
// ...
```

## The Chunk Pipeline

Now we have a chunk stage defined, it's time to add it to the world's pipeline. A chunk pipeline simply manages the multi-threading of the chunk populations, pipelining all the chunks requested through every stage.

We can access the world pipeline and add the stage to it:

```rust title="server/main.rs"
// Create the world

{
    let registry = world.registry();

    // Access the block ID's registered.
    let dirt = registry.get_block_by_name("Dirt").id;
    let stone = registry.get_block_by_name("Stone").id;

    drop(registry);

    let mut pipeline = world.pipeline_mut();

    // Add a chunk stage with top block stone, middle dirt, and bottom stone.
    pipeline.add_stage(FlatlandStage::new(10, stone, dirt, stone));
}

// Run the server
```

The world should now be generating a flat land. In fact, you can simply import `FlatlandStage` from `voxelize::pipeline::FlatlandStage`!

:::tip
We wrap the pipeline access with curly braces so that the pipeline lifetime is dropped after mutating.
:::

## A Word on Chunk Stages

When working with chunk stages, developers may want to access more information about the world, such as the registry, chunks around that chunk, and the world configurations.

### Resources of the World

By implementing the `stage.needs_resources` function, the stage would be presented with the configured data, including the registry, world config, seeded noise instance, and seeded terrain instance.

### [`Space`](https://github.com/shaoruu/voxelize/blob/master/server/world/voxels/space.rs) Data Structure

Voxelize achieves parallel chunk generation by utilizing a data structure called Space. Essentially, spaces contain the data of a chunk along with the data of the surrounding chunks. Data includes voxels, lights, and height maps, all configurable.

- A space is provided to the stage if the `stage.needs_space` function is implemented.
- Spaces ensures that it contains chunks in stages equal to or greater than the center chunk.
- Spaces can also be mutated, but they are deleted after each stage. So, use `get_lights` or `get_voxels` to get its individual chunk data.

## Progress Check

The code so far should look like this:

```rust title="server/main.rs"
use voxelize::{Block, FlatlandStage, Registry, Server, Voxelize, WorldConfig};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut registry = Registry::new();

    let dirt = Block::new("Dirt").build();
    let stone = Block::new("Stone").build();

    registry.register_blocks(&[dirt, stone]);

    let mut server = Server::new().port(4000).registry(&registry).build();

    let config = WorldConfig::new()
        .min_chunk([-1, -1])
        .max_chunk([1, 1])
        .build();
    let world = server.create_world("Test", &config).unwrap();

    {
        let registry = world.registry();

        let dirt = registry.get_block_by_name("Dirt").id;
        let stone = registry.get_block_by_name("Stone").id;

        drop(registry);

        let mut pipeline = world.pipeline_mut();

        pipeline.add_stage(FlatlandStage::new(10, dirt, stone, stone));
    }

    Voxelize::run(server).await
}
```
