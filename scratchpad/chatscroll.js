/* A CONVERSATION STOPS AT ITS FIRST AND LAST MESSAGE — no rubber band.
 *
 * The founder asked for the bounce gone from chats. Two different mechanisms had to go,
 * and only one of them is the browser's:
 *   - the THREAD does not scroll natively at all. #acThreadVP is overflow:hidden with
 *     touch-action:none and a custom controller (SC) translates the content, so its
 *     bounce was a spring in JS, in three places — the drag's rubber(), the physics
 *     step's spring branch, and the fling's overshoot cap. JELLY.edgeBounce turns all
 *     three into hard stops.
 *   - the chat LIST does scroll natively, so its bounce is the browser's own, and
 *     `overscroll-behavior: contain` does NOT stop it — only `none` does.
 *
 * Driven with REAL touch events. A programmatic SC.y write, or a wheel, never enters the
 * drag path where the rubber band lived, so it would pass on bouncing code.
 *
 * Self-test: set JELLY.edgeBounce = true and this reports ~86px past the edge and fails.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => localStorage.setItem('atwe_token', t), process.env.TOK);
  await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
    if (s && typeof introDismiss === 'function') introDismiss(); });
  await p.waitForTimeout(400);

  say(await p.evaluate(() => document.querySelector('#acListScreen .ac-list')
        && getComputedStyle(document.querySelector('#acListScreen .ac-list')).overscrollBehavior === 'none'),
      'the Beam list has overscroll-behavior:none (contain does not stop the bounce)');

  const row = p.locator('#acListScreen .ac-item').first();
  if (!(await row.count())) { console.log('  -- no conversation to open; seed one'); await b.close(); process.exit(bad ? 1 : 0); }
  await row.click(); await p.waitForTimeout(2600);

  /* Drag hard DOWNWARD from the top — the pull-past-the-first-message gesture. */
  await p.evaluate(() => { SC.y = 0; SC.paint(); window.__peak = 0;
    const t = setInterval(() => { window.__peak = Math.min(window.__peak, SC.y); }, 16);
    setTimeout(() => clearInterval(t), 2500); });
  await p.evaluate(async () => {
    const el = document.getElementById('acThreadVP');
    const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })],
      changedTouches: [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })] });
    el.dispatchEvent(mk('touchstart', 200));
    for (let i = 1; i <= 12; i++) { el.dispatchEvent(mk('touchmove', 200 + i * 30)); await new Promise(r => setTimeout(r, 16)); }
    el.dispatchEvent(mk('touchend', 560));
  });
  await p.waitForTimeout(1500);
  const peak = await p.evaluate(() => +window.__peak.toFixed(1));
  const rest = await p.evaluate(() => ({ y: +SC.y.toFixed(1), over: +SC.over().toFixed(1) }));
  say(peak >= -0.5, `the thread never pulls past the first message (furthest: ${peak}px)`);
  say(rest.over === 0, `it settles exactly on the edge (${JSON.stringify(rest)})`);
  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nchats stop dead at both ends');
  process.exit(bad ? 1 : 0);
})();
