<div align="center">

<a href="https://shaoruu.io">
  <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
</a>

<h1><a href="https://shaoruu.io">Voxelize</a></h1>

<p>A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<a href="https://discord.gg/9483RZtWVU">
  <img alt="Discord Server" src="https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge">
</a>
<img src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
<img src="https://img.shields.io/crates/v/voxelize?style=for-the-badge"/>

<a href="https://shaoruu.io">LIVE DEMO</a>

</div>

![](/assets/Screenshot%202024-02-19%20at%201.37.53%20AM.png)

## Disclaimer

A passion project—not affiliated with Minecraft. Inspired by [mc.js](https://github.com/shaoruu/mc.js); textures and assets are free-licensed or hand-drawn. [@shaoruu](https://github.com/shaoruu)

## Features

- Custom blocks with static/dynamic mesh, combinational rendering
- Decoupled server structure, isolated modules
- Realtime multiplayer, multithreaded chunk mesh generation
- Multi-stage chunk generation with overflow support
- Configurable chat + commands, AABB physics (auto-stepping, raycasting)
- Entity collision, world persistence, event system, debug panels

## Documentation

- [Backend (Rust)](https://docs.rs/voxelize/0.8.11/voxelize/index.html)
- [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Development

**Prerequisites:** [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/en/download/), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git && cd voxelize
pnpm install && pnpm run proto && pnpm run build
pnpm run demo  # in a separate terminal
```

Visit http://localhost:3000

## Supporting

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [BuyMeACoffee](https://www.buymeacoffee.com/shaoruu)

<p align="center">
  <img src="https://api.star-history.com/svg?repos=voxelize/voxelize&type=Date" />
</p>

## Assets

- [Connection Serif Font (SIL Open Font)](https://fonts2u.com/connection-serif.font)
- [Pixel Perfection by XSSheep (CC BY-SA 4.0)](https://www.planetminecraft.com/texture-pack/131pixel-perfection/)
