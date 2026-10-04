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

## Market

Goods are listed from the game (`platform.market.list`, NETWORK_PROTOCOL.md):
the game server takes them from the seller's inventory and hands them to
the backend. Everything else is here. Prices are whole Crowns; a 5 % fee
(`MARKET_FEE_BPS`) goes to `system:fees` on every sale.

### `GET /market/listings?world=main[&item=key][&kind=fixed|auction][&mine=1]` 🔒
Open listings, cheapest first (with `mine=1`: your listings in every
state, newest first): `{ "listings": [Listing] }` where Listing is
`{ "id", "kind", "world", "item", "count", "durability", "currency", "price", "buyout", "current_bid", "bid_count", "minimum_bid", "seller": { "id", "name" }, "status", "ends_at" }`.

### `GET /market/listings/{id}` 🔒
`{ "listing": Listing }`.

### `POST /market/listings/{id}/buy` 🔒
Buys a fixed-price listing or an auction at its buyout, in one ledger
transaction (buyer, seller, fee); a standing bid is refunded. The goods
become a delivery to the buyer. `201 { "listing", "replayed": false, "balance" }`;
a retry by the same buyer answers `200` with `"replayed": true` (a listing
is bought once, so no key is needed). Errors: `409 listing_closed`,
`422 own_listing | not_buyable | insufficient_funds`.

### `POST /market/listings/{id}/bids` 🔒
Header `Idempotency-Key` (required). `{ "amount": 150 }`. Locks the amount
in the listing's escrow and refunds the previous bidder. The minimum is the
opening price, then the current bid plus 5 % (at least 1); a bid in the last
two minutes extends the auction to two minutes. Errors: `422 bid_too_low |
already_highest | use_buyout | not_auction | own_listing | insufficient_funds`,
`409 listing_closed | idempotency_conflict`.

### `DELETE /market/listings/{id}` 🔒 seller
Cancels; the goods become a delivery back to the seller. `409 has_bids`
once an auction has bids.

### `GET /deliveries` 🔒
Goods on their way to you: `{ "deliveries": [{ "id", "world", "item", "count", "reason" }] }`.
They are handed over in that world when you are online with room.

`php artisan market:settle` (every minute) ends auctions (seller paid from
escrow, goods to the winner) and expires unsold listings (goods back).

## Blueprints

A blueprint is a building captured in the game (`platform.blueprint.capture`,
up to 32 blocks along each side, only where you may build): its layout is
kept in object storage with its SHA-256, its bill of materials here. A
licence lets you build it in the game from your own materials
(`platform.blueprint.build`).

Blueprint: `{ "id", "name", "world", "size": [x, y, z], "blocks", "materials": { item: count }, "creator": { "id", "name" }, "status": "draft" | "published" | "rejected", "price", "max_copies", "copies_sold", "mine", "licensed" }`.

### `GET /blueprints?world=main` 🔒
Published blueprints, newest first.

### `GET /blueprints/mine` 🔒
Blueprints you made and blueprints you hold a licence for.

### `PATCH /blueprints/{id}` 🔒 creator
`{ "name"?, "price"?, "max_copies"?, "published"? }`: publishing needs a
price; a limit cannot go below the copies sold (limited editions). `409
rejected` once moderation removed it.

### `POST /blueprints/{id}/buy` 🔒
One licence per player: a `sale` transaction pays the creator the price
minus the 5 % fee. `201 { "blueprint", "edition", "balance" }` (a repeat
answers `200` and charges nothing). Errors: `409 not_for_sale | sold_out`,
`422 own_listing | insufficient_funds`.

### Resale

A licence holder may sell their licence on; the creator sets a royalty
(`royalty_bps`, 0–5000, default 1000 = 10 %) with `PATCH /blueprints/{id}`.

- `GET /blueprints/{id}/resales` 🔒 — open resales, cheapest first:
  `{ "resales": [{ "id", "blueprint", "name", "seller", "price", "royalty_bps", "status" }] }`.
- `POST /blueprints/{id}/resales` 🔒 licence holder — `{ "price" }` → `201`;
  `403 not_licensed`, `409 already_listed`.
- `POST /blueprint-resales/{id}/buy` 🔒 — one `sale` transaction: buyer −price,
  seller +price−fee−royalty, creator +royalty, fees +fee; the licence (and its
  edition) passes to the buyer. A repeat by the buyer charges nothing.
  `409 listing_closed | already_licensed | rejected`, `422 own_listing | insufficient_funds`.
- `DELETE /blueprint-resales/{id}` 🔒 seller.
- `GET /blueprints/{id}/provenance` 🔒 — every licence minted or resold:
  `{ "provenance": [{ "event", "from", "to", "edition", "price", "royalty", "at" }] }`.

`php artisan blueprints:reject <moderator> <id> --reason=…` takes a
blueprint off sale and out of use (audited).

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

### `POST /api/internal/v1/market/listings`
`{ "key": outbox id, "seller": public id, "world", "kind", "item", "count", "durability"?, "price", "buyout"?, "hours"? }`
→ `201`/`200 { "listing": { "id", "status" }, "replayed" }`. One listing per key.

### `POST /api/internal/v1/payments`
`{ "key", "from": buyer public id, "to": seller public id, "amount", "reason", "kind"?: "stall" | "trade" }`:
a stall sale as one `sale` transaction (buyer −amount, seller +amount−fee,
fee to `system:fees`), or with `"kind": "trade"` a fee-free `transfer`
settling a trade window, once per key → `201`/`200 { "transaction", "replayed" }`;
`422 insufficient_funds | own_listing | bad_price`, `404 player_not_found`.

### `POST /api/internal/v1/blueprints`
`{ "key", "creator", "world", "name", "size": [x,y,z], "palette": [{ "block": key | null, "raw" }], "runs": [[index, count]], "materials": { item: count } }`
(runs walk the box x-major, then y, then z) → `201`/`200 { "blueprint": { "id", "blocks" }, "replayed" }`;
`422 bad_blueprint`, `503 storage_unavailable`.

### `GET /api/internal/v1/blueprints/{id}?player=<public id>`
`{ "id", "name", "materials", "layout" }` for the creator or a licence
holder (`403 not_licensed`, also after moderation); `503
storage_unavailable` if the stored layout no longer matches its hash.

### `POST /api/internal/v1/deliveries/pending`
`{ "world", "players": [public id] }` → `{ "deliveries": [{ "id", "player", "item", "count", "durability", "reason" }] }`.

### `POST /api/internal/v1/deliveries/{id}/ack`
→ `{ "delivered": true }`; idempotent.

## Conventions for new endpoints

- Version in the path; breaking changes go to `/api/v2`.
- Every money-moving endpoint requires `Idempotency-Key`.
- Resources are addressed by `public_id`.
- List endpoints are cursor-paginated.
- Each endpoint ships with feature tests and a section here.
