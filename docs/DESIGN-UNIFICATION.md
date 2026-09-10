# The design unification pass — one look, one feel, every device

The founder and their team, 10 Sep 2026:

> *"I want everything should look and feel the same starting from the Web App going
> forward with the iOS app and then the android app and then the desktop version… every
> single page feel the same and has the same effect and the buttons has the same effects
> and looks the same… every button has a place to land and every place has a place to go
> back and it's gonna go back smoothly."*

**This is a FINISH, not a redesign** — their words, and the constraint the whole list is
written under. Nothing here changes what the app does.

## The one decision that was taken before any file was touched

The team's brief asked for deep blur and a visible outline on **every card, modal and
navigation bar**. The founder's own message, in the same breath, asked for **"all the text
that is not a button… with a full black background"**. Those disagree, so it was put to
them and they chose:

> **GLASS ON CHROME ONLY.** Bars, menus, buttons, sheets and pop-ups take the glass and
> the hairline — every one of them. Cards, posts, message bubbles and anything carrying
> body text stay solid black.

That is not a compromise, it is what their own iPhone app already does: `atwe-mobile`
uses real native Liquid Glass (`expo-glass-effect`) in **7 files** — the chrome — and
plain solid surfaces everywhere else. Drawing the line in the same place is what makes the
two platforms agree by construction rather than by coincidence. It is also where the two
iOS feed crashes came from: per-card blur is measured, in this repo, as the thing that
made iOS jettison the feed.

## What the audit measured before anything was changed

| | |
|---|---|
| Button families already on the login-button recipe | **25** |
| Button families on a flat `--s2` with **no hairline at all** | **95** |
| Controls with **no background whatsoever** (bare glyphs) | **64** |
| `:active` rules still SHRINKING on press | **1** — and it was the composer's send · mic · ＋ |
| Notification types the server emits | **153** |
| …with **nowhere to land** — they dump you on Home or a stranger's profile | **71** |

## The list

Finished means this list is at zero.

- [x] **A1 · One control recipe.** The login button's recipe already existed and was
  already measured — it was just named `--tab-*`, so it only ever reached the tab rows.
  Renamed to `--ctl-*` with `--tab-*` aliasing it, so every other control has one place to
  point at. Proved byte-identical in both themes before anything else moved.
- [x] **A2 · 45 control families wear it.** One block after every family's own rule, with
  `:not(.on):not(.active):not(.accent):not(.danger):not(.selected)` so a selected chip
  stays white, a primary stays white and a delete stays red.
- [x] **A3 · The image viewer's ✕ and ⋯** — the founder's literal example. Two bare white
  glyphs kept legible by a drop-shadow; now equal 40px discs on the recipe. They were
  **43 and 40** across before, which nobody could see while they were bare and everybody
  would see the moment they became two circles side by side.
- [x] **A4 · Every press grows.** The composer's send, mic and ＋ were still scaling to
  **0.84** — the most-pressed controls in the app, missed by the pass that mirrored the
  other 113. Zero shrinking `:active` rules remain.
- [x] **B1 · The rest of the bare controls, found by measurement.** `ctlsweep.js` walks
  20 surfaces in both themes and reports every on-screen `<button>` carrying neither a
  fill nor a rim. It found **39 distinct classes**. Six were real and are now on the
  recipe (the account switcher, the profile back arrow, the marketplace cart and save,
  two small ✕). The other 32 are deliberately bare and are **named in the probe with
  their reason** — a nav icon has the glass bar as its ground, a selected pill is
  rimless exactly as Apple's is, the post's ⋯ sits on a card whose grey is within a
  shade of the recipe so a disc there would be invisible, and `.ac-link-btn` is a blue
  text LINK rather than a button. Naming them is the point: a blanket "skip anything
  that looks like nav" would hide the next real one.
- [x] **B2 · Back arrows — DECIDED, and the answer is that both were already right.**
  They looked like a contradiction: a profile's back arrow is a grey **disc**, a sheet's
  is a **bare chevron** on the margin beside its title. Shot side by side at 3×, one rule
  explains both, and it is the rule iOS itself follows:

  > **A control floating over a PHOTO gets a ground. A control sitting on the page
  > beside its own title does not.**

  A profile's arrow floats on the banner image and would be unreadable without a disc —
  that is why it has one, and it is why the image viewer's ✕ and ⋯ just got one too. A
  sheet's arrow sits on plain black next to the word "Wallet"; a disc there adds a second
  shape to read and pushes the ink off the gutter line that a previous pass measured it
  onto (2.3px, because a rotated square overhangs its own box by (√2−1)/2 of its side).

  So this is **not** two systems, and forcing one would have made the app worse in one of
  the two places. The rule is written down so the next person does not "fix" it either.
  `ctlsweep.js` lists the four bare back arrows by name with this reason.
- [x] **C1 · Every notification lands somewhere real.** The honest count was **89 of
  171**, not 71 — the first scan's regex counted `'sent'` and `'host'` as notification
  types and so under-reported. `NOTIF_GO` routes them and `notifguard.js` diffs its keys
  against what `server.js` really emits. **And the bug underneath:** closing the
  notification panel walked history BACK, and the popstate then shut whatever the
  notification had just opened — so Wallet, Quotes and Ads opened and closed in one
  frame. Same fault the Settings rows had; the fix existed and had never been applied
  here. ~~71 notifications with nowhere to land.~~ Refunds, payments, tips, quotes,
  wallet freezes, course enrolments, webinars, gift cards, appeals, strikes. Plus a guard
  that diffs the server's emitted types against the client's routes, so type 154 cannot
  ship without a destination.
- [x] **C2 · Every page has a way back — and the phone's Back gesture was broken on
  193 of them.** `wayback.js` opens 16 destinations, proves there is a control in the
  panel's top-left that is genuinely hittable (`elementFromPoint` at its own centre must
  land inside it — a probe that never asks *what is actually on top* proves the code
  works, not that anybody can use it), presses it, and proves it left. Then it presses
  the system Back.

  **The real defect: `acSetPath` returns early when asked for the path already showing.**
  Only 33 of the app's 226 destination panels own a route, so for the other 193 opening
  them pushed **no history entry at all** — and Back therefore consumed whatever entry
  came *before*, moving the world underneath while the panel stayed open. Measurably
  worse than Back doing nothing. Fixed in `_navDismissModal`, which already exists for
  exactly this shape ("Back cancels THAT, and the page stays put") and re-pushes the
  entry itself, so nothing is consumed.

  Two guards matter more than the fix and are asserted: **Back cannot trap you** (a
  second press must not bring the sheet back) and **Back cannot open a locked door** —
  the sign-in wall, onboarding and the passcode pad are excluded by name, because those
  are not places you are visiting.
- [ ] **D1 · Phone · tablet · desktop, one app.** The same battery at four widths and both
  themes.
- [ ] **E1 · A guard per rule**, all in `run-all.sh`, so none of this drifts back.

## What this pass deliberately does NOT do

The team's brief asks to "audit `tailwind.config.js` / the theme provider". **Atwe has no
Tailwind, no framework and no build step** — it is one file with one `<style>` block. The
equivalent exists and is better for the multi-platform goal: a CSS custom-property token
set that the phone app's own tokens were already matched to. Read `--ctl-*` and the
`--tab-*` / `--post-*` / `--menu-*` families as the config file that brief is asking for.
