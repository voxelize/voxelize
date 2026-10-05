#!/bin/sh
# Checks backup-worlds.sh and restore-worlds.sh on a scratch world:
# the archive holds every save file but no temporaries, old archives are
# pruned, and a restore brings the files back and keeps what was there.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/worlds/main/chunks" "$t/worlds/main/players"
echo '{"id":"0|0"}' > "$t/worlds/main/chunks/0_0.json"
echo '{"id":"pl_1"}' > "$t/worlds/main/players/pl_1.json"
echo '{"version":1,"items":[]}' > "$t/worlds/main/drops.json"
echo 'torn' > "$t/worlds/main/containers.json.tmp"

for i in 1 2 3; do
  WORLDS_DIR="$t/worlds" BACKUP_DIR="$t/out" BACKUP_KEEP=2 sh "$here/backup-worlds.sh" >/dev/null
  sleep 1
done
count=$(ls "$t/out"/worlds-*.tar.gz | wc -l)
[ "$count" -eq 2 ] || { echo "FAIL: kept $count archives, wanted 2"; exit 1; }
latest=$(ls -1t "$t/out"/worlds-*.tar.gz | head -1)
tar -tzf "$latest" | grep -q 'worlds/main/players/pl_1.json' || { echo "FAIL: player missing"; exit 1; }
if tar -tzf "$latest" | grep -q '\.tmp$'; then echo "FAIL: temporary file archived"; exit 1; fi

echo '{"id":"pl_1","changed":true}' > "$t/worlds/main/players/pl_1.json"
sh "$here/restore-worlds.sh" "$latest" "$t/worlds" >/dev/null
grep -q changed "$t/worlds/main/players/pl_1.json" && { echo "FAIL: not restored"; exit 1; }
ls -d "$t"/worlds.before-* >/dev/null 2>&1 || { echo "FAIL: the old worlds were not kept aside"; exit 1; }
grep -q changed "$t"/worlds.before-*/main/players/pl_1.json || { echo "FAIL: the kept copy is wrong"; exit 1; }
echo "backups: all checks passed"
