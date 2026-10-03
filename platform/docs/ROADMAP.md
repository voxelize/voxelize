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

## Phase 3 — Player controller and web client 🟡

Done: `apps/web-client` on `@voxelize/core` — sign-in/registration against
the API, a fresh single-use ticket per (re)connect, first-person rigid-body
controls (walk, sprint, jump, swim, crouch, fall, climb; flight only in
creative), original procedural block textures for every texture the pack
names, own sky palette, hotbar from the server inventory, hold-to-mine with
progress from the shared mining rule, place on right click, recipe book
(C) crafting through the server, PWA manifest. Verified in headless
Chromium against the running stack.
Remaining: settings screen (sensitivity, FOV, UI scale, audio, controls,
graphics, render distance), touch controls, full inventory screen, third
person camera, service worker for offline shell.

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
Done since: full window system — inventory screen (2x2 crafting, four armor
slots, offhand), workbench (3x3), furnace (input, fuel, output, flame and
progress gauges), chest (27 slots, shared live between viewers, persisted in
`containers.json`); left/right/shift/double click, drag-spreading,
number-key hotbar swaps, drop from slot; recipe book that fills the grid
from the inventory (once or max); dropped items in the world with gravity,
merging, pickup delay and 5-minute despawn; block drops, broken containers
and death spill items instead of destroying them. Verified by
`tests/bots/crafting.mjs`: chop logs by hand → planks → workbench →
sticks, wooden pickaxe, chest → store and retrieve → dig stone → furnace →
smelt.
Remaining: armor items and their protection, checkpointing to
`inventories`/`inventory_slots`, dropped items surviving a restart.

## Phase 6 — Persistence 🟡

Done: persistent world directory per world, atomic chunk writes, pristine
chunks regenerated from the seed, player inventories saved atomically;
verified that block edits and inventories survive a server restart.
Remaining: player state (`player_world_states`), region files, write-ahead
log for sensitive block entities, incremental world backups to object
storage, point-in-time MySQL backups.

## Phase 7 — Multiplayer 🟡

Done: authenticated sessions via single-use game tickets; identity bound to
the player's public id; AOI and replication from the engine.
Done: protocol-level bot client, end-to-end smoke test and load generator
(`tests/bots`); 30 concurrent bots digging, placing and chatting with no
server errors.
Remaining: gateway for multiple worlds, presence in Redis, movement
anti-cheat signals, trading in the load mix, larger load runs with tick
metrics.

## Phase 8 — Survival 🟡

Done: server-side vitals (health 20, hunger 20 with saturation and
exhaustion, 15 s of breath), fall damage (beyond 3 blocks, water breaks the
fall), drowning, lava, starvation (never below one heart), regeneration
when well fed, eating (`platform.eat`), death (all intents refused) and
respawn (`platform.respawn`), vitals persisted with the player; grace
period after join/respawn so teleports are not falls. HUD bars, damage
flash, death screen. 10 unit tests plus the live smoke test (a 10-block
fall hurts, a 40-block fall kills, respawn restores health).
Death now spills the whole inventory as dropped items. Remaining: armor, experience, status effects, fire, combat, projectile
and explosion damage, weather engine.

## Phase 9 — Crafting and processing ✅ (gameplay) / admin ⬜

Done: shaped/shapeless matching (anywhere in the grid, mirrored), 2x2 and
3x3 grids, crafting result slot with shift-craft-all, recipe book, furnace
station with fuels, burn time, progress decay, output limits, smelting while
nobody watches; all server-side and tested (unit + end-to-end).
Remaining: admin panel v1 (players, economy, live server monitor),
observability stack, more stations (smelter, crusher) as content.

## Phase 10 — Entities and mobs ⬜

ECS components (transform, physics, health, inventory, AI, combat,
animation, navigation, network, status); passive/neutral/hostile/flying/
aquatic/boss archetypes as data; behaviour trees; voxel pathfinding (engine
`pathfinding.rs`); spawning by biome, light and time; original models.

## Phase 11 — Farming, animals, structures 🟡

Done: block behaviours from content (`servers/game-server/src/behaviors.rs`,
engine active-voxel and random-tick hooks): falling sand/gravel, support
rules (plants break and drop when their ground goes), turf spreading and
dying under cover, natural leaf decay with sapling/stick/apple drops
(player-placed leaves persist), ice melting by torches, farmland drying
without water; farming — hoe tills dirt/turf (`platform.use`), seeds only on
farmland, eight wheat stages that need light and grow faster near water,
ripe crops drop wheat and seeds; saplings grow into trees. Unit tests for
every behaviour and `tests/bots/nature.mjs` on a live server (a felled tree's
leaves decay and drop saplings).
Remaining: animals (feeding, breeding, growth, drops), structures, bone-meal
style fertiliser, more crops.

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
