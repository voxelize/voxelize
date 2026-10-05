#!/bin/sh
# Put a world backup back: restore-worlds.sh <archive> <worlds dir>.
# Stop the game server first. An incremental archive is restored with the
# chain it builds on (found next to it): the full archive, then each
# incremental in order, and files the chosen backup did not have are
# dropped. What is there now is moved aside to <worlds dir>.before-<time>,
# never deleted.
set -eu

archive=${1:?archive}
target=${2:?worlds dir}
[ -f "$archive" ] || { echo "no archive $archive" >&2; exit 1; }
dir=$(dirname "$archive")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The chain, newest first, back to a full archive.
chain=""
at=$archive
while :; do
  tar -tzf "$at" >/dev/null || { echo "$at is not a readable archive" >&2; exit 1; }
  chain="$at $chain"
  base=$(tar -xzOf "$at" ./.backup/base 2>/dev/null || tar -xzOf "$at" .backup/base 2>/dev/null || true)
  [ -n "$base" ] || break
  at="$dir/$base"
  [ -f "$at" ] || { echo "$archive builds on $base, which is missing" >&2; exit 1; }
done

mkdir -p "$work/out"
for a in $chain; do
  tar -C "$work/out" -xzf "$a"
done
[ -d "$work/out/worlds" ] || { echo "$archive holds no worlds/ directory" >&2; exit 1; }
# Drop what the chosen backup did not have (deleted between backups).
if [ -f "$work/out/.backup/manifest" ]; then
  cut -c67- "$work/out/.backup/manifest" | LC_ALL=C sort > "$work/wanted"
  (cd "$work/out" && find worlds -type f | LC_ALL=C sort) | comm -23 - "$work/wanted" | while read -r f; do
    rm -f "$work/out/$f"
  done
  # Every file is the one backed up.
  (cd "$work/out" && sha256sum -c .backup/manifest >/dev/null) || { echo "restored files do not match the backup's manifest" >&2; exit 1; }
fi

if [ -e "$target" ]; then
  aside="$target.before-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$target" "$aside"
  echo "current worlds moved to $aside"
fi
mv "$work/out/worlds" "$target"
echo "restored $archive ($(echo $chain | wc -w) archive(s)) into $target"
