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
# `lastseen` used to be a THIRD kind of quiet gap: it was in this list and it ran, but it
# demanded TOK_A/TOK_B/TOK_C from the environment, which nothing here has ever exported, so
# it printed "skipped" and exited 0 on every single run. A skip nobody can turn into a run
# is a note, not a test — it now seeds its own three accounts and only skips with no
# database at all. Watch for "skipped" in this output as well as for FAILED.
# THREE REAL PROBES WERE MISSING FROM THIS LIST — gapmob, notifhdr and acctbug, all
# three of them referenced by name in CLAUDE.md as the cover for a real fix. Being
# absent, notifhdr quietly went stale: it still asserted the Notifications header
# retracts on scroll, which build 1766 deliberately removed. That is the same trap
# recorded above (this runner once covered 68 probes while claiming 85) arriving a
# second time. When you add a probe, add it here in the same commit.
# The account the probes sign in as needs a REAL conversation, or every chat probe
# measures an empty thread and reports a failure on a working app — which is exactly
# what four of them did on build 1845. Idempotent; costs one query when already seeded.
node seed-fixtures.js 2>&1 | sed 's/^/-- fixtures: /'

for f in profilemenu buttons rowsize notifscroll demomedia gutters sethandoff concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep deskcols authpane chatscroll voicenote chathead fixtext lastseen chatedge acctswitch pwsave navnotif smooth attach sendundo openbottom layouts navtap apperrors emptystates bootspeed storagesign feedskel cluster profcard tabpills topglass reachable signupflow deadends journeys admintabs admindead adminsweep admintouch fillroles notifguard ctlsweep wayback touchwide gapmob notifhdr acctbug worldhdr verchk contrastfix touchsize legible aiknows aiagent deepstates twoperson motion nodash dashlive nohang callpath tapown rtalive aitell; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  timeout 600 node "$f.js" 2>&1 | tail -3   # totals only; run a probe directly for its full output
done
echo "== ALLDONE =="
