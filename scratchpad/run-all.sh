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

for f in qadsn profilemenu buttons rowsize notifscroll demomedia gutters sethandoff concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep deskcols authpane chatscroll voicenote chathead fixtext lastseen chatedge acctswitch pwsave navnotif smooth attach sendundo openbottom layouts navtap apperrors emptystates bootspeed storagesign feedskel cluster profcard tabpills topglass reachable signupflow suskip signuphandoff obresume accttype deadends journeys admintabs admindead adminsweep bizevidence admintouch fillroles notifguard ctlsweep wayback touchwide gapmob notifhdr acctbug worldhdr verchk contrastfix touchsize legible aiknows aiagent deepstates twoperson shoppause wallethandoff navhandoff setpush setdeep histv2 route3 setroutes route5 bootrace route6 route7 route8 route9 grandfather brandtitle navmotion motion nodash dashlive nohang callpath tapown rtalive aitell tabrow navclear loadstate errstate; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  # EVERY PROBE GETS 600s, AND A PROBE THAT GENUINELY NEEDS LONGER IS NAMED HERE WITH ITS
  # MEASURED RUNTIME - never raise the default for everyone to fit one. navhandoff is 241
  # checks over nine handoffs at two viewports and measures ~631s on its own, so the 600s
  # cap killed it near the end (exit 124) on every full run while it passed 241/0 when run
  # directly. The kill printed only a "browser has been closed" stack, which read as a
  # crash; it was the runner.
  # setdeep drives 16 Settings chains x three Back mechanisms x two viewports, each from a
  # fresh page: 470 checks, measured at ~1111s.
  case "$f" in
    navhandoff) cap=1200 ;;
    setdeep)    cap=1800 ;;
    # route3 drives profile/post/listing/job/event journeys + direct loads + /go at two
    # viewports, each from a fresh signed-in page: 166 checks, measured at ~1380s.
    route3)     cap=1800 ;;
    # histv2 walks the History v2 checks + the prev-conformance chains at two viewports,
    # each from a fresh page: 101 checks, measured at ~894s (killed at 600s on a full run).
    histv2)     cap=1800 ;;
    # setroutes walks all 26 Settings nodes in-app, by URL, Back/Forward and legacy entries,
    # both widths side by side (494 checks, ~1350s measured).
    setroutes)  cap=2400 ;;
    # route5 walks the /me root, the eleven Account sections and the Account tools (in-app,
    # refresh, Back, Forward, direct load, Account Back) at two widths plus a tablet smoke:
    # ~750 checks, measured at ~1040s.
    route5)     cap=1800 ;;
    # route6 walks the unified App Back: real-history chains, direct entries (each a fresh
    # tab), Notifications through routeFor, poisoned private memory and mixed state, at two
    # widths plus a tablet pass: ~360 checks, measured at ~710s.
    route6)     cap=1800 ;;
    # route7 walks Engine browse under /engine and the typed entity permalinks (in-app,
    # refresh, Back/Forward, App Back, direct loads of every alias and slug form, contextual
    # origins, commerce) at two widths plus a tablet smoke: ~540 checks, measured below.
    route7)     cap=2400 ;;
    # route8 walks Beam conversations and the canonical world roots: in-app opens, direct
    # entries in fresh tabs, privacy pairs (each a fresh tab per URL), handoffs, 60 cold boots.
    route8)     cap=2400 ;;
    # route9 checks the SERVER's answers (301 table, 404/410/503, noindex/OG), username
    # history and the auth return across a full reload; it spawns one extra server on a
    # dead database for the 503 case. ~3 minutes; a stall must not eat the night.
    route9)     cap=900 ;;
    # navmotion (route batch 11) runs nine navigation chains with motion on and off at four
    # viewports, then the edge cases and a 4x-CPU comparison: 230 checks, ~375s measured.
    navmotion)  cap=900 ;;
    *)          cap=600 ;;
  esac
  timeout "$cap" node "$f.js" 2>&1 | tail -3   # totals only; run a probe directly for its full output
  # A timeout kill prints no totals line, so say so by name: otherwise it looks like a crash
  # and a monitor grepping for FAILED reports nothing at all.
  [ "${PIPESTATUS[0]}" = 124 ] && echo "   TIMED OUT after ${cap}s (killed by the runner)"
done
echo "== ALLDONE =="
