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
Done since: rivers, ravines, five data-driven structures with loot
(see WORLD_GENERATION.md). Remaining: aquifers/underground lakes, villages,
biome tints sent to clients.

## Phase 3 — Player controller and web client 🟡

Done: `apps/web-client` on `@voxelize/core` — sign-in/registration against
the API, a fresh single-use ticket per (re)connect, first-person rigid-body
controls (walk, sprint, jump, swim, crouch, fall, climb; flight only in
creative), original procedural block textures for every texture the pack
names, own sky palette, hotbar from the server inventory, hold-to-mine with
progress from the shared mining rule, place on right click, recipe book
(C) crafting through the server, PWA manifest. Verified in headless
Chromium against the running stack.
Done since: settings panel (mouse sensitivity, inverted look — added to the
engine's RigidControls as a generic option — field of view, render distance,
interface size, volume; stored per browser), original synthesised sound
effects (digging and breaking by material, placing, footsteps, hits,
hurt, pickups, eating), touch controls on phones and tablets (joystick,
drag to look, mine/attack, place/use, jump, crouch, sprint, inventory,
drop) on the engine's MobileRigidControls, inventory screen, PWA service
worker for the app shell (never caching API or game data).
Remaining: key rebinding, third-person camera, colour-blind palettes.

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
Done since: player position and dimension saved and restored on join.
Remaining: player state in `player_world_states`, region files, write-ahead
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

## Phase 10 — Entities and mobs 🟡

Done: data-driven creatures (`platform/game/mobs`, validated): Grazer,
Cluckling and Bristleback (passive animals) and Shambler and Cave Crawler
(hostile, night and darkness); voxel physics with gravity, step-up and
swimming; utility state machine (wander/idle, flee when hurt, follow a
player holding their food, seek a partner, chase and melee); breeding with
babies that grow up; Shamblers burn in daylight; natural spawning by light,
time of day, biome and ground block with per-player caps; despawning of
distant monsters; animals persist in `mobs.json`; combat (`platform.attack`
with reach, cooldown, weapon damage and wear, knockback; `platform.interact`
to feed); creature damage kills players (who drop everything); meat and
poultry cook in the furnace. Client: original box models, walking animation,
hurt and love tints, click to attack, right click to feed. 8 unit tests and
`tests/bots/combat.mjs` (hunt an animal on a live server, collect its meat).
Remaining: ranged and flying/aquatic creatures, bosses, A* pathfinding
around obstacles, armor and player knockback, experience.

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
Animals and structures are done (phases 10 and 2). Remaining: bone-meal
style fertiliser, more crops.

## Phase 12 — Automation ✅ (first circuit set)

Done: circuit content (`game/blocks/40-circuits.json`, voltite ore and
recipes) and server-side signal simulation on the engine's active-voxel hook:
power 0–15 stored in the block's stage bits, every step into a conduit
costs one level (a line fades after 15), levers, buttons, pressure plates
and clocks as sources, buttons release after a short pulse, clocks pulse at
one of four periods, one-way repeaters restore full strength after two
ticks, inverters, lamps and gates react to power changes (a gate opened by
hand stays open until the power changes), actuators push the block in front
one cell on a rising edge; facing comes from the block rotation the mesher
draws. Players use them with right click (`platform.use`: toggle a lever,
press a button, step a clock's period, open or close a gate), place
directional pieces facing the way they look (`rotation`/`yRotation` on
`platform.build.place`), and pressure plates sense players and creatures
standing on them (`PlateSystem`). Original client textures for every
piece. 8 unit tests and `tests/bots/circuits.mjs` on a live server.
Remaining: comparator-style and detector blocks, doors two blocks tall,
pulling actuators.

## Phase 13 — Land ownership ✅ (first version)

Done: claims of whole 16×16 land chunks per world and dimension, paid in
Crowns into the burn sink through the ledger, overlap-free under a
per-dimension lock, idempotent, size and per-player limits; members with
manager/builder/visitor roles and public permissions; release; append-only
history and audit (`lands`, `land_members`, `land_history`, `land_locks`);
API (`/api/v1/lands…`); internal feed for game servers
(`/api/internal/v1/lands`, service token, ETag, private nginx listener);
game server enforcement on breaking, placing, using and containers
(`land_protected`), cached on disk across backend outages, entry notices
(`platform.land`); web client land panel (L): claim this chunk or 3×3,
members, guest permissions, release. Tests: 5 backend feature tests, game
server unit tests, `tests/bots/land.mjs` end to end (API → ledger → feed →
game server).
Remaining: guild land, resizing, selling land (marketplace phase), claim
borders drawn in the world, actuators pushing blocks across a border,
protecting animals inside claims.

## Phase 14 — Trading and escrow 🟡

Done: escrow accounts in the ledger (`escrow:<ref>:<CUR>`), used by
auction bids (lock, refund on outbid, release to the seller at the end).
Done since: the trade window — invite a nearby player, offer stacks and
Crowns, both confirm; Crowns move through the ledger without fee, then the
goods swap; any change unconfirms; cancel, distance, leaving or death end
it with everyone's items back; holds saved with each player's inventory and
outcomes applied once; web client trade panel (T to invite, Y to accept).
Tests: unit tests, backend payment test, `tests/bots/trade.mjs` end to end.
Done since: delivery contracts — the reward is locked in escrow when
posted; one player takes the contract and delivers the goods in the game
through the outbox; the reward is released to them and the goods delivered
to the poster; withdrawal and expiry refund the poster; Contracts tab in the
market panel. Tests: 2 backend feature tests, unit test,
`tests/bots/contracts.mjs` end to end.

## Phase 15 — Marketplace, shops, auctions 🟡

Done: the market — fixed-price listings and auctions with optional buyout,
listed from the game with the goods in the backend's custody (outbox in the
seller's record, idempotent hand-over), bought or bid on through the API,
sales as one ledger transaction (buyer or escrow, seller, 5 % fee to
`system:fees`), bids locked in escrow with outbid refunds and anti-sniping,
`market:settle` every minute, deliveries handed over in the game exactly
once (remembered ids, then acknowledgement), cancellation and expiry
returning goods; web client market panel (M): browse, buy, bid, sell the
held stack, my listings, deliveries. Tests: 6 backend feature tests, game
server unit tests, client helpers, `tests/bots/market.mjs` end to end.
Done since: player shops in the world — trade stalls owned by whoever
places them, stocked through a chest-style window, priced per slot; a
purchase sets the goods aside, is paid through the ledger (one `sale`, fee
included, idempotent by sale key) and hands the goods over once, or puts
them back on sale when refused; owner-only breaking; creative stalls never
sell. Tests: backend payment test, unit tests, `tests/bots/stall.mjs` end
to end.
Remaining: partial purchases of a stack, price history and search by item
name, guild sellers.

## Phase 16 — Blueprint creator economy ✅ (first version)

Done: capture in the game (box up to 32³, only where you may build,
palette + run-length layout, bill of materials), layouts in object storage
(MinIO through the S3 driver; local disk in development) with a SHA-256
checked on every read, drafts, pricing, publishing, limited editions,
licences sold in one ledger transaction paying the creator and the fee,
moderation (`blueprints:reject`), provenance in the audit log; building a
licensed blueprint in the game from the player's own materials, all or
nothing; web client blueprint panel (B). Tests: 3 backend feature tests,
unit tests, `tests/bots/blueprints.mjs` end to end.
Done since: resale of licences — holders list theirs, buyers pay the seller,
the creator's royalty (set by the creator, up to 50 %) and the fee in one
ledger transaction, the licence and its edition move to the buyer, and an
append-only provenance records every mint and resale.
Remaining: rotated or mirrored building, versioned updates of a blueprint,
a review queue before publishing.

## Phase 17 — Guilds and cities 🟡

Done: guilds (one per player) with leader, officers and members,
invitations, removal, leadership handover; a treasury that is a ledger
account (deposits by members, payouts to members by officers, its own
statement); guild land claimed by officers and paid from the treasury, on
which every member builds (the game server's land feed carries the guild);
disbanding pays the treasury to the last leader and releases the land; web
client guild panel (G) and "claim for the guild" in the land panel. Tests:
5 backend feature tests, Rust land tests, client unit tests.
Remaining: settlements from adjacent lands (village, town, city), guild
chat, guild-owned stalls and contracts.

## Phase 18 — Advanced content 🟡

Done: dimensions and portals — the underworld (sealed cavern generator with
a lava sea, cinderstone, emberglass, ember quartz, its own creature the
Cinder Wraith) as a second engine world in the same process with its own
block registry; riftstone frames lit with a fire striker (`platform.use`),
rifts that collapse when the frame breaks, travel after 4 s in a rift (1 s
in creative), coordinates scaled 8:1, arrival areas generated on demand,
portals found within 16 columns or built, portal pairs linked and saved
(`portal_links.json`), one player record across dimensions with the
dimension and any pending arrival, redirection on join, respawn home, saved
position restored on join (`platform.teleport`), creative item palette
intent (`platform.inventory.creative`) with a searchable palette of every
item on the inventory screen in creative worlds. The engine gained one generic extension:
a world may bring its own block registry. Unit tests for generation,
portal geometry, links and rules; `tests/bots/portals.mjs` on a live server
(light a portal, travel down, reconnect and resume there, travel back to
the original portal).
Done since: the sky dimension — floating-island generator (one island per
grid cell, islets, cloud banks, sunstone ore) as a third engine world; a
second portal kind (skystone frame, sky rift, crafted from riftstone, ember
quartz and glass) declared in content (`portal` on the rift block), travel
routed by the kind of rift, arrivals landing on the nearest island, void
damage below the world, a bright sky palette in the client. Unit tests for
generation, routing, ignition and the void; `tests/bots/sky.mjs` on a live
server (light a skystone portal, travel up, land on an island over the void,
an underworld frame refuses to light there, travel back to the original
portal).
Remaining: quests, achievements, jobs, NPC civilisation,
cosmetics, private worlds and server browser, friends and chat channels,
proximity voice (WebRTC), plugin event API, mod SDK.

## Definition of done (whole project)

Several players, using only a browser, join one persistent world; explore
kilometres; mine and craft; build large structures; run farms and
automation; meet mobs; own land; open shops; trade items; turn a building
into a blueprint and sell it — and after logout and a server restart the
world, ownership, inventories and economy are all intact.
