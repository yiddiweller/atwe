/* HOW IT FEELS TO SCROLL — MEASURED, NOT FELT.
 *
 * The third of the three passes the first full web sweep admitted it had NOT done. "Speed
 * and motion" cannot be judged by looking, and it cannot be judged on this machine's raw
 * numbers either: a headless desktop renders every surface in this app at a clean 60fps
 * whether or not a real phone would. `notifscroll.js` already learned both halves of that —
 * THROTTLE THE CPU, and compare against something known-good rather than against a fixed
 * millisecond figure. This does it across the whole app instead of one screen.
 *
 * WHAT IT ASSERTS, and why each one is the shape it is:
 *
 *   1. THE STEADY STATE IS ONE FRAME. p50 must be a single vsync on every surface. This is
 *      the real definition of "smooth": not that no frame is ever long, but that the normal
 *      frame is on time. Measured across eight surfaces at a 6x throttle it is 16.7ms
 *      everywhere, without exception, so the bar is neither generous nor theoretical.
 *   2. NOTHING STALLS. No single frame over 120ms — a hitch you would actually see, as
 *      opposed to a dropped frame you would not.
 *   3. NO SURFACE IS AN OUTLIER. Long frames stay under half the frames that moved.
 *
 * THE LONG-FRAME BAR IS DELIBERATELY LOOSE, AND THAT IS A MEASUREMENT, NOT A SHRUG. Flung
 * hard at a 6x throttle, the surfaces with real content (the feed, a long list) drop
 * somewhere between 5 and 15 of 41 moving frames — AND THEY DISAGREE WITH THEMSELVES: the
 * same surface, same build, same run, measured twice in a row, gave 5 then 11, and 2 then
 * 15. A bar tight enough to catch a 6-frame regression would go red on noise several times
 * a week and be switched off within a fortnight, which is worth less than a loose bar that
 * is believed. A CPU profile says why the spread exists and why it is not ours to fix: at
 * that throttle 57-78% of the samples are (program) — the browser rasterising real content
 * — against 9% in all of the app's own scroll handling put together.
 *
 * It also checks the other half of motion: that `prefers-reduced-motion` really does collapse
 * the app's animations, since a token nobody honours is a promise nobody keeps.
 */
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const TOK = process.env.TOK;
const THROTTLE = 6;
const RUNS = 3;            // the same surface three times — the spread above is why

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };
const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

const SURFACES = [
  ['the Account page',      "appTab('profile'); await w(1400);"],
  ['the Home feed',         "appTab('home'); await w(2200);"],
  ['the Beam chat list',    "appTab('chat'); await w(1600);"],
  ['an open conversation',  "appTab('chat'); await w(900); acOpenChat(__PEER__); await w(2400);"],
  ['Engine',                "appTab('search'); await w(1800);"],
  ['Notifications',         "acNavNotifs(); await w(1800);"],
  ['the marketplace',       "acOpenMarketplace(); await w(2200);"],
  ['your orders',           "acOpenOrders('buyer'); await w(2000);"],
];

/* WHICH ELEMENT SCROLLS IS THE WHOLE BALL GAME, AND THE FIRST VERSION OF THIS PROBE GOT IT
   WRONG IN THE MOST FLATTERING WAY POSSIBLE. It took the first candidate with room to move,
   and `document.scrollingElement` was at the head of that list — so on every surface that is
   an OVERLAY over a world (Notifications, the marketplace, orders) it measured the HOME FEED
   sitting behind the overlay, three separate times, and reported three separate verdicts
   about it. The numbers were real; the subject was not. Proved by printing both: the document
   had 6404px of room while #notifList had 3545 and the marketplace's own card had 23996.
   That is the fifth time this repo has recorded a check confidently measuring the wrong
   thing. An overlay covers the page, so it OWNS the gesture: look inside the topmost open
   overlay first, and only fall back to the world underneath when nothing in there scrolls. */
const MEASURE = `
  const vis = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const scrolls = (e) => e && e.scrollHeight - e.clientHeight > 400 && /auto|scroll/.test(getComputedStyle(e).overflowY);
  let el = null;
  const ovs = [...document.querySelectorAll('.overlay:not(.hidden)')].filter(vis);
  const top = ovs[ovs.length - 1];         // showOverlay moves the opened one to the end of <body>
  if (top) el = [...top.querySelectorAll('*')].find(scrolls) || null;
  if (!el) el = [...document.querySelectorAll('.ac-list,.msg-scroll-vp,#acFeed,#notifList')].filter(vis).find(scrolls) || null;
  if (!el) { const d = document.scrollingElement; if (d && d.scrollHeight - d.clientHeight > 400) el = d; }
  if (!el) return { skipped: 'nothing long enough to scroll' };

  const start = el.scrollTop;
  /* FLING WHICHEVER WAY THERE IS ROOM. A conversation OPENS AT THE BOTTOM — deliberately, and
     the app spends a watchdog keeping it there — so scrolling it further down moves nothing at
     all, and the first version of this reported "0px of room" about the one surface in the app
     with eighty-odd messages in it. Everything else opens at the top. Ask, don't assume. */
  const dir = (el.scrollHeight - el.clientHeight - el.scrollTop) < 100 ? -40 : 40;
  const frames = []; let last = performance.now(), stop = false;
  const tick = (t) => { frames.push([t - last, el.scrollTop]); last = t; if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  /* 40px a frame is about 2400px/s — a real fling, not the 90px/frame stress test the first
     version used, which outran every surface's content and spent most of its frames clamped
     against the end doing nothing at all. */
  for (let i = 0; i < 45; i++) { el.scrollTop += dir; await new Promise((r) => requestAnimationFrame(r)); }
  stop = true;
  await new Promise((r) => setTimeout(r, 60));

  const f = frames.slice(3);               // the first few include this function's own setup
  /* ONLY THE FRAMES IN WHICH IT ACTUALLY MOVED COUNT. A scroller that hits its end keeps
     producing frames, and they are free — averaging them in makes a short surface look
     fast for the one reason that has nothing to do with how it renders. */
  const mv = f.filter((x, i) => i > 0 && x[1] !== f[i - 1][1]).map((x) => x[0]).sort((a, b) => a - b);
  const moved = Math.abs(el.scrollTop - start);
  if (moved < 700 || mv.length < 12) return { skipped: 'only ' + Math.round(moved) + 'px of room' };
  return { moved: Math.round(moved), n: mv.length,
    what: (el.id || (el.className || '').toString().split(' ')[0] || el.tagName).slice(0, 22),
    p50: +mv[Math.floor(mv.length * 0.5)].toFixed(1),
    p95: +mv[Math.floor(mv.length * 0.95)].toFixed(1),
    max: +mv[mv.length - 1].toFixed(1),
    long: mv.filter((x) => x > 32).length };
`;

(async () => {
  if (!TOK) { console.log('  skipped — export TOK first'); process.exit(0); }
  const cfg = await fetch(BASE + '/api/config').then((r) => r.status).catch(() => 0);
  if (cfg !== 200) { console.log('  skipped — no server on ' + BASE); process.exit(0); }

  /* THE PEER COMES FROM THE SERVER, NOT FROM A GUESS AT THE CLIENT'S OWN STATE. The first
     version read `AC._chats[0]` in the page — a field that does not exist — so `acOpenChat`
     was called with undefined, the thread screen opened EMPTY, and the probe reported
     "nothing long enough to scroll" about the one surface in the app with 84 messages in it.
     A conversation that never opened is not a conversation that scrolls badly. */
  const peer = await fetch(BASE + '/api/atchat/conversations', { headers: { Authorization: 'Bearer ' + TOK } })
    .then((r) => r.json()).then((d) => (d.conversations || [])[0] && (d.conversations || [])[0].id).catch(() => null);

  const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.addInitScript((t) => { localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, TOK);
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { window.w = (ms) => new Promise((r) => setTimeout(r, ms)); });

  /* IT MUST BE SIGNED IN BEFORE ANYTHING IS MEASURED, and this is not belt-and-braces — the
     first run of this probe reported "nothing long enough to scroll" on ALL EIGHT surfaces,
     which is the tell that the CHECK is broken rather than the app. Postgres had gone down
     under it: the app booted, painted a signed-out shell, and every scroller really was
     empty. A probe that measures a signed-out app reports a broken one. */
  const signedIn = await p.waitForFunction(() => typeof S !== 'undefined' && S && S.user && S.user.id,
    null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!signedIn) { console.log('  skipped — the page never signed in (stale TOK, or the database is down)'); await br.close(); process.exit(0); }

  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  console.log(`  (CPU throttled ${THROTTLE}x, ${RUNS} flings each — an unthrottled desktop renders all of this at 60fps whether or not a phone would)`);

  const results = [];
  for (const [name, steps] of SURFACES) {
    await p.evaluate(() => {
      document.querySelectorAll('.overlay:not(.hidden)').forEach((o) => o.classList.add('hidden'));
      document.body.className = document.body.className.replace(/\bnotif-tab\b|\bsb-open\b/g, '');
      try { appTab('home'); } catch (e) {}
    }).catch(() => {});
    await p.waitForTimeout(600);
    const src0 = steps.replace('__PEER__', String(peer));
    if (/__PEER__|undefined/.test(src0)) { console.log(`  · ${name.padEnd(22)} no conversation on this account — not judged`); results.push([name, null]); continue; }
    try { await p.evaluate(async (src) => { await (new Function('w', 'return (async()=>{' + src + '})()'))(window.w); }, src0); }
    catch (e) { ok(false, name + ' — opens at all', String(e.message).slice(0, 90)); continue; }
    await p.waitForTimeout(700);

    const runs = [];
    for (let k = 0; k < RUNS; k++) {
      const r = await p.evaluate(async (src) => await (new Function('return (async()=>{' + src + '})()'))(), MEASURE);
      if (r.skipped) { runs.push(r); break; }
      runs.push(r);
      await p.evaluate(() => { const e = document.querySelector('.ac-list,#acFeed,#notifList') ; }).catch(() => {});
      await p.waitForTimeout(700);
    }
    if (runs[0].skipped) { console.log(`  · ${name.padEnd(22)} ${runs[0].skipped} — not judged`); results.push([name, null]); continue; }
    const r = { what: runs[0].what, moved: med(runs.map((x) => x.moved)), n: med(runs.map((x) => x.n)),
      p50: med(runs.map((x) => x.p50)), p95: med(runs.map((x) => x.p95)),
      max: med(runs.map((x) => x.max)), long: med(runs.map((x) => x.long)) };
    results.push([name, r]);
    console.log(`  · ${name.padEnd(22)} p50 ${String(r.p50).padStart(5)}ms · p95 ${String(r.p95).padStart(5)}ms · worst ${String(r.max).padStart(5)}ms · ${r.long}/${r.n} long  [${r.what}, ${r.moved}px]`);
  }

  const judged = results.filter((x) => x[1]);
  /* A FLOOR, NOT A COUNT. Two of these surfaces are legitimately short on a test account
     (the Account page is 434px of room, Engine 553) and skip honestly, by name, in the list
     above. What this catches is the failure that has actually happened: the whole app coming
     up empty — a dead database, a stale token — where every surface skips and a run of
     nothing but skips would otherwise read as a clean pass. */
  ok(judged.length >= 4, 'enough of the app had something to scroll to judge', judged.length + ' surfaces');

  for (const [name, r] of judged) {
    ok(r.p50 <= 20, `${name}: the ordinary frame is on time`, `p50 ${r.p50}ms`);
    ok(r.max <= 120, `${name}: nothing stalls`, `worst frame ${r.max}ms`);
    ok(r.long <= r.n * 0.5, `${name}: it is not an outlier`, `${r.long} of ${r.n} frames over 32ms`);
  }

  /* HOW MUCH OF A SCROLL FRAME IS OURS — the check with real teeth, and the only one here
     that is not at the mercy of the noise above. Dropped frames vary by ten between two runs
     of identical code because they are dominated by the browser rasterising real photos; the
     milliseconds the APP's OWN JavaScript spends per moving frame do not. Measured with
     Chrome's sampling profiler over one fling of the Home feed — the busiest surface in the
     app — it is about 1ms per frame at a 6x throttle, i.e. under a fifth of a millisecond on
     an unthrottled machine, against a 16.7ms budget. That is the number a regression moves:
     injecting a deliberate 14ms of work per scroll event takes it to 2.9ms while leaving the
     dropped-frame count inside its own noise. The bar is 3ms, three times the measured cost.

     WHAT COUNTS AS OURS: any sample in a frame from this origin's script, plus the native
     calls with no url of their own (getBoundingClientRect, querySelectorAll, setProperty) —
     those have no url because they are native, but nothing except our code calls them here,
     and they are exactly where a per-frame layout read would show up. (program), (idle) and
     the garbage collector are the browser's, and are excluded. */
  await p.evaluate(() => { try { appTab('home'); } catch (e) {} });
  await p.waitForTimeout(2200);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });        // 0.2ms
  await p.evaluate(() => { document.scrollingElement.scrollTop = 0; });
  await p.waitForTimeout(800);
  await cdp.send('Profiler.start');
  const flung = await p.evaluate(async () => {
    const el = document.scrollingElement; let moved = 0, was = el.scrollTop;
    for (let i = 0; i < 60; i++) { el.scrollTop += 40; await new Promise((r) => requestAnimationFrame(r));
      if (el.scrollTop !== was) { moved++; was = el.scrollTop; } }
    return moved;
  });
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let ourSamples = 0;
  for (const sid of profile.samples) {
    const n = byId.get(sid); if (!n) continue;
    const f = n.callFrame, nm = f.functionName || '';
    if (nm === '(idle)' || nm === '(program)' || nm === '(garbage collector)' || nm === '(root)') continue;
    if ((f.url && f.url.indexOf(BASE) === 0) || !f.url) ourSamples++;
  }
  const msPerFrame = flung ? +((ourSamples * 0.2) / flung).toFixed(2) : 99;
  console.log(`  · our own JavaScript      ${msPerFrame}ms per scroll frame of the 16.7ms budget (Home feed)`);
  ok(msPerFrame <= 3, "the app's own code is a small part of a scroll frame",
    msPerFrame + 'ms of our JS per moving frame (' + flung + ' frames, 16.7ms budget)');

  /* REDUCED MOTION IS A PROMISE. The app claims a full @media(prefers-reduced-motion) reset;
     if a real animation still runs there, the setting is decoration. */
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
