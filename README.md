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

![](/assets/Screenshot%202024-02-19%20at%201.37.53 AM.png)
![](/assets/Screen%20Shot%202022-07-13%20at%201.01.08%20AM.png)
![](/assets/minejs.png)
![](/assets/Screen%20Shot%202022-07-19%20at%209.54.24%20PM.png)
![](/assets/Screen%20Shot%202022-07-31%20at%2011.58.11%20PM.png)
![](/assets/Screen%20Shot%202022-07-22%20at%208.01.48%20PM%20(2).png)

## Disclaimer

A passionate project—not affiliated with Minecraft. Inspired by [mc.js](https://github.com/shaoruu/mc.js) (taken down by DMCA). All assets are licensed or hand-drawn. [@shaoruu](https://github.com/shaoruu)

## Features

- Custom blocks with static/dynamic mesh and flexible rendering logic
- Decoupled server structure, isolated modules
- Realtime multiplayer, multithreaded chunk meshing (client & server)
- Multi-stage chunk generation with overflow support (e.g. trees across chunk borders)
- Configurable chat + commands registry, AABB physics (auto-stepping, raycasting)
- Entity collision, periodic world persistence, event system, debug panels

## Documentation

[Backend](https://docs.rs/voxelize/0.8.11/voxelize/index.html) · [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Development

**Requires:** [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/en/download/), [cargo-watch](https://crates.io/crates/cargo-watch), [protoc](https://grpc.io/docs/protoc-installation/)

```bash
git clone https://github.com/shaoruu/voxelize.git && cd voxelize
pnpm install && pnpm run proto && pnpm run build
pnpm run demo   # separate terminal
```

→ http://localhost:3000

## Supporting

<a href="https://www.patreon.com/voxelize"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Patreon" /></a>
<a href="https://paypal.me/iantheboss"><img src="https://werwolv.net/assets/paypal_banner.png" alt="PayPal" /></a>
<a href="https://www.buymeacoffee.com/shaoruu"><img src="https://i.imgur.com/xPDiGKQ.png" alt="Buy Me A Coffee" style="height: 50px"/></a>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=voxelize/voxelize&type=Date" />
</p>

## Assets

- [Connection Serif Font (SIL Open Font)](https://fonts2u.com/connection-serif.font)
- [Pixel Perfection by XSSheep (CC BY-SA 4.0)](https://www.planetminecraft.com/texture-pack/131pixel-perfection/)
