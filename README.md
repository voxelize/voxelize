# [Voxelize](https://shaoruu.io)

A multiplayer, fast voxel engine in your browser.

[![Discord](https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge)](https://discord.gg/9483RZtWVU)
[![npm](https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge)](https://www.npmjs.com/package/@voxelize/core)
[![crates](https://img.shields.io/crates/v/voxelize?style=for-the-badge)](https://crates.io/crates/voxelize)
[LIVE DEMO](https://shaoruu.io)

![](/assets/Screenshot%202024-02-19%20at%201.37.53%20AM.png)
![](/assets/Screen%20Shot%202022-07-13%20at%201.01.08%20AM.png)
![](/assets/Screen%20Shot%202022-07-19%20at%209.54.24%20PM.png)

## Features

- Custom blocks with static/dynamic meshes and flexible rendering
- Decoupled server architecture with isolated, working modules
- Realtime multiplayer, multithreaded chunk mesh generation
- Multi-stage chunk generation with overflow support
- Chat system with commands registry
- AABB physics (auto-stepping, raycasting), entity collisions
- Periodic world persistence, robust event system

## Quick Start

**Requirements:** [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git
cd voxelize
pnpm install && pnpm run proto && pnpm run build
pnpm run demo
```

Visit http://localhost:3000

## Docs

- [Backend (Rust)](https://docs.rs/voxelize)
- [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Supporting

[Patreon](https://www.patreon.com/voxelize) · [PayPal](https://paypal.me/iantheboss) · [BuyMeACoffee](https://www.buymeacoffee.com/shaoruu)

---

*Disclaimer: A passion project—not affiliated with Minecraft. Inspired by [mc.js](https://github.com/shaoruu/mc.js). Textures/assets are licensed or hand-drawn. — [@shaoruu](https://github.com/shaoruu)*

**Assets:** [Connection Serif (SIL)](https://fonts2u.com/connection-serif.font) · [Pixel Perfection (CC BY-SA 4.0)](https://www.planetminecraft.com/texture-pack/131pixel-perfection/)
