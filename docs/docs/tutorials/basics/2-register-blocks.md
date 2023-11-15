---
sidebar_position: 2
---

# Register Blocks

A voxel world contains tens of millions of blocks, with each block having its own properties and different ways of rendering. Thus, after creating a server, we should register the block types that are used across this server.

In Voxelize, each server has a set of blocks that the developer defines. These blocks are managed by a **registry**, and are shared across all worlds in the same server.

## Create a Registry

Let's create our example registry, registering two blocks to it:

```rust title="server/main.rs"
// highlight-next-line
use voxelize::{Block, Registry, Server, Voxelize};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // highlight-start
    let mut registry = Registry::new();

    let dirt = Block::new("Dirt").id(1).build();
    let stone = Block::new("Stone").id(2).build();
    let grass_block = Block::new("Grass Block").id(3).build();

    registry.register_blocks(&[dirt, stone, grass_block]);

    let server = Server::new().port(4000).registry(&registry).build();
    // highlight-end

    Voxelize::run(server).await
}
```

Just like that, we have registered three blocks on the server side. These blocks are now available in every world within the server, so let's create the worlds now.

:::info
To further understand block customization, check out [this tutorial](../intermediate/custom-blocks).
:::