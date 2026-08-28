// The check that would have caught this in seconds: every .overlay must be a direct
// child of <body>. One missing </div> silently nests dozens of them inside a hidden
// container, and every button in them stops working with no error in the console.
process.env.JWT_SECRET = 'scoresecret';
const crypto = require('crypto');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const pool = new Pool({ connectionString: 'postgres://atwe:atwe@localhost:5432/atwescore' });
const B = 'http://localhost:' + (process.env.PORT || 3262);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  const { rows } = await pool.query("SELECT id,email FROM users WHERE name='Click Tester' ORDER BY id DESC LIMIT 1");
  const me = rows[0];
  const token = auth.signToken({ id: me.id, email: me.email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1') ON CONFLICT DO NOTHING",
    [crypto.createHash('sha256').update(token).digest('hex'), me.id]);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam','circles','ai','wallet'])); }, token);
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4200);

  const r = await p.evaluate(() => {
    const all = [...document.querySelectorAll('.overlay')];
    const stray = all.filter((o) => o.parentElement !== document.body)
      .map((o) => (o.id || String(o.className).slice(0, 26)) + '  → nested inside ' +
        (o.parentElement.tagName + (o.parentElement.id ? '#' + o.parentElement.id : '.' + String(o.parentElement.className).split(' ')[0])));
    // anything at all that ended up inside a call overlay it has no business being in
    const inCall = [...document.querySelectorAll('#groupCallOverlay > *, #callOverlay > *')]
      .filter((e) => !/call-card|gc-card/.test(e.className)).map((e) => e.id || e.className);
    // screens must live in the app shell, not in an overlay
    const strayScreens = [...document.querySelectorAll('.ac-screen')]
      .filter((s) => s.closest('.overlay')).map((s) => s.id);
    return { total: all.length, stray, inCall, strayScreens,
      bodyKids: document.body.children.length };
  });
  console.log('  ' + r.total + ' overlays in the page, ' + r.bodyKids + ' direct children of <body>');
  ok(r.stray.length === 0, 'every overlay is a direct child of <body>' + (r.stray.length ? ' — ' + r.stray.length + ' are not' : ''));
  r.stray.slice(0, 12).forEach((s) => console.log('       ' + s));
  ok(r.inCall.length === 0, 'nothing foreign is nested inside a call overlay' + (r.inCall.length ? ' — ' + r.inCall.slice(0, 6).join(', ') : ''));
  ok(r.strayScreens.length === 0, 'no app screen is trapped inside an overlay' + (r.strayScreens.length ? ' — ' + r.strayScreens.join(', ') : ''));

  // and then: does every overlay the app can open actually become visible?
  const OPENERS = [
    ['notifOverlay', 'openNotifications()'], ['settingsOverlay', 'openSettings()'], ['walletView', 'acOpenWallet()'],
    ['ordersView', "acOpenOrders('buyer')"], ['marketplaceView', 'acOpenMarketplace()'], ['sellView', 'acOpenSell()'],
    ['cartView', 'acOpenCart()'], ['giftCardView', 'acOpenGiftCards()'], ['loyaltyView', 'acOpenLoyalty()'],
    ['agendaView', 'acOpenAgenda()'], ['coursesView', 'acOpenCourses()'], ['eventsView', 'acOpenEvents()'],
    ['servicesView', 'acOpenServices()'], ['jobsView', 'acOpenJobs()'], ['dashboardView', 'acOpenDashboard()'],
    ['profileOverlay', 'openProfileEdit()'], ['invoicesView', 'acOpenInvoices()'], ['subsView', 'acOpenSubs()'],
  ];
  console.log('\n  ── does each overlay actually appear on screen? ──');
  for (const [id, call] of OPENERS) {
    const exists = await p.evaluate((i) => !!document.getElementById(i), id);
    if (!exists) { console.log('       ' + id + ' — not in this build'); continue; }
    await p.evaluate(() => { document.querySelectorAll('.overlay.show').forEach((o) => o.classList.remove('show')); });
    await p.waitForTimeout(250);
    const n0 = errs.length;
    try { await p.evaluate(call); } catch (e) { ok(false, id + ': ' + call + ' threw (' + String(e.message).slice(0, 60) + ')'); continue; }
    await p.waitForTimeout(1300);
    const vis = await p.evaluate((i) => { const o = document.getElementById(i); const cs = getComputedStyle(o), r = o.getBoundingClientRect();
      return { d: cs.display, op: cs.opacity, h: Math.round(r.height), w: Math.round(r.width) }; }, id);
    ok(vis.d !== 'none' && vis.h > 120 && parseFloat(vis.op) > .5,
      id.padEnd(18) + ' opens (' + vis.w + '×' + vis.h + ', display:' + vis.d + ', opacity:' + vis.op + ')');
    if (errs.length > n0) ok(false, id + ': threw ' + errs[n0]);
  }
  ok(errs.length === 0, 'zero JS errors overall (' + errs.length + ')' + (errs.length ? ' :: ' + errs[0] : ''));
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  await p.close(); await b.close(); await pool.end(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
