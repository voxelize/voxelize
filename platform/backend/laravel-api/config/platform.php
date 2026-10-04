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
    ],

    'blueprints' => [
        // Where blueprint layouts are kept: `s3` (MinIO in the stack) or `local`.
        'disk' => env('BLUEPRINT_DISK', 'local'),
        // Largest blueprint along each axis, in blocks.
        'max_side' => 32,
        'max_price' => 1_000_000_000,
    ],

    // Calls from game servers to /api/internal/*: a shared bearer token on
    // the private network only (nginx refuses that path publicly).
    'internal' => [
        'service_token' => (string) env('GAME_SERVICE_TOKEN', ''),
    ],
];
