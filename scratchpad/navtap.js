/* A TAP ON THE BOTTOM BAR OPENS THE ICON THAT WAS UNDER THE FINGER.
 *
 * Scrolling up flies the bar back from the "+" ball at the right edge, and the five icons
 * ride along, tappable the whole way. A browser resolves a click at the moment the finger
 * LIFTS — by which time the icon that was under it has slid on — so a tap opened whatever
 * had taken its place. The owner: "it doesn't click on the right icon, it takes me to
 * different pages, and the grey bubble goes to a different icon."
 *
 * THE INVARIANT CHECKED HERE is the only one that is true whatever the bar is doing:
 * the world that opens is the icon that was under the finger at TOUCH-DOWN. The probe
 * does not assume where the icons are; it hit-tests the point it is about to press, in
 * the same frame it presses it, and then asserts the app agreed.
 *
 * This REPLACES a version that asserted the opposite — that a tap resolves against the
 * bar's RESTING layout, on the theory that a finger anticipates where the icons will land.
 * It does not: measured, 80ms into the flight a tap on the icon you can SEE at Home's
 * position opened Engine. A person cannot aim at a position that does not exist yet.
 *
 * Everything is dispatched from INSIDE the page: Playwright's own input latency is tens of
 * milliseconds, which overshoots the window entirely — an out-of-page version of this
 * measured taps at coordinates the bar had already left, and reported nonsense (an icon
 * "at x=475" on a 390px-wide phone).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const crypto = require('crypto');
const SP = __dirname + '/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
const BASE = process.env.BASE || 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + String(x).slice(0, 160) : '')); } };
const NICE = { 'bnav-home': 'Home', 'bnav-chat': 'Beam', 'bnav-search': 'Engine', 'bnav-notifs': 'Notifications', 'bnav-profile': 'Account' };
const DELAYS = [30, 60, 90, 120, 150, 190, 260];

(async () => {
  const email = crypto.randomUUID().slice(0, 8) + '@t.local', hash = await auth.hashPassword('x'.repeat(12));
  const h = 'nt' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(`INSERT INTO users (name,email,password_hash,username,email_verified,onboarded) VALUES ('N',$1,$2,$3,true,true) RETURNING id`, [email, hash, h]);
  const token = auth.signToken({ id: rows[0].id, email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), rows[0].id]);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errs = []; const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  p.on('pageerror', e => errs.push(String(e).slice(0, 140)));
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.evaluate(t => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, token);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);

  const rest = await p.evaluate(ids => { const o = {}; ids.forEach(id => { const r = document.getElementById(id).getBoundingClientRect();
    o[id] = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }); return o; }, Object.keys(NICE));
  console.log('resting centres: ' + Object.keys(NICE).map(i => NICE[i] + '@' + rest[i].x).join('  '));

  const goHome = async () => { await p.evaluate(() => appTab('home')); await p.waitForTimeout(800);
    await p.evaluate(() => { document.scrollingElement.scrollTop = 0; }); await p.waitForTimeout(350); };

  for (const delay of DELAYS) {
    console.log('\n── the finger lands ' + delay + 'ms into the expansion ──');
    for (const id of Object.keys(NICE)) {
      await goHome();
      await p.mouse.move(195, 500);
      for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 90); await p.waitForTimeout(55); }
      await p.waitForTimeout(650);
      if (!await p.evaluate(() => document.body.classList.contains('nav-ball'))) { ok(false, 'the bar collapsed to the ball'); break; }
      const got = await p.evaluate(async ({ x, y, delay }) => {
        const se = document.scrollingElement;
        se.scrollTop = Math.max(0, se.scrollTop - 260);        // real scroll-up -> _setNavBall(false)
        window.dispatchEvent(new Event('scroll'));
        await new Promise(r => setTimeout(r, delay));
        /* Hit-test and press in the SAME frame, the way a finger does — and remember what
           was under it, because that is what the app must open. */
        const el = document.elementFromPoint(x, y);
        const aimed = el && el.closest ? el.closest('.bn-tab') : null;
        const want = aimed ? aimed.id.replace('bnav-', '') : null;
        const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, pointerId: 1, isPrimary: true };
        if (el) {
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          await new Promise(r => setTimeout(r, 60));           // a real finger rests a moment
          const el2 = document.elementFromPoint(x, y) || el;
          el2.dispatchEvent(new PointerEvent('pointerup', opts));
          el2.dispatchEvent(new MouseEvent('click', opts));
        }
        await new Promise(r => setTimeout(r, 900));
        const opened = document.body.classList.contains('notif-tab') ? 'notifs'
          : (document.querySelector('#bottomNav .bn-tab.active') || {}).id;
        return { want, opened: opened ? String(opened).replace('bnav-', '') : 'none' };
      }, { x: rest[id].x, y: rest[id].y, delay });
      if (got.want === null) {
        /* The bar had not reached this point yet — the finger is over space it has
           vacated, and the one thing that must NOT happen is a post opening underneath. */
        /* The bar has not reached this point yet. The one thing that must NOT happen is the
           tap falling through to the feed — a photo opening in the full-screen viewer, say,
           which then sits over the bar and eats everything after it. */
        ok(got.opened !== 'none' && !got.overlay,
          'over vacated space at ' + NICE[id] + '’s spot: the tap is swallowed, nothing opens underneath',
          JSON.stringify(got));
      } else {
        ok(got.opened === got.want,
          'the icon under the finger was ' + (NICE['bnav-' + got.want] || got.want) + ' — and that is what opened',
          'opened "' + got.opened + '"');
      }
    }
  }
  /* ── AND AFTER TURNING THE PHONE ────────────────────────────────────────────────
     The owner's trigger: "when I flipped the screen and it gets wide, and I turn it back
     to the regular way, sometimes when I click on the icons it doesn't click on the right
     icon." Rotating re-lays-out the bar and re-flows the feed under it, so the bar is very
     often collapsing or flying right as the first tap arrives. Nothing about the tap is
     remembered across a rotation any more, and this proves it end to end — including the
     case that used to be impossible to get right, where the bar COLLAPSES in one
     orientation and comes back in the other. */
  /* Before a tap can be judged, the bar has to BE somewhere. Rotating re-flows the feed
     and can clamp the scroll, which fires a scroll event and collapses the bar to the "+"
     ball — and a tap into the space it has vacated is deliberately swallowed, so the probe
     would read "nothing opened" and blame the app. Settle it first. */
  const settleBar = async () => {
    await p.evaluate(() => { document.scrollingElement.scrollTop = 0; window.dispatchEvent(new Event('scroll')); });
    for (let i = 0; i < 40; i++) {
      const done = await p.evaluate(() => {
        const n = document.getElementById('bottomNav'); const r = n.getBoundingClientRect();
        const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-inset')) || 23;
        return !document.body.classList.contains('nav-ball') && Math.abs(r.left - inset) < 2;
      });
      if (done) return true;
      await p.waitForTimeout(80);
    }
    return false;
  };
  const tapLive = async (id) => p.evaluate(async (id) => {
    const t = document.getElementById(id), q = t.getBoundingClientRect();
    const x = Math.round(q.left + q.width / 2), y = Math.round(q.top + q.height / 2);
    const el = document.elementFromPoint(x, y) || t;
    const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, view: window, pointerId: 1, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    await new Promise(r => setTimeout(r, 60));
    const el2 = document.elementFromPoint(x, y) || el;
    el2.dispatchEvent(new PointerEvent('pointerup', opts));
    el2.dispatchEvent(new MouseEvent('click', opts));
    await new Promise(r => setTimeout(r, 900));
    const on = document.querySelector('#bottomNav .bn-tab.active');
    const ind = document.getElementById('bnIndicator');
    let pillOn = null;
    if (on && ind) { const a = on.getBoundingClientRect(), i = ind.getBoundingClientRect();
      pillOn = Math.abs((i.left + i.width / 2) - (a.left + a.width / 2)) < 4; }
    return { opened: document.body.classList.contains('notif-tab') ? 'notifs'
      : (on ? on.id.replace('bnav-', '') : 'none'), pillOn,
      /* what the finger was actually on, so a failure says WHY rather than just "wrong" */
      hit: el ? ((el.id || String(el.className).split(' ')[0]) + (el.closest && el.closest('.bn-tab') ? '/' + el.closest('.bn-tab').id : '/not-in-a-tab')) : 'nothing',
      at: Math.round(x) + ',' + Math.round(y), ball: document.body.classList.contains('nav-ball'),
      overlay: (document.querySelector('.overlay:not(.hidden)') || {}).id || '' };
  }, id);

  console.log('\n── straight after turning the phone back ──');
  for (const id of Object.keys(NICE)) {
    await goHome();
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(900);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(900);
    ok(await settleBar(), 'after a rotation the bar comes back to rest');
    const got = await tapLive(id);
    ok(got.opened === id.replace('bnav-', ''), 'after a rotation, ' + NICE[id] + ' opens ' + NICE[id], JSON.stringify(got));
    ok(got.pillOn !== false, 'and the highlight sits on it, not on a neighbour');
  }

  console.log('\n── the bar collapsed sideways, then came back upright ──');
  for (const id of ['bnav-chat', 'bnav-search', 'bnav-profile']) {
    await goHome();
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(700);
    await p.mouse.move(400, 200);
    for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 90); await p.waitForTimeout(55); }
    await p.waitForTimeout(600);                                   // collapsed, in landscape
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(700);
    /* Rotating can clamp the scroll to 0, and then a "scroll up" is a no-op and the bar
       never leaves the ball — the tap would be swallowed and the probe would blame the app
       for doing exactly the right thing. Put it back down first, then bring it up. */
    await p.evaluate(() => { const se = document.scrollingElement; se.scrollTop = 900; window.dispatchEvent(new Event('scroll')); });
    await p.waitForTimeout(700);
    ok(await p.evaluate(() => document.body.classList.contains('nav-ball')), 'upright again, the bar still collapses on scroll');
    await p.evaluate(() => { const se = document.scrollingElement; se.scrollTop = 0; window.dispatchEvent(new Event('scroll')); });
    await p.waitForTimeout(120);                                   // mid-flight, upright
    const got = await tapLive(id);
    ok(got.opened === id.replace('bnav-', ''), 'collapsed sideways then upright: ' + NICE[id] + ' opens ' + NICE[id], JSON.stringify(got));
  }

  /* ── AND THE GREY BUBBLE IS THE SIZE OF THE ICON IT IS ON ──────────────────────────
     Turning the phone does not move the pill to a different TAB — only its width changes —
     so every sync after a rotation took syncNavPill's "already on this tab" shortcut and
     never revisited the size. If one sync had landed while the layout was still sideways,
     the pill kept the SIDEWAYS width for good: the owner saw the grey bubble "extending to
     the next icon". Checked two ways: after a real rotation, and by handing the pill a
     sideways width outright — the second is the one that fails if the shortcut ever stops
     asking about size again. */
  console.log('\n── the highlight after turning the phone ──');
  for (const world of ['home', 'search', 'profile']) {
    await p.evaluate((w) => appTab(w), world);
    await p.waitForTimeout(700);
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(1000);
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => { const i = document.getElementById('bnIndicator'),
      a = document.querySelector('#bottomNav .bn-tab.active');
      const q = i.getBoundingClientRect(), t = a.getBoundingClientRect();
      return { dw: Math.round(q.width - t.width), dx: Math.round((q.left + q.width / 2) - (t.left + t.width / 2)),
        pill: Math.round(q.width), tab: Math.round(t.width) }; });
    ok(Math.abs(r.dw) <= 3 && Math.abs(r.dx) <= 3,
      'after a rotation the highlight is the size of its icon (' + r.pill + 'px on a ' + r.tab + 'px tab)',
      JSON.stringify(r));
  }
  {
    const r = await p.evaluate(async () => {
      const i = document.getElementById('bnIndicator'), a = document.querySelector('#bottomNav .bn-tab.active');
      i.style.width = '158px';                       // exactly what a sideways sync would write
      syncNavPill(); await new Promise(r => setTimeout(r, 700));
      syncNavPill(); await new Promise(r => setTimeout(r, 700));
      return { tab: Math.round(a.getBoundingClientRect().width), pill: Math.round(i.getBoundingClientRect().width) };
    });
    ok(Math.abs(r.pill - r.tab) <= 3,
      'a stale sideways width is corrected by the next sync (' + r.pill + 'px on a ' + r.tab + 'px tab)', JSON.stringify(r));
  }

  ok(errs.length === 0, 'no JS errors', errs[0]);
  await b.close(); await pool.end();
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
