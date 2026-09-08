#!/bin/bash
# WHICH ATWE IS THIS SCREENSHOT OF?
#
# The website and the iPhone app were deliberately built to the same screens,
# step for step, so a photo of one reads as the other. Getting that wrong once
# cost two days: a report of "I can't create an account" was diagnosed against
# the website for two days when the screen in the photo was the phone app's.
#
# Type the words that are ON the screen. This says where they live.
#
#   tools/whichapp.sh "What's your @username?"
#
# Quote them, and don't worry about the apostrophe — a curly ’ and a straight '
# are both tried. Nothing found means the words are older than the code the
# person is running, which is itself the answer: they are on a stale build.
[ -z "$1" ] && { echo "usage: tools/whichapp.sh \"the words on the screen\""; exit 2; }
cd "$(dirname "$0")/.." || exit 1
hit=0
for q in "$1" "${1//\'/’}" "${1//’/\'}"; do
  for where in "the WEBSITE:public" "the PHONE APP:atwe-mobile"; do
    name=${where%%:*}; dir=${where#*:}
    [ -d "$dir" ] || continue
    out=$(grep -rn --fixed-strings --exclude-dir=node_modules "$q" "$dir" 2>/dev/null | head -4)
    [ -n "$out" ] && { echo "── $name ──"; echo "$out"; hit=1; }
  done
  [ "$hit" = 1 ] && break
done
[ "$hit" = 1 ] || echo "Nowhere in either — so they are running a build older than this code."
