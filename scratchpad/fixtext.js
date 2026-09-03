/* THE ONE-TAP PROOFREADER in the chat composer.
 *
 * A small Atwe button appears in the message bar once there is something worth correcting,
 * and one press hands the whole message to Atwe AI to fix its spelling, grammar and
 * punctuation — nothing else. While it works, the text itself shimmers blue-and-white.
 *
 * The model is stubbed here. What is being tested is the FEATURE — when the button shows,
 * what the working state looks like, that the text is actually replaced, that the original
 * can be got back, and that a failure says so — not whether Claude can spell. The one thing
 * that genuinely needs the real model is the prompt's promise (correct, don't rewrite), and
 * no probe can assert that; it is stated in the task's own wording on the server.
 */
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const { PNG } = require(process.env.PW ? process.env.PW + '/node_modules/pngjs' : 'pngjs');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const SLOPPY = 'i thnk we shud meet tomorow at 3 pm ok';
const FIXED  = 'I think we should meet tomorrow at 3 pm, ok?';

(async () => {
  if (!process.env.TOK) { console.error('export TOK first'); process.exit(2); }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  const open = async (theme) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.evaluate(([t, th]) => { localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_theme', th); },
      [process.env.TOK, theme]);
    await p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const s = document.querySelector('#introSheet:not(.hidden)');
      if (s && typeof introDismiss === 'function') introDismiss(); });
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 20000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 20000 });
    await p.waitForTimeout(1800);
    return { ctx, p };
  };
  const stub = (p, out, delay) => p.evaluate(([out, delay]) => {
    const real = API.req.bind(API);
    API.req = async (m, u, body) => {
      if (u === '/api/ai/write' && body && body.task === 'proofread') {
        await new Promise((r) => setTimeout(r, delay));
        if (out === '__503') { const e = new Error('Atwe AI is not available right now.'); e.status = 503; throw e; }
        return { text: out };
      }
      return real(m, u, body);
    };
  }, [out, delay]);
  const shown = (p) => p.evaluate(() => {
    const b = document.getElementById('acFixBtn');
    return { on: b.classList.contains('show'), w: Math.round(b.getBoundingClientRect().width) };
  });

  const { ctx, p } = await open('black');
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

  /* 1. It arrives once there is a word, and leaves when the box empties. */
  say((await shown(p)).on === false, 'nothing in the bar until there is something to fix');
  await p.click('#acInput');
  await p.type('#acInput', 'hi', { delay: 5 });
  await p.waitForTimeout(350);
  say((await shown(p)).on === false, 'a two-letter message does not get one either');
  await p.fill('#acInput', '');
  await p.type('#acInput', SLOPPY, { delay: 5 });
  await p.waitForTimeout(500);
  const s1 = await shown(p);
  say(s1.on && s1.w >= 30, `it appears once a real sentence is typed (${s1.w}px wide)`);

  /* 2. It is the Atwe mark with three dots in the middle — the owner's design.
        WHITE, and NO disc behind it: the mark and the dots must be the same colour as the
        + on the other end of the bar, so the bar reads as one set of controls rather than
        one blue badge among plain glyphs. The dots must also fit INSIDE the swirl's own
        open centre — the mark is a spiral and its middle really is hollow — so their total
        width is checked against the measured hollow (0.421 of the mark's box). */
  const look = await p.evaluate(() => {
    const b = document.getElementById('acFixBtn');
    const before = getComputedStyle(b, '::before');
    const dot = b.querySelector('.afx-dots i');
    const dots = [...b.querySelectorAll('.afx-dots i')];
    const gap = parseFloat(getComputedStyle(b.querySelector('.afx-dots')).columnGap) || 0;
    const dw = parseFloat(getComputedStyle(dot).width);
    const plus = document.querySelector('#acThreadScreen .msg-inbox .msg-attach svg');
    return { mask: (before.webkitMaskImage || before.maskImage || ''), maskOpacity: +before.opacity,
      dots: dots.length, markColour: before.backgroundColor,
      dotColour: getComputedStyle(dot).backgroundColor,
      plusColour: plus ? getComputedStyle(plus).color : '',
      btnBg: getComputedStyle(b).backgroundColor,
      dotsWide: dots.length * dw + (dots.length - 1) * gap,
      dw: dw, gap: gap,
      dotBoxes: dots.map((n) => { const r = n.getBoundingClientRect(); return [+r.width.toFixed(2), +r.height.toFixed(2)]; }),
      dotGaps: dots.slice(1).map((n, i) => +(n.getBoundingClientRect().left - dots[i].getBoundingClientRect().right).toFixed(2)),
      btnW: parseFloat(getComputedStyle(b).width),
      markW: parseFloat(before.width),
      sendW: (() => { const n = [...document.querySelectorAll('#acThreadScreen .msg-inbox .msg-send, #acThreadScreen .msg-inbox .ac-mic')]
        .find((q) => q.getBoundingClientRect().width > 1); return n ? n.getBoundingClientRect().width : 0; })(),
      round: getComputedStyle(b).borderRadius };
  });
  say(/logo-mark\.png/.test(look.mask), 'the button carries the real Atwe mark, not a redraw');
  say(look.dots === 3, `with three dots in its centre (${look.dots})`);
  say(/^50%|999/.test(look.round), `and it is a circle (${look.round})`);
  say(/rgba\(0, 0, 0, 0\)|transparent/.test(look.btnBg),
    `no disc behind it — the mark IS the button (${look.btnBg})`);
  say(look.maskOpacity === 1 && look.markColour === look.plusColour,
    `the mark is the same white as the + beside it (${look.markColour} vs ${look.plusColour}, opacity ${look.maskOpacity})`);
  say(look.dotColour === look.plusColour, `and so are the dots (${look.dotColour})`);
  /* The measured hollow, for a ROW of dots, is the widest clear HORIZONTAL band through the
     artwork's middle — 0.465 of the ARTWORK, not the largest inscribed square (0.421), which
     is the wrong figure for a row. And the artwork is not the box: the mask is
     `center/contain` over the whole 512px file, whose ink fills only 0.8945 of it, so the
     band is 0.465 x 0.8945 = 0.416 of the rendered box. Missing that padding over-stated
     the room by 12% and is why the dots touched the swirl's arms. */
  const hollow = look.markW * 0.416;
  say(look.dotsWide <= hollow - 1,
    `the dots clear the swirl's arms (${look.dotsWide.toFixed(1)}px of dots in a ${hollow.toFixed(1)}px band)`);
  /* THREE EVEN CIRCLES, which is what the owner asked for after they read as one dash:
     same size as each other, square (so `border-radius:50%` really is a circle), evenly
     spaced, and a gap wide enough to separate them. */
  say(look.dotBoxes.every((d) => d[0] === look.dotBoxes[0][0] && d[1] === look.dotBoxes[0][1] && d[0] === d[1]),
    `three even circles, not a dash (${look.dotBoxes.map((d) => d.join('x')).join(' · ')})`);
  say(Math.abs(look.dotGaps[0] - look.dotGaps[1]) < 0.05 && look.gap >= look.dw * 0.6,
    `evenly spaced, and the gap is wide enough to read as three (${look.dotGaps.join(' / ')} between ${look.dw}px dots)`);
  /* And the whole mark is MUCH smaller than the blue send it sits beside (owner). The BOX
     stays 36 so spacing and the tap target are untouched — only the artwork shrank. */
  say(look.markW <= look.sendW * 0.8 && look.btnW === look.sendW,
    `the mark is much smaller than the send (${look.markW} vs ${look.sendW}) while its button still matches it`);

  /* 3. Tapping it: the text shimmers, the box is held, the button shows it is working. */
  await stub(p, FIXED, 2600);
  await p.click('#acFixBtn');
  await p.waitForTimeout(430);
  const mid = await p.evaluate(() => {
    const box = document.querySelector('#acThreadScreen .msg-inbox'), inp = document.getElementById('acInput');
    const sh = document.getElementById('acFixShine'), cs = getComputedStyle(sh);
    return { fixing: box.classList.contains('fixing'), working: document.getElementById('acFixBtn').classList.contains('working'),
      shineOn: cs.display !== 'none', shineText: sh.textContent, clip: cs.webkitBackgroundClip || cs.backgroundClip,
      anim: cs.animationName, hidden: getComputedStyle(inp).webkitTextFillColor, readOnly: inp.readOnly,
      still: document.getElementById('acFixBtn').classList.contains('show') };
  });
  say(mid.fixing && mid.working, 'the button shows it is working');
  say(mid.still, 'and stays put while it does — it IS the progress');
  say(mid.shineOn && mid.shineText === SLOPPY, 'the shimmer stands in for the exact text typed');
  say(mid.clip === 'text' && /afxWave/.test(mid.anim), `the wave really runs through the letters (background-clip: ${mid.clip}, ${mid.anim})`);
  say(/rgba\(0, 0, 0, 0\)/.test(mid.hidden), 'the real text is hidden underneath, so only the shimmer is seen');
  say(mid.readOnly, 'and the box is held while it works, so nothing is typed into a moving target');

  /* 3b. …and the shimmer really is blue AND white on screen, not one flat colour. */
  /* Proving it WAVES needs the scan confined to the LETTERS THEMSELVES, and three weaker
     attempts were thrown away first: counting "some blue and some white pixels" passes on a
     flat fill; so does the per-pixel spread (subpixel antialiasing produces fringes at both
     extremes); and so does a per-column average taken over the shimmer's whole BOX, because
     the box is the full width of the bar and catches a few pixels of neighbouring chrome at
     its edge. A Range over the shimmer's own text gives the exact line rectangles, and
     nothing but glyphs lives inside those. Read before the screenshot: the shimmer is
     display:none the moment the answer lands, and a hidden element reports a zero rect. */
  const lines = await p.evaluate(() => {
    const sh = document.getElementById('acFixShine');
    const r = document.createRange(); r.selectNodeContents(sh);
    return [...r.getClientRects()].map((q) => [Math.round(q.left), Math.round(q.top), Math.round(q.width), Math.round(q.height)])
      .filter((q) => q[2] > 40 && q[3] > 6);
  });
  const shot = PNG.sync.read(await p.screenshot());
  const cols = [];
  for (const [lx, ly, lw, lh] of lines) {
    for (let x = lx + 2; x < lx + lw - 2; x++) {
      let sum = 0, n = 0;
      for (let y = ly + 1; y < ly + lh - 1; y++) {
        const i = (shot.width * (y * 2) + x * 2) * 4;
        const r = shot.data[i], g = shot.data[i + 1], bl = shot.data[i + 2];
        if (r + g + bl > 300) { sum += bl - r; n++; }
      }
      if (n >= 4) cols.push(sum / n);
    }
  }
  const span = cols.length ? Math.round(Math.max(...cols) - Math.min(...cols)) : 0;
  /* 120 is calibrated, not guessed: measured against a deliberately FLAT fill this same
     scan reads ~59 (antialiasing alone spreads it that far), and against the real wave it
     reads ~255. Anything under about 100 means the wave has gone flat. */
  say(cols.length > 20 && span > 120,
    `and it really WAVES — the letters run from blue to white across the sentence (blueness varies by ${span} over ${cols.length} lit columns; a flat fill measures ~59)`);

  /* 4. The corrected text lands, and the original can be got back. */
  await p.waitForTimeout(2600);
  const after = await p.evaluate(() => ({
    value: document.getElementById('acInput').value,
    fixing: document.querySelector('#acThreadScreen .msg-inbox').classList.contains('fixing'),
    readOnly: document.getElementById('acInput').readOnly,
    undo: (document.getElementById('acUndoToast') || {}).textContent || '' }));
  say(after.value === FIXED, `the corrected message replaces what was typed ("${after.value}")`);
  say(!after.fixing && !after.readOnly, 'the shimmer clears and the box is yours again');
  say(/undo/i.test(after.undo), `and an Undo is offered ("${after.undo.replace(/undo$/i, ' · Undo')}")`);
  await p.evaluate(() => document.querySelector('#acUndoToast .ut-btn').click());
  await p.waitForTimeout(400);
  say(await p.evaluate((t) => document.getElementById('acInput').value === t, SLOPPY),
    'Undo puts back exactly what was written — nothing is lost to the AI');

  /* 5. A failure says so, and hands the box back. */
  await stub(p, '__503', 200);
  await p.evaluate(() => { document.querySelectorAll('.notif').forEach((n) => n.remove()); });
  await p.click('#acFixBtn');
  await p.waitForTimeout(1200);
  const fail = await p.evaluate(() => ({
    msg: (document.querySelector('.notif') || {}).textContent || '',
    value: document.getElementById('acInput').value,
    readOnly: document.getElementById('acInput').readOnly,
    fixing: document.querySelector('#acThreadScreen .msg-inbox').classList.contains('fixing') }));
  say(/set up/i.test(fail.msg), `with no Atwe AI configured it says so plainly ("${fail.msg}")`);
  say(fail.value === SLOPPY && !fail.readOnly && !fail.fixing, 'and the message is untouched and editable again');

  /* 6. THE COMPOSER MUST NOT FLIP-FLOP. The button's arrival narrows the text box, so a line
        that just fitted can wrap — and the multiline decision used to be measured in
        whichever mode was current, which is a feedback loop: it toggled on EVERY keystroke
        through a band of message lengths (traced `.M.M.M.M`) and the bar jumped a whole row
        up and down as you typed. The decision is taken at the single-row width now.
        `AC._barWrapped` is traced rather than the class: they agree today, but the wrap is
        the half that is MEASURED, and therefore the only half that could ever feed back
        into itself — which is what this check exists to catch. */
  await p.fill('#acInput', '');
  await p.waitForTimeout(300);
  await p.click('#acInput');
  const trace = [];
  for (const ch of 'i thnk we shud meet tomorow at 3 pm ok and then go over the plan') {
    await p.keyboard.type(ch);
    await p.waitForTimeout(22);
    trace.push(await p.evaluate(() => AC._barWrapped ? 'M' : '.'));
  }
  const flips = trace.join('').replace(/(.)\1+/g, '$1').length - 1;
  say(flips <= 1, `the bar settles into its tall mode once and stays — ${flips} change${flips === 1 ? '' : 's'} over ${trace.length} keystrokes (it used to flip on nearly every one)`);
  /* 6b. AND IT STAYS ONE ROW UNTIL IT HAS TO GROW. Build 1783 opened it on every tap
         (ChatGPT-style) and the owner asked for that back out: too much motion for a chat
         you are only glancing at. An empty bar, focused, must still be the short capsule. */
  await p.fill('#acInput', '');
  await p.click('#acInput');
  await p.waitForTimeout(450);
  const rest = await p.evaluate(() => {
    const b = document.querySelector('#acThreadScreen .msg-inbox');
    return { ml: b.classList.contains('multiline'), h: Math.round(b.getBoundingClientRect().height) };
  });
  say(!rest.ml && rest.h < 70, `tapping an empty bar leaves it one row (${rest.h}px)`);

  say(errs.length === 0, `no JS errors${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();

  /* 7. Light theme: the button and its dots must still read. */
  const l = await open('light');
  await l.p.click('#acInput');
  await l.p.type('#acInput', SLOPPY, { delay: 4 });
  await l.p.waitForTimeout(500);
  /* NB the button itself has no fill — the mark IS the button — so its legibility is
     measured against THE BAR behind it, not against its own (transparent) background.
     Comparing to the button would compare the dots with rgba(0,0,0,0), i.e. with black. */
  const lt = await l.p.evaluate(() => {
    const b = document.getElementById('acFixBtn');
    const bar = document.querySelector('#acThreadScreen .msg-inbox');
    const rgb = (c) => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
    const diff = (a, c) => Math.max(...a.map((v, i) => Math.abs(v - c[i])));
    const plus = document.querySelector('#acThreadScreen .msg-inbox .msg-attach svg');
    return { on: b.classList.contains('show'),
      sameAsPlus: getComputedStyle(b.querySelector('.afx-dots i')).backgroundColor === getComputedStyle(plus).color
        && getComputedStyle(b, '::before').backgroundColor === getComputedStyle(plus).color,
      contrast: diff(rgb(getComputedStyle(bar).backgroundColor), rgb(getComputedStyle(b.querySelector('.afx-dots i')).backgroundColor)) };
  });
  say(lt.on, 'it appears in Light theme too');
  say(lt.contrast >= 40, `and its dots are clearly visible against the bar (${lt.contrast})`);
  say(lt.sameAsPlus, 'the mark and its dots are the same ink as the + in Light theme too');

  /* 8. THE BAR IS A CAPSULE ON ONE LINE AND A ROUNDED BOX ONCE IT WRAPS.
        A capsule's ends are semicircles, so on a two-line box they read as a giant lozenge —
        the owner's own complaint, with a ChatGPT composer as the reference. 28 is derived
        from the send button (18) plus its 10px inset, so the corner is concentric with it. */
  const shape = async (page, text) => {
    await page.fill('#acInput', text);
    await page.evaluate(() => acAutosize());
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const box = document.querySelector('#acThreadScreen .msg-inbox');
      /* Only ONE of mic/send is showing at a time; the other is hidden and reports a zero
         box, so take whichever actually has width rather than the first match. */
      const send = [...document.querySelectorAll('#acThreadScreen .msg-inbox .msg-send, #acThreadScreen .msg-inbox .ac-mic')]
        .find((n) => n.getBoundingClientRect().width > 1);
      const B = box.getBoundingClientRect(), S = send.getBoundingClientRect();
      return { ml: box.classList.contains('multiline'), r: parseFloat(getComputedStyle(box).borderTopLeftRadius),
        h: Math.round(B.height), sendR: S.width / 2,
        gapEnd: Math.round(B.right - S.right), gapBottom: Math.round(B.bottom - S.bottom) };
    });
  };
  const one = await shape(l.p, 'hi there');
  say(!one.ml && one.r >= one.h / 2 - 1, `one line stays a true capsule (${one.r} for a ${one.h}px bar)`);
  const two = await shape(l.p, 'i thnk we shud meet tomorow at 3 pm ok and then we can go over the whole plan together');
  say(two.ml && two.r < two.h / 2 - 4,
    `a wrapped message becomes a rounded BOX, not a lozenge (${two.r} for a ${two.h}px bar)`);
  say(two.gapEnd === two.gapBottom,
    `the send button is inset the same on both sides of that corner (${two.gapEnd} / ${two.gapBottom})`);
  say(Math.abs(two.r - (two.sendR + two.gapEnd)) <= 1,
    `so the corner is concentric with it — radius ${two.r} = ${two.sendR} + ${two.gapEnd}`);
  await l.ctx.close();

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\none tap, and the message is spelled right — with the original one tap back');
  process.exit(bad ? 1 : 0);
})();
