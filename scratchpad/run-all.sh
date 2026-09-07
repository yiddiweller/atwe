#!/bin/bash
# Run the probes that sit NEXT TO THIS SCRIPT. This used to be a hardcoded path into a
# session scratchpad in /tmp — so `bash scratchpad/run-all.sh` in the repo silently ran a
# stale copy of every probe, and edits made here were never executed. That is the exact
# mistake the README above this directory was written to stop.
cd "$(dirname "$0")" || exit 1

# Seventeen probes need a bearer token and used to print "export TOK first" and be
# SKIPPED by this runner — so a full regression silently covered 68 probes, not 85,
# and every Beam/composer/boot check among them never ran. Pick it up from the file
# the session writes it to; a probe still skips cleanly if it isn't there.
[ -z "$TOK" ] && [ -f /tmp/tok.txt ] && export TOK="$(cat /tmp/tok.txt)"
[ -z "$JWT_SECRET" ] && export JWT_SECRET=scoresecret
[ -z "$DATABASE_URL" ] && export DATABASE_URL=postgres://atwe:atwe@localhost:5432/atwescore
for f in profilemenu buttons rowsize notifscroll demomedia gutters sethandoff concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep deskcols authpane chatscroll voicenote chathead fixtext lastseen chatedge acctswitch pwsave navnotif smooth attach sendundo openbottom layouts navtap apperrors emptystates bootspeed storagesign feedskel cluster profcard; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  timeout 600 node "$f.js" 2>&1 | tail -3   # totals only; run a probe directly for its full output
done
echo "== ALLDONE =="
