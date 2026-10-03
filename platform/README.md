# Platform

A persistent, multiplayer, browser voxel sandbox with survival gameplay and a
player-run economy, built on the Voxelize engine at the root of this
repository.

- Architecture and all design documents: [docs/](docs/ARCHITECTURE.md)
- What is done and what is next: [docs/ROADMAP.md](docs/ROADMAP.md)
- Persian overview / خلاصه فارسی: [README.fa.md](README.fa.md)

## Layout

| Path | What |
| --- | --- |
| `crates/content` | content schema, validation, mining and crafting rules |
| `crates/worldgen` | deterministic, data-driven world generator |
| `crates/ticket` | game ticket format and verifier |
| `servers/game-server` | authoritative world server (Rust, on Voxelize) |
| `backend/laravel-api` | business API: accounts, tickets, economy ledger (Laravel 13) |
| `apps/web-client` | browser client (TypeScript, Three.js via `@voxelize/core`) |
| `game/` | the content pack (JSON) |
| `tests/bots` | protocol-level bots: end-to-end smoke test, load generation |
| `infrastructure/` | Docker, Nginx, MySQL, Redis, MinIO |
| `tests/fixtures` | cross-language test vectors |

## Quick start (Docker)

```sh
pnpm install && pnpm build                       # engine packages (repo root)
pnpm --filter @platform/web-client build         # the browser client
cd platform
cp .env.example .env          # then fill in the secrets it lists
docker compose up --build
```

Open http://localhost:8080, create an account and play. The API is at
`/api/v1` and the game server at `/ws/`, all through Nginx. Details: [infrastructure/README.md](infrastructure/README.md).

## Quick start (without Docker)

```sh
# game server (needs Rust >= 1.90 and protoc)
cd platform
GAME_INSECURE_DEV=1 cargo run --release -p platform-game-server

# API (needs PHP 8.3 and Composer)
cd platform/backend/laravel-api
composer install && cp .env.example .env && php artisan key:generate
php artisan migrate && php artisan serve

# client (proxies /api to :8000 and /ws, /platform to :4000)
pnpm --filter @platform/web-client dev     # http://localhost:3005
```

Set the same `GAME_TICKET_SECRETS` for the API and the game server (drop
`GAME_INSECURE_DEV` then) so the client's tickets are accepted.

`GAME_INSECURE_DEV=1` admits sessions without tickets and must never be used
on a reachable host.

## Tests

```sh
cd platform && cargo test --workspace            # Rust: content, worldgen, tickets, server
cd platform/backend/laravel-api && php artisan test   # PHP: auth, tickets, ledger
pnpm exec vitest --run platform/apps             # client: mining parity, textures
node platform/tests/bots/smoke.mjs http://localhost:8080   # end-to-end, needs the stack
node scripts/engine-boundary/check.mjs           # engine stays game-agnostic
```

## Rules of the road

1. Server authority: clients send intents, servers decide.
2. Content is data; behaviours are code written once.
3. Money moves only through the ledger, in integers, idempotently.
4. Every feature ships with spec, migration, API, tests and docs.
5. All assets and names are original.
