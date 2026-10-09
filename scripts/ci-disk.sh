#!/usr/bin/env bash
# Disk numbers for CI: free space on the filesystem the workspace lives on,
# and the size of the directories a job fills. A job that runs out of disk
# fails at link time with an lld "signal 7 [Bus error]" (its mmap'd output
# cannot grow) and no word about disk; these lines put numbers beside it.
#
#   scripts/ci-disk.sh report <label> [dir...]   one report, df -h included
#   scripts/ci-disk.sh watch <seconds> [dir...]  one line every N seconds, for
#                                                running in the background
set -u

mode=${1:?usage: ci-disk.sh report <label> [dir...] | watch <seconds> [dir...]}
shift

sizes() {
  for dir in "$@"; do
    if [ -e "$dir" ]; then
      printf ' %s=%sM' "$dir" "$(du -sm "$dir" 2>/dev/null | cut -f1)"
    fi
  done
}

free_mb() {
  df -BM --output=avail . | tail -1 | tr -d ' M'
}

case "$mode" in
  report)
    label=${1:?report needs a label}
    shift
    echo "[disk] $label: $(free_mb)M free$(sizes "$@")"
    echo "[disk] runner: $(nproc) cores, $(free -g | awk '/^Mem:/ {print $2}') GB RAM"
    df -h . /mnt 2>/dev/null | awk '!seen[$0]++'
    ;;
  watch)
    every=${1:?watch needs an interval in seconds}
    shift
    lowest=
    while true; do
      free=$(free_mb)
      if [ -z "$lowest" ] || [ "$free" -lt "$lowest" ]; then lowest=$free; fi
      echo "[disk] $(date -u +%H:%M:%S) ${free}M free (lowest ${lowest}M)$(sizes "$@")"
      sleep "$every"
    done
    ;;
  *)
    echo "ci-disk.sh: unknown mode $mode" >&2
    exit 2
    ;;
esac
