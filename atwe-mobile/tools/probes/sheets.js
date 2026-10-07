/* Every sheet whose body was wrapped in <SheetGlass> must still OPEN and still
   show a real, visible primary button.
   The risk of that wrap was a mangled span silently swallowing a sheet's body —
   something no type check can see — so this drives the real UI and measures the
   button's PAINTED box, not just its presence in the DOM.
   The sheet is opened by its PageHeader action's aria-label, and the CTA is the
   Button title read out of the source, so neither is guessed. */
const { chromium } = require(process.env.PW + '/node_modules/playwright-core');
const CHROME = process.env.CHROME
  || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:4399';
const B = BASE;

const CASES = [
  ['/lists',         'New list',            'Make the list'],
  ['/pools',         'Start a pool',        'Start it'],
  ['/payment-links', 'New link',    'Make the link'],
  ['/coupons',       'New code',   'Make the code'],
  ['/broadcasts',    'New list',  'Make the list'],
  ['/chat-labels',   'New label',           'Make the label'],
  ['/bundles',       'New bundle',          'Make the bundle'],
];

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await p.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('atwe_token', t), process.env.TOK);

  let bad = 0, opened = 0;
  for (const [route, opener, cta] of CASES) {
    await p.goto(B + route, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2800);
    const btn = p.locator(`[aria-label="${opener}"]`).first();
    if (!(await btn.count())) { console.log(`  ✗    ${route.padEnd(16)} opener "${opener}" not on the page`); bad++; continue; }
    await btn.click({ timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(1400);
    opened++;
    const info = await p.evaluate((label) => {
      const els = [...document.querySelectorAll('*')]
        .filter((e) => !e.children.length && (e.textContent || '').trim() === label);
      if (!els.length) return { found: false };
      for (const e of els) {
        const r = e.getBoundingClientRect();
        if (r.width > 30 && r.height > 8) {
          const cs = getComputedStyle(e);
          return { found: true, w: Math.round(r.width), h: Math.round(r.height),
                   top: Math.round(r.top), onScreen: r.top >= 0 && r.top < window.innerHeight,
                   vis: cs.visibility, op: cs.opacity };
        }
      }
      return { found: true, painted: false };
    }, cta);
    const ok = info.found && info.onScreen && info.w > 30 && info.vis !== 'hidden' && Number(info.op) > 0.5;
    console.log(`  ${ok ? 'ok  ' : '✗   '} ${route.padEnd(16)} "${cta}"  ${JSON.stringify(info)}`);
    if (!ok) bad++;
  }
  console.log(`\n${opened} sheets opened · ${bad} bad · ${errs.length} page errors`);
  errs.slice(0, 5).forEach((e) => console.log('   ' + e));
  await b.close();
  process.exit(bad || errs.length ? 1 : 0);
})();
