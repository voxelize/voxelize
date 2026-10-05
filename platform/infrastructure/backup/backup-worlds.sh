#!/bin/sh
# World backup: every world's saves (chunks, players, containers, items,
# animals, plugin stores) as one compressed archive in $BACKUP_DIR, the
# newest $BACKUP_KEEP kept. With $S3_ALIAS set (an `mc` alias, e.g. to the
# MinIO `platform-backups` bucket, which keeps versions) it is uploaded too.
#
# Every save file is written to a temporary name and renamed, so copying a
# running world never catches a torn file; files are copied first and then
# archived, so the archive is one point in time per file.
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
: "${BACKUP_KEEP:=14}"

[ -d "$WORLDS_DIR" ] || { echo "no worlds at $WORLDS_DIR" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/worlds-$stamp.tar.gz"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Copy, skipping half-written temporaries, then archive the copy.
cp -a "$WORLDS_DIR" "$work/worlds"
find "$work/worlds" -name '*.tmp' -delete
tar -C "$work" -czf "$out.tmp" worlds
mv "$out.tmp" "$out"
echo "backup written: $out ($(du -k "$out" | cut -f1) KiB)"

if [ -n "${S3_ALIAS:-}" ]; then
  mc cp "$out" "$S3_ALIAS/worlds/$(basename "$out")"
  echo "uploaded to $S3_ALIAS/worlds/"
fi

# Keep the newest $BACKUP_KEEP archives.
ls -1t "$BACKUP_DIR"/worlds-*.tar.gz 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f "$old"
  echo "removed old backup: $old"
done
