---
sidebar_position: 3
---

# Installation

Once the github repository is cloned, let's try to understand what is going on.

## Server Setup

The Voxelize server runs mainly on the [voxelize](https://crates.io/crates/voxelize) crate. We will also be using:
- [actix-web](https://crates.io/crates/actix-web) for network/websocket handling.
- [specs](https://crates.io/crates/specs) for the central Entity Component System.

```toml title="server/Cargo.toml"
[dependencies]
actix-web = "4"
specs = {version = "0.17.0", features = ["specs-derive", "serde"]}
voxelize = "0.8.11"
```

## Client Setup

The client-side npm package of Voxelize is called [`@voxelize/client`](https://www.npmjs.com/package/@voxelize/client). Voxelize uses [`three.js`](https://www.npmjs.com/package/three) for the 3D rendering. As you can see in the template, they have been added to our project.

```json title="package.json"
"dependencies": {
  "@voxelize/client": "^1.3.36",
  "three": "^0.141.0"
}
```

Now you're ready to start developing! Remember, the finished version of this tutorial can be find [here](https://github.com/voxelize/voxelize-example/tree/final) if you are stuck.
