/* NOTHING IN A CONVERSATION APPEARS — IT ARRIVES.
 *
 * The owner's words: "I don't want everything should be like boom effect, I want it should
 * rather be smooth like zooming in like a bubble, all those stuff, Apple style." Two things
 * in the chat were doing exactly that, and both are measured here by SAMPLING over time
 * rather than by reading a CSS rule — a transition declared on a property nothing writes
 * animates nothing, and only a sampled curve can tell the difference.
 *
 *  1. THE COMPOSER simply GETS TALLER (owner, build 1799 — 1798's instant step read as a
 *     pop). Two numbers matter and the second is the one that took three goes to get
 *     right: the height must travel, AND nothing may ever hang outside the bar while it
 *     does. 1797 animated the same height but held the content to the TOP of a box that was
 *     still short, so the BUTTONS were what got clipped and they appeared to slide up out
 *     of the bar — the "curtain". Held to the bottom instead, the top edge is what moves.
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

    /* ── 1. THE BAR JUST GETS TALLER ──
       Sampled every frame, the bar's height must TRAVEL (a jump gives two values however
       fast you sample) AND nothing in it may ever hang outside it. That second number is
       the whole difference between this and the version the owner rejected: 1797 animated
       the same height but stacked the content from the TOP of a box that was still short,
       so the buttons were what got clipped and they appeared to slide up out of the bar.
       Here the rows are held against the box's BOTTOM, so the top edge is what travels. */
    const grow = await p.evaluate(async (text) => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      inp.value = ''; acAutosize(); await new Promise(r => setTimeout(r, 400));
      const btn = () => [...bar.querySelectorAll('.msg-send,.ac-mic')]
        .find(n => n.getBoundingClientRect().width > 1);
      const rows = []; const t0 = performance.now();
      /* THE CORNER YOU SEE is min(declared, height/2) — a border-radius is clamped to half
         the box's short side. That clamp is the whole reason easing the radius looks wrong,
         so it is what gets measured, never the declared value. */
      const snap = () => { const B = bar.getBoundingClientRect(), b = btn();
        const S = b ? b.getBoundingClientRect() : null;
        const d = parseFloat(getComputedStyle(bar).borderTopLeftRadius);
        rows.push({ h: +B.height.toFixed(1), out: S ? +(S.bottom - B.bottom).toFixed(1) : 0,
          r: +Math.min(d, B.height / 2).toFixed(1) }); };
      snap();                                  // the height BEFORE, recorded synchronously
      inp.value = text; acAutosize();
      const tick = () => { snap(); if (performance.now() - t0 < 380) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 460));
      const hs = rows.map(r => r.h); const steps = [];
      for (let i = 1; i < hs.length; i++) { const d = Math.abs(hs[i] - hs[i - 1]); if (d > 0.05) steps.push(d); }
      return { start: rows[0].h, end: rows[rows.length - 1].h,
        uniq: [...new Set(hs)].length, worstOut: Math.max(...rows.map(r => r.out)),
        worstR: Math.max(...rows.map(x => x.r)),
        first: +(steps[0] || 0).toFixed(1), peak: +Math.max(...steps).toFixed(1),
        avg: +(steps.reduce((a, x) => a + x, 0) / steps.length).toFixed(1) };
    }, 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan');
    say(grow.end > grow.start + 20, `${theme}: the bar takes a second row (${grow.start} → ${grow.end})`);
    say(grow.uniq >= 6, `${theme}: and it TRAVELS there — ${grow.uniq} distinct heights (a jump gives 2)`);
    say(grow.worstOut <= 0, `${theme}: with nothing ever hanging outside it (worst ${grow.worstOut}px past the edge)`);
    /* THE CORNER MUST NOT SWELL. This is the owner's "it stays fully rounded in a bigger bar
       and after a second the sides straighten": easing the radius from a capsule to 24 while
       the box grows renders min(eased, height/2), which TRACKS the growing box — measured, it
       ballooned to 53.5 and then snapped back to 24. Switched instantly there is nothing to
       see, because at the one-line height a capsule and a 24 corner are half a pixel apart. */
    say(grow.worstR <= 26,
      `${theme}: and the corner never swells on the way — it stays the shape it lands on (peak ${grow.worstR})`);
    /* THE TRAVEL MUST BE A BELL, NOT A LURCH. This is what the owner kept calling a shake
       after the height itself was already animating: the app's own `--ease` is
       cubic-bezier(.22,.68,0,1), deliberately front-loaded for a panel flying in, and on a
       58px box it put 66% of the distance into the FIRST TWO FRAMES (18.5px then 19.9px)
       and crawled the last 10px over ten more. Sampled per frame that reads as a snap
       followed by a settle. A curve that starts gently has its biggest step in the MIDDLE,
       so both of these fail on the old one and neither can be faked by slowing it down. */
    say(grow.first < grow.peak * 0.5,
      `${theme}: it starts gently rather than lurching (first frame ${grow.first}px, biggest ${grow.peak}px)`);
    say(grow.peak <= grow.avg * 3.5,
      `${theme}: and no frame runs away with it (${grow.peak}px against a ${grow.avg}px average)`);

    /* A third line: no layout change at all, just the text box growing. */
    const more = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      const seen = []; const t0 = performance.now();
      const tick = () => { seen.push(+bar.getBoundingClientRect().height.toFixed(1));
        if (performance.now() - t0 < 380) requestAnimationFrame(tick); };
      inp.value = 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole '
        + 'plan together and see what is left to do before the end of the week alright';
      acAutosize(); requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 460));
      return { start: seen[0], end: seen[seen.length - 1], uniq: [...new Set(seen)].length };
    });
    say(more.end > more.start + 8 && more.uniq >= 5,
      `${theme}: a third line eases open too (${more.start} → ${more.end}, ${more.uniq} distinct heights)`);

    /* And back down again — a one-way ease reads as a snap on the way home. */
    const shrink = await p.evaluate(async () => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      const btn = () => [...bar.querySelectorAll('.msg-send,.ac-mic')]
        .find(n => n.getBoundingClientRect().width > 1);
      const rows = []; const t0 = performance.now();
      const tick = () => { const B = bar.getBoundingClientRect(), b = btn();
        const S = b ? b.getBoundingClientRect() : null;
        const d = parseFloat(getComputedStyle(bar).borderTopLeftRadius);
        rows.push({ h: +B.height.toFixed(1), out: S ? +(S.bottom - B.bottom).toFixed(1) : 0,
          r: +Math.min(d, B.height / 2).toFixed(1) });
        if (performance.now() - t0 < 380) requestAnimationFrame(tick); };
      inp.value = 'hi'; acAutosize(); requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 460));
      return { start: rows[0].h, end: rows[rows.length - 1].h,
        uniq: [...new Set(rows.map(r => r.h))].length, worstOut: Math.max(...rows.map(r => r.out)),
        worstR: Math.max(...rows.map(x => x.r)) };
    });
    say(shrink.end < shrink.start - 20 && shrink.uniq >= 6,
      `${theme}: and eases back down (${shrink.start} → ${shrink.end}, ${shrink.uniq} distinct heights)`);
    say(shrink.worstOut <= 0, `${theme}: still with nothing outside the bar (worst ${shrink.worstOut}px)`);
    say(shrink.worstR <= 26, `${theme}: and the corner holds on the way back too (peak ${shrink.worstR})`);

    /* ── EVERYTHING IN THE BAR TRAVELS TOGETHER ──
       The height was already easing while the CONTENTS teleported: measured per frame, the
       text moved its whole 58px in ONE frame and then sat still while the top edge crawled
       up behind it for 240ms. The owner: "the text comes up first before the bar extends",
       and the same for photos above it. So the row of attachments and the text box are
       flipped back to where they were and released on the bar's own curve — and the test is
       that no single frame moves any of them much further than the edge itself moves. */
    const together = await p.evaluate(async (text) => {
      const img = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#3a7"/></svg>');
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      const inp = document.getElementById('acInput');
      AC.att = null; AC.imgs = [img]; acRenderAttPrev();
      inp.value = ''; acAutosize(); await new Promise(r => setTimeout(r, 450));
      const tile = () => { const n = bar.querySelector('.ac-postimg-wrap'); return n ? n.getBoundingClientRect().top : null; };
      const rows = []; const t0 = performance.now();
      const snap = () => rows.push({ bar: bar.getBoundingClientRect().top,
        text: inp.getBoundingClientRect().top, tile: tile() });
      snap(); inp.value = text; acAutosize();
      const tick = () => { snap(); if (performance.now() - t0 < 400) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      await new Promise(r => setTimeout(r, 470));
      const worst = (k) => { let m = 0, prev = rows[0][k];
        rows.slice(1).forEach((r) => { if (r[k] != null && prev != null) m = Math.max(m, Math.abs(r[k] - prev)); prev = r[k]; });
        return +m.toFixed(1); };
      return { edge: worst('bar'), text: worst('text'), tile: worst('tile') };
    }, 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan');
    /* An ABSOLUTE bound, not one relative to the edge: comparing the two would pass if the
       edge itself were broken. The whole move is ~58px, so a teleport shows up as a single
       frame of ~58 and a real travel as ~11 — there is no ambiguity between them. */
    say(together.text <= 16,
      `${theme}: the text travels rather than teleporting — biggest frame ${together.text}px of a 58px move (edge ${together.edge})`);
    say(together.tile <= 16,
      `${theme}: and so do the photos sitting above it (${together.tile}px)`);
    await p.evaluate(async () => { AC.imgs = []; acRenderAttPrev();
      document.getElementById('acInput').value = ''; acAutosize();
      await new Promise(r => setTimeout(r, 400)); });

    /* Nothing may be left pinned to a number — the bar has to keep growing with the text. */
    const released = await p.evaluate(() => {
      const bar = document.querySelector('#acThreadScreen .msg-inbox');
      return { inline: bar.style.height, cls: bar.className.includes('h-grow') };
    });
    say(!released.inline && !released.cls,
      `${theme}: and the bar's own height is never left pinned (inline "${released.inline}")`);
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
