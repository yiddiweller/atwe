#!/bin/bash
# WHICH COMMIT IS ACTUALLY LIVE, AND IS IT THE ONE THAT WAS TESTED?
#
# Three long-lived branches, one direction (docs/BRANCHES-AND-RELEASES.md):
#   development  building     no public address, builds nothing
#   beta         testing      beta.atwe.com (TestFlight is started by hand)
#   main         production   atwe.com, and the source of truth
#
# Promotion moves the EXACT approved commit forward by fast-forward, so the
# honest question is "is it the same commit", not "do the build numbers match".
# Builds 1846-1853 were tested, green and pushed while the founder's phone ran
# 1845, and a stale local branch would not have shown it.
#
# This reads GitHub's own branches: it fetches origin/development, origin/beta
# and origin/main first and never looks at local branches. It compares them by
# exact commit, by files (git tree) and by web build number, and lists any
# release-ios-* tag with whether its commit is on main. It changes nothing: the
# only write is refreshing those three remote-tracking refs.
#
#   ./tools/shipcheck.sh             fetch, then compare
#   ./tools/shipcheck.sh --no-fetch  compare what was fetched last (offline)
#
# Exit 0  beta and main are the same commit: atwe.com runs exactly what was tested.
# Exit 1  they are not.
# Exit 2  something could not be read.
#
# Run it before telling anybody a fix has shipped.

cd "$(dirname "$0")/.." || exit 2

FETCH=1
for arg in "$@"; do
  case "$arg" in
    --no-fetch) FETCH=0 ;;
    development|beta|main) ;;  # older usage named one branch; all three are always shown now
    -h|--help) awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg"; echo "Usage: ./tools/shipcheck.sh [--no-fetch]"; exit 2 ;;
  esac
done

BRANCHES="development beta main"

if [ "$FETCH" = 1 ]; then
  if ! git fetch --quiet --no-tags origin \
      '+refs/heads/development:refs/remotes/origin/development' \
      '+refs/heads/beta:refs/remotes/origin/beta' \
      '+refs/heads/main:refs/remotes/origin/main'; then
    echo "Could not fetch from GitHub, so nothing below would be current. Stopping."
    echo "(Offline? ./tools/shipcheck.sh --no-fetch compares what was fetched last.)"
    exit 2
  fi
  echo "GitHub's branches, fetched just now:"
else
  echo "GitHub's branches as last fetched (--no-fetch, so possibly out of date):"
fi

ref_of()  { echo "refs/remotes/origin/$1"; }
num_from() { git show "$(ref_of "$1"):$2" 2>/dev/null | grep -m1 -oE "$3" | grep -oE '[0-9]+$'; }

for b in $BRANCHES; do
  sha=$(git rev-parse --verify --quiet "$(ref_of "$b")^{commit}")
  if [ -z "$sha" ]; then
    echo "Cannot read origin/$b. Is the branch there? (git fetch origin $b)"
    exit 2
  fi
  tree=$(git rev-parse "$(ref_of "$b")^{tree}")
  build=$(num_from "$b" public/index.html "ATWE_BUILD = '[0-9]+")
  cache=$(num_from "$b" public/sw.js "CACHE = 'atwe-v[0-9]+")
  routes=$(num_from "$b" public/index.html 'atwe-routes\.js\?v=[0-9]+')
  if [ -z "$build" ]; then
    echo "Cannot read a build number from origin/$b:public/index.html."
    exit 2
  fi
  warn=""
  if [ "$cache" != "$build" ] || [ "$routes" != "$build" ]; then
    warn="   STAMPS DISAGREE: sw.js CACHE ${cache:-?}, atwe-routes.js?v=${routes:-?}"
  fi
  printf '  %-12s %s  files %s  build %s%s\n' "$b" "${sha:0:12}" "${tree:0:12}" "$build" "$warn"
  printf -v "SHA_$b" '%s' "$sha"
  printf -v "TREE_$b" '%s' "$tree"
  printf -v "BUILD_$b" '%s' "$build"
done

if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
  echo
  echo "NOTE: this is a shallow clone, so the commit counts below may be incomplete."
  echo "      (git fetch --unshallow origin fixes that.)"
fi

# compare FROM TO: can TO be fast-forwarded to FROM's exact commit?
compare() {
  local from=$1 to=$2 fs ts ahead behind files same fs_var ts_var tf_var tt_var
  fs_var="SHA_$from"; ts_var="SHA_$to"
  fs=${!fs_var}; ts=${!ts_var}
  if [ "$fs" = "$ts" ]; then
    printf '  %-20s SAME COMMIT\n' "$from -> $to"
    return
  fi
  ahead=$(git rev-list --count "$ts..$fs")
  behind=$(git rev-list --count "$fs..$ts")
  files=$(git diff --name-only "$ts" "$fs" | wc -l | tr -d ' ')
  tf_var="TREE_$from"; tt_var="TREE_$to"
  same=""
  [ "${!tf_var}" = "${!tt_var}" ] && same=" (identical files, different commits)"
  if [ "$behind" = 0 ]; then
    printf '  %-20s %s can fast-forward to %s: %s commit(s), %s file(s) differ%s\n' \
      "$from -> $to" "$to" "$from" "$ahead" "$files" "$same"
  elif [ "$ahead" = 0 ]; then
    printf '  %-20s %s is AHEAD of %s by %s commit(s): something reached %s without going through %s. Find out why.\n' \
      "$from -> $to" "$to" "$from" "$behind" "$to" "$from"
  else
    printf '  %-20s DIVERGED: %s commit(s) only on %s, %s only on %s, %s file(s) differ%s. No fast-forward is possible; stop and find out why.\n' \
      "$from -> $to" "$ahead" "$from" "$behind" "$to" "$files" "$same"
  fi
}

echo
echo "Promotion (exact commit, fast-forward only):"
compare development beta
compare beta main

if [ "$FETCH" = 1 ]; then
  echo
  tags=$(git ls-remote --tags origin 'refs/tags/release-ios-*' 2>/dev/null) || tags="(unreadable)"
  if [ "$tags" = "(unreadable)" ]; then
    echo "Phone: could not list release-ios-* tags."
  elif [ -z "$tags" ]; then
    echo "Phone: no release-ios-* tags yet. (TestFlight builds are started by hand; check the Expo dashboard.)"
  else
    echo "Phone release tags (each must point at a commit already on main):"
    names=$(printf '%s\n' "$tags" | awk '{ sub("refs/tags/", "", $2); sub(/\^\{\}$/, "", $2); print $2 }' | sort -u)
    for name in $names; do
      # an annotated tag lists the tag object, then its commit as name^{}; prefer the commit
      commit=$(printf '%s\n' "$tags" | awk -v n="refs/tags/$name^{}" '$2 == n { print $1 }')
      [ -z "$commit" ] && commit=$(printf '%s\n' "$tags" | awk -v n="refs/tags/$name" '$2 == n { print $1 }')
      if ! git cat-file -e "$commit^{commit}" 2>/dev/null; then
        verdict="commit not found locally, cannot tell"
      elif git merge-base --is-ancestor "$commit" "$(ref_of main)"; then
        verdict="on main"
      else
        verdict="NOT ON MAIN: a store build from it would ship unapproved code"
      fi
      printf '  %-28s %s  %s\n' "$name" "${commit:0:12}" "$verdict"
    done
  fi
fi

echo
if [ "$SHA_beta" = "$SHA_main" ]; then
  echo "IN STEP: atwe.com runs exactly the commit that was tested on beta."
  exit 0
fi
echo "OUT OF STEP: atwe.com is not running the commit on beta (production build $BUILD_main, beta build $BUILD_beta)."
echo "Nothing on beta that is not on main has reached members. When the founder approves,"
echo "promote beta's exact commit to main by fast-forward (docs/BRANCHES-AND-RELEASES.md)."
exit 1
