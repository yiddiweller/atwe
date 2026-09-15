# Where Atwe's code lives, and how it reaches people

Three branches. Each has one job, and the job is what the branch is FOR, not
what happens to be on it today.

| branch | job | web | phone |
|---|---|---|---|
| **development** | building | nowhere | nothing |
| **beta** | testing | beta.atwe.com | TestFlight |
| **main** | production | atwe.com | App Store / Play Store |

Work moves one way: **development → beta → main.** Nothing skips a step.

A branch is a version of the source. Where that version RUNS is decided
somewhere else: Railway watches the web branches, EAS watches the phone. That
separation is the point. A branch does not know it is deployed, and a
deployment does not decide what the code is.

Each Railway environment is connected to exactly one branch and stays that way:
**beta deploys `beta`, production deploys `main`, and `development` deploys
nowhere.** Nothing is ever tested by repointing an environment at a different
branch -- that would make "what is running on beta" a setting rather than a
fact. Work reaches beta by being promoted to `beta`.

## development

Every ordinary change lands here: a feature that is not finished, an
experiment, a probe, a document. Nothing here is public and nothing here builds
a phone app. It is the only branch where being half-done is fine.

## beta

A complete Atwe that the founder tests in a real browser at beta.atwe.com and,
when the phone app changed, on their own phone through TestFlight. It is not a
staging area for parts — if it is on beta it is meant to work.

Promoting development to beta is a decision, and it is the moment a build
number is bumped and the regression is run.

## main

Production. What a member is using. Approved beta, and nothing else, ever.

`main` moving is a live deployment to atwe.com, so it is not where anybody
works and it is not where anybody experiments.

## How the phone app gets built

**Beta — automatic, but only when the phone app actually changed.**
`atwe-mobile/.eas/workflows/mobile-beta.yml` fires on a push to `beta` whose
changes touched `atwe-mobile/`, builds, and puts it in TestFlight. A beta push
that only changed the website, the server or a document builds nothing, because
every iOS build costs a credit and that account has run out twice.

By hand, whenever you want:

```bash
cd atwe-mobile && npx eas workflow:run mobile-beta.yml
```

**Production — never automatic.** `mobile-production.yml` fires on a release
TAG, not on a branch, so ordinary work reaching main can never queue an app
review:

```bash
git tag -a release-26.8.1 -m "Atwe 26.8.1" <approved main commit>
git push origin release-26.8.1
```

That builds and uploads to App Store Connect. **A person then presses Submit
for Review.** EAS uploads a build; it does not release one. That is the right
shape — the upload is mechanical, the release is a decision.

Android is deliberately not wired up: `eas.json` points at a
`play-service-account.json` that does not exist and there is no Play developer
account yet. Add the platform on the day both exist.

## The `ship` branch

`ship` was the old trigger: you force-pushed a working branch to it and EAS
built. It worked, and it is being retired, because the thing it built was a
pointer nobody reviewed rather than a branch anybody had tested. `beta` does
the same job and is also the thing running at beta.atwe.com, so the phone build
and the web build are the same commit.

`ship` still works during the changeover — `mobile-beta.yml` lists it alongside
`beta`. Remove it from that list, and then delete the branch, once a beta build
has gone to TestFlight successfully.

## Which build is where

```bash
./tools/shipcheck.sh              # beta against production
./tools/shipcheck.sh development  # development against production
```

A green regression on development says nothing about what a member is running.
Builds 1846 to 1853 were tested, green and pushed while the founder's phone ran
1845, and they reported the same bugs back, correctly.

## Archive refs

`archive/*` on GitHub are frozen pointers at branches that were retired during
the September 2026 cleanup. They are history, not places to work. Nothing
watches them and nothing builds from them.
