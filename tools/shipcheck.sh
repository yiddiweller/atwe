#!/bin/bash
# WHAT IS ACTUALLY ON THE FOUNDER'S PHONE, AND WHAT IS ON atwe.com?
#
# The branches have one job each:
#   development  building      no public address
#   beta         testing       beta.atwe.com, and the TestFlight build
#   main         production    atwe.com
#
# Work is promoted development -> beta -> main, so a clean regression on
# development says nothing about what a member is running. Builds 1846-1853
# were tested, green and pushed while every one of them sat on a working branch
# and the founder's phone ran 1845; they reported the same bugs back, correctly,
# and the fixes were never in their hands.
#
# Run this before telling anybody a fix has shipped.
#
#   ./tools/shipcheck.sh              compares beta against production
#   ./tools/shipcheck.sh development  compares development against production
cd "$(dirname "$0")/.." || exit 1

BR="${1:-beta}"

buildof() { git show "$1:public/index.html" 2>/dev/null | grep -m1 -o "ATWE_BUILD = '[0-9]*'" | grep -o "[0-9]*"; }

live=$(buildof main)
work=$(buildof "$BR")

# A missing branch used to read as an empty build number and print a confident
# OUT OF STEP about nothing at all. Say what is actually wrong instead.
if [ -z "$live" ]; then
  echo "Cannot read a build number from main. Is the branch there? (git fetch origin main)"
  exit 2
fi
if [ -z "$work" ]; then
  echo "Cannot read a build number from '$BR'. Is that branch there? (git branch -a)"
  exit 2
fi

printf '%-20s build %s\n' "production (main):" "$live"
printf '%-20s build %s\n' "$BR:" "$work"

if [ "$live" = "$work" ]; then
  echo "IN STEP - what you tested is what they are running."
else
  echo "OUT OF STEP - the founder is on $live, you tested $work."
  echo "Nothing you fixed since $live is on their phone. Promote $BR to main and push it."
  exit 1
fi
