# Load tests

`tests/bots/load.mjs` plays N bots through the real protocol (API login,
game ticket, WebSocket, validated intents): each walks to a random column
within 24 blocks of spawn, digs the top block, places it back and now and
then chats. While they play it samples the game server's own metrics
(`/platform/metrics`) every 2 s and reports how the overworld kept up.

```sh
php artisan bots:provision 50 > tokens.json      # accounts and API tokens
GAME_ANTICHEAT=off ...game-server                # bots set their positions
MAX_TICK_SECONDS=0.6 node tests/bots/load.mjs tokens.json 60 <api> <game>
```

The output is one JSON line: what the bots did (`joined`, `mined`,
`placed`, `chats`, refusals by code) and `server`: peak players, the
slowest gap between ticks per sample (`tick_seconds` p50/p95/max), ticks
per second (`min`, `p50`) and every intent answered by result.
`MAX_TICK_SECONDS` makes the run fail when the slowest tick is over it.

## Results

One 4-core cloud VM (15 GB) running everything at once: the game server
(release build), the backend (`php artisan serve`, SQLite) and every bot.
All bots crowd the same 48×48 block area around spawn, which is the worst
case for the server (every player sees every other player and every block
change). Numbers are for the overworld; 60 s of play.

| Bots | Joined | Intents answered | Ticks/s (p50) | Slowest tick gap p50 / p95 / max |
| --- | --- | --- | --- | --- |
| 50 | 50 | 4 590 (3 419 ok) | 19.8 | 0.16 / 0.28 / 0.51 s |
| 100 | 100 | 5 286 (4 218 ok) | 2.8 | 0.41 / 1.03 / 1.16 s |

With 50 players in one spot the world keeps its 20 ticks a second with
occasional slow ticks; at 100, on hardware that also runs the hundred
clients, it falls to about 3 ticks a second and actions lag by up to a
second (`too_fast` refusals appear because mining timing is measured
against a slowed world). Refusals such as `slot_empty` are the bots' own
doing (placing before the mined block was picked up), not server errors.

So, per world on a 4-core machine: about 50 players together comfortably.
Beyond that, spread players over worlds (each player-made world runs its
own game server, docs/API.md "Worlds") and run the bots from another
machine when measuring, so they do not compete with the server for CPU.
