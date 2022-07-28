---
sidebar_position: 2
---

# Installation

Once the github repository is cloned, it is important to understand what is going on.

## Server Setup

The Voxelize server runs mainly on the [voxelize](https://crates.io/crates/voxelize) crate, along with [actix-web](https://crates.io/crates/actix-web) for network handling and [specs](https://crates.io/crates/specs) for Entity Component System, more on that later.

```toml title="server/Cargo.toml"
[dependencies]
actix-web = "4"
specs = {version = "0.17.0", features = ["specs-derive", "serde"]}
voxelize = "0.5.3"
```

## Client Setup

The client-side npm package of Voxelize is called [`@voxelize/client`](https://www.npmjs.com/package/@voxelize/client). Voxelize uses [`three.js`](https://www.npmjs.com/package/three) for the 3D rendering. Here we added them to our project.

```json title="package.json"
"dependencies": {
  "@voxelize/client": "^1.1.3",
  "three": "^0.141.0"
}
```

Now you're ready to start developing! Remember, the finished version of this tutorial can be find [here](https://github.com/shaoruu/voxelize-example/tree/final) if you are stuck.
