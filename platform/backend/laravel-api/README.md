# Platform API (Laravel)

The business backend of the platform: accounts (sign-up, email
confirmation, password reset, data export, deletion), game tickets, the
in-game economy ledger, marketplace and auctions, contracts, land, guilds
and wars, blueprints, worlds, friends, cosmetics, player reports,
moderation and administration. It never runs the game loop — that is the Rust
game server in `platform/servers/game-server`.

Architecture, data model and security rules: `platform/docs/`.

## Run locally

```sh
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate
php artisan serve
```

Or start the whole stack with Docker: `platform/infrastructure/README.md`.

## Tests

```sh
php artisan test                          # SQLite in memory
DB_CONNECTION=mysql DB_HOST=127.0.0.1 DB_PORT=3306 \
  DB_DATABASE=platform_test DB_USERNAME=root DB_PASSWORD=root \
  php vendor/bin/phpunit                  # MySQL 8, includes the concurrency suite
```

## Implemented

| Area | Where |
| --- | --- |
| Register / login / logout / me (Sanctum tokens) | `app/Http/Controllers/Api/V1/AuthController.php` |
| Game tickets (`POST /api/v1/game/tickets`) | `app/Services/Game/TicketIssuer.php` |
| Double-entry ledger, wallets, transfers, mint/burn | `app/Services/Economy/LedgerService.php` |
| Audit log for sensitive actions | `app/Services/Audit/AuditLogger.php` |
| `php artisan ledger:verify` | ledger invariant check, exits non-zero on any violation |
| `php artisan economy:grant` | the only administrative way to create money; always audited |
