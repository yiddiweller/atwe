# THE WAY BACK — the exact tree before the polish pass

The founder's first instruction for this pass was: *"IF IT DOES NOT COME OUT GOOD, WE
SHOULD BE ABLE TO MAKE IT BACK THE WAY ITS NOW."*

This file is that guarantee. It is committed, so it cannot be lost with a session.

## The two commits

| where | commit | what |
|---|---|---|
| **production** (`main`) | `4c4daaa27de54d1e84294640638bec5adfb09627` | Build 1861 |
| **working branch** (then `claude/claude-md-docs-cajkf9`, now `beta` and `development`) | `1bcf3a6bd6f94ffdf8eef2a00aa2dbcaa2baaa4f` | Build 1861 |

> **Branch names changed after this was written.** The September 2026 cleanup
> replaced the Claude working branch with `development` (building) and `beta`
> (testing); both start at the polish tip `055d6f4`, so the baseline commit above
> is still an ancestor of both and every command here still works with the new
> name substituted. The branch itself is frozen at
> `archive/claude-claude-md-docs-cajkf9-2026-09-14` on the remote. The SHAs are
> the real anchor and none of them moved.

Both are **already pushed to the remote**, so they survive anything that happens
locally, and both are still in the history of `development`, `beta` and `main`.
Outside `atwe-mobile/` (which `main` did not carry yet) they held the same web app;
the SHAs differ because `main` was then maintained by cherry-pick. That era is over:
since October 2026 the three branches move by exact-commit fast-forward
(`docs/BRANCHES-AND-RELEASES.md`).

Local annotated tags `polish-baseline-main` and `polish-baseline-branch` pointed at
them as a convenience. **They were never on the remote**: that session's GitHub
credentials returned `HTTP 403` for a tag push while allowing branch pushes. The
commit SHAs above are the real anchor.

## Putting it back WITHOUT rewriting history

`development`, `beta` and `main` only ever move FORWARD. The GitHub ruleset refuses
force pushes on all three, and the recipe that used to be here (`git reset --hard`
plus `git push --force-with-lease`) is **retired**. Never use it on a long-lived
branch. "Back the way it was" is done in two moves instead:

**1. If the live site is wrong right now, roll the DEPLOYMENT back.** Railway → the
production service → Deployments → the last good deployment → Rollback. That puts the
previous build back on atwe.com at once without touching git. beta.atwe.com has its
own Deployments list and rolls back the same way.

**2. Then undo it in git, FORWARD.** On `development`, make NEW commits that undo the
change, then promote that exact commit development → beta → main like any other
change. The deployment rollback holds the line until it lands.

The polish pass is deliberately committed in small, separately-named batches (the
seven commits `1bcf3a6..055d6f4`), so one piece can be lifted out without losing the
rest:

```
git fetch origin
git switch development && git pull --ff-only
git log --oneline 1bcf3a6..055d6f4     # the seven polish commits, newest first
git revert <the one commit>            # undo just that one, as a new commit
git revert 1bcf3a6..055d6f4            # or all seven, newest first, as new commits
```

That is the reason for many small commits rather than one large one. Every build
since then was made on top of this pass, so a revert can conflict; resolve it by hand,
run the regression, then promote. Nothing here ever needs a force push.

## What "back the way it is now" actually means

Build **1861**, verified before the pass began:

- `./tools/shipcheck.sh` reported **IN STEP** — production and the branch on 1861.
- The full regression ran **122 probes**. Two were red and both were chased down
  rather than waved through: `trayline` passes 9 of 9 on its own (a timing flake
  under batch load), and `settle` fails one Home measurement that reproduces
  identically on the previous build (`673 to 430` against `672 to 430`), so it
  predates this work.
- `npm test` passed **59 of 59**, money and auth included.
- The app's script parses, all 438 overlays are top-level children of `<body>`, and
  no CSS custom property is declared twice with different values.

So the baseline is a known-good, measured state rather than "whatever was there".
