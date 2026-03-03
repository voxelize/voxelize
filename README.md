<div align="center">

<a href="https://shaoruu.io">
  <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
</a>

<h1><a href="https://shaoruu.io">Voxelize</a></h1>

<p>A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<a href="https://shaoruu.io">LIVE DEMO</a>
<a href="https://discord.gg/9483RZtWVU">Discord</a>
<a href="https://docs.voxelize.io">Docs</a>

<img src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
<img src="https://img.shields.io/crates/v/voxelize?style=for-the-badge">

</div>

![](/assets/Screenshot%202024-02-19%20at%201.37.53%20AM.png)
![](/assets/Screen%20Shot%202022-07-13%20at%201.01.08%20AM.png)
![](/assets/minejs.png)
![](/assets/Screen%20Shot%202022-07-19%20at%209.54.24%20PM.png)
![](/assets/Screen%20Shot%202022-07-31%20at%2011.58.11%20PM.png)

## Disclaimer

This is a passionate project, not affiliated with Minecraft. The v0 ([mc.js](https://github.com/shaoruu/mc.js)) was taken down by Microsoft. All textures/assets are free-licensed or hand-drawn. [@shaoruu](https://github.com/shaoruu)

## Features

- Custom blocks with static or dynamic mesh
- Decoupled server structure
- Real-time multiplayer
- Fast multithreaded chunk mesh generation
- Multi-stage chunk generation with overflow support
- Chat system with commands registry
- AABB physics (auto-stepping, raycasting)
- Entity collision detection
- Periodic world persistence
- Event system & debug panels

## Quick Start

**Requirements:** [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git
cd voxelize
pnpm install
pnpm run proto
pnpm run build
pnpm run demo   # start demo (visit http://localhost:3000)
```

**Docs:** [Backend (Rust)](https://docs.rs/voxelize/0.8.11/voxelize/index.html) · [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Support

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [BuyMeACoffee](https://www.buymeacoffee.com/shaoruu)

**Assets:** [Connection Serif](https://fonts2u.com/connection-serif.font) (SIL) · [Pixel Perfection](https://www.planetminecraft.com/texture-pack/131pixel-perfection/) (CC BY-SA 4.0)

<p align="center">
  <img src="https://api.star-history.com/svg?repos=voxelize/voxelize&type=Date" />
</p>
