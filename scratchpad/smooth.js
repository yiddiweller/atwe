/* NOTHING IN A CONVERSATION APPEARS — IT ARRIVES.
 *
 * The owner's words: "I don't want everything should be like boom effect, I want it should
 * rather be smooth like zooming in like a bubble, all those stuff, Apple style." Two things
 * in the chat were doing exactly that, and both are measured here by SAMPLING over time
 * rather than by reading a CSS rule — a transition declared on a property nothing writes
 * animates nothing, and only a sampled curve can tell the difference.
 *
 *  1. THE COMPOSER, once it already has its own row: the textarea's height is written in
 *     px, so a plain CSS transition carries every line after the second and the button row
 *     rides down with it. THE ONE-TO-TWO-LINE STEP IS DELIBERATELY INSTANT (owner, build
 *     1798) — 1797 animated it by measuring the box before and after and gliding between
 *     the two while clipping, and it read as a curtain rather than a bar growing.
 *  2. THE PRESENCE DOT. It used to be display:none → visible. Now it scales up with a
 *     little overshoot and the space it takes opens with it.
 *  3. THE MIC/SEND SWAP — the GLYPH bubbles, the blue circle never moves (owner).
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

    /* ── 1. the wrap is a STEP; growing beyond it is smooth ── */
    const wrap = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      inp.value = ''; acAutosize(); await new Promise(r => setTimeout(r, 400));
      /* An instant change is already done by the time the first rAF runs, so the height
         BEFORE has to be recorded synchronously — sampling alone would report start ===
         end and read as "it never grew". */
      const h0 = +bar.getBoundingClientRect().height.toFixed(1);
      const seen = []; const t0 = performance.now();
      const tick = () => { seen.push(+bar.getBoundingClientRect().height.toFixed(1));
        if (performance.now() - t0 < 400) requestAnimationFrame(tick); };
      inp.value = 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan';
      acAutosize();
      requestAnimationFrame(tick);
      seen.unshift(h0);
      await new Promise(r => setTimeout(r, 500));
      return { start: seen[0], end: seen[seen.length - 1],
        uniq: [...new Set(seen.slice(1))].length };   // the pre-change value is not a step
    });
    say(wrap.end > wrap.start + 20, `${theme}: the bar takes a second row (${wrap.start} → ${wrap.end})`);
    /* The owner asked for this to be a plain step, not an animation. Two values is exactly
       what a step looks like when sampled every frame. */
    say(wrap.uniq <= 3, `${theme}: and it does it in one step, not a slide (${wrap.uniq} distinct heights)`);

    /* Beyond the wrap it IS smooth: nothing is re-laid-out, only the text box grows. */
    const more = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      const seen = []; const t0 = performance.now();
      const tick = () => { seen.push(+bar.getBoundingClientRect().height.toFixed(1));
        if (performance.now() - t0 < 400) requestAnimationFrame(tick); };
      inp.value = 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole '
        + 'plan together and see what is left to do before the end of the week alright';
      acAutosize(); requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 500));
      return { start: seen[0], end: seen[seen.length - 1], uniq: [...new Set(seen)].length };
    });
    say(more.end > more.start + 8 && more.uniq >= 5,
      `${theme}: a third line EASES open (${more.start} → ${more.end}, ${more.uniq} distinct heights)`);

    /* Nothing may be left pinned to a number — the bar has to keep growing with the text. */
    const released = await p.evaluate(() => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      return { inline: bar.style.height, cls: bar.className.includes('h-anim') };
    });
    say(!released.inline && !released.cls,
      `${theme}: and the bar's own height is never pinned (inline "${released.inline}")`);
    await p.evaluate(async () => { document.getElementById('acInput').value = ''; acAutosize();
      await new Promise(r => setTimeout(r, 400)); });

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
      const cs = getComputedStyle(send), cg = getComputedStyle(send.querySelector('svg'));
      return { disc: cs.animationName, glyph: cg.animationName, dur: cg.animationDuration,
        micGone: getComputedStyle(document.getElementById('acMic')).display === 'none' };
    });
    say(swap.glyph === 'acDiscIn' && parseFloat(swap.dur) > 0.05,
      `${theme}: the arrow bubbles into the mic's place (${swap.glyph} ${swap.dur})`);
    /* The blue circle is the constant; only the mark inside it changed, so only the mark
       moves. In 1797 the whole disc pumped and the owner asked for it off. */
    say(swap.disc === 'none', `${theme}: and the blue circle itself never moves (${swap.disc})`);
    say(swap.micGone, `${theme}: the mic gives up the spot, so the bar's width never moves`);

    say(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe composer grows and the dot arrives — nothing in the chat just appears');
  process.exit(bad ? 1 : 0);
})();
