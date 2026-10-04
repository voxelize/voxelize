# Bots

Headless players that speak the real protocol (API login → game ticket →
WebSocket → intents). They hold no special powers: everything they do is
validated by the game server like a browser player's.

| Script | Purpose |
| --- | --- |
| `smoke.mjs` | end-to-end check of a running stack: registration, single-use tickets, join, mining with timing validation, picking the drop up from the world, placement, refusals, fall damage, death and respawn |
| `crafting.mjs` | the crafting progression: chop by hand, pick up drops, 2x2 planks, workbench via recipe book, sticks/pickaxe/chest at the workbench, chest storage, dig stone, furnace, smelting |
| `nature.mjs` | block behaviours: fell a lone tree and watch its leaves decay and drop |
| `circuits.mjs` | circuits in creative: lever → conduits → lamp, pressure plate under the bot, gate by hand (also runs against a standalone game server with `DEV_TICKET_SECRET`) |
| `portals.mjs` | dimensions in creative: build and light a riftstone frame, travel to the underworld, reconnect and resume there, travel back to the original portal (also runs standalone with `DEV_TICKET_SECRET`) |
| `sky.mjs` | the sky dimension in creative: build and light a skystone frame, travel to the floating islands, land on an island over the void, an underworld frame refuses to light there, travel back to the original portal (also runs standalone with `DEV_TICKET_SECRET`) |
| `land.mjs` | land end to end: a paid claim through the API, the game server refusing a stranger, entry notices, a builder added through the API, growing the land by a ring of chunks, selling it to another player (needs `FUND_CMD` to give the players currency) |
| `market.mjs` | the market end to end: dig goods, list one in the game, a funded buyer buys through the API and receives it in the game, a cancelled listing comes back (needs `FUND_CMD`); buying one of a stack of two and the price history |
| `stall.mjs` | trade stalls end to end: place, stock and price a stall, a buyer pays through the ledger and receives the goods, an unaffordable buy is refused and the goods go back on sale, strangers cannot break it (standalone: seeds the owner's record via `SAVE_DIR`; needs `FUND_CMD`) |
| `blueprints.mjs` | blueprints end to end: capture a small build, publish, a buyer buys a licence and builds it from their own planks, building again without materials is refused (standalone: seeds records via `SAVE_DIR`; needs `FUND_CMD`); building turned a quarter turn, review approval (`REVIEW_CMD`) and a second revision |
| `trade.mjs` | the trade window end to end: invite, offer iron against bread and Crowns, both confirm, goods swap and Crowns move without fee; a cancelled trade returns the offer (standalone: seeds records via `SAVE_DIR`; needs `FUND_CMD`) |
| `contracts.mjs` | contracts end to end: post with a locked reward, take, deliver in the game, reward paid and goods delivered (standalone: seeds the worker's record via `SAVE_DIR`; needs `FUND_CMD`) |
| `guilds.mjs` | guilds end to end: found, join, deposit; touching guild plots paid from the treasury become a village named on entry; members build there and strangers cannot; a member's stall sells for the treasury; guild chat; a guild contract paid from the treasury and fulfilled in the game (standalone: seeds records via `SAVE_DIR`; needs `FUND_CMD`) |
| `diplomacy.mjs` | guild buildings, ranks and war end to end: a member ranked Steward places the town hall, which becomes a respawn point; two vaults share one inventory; vaults kept out of the wilderness; no fighting at peace; a contested siege captures the village; a kill each way; respawn at the hall; peace at 1:4 (standalone: seeds records via `SAVE_DIR`; needs `FUND_CMD`; the API with `GUILD_WAR_WARMUP_MINUTES=0`, the game server with `GAME_SIEGE_SECONDS=8`) |
| `armor.mjs` | armor and experience: shift-click a chestplate on (armor points reach the HUD), place an anvil and repair a worn pickaxe for levels (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `fire.mjs` | fire, explosions and bows in survival: a fire striker lights the ground, standing in it burns, the fire dies out; a lit blast charge blows a crater while the player far away is unhurt; a fully drawn bow shoots an arrow that lands and is picked up again (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `creatures.mjs` | creatures: an ember sigil on cinderstone summons the Ember Warden boss (a second is refused); its arrows hit and knock back from a distance, and its blows up close hurt, slow and knock back (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`; restart the server between runs) |
| `farm.mjs` | farming and doors: till soil, plant a carrot, ripen it with fertiliser and pick up the harvest; place a two-block door, open and close it from either half, break it whole into one door (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `modes.mjs` | game modes: a moderator puts a player into adventure (no mining or placing, announced to the world) and spectator (no use or eating) and back; a survival player may not change their own mode (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `achievements.mjs` | achievements: none on joining, crafting a crafting table earns "Benchmark" with its experience, kept across a reconnect and earned once (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `work.mjs` | jobs and quests: today's three quests, taking up the smith's job, forging an iron pickaxe at a workbench pays 2 Crowns minted into the wallet (needs the backend and `SAVE_DIR`) |
| `effects.mjs` | effects and weather: drink strength and fire resistance (bottles come back), stand in fire unharmed, fill a bottle at water; a creative player brings rain and a thunderstorm (lightning near the player) and clears it; survival players may not (standalone with `DEV_TICKET_SECRET`; seeds the record via `SAVE_DIR`) |
| `combat.mjs` | creatures: wait for an animal to spawn, kill it with validated attacks, collect its drops |
| `load.mjs` | load generation: provisioned bots walk, dig, place and chat |
| `bot.mjs` | the bot client both use |

```sh
pnpm install                         # from the repository root
pnpm build                           # engine packages (protocol, transport)

node smoke.mjs http://localhost:8080 # API and game behind Nginx

docker compose exec -T api php artisan bots:provision 50 > tokens.json
node load.mjs tokens.json 120 http://localhost:8080
```

Registration is rate limited per IP, so load tests use `bots:provision`
(disabled in production) instead of registering through the API.

Measured on the development container (one game-server process, release
build): 30 bots for 44 s → 583 validated breaks, 570 placements, 132 chat
lines, no server errors; refusals were legitimate (`collides_with_player`,
`wrong_block` when another bot changed the block first).
