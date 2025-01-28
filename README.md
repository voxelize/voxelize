<a href="https://shaoruu.io">
  <p align="center">
    <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
  </p>
  <h1 align="center">Voxelize</h1>
</a>

<p align="center">A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<p align="center">
  <a href="https://discord.gg/9483RZtWVU">
  <img alt="Discord Server" src="https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge">
  </a>
  <img src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
  <img src="https://img.shields.io/crates/v/voxelize?style=for-the-badge"/>
</p>

<a href="https://shaoruu.io">
  <p align="center">
  LIVE DEMO
  </p>
</a>

![](/assets/Screenshot%202024-02-19%20at%201.37.53 AM.png)
![](/assets/Screen%20Shot%202022-07-13%20at%201.01.08%20AM.png)
![](/assets/minejs.png)
![](/assets/Screen%20Shot%202022-07-19%20at%209.54.24%20PM.png)
![](/assets/Screen%20Shot%202022-07-31%20at%2011.58.11%20PM.png)
![](</assets/Screen%20Shot%202022-07-22%20at%208.01.48%20PM%20(2).png>)

## Disclaimer

This is purely a passionate project. The v0 of this engine, [mc.js](https://github.com/shaoruu/mc.js), was <i>brutally</i> taken down by Microsoft by a DMCA strike with some false claims (claimed that I was collecting actual MC user information even though mc.js wasn't deployed anywhere), so although inspired, I have to clarify that this voxel engine is NOT affiliated with Minecraft, nor does it have any intention collecting existing Minecraft user information (or from any licensed voxel engines). This engine is simply made out of passion, and the textures and assets used in the game are all either licensed for free use or hand-drawn by me. I am a big fan of Minecraft, so Mojang/Microsoft, if you see this, let's work together instead of taking me down :) (Minecraft web demo?)

[@shaoruu](https://github.com/shaoruu)

## Features

- Define custom blocks with custom static or dynamic mesh
  - Great support for flexible combinational rendering logic
- Easy-to-decouple server structure to refine the server-side logic
- Isolated modules that just work
- Realtime built-in multiplayer support
- Fast voxel chunk mesh generation on both client and server side (multithreaded)
- Multi-stage chunk generation with chunk overflow support
  - No need to worry if a tree overflows to neighboring chunk, that is handled automatically
- Fully configurable chat system with commands registry
- AABB Physics engine that works with any static or dynamic blocks
  - Auto-stepping, raycasting, all included
- Entity-to-entity collision detection and resolution system
- Periodic world data persistence
- Robust event system for custom game events
- For-dev debug panels that look nice

## Documentation

Checkout the Voxelize documentations here:

- [Backend](https://docs.rs/voxelize/0.8.11/voxelize/index.html)
- [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)

## Development

Before starting, make sure to install the following:

- [rust](https://www.rust-lang.org/tools/install)
- [node.js](https://nodejs.org/en/download/)
- [cargo-watch](https://crates.io/crates/cargo-watch)
- [protoc](https://grpc.io/docs/protoc-installation/)

```bash
# clone the repository
git clone https://github.com/shaoruu/voxelize.git
cd voxelize

# download dependencies
pnpm install

# generate protocol buffers
pnpm run proto

# fresh build
pnpm run build

# in a separate terminal, start both frontend/backend demo
pnpm run demo
```

visit http://localhost:3000

## Supporting

If you like our work, please consider supporting us on Patreon, BuyMeACoffee, or PayPal. Thanks a lot!

<p align="center">
  <a href="https://www.patreon.com/voxelize"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Patreon donate button" /> </a>
  <a href="https://paypal.me/iantheboss"><img src="https://werwolv.net/assets/paypal_banner.png" alt="PayPal donate button" /> </a>
  <a href="https://www.buymeacoffee.com/shaoruu"><img src="https://i.imgur.com/xPDiGKQ.png" alt="Buy Me A Coffee" style="height: 50px"/> </a>
</p>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=voxelize/voxelize&type=Date" />
</p>

## Assets Used

- [Connection Serif Font (SIL Open Font)](https://fonts2u.com/connection-serif.font)
