<div align="center">

<img src="examples/client/src/assets/logo-circle.png" width="100" height="100" alt="Voxelize logo" />

<h1>Voxelize</h1>

<p>A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<a href="https://discord.gg/9483RZtWVU">
  <img alt="Discord Server" src="https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge">
</a>
<a href="https://www.npmjs.com/package/@voxelize/core">
  <img alt="npm" src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
</a>
<a href="https://crates.io/crates/voxelize">
  <img alt="crates.io" src="https://img.shields.io/crates/v/voxelize?style=for-the-badge"/>
</a>

<p>
  <a href="https://docs.voxelize.io">Documentation</a>
  ·
  <a href="https://docs.rs/voxelize/latest/voxelize/">Rust API</a>
  ·
  <a href="https://create.town">Live Showcase</a>
</p>

</div>

![Town, a production world built on Voxelize](assets/town-hub2-massif-4k.webp)

<p align="center"><i><a href="https://create.town">Town</a>, a live multiplayer world running on Voxelize in production.</i></p>

## Why Voxelize

Voxelize powers persistent, multiplayer voxel worlds that run in any modern browser. No installs, no plugins. 

- **Build custom blocks**: register any blocks of any shape, size, and material. Blocks can also hold custom metadata through block entities.
- **Create custom entities**: pigs, cows, sheeps, any entities you can imagine. They can roam around and interact with blocks and players.
- **Realtime multiplayer**: authoritative server with entity, chat, and event synchronization out of the box.
- **Any world generation**: define your own world generation and generate infinitely large worlds.

<p align="center">
  <img src="assets/creature-axolotl-greenhouse-pond.webp" alt="Axolotl on the bank of a terraced pond inside a glass greenhouse" />
</p>

<p align="center"><i>Custom blocks, instanced creatures, water, and voxel lighting in the browser.</i></p>

## Architecture

Both the server and the client are extremely optimized for performance and scalability. The server is written in Rust, and the client is written in TypeScript.

```text
┌───────────────────────────────┐                      ┌───────────────────────────────┐
│   Browser client (TS)         │      WebSocket       │   Authoritative server (Rust) │
│                               │◄────────────────────►│                               │
│   @voxelize/core (Three.js)   │  @voxelize/protocol  │   voxelize (ECS worlds)       │
│   physics-engine · raycast    │  @voxelize/transport │   voxelize-mesher (meshing)   │
│   voxelize-wasm-mesher (WASM) │  (shared protobuf)   │   voxelize-core (voxel data)  │
└───────────────────────────────┘                      └───────────────────────────────┘
```

- **Rust authoritative server** — `voxelize` runs [ECS](https://amethyst.github.io/specs/docs/tutorials/)-driven worlds: chunk generation, physics, entities, and events all live server-side.
- **TypeScript / Three.js client** — `@voxelize/core` renders worlds in the browser and stays in sync over WebSocket.
- **Shared protocol and transport** — `@voxelize/protocol` defines the protobuf messages; `@voxelize/transport` moves them.
- **WASM meshing** — `voxelize-wasm-mesher` compiles the server's mesher to WebAssembly, so client-side remeshing follows the same geometry rules as server-side meshing.
- **Headless agents** — `@voxelize/agent` drives real browser clients headlessly for testing, measurement, and bots.

## In Production

[**Town**](https://create.town) is a live, persistent multiplayer building world built on Voxelize, with custom textures, entities, and more.

<p align="center">
  <img src="assets/creature-ashen-dragon-volcano.webp" alt="Ashen dragon breathing fire on the flank of a volcano at night" />
</p>

<p align="center"><i>Server-driven creature behavior and particle VFX over emissive volcanic terrain</i></p>

<table>
  <tr>
    <td width="50%">
      <img src="assets/creature-capybara-lounge.webp" alt="Capybara lounging on open ground" /><br />
      <sub><i>Instanced creatures with server-driven behavior (capybaras)</i></sub>
    </td>
    <td width="50%">
      <img src="assets/mars-basalt-golem-ridge.webp" alt="Basalt golem standing on a Mars ridge" /><br />
      <sub><i>A basalt golem on Mars</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/creature-obsidian-golem.webp" alt="Obsidian golem with an emissive core under a dusk sky" /><br />
      <sub><i>Obsidian golem with an emissive core</i></sub>
    </td>
    <td width="50%">
      <img src="assets/interior-chapel-stained-glass.webp" alt="Chapel interior lit through stained-glass windows" /><br />
      <sub><i>Colored glass, voxel lighting, and custom block geometry</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/underwater-tangs.webp" alt="School of tangs in an underwater exhibit" /><br />
      <sub><i>Tropical fish and clams in my coral garden</i></sub>
    </td>
    <td width="50%">
      <img src="assets/vfx-hologram-row-night.webp" alt="Row of emissive creature holograms at night" /><br />
      <sub><i>Hologram block using custom block entities</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/circuits-copper-adder-console.webp" alt="Block-built hex display reading 1F, driven by copper circuitry" /><br />
      <sub><i>A 4-bit copper adder driving a block-built hex display</i></sub>
    </td>
    <td width="50%">
      <img src="assets/underwater-lantern-garden.webp" alt="Sunken lantern garden with kelp and glowing plants under water fog" /><br />
      <sub><i>Under the sea, kelp</i></sub>
    </td>
  </tr>
</table>

## Quick Start

Prerequisites: [Rust](https://www.rust-lang.org/tools/install), [Node.js](https://nodejs.org/en/download/), [pnpm](https://pnpm.io/installation), [cargo-watch](https://crates.io/crates/cargo-watch), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/), and [protoc](https://grpc.io/docs/protoc-installation/).

```bash
git clone https://github.com/voxelize/voxelize.git
cd voxelize

pnpm install   # install dependencies
pnpm proto     # generate protocol buffers
pnpm build     # build WASM mesher + all packages
pnpm demo      # run the demo server and client
```

Then open http://localhost:3000.

I strongly recommend using Voxelize as a submodule of the workspace you're building.

## Packages

### npm

| Package | Description |
| --- | --- |
| [`@voxelize/core`](packages/core) | The client engine: rendering, world sync, inputs, and utilities on Three.js |
| [`@voxelize/agent`](packages/agent) | Headless puppeteer-backed agent SDK for Voxelize worlds |
| [`@voxelize/transport`](packages/transport) | WebSocket transport for Voxelize protocol messages |
| [`@voxelize/protocol`](packages/protocol) | Shared protobuf message definitions |
| [`@voxelize/physics-engine`](packages/physics-engine) | Voxel-aware AABB physics with auto-stepping |
| [`@voxelize/raycast`](packages/raycast) | Voxel raycasting |
| [`@voxelize/debug`](packages/debug) | In-game debug panels |
| [`@voxelize/aabb`](packages/aabb) | Axis-aligned bounding box math |

### Rust crates

| Crate | Description |
| --- | --- |
| [`voxelize`](server) | The authoritative multiplayer server engine |
| [`voxelize-core`](crates/core) | Core types and utilities — the single source of truth for voxel data encoding |
| [`voxelize-mesher`](crates/mesher) | Chunk meshing logic |
| [`voxelize-wasm-mesher`](crates/wasm-mesher) | WebAssembly wrapper around the mesher for client-side use |

## Documentation

- [Guides and tutorials](https://docs.voxelize.io) — client-side concepts, world building, and API walkthroughs
- [Rust API reference](https://docs.rs/voxelize/latest/voxelize/) — server-side engine documentation

## Development

Useful workspace commands:

```bash
pnpm watch        # rebuild TS packages and WASM mesher on change
pnpm test         # TypeScript tests (vitest)
pnpm test:rust    # Rust mesher and lighting tests
pnpm bench        # criterion benchmarks (mesher, lights)
pnpm check        # cargo check across all targets
pnpm lint         # eslint with autofix
```

Notes on faster local builds:

- The server watch loop (`pnpm demo:rs`) builds with the `release-dev` profile: the same `opt-level = 3` runtime performance as `release`, but with incremental compilation and minimal debug info for much faster edit-rebuild cycles. Published builds should keep using `--release`.
- If you consume Voxelize as a submodule of a parent cargo workspace, cargo takes profiles from the parent's root `Cargo.toml` — copy the `[profile.release-dev]` block there to get the same fast iteration.
- Rust >= 1.90 links with the fast bundled `rust-lld` on x86_64 Linux out of the box; see `.cargo/config.toml` for opt-in lld linking on other platforms and an opt-in `sccache` shared cache.

## Community

Questions, showcases, and engine discussion happen on [Discord](https://discord.gg/9483RZtWVU). Issues and pull requests are welcome on [GitHub](https://github.com/voxelize/voxelize).

## License

[MIT](LICENSE)

## Assets Used

- [Connection Serif Font (SIL Open Font)](https://fonts2u.com/connection-serif.font)
- Pixel Perfection by XSSheep, modified — licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)

---

<sub>Voxelize is an independent open-source project. It is not affiliated with, endorsed by, or connected to any commercial voxel game or its publishers.</sub>
