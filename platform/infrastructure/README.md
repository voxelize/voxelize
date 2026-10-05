# Infrastructure

Development stack defined in `platform/docker-compose.yml`.

| Service | Image | Role | Exposed |
| --- | --- | --- | --- |
| `nginx` | nginx 1.27 | edge router: `/api/` → API, `/ws/` → game server | `:8080` |
| `api` | `platform-api` (php-fpm 8.3) | Laravel API, runtime DB user with restricted grants | internal |
| `scheduler` | `platform-api` | `schedule:work` (hourly `ledger:verify`) | internal |
| `migrate` | `platform-api` | one-shot: migrations as `platform_migrator`, then `mysql/apply-grants.sh` | — |
| `game-server` | `platform-game-server` | world `main`, persistent volume `world-data` | internal |
| `mysql` | mysql 8.4 | source of truth; binlog kept 7 days for point-in-time recovery | `127.0.0.1:3306` |
| `redis` | redis 7 | cache, sessions, queues, rate limits (AOF on) | internal |
| `minio` + `minio-init` | MinIO | object storage: `platform` and versioned `platform-backups` buckets | console `127.0.0.1:9001` |

## Start

```sh
cd platform
cp .env.example .env    # fill every empty value: openssl rand -hex 32
docker compose up --build
curl localhost:8080/api/v1/auth/register -H 'content-type: application/json' \
  -d '{"username":"first_player","email":"me@example.com","password":"a long password"}'
```

## Database users

The game servers keep player records in MySQL (`GAME_DATABASE_URL`) with
their own account, `platform_game` (`GAME_DB_PASSWORD` in `.env`), which
`apply-grants.sh` limits to SELECT, INSERT and UPDATE on `player_states`.
The game server starts after the migrations and refuses to run without
that table.

| User | Privileges | Used by |
| --- | --- | --- |
| `root` | all | `apply-grants.sh`, backups |
| `platform_migrator` | all on `platform`, `platform_test` | `migrate` |
| `platform` | `SELECT, INSERT, UPDATE, DELETE` per table, but only `SELECT, INSERT` on `ledger_entries`, `ledger_transactions`, `audit_logs`, `game_tickets` | `api`, `scheduler` |
| `platform_game` | SELECT, INSERT, UPDATE on `player_states` | game servers (player records) |

`apply-grants.sh` runs after every migration so new tables get grants too.

## Backups

- `backup/backup.sh`: consistent `mysqldump --single-transaction` with the
  binlog position recorded, for point-in-time recovery by replaying binlogs.
- `backup/backup-worlds.sh`: incremental world backups. The first archive
  (and every `FULL_EVERY`-th, 24 by default, or with `BACKUP_FULL=1`) holds
  every save (chunks, players, containers, lying items, animals, plugin
  stores); the others hold only the files whose content changed, with a
  manifest of every file's SHA-256 and the archive they build on. The
  newest `BACKUP_KEEP` (7) chains are kept, a chain always whole; archives
  are uploaded to an `mc` alias when `S3_ALIAS` is set (the MinIO
  `platform-backups` bucket keeps versions). Save files are renamed into
  place, so copying a running world never catches a torn file. Run it
  hourly, for example:

  ```sh
  docker compose run --rm --user root \
    -v "$PWD/infrastructure/backup:/backup" -v platform_world-data:/srv/worlds:ro \
    -e BACKUP_DIR=/backup/out --entrypoint sh migrate /backup/backup-worlds.sh
  ```
- `backup/restore-worlds.sh <archive> <worlds dir>`: with the game server
  stopped, puts any backup back — an incremental one with the full archive
  and incrementals before it, dropping files deleted since and checking
  every file against the manifest — and moves what was there aside
  (`<dir>.before-<time>`), never deleting it. A chain with a missing link
  is refused.
- `backup/test-backups.sh` checks both (CI runs it).

## Building images behind a TLS-intercepting proxy

Image builds download crates, Composer packages and Debian packages. On a
network whose proxy re-signs TLS, add the proxy CA to the build stages (or
use a local registry mirror); the Dockerfiles themselves assume a normal
network.

## Player worlds

Worlds players create (docs/API.md, "Worlds") each run on a game server of
their own, behind one gateway:

- `worlds/host-worlds.sh` (every minute: cron, a loop or a timer) reads
  `GET /api/internal/v1/worlds` and keeps a container `world-<id>` per
  active world `w_<id>` — the game server image with `GAME_WORLD_NAME` set,
  its own volume `world-<id>-data`, the same ticket secrets and backend
  token — on the compose network; archived worlds' containers are stopped
  (they save first) and removed, their volumes kept.
- `nginx/worlds.conf` routes `w-<id>.<domain>` to `world-<id>:4000` (only
  `/ws/` and `/health`), looking names up through Docker's DNS.
- Set the API's `WORLDS_URL_TEMPLATE=wss://w-{id}.<domain>/ws/` and a
  wildcard DNS record and certificate for `*.<domain>`.
- `worlds/test-host-worlds.sh` checks the host script against a fake feed
  and a fake Docker (CI runs it).

## Mail

Password resets and email confirmation send mail through `MAIL_*` in `.env`
(SMTP by default). For local work start Mailpit and read the mail at
http://127.0.0.1:8025:

```sh
docker compose --profile mail up -d
```

Set `PLATFORM_CLIENT_URL` to the address players open (links in the mail
point there) and `AUTH_REQUIRE_VERIFIED_EMAIL=true` to keep unconfirmed
accounts out of the game.

## Voice relay

Most players connect voice directly; players behind strict NATs need a
relay. Set in `.env` a `TURN_SECRET` (32+ characters), `TURN_EXTERNAL_IP`
(the host's public address) and `GAME_TURN_URLS`
(`turn:<host>:3478?transport=udp,turn:<host>:3478?transport=tcp`), open
3478 (UDP and TCP) and 49160–49200/UDP in the firewall, then:

```sh
docker compose --profile voice up -d
```

## Metrics and dashboards

```sh
mkdir -p infrastructure/observability/secrets
printf %s "$GAME_METRICS_TOKEN" > infrastructure/observability/secrets/metrics_token
printf %s "$GAME_SERVICE_TOKEN" > infrastructure/observability/secrets/service_token
docker compose --profile observability up -d
```

Prometheus scrapes the game server (`/platform/metrics`) and the backend
(`/api/internal/v1/metrics`) every 15 s and evaluates `alerts.yml` (slow
ticks, a world that stopped reporting, a plugin switched off, a burst of
refused intents). Grafana (http://127.0.0.1:3001, bound to localhost)
opens with the "Platform" dashboard. Neither metrics path is routed by the
public listener.

## Production notes

- Terminate TLS at Nginx (or a load balancer) and serve `wss://`.
- Set `APP_ENV=production`, `APP_DEBUG=false`, and real secrets from a secret
  manager, never from a committed file.
- Do not publish MySQL, Redis or MinIO ports.
- Monitoring: see "Metrics and dashboards" above; add an Alertmanager
  route for the rules in `observability/alerts.yml`.
