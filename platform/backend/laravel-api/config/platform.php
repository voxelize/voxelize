<?php

/*
 * Platform settings shared by the API and the game servers. Secrets come
 * from the environment only; see .env.example and docs/SECURITY.md.
 */

$ticketSecrets = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('GAME_TICKET_SECRETS', ''))
)));

return [
    'game' => [
        // Newest first. The first secret signs; game servers accept all, so
        // keys rotate by prepending a new one and later dropping the old.
        'ticket_secrets' => $ticketSecrets,
        'ticket_issuer' => 'platform-api',
        'ticket_audience' => 'game',
        // Tickets are single-use and only need to survive the WebSocket
        // handshake, so they live for minutes, not hours.
        'ticket_ttl_seconds' => (int) env('GAME_TICKET_TTL', 120),

        // Worlds the API issues tickets for. The realm is decided here, by
        // the server, never by the client asking for a ticket.
        'worlds' => [
            'main' => [
                'realm' => 'survival',
                'url' => env('GAME_SERVER_PUBLIC_URL', 'ws://localhost:4000/ws/'),
            ],
        ],
    ],

    'economy' => [
        // Soft currency of survival worlds.
        'soft_currency' => 'CRN',
    ],

    'land' => [
        // Claims are paid for in the soft currency; the price goes to the
        // burn sink (docs/ECONOMY_LEDGER.md), so land is a money sink.
        'currency' => 'CRN',
        'price_per_chunk' => (int) env('LAND_PRICE_PER_CHUNK', 50),
        // A claim is at most this many chunks along each side...
        'max_side_chunks' => (int) env('LAND_MAX_SIDE_CHUNKS', 8),
        // ...and a player holds at most this many chunks in total.
        'max_chunks_per_player' => (int) env('LAND_MAX_CHUNKS_PER_PLAYER', 64),
        'dimensions' => ['overworld', 'underworld', 'sky'],
        // Highest asking price for a land on sale.
        'max_sale_price' => (int) env('LAND_MAX_SALE_PRICE', 10_000_000),
    ],

    'market' => [
        'currency' => 'CRN',
        // Platform fee on every sale, in basis points of the price, to the
        // system:fees account.
        'fee_bps' => (int) env('MARKET_FEE_BPS', 500),
        // A new bid beats the current one by at least this share (and 1).
        'min_increment_bps' => 500,
        'max_price' => 1_000_000_000,
        'min_hours' => 1,
        'max_hours' => 168,
        'default_hours' => 48,
    ],

    'guilds' => [
        // Founding a guild costs this much (to the burn sink).
        'creation_fee' => (int) env('GUILD_CREATION_FEE', 100),
        'max_members' => 50,
        // Land a guild may hold in total, in chunks.
        'max_chunks' => 256,
        // Touching guild lands form a settlement; its level needs this much
        // land (chunks) and this many guild members. Levels in order.
        'settlements' => [
            'village' => ['chunks' => 4, 'members' => 1],
            'town' => ['chunks' => 16, 'members' => 3],
            'city' => ['chunks' => 64, 'members' => 8],
        ],
        // A guild's best settlement raises its member limit.
        'member_limits' => ['none' => 50, 'village' => 50, 'town' => 75, 'city' => 100],
        // Guild chat: longest message, messages a member may send a minute.
        'chat_max_length' => 300,
        'chat_per_minute' => 20,
        // Sales tax a guild may levy on stalls on its land, in basis points.
        'max_tax_bps' => 2000,
        // Custom ranks a guild may define.
        'max_ranks' => 10,
        'war' => [
            // Paid from the declaring guild's treasury to the burn sink.
            'declaration_fee' => (int) env('GUILD_WAR_FEE', 200),
            // Minutes between declaring and fighting, so the other side can prepare.
            'warmup_minutes' => (int) env('GUILD_WAR_WARMUP_MINUTES', 10),
            // A war ends by itself after this many days.
            'max_days' => 7,
            // A captured land counts this much in the war's score (a kill counts 1).
            'capture_points' => 3,
        ],
    ],

    'blueprints' => [
        // Where blueprint layouts are kept: `s3` (MinIO in the stack) or `local`.
        'disk' => env('BLUEPRINT_DISK', 'local'),
        // Largest blueprint along each axis, in blocks.
        'max_side' => 32,
        'max_price' => 1_000_000_000,
        // Publishing, and new revisions of published designs, wait for a
        // moderator's approval.
        'review_required' => (bool) env('BLUEPRINT_REVIEW_REQUIRED', true),
    ],

    // Crowns paid for jobs and quests (minted by game servers), capped per
    // player per day.
    'rewards' => [
        'currency' => 'CRN',
        'daily_cap' => (int) env('REWARDS_DAILY_CAP', 300),
    ],

    // Cosmetics: bought once with Crowns (burned), then worn. Outfits colour
    // the body, arms and legs; hats are a picture the client draws (`art`)
    // or a band of colour. Game servers check the shape of what is worn.
    'cosmetics' => [
        'currency' => 'CRN',
        'catalog' => [
            'outfit_ranger' => ['name' => 'Ranger outfit', 'slot' => 'outfit', 'price' => 40, 'look' => ['body' => '#3d6b35', 'arms' => '#2f5229', 'legs' => '#5b4630']],
            'outfit_miner' => ['name' => 'Miner overalls', 'slot' => 'outfit', 'price' => 40, 'look' => ['body' => '#c47f17', 'arms' => '#7a7a7a', 'legs' => '#2d4a7a']],
            'outfit_frost' => ['name' => 'Frost robe', 'slot' => 'outfit', 'price' => 80, 'look' => ['body' => '#dff3ff', 'arms' => '#a7d8f0', 'legs' => '#6aa9d8']],
            'outfit_royal' => ['name' => 'Royal robe', 'slot' => 'outfit', 'price' => 150, 'look' => ['body' => '#5a2a82', 'arms' => '#7b3fb0', 'legs' => '#2b1240']],
            'hat_red_cap' => ['name' => 'Red cap', 'slot' => 'hat', 'price' => 25, 'look' => ['color' => '#c0392b']],
            'hat_straw' => ['name' => 'Straw hat', 'slot' => 'hat', 'price' => 30, 'look' => ['color' => '#e3c16f']],
            'hat_crown' => ['name' => 'Crown', 'slot' => 'hat', 'price' => 250, 'look' => ['art' => 'crown']],
        ],
    ],

    // Friends: how many, and how long after a game server last reported a
    // player they still count as online.
    'friends' => [
        'limit' => (int) env('FRIENDS_LIMIT', 200),
        'online_seconds' => (int) env('FRIENDS_ONLINE_SECONDS', 90),
    ],

    // Calls from game servers to /api/internal/*: a shared bearer token on
    // the private network only (nginx refuses that path publicly).
    'internal' => [
        'service_token' => (string) env('GAME_SERVICE_TOKEN', ''),
    ],
];
