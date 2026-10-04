# REST API v1

Base path `/api/v1`. JSON in and out. Authenticated routes take
`Authorization: Bearer <token>` from login or registration. Errors use
Laravel's validation format (422 with `errors`) or
`{"error": {"code": "<machine_code>", "message": "…"}}`.

Realtime gameplay is not here; it uses the game server protocol
([NETWORK_PROTOCOL.md](NETWORK_PROTOCOL.md)).

## Auth

### `POST /auth/register`
`{ "username": "stone_mason", "email": "…", "password": "…" }` →
`201 { "user": { "id": "<public id>", "username", "status" }, "token" }`.
Username `[A-Za-z0-9_]{3,24}`, unique; password ≥ 10 characters. Creates an
empty `CRN` wallet. Rate limited (`auth`).

### `POST /auth/login`
`{ "login": "<username or email>", "password": "…" }` → `200 { user, token }`;
`422` on bad credentials; `403 account_suspended|account_banned`.

### `POST /auth/logout` 🔒
Revokes the current token.

### `GET /me` 🔒
`{ "user": { "id", "username", "status" } }`. Never returns email or numeric id.

## Game

### `POST /game/tickets` 🔒
`{ "world": "main" }` → `201 { "ticket", "expires_at", "world", "realm", "url" }`.
The ticket admits one WebSocket session to `url?ticket=…` within
`GAME_TICKET_TTL` seconds. `422` unknown world; `403` inactive account.
Rate limited (`tickets`).

## Economy

### `GET /wallets` 🔒
`{ "wallets": [{ "currency": "CRN", "balance": 0 }] }`. Balances are integers
in minor units.

### `GET /wallets/{currency}/entries` 🔒
Statement, newest first, cursor-paginated (50):
`{ "entries": [{ "transaction", "type", "reason", "amount", "balance_after", "at" }], "next_cursor" }`.

### `POST /transfers` 🔒
Header `Idempotency-Key: <8–64 URL-safe chars>` (required).
`{ "to": "<username>", "currency": "CRN", "amount": 250, "memo": "for the wall" }`
→ `201 { "transaction": { "id", "type", "reason", "created_at" }, "replayed": false, "balance" }`.
Repeating the request with the same key returns `200` with `"replayed": true`
and moves nothing. Errors: `400 idempotency_key_required`,
`404 recipient_not_found`, `409 idempotency_conflict`,
`422 insufficient_funds | invalid_posting`. Rate limited (`economy`).

## Land

A land is a box of whole land chunks (16×16 blocks, full height) in one
world and dimension. Claiming it is paid in Crowns into the burn sink;
the game server enforces it within seconds (`platform.land` events tell
players where they are).

### `GET /lands?world=main&dimension=overworld[&mine=1]` 🔒
`{ "lands": [Land] }`, where Land is
`{ "id", "name", "world", "dimension", "min": [cx, cz], "max": [cx, cz], "chunks", "owner": { "id", "name" }, "members": [{ "id", "name", "role" }], "permissions": { "build", "containers", "use" }, "status" }`.
`permissions` is what non-members may do.

### `GET /lands/quote?chunks=n` 🔒
`{ "currency": "CRN", "price", "max_side_chunks", "max_chunks_per_player" }`.

### `POST /lands` 🔒
Header `Idempotency-Key` (required).
`{ "world": "main", "dimension": "overworld", "min": [0, 0], "max": [1, 2], "name": "Homestead" }`
→ `201 { "land": Land, "replayed": false }`; a retry with the same key
answers `200` with the same land and charges nothing. Errors:
`409 land_taken` (overlaps an active land), `422 claim_too_large`
(more than `max_side_chunks` along a side), `422 land_limit` (over
`max_chunks_per_player` in total), `422 insufficient_funds`,
`404 unknown_world | unknown_dimension`. Rate limited (`economy`).

### `PATCH /lands/{id}` 🔒 owner or manager
`{ "name"?: "…", "permissions"?: { "build"?, "containers"?, "use"? } }` → `{ "land": Land }`.

### `DELETE /lands/{id}` 🔒 owner
Releases the land (nothing refunded) → `{ "released": true }`; `409 land_released` if already released.

### `POST /lands/{id}/members` 🔒 owner or manager
`{ "player": "<username>", "role": "manager" | "builder" | "visitor" }` → `{ "land": Land }`.
Only the owner adds or changes managers (`403 forbidden`).

### `DELETE /lands/{id}/members/{username}` 🔒 owner or manager
→ `{ "land": Land }`; `404 not_member`.

Roles in the game: owner, manager and builder may build, open containers
and use switches; visitors may use switches; everyone else may do what the
land's `permissions` allow.

## Internal API (game servers only)

Served on the private nginx listener (port 8081, not published); the public
listener answers 404 for `/api/internal/`. Every call carries
`Authorization: Bearer <GAME_SERVICE_TOKEN>` (≥ 32 bytes; without a
configured token the internal API refuses everything).

### `GET /api/internal/v1/lands?world=main`
`{ "world", "lands": [{ "id", "name", "dimension", "min", "max", "owner": { "id", "name" }, "members": [{ "id", "role" }], "public": { "build", "containers", "use" }, "version" }] }`,
every active land of the world, with an `ETag`; `If-None-Match` with it
answers `304`. Game servers poll it (`GAME_LAND_FEED_INTERVAL_MS`, default
5 s) and keep the last copy in `<world>/lands.json`, so a backend outage
never lifts protection.

## Conventions for new endpoints

- Version in the path; breaking changes go to `/api/v2`.
- Every money-moving endpoint requires `Idempotency-Key`.
- Resources are addressed by `public_id`.
- List endpoints are cursor-paginated.
- Each endpoint ships with feature tests and a section here.
