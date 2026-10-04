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

### `GET /lands?world=main&dimension=overworld[&mine=1][&for_sale=1]` 🔒
`{ "lands": [Land] }`, where Land is
`{ "id", "name", "world", "dimension", "min": [cx, cz], "max": [cx, cz], "chunks", "owner": { "id", "name" }, "guild": { "id", "name", "tag" } | null, "members": [{ "id", "name", "role" }], "permissions": { "build", "containers", "use", "animals" }, "sale_price": n | null, "status" }`.
`permissions` is what non-members may do (`animals`: hurt passive and
neutral creatures). `for_sale=1` lists only land on sale.

### `GET /lands/quote?chunks=n` 🔒
`{ "currency": "CRN", "price", "max_side_chunks", "max_chunks_per_player" }`.

### `POST /lands` 🔒
Header `Idempotency-Key` (required).
`{ "world": "main", "dimension": "overworld", "min": [0, 0], "max": [1, 2], "name": "Homestead", "guild"?: "<guild id>" }`
→ `201 { "land": Land, "replayed": false }`; a retry with the same key
answers `200` with the same land and charges nothing. Errors:
`409 land_taken` (overlaps an active land), `422 claim_too_large`
(more than `max_side_chunks` along a side), `422 land_limit` (over
`max_chunks_per_player` in total), `422 insufficient_funds`,
`404 unknown_world | unknown_dimension`. Rate limited (`economy`).
With `guild`, a leader or officer claims for the guild: the guild's treasury
pays, the limit is `guilds.max_chunks` per guild, and every guild member may
build there (leader = owner, officers = managers, members = builders);
`403 forbidden` for anyone else, `404 guild_not_found`. `mine=1` lists your
own land and your guild's.

### `PATCH /lands/{id}` 🔒 owner or manager
`{ "name"?: "…", "permissions"?: { "build"?, "containers"?, "use"?, "animals"? } }` → `{ "land": Land }`.

### `POST /lands/{id}/resize` 🔒 owner
Header `Idempotency-Key` (required). `{ "min": [cx, cz], "max": [cx, cz] }`
→ `{ "land": Land }`. The new box must overlap the old one
(`422 resize_detached`), stay within `max_side_chunks` and the holding limit
(`land_limit`) and not overlap other claims (`409 land_taken`). Added chunks
are paid at the claim price (guild land from the treasury); shrinking
refunds nothing. A retry with the same key changes and charges nothing.
Rate limited (`economy`).

### `PUT /lands/{id}/sale` 🔒 owner · `DELETE /lands/{id}/sale` 🔒 owner
`{ "price": n }` offers the land for sale (`1 … land.max_sale_price`,
`422 bad_price`); `DELETE` withdraws the offer. Guild land is not sold
(`422 guild_land`). → `{ "land": Land }`.

### `POST /lands/{id}/buy` 🔒
Header `Idempotency-Key` (required). `{ "price": n }`, the price the buyer
saw → `{ "land": Land }`: the price moves from the buyer's wallet to the
owner's (ledger transfer), the buyer becomes owner, members are cleared and
permissions reset. `409 not_for_sale`, `409 price_changed`, `422 own_land`,
`422 land_limit`, `422 insufficient_funds`; a retry with the same key
answers the same land and pays once. Rate limited (`economy`).

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

### `GET /market/listings?world=main[&item=key][&items=k1,k2][&q=text][&kind=fixed|auction][&mine=1]` 🔒
Open listings, cheapest first (with `mine=1`: your listings in every
state, newest first): `{ "listings": [Listing] }` where Listing is
`{ "id", "kind", "world", "item", "count", "durability", "currency", "price", "buyout", "current_bid", "bid_count", "minimum_bid", "seller": { "id", "name" }, "status", "ends_at" }`.
Search: `items` lists exact item keys (the client turns item names into
keys from the content pack), `q` matches part of a key (spaces read as `_`).

### `GET /market/history?world=main&item=key[&days=30]` 🔒
Price history of an item: `{ "item", "sales": [{ "count", "price", "unit_price", "at" }] (newest 50), "stats": { "days", "sales", "items", "average_unit_price", "min_unit_price", "max_unit_price" } }`
over the last `days` (1–365). Every sale counts: whole listings, parts of
stacks and won auctions.

### `GET /market/listings/{id}` 🔒
`{ "listing": Listing }`.

### `POST /market/listings/{id}/buy` 🔒
Buys a fixed-price listing or an auction at its buyout, in one ledger
transaction (buyer, seller, fee); a standing bid is refunded. The goods
become a delivery to the buyer. `201 { "listing", "replayed": false, "balance" }`;
a retry by the same buyer answers `200` with `"replayed": true` (a listing
is bought once, so no key is needed). Errors: `409 listing_closed`,
`422 own_listing | not_buyable | insufficient_funds`.
`{ "count": n }` with an `Idempotency-Key` header buys part of a fixed-price
stack: `n` items for their share of the price rounded up (the last items pay
whatever remains, so a whole stack costs exactly its price); the listing
keeps the rest. A retry with the same key answers `"replayed": true` and
pays once; `n` at or above the count buys the rest. `422 not_divisible` for
auctions, `400 idempotency_key_required`.

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

## Contracts

"Bring me N of an item by a deadline": the reward is locked in
`escrow:contract:<id>` when posted, released to the contractor when the
goods arrive in the game (`platform.contract.deliver`), refunded on
withdrawal or expiry (`php artisan contracts:expire`, every minute).

Contract: `{ "id", "title", "world", "item", "count", "reward", "currency", "status": "open" | "accepted" | "fulfilled" | "expired" | "cancelled", "poster", "guild": { "id", "name", "tag" } | null, "contractor", "deadline_at", "role": "poster" | "contractor" | null }`.

A leader or officer posts for their guild with `"guild": "<guild id>"`: the
reward is locked from the guild's treasury and refunded to it; the goods
come to the posting officer; any officer of the guild may withdraw it;
`mine=1` also lists the guild's contracts. `403 forbidden` for members.

- `GET /contracts?world=main[&mine=1]` 🔒 — open contracts (or yours in every state).
- `POST /contracts` 🔒 — header `Idempotency-Key`; `{ "world", "title"?, "item", "count", "reward", "hours"? (1–168, 48) }`
  → `201 { "contract", "replayed", "balance" }`; `422 insufficient_funds | bad_goods | bad_price | bad_duration`.
- `POST /contracts/{id}/accept` 🔒 — one contractor; `409 contract_closed`, `422 own_listing`.
- `POST /contracts/{id}/abandon` 🔒 contractor — open again.
- `DELETE /contracts/{id}` 🔒 poster, while untaken — refunds; `409 contract_taken`.

## Guilds

One guild per player. The leader appoints officers and may hand over the
leadership; officers invite and remove members and spend the treasury;
every member may deposit. The treasury is the ledger account
`guild:<id>:CRN`. Founding costs `guilds.creation_fee` (100 CRN) into the
burn sink. When the last member leaves, the guild is disbanded: its
treasury goes to that leader and its land is released.

Guild: `{ "id", "name", "tag", "leader": { "id", "name" }, "members" }`; the
detailed form adds `"roster": [{ "id", "name", "role" }], "treasury", "currency", "max_members", "max_chunks", "my_role", "settlements": [Settlement], "settlement_level"`.

**Settlements.** A guild's lands that touch (share an edge or a corner, in
one world and dimension) form a settlement: Settlement is
`{ "world", "dimension", "lands": [land id], "chunks", "level": "none" | "village" | "town" | "city", "min": [cx, cz], "max": [cx, cz] }`.
A village needs 4 chunks, a town 16 chunks and 3 members, a city 64 chunks
and 8 members (`guilds.settlements`). The guild's best settlement raises
its member limit (`guilds.member_limits`: 50, a town 75, a city 100). The
land feed names the settlement on each of its lands, and the game server
announces it on entry.

- `GET /guilds[?q=text]` 🔒 — active guilds by name or tag.
- `GET /guilds/mine` 🔒 — `{ "guild": detail | null, "invites": [Guild] }`.
- `GET /guilds/{id}` 🔒 — detail.
- `POST /guilds` 🔒 — header `Idempotency-Key`; `{ "name" (3–32), "tag" (2–5 letters or digits) }`
  → `201 { "guild", "replayed", "balance" }`; `409 in_guild | guild_taken`, `422 bad_name | bad_tag | insufficient_funds`.
- `POST /guilds/{id}/invites` 🔒 leader or officer — `{ "player": username }`; `409 in_guild | guild_full`.
- `POST /guilds/{id}/join` 🔒 invited player; `403 not_invited`. `POST /guilds/{id}/decline` 🔒.
- `POST /guilds/{id}/leave` 🔒 — `409 leader_must_hand_over` while others remain.
- `DELETE /guilds/{id}/members/{username}` 🔒 — leader removes anyone, officers remove members.
- `PUT /guilds/{id}/members/{username}/role` 🔒 leader — `{ "role": "leader" | "officer" | "member" }`; `leader` hands over (the old leader becomes an officer).
- `POST /guilds/{id}/deposit` 🔒 member — header `Idempotency-Key`; `{ "amount" }` → `{ "transaction", "treasury", "balance" }`.
- `POST /guilds/{id}/withdraw` 🔒 leader or officer — header `Idempotency-Key`; `{ "amount", "to"?: username }` (a member; yourself by default).
- `GET /guilds/{id}/entries` 🔒 member — treasury ledger entries, cursor paginated.
**Ranks.** Beyond the three roles, the leader defines up to
`guilds.max_ranks` (10) ranks: a title and permissions from `invite`,
`kick`, `treasury` (pay out), `land` (claim guild land; a manager on guild
land, so may place town halls), `contracts` (post guild contracts). The
leader may do everything, officers all five; members only what their rank
grants. A member who may remove others removes plain members only. The
guild detail adds `"ranks": [{ "id", "name", "permissions" }]`,
`"roster"[].rank: { "id", "name" } | null` and `"my_permissions"`.

- `POST /guilds/{id}/ranks` 🔒 leader — `{ "name" (2–24), "permissions": [] }` → `201 { "guild" }`; `409 rank_taken | too_many_ranks`, `422 bad_name | bad_permission`.
- `PATCH /guilds/{id}/ranks/{rank}` 🔒 leader — `{ "name"?, "permissions"? }`.
- `DELETE /guilds/{id}/ranks/{rank}` 🔒 leader — its holders keep their role, without a rank.
- `PUT /guilds/{id}/members/{username}/rank` 🔒 leader — `{ "rank": id | null }`.
- `PUT /guilds/{id}/tax` 🔒 leader — `{ "bps": 0–2000 }`: a sales tax on every stall sale on the guild's land (not on its own guild stalls), paid to its treasury; `422 bad_tax`.
- `GET /guilds/{id}/relations` 🔒 — `{ "relations": [Relation] }`, Relation `{ "id", "kind": "alliance" | "war", "status": "proposed" | "active", "with": { "id", "name", "tag" }, "initiated", "fighting", "starts_at", "ends_at", "score": { "us", "them" } | null, "peace_offered": "us" | "them" | null }`; also in the guild detail with `tax_bps`.
- `POST /guilds/{id}/alliances` 🔒 leader — `{ "guild": id or tag }`: proposes, or accepts the other guild's proposal; allies' members visit each other's guild land (use switches and gates). `409 at_war`, `422 bad_guild`.
- `DELETE /guilds/{id}/alliances/{other}` 🔒 leader — ends (or refuses) an alliance.
- `POST /guilds/{id}/wars` 🔒 leader — `{ "guild": id or tag }`: declares war for `guilds.war.declaration_fee` (200) from the treasury to the burn sink; fighting starts after `warmup_minutes` (10) and ends after `max_days` (7) at the latest. `409 allied`.
- `POST /guilds/{id}/wars/{other}/peace` 🔒 leader — offers peace; when the other leader already offered it, the war ends: `{ "peace", "offered" }`.
- `GET /guilds/{id}/messages[?after=id]` 🔒 member — guild chat: the latest 50, or up to 100 newer than `after`, oldest first: `{ "messages": [{ "id", "from": { "id", "name" }, "body", "at" }] }`.
- `POST /guilds/{id}/messages` 🔒 member — `{ "body" }` (1–300 characters after trimming control characters) → `201`; `422 bad_message`, `429 slow_down` (over `guilds.chat_per_minute`, 20).

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
rejected` once moderation removed it. When review is required
(`BLUEPRINT_REVIEW_REQUIRED`, default on) publishing puts the design
`in_review` until a moderator approves it; `published: false` withdraws it.
Blueprints carry `revision` and, for their creator, `review_note`.

### `GET /blueprints/review` 🔒 moderator
Designs waiting for review, oldest first (`403` for players without the
`moderator` or `admin` role).

### `POST /blueprints/{id}/review` 🔒 moderator
`{ "approve": true }` publishes; `{ "approve": false, "note": "…" }` sends
it back to draft with the note (`422 note_required` without one).
`409 not_in_review`. Audited. `php artisan blueprints:review <moderator>
[<id> --approve | --send-back="…"]` does the same (no id: lists the queue).

### `GET /blueprints/{id}/revisions` 🔒 creator, licence holder or moderator
`{ "revisions": [{ "revision", "size", "blocks", "materials", "sha256", "at" }] }`.
A creator uploads a new revision from the game (`platform.blueprint.capture`
with `update`); licence holders always build the newest, and a published
design goes back to review.

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

### `GET /api/internal/v1/guilds`
`{ "guilds": [{ "id", "tag", "name", "members": [public id], "allies": [guild id], "wars": [guild id] }] }`:
every active guild, its active alliances and the wars it is fighting right
now (past the warm-up, before the end). Polled with `If-None-Match` like the
land feed; game servers allow fighting between players of guilds at war
and open guild vaults to members.

### `POST /api/internal/v1/wars/captures`
`{ "key": siege id, "attacker", "land": land id }`: a siege banner held long
enough; when the attacker's guild is fighting the land's guild, the land
passes to the attacker's guild (owned by its leader, individual land members
dropped, `land_history` event `captured`) and the war scores
`guilds.war.capture_points` (3) for it; once per key → `201`/`200 { "land", "guild", "replayed" }`;
`409 not_at_war | not_guild_land`.

### `POST /api/internal/v1/wars/kills`
`{ "key": kill id, "killer", "victim" }` (public ids): scores a kill for the
killer's guild when the two guilds are fighting, once per key →
`200 { "war", "score": [a, b] }`; `409 not_at_war`, `404 player_not_found`.

### `GET /api/internal/v1/lands?world=main`
`{ "world", "lands": [{ "id", "name", "dimension", "min", "max", "owner": { "id", "name" }, "members": [{ "id", "role" }], "public": { "build", "containers", "use", "animals" }, "sale": n | null, "version" }] }`,
every active land of the world, with an `ETag`; `If-None-Match` with it
answers `304`. Game servers poll it (`GAME_LAND_FEED_INTERVAL_MS`, default
5 s) and keep the last copy in `<world>/lands.json`, so a backend outage
never lifts protection.

### `POST /api/internal/v1/market/listings`
`{ "key": outbox id, "seller": public id, "world", "kind", "item", "count", "durability"?, "price", "buyout"?, "hours"? }`
→ `201`/`200 { "listing": { "id", "status" }, "replayed" }`. One listing per key.

### `POST /api/internal/v1/payments`
`{ "key", "from": buyer public id, "to": seller public id, "amount", "reason", "kind"?: "stall" | "trade" | "guild_stall" }`:
a stall sale as one `sale` transaction (buyer −amount, seller +amount−fee,
fee to `system:fees`); with `"kind": "guild_stall"` the seller's share goes
to the seller's guild treasury instead (their wallet if they have no
guild); with `"land_guild"` (the guild whose land the stall stands on)
that guild's sales tax goes to its treasury; with `"kind": "trade"` a fee-free `transfer` settling a trade
window; once per key → `201`/`200 { "transaction", "replayed" }`;
`422 insufficient_funds | own_listing | bad_price`, `404 player_not_found`.

### `POST /api/internal/v1/rewards`
`{ "key", "player": "<public id>", "world", "source": "job" | "quest", "reason", "amount" }`
→ `{ "paid", "requested", "paid_today", "daily_cap" }`: Crowns minted for
jobs and quests, at most `rewards.daily_cap` per player per UTC day (a
reward over the cap is paid up to it, `paid` may be 0). One payment per
`key` however often it is sent. `404 player_not_found`.

### `POST /api/internal/v1/blueprints`
`{ "key", "creator", "world", "name", "size": [x,y,z], "palette": [{ "block": key | null, "raw" }], "runs": [[index, count]], "materials": { item: count } }`
(runs walk the box x-major, then y, then z), optionally `"replaces": "<design id>"` for the creator's
next revision → `201`/`200 { "blueprint": { "id", "blocks", "revision" }, "replayed" }`;
`422 bad_blueprint`, `503 storage_unavailable`.

### `GET /api/internal/v1/blueprints/{id}?player=<public id>`
`{ "id", "name", "materials", "layout" }` for the creator or a licence
holder (`403 not_licensed`, also after moderation); `503
storage_unavailable` if the stored layout no longer matches its hash.

### `POST /api/internal/v1/contracts/{id}/fulfil`
`{ "key": outbox id, "contractor", "item", "count", "durability"? }`: the
contractor's goods arrived; releases the reward and delivers the goods to
the poster, once per key. `403 not_contractor`, `409 contract_closed`,
`422 wrong_goods` (exactly the item and count asked).

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
