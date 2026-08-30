#!/bin/bash
cd /tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad
for f in concentric fullscan offstate sbfoot timealign menutrim iconsize oneeye actionrow postcorners evencards headcentre adcard postcard skelgrey trayline radii pillfit cardsweep postdetail postshot blurup settle toastpolish welcome setslide helpfb mehub meacct meidx mesearch mesearchx menonadmin mecolor medesk megap setpage focusring polish3 mefeedback engsettle imgedge appsearch aiguide navlayer aipage aileak addtab polish2 aicomposer clicktest structure everywhere searchsweep; do
  [ -f "$f.js" ] || { echo "-- $f -- MISSING"; continue; }
  echo "-- $f --"
  timeout 600 node "$f.js" 2>&1 | tail -3
done
echo "== ALLDONE =="
