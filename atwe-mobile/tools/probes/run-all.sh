#!/bin/sh
# Every browser probe, in order. Needs PW and TOK exported, and the preview
# server running — see README.md. Fails loudly on the first broken one.
set -e
cd "$(dirname "$0")"
: "${TOK:?export TOK first (see README.md)}"
: "${PW:?export PW first (a dir containing node_modules/playwright-core)}"
fail=0
for p in retract gap statusclash drawer noplus menu2 glassbtn sheets; do
  printf '===== %s\n' "$p"
  node "$p.js" || fail=1
done
for theme in dark light; do
  printf '===== screens (%s)\n' "$theme"
  THEME="$theme" node sweep2.js || fail=1
done
[ "$fail" = 0 ] && echo "\nall probes passed" || { echo "\nSOMETHING FAILED"; exit 1; }
