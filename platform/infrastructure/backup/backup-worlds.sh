#!/bin/sh
# World backup, incremental: every world's saves (chunks, players,
# containers, items, animals, plugin stores) into $BACKUP_DIR.
#
# - A full archive (`worlds-<time>-full.tar.gz`) holds every file.
# - An incremental one (`worlds-<time>-inc.tar.gz`) holds only the files
#   whose content changed since the previous backup, plus the full list of
#   files and their SHA-256 (`.backup/manifest`) and the archive it builds
#   on (`.backup/base`), so a restore also drops files deleted since.
# A full one is written when there is none yet, after $FULL_EVERY (24)
# incrementals, or with BACKUP_FULL=1. The newest $BACKUP_KEEP (7) chains
# (a full and its incrementals) are kept; older chains go together, so a
# kept archive never loses what it builds on. With $S3_ALIAS set (an `mc`
# alias, e.g. to the MinIO `platform-backups` bucket, which keeps versions)
# each archive is uploaded too.
#
# Every save file is written to a temporary name and renamed, so copying a
# running world never catches a torn file; files are copied first and then
# hashed and archived, so each file is one point in time.
#
#   docker compose run --rm --user root \
#     -v "$PWD/infrastructure/backup:/backup" -v platform_world-data:/srv/worlds:ro \
#     -e BACKUP_DIR=/backup/out --entrypoint sh migrate /backup/backup-worlds.sh
#
# Restore: stop the game server, then
#   sh restore-worlds.sh <archive> <worlds dir>
set -eu

: "${WORLDS_DIR:=/srv/worlds}"
: "${BACKUP_DIR:=/backup/out}"
: "${BACKUP_KEEP:=7}"
: "${FULL_EVERY:=24}"
: "${BACKUP_FULL:=0}"

[ -d "$WORLDS_DIR" ] || { echo "no worlds at $WORLDS_DIR" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Copy, skipping half-written temporaries, then hash the copy.
cp -a "$WORLDS_DIR" "$work/worlds"
find "$work/worlds" -name '*.tmp' -delete
(cd "$work" && find worlds -type f | LC_ALL=C sort | while read -r f; do
  printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"
done) > "$work/manifest"

# The archive to build on: the newest one, while its chain is short enough.
last=$(ls -1 "$BACKUP_DIR"/worlds-*.tar.gz 2>/dev/null | LC_ALL=C sort | tail -n 1 || true)
incs=0
if [ -n "$last" ]; then
  incs=$(ls -1 "$BACKUP_DIR"/worlds-*.tar.gz | LC_ALL=C sort | awk '/-full\.tar\.gz$|\/worlds-[0-9TZ]*\.tar\.gz$/ { n = 0; next } { n++ } END { print n + 0 }')
fi
kind=inc
if [ "$BACKUP_FULL" = 1 ] || [ -z "$last" ] || [ "$incs" -ge "$FULL_EVERY" ] || [ ! -f "$BACKUP_DIR/.manifest" ] \
  || [ "$(cat "$BACKUP_DIR/.manifest-of" 2>/dev/null)" != "$(basename "$last")" ]; then
  kind=full
fi

mkdir -p "$work/stage/.backup"
cp "$work/manifest" "$work/stage/.backup/manifest"
if [ "$kind" = full ]; then
  cp -a "$work/worlds" "$work/stage/worlds"
  changed=$(wc -l < "$work/manifest")
else
  basename "$last" > "$work/stage/.backup/base"
  # Lines (hash and path) not in the previous manifest: new or changed files.
  LC_ALL=C sort "$BACKUP_DIR/.manifest" > "$work/before"
  LC_ALL=C sort "$work/manifest" | comm -13 "$work/before" - | cut -c67- > "$work/changed"
  changed=$(wc -l < "$work/changed")
  mkdir -p "$work/stage/worlds"
  while read -r f; do
    mkdir -p "$work/stage/$(dirname "$f")"
    cp -a "$work/$f" "$work/stage/$f"
  done < "$work/changed"
fi
out="$BACKUP_DIR/worlds-$stamp-$kind.tar.gz"
tar -C "$work/stage" -czf "$out.tmp" .backup worlds
mv "$out.tmp" "$out"
cp "$work/manifest" "$BACKUP_DIR/.manifest"
basename "$out" > "$BACKUP_DIR/.manifest-of"
echo "backup written: $out ($kind, $changed file(s), $(du -k "$out" | cut -f1) KiB)"

if [ -n "${S3_ALIAS:-}" ]; then
  mc cp "$out" "$S3_ALIAS/worlds/$(basename "$out")"
  echo "uploaded to $S3_ALIAS/worlds/"
fi

# Keep the newest $BACKUP_KEEP chains: drop every archive older than the
# $BACKUP_KEEP-th newest full one.
oldest_kept=$(ls -1 "$BACKUP_DIR"/worlds-*.tar.gz | LC_ALL=C sort -r \
  | grep -E -- '-full\.tar\.gz$|/worlds-[0-9TZ]+\.tar\.gz$' | sed -n "${BACKUP_KEEP}p" || true)
if [ -n "$oldest_kept" ]; then
  ls -1 "$BACKUP_DIR"/worlds-*.tar.gz | LC_ALL=C sort | while read -r old; do
    [ "$old" = "$oldest_kept" ] && break
    rm -f "$old"
    echo "removed old backup: $old"
  done
fi
