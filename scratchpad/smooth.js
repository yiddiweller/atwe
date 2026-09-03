/* NOTHING IN A CONVERSATION APPEARS — IT ARRIVES.
 *
 * The owner's words: "I don't want everything should be like boom effect, I want it should
 * rather be smooth like zooming in like a bubble, all those stuff, Apple style." Two things
 * in the chat were doing exactly that, and both are measured here by SAMPLING over time
 * rather than by reading a CSS rule — a transition declared on a property nothing writes
 * animates nothing, and only a sampled curve can tell the difference.
 *
 *  1. THE COMPOSER growing to a second line. This is not one animation but two: the
 *     textarea's own height (a plain transition, since acAutosize writes it in px) and the
 *     WRAP, which is a layout change no transition can carry — the buttons drop onto a row
 *     of their own the instant .multiline lands. That half is done by measuring the box
 *     before and after and animating between the two numbers (_barMorph).
 *  2. THE PRESENCE DOT. It used to be display:none → visible. Now it scales up with a
 *     little overshoot and the space it takes opens with it.
 *
 * WHAT A PASSING SAMPLE LOOKS LIKE: several DISTINCT intermediate values between the start
 * and the end. A jump gives exactly two values however fast you sample, which is the one
 * thing this can prove.
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
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
    await p.waitForTimeout(1500);

    /* ── 1. the bar grows through the wrap ── */
    const grow = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      inp.value = ''; acAutosize(); await new Promise(r => setTimeout(r, 400));
      const seen = [];
      const t0 = performance.now();
      const tick = () => { seen.push(+bar.getBoundingClientRect().height.toFixed(1));
        if (performance.now() - t0 < 420) requestAnimationFrame(tick); };
      inp.value = 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan';
      acAutosize();
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 520));
      return { start: seen[0], end: seen[seen.length - 1], uniq: [...new Set(seen)].length, n: seen.length };
    });
    say(grow.end > grow.start + 20, `${theme}: the bar really does grow for a second line (${grow.start} → ${grow.end})`);
    say(grow.uniq >= 6, `${theme}: and it TRAVELS there — ${grow.uniq} distinct heights across ${grow.n} frames (a jump gives 2)`);

    /* Shrinking back is the same animation in reverse; a one-way ease reads as a snap. */
    const shrink = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      const seen = []; const t0 = performance.now();
      const tick = () => { seen.push(+bar.getBoundingClientRect().height.toFixed(1));
        if (performance.now() - t0 < 420) requestAnimationFrame(tick); };
      inp.value = 'hi'; acAutosize(); requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 520));
      return { start: seen[0], end: seen[seen.length - 1], uniq: [...new Set(seen)].length };
    });
    say(shrink.end < shrink.start - 20 && shrink.uniq >= 6,
      `${theme}: and eases back down again (${shrink.start} → ${shrink.end}, ${shrink.uniq} distinct heights)`);

    /* The bar must land on a REAL auto height, not stay pinned to the number it animated
       to — pinned, it would stop growing with the next line of text. */
    const released = await p.evaluate(() => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      return { inline: bar.style.height, cls: bar.className.includes('h-anim') };
    });
    say(!released.inline && !released.cls,
      `${theme}: and hands its height back to the layout when it lands (inline "${released.inline}")`);

    /* ── 2. the presence dot ── */
    const dot = await p.evaluate(async () => {
      const d = document.getElementById('acPeerDot');
      rtPresence[AC.peer.id] = { online: false, last_seen: new Date().toISOString() };
      acUpdatePeerPresence();
      await new Promise(r => setTimeout(r, 450));
      const before = { w: +d.getBoundingClientRect().width.toFixed(2), hidden: d.classList.contains('hidden') };
      const seen = []; const t0 = performance.now();
      const tick = () => { const cs = getComputedStyle(d);
        seen.push(cs.transform + '|' + (+d.getBoundingClientRect().width.toFixed(2)));
        if (performance.now() - t0 < 420) requestAnimationFrame(tick); };
      rtPresence[AC.peer.id] = { online: true }; acUpdatePeerPresence();
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 520));
      return { before, uniq: [...new Set(seen)].length, n: seen.length,
        end: +d.getBoundingClientRect().width.toFixed(2) };
    });
    say(dot.before.w < 1 && !dot.before.hidden,
      `${theme}: offline the dot takes no room, but is still there to animate from (${dot.before.w}px wide)`);
    say(dot.end > 9, `${theme}: online it is a full dot again (${dot.end}px)`);
    say(dot.uniq >= 6, `${theme}: and it grows into place — ${dot.uniq} distinct steps across ${dot.n} frames`);

    /* A group has no presence to report, so the dot is gone outright rather than collapsed —
       an invisible zero-width element in the pill would still be in the accessibility tree. */
    const grp = await p.evaluate(() => {
      acSetPeerDot(null);
      const d = document.getElementById('acPeerDot');
      return { hidden: d.classList.contains('hidden'), disp: getComputedStyle(d).display };
    });
    say(grp.hidden && grp.disp === 'none', `${theme}: where presence does not apply it is removed outright`);

    /* ── 3. the mic and the send SWAP, they do not blink ── */
    const swap = await p.evaluate(async () => {
      const inp = document.getElementById('acInput');
      inp.value = ''; acAutosize(); await new Promise(r => setTimeout(r, 350));
      const send = document.getElementById('acSendBtn');
      inp.value = 'hi'; acAutosize();
      await new Promise(r => setTimeout(r, 30));
      const cs = getComputedStyle(send);
      return { anim: cs.animationName, dur: cs.animationDuration,
        micGone: getComputedStyle(document.getElementById('acMic')).display === 'none' };
    });
    say(swap.anim === 'acDiscIn' && parseFloat(swap.dur) > 0.05,
      `${theme}: the send disc grows into the mic's place (${swap.anim} ${swap.dur})`);
    say(swap.micGone, `${theme}: and the mic gives up the spot, so the bar's width never moves`);

    say(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe composer grows and the dot arrives — nothing in the chat just appears');
  process.exit(bad ? 1 : 0);
})();
