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
];
