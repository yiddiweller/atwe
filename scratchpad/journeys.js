/* THE JOURNEYS A REAL PERSON HAS TO COMPLETE.
 *
 * signupflow.js exists because every probe in this repo drove SCREENS and none asked
 * the question a stranger asks — can I actually join? The answer was no, for weeks,
 * with everything green. This asks the same kind of question about the other paths a
 * person must be able to finish, and it asks them END TO END rather than a route at a
 * time: a route that answers 200 proves nothing if the next step can't use what it
 * returned.
 *
 *   1. I FORGOT MY PASSWORD. Ask for a code, read it, set a new password, and — the
 *      part a route test never reaches — sign in with the NEW password and confirm the
 *      OLD one is dead. A reset that leaves the old password working is worse than one
 *      that fails.
 *   2. I WROTE MY FIRST POST. It has to appear on my own profile afterwards.
 *   3. I BOUGHT SOMETHING. Money in, money out, and the order really exists — with the
 *      pennies conserved on both sides.
 *   4. I CHANGED MY EMAIL. On a box that can deliver, it works; the account moves.
 *   5. I WAS SUSPENDED AND I WANT TO APPEAL. Driven through the REAL sign-in screen,
 *      because that is the only door there is — a locked-out member cannot get inside
 *      the app to find one. All four ids the appeal code referenced (#loginAppeal,
 *      #appealForm, #appealOpenBtn, #appealMsg) were missing from the markup entirely,
 *      so the server route and the admin Appeals queue were both real and NOBODY could
 *      ever file one. A route test cannot see that; only pressing the screen can.
 *
 * The server is spawned HERE, like signupflow.js, because the 6-digit reset code exists
 * only in its stdout on a box with no SMTP — the database stores a hash of it.
 *
 * Self-test: make /api/auth/reset/confirm skip the password write and journey 1 goes red
 * on "the new password signs me in".
 */
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = 3291;
const DB = process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore';

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

let out = '';
const srv = spawn('node', [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: process.env.JWT_SECRET || 'scoresecret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => { out += d.toString(); });
srv.stderr.on('data', (d) => { out += d.toString(); });
const stop = () => { try { srv.kill('SIGKILL'); } catch (e) {} };

const call = async (method, p, body, token) => {
  const r = await fetch(`http://localhost:${PORT}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j || {} };
};
const post = (p, b, t) => call('POST', p, b, t);
const get = (p, t) => call('GET', p, undefined, t);

/* /api/config sits behind the still-setting-up gate; /api/health deliberately does not
   and answers long before db.init() finishes. Waiting on health is how a probe in this
   repo once spent a whole run collecting 503s. */
const waitUp = async () => {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/config`); if (r.ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
};
/* The code is printed to stdout asynchronously, AFTER the route has answered — so it
   may not be there the instant the call returns. Poll for it. */
const grabCode = async (mark) => {
  for (let i = 0; i < 40; i++) {
    const tail = out.slice(mark);
    const m = [...tail.matchAll(/\b(\d{6})\b/g)];
    if (m.length) return m[m.length - 1][1];
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
};

(async () => {
  if (!(await waitUp())) { console.log('server never came up'); stop(); process.exit(1); }

  const stamp = Date.now();
  const EMAIL = `journey.${stamp}@example.com`;
  const PW1 = 'Journey-first-1!';
  const PW2 = 'Journey-second-2!';

  /* ─── set-up: a real account, made the real way ──────────────────────────── */
  let mark = out.length;
  const start = await post('/api/auth/signup/start', { email: EMAIL });
  ok(start.status === 200, 'a stranger can start signing up', start.status + ' ' + JSON.stringify(start.body));
  const code = await grabCode(mark);
  ok(!!code, 'and the code really is sent (read from the server itself)');
  const fin = await post('/api/auth/signup/finish', {
    email: EMAIL, code, name: 'Journey Person', password: PW1,
    username: 'journey' + String(stamp).slice(-8), dob: '1990-05-05',
  });
  let token = fin.body.token;
  ok(!!token, 'and the account exists', fin.status + ' ' + JSON.stringify(fin.body).slice(0, 200));
  if (!token) { stop(); console.log(`ok checks: ${pass}`); console.log(`${fails.length} FAILED`); process.exit(1); }
  const me = await get('/api/auth/me', token);
  const myId = me.body.user && me.body.user.id;
  const myHandle = me.body.user && me.body.user.username;

  /* ─── 1. I forgot my password ────────────────────────────────────────────── */
  mark = out.length;
  const rs = await post('/api/auth/reset/send', { identifier: EMAIL });
  ok(rs.status === 200, 'I can ask for a password reset', rs.status + ' ' + JSON.stringify(rs.body));
  const rcode = await grabCode(mark);
  ok(!!rcode, 'and the reset code really is sent');
  const check = await post('/api/auth/reset/check', { identifier: EMAIL, code: rcode });
  ok(check.status === 200, 'the code is accepted at the code step', check.status + ' ' + JSON.stringify(check.body));
  const conf = await post('/api/auth/reset/confirm', { identifier: EMAIL, code: rcode, password: PW2 });
  ok(conf.status === 200 && !!conf.body.token, 'and I can set a new password', conf.status + ' ' + JSON.stringify(conf.body).slice(0, 160));
  /* The part a route test never reaches. */
  const newLogin = await post('/api/auth/login', { email: EMAIL, password: PW2 });
  ok(newLogin.status === 200 && !!newLogin.body.token, 'the NEW password signs me in', newLogin.status + ' ' + JSON.stringify(newLogin.body).slice(0, 160));
  const oldLogin = await post('/api/auth/login', { email: EMAIL, password: PW1 });
  ok(oldLogin.status === 401, 'and the OLD password is dead', oldLogin.status);
  /* A single-use code must not work twice. */
  const replay = await post('/api/auth/reset/confirm', { identifier: EMAIL, code: rcode, password: 'Replay-attempt-3!' });
  ok(replay.status !== 200, 'the same reset code cannot be used again', replay.status);
  const stillNew = await post('/api/auth/login', { email: EMAIL, password: PW2 });
  ok(stillNew.status === 200, 'and my password is still the one I chose', stillNew.status);
  token = stillNew.body.token;

  /* ─── 2. I wrote my first post ───────────────────────────────────────────── */
  const body = 'My very first post on Atwe ' + stamp;
  const mk = await post('/api/social/posts', { body }, token);
  ok(mk.status === 200 || mk.status === 201, 'I can write my first post', mk.status + ' ' + JSON.stringify(mk.body).slice(0, 160));
  const prof = await get('/api/social/profile/' + myHandle, token);
  const posts = (prof.body && (prof.body.posts || (prof.body.profile && prof.body.profile.posts))) || [];
  ok(posts.some((x) => (x.body || '') === body), `and it is on my own profile (${posts.length} there)`);

  /* ─── 3. I bought something ──────────────────────────────────────────────── */
  /* A seller with something to sell, made through the real routes. */
  const sEmail = `seller.${stamp}@example.com`;
  mark = out.length;
  await post('/api/auth/signup/start', { email: sEmail });
  const sCode = await grabCode(mark);
  const sFin = await post('/api/auth/signup/finish', {
    email: sEmail, code: sCode, name: 'Journey Seller', password: PW1,
    username: 'jseller' + String(stamp).slice(-8), dob: '1990-05-05',
  });
  const sTok = sFin.body.token;
  ok(!!sTok, 'a seller account exists');
  const prod = await post('/api/products', { name: 'A journey widget', priceCents: 1200, kind: 'digital', digitalContent: 'thank you' }, sTok);
  const pid = prod.body && (prod.body.product || prod.body).id;
  ok(!!pid, 'with something for sale', prod.status + ' ' + JSON.stringify(prod.body).slice(0, 160));

  const top = await post('/api/wallet/topup', { amount: 50, clientId: 'journey-top-' + stamp }, token);
  ok(top.status === 200, 'I can put money in my wallet', top.status + ' ' + JSON.stringify(top.body).slice(0, 160));
  const w0 = await get('/api/wallet', token);
  const bal0 = w0.body.balanceCents || 0;
  ok(bal0 >= 5000, `and the balance shows it ($${(bal0 / 100).toFixed(2)})`);

  const sw0 = (await get('/api/wallet', sTok)).body.balanceCents || 0;
  const buy = await post('/api/orders/buy', { productId: pid, qty: 1, payWith: 'balance', clientId: 'journey-buy-' + stamp }, token);
  ok(buy.status === 200, 'I can buy it with that money', buy.status + ' ' + JSON.stringify(buy.body).slice(0, 200));
  const bal1 = (await get('/api/wallet', token)).body.balanceCents || 0;
  const sw1 = (await get('/api/wallet', sTok)).body.balanceCents || 0;
  ok(bal0 - bal1 === 1200, `and exactly the price left my wallet (${bal0 - bal1}c)`);
  ok(sw1 > sw0, `and the seller was paid (${sw1 - sw0}c, less Atwe's cut)`);
  const orders = await get('/api/orders?scope=buyer', token);
  const list = orders.body.orders || orders.body || [];
  ok(Array.isArray(list) && list.length >= 1, `and the order is in my Orders (${list.length})`);

  /* Buying twice with the SAME clientId must charge once — a double-tap is a retry. */
  const again = await post('/api/orders/buy', { productId: pid, qty: 1, payWith: 'balance', clientId: 'journey-buy-' + stamp }, token);
  const bal2 = (await get('/api/wallet', token)).body.balanceCents || 0;
  ok(bal2 === bal1, `a double-tap does not charge me twice (${bal1}c then ${bal2}c)`, again.status);

  /* ─── 4. I changed my email ──────────────────────────────────────────────── */
  const NEW_EMAIL = `journey.moved.${stamp}@example.com`;
  const ce = await post('/api/auth/change-email', { email: NEW_EMAIL, password: PW2 }, token);
  ok(ce.status === 200, 'I can change my email when mail works', ce.status + ' ' + JSON.stringify(ce.body).slice(0, 160));
  const meNow = await get('/api/auth/me', token);
  ok((meNow.body.user || {}).email === NEW_EMAIL, 'and my account really moved to it');
  const oldEmailLogin = await post('/api/auth/login', { email: EMAIL, password: PW2 });
  ok(oldEmailLogin.status !== 200, 'the old address no longer signs me in', oldEmailLogin.status);
  const newEmailLogin = await post('/api/auth/login', { email: NEW_EMAIL, password: PW2 });
  ok(newEmailLogin.status === 200, 'the new one does', newEmailLogin.status);

  ok(!!myId, 'the account had an id throughout');

  /* ─── 5. I was suspended, and I want to appeal ────────────────────────────
     Setup writes the status straight to the database on purpose: the admin route that
     does this has its own coverage, and what is being tested here is the MEMBER's way
     back, which starts at a screen they see before they are anybody. */
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DB, ssl: false });
  await pool.query(`UPDATE users SET status='suspended', status_reason='Testing the way back' WHERE lower(email)=$1`, [NEW_EMAIL]);

  const blocked = await post('/api/auth/login', { email: NEW_EMAIL, password: PW2 });
  ok(blocked.status === 403 && blocked.body.accountBlocked, 'a suspended account cannot sign in', blocked.status + ' ' + JSON.stringify(blocked.body).slice(0, 120));

  const br = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  const perrs = [];
  pg.on('pageerror', (e) => perrs.push(String(e)));
  await pg.goto(`http://localhost:${PORT}/login`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(5200);

  const press = (rx) => {
    const btns = [...document.querySelectorAll('button')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 16 && e.offsetParent && getComputedStyle(e).visibility !== 'hidden';
    });
    const b = btns.find((e) => rx.test(e.textContent.trim()));
    if (!b || b.disabled) return false;
    b.click(); return true;
  };
  const fill = ([id, v]) => { const f = document.getElementById(id); if (!f) return false; f.focus(); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); return true; };
  const seen = (id) => { const e = document.getElementById(id); return !!(e && e.offsetParent && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'); };

  await pg.evaluate(press, /Continue with Email/i);
  await pg.waitForTimeout(1200);
  await pg.evaluate(fill, ['loginEmailAddr', NEW_EMAIL]);
  await pg.waitForTimeout(400);
  await pg.evaluate(press, /^Continue$/i);
  await pg.waitForTimeout(2200);
  await pg.evaluate(fill, ['loginPass', PW2]);
  await pg.waitForTimeout(400);
  await pg.evaluate(press, /^Continue$/i);
  await pg.waitForTimeout(2600);

  ok(await pg.evaluate(seen, 'loginAppeal'), 'and IS OFFERED A WAY TO APPEAL on the sign-in screen');
  ok(await pg.evaluate(() => (document.getElementById('loginError')?.textContent || '').length > 0), 'with the reason shown');
  await pg.evaluate(press, /Appeal this decision/i);
  await pg.waitForTimeout(600);
  ok(await pg.evaluate(seen, 'appealMsg'), 'tapping it opens a box to write in');
  await pg.evaluate(fill, ['appealMsg', 'I believe this was a mistake. Please take another look.']);
  await pg.waitForTimeout(300);
  await pg.evaluate(press, /Send appeal/i);
  await pg.waitForTimeout(2600);
  const filed = await pool.query(`SELECT state, message FROM appeals a JOIN users u ON u.id = a.user_id WHERE lower(u.email) = $1`, [NEW_EMAIL]);
  ok(filed.rowCount === 1 && filed.rows[0].state === 'open', `and the appeal really reaches the team (${filed.rowCount} row)`, JSON.stringify(filed.rows[0] || {}));
  ok(await pg.evaluate(() => /submitted/i.test(document.getElementById('appealForm')?.textContent || '')), 'and I am told it was submitted');
  ok(perrs.length === 0, `no JS errors on the way (${perrs.slice(0, 2).join(' | ')})`);

  /* The appeal must not linger over an UNRELATED error — sign in as somebody fine. */
  await pg.evaluate(() => { try { setLoginError('Password is incorrect.'); } catch (e) {} });
  await pg.waitForTimeout(300);
  ok(!(await pg.evaluate(seen, 'loginAppeal')), 'and it goes away again on any other sign-in error');

  await ctx.close(); await br.close(); await pool.end();

  stop();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${pass}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every journey a person must finish, finishes');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(1); });
