---
sidebar_position: 2
---

# Installation

The next step is to install the required libraries, both on the frontend and backend.

## Server Setup

To get Voxelize on the app, add it to `server/Cargo.toml` under `dependencies`. Voxelize also heavily relies on the [specs ECS](https://github.com/amethyst/specs) library, so add that to `Cargo.toml` as well.

```toml
[dependencies]
voxelize = "0.3.0"
specs = {version = "0.17.0", features = ["specs-derive", "serde"]}
```

## Client Setup

The npm package of Voxelize is called [`@voxelize/client`](https://www.npmjs.com/package/@voxelize/client). Voxelize also runs on [`@voxelize/voxel-physics-engine`](https://www.npmjs.com/package/@voxelize/voxel-physics-engine) and uses [`three.js`](https://www.npmjs.com/package/three) for the 3D rendering. Here we add them to our project.

```bash
# Install Voxelize on the Client
npm install @voxelize/client @voxelize/voxel-physics-engine three
```

Now you're ready to start developing! Remember, the finished version of this tutorial can be find [here](https://github.com/shaoruu/voxelize-example/tree/final) if you are stuck.
