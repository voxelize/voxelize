# Bots

Headless players that speak the real protocol (API login → game ticket →
WebSocket → intents). They hold no special powers: everything they do is
validated by the game server like a browser player's.

| Script | Purpose |
| --- | --- |
| `smoke.mjs` | end-to-end check of a running stack: registration, single-use tickets, join, mining with timing validation, drops, placement, refusals |
| `crafting.mjs` | the crafting progression: chop by hand, pick up drops, 2x2 planks, workbench via recipe book, sticks/pickaxe/chest at the workbench, chest storage, dig stone, furnace, smelting |
| `nature.mjs` | block behaviours: fell a lone tree and watch its leaves decay and drop |
| `circuits.mjs` | circuits in creative: lever → conduits → lamp, pressure plate under the bot, gate by hand (also runs against a standalone game server with `DEV_TICKET_SECRET`) |
| `portals.mjs` | dimensions in creative: build and light a riftstone frame, travel to the underworld, reconnect and resume there, travel back to the original portal (also runs standalone with `DEV_TICKET_SECRET`) |
| `land.mjs` | land end to end: a paid claim through the API, the game server refusing a stranger, entry notices, a builder added through the API (needs `FUND_CMD` to give the player currency) |
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
