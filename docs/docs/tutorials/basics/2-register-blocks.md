---
sidebar_position: 2
---

# Register Blocks

A voxel world has millions of blocks. Each block type needs properties - is it solid? transparent? what shape?

The server registry defines all block types. All worlds on the server share the same registry.

## Create the Registry

Add three block types:

```rust title="src/main.rs"
use voxelize::{Block, Registry, Server, Voxelize};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let dirt = Block::new("Dirt").id(1).build();
    let stone = Block::new("Stone").id(2).build();
    let grass_block = Block::new("Grass Block").id(3).build();

    let mut registry = Registry::new();
    registry.register_blocks(&[dirt, stone, grass_block]);

    let server = Server::new()
        .port(4000)
        .registry(&registry)
        .build();

    Voxelize::run(server).await
}
```

These three blocks are now available in every world on this server.

:::info
For custom block properties, check out the [Custom Blocks](../intermediate/12-custom-blocks.md) tutorial.
:::
