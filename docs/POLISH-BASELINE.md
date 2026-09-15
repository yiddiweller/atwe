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
locally. They are the same tree by content; the SHAs differ only because `main` is
maintained by cherry-pick rather than by merge.

Local annotated tags `polish-baseline-main` and `polish-baseline-branch` point at
them as a convenience. **They are NOT on the remote** — this environment's GitHub
credentials return `HTTP 403` for a tag push while allowing branch pushes. The
commit SHAs above are the real anchor; the tags are a nicety.

## Putting production back

One command, and the site is exactly as it was:

```
git fetch origin main
git checkout main
git reset --hard 4c4daaa27de54d1e84294640638bec5adfb09627
git push --force-with-lease origin main
```

`--force-with-lease` rather than `--force`: it refuses if somebody else has pushed
to `main` since, so a revert can never silently throw away work that arrived in the
meantime.

## Putting the working branch back

```
git checkout beta          # or development, whichever you are putting back
git reset --hard 1bcf3a6bd6f94ffdf8eef2a00aa2dbcaa2baaa4f
git push --force-with-lease origin beta
```

## Taking back ONE change instead of all of them

The polish pass is deliberately committed in small, separately-named batches, so a
single piece can be lifted out without losing the rest:

```
git log --oneline 4c4daaa..HEAD        # every polish commit, newest first
git revert <the one commit>            # undo just that one
```

That is the reason for many small commits rather than one large one.

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
