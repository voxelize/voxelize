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
voxelize = "*"
actix-web = "*"
specs = {version = "*", features = ["specs-derive", "serde"]}
```

## Client Setup

The client-side npm package of Voxelize is called [`@voxelize/core`](https://www.npmjs.com/package/@voxelize/core). Voxelize uses [`three.js`](https://www.npmjs.com/package/three) for the 3D rendering. As you can see in the template, they have been added to our project in the `package.json` file.

```json title="package.json"
"dependencies": {
  "@voxelize/core": "**",
  "three": "*"
}
```

Now you're ready to start developing! Remember, the finished version of this tutorial can be find [here](https://github.com/voxelize/voxelize-tutorial/tree/final) if you are stuck.
