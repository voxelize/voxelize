---
sidebar_position: 1
---

# Create the Server

We start from creating the Voxelize server, setting up what we want to have in our voxelize world.

## What is a Voxelize Server?

A Voxelize server is the backend of a Voxelize app, which handles the networking and heavy-lifting of Voxelize, such as chunk generating and meshing.

A server can have multiple worlds. The worlds share the same set of defined blocks but can have different configurations.

Go to `server/main.rs`:

```rust title="server/main.rs"
use voxelize::{Server, Voxelize};

fn main() {
    let server = Server::new().port(4000).build();

    Voxelize::run(server);
}
```

Here we create a Voxelize server running on port `4000`. We will add more to this later.

Run `npm run server`, which goes into the `server` folder and runs `cargo run`. The server now runs on [http://localhost:4000](http://localhost:4000)!

:::tip
You will find out that the [idiomatic builder pattern](https://doc.rust-lang.org/1.0.0/style/ownership/builders.html) is heavily used in Voxelize.
:::
