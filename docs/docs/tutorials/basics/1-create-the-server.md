---
sidebar_position: 1
---

# Create the Server

The Voxelize server handles terrain generation, meshing, and physics in parallel threads. This keeps the client fast.

Open `src/main.rs`:

```rust title="src/main.rs"
use voxelize::{Server, Voxelize};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let server = Server::new().port(4000).build();

    Voxelize::run(server).await
}
```

This creates a server on port 4000. Run it:

```bash
npm run server
```

You should see the server start on `http://localhost:4000`:

![Server Start](../assets/server-start.png)

:::tip
Voxelize uses the [builder pattern](https://doc.rust-lang.org/1.0.0/style/ownership/builders.html) throughout.
:::
