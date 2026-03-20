<div align="center">

<a href="https://shaoruu.io">
  <img src="examples/client/src/assets/logo-circle.png" width="100" height="100" alt="Voxelize logo" />
</a>

<h1><a href="https://shaoruu.io">Voxelize</a></h1>

<p>Multiplayer voxel engine for the browser.</p>

<a href="https://discord.gg/9483RZtWVU">
  <img alt="Discord" src="https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge">
</a>
<img alt="npm" src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
<img alt="crates.io" src="https://img.shields.io/crates/v/voxelize?style=for-the-badge">

<br /><br />

<a href="https://shaoruu.io">Live demo</a>

</div>

![](/assets/Screenshot%202024-02-19%20at%201.37.53 AM.png)

## About

Passion project—not affiliated with Minecraft, and not intended to collect data from Minecraft or other licensed voxel games. Textures and assets are free-licensed or original. ([@shaoruu](https://github.com/shaoruu))

## Features

- Custom blocks with static/dynamic meshes and flexible rendering
- Decoupled server; isolated modules; built-in multiplayer
- Fast multithreaded chunk meshing on client and server
- Multi-stage chunk generation with automatic neighbor overflow (e.g. trees)
- Chat with command registry; AABB physics (raycasting, auto-step)
- Entity collisions; periodic world persistence; event system; dev debug UI

## Documentation

- [Backend (Rust)](https://docs.rs/voxelize/0.8.11/voxelize/index.html)
- [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Development

Install [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/en/download/), [cargo-watch](https://crates.io/crates/cargo-watch), and [protoc](https://grpc.io/docs/protoc-installation/).

```bash
git clone https://github.com/shaoruu/voxelize.git
cd voxelize
pnpm install
pnpm run proto
pnpm run build
pnpm run demo
```

Open [http://localhost:3000](http://localhost:3000).

## Support

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [Buy Me a Coffee](https://www.buymeacoffee.com/shaoruu)

## Assets

- [Connection Serif (SIL OFL)](https://fonts2u.com/connection-serif.font)
- [Pixel Perfection by XSSheep (CC BY-SA 4.0)](https://www.planetminecraft.com/texture-pack/131pixel-perfection/)
