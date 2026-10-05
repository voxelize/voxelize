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

| User | Privileges | Used by |
| --- | --- | --- |
| `root` | all | `apply-grants.sh`, backups |
| `platform_migrator` | all on `platform`, `platform_test` | `migrate` |
| `platform` | `SELECT, INSERT, UPDATE, DELETE` per table, but only `SELECT, INSERT` on `ledger_entries`, `ledger_transactions`, `audit_logs`, `game_tickets` | `api`, `scheduler` |

`apply-grants.sh` runs after every migration so new tables get grants too.

## Backups

- `backup/backup.sh`: consistent `mysqldump --single-transaction` with the
  binlog position recorded, for point-in-time recovery by replaying binlogs.
- World data lives in the `world-data` volume; chunk writes are atomic, so a
  filesystem snapshot of the volume is consistent per chunk. Incremental
  world backups to `platform-backups` arrive with region files (phase 6).

## Building images behind a TLS-intercepting proxy

Image builds download crates, Composer packages and Debian packages. On a
network whose proxy re-signs TLS, add the proxy CA to the build stages (or
use a local registry mirror); the Dockerfiles themselves assume a normal
network.

## Player worlds

Worlds players create (docs/API.md, "Worlds") each need a game server of
their own: the same image with `GAME_WORLD_NAME` set to the world's key,
its own save volume, and the same ticket secrets and backend token. Set
`WORLDS_URL_TEMPLATE` on the API (e.g. `wss://w-{world}.play.example/ws/`)
and route that host to the world's server. Whatever starts them (a
supervisor, an orchestrator) reads `GET /api/internal/v1/worlds` for the
active worlds and stops servers for archived ones. The browser counts a
world online while its server reports in.

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
