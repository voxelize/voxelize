#!/bin/sh
# Keeps one game server container per active player-made world, and none
# for archived ones. Run it every minute (cron, a loop, a systemd timer).
#
# Reads the backend's GET /api/internal/v1/worlds and, for each world
# `w_<id>`, runs a container `world-<id>` (label platform.world=<key>) from
# $IMAGE on $NETWORK with its own volume `world-<id>-data`, so the gateway
# (infrastructure/nginx/worlds.conf) can reach it. Containers whose world
# is gone are stopped with SIGTERM (the server saves first) and removed;
# their volumes are kept.
#
#   API_INTERNAL=http://nginx:8081/api/internal/v1 GAME_SERVICE_TOKEN=... \
#   GAME_TICKET_SECRETS=... GAME_TRANSPORT_SECRET=... \
#   IMAGE=platform-game-server:dev NETWORK=platform_default sh host-worlds.sh
set -eu

: "${API_INTERNAL:?API_INTERNAL}"
: "${GAME_SERVICE_TOKEN:?GAME_SERVICE_TOKEN}"
: "${GAME_TICKET_SECRETS:?GAME_TICKET_SECRETS}"
: "${GAME_TRANSPORT_SECRET:?GAME_TRANSPORT_SECRET}"
: "${IMAGE:=platform-game-server:dev}"
: "${NETWORK:=platform_default}"

feed=$(curl -fsS -H "Authorization: Bearer $GAME_SERVICE_TOKEN" -H "Accept: application/json" "$API_INTERNAL/worlds")
wanted=$(printf '%s' "$feed" | jq -r '.worlds[].key' | grep -E '^w_[a-z0-9]{10}$' || true)
running=$(docker ps -a --filter label=platform.world --format '{{.Label "platform.world"}}' | sort -u)

for key in $wanted; do
  id=${key#w_}
  if printf '%s\n' "$running" | grep -qx "$key"; then
    # Started before: make sure it is up (a crashed server comes back).
    docker start "world-$id" >/dev/null
    continue
  fi
  docker run -d --name "world-$id" --label "platform.world=$key" \
    --network "$NETWORK" --restart unless-stopped --stop-timeout 30 \
    -v "world-$id-data:/srv/worlds" \
    -e GAME_WORLD_NAME="$key" \
    -e GAME_TICKET_SECRETS="$GAME_TICKET_SECRETS" \
    -e GAME_TRANSPORT_SECRET="$GAME_TRANSPORT_SECRET" \
    -e GAME_BACKEND_URL="$API_INTERNAL" \
    -e GAME_SERVICE_TOKEN="$GAME_SERVICE_TOKEN" \
    -e GAME_METRICS_TOKEN="${GAME_METRICS_TOKEN:-}" \
    "$IMAGE" >/dev/null
  echo "started world-$id for $key"
done

for key in $running; do
  if ! printf '%s\n' "$wanted" | grep -qx "$key"; then
    id=${key#w_}
    docker stop "world-$id" >/dev/null
    docker rm "world-$id" >/dev/null
    echo "stopped world-$id ($key is archived); its volume world-$id-data is kept"
  fi
done
