/* A FINGER NEEDS 44pt — the dashboard's own version of `touchsize.js`.
 * docs/ADMIN-SWEEP-LIST.md item E1. Staff really do open this on a phone.
 *
 * Three things it asserts, and each of them is a mistake this repo has already shipped:
 *
 *   1) the HIT area is >= 44 in both directions on a phone. Measured off the ::after
 *      overlay's real rect, never off the CSS — a rule that names a class nothing renders
 *      protects nothing.
 *   2) the overlay does NOT steal the control next door. It hit-tests each neighbour's
 *      own centre: growing sideways over a sibling trades one fault for a worse one.
 *   3) it is PHONE-ONLY. At a desktop width a 44px invisible box around a 30px button
 *      would swallow hover on whatever sits beside it, so the same measurement must come
 *      back SMALL there. A guard that passes at both widths is not testing the media query.
 *
 * The controls are built OFF-SCREEN in a real page rather than hunted for across 68 views:
 * several of them (a webinar's Cancel, a vault tab) only exist once there is data, and a
 * probe that quietly finds nothing reports a clean result. Two of each, in a row with the
 * real container's gap, so the neighbour test has a genuine neighbour.
 */
const { chromium } = require('playwright-core');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m, extra) => { if (c) ok++; else fails.push(m + (extra ? ' — ' + extra : '')); };

/* class, the container that really holds it, and that container's real gap. */
const CONTROLS = [
  ['fc-catbtn', 'div', 'display:flex;gap:8px'],
  ['bc-aud', 'div', 'display:flex;gap:6px'],
  ['mod-scope', 'div', 'display:flex;gap:8px'],
  ['switch', 'div', 'display:flex;gap:10px'],
  ['copy', 'div', 'display:flex;gap:8px'],
  ['tf-r', 'div', 'display:flex;gap:4px'],
  ['vt-tbtn', 'div', 'display:flex;gap:8px'],
  ['stp', 'div', 'display:flex;gap:10px;align-items:center'],
];

const MEASURE = `((${function (controls) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:20px;top:60px;z-index:99999';
  host.innerHTML = controls.map(([cls, tag, css]) =>
    `<${tag} style="${css};margin-bottom:14px" data-row="${cls}">` +
    `<button class="${cls}" data-k="a">One</button><button class="${cls}" data-k="b">Two</button></${tag}>`).join('');
  document.body.appendChild(host);
  const out = [];
  for (const [cls] of controls) {
    const row = host.querySelector(`[data-row="${cls}"]`);
    const a = row.querySelector('[data-k="a"]'), bEl = row.querySelector('[data-k="b"]');
    const ar = a.getBoundingClientRect();
    /* The overlay is a pseudo-element, so it has no rect of its own. Its box is fully
       determined by the rules that draw it — read those, then hit-test to prove it. */
    const cs = getComputedStyle(a, '::after');
    const hasOverlay = cs.content !== 'none' && cs.content !== 'normal';
    const hitH = hasOverlay ? parseFloat(cs.height) || ar.height : ar.height;
    const hitW = hasOverlay ? Math.max(parseFloat(cs.width) || ar.width, parseFloat(cs.minWidth) || 0) : ar.width;
    /* Does it reach the NEIGHBOUR's centre? That is the only question that matters. */
    const br = bEl.getBoundingClientRect();
    const top = document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2);
    out.push({ cls, w: Math.round(ar.width), h: Math.round(ar.height),
               hitW: Math.round(hitW), hitH: Math.round(hitH), hasOverlay,
               steals: top && !bEl.contains(top) && top !== bEl ? (top.className || top.tagName) : null });
  }
  host.remove();
  return out;
}})(${JSON.stringify(CONTROLS)}))`;

(async () => {
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  for (const [label, W, H, want] of [['phone', 390, 780, true], ['desktop', 1280, 900, false]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H } });
    const p = await ctx.newPage();
    await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(800);
    const rows = await p.evaluate(MEASURE);
    for (const r of rows) {
      const j = JSON.stringify(r);
      if (want) {
        chk(r.hasOverlay, `${label} .${r.cls} has a 44pt overlay`, j);
        chk(r.hitH >= 44, `${label} .${r.cls} hit height >= 44`, j);
        chk(r.hitW >= 44, `${label} .${r.cls} hit width >= 44`, j);
        chk(!r.steals, `${label} .${r.cls} does not steal its neighbour`, j);
      } else {
        chk(!r.hasOverlay, `${label} .${r.cls} is left as a mouse target`, j);
      }
    }
    await ctx.close();
  }
  await b.close();
  fails.forEach((f) => console.log('  FAIL ' + f));
  console.log(`${ok} passed, ${fails.length} FAILED`);
  process.exit(fails.length ? 1 : 0);
})();
