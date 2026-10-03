# Roadmap

Phases follow the specification's execution order. A phase is **done** only
when it has specification, implementation, migration (if it stores data),
API (if it exposes one), tests and documentation — no permanent mocks, fake
APIs or TODOs standing in for a feature.

Legend: ✅ done · 🟡 in progress (partially shipped, gaps listed) · ⬜ not started

## Phase 0 — Foundation ✅

| Deliverable | Where |
| --- | --- |
| Architecture document | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Full ERD | [ERD.md](ERD.md) |
| Network protocol | [NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md) |
| Chunk format | [CHUNK_FORMAT.md](CHUNK_FORMAT.md) |
| Game tick architecture | [GAME_TICK.md](GAME_TICK.md) |
| Economy ledger design | [ECONOMY_LEDGER.md](ECONOMY_LEDGER.md) |
| Security boundaries | [SECURITY.md](SECURITY.md) |
| Repository structure | `platform/` ([ARCHITECTURE.md](ARCHITECTURE.md) §2) |
| Docker development environment | `platform/docker-compose.yml`, [../infrastructure/README.md](../infrastructure/README.md) |
| Automated tests and CI | `.github/workflows/platform-ci.yml` |

## Phase 1 — Core voxel engine ✅ (provided by Voxelize)

Chunks, meshing (greedy, culled, WASM on the client, worker threads),
lighting (incremental sunlight + RGB), fluids, ECS, physics, replication with
AOI, persistence primitives. Platform work here is extension points only.

## Phase 2 — World generation 🟡

Done: data-driven content pack (34 blocks, 47 items, 25 recipes, 14 biomes,
6 ores); deterministic climate → height → biome → layers → caves/lava → ores →
vegetation; engine stage; tests for determinism, ore bands, biome variety,
cliff-free borders, trees.
Remaining: rivers, ravines, aquifers/underground lakes, dungeons and rare
chambers (with structures, phase 11), biome tints sent to clients.

## Phase 3 — Player controller and web client ⬜

`apps/web-client` on `@voxelize/core`: login, ticket, connect, first-person
camera, walk/run/sprint/jump/swim/crouch/fall/climb, creative flight, block
textures (original art), settings (sensitivity, FOV, UI scale, audio,
controls, graphics, render distance), touch controls, PWA manifest.

## Phase 4 — Mining and building 🟡

Done: mining rules (hardness × tool kind/tier/speed, airborne/underwater
modifiers, unbreakable); raw client voxel writes refused; server intents
`platform.mine.start/finish` (reach, session, timing, drops, tool wear,
inventory-full refusal) and `platform.build.place` (reach, replaceability,
player collision, item consumption, creative block choice), 18 unit tests.
Remaining: land permission and game-mode (adventure/spectator) checks once
those systems exist; block orientation on place; mining progress UI.

## Phase 5 — Inventory 🟡

Done: 36-slot server inventory (9 hotbar), stacking, split/merge/swap
moves, tool durability, all-or-nothing removal, per-player persistence with
atomic writes and repair of stale records; `platform.inventory.*` intents;
2×2 and workbench 3×3 crafting (`platform.craft`).
Remaining: armor, offhand, containers (chests as block entities), drop and
pick-up of item entities, checkpointing to `inventories`/`inventory_slots`.

## Phase 6 — Persistence 🟡

Done: persistent world directory per world, atomic chunk writes, pristine
chunks regenerated from the seed, survives restarts.
Remaining: player state (`player_world_states`), region files, write-ahead
log for sensitive block entities, incremental world backups to object
storage, point-in-time MySQL backups.

## Phase 7 — Multiplayer 🟡

Done: authenticated sessions via single-use game tickets; identity bound to
the player's public id; AOI and replication from the engine.
Remaining: gateway for multiple worlds, presence in Redis, movement
anti-cheat signals, bot load-test client (hundreds of synthetic players:
movement, mining, building, chat, trading).

## Phase 8 — Survival ⬜

Health, hunger, armor, air, experience, status effects; damage types (fall,
fire, lava, drowning, combat, projectile, explosion, environment); day/night
cycle effects; weather engine tied to biomes.

## Phase 9 — Crafting and processing ⬜ (rules done)

Done: shaped/shapeless matching and processing-recipe lookup in
`crates/content`. Remaining: server crafting intent, workbench and station
block entities with fuel and progress, admin panel v1 (players, economy,
live server monitor), observability stack.

## Phase 10 — Entities and mobs ⬜

ECS components (transform, physics, health, inventory, AI, combat,
animation, navigation, network, status); passive/neutral/hostile/flying/
aquatic/boss archetypes as data; behaviour trees; voxel pathfinding (engine
`pathfinding.rs`); spawning by biome, light and time; original models.

## Phase 11 — Farming, animals, structures ⬜

Seeds, soil, water, light, growth stages, harvest, trees, fruit; animal
feeding/breeding/growth; data-driven structure templates and placement.

## Phase 12 — Automation ⬜

Original logic network: wire, switch, button, pressure sensor, repeater,
comparator-like logic, actuator, detector, lamp, door, timer; deterministic
signal propagation on the fixed step.

## Phase 13 — Land ownership ⬜

Claims, members and permissions enforced by the game server on every intent;
internal service API between game server and backend.

## Phase 14 — Trading and escrow ⬜

Atomic trade window, escrow accounts, contracts with locked rewards.

## Phase 15 — Marketplace, shops, auctions ⬜

Listings with goods in escrow, orders, fees to `system:fees`, player shops
in-world, auction house with bid holds.

## Phase 16 — Blueprint creator economy ⬜

Blueprint capture (layout + bill of materials), versions in object storage,
moderation, sales with royalties in one ledger transaction, limited
editions, provenance.

## Phase 17 — Guilds and cities ⬜

Guilds with roles, treasury account, guild land; settlements from adjacent
lands (village, town, city).

## Phase 18 — Advanced content ⬜

Dimensions and portals, quests, achievements, jobs, NPC civilisation,
cosmetics, private worlds and server browser, friends and chat channels,
proximity voice (WebRTC), plugin event API, mod SDK.

## Definition of done (whole project)

Several players, using only a browser, join one persistent world; explore
kilometres; mine and craft; build large structures; run farms and
automation; meet mobs; own land; open shops; trade items; turn a building
into a blueprint and sell it — and after logout and a server restart the
world, ownership, inventories and economy are all intact.
