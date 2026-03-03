<div align="center">

<a href="https://shaoruu.io">
  <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
</a>

<h1><a href="https://shaoruu.io">Voxelize</a></h1>

<p>A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<a href="https://discord.gg/9483RZtWVU">Discord</a> · <a href="https://shaoruu.io">Live Demo</a> · [Backend Docs](https://docs.rs/voxelize/) · [Frontend Docs](https://docs.voxelize.io)

</div>

![](/assets/Screenshot%202024-02-19%20at%201.37.53%20AM.png)

## Features

- Custom blocks with static or dynamic mesh, flexible rendering
- Decoupled server structure, isolated modules
- Realtime multiplayer, multithreaded chunk mesh generation
- Multi-stage chunk generation with overflow support
- Chat system with command registry, AABB physics, entity collisions
- World persistence, event system, debug panels

## Quick Start

**Requirements:** [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git
cd voxelize
pnpm install
pnpm run proto
pnpm run build
pnpm run demo   # in a separate terminal
```

Visit http://localhost:3000

## Disclaimer

Passionate side project, not affiliated with Minecraft. Assets are free-licensed or hand-drawn. [@shaoruu](https://github.com/shaoruu)

## Supporting

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [BuyMeACoffee](https://www.buymeacoffee.com/shaoruu)
