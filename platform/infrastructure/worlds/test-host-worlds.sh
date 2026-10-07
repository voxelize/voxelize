#!/bin/sh
# Checks host-worlds.sh against a fake backend feed and a fake docker: new
# worlds get a container with the right name, label, network and settings;
# running ones are only started; archived ones are stopped and removed; a
# key that is not a world key is ignored.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir "$t/bin"
cat > "$t/bin/curl" <<'STUB'
#!/bin/sh
echo '{"worlds":[{"key":"w_aaaaaaaaaa"},{"key":"w_bbbbbbbbbb"},{"key":"bad key; rm -rf /"}]}'
STUB
cat > "$t/bin/docker" <<STUB
#!/bin/sh
echo "\$*" >> "$t/calls"
if [ "\$1" = ps ]; then printf 'w_bbbbbbbbbb\nw_cccccccccc\n'; fi
STUB
chmod +x "$t/bin/curl" "$t/bin/docker"
PATH="$t/bin:$PATH" API_INTERNAL=http://backend/api/internal/v1 GAME_SERVICE_TOKEN=tok \
  GAME_TICKET_SECRETS=sec GAME_TRANSPORT_SECRET=tr IMAGE=img NETWORK=net \
  sh "$here/host-worlds.sh" > "$t/out"

fail() { echo "FAIL: $1"; cat "$t/calls"; exit 1; }
grep -q '^run -d --name world-aaaaaaaaaa --label platform.world=w_aaaaaaaaaa --network net ' "$t/calls" || fail "new world not started"
grep '^run ' "$t/calls" | grep -q -- '-e GAME_WORLD_NAME=w_aaaaaaaaaa' || fail "world name not passed"
grep '^run ' "$t/calls" | grep -q -- '-v world-aaaaaaaaaa-data:/srv/worlds' || fail "no volume of its own"
[ "$(grep -c '^run ' "$t/calls")" -eq 1 ] || fail "only the new world is created"
grep -q '^start world-bbbbbbbbbb$' "$t/calls" || fail "a running world is kept up"
grep -q '^stop world-cccccccccc$' "$t/calls" || fail "an archived world is stopped"
grep -q '^rm world-cccccccccc$' "$t/calls" || fail "an archived world's container is removed"
if grep -q 'bad key' "$t/calls"; then fail "a bad key reached docker"; fi
echo "host-worlds: all checks passed"
