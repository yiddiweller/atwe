# Where Atwe's code lives, and how it reaches people

Three long-lived branches. Each has one job, and the job is what the branch is
FOR, not what happens to be on it today.

| branch | job | web | phone |
|---|---|---|---|
| **development** | building | nowhere | nothing |
| **beta** | testing | beta.atwe.com | TestFlight, as the separate Atwe Beta app, started by hand |
| **main** | production, and the source of truth | atwe.com | App Store, started by a `release-ios-*` tag |

Work moves one way: **development → beta → main.** Nothing skips a step, and
nothing goes straight from development to main.

There are no other places to work: no feature, fix or hotfix branches. An urgent
fix takes the same road as everything else, just faster.

A branch is a version of the source. Where that version RUNS is decided
somewhere else: Railway deploys the two web branches, and an EAS workflow builds
the phone app when a person starts it. A branch does not know it is deployed,
and a deployment does not decide what the code is.

Each Railway environment is connected to exactly one branch and stays that way:
**beta deploys `beta`, production deploys `main`, and `development` deploys
nowhere.** Nothing is ever tested by repointing an environment at a different
branch: that would make "what is running on beta" a setting rather than a fact.

## Promotion moves the SAME commit forward

Promoting means pointing the next branch at **the exact commit that was
approved**, by a fast-forward. Beta becomes the very commit development held;
later, main becomes the very commit beta held. Same commit, same files, byte for
byte, so what was tested is what ships.

Development to beta:

```bash
git fetch origin
SHA=<the exact commit the founder approved>
git rev-parse origin/development                            # must print $SHA
git merge-base --is-ancestor origin/beta "$SHA" && echo OK   # beta can fast-forward to it
git push origin "$SHA":refs/heads/beta                       # ordinary push, never --force
```

Beta to main, later, once beta is accepted:

```bash
git fetch origin
SHA=<the exact commit accepted on beta>
git rev-parse origin/beta                                   # must print $SHA
git merge-base --is-ancestor origin/main "$SHA" && echo OK
git push origin "$SHA":refs/heads/main
```

Then `./tools/shipcheck.sh` shows the branches holding the same commit.

**If git refuses the push** ("non-fast-forward", "fetch first"), somebody wrote
to that branch directly. STOP and find out why. Never answer it with `--force`,
a merge or a cherry-pick: those are what made the three branches drift apart
before (see the history note at the end).

**Never done:**

- cherry-picking a commit from one branch to another;
- merging one long-lived branch into another (beyond the one-time join below);
- rebasing, resetting or force-pushing a long-lived branch;
- committing directly to beta or main;
- deleting a long-lived branch.

GitHub refuses the last two outright: the repository ruleset `atwe` covers
development, beta and main, blocks force pushes and deletions, and has nobody on
its bypass list. Do not add "Require a pull request", "Require linear history",
"Require status checks" or "Require signed commits" to it without re-reading
this page first: each of them can refuse an exact-commit fast-forward.

## Building the web

The web build number lives in three places that move together: `ATWE_BUILD` in
`public/index.html`, `CACHE` in `public/sw.js`, and the `?v=` on
`atwe-routes.js`. `test/release-config.test.js` and `test/route-registry.test.js`
fail if they disagree.

The bump is committed **on development**, as part of the release candidate,
because beta takes development's exact commit and nothing is edited on the way.
The regression runs against that exact commit. Then it moves: development to
beta (beta.atwe.com redeploys by itself), then beta to main (atwe.com redeploys
by itself).

## How the phone app gets built

**Promotion never builds the phone app.** No push to development, beta or main
starts a native build. Every iOS build costs a credit, and the account ran dry
twice back when builds fired by themselves.

### Beta (TestFlight): by hand, on the approved beta commit

`atwe-mobile/.eas/workflows/ios-beta.yml` has no trigger at all, so it runs only
when a person starts it. It builds the `beta` profile in `atwe-mobile/eas.json`,
which makes **Atwe Beta** (see "Two iPhone apps" below), talking to
**https://beta.atwe.com**, and uploads it with the `beta` submit profile to the
Atwe Beta app in App Store Connect.

- Expo dashboard → the `atwe` project → Workflows → Run workflow → git ref
  `beta` → `ios-beta.yml`. Check that the commit it shows is the approved beta
  commit.
- Or from a computer, on a clean checkout of exactly that commit, so there is no
  doubt which code it builds:

  ```bash
  git fetch origin && git switch --detach <approved beta commit>
  git status                                  # must be clean
  cd atwe-mobile && npx eas workflow:run ios-beta.yml
  ```

The very first run needs a one-time signing setup for the new bundle id first
(below, and in `atwe-mobile/PROJECT-STATUS.md`).

### Production (App Store): a `release-ios-*` tag on an exact main commit

`atwe-mobile/.eas/workflows/ios-release.yml` fires on a pushed tag shaped
`release-ios-*` and on nothing else:

```bash
git fetch origin
git merge-base --is-ancestor <sha> origin/main && echo "on main"   # must say "on main"
git tag -a release-ios-26.8.1 -m "Atwe iOS 26.8.1" <sha>
git push origin release-ios-26.8.1
```

That builds the `production` profile, i.e. **Atwe** (`com.atwe.app`, talking to
https://atwe.com), and uploads it to the real Atwe app in App Store Connect
(6789639912). **A person then presses Submit for Review.** EAS uploads a build; it
does not release one. The upload is mechanical, the release is a decision.

The tag names the platform on purpose: a generic `release-*` would also catch a
future `release-android-*` and queue an iPhone store build by accident. When
Android, Mac or Windows get store builds, each gets its own workflow and its own
`release-<platform>-*` tag, always cut from main.

An earlier session found that pushing a tag from Claude's cloud environment was
refused (HTTP 403) while branch pushes worked. If that still holds, the tag is
created on GitHub's own web page instead, pointed at the same exact commit.

### Two iPhone apps: Atwe and Atwe Beta

One codebase makes two apps. `atwe-mobile/app.json` IS the production app, and
`atwe-mobile/app.config.js` turns it into the beta app only when the build profile
sets `APP_VARIANT=beta`, which only the `beta` profile in `eas.json` does.

| | Atwe | Atwe Beta |
|---|---|---|
| name on the phone | Atwe | Atwe Beta |
| iOS bundle id | `com.atwe.app` | `com.atwe.app.beta` |
| Android package | `com.atwe.app` | `com.atwe.app.beta` |
| link scheme | `atwe://` | `atwe-beta://` |
| server | https://atwe.com | https://beta.atwe.com |
| atwe.com links (universal links, Android app links) | yes | none |
| App Store Connect app | 6789639912 | 6821134969 |
| built by | `ios-release.yml`, on a `release-ios-*` tag | `ios-beta.yml`, by hand |
| who can get it | everyone, from the App Store | private TestFlight testers only |

- **They live side by side.** A different bundle id is a different app, so Atwe
  Beta installs next to the App Store Atwe and never replaces it. Each has its own
  sign-in, its own saved data and its own notification permission.
- **Atwe Beta is never released.** It exists for private TestFlight testing.
  Nobody presses Submit for Review on it, and it is never put on the App Store.
- **It claims no atwe.com links**, on purpose: only the real app may open them.
  So the few things inside Atwe Beta that point at atwe.com (terms, privacy, help,
  and the two-step sign-in row that says to finish setup on atwe.com) open the
  PRODUCTION website, or, once the production app's universal links work, the
  production app if it is installed.
- **The two cannot cross.** `test/release-config.test.js` runs `app.config.js`
  both ways and fails if a beta build could be uploaded to the real Atwe app, a
  production build to Atwe Beta, or if Atwe Beta ever claims atwe.com links.

**One-time setup before the first Atwe Beta build.** `com.atwe.app.beta` is new to
EAS: it needs its own provisioning profile, the existing push key assigned to it,
and the App Store Connect API key EAS Submit uses. That is done once, by a person at
a computer (a workflow cannot do it), and the steps are in
`atwe-mobile/PROJECT-STATUS.md` under "TWO iPHONE APPS".

**A separate production follow-up, not part of the beta work:** `app.json` has asked
for the `applinks:atwe.com` Associated Domains entitlement since 5 Oct 2026, and no
production build has been made since. Before the next PRODUCTION iOS build, the
Associated Domains capability has to be on the `com.atwe.app` identifier and the
production provisioning profile refreshed, or signing fails as it did in July. Also
in `atwe-mobile/PROJECT-STATUS.md`.

### Version numbers

The version people see is `expo.version` in `atwe-mobile/app.json` (`26.8.0`,
shown as `26.8 Beta`), the same in both apps. The store build number is not ours
to pick: EAS keeps it remotely (`appVersionSource: remote`) and raises it on every
build (`autoIncrement`). EAS keeps that number **per bundle id**, so the two apps
count separately and never move each other: Atwe carries on from its own count
(the last successful build was 41), and Atwe Beta starts its own count at 1 with
its first build.

Android is deliberately not wired up: `eas.json`'s Android submit settings point
at a `play-service-account.json` that does not exist (and is in `.gitignore`, so
it can never be committed by accident), and there is no Play developer account
yet. Mac and Windows today are the installable web app from atwe.com, i.e. main.

## main is the source of truth

What is on main is what Atwe is: the web at atwe.com, every iPhone store build
(cut from a main commit by a `release-ios-*` tag), and every future Android, Mac
or Windows release. A phone build from anything that is not on main is a test
build, never a release.

## When something is wrong in production

Nothing is ever fixed by rewriting history.

1. **Web, right now:** Railway → the production service → Deployments → the last
   good deployment → Rollback. That changes what runs without touching git, and
   it is immediate.
2. **Then fix forward:** on development, `git revert <bad commit>` (a new commit
   that undoes it) or a real fix, then promote that exact commit development →
   beta → main like any other change. The rollback holds the line until it lands.
3. **Phone:** a store build cannot be pulled back, only replaced. Fix forward,
   then tag the fixed main commit with a new `release-ios-*`. A bad TestFlight
   build can be expired in App Store Connect.

Never `git reset --hard` a long-lived branch and push it. The ruleset refuses
force pushes anyway, and older notes in this repository that show such commands
are retired.

## The `ship` branch (legacy, do not push)

`ship` was the old trigger: a working branch was force-pushed to it and EAS
built from it. It is retired and **must not be pushed to**. Its own copy of the
old `build-ios.yml` still says "build when ship is pushed", and EAS reads that
file from the pushed commit, so a push there would still start a TestFlight
build, from old code.

Nothing else depends on it. It is deleted only after a TestFlight build from
`ios-beta.yml`, on the approved beta commit, has succeeded.

## Which build is where

```bash
./tools/shipcheck.sh
```

It fetches GitHub's own `development`, `beta` and `main` and compares them by
exact commit, by files and by web build number. It never uses a stale local copy
and it changes nothing. It exits 0 only when beta and main hold the same commit,
i.e. production is running exactly what was tested.

A green regression on development says nothing about what a member is running.
Builds 1846 to 1853 were tested, green and pushed while the founder's phone ran
1845, and they reported the same bugs back, correctly.

## Legacy branches

`archive/*`, `backup/*`, `recovery/*` and `claude/*` on GitHub (20 branches) are
frozen pointers from before the September 2026 cleanup. They are history, not
places to work. Nothing watches them and nothing builds from them. They are
branches, not tags: the repository has no tags yet.

## History note: the one-time join

Until October 2026 the three branches were kept in step by cherry-picking, so
beta and main carried copies of development's commits under different names, and
git could not fast-forward any of them. Gate B (October 2026) joined them once:
a single merge commit on development whose parents are development, beta and
main, and which **changed no file** (`git merge -s ours`). It rewrote nothing;
every old commit is still there. From that commit on, beta and main can simply
fast-forward to development. It is a one-time event, not a pattern to repeat.
