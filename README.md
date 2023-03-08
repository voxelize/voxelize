<a href="https://realms.voxelize.io">
  <p align="center">
    <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
  </p>
  <h1 align="center">Voxelize</h1>
</a>

<p align="center">A multiplayer, fast, super fast, voxel engine in your browser!</p>

<p align="center">
  <a href="https://discord.gg/6AfEkpjsTS">
  <img alt="Discord Server" src="https://img.shields.io/discord/1003378871753777263?label=Discord&logo=Discord&style=for-the-badge">
  </a>
  <img src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
  <img src="https://img.shields.io/crates/v/voxelize?style=for-the-badge"/>
</p>

## Supporting

If you like our work, please consider supporting us on Patreon, BuyMeACoffee, or PayPal. Thanks a lot!

<p align="center">
  <a href="https://www.patreon.com/voxelize"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Patreon donate button" /> </a>
  <a href="https://paypal.me/iantheboss"><img src="https://werwolv.net/assets/paypal_banner.png" alt="PayPal donate button" /> </a>
  <a href="https://www.buymeacoffee.com/voxelize"><img src="https://i.imgur.com/xPDiGKQ.png" alt="Buy Me A Coffee" style="height: 50px"/> </a>
</p>

## Showcase

![Voxelize Parkour](https://i.imgur.com/Mx9o5pV.jpg)
![MineJS](https://i.imgur.com/JdBQ5Lo.png)

## Features

- Realtime built-in multiplayer game play
  - Protocol buffers for fast voxel data transferral
- Multi-threaded parallel chunk processing
  - Multi-stage world generation to exceed expectations
- Fully integrated chat system with commands registry
- Oriented bounding box (ORM) physics engine that works with any blocks
  - Custom block types and shapes with physics support
- Entity with in-place collision detection and ECS built in
- World data saving for consistent experiences
- Robust event system for custom game events

## Documentation

Checkout the Voxelize documentations here:

- [Backend](https://docs.rs/voxelize/0.8.11/voxelize/index.html)
- [Frontend](https://docs.voxelize.io/docs/intro/what-is-voxelize)

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
yarn

# generate protocol buffers
yarn --cwd transport run proto

# start development
yarn run dev

# in a separate terminal, start both frontend/backend demo
yarn run demo

```

visit http://localhost:3000

## Disclaimers

This is purely a passionate project. Although inspired, I have no intention for this game to be affiliated with Minecraft, or any licensed voxel engines. Further, textures and assets used in the game are all either licensed for free use or hand-drawn by us.
