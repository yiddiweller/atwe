# Full-app audit — September 2026 (build 1825)

Asked for after two whole features were found unreachable in one week: a group's shared
**Cloud**, and **creating an account**. The question was fair — *"how do I know there
isn't more?"* — so this audit did not re-check surfaces. It hunted the two SHAPES those
bugs had, mechanically, over the whole app.

## The two shapes

1. **A feature that is complete and has no door.** Every line of it works; nothing on
   screen leads to it. The Cloud was this.
2. **A route that says it did something it did not do.** Signing up was this.

## What was checked

| check | result |
|---|---|
| every inline handler in `index.html` names a real function | **1801 names, all real** |
| every `.overlay` has something that opens it | **440 overlays, all reachable** |
| nothing the app shows is hidden by a CSS rule (20 surfaces, phone + desktop + both themes) | clean |
| same sweep on the admin dashboard | **322 handlers, all real** |
| every function that opens something has a caller | 27 orphans → **3 real, 24 superseded helpers** |
| every overlay is a direct child of `<body>` (a missing `</div>` traps them all) | clean |
| a CSS variable declared twice with different values | none |
| the money + auth test suite | **47 / 47** |
| the 89 existing regression probes | green |

## What was actually broken

**1. A suspended member could not appeal — the whole appeal screen was missing.**
The server route, the `appeals` table and the admin **Appeals** tab were all real and
working. The sign-in screen's code revealed `#loginAppeal`, opened `#appealForm` and
focused `#appealMsg` — and **not one of those four elements existed in the markup**. So a
suspended or banned member was told their account was restricted and given no way to
contest it, and no appeal could ever reach the team. Rebuilt, and now driven end to end
by a probe: a real suspended account, the real sign-in screen, and the appeal read back
out of the database.

**2. "Explain with Atwe AI" on a post had no menu row anywhere.** The endpoint, the card
and the overlay were all built. A *message* still reached it (Ask Atwe AI → Explain),
which is why it looked covered; a *post* reached it nowhere. One row added, shown only
when the post has words in it.

**3. Four more routes told people an email had been sent when none was.** `signup/start`
was the one that got reported. The same lie lived in the password-reset link, the
re-send-verification button, and — the one that mattered — **changing your email address**,
which moves the account to the new address and marks it unverified *before* sending the
link. With no mail transport that strands somebody on an address they can never verify.
All four now refuse before changing anything.

**4. Dead scaffolding removed.** A group-call popover orphaned by build 1823 when video
and Go live moved into the ⋯ menu, plus two no-op stubs. A switched-off thing whose code
still runs is how the next real bug hides.

## What is NOT broken but you should know

- **With no card processor configured, anyone signed in can give themselves money.**
  "Add money" credits the wallet instantly when Stripe is absent. That is deliberate — it
  is what makes every flow testable — and it is fine on a laptop. On a live site it is an
  open till. Check yours at `<site>/api/config`: look for `"billingEnabled"`.
- **With no mail configured, nobody can create an account.** Same page, `"emailEnabled"`.
  Since build 1824 the app refuses honestly instead of pretending; it still needs SMTP to
  actually work.
- **Live "who else is editing this" presence for a shared Cloud document was built and
  never wired up** (`acDocOpen` and friends). Not a lost door — it was never connected —
  and the Cloud works without it. Left alone rather than built unasked.

## The two new probes

- **`scratchpad/deadends.js`** — the mechanical sweep for shape 1, over the whole file
  rather than screen by screen.
- **`scratchpad/journeys.js`** — the five journeys a person must be able to finish:
  forgot my password (including that the OLD password stops working and the code cannot
  be reused), first post, first purchase (pennies conserved, double-tap safe), changed my
  email, and appealed a suspension.

Both go red when their fix is reverted.
