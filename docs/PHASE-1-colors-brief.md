# PHASE 1 BRIEF FOR CLAUDE CODE — COLORS ONLY (FINAL · LOCKED)

Read this entire document before writing any code. This is PHASE 1 of 2. In this phase you do ONE thing: repaint my ENTIRE existing website/app — every page, every screen, top to bottom, including login and signup — to the exact color system below. Do NOT add any animations, glows, lighting effects, cursor effects, or intro sequences in this phase — that is Phase 2, which I will give you separately after I approve the colors. Do not redesign layouts, components, spacing, or content. Only colors (plus the button/input recipes below, which are part of the color system).

## THE COLOR LAW

The entire design is based on THREE colors — BLACK, WHITE, BLUE — plus a little GREY:
- BLACK is the world: the background of every page is pure #000000; panels are near-black.
- WHITE is the voice: headings and primary text.
- BLUE is the one accent: #0A84FF — primary buttons, links, active states, focus. Nothing else is blue's job.
- GREY exists only for secondary/muted text and quiet glass surfaces.
Green, red, and yellow exist ONLY where their meaning requires them (success/call, destructive/error, warning). They are functional signals, never decoration, never theme colors. If any other color exists anywhere in the UI after this phase, the phase is not done.

## 1. TOKENS (add to the global stylesheet and Tailwind config; replace any existing palette)

```css
:root{
  /* SURFACES */
  --bg:#000000;            /* page background — every page, always     */
  --card:#0B0B0D;          /* cards, panels, sheets, modals, chat bubbles, result boxes */
  --elev:#141416;          /* inputs, nested/elevated blocks, disabled button fill */
  --divider:#3A3A3C;       /* true separators + the grey button hairline ONLY */

  /* TEXT */
  --ink:#FFFFFF;           /* headings & primary copy on dark           */
  --ink-2:#8E8E93;         /* secondary copy, captions, placeholders, inactive icons */
  --ink-3:#6E6E73;         /* muted text, fine print, timestamps        */
  --text-black:#1D1D1F;    /* any text on a light or yellow surface     */

  /* PRIMARY ACTION */
  --blue:#0A84FF;          /* primary buttons, links, active tabs, selection, focus */
  --blue-tint:#DBE9FF;     /* text on blue buttons — never pure white   */

  /* SEMANTIC — meanings only */
  --green:#30D158;  --green-edge:#66D98F;  --green-tint:#E6FFEF;
  --red:#FF453A;    --red-edge:#FF6B60;    --red-tint:#FFEAEA;
  --yellow:#FFCC00; --yellow-edge:#FFE066; /* yellow button text = --text-black */

  --ease:cubic-bezier(.22,.68,0,1);
}
```

If a light mode exists anywhere: background #FFFFFF, light cards #F5F5F7, primary text #1D1D1F, secondary #6E6E73, blue #007AFF. Dark is the default and primary target.

## 2. WHERE EACH COLOR GOES — apply literally, everywhere

Page background → --bg, always, every page. Cards, list containers, sheets, modals, dropdowns, received chat bubbles, result panels → --card. Inputs, toggles' tracks, nested blocks, disabled fills → --elev. Real separator lines → --divider at 0.5–1px.

Headings and primary copy → --ink. Secondary copy, captions, placeholders, inactive icons → --ink-2. Fine print, timestamps → --ink-3. Text on light or yellow surfaces → --text-black. Never pure-white text on any colored button fill — always the tint token.

Links, primary buttons, active tab states, selected items, progress, focus rings → --blue. Success states, accept/call actions, paid/complete badges → green family. Destructive actions, errors, delete confirms → red family. Warnings/attention → yellow with --text-black text.

CRITICAL DESIGN RULE — NO VISIBLE BORDERS ON BOXES: cards, panels, and containers have NO outlines, rings, or border strokes. They are dark shapes (--card) on black, separated by space and fill difference only. Remove every existing card/panel border. The only permitted hairlines are: real separator lines between list items/sections (--divider), the grey button's 0.5px hairline, and the semantic buttons' 0.5px edges (below). Inputs keep a 1px --divider border.

## 3. BUTTON SYSTEM (exact recipes)

Primary (blue): solid --blue pill, --blue-tint text, NO border/edge/outline of any kind.
Secondary (grey glass): rgba(255,255,255,.06) fill, 0.5px --divider inset hairline, backdrop-filter blur(10px), --ink text.
Semantic: vibrant fill + 0.5px lighter-edge hairline (their -edge token) + tinted text; yellow uses --text-black text.
States for all: hover filter:brightness(1.05); pressed filter:brightness(.85) + scale(.97); disabled = --elev fill, --ink-2 text, 40% opacity, no shadow, no hairline.

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  border:0;cursor:pointer;border-radius:999px;padding:13px 26px;
  font:600 15px/1 Inter,sans-serif;letter-spacing:-.01em;
  transition:transform .3s var(--ease),filter .25s var(--ease)}
.btn:hover{filter:brightness(1.05);transform:translateY(-1px)}
.btn:active{filter:brightness(.85);transform:scale(.97)}
.btn[disabled]{background:var(--elev);color:var(--ink-2);
  opacity:.4;pointer-events:none;box-shadow:none}

.btn-blue{background:var(--blue);color:var(--blue-tint)}          /* NO edge */
.btn-grey{background:rgba(255,255,255,.06);color:var(--ink);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  box-shadow:0 0 0 .5px var(--divider) inset}
.btn-green{background:var(--green);color:var(--green-tint);
  box-shadow:0 0 0 .5px var(--green-edge) inset}
.btn-red{background:var(--red);color:var(--red-tint);
  box-shadow:0 0 0 .5px var(--red-edge) inset}
.btn-yellow{background:var(--yellow);color:var(--text-black);
  box-shadow:0 0 0 .5px var(--yellow-edge) inset}
```

Inputs: --elev fill, 1px --divider border, --ink text, --ink-3 placeholder; focus = border-color --blue (no glow effects in this phase).

Typography: Inter everywhere; headlines 700–800 with letter-spacing −0.04 to −0.05em; body 400 at 15–17px in --ink-2; UI labels 600 at 13–14px.

## 4. SCOPE — every page, top to bottom

Repaint everything: login, signup, onboarding, home/feed, chats, search, profile, settings, store, wallet, jobs, admin, modals, toasts, empty states, error pages, emails if templated in-code. Hunt down and replace every hardcoded hex/rgb/hsl and every old Tailwind color class with the tokens above. Nothing outside this palette may remain — including in SVG icons, charts, shadows, gradients, and third-party component overrides. Icons: --ink-2 default, --ink when active, --blue when it signals the primary action.

## 5. ACCEPTANCE CHECKLIST (verify before reporting done)

Every page renders on pure #000 with --card panels and no visible box borders anywhere. All text uses the four text tokens correctly. The only blue anywhere is #0A84FF in its listed roles, with #DBE9FF text on blue buttons. Grey glass buttons show the 0.5px hairline; the blue button shows none. Green/red/yellow appear only in their semantic roles, with hairlines and correct text colors (dark text on yellow). Hover/press/disabled states behave as specified. A global grep for color values finds nothing outside Section 1 tokens.

DELIVER BACK: a list of files/components changed, any places where a color's role was ambiguous and what you chose (I'll review), and screenshots of: login, the main page, a form, and one screen showing a semantic (green/red/yellow) action.

When I approve Phase 1, I will send Phase 2: the lighting and animation system that runs on top of these exact tokens. Do not anticipate or pre-build any of it.
