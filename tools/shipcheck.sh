#!/bin/bash
# WHAT IS ACTUALLY ON THE FOUNDER'S PHONE?
#
# Production deploys from `main`. The working branch is where the work happens, and
# the two are kept in step by CHERRY-PICK, not by merging - so a clean regression on
# the working branch says nothing about what a member is running. Builds 1846-1853
# were tested, green and pushed while every one of them sat on the branch and the
# founder's phone ran 1845; they reported the same bugs back, correctly, and the
# fixes were never in their hands.
#
# Run this before telling anybody a fix has shipped.
cd "$(dirname "$0")/.." || exit 1
BR="${1:-claude/claude-md-docs-cajkf9}"
live=$(git show main:public/index.html 2>/dev/null | grep -m1 -o "ATWE_BUILD = '[0-9]*'" | grep -o "[0-9]*")
work=$(git show "$BR":public/index.html 2>/dev/null | grep -m1 -o "ATWE_BUILD = '[0-9]*'" | grep -o "[0-9]*")
behind=$(git rev-list --count main.."$BR" 2>/dev/null)
echo "production (main):   build $live"
echo "working branch:      build $work"
if [ "$live" = "$work" ]; then
  echo "IN STEP - what you tested is what they are running."
else
  echo "OUT OF STEP - the founder is on $live, you tested $work."
  echo "Nothing you fixed since $live is on their phone. Cherry-pick to main and push it."
  exit 1
fi
