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

## Conventions for new endpoints

- Version in the path; breaking changes go to `/api/v2`.
- Every money-moving endpoint requires `Idempotency-Key`.
- Resources are addressed by `public_id`.
- List endpoints are cursor-paginated.
- Each endpoint ships with feature tests and a section here.
