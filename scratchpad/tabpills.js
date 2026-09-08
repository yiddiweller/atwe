/* A ROW OF CHOICES IS A ROW OF BUTTONS, NEVER A ROW OF WORDS.
 *
 * The founder's design team, and the reason is recognition: every "pick one of these"
 * row in the app must be the same object — a grey pill at rest, a WHITE pill for the
 * one you are on (near-black in Light; --primary/--on-primary flip per theme).
 *
 * What this guards:
 *  1. every tab in a row is a real pill — a fill of its own, and a corner that is
 *     half its height (a true capsule at whatever size it renders);
 *  2. the resting fill is the shared --tab-fill, so no row can drift onto its own grey;
 *  3. EXACTLY ONE tab per row carries the selected fill, and that fill is --primary —
 *     asserted against the theme's own token, never against the literal colour white,
 *     because on Light the selected tab is near-black;
 *  4. "Add" at the end of the Home/Beam row is NOT a pill: it is an extra action, not
 *     one of the choices, and must stay a bare quiet word;
 *  5. no tab still draws the old underline;
 *  6. a RESTING tab carries a rim and the SELECTED one does not — measured off the
 *     Apple Fitness+ row the founder sent as the reference, where the unselected pill
 *     has a one-physical-pixel hairline and the white pill has none at all;
 *  7. a resting LABEL is full strength. Apple's unselected labels read 247-254; ours
 *     were a dimmed grey and visibly receded beside them. The fill says which tab you
 *     are on, so the text does not have to.
 *
 * Self-test: point any tab family back at --accent-dim, or give .tb-feedtab
 * background:none, and this goes red.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m) => { if (c) ok++; else fails.push(m); };

/* Each row is found from one of its TABS, not from a container id: Home, Beam and
   Engine all render a .tb-feedtabs and only one of them is on screen, so naming the
   container matches a hidden sibling and the check quietly finds nothing. */
const ROWS = [
  { name: 'Home',          go: null,                         tab: '.tb-feedtab:not(.tb-feedtab-add)' },
  { name: 'Beam',          go: "appTab('chat')",             tab: '.tb-feedtab:not(.tb-feedtab-add)' },
  { name: 'Engine',        go: "appTab('search')",           tab: '.tb-feedtab:not(.tb-feedtab-add)' },
  { name: 'Notifications', go: 'acNavNotifs()',              tab: '.ntf-tab' },
  { name: 'Profile',       go: "acGoProfile('emptytester')", tab: '.ac-ptab' },
  { name: 'Events',        go: 'acOpenEvents()',             tab: '.ev-tab' },
  { name: 'Bookings',      go: "acOpenBookings('guest')",    tab: '.bk-tab' },
];

(async () => {
  const tok = fs.readFileSync('/tmp/tok.txt', 'utf8').trim();
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.addInitScript(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); }, [tok, theme]);
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    for (const row of ROWS) {
      if (row.go) { await p.evaluate((g) => { try { eval(g); } catch (e) {} }, row.go); await p.waitForTimeout(1800); }
      const r = await p.evaluate((sel) => {
        const tokenOf = (v) => { const s = document.createElement('span');
          s.style.cssText = 'position:fixed;left:-9999px;background:' + v;
          document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; };
        const primary = tokenOf('var(--primary)'), fill = tokenOf('var(--tab-fill)');
        const seed = [...document.querySelectorAll(sel)].find((e) => {
          const q = e.getBoundingClientRect(); return q.width > 8 && q.height > 8;
        });
        if (!seed) return { missing: true };
        const host = seed.parentElement;
        const key = (seed.className || '').split(/\s+/)[0];
        const tabs = [...host.children].filter((e) => e.tagName === 'BUTTON'
          && (e.className || '').split(/\s+/)[0] === key
          && !e.classList.contains('tb-feedtab-add') && e.getBoundingClientRect().height > 10);
        const add = host.querySelector('.tb-feedtab-add');
        return {
          n: tabs.length, primary, fill,
          ink: tokenOf('var(--tab-ink)'),
          rows: tabs.map((e) => { const q = e.getBoundingClientRect(); const cs = getComputedStyle(e);
            return { bg: cs.backgroundColor, rad: parseFloat(cs.borderRadius) || 0, h: q.height,
              sh: cs.boxShadow, img: cs.backgroundImage, fg: cs.color,
              under: getComputedStyle(e, '::after').content !== 'none' && parseFloat(getComputedStyle(e, '::after').height) > 0 };
          }),
          addBg: add ? getComputedStyle(add).backgroundColor : null,
        };
      }, row.tab);
      const T = `${theme} ${row.name}:`;
      if (r.missing || !r.n) { chk(false, `${T} the tab row was not found`); continue; }
      chk(r.rows.every((t) => t.rad >= t.h / 2 - 1), `${T} every tab is a full capsule`);
      const on = r.rows.filter((t) => t.bg === r.primary);
      chk(on.length === 1, `${T} exactly one tab carries the selected fill (${on.length} of ${r.n})`);
      chk(r.rows.filter((t) => t.bg === r.fill).length === r.n - on.length,
        `${T} every other tab is the shared resting grey`);
      chk(!r.rows.some((t) => t.under), `${T} no tab still draws an underline`);
      const rest = r.rows.filter((t) => t.bg !== r.primary);
      /* THE RIM IS A BOX-SHADOW NOW, not a border — the login button's own hairline,
         which can be HALF a pixel where a border rounds up. Read the shadow. */
      chk(rest.every((t) => t.sh && t.sh !== 'none' && /inset/.test(t.sh)),
        `${T} every resting tab carries the inset hairline`);
      chk(on.every((t) => t.sh === 'none'),
        `${T} ...and the selected one does not (${on.map((t) => t.sh).join(',')})`);
      /* THE RESTING FILL MUST BE OPAQUE, and this check exists because the first pass at
         copying the login button was not. `.auth-btn` is a .06 white WASH — free on a page
         with only black behind it, but shot over a bright photo the pills let the picture
         straight through and the labels bled from dark grey to near-white. */
      chk(rest.every((t) => !/rgba\([^)]*,\s*0?\.\d+\)/.test(t.bg)),
        `${T} and it is OPAQUE — a photo can never show through a tab (${rest[0] ? rest[0].bg : '-'})`);
      chk(rest.every((t) => /gradient/.test(t.img || '')),
        `${T} with the login button's own wash lifting its lower edge`);
      chk(rest.every((t) => t.fg === r.ink),
        `${T} a resting label is full strength, not dimmed (${rest[0] ? rest[0].fg : '-'} for ${r.ink})`);
      if (r.addBg !== null) chk(r.addBg === 'rgba(0, 0, 0, 0)', `${T} "Add" stays a bare word, not a pill (${r.addBg})`);
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => closeOverlay(o.id, true)); });
      await p.waitForTimeout(400);
    }
    await ctx.close();
  }
  /* EVERY family, including the ones that are awkward to navigate to (a wallet with
     no history never renders its filter row; .ac-jv is a generic pill used in dozens
     of places). Render one of each off-screen and read what the RULES resolve to —
     that is what actually has to be shared, and it cannot go stale as screens move. */
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    const FAMILIES = ['tb-feedtab', 'ac-scope-chip', 'ac-ptab', 'ntf-tab', 'ev-tab', 'bk-tab',
      'ac-jv', 'wf-chip', 'sell-sortchip', 'fb-cat', 'ac-jbtab', 'ja-fchip', 'dir-ind',
      'svc-cat', 'rx-tab', 'rev-chip', 'stt-chip', 'ev-seg-btn', 'cash-stab', 'cash-range'];
    for (const theme of ['black', 'light']) {
      const res = await p.evaluate(([fams, th]) => {
        document.body.classList.toggle('light', th === 'light');
        const tokenOf = (v) => { const s = document.createElement('span');
          s.style.cssText = 'position:fixed;left:-9999px;background:' + v;
          document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; };
        const primary = tokenOf('var(--primary)'), fill = tokenOf('var(--tab-fill)');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-9999px;top:0;';
        document.body.appendChild(host);
        const out = fams.map((f) => {
          const a = document.createElement('button'); a.className = f; a.textContent = 'x';
          const b = document.createElement('button'); b.className = f + ' on active'; b.textContent = 'x';
          host.append(a, b);
          const r = { f, rest: getComputedStyle(a).backgroundColor, on: getComputedStyle(b).backgroundColor };
          a.remove(); b.remove(); return r;
        });
        host.remove();
        return { primary, fill, out };
      }, [FAMILIES, theme]);
      const bad = res.out.filter((r) => r.rest !== res.fill);
      chk(bad.length === 0, `${theme}: every tab family rests on the shared grey (${bad.map((b) => b.f).join(', ')})`);
      const badOn = res.out.filter((r) => r.on !== res.primary);
      chk(badOn.length === 0, `${theme}: every tab family selects to the shared white (${badOn.map((b) => b.f).join(', ')})`);
    }
    await ctx.close();
  }

  await b.close();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'a row of choices is a row of buttons');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
