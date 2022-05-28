---
sidebar_position: 4
---

# Chunk Population

In this chapter, we learn about how to populate blocks into empty chunks, in parallel.

## A Note on [`Space`](https://github.com/shaoruu/voxelize/blob/master/server/world/voxels/space.rs)

Voxelize achieves parallel chunk generation by utilizing a data structure called Space. Essentially, spaces contain the data of a chunk along with the data of the surrounding chunks. Data include voxels, lights, and height maps, all configurable.

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

```rust title="server/main.rs" {2-4,7}
use voxelize::{
    chunk::Chunk,
    pipeline::{ChunkStage, ResourceResults},
    vec::Vec3,
    world::{
        registry::Registry,
        voxels::{access::VoxelAccess, block::Block, space::Space},
        WorldConfig,
    },
    Server, Voxelize,
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

## A Word on Chunk Stages

todo...about need space and shit

## The Chunk Pipeline

We have mentioned that a list of chunk stages define what populates the chunks. A chunk pipeline simply manages the multi-threading of the chunk populations.

We can access the world pipeline and add the stage to it:

```rust title="World Pipeline"
{
    let mut pipeline = world.pipeline_mut();

    // Add chunk stages here...
    pipeline.add_stage()
}
```

:::tip
We wrap the pipeline access with curly braces so that the pipeline lifetime is dropped after mutating.
:::
