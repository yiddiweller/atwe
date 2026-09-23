#!/bin/bash
# Run the probes that sit NEXT TO THIS SCRIPT. This used to be a hardcoded path into a
# session scratchpad in /tmp — so `bash scratchpad/run-all.sh` in the repo silently ran a
# stale copy of every probe, and edits made here were never executed. That is the exact
# mistake the README above this directory was written to stop.
cd "$(dirname "$0")" || exit 1

[ -z "$JWT_SECRET" ] && export JWT_SECRET=scoresecret
# One database for the whole run, and its fallback address is declared in exactly one
# place (qa-fixture.js) rather than repeated here - a second copy is how a probe and
# the server it drives end up on different databases.
[ -z "$DATABASE_URL" ] && export DATABASE_URL="$(node -p "require('./qa-fixture').DEFAULT_DB")"
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

# TWENTY-SIX PROBES NEED A BEARER TOKEN, AND THIS LINE MUST COME AFTER seed-fixtures.
# They used to print "export TOK first" and be SKIPPED by this runner - a full regression
# silently covered 68 probes, not 85, and every Beam/composer/boot check among them never
# ran. seed-fixtures now WRITES /tmp/tok.txt (minting an account when the one on file is
# not one this server accepts), so reading TOK before it ran is the same silent skip
# arriving a second time: on a machine with no token file, all 26 skip again.
[ -z "$TOK" ] && [ -f /tmp/tok.txt ] && export TOK="$(cat /tmp/tok.txt)"
[ -n "$TOK" ] || echo "-- fixtures: NO TOKEN - the 26 token probes will skip"

# qadsn runs FIRST and needs neither a server nor a database: it is the static check that
# the fixture rules still hold. Fifty-nine probes once hardcoded the database address and
# ignored DATABASE_URL, so they seeded one database while driving a server on another and
# measured a signed-out app - reporting it as a product fault. Catch that before spending
# an hour finding out the hard way.

for f in qadsn profilemenu buttons rowsize notifscroll demomedia gutters sethandoff concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep deskcols authpane chatscroll voicenote chathead fixtext lastseen chatedge acctswitch pwsave navnotif smooth attach sendundo openbottom layouts navtap apperrors emptystates bootspeed storagesign feedskel cluster profcard tabpills topglass reachable signupflow signuphandoff obresume accttype deadends journeys admintabs admindead adminsweep bizevidence admintouch fillroles notifguard ctlsweep wayback touchwide gapmob notifhdr acctbug worldhdr verchk contrastfix touchsize legible aiknows aiagent deepstates twoperson shoppause wallethandoff navhandoff setpush motion nodash dashlive nohang callpath tapown rtalive aitell tabrow navclear loadstate errstate; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  timeout 600 node "$f.js" 2>&1 | tail -3   # totals only; run a probe directly for its full output
done
echo "== ALLDONE =="
