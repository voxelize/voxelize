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

![A forest of karst spires at golden hour in Town, a production world built on Voxelize](assets/town-karst-spires-golden-hour.webp)

<p align="center"><i><a href="https://create.town">Town</a>, a live multiplayer world running on Voxelize in production.</i></p>

## Why Voxelize

Voxelize powers persistent, multiplayer voxel worlds that run in any modern browser. No installs, no plugins. 

- **Build custom blocks**: register any blocks of any shape, size, and material. Blocks can also hold custom metadata through block entities.
- **Create custom entities**: pigs, cows, sheeps, any entities you can imagine. They can roam around and interact with blocks and players.
- **Realtime multiplayer**: authoritative server with entity, chat, and event synchronization out of the box.
- **Any world generation**: define your own world generation and generate infinitely large worlds.

<p align="center">
  <img src="assets/town-village-morning.webp" alt="A village in the morning: red-roofed houses around a green where deer graze, a villager tending garden beds, forest behind" />
</p>

<p align="center"><i>Custom blocks, instanced creatures, and voxel lighting in the browser.</i></p>

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

<table>
  <tr>
    <td width="50%">
      <img src="assets/town-skyfall-mountain.webp" alt="A waterfall dropping from a floating shelf of land onto a snow-capped mountain" /><br />
      <sub><i>A waterfall drops from a floating shelf onto a snow peak</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-sky-islands-river.webp" alt="Floating islands trailing long vines above a river plain" /><br />
      <sub><i>Sky islands trailing vines over a river plain</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/town-hoodoo-arches-sunset.webp" alt="Sandstone hoodoos and a natural arch in dry badlands at sunset" /><br />
      <sub><i>Sandstone hoodoos and arches at sunset</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-jagged-peaks-sunset.webp" alt="Jagged snow peaks above a forested valley with the sun setting behind them" /><br />
      <sub><i>Jagged snow peaks with the sun behind them</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/town-orca-dolphin-pod.webp" alt="An orca swimming under a pod of dolphins in open ocean, light shafts coming down from the surface" /><br />
      <sub><i>An orca under a dolphin pod in open ocean</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-village-lake.webp" alt="A clear shallow lake with reeds, lily pads and willows below a village" /><br />
      <sub><i>Clear shallows, reeds, and willows below the village</i></sub>
    </td>
  </tr>
</table>

One server hosts several worlds, each with its own generator.

<table>
  <tr>
    <td width="50%">
      <img src="assets/mars-base-dusk.webp" alt="A base in a red canyon at dusk with rockets, a landing pad and domes" /><br />
      <sub><i>Mars: rockets, a landing pad, and domes in a canyon at dusk</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-lobby-aurora.webp" alt="A treehouse on a floating island at night under a green aurora" /><br />
      <sub><i>The floating lobby under an aurora</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/town-liminal-yellow-halls.webp" alt="An empty hall of yellow walls and pillars under ceiling light panels" /><br />
      <sub><i>A liminal world of endless yellow halls</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-liminal-pool-atrium.webp" alt="A multi-storey atrium with hanging chains above a dark pool, lit by skylights" /><br />
      <sub><i>The same world: a pool atrium under skylights</i></sub>
    </td>
  </tr>
</table>

The game layer on top of the engine:

<table>
  <tr>
    <td width="50%">
      <img src="assets/town-ui-hud.webp" alt="First-person view of a village with a hotbar, health bar, minimap and a quest hint" /><br />
      <sub><i>Hotbar, health, minimap, and a quest hint</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-ui-bag.webp" alt="The bag screen: a character preview with equipment and wearable slots above a grid of items" /><br />
      <sub><i>The bag: equipment, wearables, and 36 slots</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/town-ui-villager-trade.webp" alt="A trade panel for a storekeeper villager offering seeds" /><br />
      <sub><i>Every villager has a job: the storekeeper trades seeds</i></sub>
    </td>
    <td width="50%">
      <img src="assets/town-ui-world-map.webp" alt="A world map showing only the explored area around a village" /><br />
      <sub><i>The map fills in as you explore</i></sub>
    </td>
  </tr>
</table>

The tooling comes with the engine: [`@voxelize/viewer`](packages/viewer) flies over a world without joining it, and [`@voxelize/agent`](packages/agent) drives headless clients for tests, captures, and bots.

<table>
  <tr>
    <td colspan="2">
      <img src="assets/viewer-page-village.webp" alt="The world viewer page: an aerial view of a village with a control panel for camera rigs, time of day, overlays and sources" /><br />
      <sub><i>The viewer page: camera rigs, time of day, overlays, A/B sources</i></sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="assets/viewer-iso-karst-basin.webp" alt="An isometric render of a basin full of karst spires between forest, sand and sea" /><br />
      <sub><i>An isometric capture of a karst basin from the viewer CLI</i></sub>
    </td>
    <td width="50%">
      <img src="assets/viewer-top-contours.webp" alt="A top-down map render of a sandy basin with contour lines over the terrain" /><br />
      <sub><i>A top-down capture with height contours</i></sub>
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
| [`voxelize-gen`](crates/gen) | Deterministic, content-free world generation: seed streams, bit-stable noise, compiled field programs, climate partitions, surface rules, carvers, hydrology, plan-sliced structures, and diagnostics |
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
