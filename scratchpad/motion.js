/* HOW IT FEELS TO SCROLL — MEASURED, NOT FELT.
 *
 * The third of the three passes the first sweep said it had NOT done. "Speed and motion"
 * cannot be judged by looking, and it cannot be judged on this machine's raw numbers
 * either: a headless desktop renders every surface in this app at a clean 60fps whether
 * or not a real phone would. `notifscroll.js` already learned both halves of that —
 * THROTTLE THE CPU, and compare a surface against a KNOWN-GOOD surface rather than
 * against a fixed millisecond figure. This does the same thing across the whole app.
 *
 * The reference is the Account page: a plain list of rows that the founder has never
 * complained about, measured in the same run, on the same machine, at the same throttle.
 * A surface fails when it is materially worse than that — not when it is worse than 16.7.
 *
 * It also checks the OTHER half of motion: that `prefers-reduced-motion` really does
 * collapse the app's animations, since a token nobody honours is a promise nobody keeps.
 */
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const TOK = process.env.TOK;
const THROTTLE = 6;

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

/* Each surface: a name, how to get there, and which element actually scrolls. */
const SURFACES = [
  ['the Account page (the reference)', "appTab('profile'); await w(1200);"],
  ['the Home feed', "appTab('home'); await w(1600);"],
  ['the Beam chat list', "appTab('chat'); await w(1400);"],
  ['an open conversation', "appTab('chat'); await w(900); acOpenChat(AC._chats && AC._chats[0] && (AC._chats[0].peerId || AC._chats[0].id)); await w(1800);"],
  ['Engine', "appTab('search'); await w(1600);"],
  ['your own profile', "acGoProfile(); await w(1800);"],
  ['Notifications', "acNavNotifs(); await w(1400);"],
  ['the marketplace', "acOpenMarketplace(); await w(1600);"],
];

/* Fling the thing that can actually move, and record every frame while it does.
   Which element scrolls is not fixed — on a phone the app runs in `body.pgscroll`
   sometimes and in its own container others, which is the trap `worldhdr.js` records.
   So ask the page what can move rather than naming a selector. */
const MEASURE = `
  const cands = [document.scrollingElement, ...document.querySelectorAll('.ac-list,.msg-scroll-vp,#acFeed,#notifList,.overlay:not(.hidden) .job-card-modal')];
  const el = cands.find((e) => e && e.scrollHeight - e.clientHeight > 200);
  if (!el) return { skipped: true };
  const frames = [];
  let last = performance.now(), stop = false;
  const tick = (t) => { frames.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const start = el.scrollTop;
  for (let i = 0; i < 40; i++) { el.scrollTop += 90; await new Promise((r) => requestAnimationFrame(r)); }
  for (let i = 0; i < 20; i++) { el.scrollTop -= 90; await new Promise((r) => requestAnimationFrame(r)); }
  stop = true;
  await new Promise((r) => setTimeout(r, 60));
  const moved = Math.abs(el.scrollTop - start);
  const f = frames.slice(3).sort((a, b) => a - b);   // drop the first few: they include the setup
  if (!f.length) return { skipped: true };
  return { moved, n: f.length,
    p50: +f[Math.floor(f.length * 0.5)].toFixed(1),
    p95: +f[Math.floor(f.length * 0.95)].toFixed(1),
    long: f.filter((x) => x > 32).length };
`;

(async () => {
  if (!TOK) { console.log('  skipped — export TOK first'); process.exit(0); }
  const cfg = await fetch(BASE + '/api/config').then((r) => r.status).catch(() => 0);
  if (cfg !== 200) { console.log('  skipped — no server on ' + BASE); process.exit(0); }

  const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript((t) => { localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { window.w = (ms) => new Promise((r) => setTimeout(r, ms)); });

  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  console.log(`  (CPU throttled ${THROTTLE}x — an unthrottled desktop renders all of this at 60fps whether or not a phone would)`);

  const results = [];
  for (const [name, steps] of SURFACES) {
    await p.evaluate(() => {
      document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden'));
      document.body.className = document.body.className.replace(/\bnotif-tab\b|\bsb-open\b/g, '');
      try { appTab('home'); } catch (e) {}
    }).catch(() => {});
    await p.waitForTimeout(500);
    try { await p.evaluate(async (src) => { await (new Function('w', 'return (async()=>{' + src + '})()'))(window.w); }, steps); }
    catch (e) { ok(false, name + ' — could be opened at all', String(e.message).slice(0, 90)); continue; }
    await p.waitForTimeout(500);
    const r = await p.evaluate(async (src) => await (new Function('return (async()=>{' + src + '})()'))(), MEASURE);
    results.push([name, r]);
    console.log(`  · ${name.padEnd(34)} ${r.skipped ? 'nothing long enough to scroll'
      : `p50 ${r.p50}ms · p95 ${r.p95}ms · ${r.long} frames over 32ms (${r.moved}px)`}`);
  }

  const ref = results.find((x) => /reference/.test(x[0]));
  if (!ref || ref[1].skipped) { console.log('  skipped — the reference surface had nothing to scroll'); await br.close(); process.exit(0); }
  const R = ref[1];
  ok(R.p95 < 200, 'the reference surface itself is sane', 'p95 ' + R.p95 + 'ms');

  /* THE BAR IS RELATIVE, DELIBERATELY. A fixed millisecond figure measures the machine;
     what a person feels is one screen being worse than another. */
  for (const [name, r] of results) {
    if (/reference/.test(name)) continue;
    if (r.skipped) { console.log(`  --   ${name} — nothing to scroll, not judged`); continue; }
    ok(r.p95 <= Math.max(R.p95 * 2, R.p95 + 12), `${name} scrolls no worse than the Account page`,
      `p95 ${r.p95}ms vs ${R.p95}ms`);
    ok(r.long <= R.long + 5, `${name} drops no more frames than it`, `${r.long} long frames vs ${R.long}`);
  }

  /* REDUCED MOTION IS A PROMISE. The app claims a full @media(prefers-reduced-motion)
     reset; if a real animation still runs there, the setting is decoration. */
  const rm = await br.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const p2 = await rm.newPage();
  await p2.addInitScript((t) => { localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(5000);
  const moving = await p2.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const dur = (s) => Math.max(...String(s).split(',').map((x) => {
        const v = parseFloat(x); return /ms/.test(x) ? v : v * 1000; }).filter((n) => !isNaN(n)).concat([0]));
      const t = dur(cs.transitionDuration), a = dur(cs.animationDuration);
      if (Math.max(t, a) > 120 && el.offsetParent !== null)
        bad.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + Math.max(t, a) + 'ms');
      if (bad.length > 8) break;
    }
    return bad;
  });
  ok(moving.length === 0, 'reduced motion really does stop the animations', moving.slice(0, 4).join(' · '));
  await br.close();

  console.log(`\n${pass} passed, ${fails.length} FAILED`);
  if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
})();
