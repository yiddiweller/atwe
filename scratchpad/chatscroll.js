/* HOW A CONVERSATION SCROLLS — three separate things, and two of them were confused.
 *
 * The founder asked for "the bounce while scrolling" gone. That is NOT the rubber band at
 * the ends, which they explicitly want KEPT — it is the per-bubble jelly: every bubble
 * carried its own underdamped spring, so they lagged and fanned apart as the thread moved.
 * A first pass removed the wrong one. Both are switches now (JELLY.rows / JELLY.edgeBounce)
 * and both are asserted here so they cannot be swapped again.
 *
 * The third thing is a real bug found on the way: `_jellyOff()` gated BOTH the per-bubble
 * fan AND the touch handlers, and the thread has no native scrolling underneath
 * (overflow:hidden + touch-action:none). So anyone with reduced-motion on could not scroll
 * a conversation AT ALL. The guards are split (`_jellyOff` / `_scrollOff`); the
 * reduced-motion case is asserted below.
 *
 * REAL touch events throughout — a programmatic SC.y write or a wheel never enters the
 * drag path where all of this lives, so either would pass on broken code.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

const DRAG = async (p, fromY, steps, dy) => p.evaluate(async ([fromY, steps, dy]) => {
  const el = document.getElementById('acThreadVP');
  const mk = (t, y) => new TouchEvent(t, { bubbles: true, cancelable: true,
    touches: t === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })],
    changedTouches: [new Touch({ identifier: 1, target: el, clientX: 195, clientY: y })] });
  el.dispatchEvent(mk('touchstart', fromY));
  for (let i = 1; i <= steps; i++) { el.dispatchEvent(mk('touchmove', fromY + i * dy)); await new Promise(r => setTimeout(r, 16)); }
  el.dispatchEvent(mk('touchend', fromY + steps * dy));
}, [fromY, steps, dy]);

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  const openChat = async (reduced) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => localStorage.setItem('atwe_token', t), process.env.TOK);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.waitForTimeout(400);
    await p.locator('#acListScreen .ac-item').first().click();
    await p.waitForTimeout(2600);
    return { ctx, p };
  };

  const { ctx, p } = await openChat(false);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  say(await p.evaluate(() => JELLY.edgeBounce === true), 'the edge rubber band is ON (the founder keeps it)');
  say(await p.evaluate(() => JELLY.rows === false), 'the per-bubble jelly is OFF');

  /* The bubbles must not move independently of the thread while it scrolls. */
  await p.evaluate(() => { window.__wob = 0; SC.y = SC.max / 2; SC.paint();
    const t = setInterval(() => { let m = 0;
      document.querySelectorAll('#acThread > *').forEach(r => { if (r._jy) m = Math.max(m, Math.abs(r._jy)); });
      window.__wob = Math.max(window.__wob, m); }, 16);
    setTimeout(() => clearInterval(t), 2200); });
  await DRAG(p, 600, 14, -30);
  await p.waitForTimeout(1400);
  const wob = await p.evaluate(() => +window.__wob.toFixed(2));
  say(wob < 0.5, `no per-bubble wobble while scrolling (worst displacement ${wob}px)`);

  /* …but the ends still give and spring back. */
  await p.evaluate(() => { SC.y = 0; SC.paint(); window.__peak = 0;
    const t = setInterval(() => { window.__peak = Math.min(window.__peak, SC.y); }, 16);
    setTimeout(() => clearInterval(t), 2600); });
  await DRAG(p, 200, 12, 30);
  await p.waitForTimeout(2000);
  const peak = await p.evaluate(() => +window.__peak.toFixed(1));
  const rest = await p.evaluate(() => +SC.y.toFixed(1));
  say(peak < -5, `the top still rubber-bands (pulled ${peak}px past it)`);
  say(Math.abs(rest) < 2, `and springs back to the edge (settled at ${rest})`);
  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();

  /* The bug behind the bug: reduced motion must not make the thread unscrollable. */
  const r = await openChat(true);
  const y0 = await r.p.evaluate(() => { SC.y = SC.max / 2; SC.paint(); return +SC.y.toFixed(1); });
  await DRAG(r.p, 600, 10, -30);
  await r.p.waitForTimeout(900);
  const y1 = await r.p.evaluate(() => +SC.y.toFixed(1));
  say(Math.abs(y1 - y0) > 20, `a reduced-motion user can still scroll a conversation (${y0} -> ${y1})`);
  await r.ctx.close();

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe thread scrolls as one piece, and the ends still give');
  process.exit(bad ? 1 : 0);
})();
