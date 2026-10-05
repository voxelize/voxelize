# Modding

Two ways to change the game, both server side, both checked before the
server starts:

1. **Content packs** — data: blocks, items, recipes, furnace processing,
   biomes, ores, creatures, structures, villages, achievements, jobs and
   quests. JSON files in `platform/game/` (docs/CONTENT.md describes every
   kind). Clients receive the pack from the server (`/platform/content`),
   so a new block or item needs no client release.
2. **Plugins** — behaviour: small scripts that react to what players do
   and answer with messages, gifts and commands.

Validate a pack and its plugins without starting a world:

```sh
cargo run --release -p platform-game-server -- --check platform/game
# platform/game: {"blocks": 75, "items": 128, ...}; plugins: welcome 1.0.0
```

A broken file, an unknown key, a script that does not compile or a clashing
command stops `--check` (and the server) with the file and the reason.

## Plugins

A plugin is a folder `<pack>/plugins/<key>/` with `plugin.json` and a
script written in [Rhai](https://rhai.rs) (Rust-like, dynamically typed).
Start from `platform/tools/plugin-template/`. The shipped
`plugins/welcome/` greets players and answers `/stats`.

```jsonc
{
  "key": "my_plugin",          // snake_case, unique
  "name": "My plugin",         // shown before its messages: [My plugin] …
  "version": "0.1.0",
  "description": "…",
  "script": "main.rhai",       // default
  "commands": ["hello"],       // /hello goes to on_command
  "enabled": true              // default; false skips the folder
}
```

Commands are `a-z`, `0-9` and `_`, at most 16 characters, unique across
plugins, and never one of the game's own (`w`, `msg`, `tell`, `r`, `l`,
`local`, `g`, `guild`, `help`). `/help` lists plugin commands.

### Hooks

Define any of these functions; the rest are skipped.

| function | called |
| --- | --- |
| `on_join(player)` | a player enters a dimension (joining, or travelling) |
| `on_leave(player)` | a player leaves a dimension |
| `on_chat(player, text)` | a public chat line (already cleaned and rate limited); return `false` to hide it |
| `on_command(player, name, args)` | `/name args` for one of the manifest's commands |
| `on_event(player, event)` | `event.kind`: `mine`, `place`, `craft`, `smelt`, `kill`, `eat`, `enter`; `event.target`: the block, item, creature or dimension key; `event.count` |
| `on_tick(seconds)` | once a second, seconds since the server started |

`player` is `#{ id, name, dimension }` (`id` is the stable public id;
`dimension` is `overworld`, `underworld` or `sky`).

### What a script can do

| function | effect |
| --- | --- |
| `tell(id, text)` | a line in that player's chat: `[Plugin name] text` |
| `broadcast(text)` | the same to everyone in every dimension |
| `give(id, item_key, count)` | items into the player's inventory (what does not fit is dropped from the gift) |
| `store_get(key)` | a value the plugin stored, `()` when none |
| `store_set(key, value)` | keep a value (numbers, strings, booleans, arrays, maps); `()` deletes it. Saved every 10 s in `<save dir>/<world>/plugins/<key>.json` |
| `print(text)` | the server log |

Messages are cut to 256 characters; a call may take 64 actions.

### Limits

Plugins run on the game's tick, so they are kept small and safe:

- no files, network, modules or `eval`; a plugin sees only its own store;
- one hook call may take 200 000 operations (a runaway loop is stopped),
  32 nested calls, strings up to 64 KiB and arrays and maps up to 10 000
  entries;
- after 10 failures (errors or limits) a plugin is switched off until the
  server restarts, and the log says why;
- the effects of hooks are carried out on the next tick.

### Testing a plugin

Unit tests in `servers/game-server/src/gameplay/plugins.rs` show how to run
a script against hooks and read back its actions; `tests/bots/plugins.mjs`
checks the shipped plugin on a live server.
