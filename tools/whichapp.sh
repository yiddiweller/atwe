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
# Quote them and don't worry about punctuation. FOUR spellings of the same
# sentence are tried, and the last one is the whole reason this exists: the
# website is HTML, so its source says What&rsquo;s where the SCREEN says What's.
# A straight-apostrophe grep therefore finds the phone app and misses the
# website entirely — which is exactly how the account-creation bug was blamed
# on the phone for a day. Every pass is run against BOTH codebases before any
# of them is believed, so a sentence that lives in both is reported as both.
#
# Nothing found means the words are older than the code the person is running,
# which is itself the answer: they are on a stale build.
#
# Built output is skipped (dist-web, .expo, ios, android) — a hit inside a
# minified bundle is one unreadable 200KB line that says nothing the source
# did not, and it buries the real answer under it. Lines are cut to 300 chars
# for the same reason.
[ -z "$1" ] && { echo "usage: tools/whichapp.sh \"the words on the screen\""; exit 2; }
cd "$(dirname "$0")/.." || exit 1
hit=0; found=""
straight="${1//’/\'}"
ent='\&rsquo;'
for q in "$1" "$straight" "${straight//\'/’}" "${straight//\'/$ent}"; do
  for where in "the WEBSITE:public" "the PHONE APP:atwe-mobile"; do
    name=${where%%:*}; dir=${where#*:}
    [ -d "$dir" ] || continue
    out=$(grep -rn --fixed-strings --exclude-dir=node_modules --exclude-dir=dist-web \
      --exclude-dir=.expo --exclude-dir=ios --exclude-dir=android \
      "$q" "$dir" 2>/dev/null | cut -c1-300 | head -4)
    case " $found " in *" $dir "*) continue;; esac
    [ -n "$out" ] && { echo "── $name ──"; echo "$out"; hit=1; found="$found $dir"; }
  done
done
[ "$hit" = 1 ] || echo "Nowhere in either — so they are running a build older than this code."
