#!/bin/sh
# Put a world backup back: restore-worlds.sh <archive> <worlds dir>.
# Stop the game server first. What is there now is moved aside to
# <worlds dir>.before-<time>, never deleted.
set -eu

archive=${1:?archive}
target=${2:?worlds dir}
[ -f "$archive" ] || { echo "no archive $archive" >&2; exit 1; }
tar -tzf "$archive" >/dev/null || { echo "$archive is not a readable archive" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tar -C "$work" -xzf "$archive"
[ -d "$work/worlds" ] || { echo "$archive holds no worlds/ directory" >&2; exit 1; }

if [ -e "$target" ]; then
  aside="$target.before-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$target" "$aside"
  echo "current worlds moved to $aside"
fi
mv "$work/worlds" "$target"
echo "restored $archive into $target"
