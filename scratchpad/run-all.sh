#!/bin/bash
# Run the probes that sit NEXT TO THIS SCRIPT. This used to be a hardcoded path into a
# session scratchpad in /tmp — so `bash scratchpad/run-all.sh` in the repo silently ran a
# stale copy of every probe, and edits made here were never executed. That is the exact
# mistake the README above this directory was written to stop.
cd "$(dirname "$0")" || exit 1
for f in profilemenu buttons rowsize notifscroll demomedia gutters sethandoff concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep deskcols authpane chatscroll voicenote chathead fixtext lastseen chatedge acctswitch pwsave navnotif; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  timeout 600 node "$f.js" 2>&1 | tail -3   # totals only; run a probe directly for its full output
done
echo "== ALLDONE =="
