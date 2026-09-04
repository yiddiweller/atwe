/* UNDO SITS BESIDE THE MESSAGE, NOT IN A TOAST AT THE BOTTOM OF THE SCREEN.
 *
 * It used to be a bottom-centre toast reading "Message sent · Undo" — which announced
 * something you could already see, in the one place your eyes were not, and covered the
 * conversation to do it. The owner's idea, and a better one: a quiet grey chip next to the
 * bubble itself for the ten seconds it is worth offering, and tapping it makes the message
 * shrink away rather than blink out.
 *
 * The collapse is checked the way it actually behaves rather than by sampling heights: one
 * frame after the tap the row must still be FULL HEIGHT with the animation armed — that is
 * what proves it is easing rather than being removed — and gone a few hundred ms later.
 * (A height sampler was tried first and reported zeros on an animation that was provably
 * running, which is worse than no check.)
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
    await p.locator('#acListScreen .ac-item[data-uid]').first().click({ timeout: 25000 });
    await p.waitForSelector('#acThreadScreen:not(.hidden)', { timeout: 25000 });
    await p.waitForTimeout(1600);

    /* TWO SENDS, and the short one is the one that matters. The chip used to be a plain
       flex child of the ROW, so it sat beside the whole COLUMN — bubble plus delivery
       status, signature and reactions — and drifted off the message whenever one of those
       was wider or taller than the bubble itself (measured 93px out of line). A two-letter
       message is the case that exposes it. */
    const send = async (text) => {
      await p.fill('#acInput', text);
      await p.evaluate(() => acAutosize());
      await p.evaluate(() => document.getElementById('acSendBtn').click());
      await p.waitForTimeout(1500);
      return p.evaluate(() => {
      const u = document.querySelector('#acThread .msg-undo');
      const toast = document.getElementById('acUndoToast');
      if (!u) return { none: true, toast: !!toast };
      const row = u.closest('.msg-row'), bub = row.querySelector('.msg-bubble');
      const q = u.getBoundingClientRect(), B = bub.getBoundingClientRect();
      const cs = getComputedStyle(u);
      const page = getComputedStyle(document.body).color;   // just to prove we can read colours
      return { toast: !!toast, text: u.textContent.trim(),
        beside: q.right <= B.left + 0.5, gap: +(B.left - q.right).toFixed(1),
        level: Math.abs((q.top + q.bottom) / 2 - (B.top + B.bottom) / 2) < 3,
        onMyRow: row.classList.contains('me'),
        h: Math.round(q.height), bubH: Math.round(B.height),
        bg: cs.backgroundColor, fg: cs.color, page };
      });
    };

    const chip = await send('undo probe ' + Date.now());
    say(!chip.none, `${theme}: sending offers an Undo${chip.none ? ' — none found' : ''}`);
    if (chip.none) { say(false, `${theme}: (rest skipped)`); await ctx.close(); continue; }
    say(!chip.toast, `${theme}: and NOT a "Message sent" toast at the bottom of the screen`);
    say(chip.text === 'Undo', `${theme}: it just says "${chip.text}"`);
    say(chip.onMyRow && chip.beside && chip.gap >= 5 && chip.gap <= 12,
      `${theme}: sitting beside the message you sent (${chip.gap}px from the bubble)`);
    say(chip.level, `${theme}: level with it`);
    /* "the size of the message… a lighter colour or maybe grey" — small next to the bubble,
       and one of the app's quiet greys rather than any of its meaningful colours: it is a
       way out, not an action being recommended. */
    say(chip.h <= chip.bubH && chip.h <= 30, `${theme}: at the message's own scale (${chip.h}px tall)`);
    const grey = (c) => { const v = (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      return Math.max(...v) - Math.min(...v) <= 8; };   // no colour cast = grey
    say(grey(chip.bg) && grey(chip.fg), `${theme}: quiet grey, not a colour (${chip.bg} / ${chip.fg})`);

    const tiny = await send('hi');
    say(!tiny.none && tiny.beside && tiny.gap >= 5 && tiny.gap <= 12,
      `${theme}: and beside a two-letter message too (${tiny.gap}px), not beside the column`);
    say(!tiny.none && tiny.level, `${theme}: level with that one as well`);

    /* Tapping it: the message eases away rather than blinking out. */
    const gone = await p.evaluate(async () => {
      const u = document.querySelector('#acThread .msg-undo');
      const row = u.closest('.msg-row');
      const h0 = row.getBoundingClientRect().height;
      const rows0 = document.querySelectorAll('#acThread .msg-row').length;
      u.click();
      await new Promise((r) => requestAnimationFrame(r));
      const armed = { inDoc: document.contains(row), cls: row.className,
        pinned: row.style.maxHeight, h: row.getBoundingClientRect().height };
      await new Promise((r) => setTimeout(r, 900));
      return { h0, rows0, armed, rows1: document.querySelectorAll('#acThread .msg-row').length,
        chipLeft: !!document.querySelector('#acThread .msg-undo') };
    });
    say(gone.armed.inDoc && /retracting/.test(gone.armed.cls) && gone.armed.h > gone.h0 - 2,
      `${theme}: one frame after the tap it is easing, not gone (${gone.armed.h} of ${gone.h0}px, "${gone.armed.cls.split(' ').slice(-2).join(' ')}")`);
    say(gone.armed.pinned === Math.round(gone.h0) + 'px' || parseFloat(gone.armed.pinned) > 0,
      `${theme}: its height was pinned first, so the collapse has something to travel from (${gone.armed.pinned})`);
    say(gone.rows1 === gone.rows0 - 1, `${theme}: and the message is really gone (${gone.rows0} → ${gone.rows1})`);
    say(!gone.chipLeft, `${theme}: with the chip cleared away`);

    say(errs.length === 0, `${theme}: no JS errors` + (errs.length ? ' — ' + errs[0] : ''));
    await ctx.close();
  }

  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nUndo sits beside the message, and the message leaves smoothly');
  process.exit(bad ? 1 : 0);
})();
