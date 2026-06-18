# "Anchored" — the Atwe design language

Shared shorthand. When the owner says **"Anchored"** (e.g. "make this page
Anchored", "keep it Anchored", "do the X screen Anchored"), apply all of the
following automatically.

1. **Pure black, full-screen.** No cards, panels, or boxed containers around
   content. Everything sits directly on `#000`. (Overlays use
   `.overlay.auth-screen`; steps use `.auth-step` / full-screen patterns.)
2. **Only the answer boxes are bordered.** Input fields get a subtle outline
   that brightens on focus; nothing else gets a box/outline.
3. **Rock-steady layout.** Header (search / title) and footer (Continue / Save)
   stay fixed; only the middle scrolls. Tapping a button never shifts anything —
   no blinks, no jumps, no reflow. Elements **morph in place** (one button
   changing color/label) instead of swapping two hidden elements.
4. **Sharp, high-contrast wording.** Bold white type, clear hierarchy, zero
   clutter. **No emojis, no decorative garnish.**
5. **Purposeful micro-motion only.** Fade-to-black + blur at scroll edges, smooth
   transitions, iPhone-style shake on errors, green/red states for feedback.
   Motion is feedback, never decoration. Respect `prefers-reduced-motion`.
6. **Pill buttons.** Grey when you can't proceed, white when you can, solid red
   for destructive actions. Apple / X-grade restraint.

### Reference implementations already in the app
- Signup wizard steps (`#suEmailStep` … `#suUserStep`) — full-screen, grey→white
  Continue, shake on wrong code, green flash on correct.
- Categories step (`#suCatStep`) — sticky search + footer, fade-to-black + blur
  on scroll, back arrow auto-hides while scrolling.
- Date-of-birth wheels (`#suDobStep`) — Apple-style picker.
- Edit profile (`#profileOverlay`) — sticky header with Save pill, floating-label
  field boxes, edge-to-edge banner.
- Delete account (`#deleteAccountOverlay`) — single morphing button
  (white Continue → red Delete), no blink.
