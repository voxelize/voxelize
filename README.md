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

Voxelize is a passion project. It is not affiliated with Minecraft or any other licensed voxel engine. Textures and assets are either open-licensed or hand-drawn.

## Features

- Custom blocks with static or dynamic mesh, combinational rendering
- Decoupled server, realtime multiplayer, multithreaded chunk generation
- Chat, commands, AABB physics (stepping, raycasting), entity collision
- Periodic persistence, event system

## Docs

- [Backend](https://docs.rs/voxelize) · [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Quick start

Requires: [rust](https://www.rust-lang.org/tools/install), [node.js](https://nodejs.org/), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git && cd voxelize
pnpm install && pnpm run proto && pnpm run build
pnpm run demo
```

Visit http://localhost:3000

## Supporting

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [Buy Me a Coffee](https://www.buymeacoffee.com/shaoruu)

## Assets

[Connection Serif](https://fonts2u.com/connection-serif.font) (SIL) · [Pixel Perfection](https://www.planetminecraft.com/texture-pack/131pixel-perfection/) (CC BY-SA 4.0)

---

[@shaoruu](https://github.com/shaoruu)
