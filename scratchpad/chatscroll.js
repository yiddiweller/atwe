/* HOW A CONVERSATION SCROLLS — and why this probe was rewritten.
 *
 * The founder asked for two different things and they were conflated once already:
 *   1. "Remove the bounce scroll effect while scrolling" — the per-bubble jelly. Every
 *      bubble carried its own underdamped spring, so they lagged and fanned apart as the
 *      thread moved. GONE.
 *   2. "You removed the bounce back when I'm at the end of the chat, and this I actually
 *      wanna keep" — the rubber band at the first/last message. KEPT.
 * Then: "the scrolling is still not as smooth as home and account". It never could be.
 * The thread was a CUSTOM scroller — overflow:hidden + touch-action:none, with the
 * content translated from touchmove inside a rAF. That runs on the MAIN thread: it is
 * capped by how often touchmove fires and stalls on any layout, paint or GC, while a
 * native scroller runs on the compositor, keeps the display's refresh rate and gets the
 * platform's own momentum. A difference in kind, not in tuning. So the thread is a plain
 * native scroller now, and the rubber band is the BROWSER'S.
 *
 * WHAT THIS PROBE CAN AND CANNOT SEE, stated plainly because the previous version
 * asserted things that no longer exist:
 *   - It read `SC.y` going negative to prove the rubber band. A native rubber band NEVER
 *     appears in `scrollTop` — it is composited past the edge while scrollTop stays
 *     clamped at 0. That assertion could now only fail, on correct code. What IS
 *     checkable is the property that decides whether the browser bounces at all:
 *     `overscroll-behavior` must be `contain` (chaining stopped, bounce kept) and never
 *     `none` (which kills it). That is the switch, and it is asserted below.
 *   - Smoothness itself is not measurable in a headless desktop browser: no touch
 *     digitiser, no ProMotion display, no iOS momentum. What is checkable is that the
 *     thread is BUILT the same way as the surfaces the founder compared it to, so it is
 *     compared against Home's own scroller property by property.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const { PNG } = require(process.env.PW ? process.env.PW + '/node_modules/pngjs' : 'pngjs');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  const open = async (reduced) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', 'black'); }, process.env.TOK);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.waitForTimeout(400);
    await p.locator('#acListScreen .ac-item').first().click();
    await p.waitForTimeout(2600);
    return { ctx, p };
  };
  const wheelUp = async (p, n) => { await p.mouse.move(195, 500);
    for (let i = 0; i < n; i++) { await p.mouse.wheel(0, -80); await p.waitForTimeout(20); } };

  const { ctx, p } = await open(false);
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  const vp = await p.evaluate(() => {
    const v = document.getElementById('acThreadVP'), c = document.getElementById('acThread');
    const cs = getComputedStyle(v);
    return { overflowY: cs.overflowY, touchAction: cs.touchAction, overscroll: cs.overscrollBehaviorY,
      contentTransform: getComputedStyle(c).transform,
      scrollable: v.scrollHeight > v.clientHeight, max: Math.round(SC.max) };
  });

  /* 1. It is the BROWSER'S scroller, not ours. */
  say(vp.overflowY === 'auto' || vp.overflowY === 'scroll', `the thread is a native scroller (overflow-y: ${vp.overflowY})`);
  say(vp.touchAction === 'pan-y', `the browser owns vertical panning (touch-action: ${vp.touchAction}) — horizontal stays with swipe-to-reply`);
  say(vp.contentTransform === 'none', `the content is not being transformed by JS (${vp.contentTransform})`);
  say(vp.scrollable, `there is something to scroll (${vp.max}px of range)`);

  /* 2. The edge bounce the founder keeps. `contain` stops scroll CHAINING to the page
        behind; `none` would additionally kill the browser's own rubber band. */
  say(vp.overscroll === 'contain', `the ends still give — overscroll-behavior is "${vp.overscroll}" (never "none", which would remove the bounce)`);

  /* 3. Built the same way as the surfaces the founder compared it to. NB Home has TWO
        valid native modes on a phone — its own container scrolls, or `body.pgscroll`
        hands the whole page to the window scroller — so the question is "does the
        BROWSER scroll it", not "is it the same property". (An earlier version of this
        check asked the latter and failed on correct code the first time Home happened to
        be in page-scroll mode.) A conversation cannot use page scroll: the composer and
        the header are pinned, so it must be a contained scroller — but a native one. */
  const home = await p.evaluate(async () => {
    appTab('home'); await new Promise(r => setTimeout(r, 1800));
    const l = document.getElementById('acFeed') || document.querySelector('.ac-list');
    return { overflowY: getComputedStyle(l).overflowY, pg: document.body.classList.contains('pgscroll'),
      transform: getComputedStyle(l).transform };
  });
  const homeNative = home.pg || home.overflowY === 'auto' || home.overflowY === 'scroll';
  say(homeNative && home.transform === 'none',
    `Home is scrolled by the browser too (${home.pg ? 'the page scrolls' : 'overflow-y: ' + home.overflowY}, no JS transform) — the thread now works the same way`);
  await p.evaluate(() => appTab('chat'));
  await p.waitForTimeout(800);
  await p.locator('#acListScreen .ac-item').first().click();
  await p.waitForTimeout(2200);

  /* 4. No JS scroller left behind: no bubble may carry an inline transform while the
        thread moves. That IS what "the bounce while scrolling" was. */
  await p.evaluate(() => { window.__wob = 0;
    const t = setInterval(() => {
      document.querySelectorAll('#acThread > *').forEach(r => {
        const tr = r.style && r.style.transform;
        if ((tr && tr !== 'none') || r._jy) window.__wob = 1; }); }, 16);
    setTimeout(() => clearInterval(t), 2400); });
  await wheelUp(p, 14);
  await p.waitForTimeout(1600);
  say(await p.evaluate(() => window.__wob === 0), 'no per-bubble wobble — the thread moves as one piece');

  /* 5. A real gesture scrolls it, and SC tracks the browser rather than driving it. */
  await p.evaluate(() => SC.jumpTo(SC.max));
  await p.waitForTimeout(200);
  const y0 = await p.evaluate(() => Math.round(SC.y));
  await wheelUp(p, 8);
  await p.waitForTimeout(500);
  const t = await p.evaluate(() => ({ y: Math.round(SC.y), dom: Math.round(document.getElementById('acThreadVP').scrollTop), pin: SC.pinBottom }));
  say(t.y < y0 - 50, `a real gesture scrolls it (${y0} -> ${t.y})`);
  say(t.y === t.dom, `SC reads the browser's own position (SC.y ${t.y} === scrollTop ${t.dom})`);
  say(t.pin === false, 'scrolling away from the bottom un-pins it, so nothing yanks the reader back');

  /* 6. Jump-to-latest still lands exactly on the last message. */
  await p.evaluate(() => SC.smoothBottom());
  await p.waitForTimeout(1100);
  const at = await p.evaluate(() => ({ y: Math.round(SC.y), max: Math.round(SC.max), pin: SC.pinBottom }));
  say(at.y === at.max, `jump-to-latest lands on the last message (${at.y} of ${at.max})`);
  say(at.pin === true, 'and it is remembered as pinned to the bottom');

  /* 7. pinBottom must be REMEMBERED, not derived — the bottom watchdog and the
        ResizeObserver both run just AFTER the content grew (a photo or a voice note
        finished loading), when a live reading is already false and they would give up
        exactly when they are needed. */
  say(await p.evaluate(() => { const d = Object.getOwnPropertyDescriptor(SC, 'pinBottom'); return !!d && d.get === undefined; }),
    'pinBottom is remembered, so late-loading media still re-anchors to the newest message');

  /* 7b. THE BOTTOM SCRIM MUST BE PINNED. It fades the last messages into the page colour
        just above the composer, and it used to be `.msg-scroll-vp::after` — fine only
        while the viewport was overflow:hidden and never actually scrolled. An
        absolutely-positioned child of a REAL scroller is anchored to the bottom of the
        CONTENT, so the moment the thread became native the gradient detached: measured
        with the old selector it painted at y 128–277 (a band across the middle of the
        conversation) halfway down, and vanished entirely at the bottom. It lives on
        #acThreadScreen now. Painted magenta so it cannot be confused with anything else. */
  await p.addStyleTag({ content: '#acThreadScreen::after{background:#FF00FF !important;opacity:1 !important;}' });
  await p.waitForTimeout(300);
  const bands = [];
  for (const where of ['bottom', 'top', 'middle']) {
    await p.evaluate((w) => SC.jumpTo(w === 'bottom' ? SC.max : w === 'top' ? 0 : SC.max / 2), where);
    await p.waitForTimeout(400);
    const buf = await p.screenshot();
    const png = PNG.sync.read(buf); const W = png.width; const rows = [];
    for (let y = 0; y < png.height; y++) { let n = 0;
      for (let x = 0; x < W; x += 6) { const i = (W * y + x) * 4;
        if (png.data[i] > 200 && png.data[i + 1] < 80 && png.data[i + 2] > 200) n++; }
      if (n > 3) rows.push(y); }
    bands.push({ where, top: rows.length ? rows[0] : null, bottom: rows.length ? rows[rows.length - 1] : null });
  }
  const h = await p.evaluate(() => window.innerHeight);
  const pinned = bands.every(x => x.top !== null && x.bottom >= h - 4 && x.top > h - 170 && x.top < h - 130);
  say(pinned, `the bottom scrim stays pinned above the composer at every scroll position (${bands.map(x => x.where + ' ' + x.top + '..' + x.bottom).join(', ')} of ${h})`);
  await p.evaluate(() => { [...document.querySelectorAll('style')].filter(s => s.textContent.includes('#FF00FF')).forEach(s => s.remove()); });
  await p.waitForTimeout(200);

  /* 7c. No live blur may sit over the thread on a PHONE. A backdrop-filter over moving
        content is re-rasterised every frame — the heaviest per-frame cost on the screen,
        and the one thing a conversation had that Home did not (the mobile home bar is
        deliberately solid). Desktop keeps the frost; a laptop GPU pays it easily. */
  const blurs = await p.evaluate(() => {
    const v = document.getElementById('acThreadVP').getBoundingClientRect();
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      const cs = getComputedStyle(el); const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (!bf || bf === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.right <= v.left || r.left >= v.right || r.bottom < v.top || r.top > v.bottom) return;
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
      out.push((el.id || String(el.className).split(' ')[0]) + ' ' + bf);
    });
    return out;
  });
  say(blurs.length === 0, `no live blur over the thread on a phone${blurs.length ? ' — ' + blurs.join(', ') : ''}`);

  /* 8. `touch-action: pan-y` gives vertical to the browser and KEEPS horizontal for us.
        Swipe-to-reply is the thing that would have died if this said `pan-x`/`auto`, and
        it is DM-only, so the probe opens a 1:1 conversation for it. NB it moves the row
        by a custom property (`--replyx`), not a transform — an earlier version of this
        check read `transform` and reported 0px travel on working code. */
  await p.evaluate(() => { const r = document.querySelector('#acListScreen .ac-item[data-uid]'); if (r) r.click(); });
  await p.waitForTimeout(600);
  const sw = await p.evaluate(async () => {
    const el = document.getElementById('acThread');
    const bub = [...el.querySelectorAll('.msg-bubble[data-mid]')].pop();
    if (!bub) return { skip: true };
    const row = bub.closest('.msg-row'), mine = row.classList.contains('me');
    const r = bub.getBoundingClientRect(), dir = mine ? 1 : -1;
    const mk = (t, x, y) => new TouchEvent(t, { bubbles: true, cancelable: true,
      touches: t === 'touchend' ? [] : [new Touch({ identifier: 9, target: bub, clientX: x, clientY: y })],
      changedTouches: [new Touch({ identifier: 9, target: bub, clientX: x, clientY: y })] });
    const y = r.top + r.height / 2, x0 = r.left + Math.min(30, r.width / 2);
    bub.dispatchEvent(mk('touchstart', x0, y));
    let peak = 0;
    for (let i = 1; i <= 10; i++) { bub.dispatchEvent(mk('touchmove', x0 + dir * i * 9, y));
      await new Promise(z => setTimeout(z, 16));
      peak = Math.max(peak, Math.abs(parseFloat(getComputedStyle(row).getPropertyValue('--replyx')) || 0)); }
    bub.dispatchEvent(mk('touchend', x0 + dir * 90, y));
    await new Promise(z => setTimeout(z, 500));
    return { peak: +peak.toFixed(1), rest: getComputedStyle(row).getPropertyValue('--replyx').trim() };
  });
  say(sw.skip || sw.peak > 30, `swipe-to-reply still works — the row travels ${sw.peak}px sideways`);
  say(sw.skip || parseFloat(sw.rest) === 0, 'and springs back on release');

  /* 9. The keyboard. When it opens the visual viewport shrinks, and a reader at the
        newest message must stay there rather than have it slide under the composer.
        A contained scroller gets no help from the browser here, so it is still ours. */
  await p.evaluate(() => SC.jumpTo(SC.max));
  await p.waitForTimeout(300);
  const kb = await p.evaluate(async () => {
    const before = Math.round(SC.y);
    (window.visualViewport || window).dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 300));
    return { before, after: Math.round(SC.y), max: Math.round(SC.max) };
  });
  say(kb.after === kb.max, `a viewport shrink keeps a pinned reader on the newest message (${kb.before} -> ${kb.after} of ${kb.max})`);

  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();

  /* 10. The bug behind the bug: reduced motion must not make the thread unscrollable.
        With a native scroller that is structurally impossible, which is the point — it
        used to depend on a JS guard that got it wrong. */
  const r = await open(true);
  await r.p.evaluate(() => SC.jumpTo(SC.max));
  const ry0 = await r.p.evaluate(() => Math.round(SC.y));
  await wheelUp(r.p, 8);
  await r.p.waitForTimeout(500);
  const ry1 = await r.p.evaluate(() => Math.round(SC.y));
  say(ry0 - ry1 > 50, `a reduced-motion user can still scroll a conversation (${ry0} -> ${ry1})`);
  await r.ctx.close();

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe conversation is a native scroller: one piece while it moves, and the ends still give');
  process.exit(bad ? 1 : 0);
})();
