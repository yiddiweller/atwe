/* OPENING A CONVERSATION LANDS AT THE BOTTOM, AND THE JUMP-TO-LATEST PILL IS THE BAR.
 *
 * Two things the owner asked for in one pass:
 *
 * 1. "When I open a chat it should take you right away to the bottom, like WhatsApp and
 *    Telegram." It used to jump to the "New messages" divider whenever there were unread
 *    ones — which is what those apps do, but with a long unread run it drops you into the
 *    middle of the conversation. That is checked HERE THE ONLY WAY IT CAN BE: by sampling
 *    the scroller every frame from the tap, and asserting that the FIRST FRAME IN WHICH
 *    THE THREAD IS VISIBLE AT ALL is already at the bottom. A check that measures after it
 *    has settled passes on a thread that visibly starts at the top and jumps.
 *
 * 2. "A small arrow… same design as the text bar, a little see-through with a small outline
 *    and the same colour." So the pill's fill, blur and edge are compared against the
 *    composer's own COMPUTED values rather than against a hardcoded colour — they share
 *    --bar-glass / --bar-glass-blur / --bar-glass-edge, and this fails the moment one of
 *    them is given a value of its own again.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  for (const theme of ['black', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });

    /* Sample from BEFORE the tap: the interesting frames are the first few, and a
       waitForTimeout then a single read would miss all of them. */
    await p.evaluate(() => {
      window.__s = []; const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector('.msg-scroll-vp');
        const inner = el && (el.querySelector('.msg-scroll') || el);
        window.__s.push({ t: Math.round(performance.now() - t0),
          y: el ? Math.round(el.scrollTop) : -1,
          max: el ? Math.round(el.scrollHeight - el.clientHeight) : -1,
          vis: inner ? +(+getComputedStyle(inner).opacity).toFixed(2) : 0 });
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
    await p.waitForTimeout(3100);

    const s = await p.evaluate(() => window.__s);
    const painted = s.filter((f) => f.max > 0 && f.vis > 0.05);
    const first = painted[0], last = s[s.length - 1];
    say(!!first, `${theme}: the conversation paints${first ? '' : ' — never did'}`);
    if (first) {
      say(first.max - first.y <= 4,
        `${theme}: and its very first visible frame is already at the bottom (${first.y} of ${first.max})`);
      /* A long thread is the case that matters — a chat with three messages is at the
         bottom by having nowhere else to be. */
      say(first.max > 400, `${theme}: on a thread long enough for that to mean something (${first.max}px of history)`);
      say(last.max - last.y <= 16, `${theme}: and it is still there once everything has settled (${last.max - last.y}px off)`);
    }
    say(await p.evaluate(() => typeof acScrollToDivider === 'undefined'),
      `${theme}: the old jump-to-the-unread-divider path is gone, not just unused`);

    /* The pill: same material as the bar, by comparison rather than by a fixed colour. */
    await p.evaluate(() => { const el = document.querySelector('.msg-scroll-vp');
      el.scrollTop -= 700; el.dispatchEvent(new Event('scroll')); });
    await p.waitForTimeout(700);
    const m = await p.evaluate(() => {
      const a = document.getElementById('acScrollDown'), c = document.querySelector('.msg-inbox');
      const A = getComputedStyle(a), C = getComputedStyle(c);
      return { shown: a.classList.contains('show'),
        same: A.backgroundColor === C.backgroundColor
          && (A.backdropFilter || A.webkitBackdropFilter) === (C.backdropFilter || C.webkitBackdropFilter)
          && A.borderTopColor === C.borderTopColor && A.borderTopWidth === C.borderTopWidth,
        bg: A.backgroundColor, blur: A.backdropFilter || A.webkitBackdropFilter,
        edge: A.borderTopWidth + ' ' + A.borderTopColor, shadow: A.boxShadow,
        seeThrough: !/^rgb\(/.test(A.backgroundColor.trim()) };
    });
    say(m.shown, `${theme}: scrolling up offers the arrow`);
    say(m.same, `${theme}: it is the same material as the message bar (${m.bg} · ${m.blur} · ${m.edge})`);
    say(m.seeThrough, `${theme}: see-through, not a solid disc`);
    say(m.shadow === 'none', `${theme}: and no drop shadow — the bar it matches has none`);
    say(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nA chat opens at the bottom, and the arrow is made of the same glass as the bar');
  process.exit(bad ? 1 : 0);
})();
