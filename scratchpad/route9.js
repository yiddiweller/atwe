/* Route batch 9 — the server understands the canonical route system.
 *
 *   REDIRECTS   every legacy rename 301s at the SERVER (derived from the registry's
 *               aliases): world roots, flat Engine/Account words, /devices; a stale or
 *               missing entity slug; /post/:id → /<author>/post/:id. Query kept, no loops.
 *   STATUS      unknown shape 404; unknown / deactivated / suspended username one identical
 *               404; renamed username 301; deleted public entity 410; invalid id 404; a
 *               database failure 503, never a false 404; a private address answers the same
 *               whether it exists, is someone else's, or not.
 *   USERNAMES   rename → old handle 301s (server) AND follows inside the app (no server
 *               round trip); 30-day hold against everyone else; the owner may take it back;
 *               after the hold the new owner wins; a deleted account's handle is held.
 *   AUTH RETURN a protected direct link survives sign-in by email, a simulated FULL OAuth
 *               redirect (the tab reloads at /), Google and Apple; /login?next= works; an
 *               external or malformed next is refused and never stored.
 *   SEO         canonical + OG for public families; noindex for 404/410/private/auth/search;
 *               a private route's card carries nothing private.
 *
 * Owns its fixture. Browser checks at 390x844 and 1440x900.
 *
 *   node route9.js                 the checks
 *   node route9.js --break=next    sign-in never writes its destination down   (must FAIL)
 *   node route9.js --break=open    the destination is stored unsanitised        (must FAIL)
 *   node route9.js --break=moved   the app ignores where a handle went          (must FAIL)
 *   node route9.js --break=status  a 404 is served as 200 (the detector itself) (must FAIL)
 * Client mutations are applied to the RESPONSE in flight (never to a file on disk), and a
 * stale mutation throws by name.
 */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const R = require(path.join(__dirname, '..', 'public', 'atwe-routes.js'));
const { chromium } = require(process.env.PW_SCRATCH
  ? path.join(process.env.PW_SCRATCH, 'node_modules/playwright-core')
  : path.join(__dirname, 'node_modules/playwright-core'));

const BREAK = process.argv.find((a) => a.startsWith('--break'));
const BREAK_KIND = BREAK ? (BREAK.split('=')[1] || 'next') : null;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
const BASE = QA.base();
const BOT = 'Mozilla/5.0 (compatible; Twitterbot/1.0)';
let pass = 0, fail = 0;
const say = (ok, what, extra) => { ok ? pass++ : fail++; console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra !== undefined && !ok ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); };

const MUT = {
  next: { html: [[`  if (!safe || safe === '/') return null;\n  try { localStorage.setItem(AUTH_NEXT_KEY`, `  return null;\n  try { localStorage.setItem(AUTH_NEXT_KEY`]] },
  open: { html: [[`function acSafeNext(raw) { try { return (window.ATWE_ROUTES && ATWE_ROUTES.safeNext) ? ATWE_ROUTES.safeNext(raw) : null; } catch (e) { return null; } }`,
                  `function acSafeNext(raw) { return typeof raw === 'string' && raw ? raw : null; }`]] },
  moved: { html: [[`const mv = e && e.status === 404 && e.body && typeof e.body.moved === 'string' ? e.body.moved : '';\n    if (mv && /^[a-z0-9._-]{1,40}$/i.test(mv) && mv.toLowerCase() !== String(username`,
                   `const mv = '';\n    if (mv && /^[a-z0-9._-]{1,40}$/i.test(mv) && mv.toLowerCase() !== String(username`]] },
  status: {},
};

/* An HTTP answer, as a crawler or a person sees it, without following redirects. Under
   --break=status a 404 is reported as 200: the probe's own status detector is what fails. */
async function http(p, ua) {
  const res = await fetch(BASE + p, { redirect: 'manual', headers: Object.assign({ Accept: 'text/html' }, ua ? { 'User-Agent': ua } : {}) });
  const text = ua ? await res.text() : '';
  let status = res.status;
  if (BREAK_KIND === 'status' && status === 404) status = 200;
  return { status, location: res.headers.get('location') || '', robots: res.headers.get('x-robots-tag') || '', retry: res.headers.get('retry-after') || '', text };
}
const metaOf = (html, prop) => { const m = new RegExp(`<meta\\s+(?:property|name)="${prop}"\\s+content="([^"]*)"`, 'i').exec(html); return m ? m[1] : null; };
const canonOf = (html) => { const m = /<link rel="canonical" href="([^"]*)"/i.exec(html); return m ? m[1] : null; };
const headOf = (html) => html.slice(0, html.indexOf('</head>'));

async function newTab(browser, viewport, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport, serviceWorkers: (BREAK || opts.noSw) ? 'block' : 'allow' });
  if (BREAK && MUT[BREAK_KIND] && (MUT[BREAK_KIND].html || MUT[BREAK_KIND].js)) {
    const m = MUT[BREAK_KIND];
    await ctx.route(/localhost:\d+\/([^.]*|atwe-routes\.js.*)$/, async (route) => {
      const req = route.request();
      if (/\/api\//.test(req.url())) return route.continue();
      const isDoc = req.resourceType() === 'document', isReg = /atwe-routes\.js/.test(req.url());
      const pairs = isDoc ? m.html : isReg ? m.js : null;
      if (!pairs) return route.continue();
      const res = await route.fetch({ maxRedirects: 0 });
      if (res.status() >= 300 && res.status() < 400) return route.fulfill({ response: res });
      let body = await res.text();
      for (const [now, was] of pairs) {
        if (!body.includes(now)) throw new Error('--break: current code not found, the probe is stale: ' + now.slice(0, 70));
        body = body.split(now).join(was);
      }
      await route.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': undefined, 'content-encoding': undefined } });
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(([t]) => {
    try { if (t) localStorage.setItem('atwe_token', t); localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); } catch (e) {}
  }, [opts.token || null]);
  return { ctx, p, errs };
}
const booted = async (p) => {
  await QA.waitUntil(p, () => typeof S !== 'undefined' && !!(S.user && S.user.id), null, 25000);
  await QA.waitUntil(p, () => window.AtweHistory && !AtweHistory.booting, null, 15000);
  await p.waitForTimeout(900);
};
const gateUp = (p) => p.evaluate(() => { const l = document.getElementById('loginOverlay'); return !!l && !l.classList.contains('hidden'); });
const state = (p) => p.evaluate(() => {
  const vis = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.classList.contains('closing'); };
  const open = [...document.querySelectorAll('.overlay:not(.hidden):not(.closing)')].map((o) => o.id);
  return { origin: location.origin, path: location.pathname, search: location.search, top: open[open.length - 1] || null, open,
    signedIn: typeof S !== 'undefined' && !!(S.user && S.user.id), thread: vis('acThreadScreen'), profile: vis('acProfileScreen'),
    profName: ((document.getElementById('acProfileBody') || {}).innerText || '').slice(0, 400),
    stash: (() => { try { return localStorage.getItem('atwe_auth_next'); } catch (e) { return 'ERR'; } })(), hlen: history.length };
});
const waitFor = (p, fn, arg, ms) => QA.waitUntil(p, fn, arg, ms || 12000);
async function signInByForm(p, acct) {
  await p.evaluate(([id, pw]) => {
    const e = document.getElementById('loginEmail'), w = document.getElementById('loginPass');
    e.value = id; w.value = pw; return doLogin();
  }, [acct.email, 'x'.repeat(12)]);
  await booted(p);
  await p.waitForTimeout(1500);
}
function freePort() { return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const q = s.address().port; s.close(() => res(q)); }); }); }

let pool, fx = {};
async function fixture() {
  pool = QA.newPool();
  fx.a = await QA.seedAccount(pool, { business: true, prefix: 'r9a' });
  fx.b = await QA.seedAccount(pool, { prefix: 'r9b' });
  fx.c = await QA.seedAccount(pool, { prefix: 'r9c' });
  fx.d = await QA.seedAccount(pool, { prefix: 'r9d' });
  await pool.query("UPDATE users SET name = 'Rnine Alpha Biz' WHERE id = $1", [fx.a.id]);
  await pool.query("UPDATE users SET name = 'SECRETPEERNAME' WHERE id IN ($1, $2)", [fx.c.id, fx.d.id]);
  fx.mark = 'R9PRIVATE ' + Date.now();
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [fx.a.id, fx.b.id, 'hello ' + fx.mark]);
  await pool.query('INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1,$2,$3)', [fx.c.id, fx.d.id, 'foreign ' + fx.mark]);
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0].id;
  fx.listing = await one("INSERT INTO products (business_id, name, description, price_cents) VALUES ($1, 'Copper Kettle', 'Shiny.', 4000) RETURNING id", [fx.a.id]);
  fx.gone = await one("INSERT INTO products (business_id, name, price_cents) VALUES ($1, 'Gone Kettle', 4000) RETURNING id", [fx.a.id]);
  await pool.query('DELETE FROM products WHERE id = $1', [fx.gone]);
  fx.post = await one("INSERT INTO posts (user_id, body) VALUES ($1, 'Route nine public post') RETURNING id", [fx.a.id]);
  fx.circlePost = await one("INSERT INTO posts (user_id, body, to_main) VALUES ($1, 'R9CIRCLE only', false) RETURNING id", [fx.a.id]);
  // A renamed account: rename through the REAL profile route, so the trigger records it.
  fx.r = await QA.seedAccount(pool, { prefix: 'r9old' });
  fx.rOld = fx.r.username; fx.rNew = 'r9new' + Date.now().toString(36);
  const rr = await fetch(BASE + '/api/auth/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + fx.r.token },
    body: JSON.stringify({ name: 'Renamed Person', username: fx.rNew }) });
  if (rr.status !== 200) throw new Error('fixture: rename failed ' + rr.status);
  fx.deact = await QA.seedAccount(pool, { prefix: 'r9x' });
  await pool.query('UPDATE users SET deactivated = true WHERE id = $1', [fx.deact.id]);
}

/* ── S. HTTP status, redirects and SEO (no browser) ── */
async function statuses() {
  console.log('\nS. the server answers');
  const aliases = [];
  R.liveRoutes().forEach((r) => r.aliases.forEach((a) => { if (!a.includes(':') && a !== '/go') aliases.push(a); }));
  let bad = [];
  for (const a of aliases) {
    const r = await http(a + '?keep=1');
    const want = R.legacyRedirect(a) + '?keep=1';
    if (r.status !== 301 || r.location !== want) bad.push(a + ' → ' + r.status + ' ' + r.location);
    else { const end = await http(want); if (end.status === 301) bad.push(want + ' redirects again (loop/chain)'); }
  }
  say(!bad.length, `every legacy alias 301s to its canonical, query kept, no loops (${aliases.length})`, bad.slice(0, 4));
  for (const [from, to] of [['/messages', '/beam'], ['/search', '/engine'], ['/me', '/account'], ['/profile', '/account'], ['/devices', '/settings/security/devices']]) {
    const r = await http(from);
    say(r.status === 301 && r.location === to, `${from} → 301 ${to}`, r);
  }
  say((await http('/engine/search')).status !== 301, '/engine/search is not a redirect target (stays planned)');
  const slug = '/listing/' + R.idSlug(fx.listing, 'Copper Kettle');
  let r = await http('/listing/' + fx.listing + '?utm=x');
  say(r.status === 301 && r.location === slug + '?utm=x', 'a bare listing id 301s to its slug, query kept', r);
  r = await http('/listing/' + fx.listing + '-stale-name');
  say(r.status === 301 && r.location === slug, 'a stale slug 301s to the current one', r);
  say((await http(slug)).status === 200, 'the slugged address is the fixed point');
  r = await http('/post/' + fx.post);
  say(r.status === 301 && r.location === '/' + fx.a.username + '/post/' + fx.post, '/post/:id 301s to /<author>/post/:id', r);
  say((await http('/' + fx.a.username + '/post/' + fx.post)).status === 200, '…which is 200');
  r = await http('/nope-not-a-thing/a/b/c');
  say(r.status === 404 && r.robots === 'noindex', 'an unknown address is 404 + noindex', r);
  r = await http('/official');
  say(r.status === 404, 'a reserved word that is not a route is 404', r);
  const unk = await http('/' + 'r9nobody' + Date.now(), BOT);
  const dea = await http('/' + fx.deact.username, BOT);
  say(unk.status === 404 && dea.status === 404 && headOf(unk.text) === headOf(dea.text), 'unknown and deactivated usernames are one identical 404', { unk: unk.status, dea: dea.status });
  r = await http('/' + fx.rOld);
  say(r.status === 301 && r.location === '/' + fx.rNew, 'a renamed username 301s to the current handle', r);
  r = await http('/listing/' + fx.gone);
  say(r.status === 410 && r.robots === 'noindex', 'a deleted public listing is 410 + noindex', r);
  say((await http('/listing/99999999999')).status === 404, 'an id that was never issued is 404');
  say((await http('/listing/not-an-id')).status === 404, 'a malformed id is 404');
  const cp = await http('/post/' + fx.circlePost, BOT);
  say(cp.status === 410 && !cp.location && !cp.text.includes('R9CIRCLE'), 'a circle-only post: 410, no redirect naming its author, no words', { s: cp.status, loc: cp.location });

  console.log('\nS2. privacy');
  const own = await http('/beam/u/' + fx.b.username, BOT);
  const foreign = await http('/beam/u/' + fx.d.username, BOT);
  const none = await http('/beam/u/r9ghost' + Date.now(), BOT);
  const sameAll = [own, foreign, none].every((x) => x.status === 200 && x.robots === 'noindex' && headOf(x.text) === headOf(own.text));
  say(sameAll, 'a conversation that exists, is someone else\'s, or does not exist: one identical answer', [own.status, foreign.status, none.status]);
  say(![own, foreign, none].some((x) => x.text.includes('SECRETPEERNAME') || x.text.includes(fx.mark)), 'no private name or message in any of them');
  say(metaOf(own.text, 'og:title') === 'Atwe' && canonOf(own.text) === null, 'the private card is the generic one, with no canonical');

  console.log('\nS3. SEO');
  const pr = await http('/' + fx.a.username, BOT);
  say(pr.status === 200 && canonOf(pr.text) && canonOf(pr.text).endsWith('/' + fx.a.username) && metaOf(pr.text, 'og:type') === 'profile' && metaOf(pr.text, 'twitter:title'),
    'a profile: canonical, og:type profile, twitter card', { c: canonOf(pr.text), t: metaOf(pr.text, 'og:type') });
  const ls = await http(slug, BOT);
  say(canonOf(ls.text) && canonOf(ls.text).endsWith(slug) && metaOf(ls.text, 'og:type') === 'product' && /Copper Kettle/.test(metaOf(ls.text, 'og:title')),
    'a listing: its slugged canonical and a product card');
  const po = await http('/' + fx.a.username + '/post/' + fx.post, BOT);
  say(metaOf(po.text, 'og:type') === 'article' && /Route nine public post/.test(metaOf(po.text, 'og:description')), 'a public post: an article card with its words');
  for (const p of ['/login', '/engine', '/account/wallet', '/settings', '/listing/' + fx.gone]) {
    const x = await http(p, BOT);
    say(x.robots === 'noindex' && /<meta name="robots" content="noindex"/.test(x.text), `${p} is noindex (header and document)`, x.robots);
  }
}

/* ── F. a database failure is a 503, never a false 404 (a second server on a dead database) ── */
async function dbDown(browser) {
  console.log('\nF. database down');
  const port = await freePort();
  const child = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none', DB_SSL: 'false', PORT: String(port) }), stdio: 'ignore' });
  try {
    const at = 'http://localhost:' + port;
    for (let i = 0; i < 100; i++) { try { await fetch(at + '/api/health'); break; } catch (e) { await new Promise((r) => setTimeout(r, 150)); } }
    for (const p of ['/' + fx.a.username, '/listing/' + fx.listing, '/listing/' + fx.gone]) {
      const r = await fetch(at + p, { redirect: 'manual', headers: { Accept: 'text/html' } });
      say(r.status === 503 && r.headers.get('retry-after') === '30', `${p} with the database down: 503 + Retry-After (not ${r.status === 404 ? 'a false 404' : r.status})`, r.status);
    }
    const { ctx, p, errs } = await newTab(browser, { width: 390, height: 844 }, { noSw: true });
    await p.goto(at + '/' + fx.a.username, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000);
    const s = await p.evaluate(() => document.body.innerText);
    say(!/isn.t available|doesn.t exist/i.test(s), 'the page never tells a person the account does not exist when it only could not look', s.slice(0, 120));
    await ctx.close();
  } finally { child.kill('SIGKILL'); }
}

/* ── B. browser: server 301s land on a working page; an old handle followed inside the app ── */
async function browserRedirects(browser, vp, tag) {
  console.log(`\n${tag} B. redirects in a browser`);
  let t = await newTab(browser, vp, { token: fx.a.token, noSw: true });
  await t.p.goto(BASE + '/messages', { waitUntil: 'domcontentloaded' }); await booted(t.p);
  let s = await state(t.p);
  say(s.path === '/beam' && s.hlen === 2, `${tag} /messages lands on /beam with no extra entry (about:blank + one)`, s);
  await t.p.goto(BASE + '/wallet?tab=x', { waitUntil: 'domcontentloaded' }); await booted(t.p);
  s = await state(t.p);
  say(s.path === '/account/wallet' && s.top === 'walletView', `${tag} /wallet lands on /account/wallet with the wallet open`, s);
  await t.p.goto(BASE + '/' + fx.rOld, { waitUntil: 'domcontentloaded' }); await booted(t.p);
  await waitFor(t.p, (n) => (document.getElementById('acProfileBody') || {}).innerText && document.getElementById('acProfileBody').innerText.includes(n), 'Renamed Person');
  s = await state(t.p);
  say(s.path === '/' + fx.rNew && s.profName.includes('Renamed Person'), `${tag} an old handle (server 301) opens the renamed profile`, { path: s.path });
  say(t.errs.length === 0, `${tag} no JS errors`, t.errs.slice(0, 2));
  await t.ctx.close();
  // Inside the app: no server round trip — the API says where it went and the app follows.
  t = await newTab(browser, vp, { token: fx.a.token });
  await t.p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await booted(t.p);
  await t.p.evaluate((u) => acGoProfile(u), fx.rOld);
  await waitFor(t.p, (n) => { const b = document.getElementById('acProfileBody'); return !!b && (b.innerText.includes(n) || /isn.t available/.test(b.innerText)); }, 'Renamed Person');
  s = await state(t.p);
  say(s.path === '/' + fx.rNew && s.profName.includes('Renamed Person'), `${tag} an old handle opened in-app follows to the current one`, { path: s.path, name: s.profName.slice(0, 60) });
  await t.p.evaluate((u) => acGoProfile(u), fx.deact.username);
  await waitFor(t.p, () => /isn.t available/.test((document.getElementById('acProfileBody') || {}).innerText || ''));
  s = await state(t.p);
  say(/isn.t available/.test(s.profName) && s.path === '/' + fx.deact.username, `${tag} a deactivated handle is simply not available (no redirect)`, s.path);
  say(t.errs.length === 0, `${tag} no JS errors`, t.errs.slice(0, 2));
  await t.ctx.close();
}

/* ── A. auth return ── */
async function authReturn(browser, vp, tag) {
  console.log(`\n${tag} A. auth return`);
  // 1. Direct link → the gate → email sign-in → exactly there.
  let t = await newTab(browser, vp);
  await t.p.goto(BASE + '/account/wallet', { waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(2600);
  let s = await state(t.p);
  say(await gateUp(t.p) && s.path === '/account/wallet' && JSON.parse(s.stash || '{}').p === '/account/wallet', `${tag} signed out at /account/wallet: the gate, the address kept and written down`, s);
  await signInByForm(t.p, fx.a);
  s = await state(t.p);
  say(s.signedIn && s.path === '/account/wallet' && s.top === 'walletView' && s.stash === null, `${tag} …email sign-in lands exactly there (and the note is used up)`, s);
  await t.ctx.close();

  // 2. A FULL OAuth redirect: the tab leaves for the provider and comes back to "/" signed in.
  t = await newTab(browser, vp);
  const dm = '/beam/u/' + fx.b.username;
  await t.p.goto(BASE + dm, { waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(2600);
  say(await gateUp(t.p), `${tag} signed out at ${dm}: the gate`);
  await t.p.goto('about:blank');                                      // "the provider's page"
  await t.p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });      // the provider redirects back to the root
  await t.p.evaluate((tok) => { localStorage.setItem('atwe_token', tok); }, fx.a.token);   // the callback signed them in
  await t.p.reload({ waitUntil: 'domcontentloaded' });
  await booted(t.p);
  await waitFor(t.p, () => { const e = document.getElementById('acThreadScreen'); return !!e && !e.classList.contains('hidden') && !!AC.peer; });
  await t.p.waitForTimeout(1200);
  s = await state(t.p);
  say(s.path === dm && s.thread && s.stash === null, `${tag} …after a full redirect back to "/", lands on the conversation`, s);
  await t.ctx.close();

  // 3. A refresh at the gate, then Google (mocked provider answer) → exactly there.
  t = await newTab(browser, vp);
  await t.ctx.route(/\/api\/auth\/google$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx.aAuth) }));
  await t.p.goto(BASE + '/account/orders', { waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(2200);
  await t.p.reload({ waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(2200);
  await t.p.evaluate(() => doGoogleAuth('fake-access-token'));
  await booted(t.p); await t.p.waitForTimeout(1500);
  s = await state(t.p);
  say(s.signedIn && s.path === '/account/orders' && s.top === 'ordersView', `${tag} refresh at the gate, then Google: lands on /account/orders`, s);
  await t.ctx.close();

  // 4. Apple (SDK + provider answer mocked) from /login?next=… → exactly there.
  t = await newTab(browser, vp);
  await t.ctx.route(/\/api\/auth\/apple$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fx.aAuth) }));
  await t.p.addInitScript(() => { window.AppleID = { auth: { init() {}, signIn: async () => ({ authorization: { id_token: 'fake' } }) } }; });
  await t.p.goto(BASE + '/login?next=' + encodeURIComponent('/settings/security/devices'), { waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(2400);
  s = await state(t.p);
  say(await gateUp(t.p) && JSON.parse(s.stash || '{}').p === '/settings/security/devices', `${tag} /login?next=… writes the destination down`, s.stash);
  await t.p.evaluate(() => appleLogin());
  await booted(t.p); await t.p.waitForTimeout(1600);
  s = await state(t.p);
  say(s.signedIn && s.path === '/settings/security/devices' && s.top === 'devicesOverlay', `${tag} …Apple sign-in lands there`, s);
  await t.ctx.close();

  // 5. Malicious next values are refused, never stored, never followed.
  const evil = ['//evil.example', 'https://evil.example/x', 'javascript:alert(1)', '/%2F%2Fevil.example', '/\\evil.example', '/%5Cevil.example', '/login'];
  for (const nx of evil) {
    t = await newTab(browser, vp);
    await t.p.goto(BASE + '/login?next=' + encodeURIComponent(nx), { waitUntil: 'domcontentloaded' }); await t.p.waitForTimeout(1800);
    const before = await state(t.p);
    await signInByForm(t.p, fx.a);
    s = await state(t.p);
    say(before.stash === null && s.origin === new URL(BASE).origin && s.signedIn && !/evil/.test(s.path + s.search) && t.errs.length === 0,
      `${tag} next=${JSON.stringify(nx)} is refused: not stored, not followed`, { stash: before.stash, path: s.path, errs: t.errs.slice(0, 1) });
    await t.ctx.close();
  }

  // 6. A note older than 30 minutes is ignored.
  t = await newTab(browser, vp, { token: fx.a.token });
  await t.p.addInitScript(() => { try { localStorage.setItem('atwe_auth_next', JSON.stringify({ p: '/account/wallet', t: Date.now() - 31 * 60 * 1000 })); } catch (e) {} });
  await t.p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await booted(t.p); await t.p.waitForTimeout(1000);
  s = await state(t.p);
  say(s.path === '/' && s.top !== 'walletView', `${tag} a stale note (31 minutes) is ignored`, s);
  // 7. An address opened now beats a remembered one.
  await t.p.evaluate(() => localStorage.setItem('atwe_auth_next', JSON.stringify({ p: '/account/wallet', t: Date.now() })));
  await t.p.goto(BASE + '/engine/marketplace', { waitUntil: 'domcontentloaded' }); await booted(t.p); await t.p.waitForTimeout(1200);
  s = await state(t.p);
  say(s.path === '/engine/marketplace' && s.top === 'marketplaceView', `${tag} an address opened now wins over a remembered one`, s);
  say(t.errs.length === 0, `${tag} no JS errors`, t.errs.slice(0, 2));
  await t.ctx.close();
}

(async () => {
  await fixture();
  const seen = await QA.serverSees(fx.a.token);
  if (!seen.ok) { console.log('  FAIL fixture: the server does not see the seeded account (HTTP ' + seen.status + ')'); process.exit(1); }
  const me = await (await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer ' + fx.a.token } })).json();
  fx.aAuth = { token: fx.a.token, user: me.user };
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const t0 = Date.now();
  const run = (k) => !ONLY || ONLY.split(',').includes(k);
  try {
    if (run('S')) await statuses();
    if (run('F')) await dbDown(browser);
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const tag = vp.width >= 1000 ? '[desktop]' : '[phone]';
      if (run('B')) await browserRedirects(browser, vp, tag);
      if (run('A')) await authReturn(browser, vp, tag);
    }
  } catch (e) {
    fail++; console.log('  FAIL the probe threw: ' + (e && e.stack || e).toString().slice(0, 600));
  } finally {
    await browser.close();
    await pool.end();
  }
  console.log(`\n${pass} passed, ${fail} FAILED  (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(fail ? 1 : 0);
})();
