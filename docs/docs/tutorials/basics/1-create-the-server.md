---
sidebar_position: 1
---

# Create the Server

A Voxelize server is a very **powerful HTTP based web server** that handles most of the heavy-lifting you see in a Voxelize app, such as world terrain generation and meshing. These tasks are done on the server-side in a multi-threaded fashion, so that we can ensure the best user experience on the client-side. 

Go to `server/main.rs`:

```rust title="test"
use voxelize::{Server, Voxelize};

#[actix_web::main]
async fn main() -> std::io::Result<()>{
    let server = Server::new().port(4000).build();

    Voxelize::run(server).await
}
```

In this code snippet, we create a server running at port `4000`. We will be adding more configurations later on.

Now, we can run `npm run server` which internally runs `cargo run`. This server should now be running on `http://localhost:4000`, and you'll see something like below in the terminal.

![Server Start](../assets/server-start.png)

:::tip
The [idiomatic builder pattern](https://doc.rust-lang.org/1.0.0/style/ownership/builders.html) is heavily used in Voxelize!
:::