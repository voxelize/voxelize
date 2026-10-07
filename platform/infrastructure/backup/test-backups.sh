#!/bin/sh
# Checks backup-worlds.sh and restore-worlds.sh on a scratch world: a full
# archive first, then incrementals holding only what changed; no
# temporaries archived; restoring an incremental rebuilds the world exactly
# as it was then (deleted files gone, older states not leaking); old chains
# are pruned whole; what was there before a restore is kept aside.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
backup() { WORLDS_DIR="$t/worlds" BACKUP_DIR="$t/out" BACKUP_KEEP=2 FULL_EVERY=2 sh "$here/backup-worlds.sh" >/dev/null; sleep 1; }
newest() { ls -1 "$t/out"/worlds-*.tar.gz | LC_ALL=C sort | tail -n 1; }

mkdir -p "$t/worlds/main/chunks" "$t/worlds/main/players"
echo '{"id":"0|0"}' > "$t/worlds/main/chunks/0_0.json"
echo '{"id":"1|0"}' > "$t/worlds/main/chunks/1_0.json"
echo '{"id":"pl_1"}' > "$t/worlds/main/players/pl_1.json"
echo '{"version":1,"items":[]}' > "$t/worlds/main/drops.json"
echo 'torn' > "$t/worlds/main/containers.json.tmp"

backup
full=$(newest)
case "$full" in *-full.tar.gz) ;; *) fail "the first backup is not full: $full" ;; esac
tar -tzf "$full" | grep -q 'worlds/main/players/pl_1.json' || fail "player missing from the full backup"
tar -tzf "$full" | grep -q '\.tmp$' && fail "temporary file archived"

# One chunk changes, one player joins, one chunk is deleted.
echo '{"id":"0|0","edited":true}' > "$t/worlds/main/chunks/0_0.json"
echo '{"id":"pl_2"}' > "$t/worlds/main/players/pl_2.json"
rm "$t/worlds/main/chunks/1_0.json"
backup
inc1=$(newest)
case "$inc1" in *-inc.tar.gz) ;; *) fail "the second backup is not incremental: $inc1" ;; esac
files=$(tar -tzf "$inc1" | grep '^worlds/.*\.json$' | LC_ALL=C sort | tr '\n' ' ')
[ "$files" = "worlds/main/chunks/0_0.json worlds/main/players/pl_2.json " ] || fail "the incremental holds [$files], wanted only the changed files"

echo '{"id":"pl_1","level":2}' > "$t/worlds/main/players/pl_1.json"
backup
inc2=$(newest)

# Restore the first incremental: the world as it was then.
echo 'later' > "$t/worlds/main/players/pl_3.json"
sh "$here/restore-worlds.sh" "$inc1" "$t/worlds" >/dev/null
grep -q edited "$t/worlds/main/chunks/0_0.json" || fail "the changed chunk is not restored"
[ -f "$t/worlds/main/players/pl_2.json" ] || fail "the new player is not restored"
[ -f "$t/worlds/main/chunks/1_0.json" ] && fail "a deleted chunk came back"
grep -q level "$t/worlds/main/players/pl_1.json" && fail "a later change leaked into an earlier restore"
[ -f "$t/worlds/main/players/pl_3.json" ] && fail "a file newer than the backup survived"
ls -d "$t"/worlds.before-* >/dev/null 2>&1 || fail "the old worlds were not kept aside"
grep -q later "$t"/worlds.before-*/main/players/pl_3.json || fail "the kept copy is wrong"

# The latest one, built on two incrementals.
sh "$here/restore-worlds.sh" "$inc2" "$t/worlds" >/dev/null
grep -q level "$t/worlds/main/players/pl_1.json" || fail "the latest restore misses the last change"

# A missing link is refused, not half restored.
mv "$inc1" "$t/inc1.aside"
sh "$here/restore-worlds.sh" "$inc2" "$t/worlds" >/dev/null 2>&1 && fail "restored with a missing link"
mv "$t/inc1.aside" "$inc1"

# FULL_EVERY=2: the fourth backup starts a new chain; with BACKUP_KEEP=2
# the third chain removes the whole first one.
for i in 4 5 6 7; do echo "{\"tick\":$i}" > "$t/worlds/main/drops.json"; backup; done
fulls=$(ls "$t/out"/worlds-*-full.tar.gz | wc -l)
[ "$fulls" -eq 2 ] || fail "kept $fulls chains, wanted 2"
[ -f "$full" ] && fail "the oldest chain was not pruned"
first=$(ls -1 "$t/out"/worlds-*.tar.gz | LC_ALL=C sort | head -n 1)
case "$first" in *-full.tar.gz) ;; *) fail "an incremental was left without its full archive" ;; esac
sh "$here/restore-worlds.sh" "$(newest)" "$t/worlds" >/dev/null
grep -q '"tick":7' "$t/worlds/main/drops.json" || fail "the newest restore is wrong"
echo "backups: all checks passed"
