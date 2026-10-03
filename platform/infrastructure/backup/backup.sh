#!/bin/sh
# Database snapshot: a consistent MySQL dump written to $BACKUP_DIR.
# Point-in-time recovery between snapshots replays the MySQL binary logs
# (kept 7 days, see docker-compose.yml) from the position recorded in the
# dump header. Incremental world backups to object storage arrive with
# region files (docs/CHUNK_FORMAT.md §8, phase 6).
#
#   docker compose run --rm --user root \
#     -v "$PWD/infrastructure/backup:/backup" -e BACKUP_DIR=/backup/out \
#     --entrypoint sh migrate /backup/backup.sh
set -eu

: "${BACKUP_DIR:=/backup/out}"
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$BACKUP_DIR/mysql-$DB_DATABASE-$stamp.sql.gz"

# --single-transaction: consistent InnoDB snapshot without blocking writers.
# --source-data=2: records the binlog position for point-in-time replay.
mysqldump -h"$DB_HOST" -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines --triggers --source-data=2 \
  "$DB_DATABASE" | gzip > "$out.tmp"
mv "$out.tmp" "$out"
echo "backup written: $out"
