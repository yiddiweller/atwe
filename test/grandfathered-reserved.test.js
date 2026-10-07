/* An account that already held a reserved word keeps its profile (build 1877).
 *
 * Production 1876 answered atwe.com/atwe and atwe.com/support with 404 "Page not found":
 * both words sat in the router's defensive list, so the address was never read as a
 * handle — even though @atwe and @support are real, founder-approved, grandfathered
 * accounts. Build 1877 splits that list:
 *   · the ROUTER claims only what something real answers at — a live route root, a
 *     server root, a file, a value a code bug writes ('/' + undefined);
 *   · every other defensive word stays refused for NEW usernames, exactly as before,
 *     and an account that already held one keeps atwe.com/<name>.
 * Real server, real database, and the shipped app router run in a vm. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./helpers');
const REG = require('../public/atwe-routes.js');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
const BOT = 'Mozilla/5.0 (compatible; Twitterbot/1.0)';
const made = [];   // holder rows THIS file created, removed afterwards
let F = {};

/* Seed a holder of a word the gate would refuse today, the way a grandfathered account
   came to exist: written directly, before the word was reserved. Reuses an existing
   holder (e.g. the @atwe row the server creates on boot) rather than fighting it. */
async function holder(word, extra = {}) {
  const db = H.getPool();
  const have = (await db.query('SELECT id, username FROM users WHERE lower(username) = $1', [word])).rows[0];
  if (have) return have;
  const u = await H.seedUser({ accountType: extra.business ? 'business' : 'personal' });
  await db.query('UPDATE users SET username = $1, name = $2 WHERE id = $3', [word, extra.name || word, u.id]);
  made.push(u.id);
  return { id: u.id, username: word, token: await H.login(u) };
}

before(async () => {
  if (H.SKIP) return;
  await H.startServer();
  const db = H.getPool();
  F.atwe = await holder('atwe', { business: true, name: 'Atwe' });
  F.support = await holder('support', { name: 'Support' });
  F.normal = await H.seedUser();
  F.normal.token = await H.login(F.normal);
  F.beamHolder = await holder('beam', { name: 'Beam Holder' });      // a real route word with a (pathological) holder
  F.careers = await holder('careers', { name: 'Careers Holder' });   // will rename: username-history
  F.press = await holder('press', { name: 'Press Holder' });         // will be deactivated
  await db.query('UPDATE users SET deactivated = true WHERE id = $1', [F.press.id]);
  // nobody holds these two in this database (the test asserts it before relying on it)
  F.unowned = ['about', 'pricing'];
});
after(async () => {
  if (H.SKIP) return;
  const db = H.getPool();
  if (made.length) await db.query('DELETE FROM users WHERE id = ANY($1)', [made]).catch(() => {});
  await H.stopServer();
});

const base = () => 'http://localhost:' + H.port();
async function get(p, ua) {
  const headers = { Accept: 'text/html' };
  if (ua) headers['User-Agent'] = ua;
  const res = await fetch(base() + p, { redirect: 'manual', headers });
  const text = ua ? await res.text() : '';
  return { status: res.status, location: res.headers.get('location') || '', robots: res.headers.get('x-robots-tag') || '', text };
}
const ogTitle = (html) => { const m = /<meta\s+property="og:title"\s+content="([^"]*)"/i.exec(html); return m ? m[1] : ''; };

/* The app's REAL router, extracted from the shipped index.html (as native-links does). */
const appParse = (() => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const i = html.indexOf('const APP_ROUTES = {'), j = html.indexOf('/* Turn a parsed route into the surface');
  const ctx = { location: { pathname: '/' }, requestAnimationFrame: () => 0, console };
  vm.createContext(ctx);
  vm.runInContext(html.slice(i, j) + '\nthis.__p = () => parseDeepLink();', ctx);
  return (p) => { ctx.location.pathname = p; return JSON.parse(JSON.stringify(ctx.__p())); };
})();

/* ── 1-4. existing profiles resolve: a normal one, and grandfathered reserved words ── */
test('1. an ordinary username still resolves to its profile', opts, async () => {
  const r = await get('/' + F.normal.username, BOT);
  assert.equal(r.status, 200);
  assert.match(ogTitle(r.text), new RegExp('\\(@' + F.normal.username + '\\)', 'i'));
  assert.equal(appParse('/' + F.normal.username).type, 'profile');
});

for (const w of ['atwe', 'support']) {
  test(`${w === 'atwe' ? 3 : 4}. /${w} resolves the existing @${w} profile (server, app router, iPhone)`, opts, async () => {
    assert.ok(REG.HOLDER_DEFENSIVE.includes(w), w + ' is a defensive word');
    const human = await get('/' + w);
    assert.equal(human.status, 200, '/' + w + ' answered ' + human.status);
    assert.ok(!/noindex/i.test(human.robots), 'a real profile is indexable');
    const bot = await get('/' + w, BOT);
    assert.equal(bot.status, 200);
    assert.match(ogTitle(bot.text), new RegExp('\\(@' + w + '\\)', 'i'), 'the preview card is the profile');
    assert.deepEqual(appParse('/' + w), { type: 'profile', username: w });
    assert.deepEqual(appParse('/@' + w.toUpperCase()), { type: 'profile', username: w });
    const n = REG.nativeLink('https://atwe.com/' + w);
    assert.equal(n.kind, 'native'); assert.equal(n.route, 'profile'); assert.equal(n.path, '/user/' + w);
  });
}

test('2. any grandfathered holder of a defensive word resolves the same way (the rule is general)', opts, async () => {
  const db = H.getPool();
  const word = 'official';
  const prior = (await db.query('SELECT 1 FROM users WHERE lower(username) = $1', [word])).rowCount;
  const h = await holder(word, { name: 'Official Holder' });
  try {
    assert.equal((await get('/' + word)).status, 200);
    assert.equal((await get('/' + word + '/posts')).status, 200, 'a public section too');
  } finally {
    if (!prior) { await db.query('DELETE FROM users WHERE id = $1', [h.id]); made.splice(made.indexOf(h.id), 1); }
  }
});

/* ── 5. an unowned reserved word is not a profile ── */
test('5. a defensive word nobody holds is an unknown address: 404, noindex, no profile card', opts, async () => {
  const db = H.getPool();
  for (const w of F.unowned) {
    assert.equal((await db.query('SELECT 1 FROM users WHERE lower(username) = $1', [w])).rowCount, 0, 'precondition: nobody holds ' + w);
    const r = await get('/' + w, BOT);
    assert.equal(r.status, 404, w);
    assert.match(r.robots, /noindex/i, w);
    assert.match(ogTitle(r.text), /Page not found/, w);
    const api = await H.api('GET', '/api/public/profile/' + w);
    assert.equal(api.status, 404, w + ' must not become a fake profile');
  }
});

/* ── 6. a real system route always wins, even over a holder ── */
test('6. a real route wins over an account that holds the same word', opts, async () => {
  assert.ok(!REG.HOLDER_DEFENSIVE.includes('beam') && REG.parseReserved().includes('beam'));
  const r = await get('/beam', BOT);
  assert.equal(r.status, 200);
  assert.match(r.robots, /noindex/i, 'Beam is private: generic card, noindex');
  assert.ok(!/@beam\)/i.test(ogTitle(r.text)), 'the Beam route must never render @beam\'s profile card');
  const ab = appParse('/beam');
  assert.equal(ab.type, 'route'); assert.equal(ab.key, 'messages');
  assert.equal(REG.match('/beam').name, 'messages');
  for (const w of ['settings', 'engine', 'account', 'api', 'admin', 'login', 'undefined', 'null', 'robots.txt']) {
    const m = REG.match('/' + w);
    assert.ok(!m || m.name !== 'profile', w + ' must never be read as a profile');
    const a = appParse('/' + w);
    assert.ok(!a || a.type !== 'profile', w + ' (app router)');
  }
});

/* ── 7-8. reserved-name allocation is still refused ── */
test('7. a NEW account still cannot take a reserved word (signup, availability check)', opts, async () => {
  for (const w of ['support', 'atwe', 'about', 'official']) {
    const r = await H.api('POST', '/api/auth/signup/finish', { body: {
      email: H.uniq('s') + '@test.local', code: '000000', name: 'New', password: 'Correct-Horse-9-battery',
      dob: '1990-01-01', username: w } });
    assert.equal(r.status, 400, w + ': ' + JSON.stringify(r.body));
    assert.match(r.body.error, /isn’t available/, w);
  }
  const ex = await H.api('POST', '/api/auth/exists', { body: { identifier: 'about' } });
  assert.equal(ex.body.reserved, true, 'the signup screen is still told it is taken');
});

test('8. an existing account cannot rename itself INTO a reserved word; a holder keeps its own', opts, async () => {
  const t = F.normal.token;
  for (const w of ['support', 'atwe', 'about', 'pricing', 'beam']) {
    const r = await H.api('PUT', '/api/auth/profile', { token: t, body: { name: 'Test', username: w } });
    assert.equal(r.status, 400, w + ': ' + JSON.stringify(r.body));
  }
  if (F.support.token) {
    const keep = await H.api('PUT', '/api/auth/profile', { token: F.support.token, body: { name: 'Support', username: 'support' } });
    assert.equal(keep.status, 200, 'the grandfathered holder saves its profile unchanged: ' + JSON.stringify(keep.body));
  }
});

/* ── 9. deleted / deactivated / missing ── */
test('9. a deactivated holder and a missing name answer exactly like an unknown username', opts, async () => {
  const d = await get('/press', BOT);
  assert.equal(d.status, 404); assert.match(d.robots, /noindex/i);
  const m = await get('/' + H.uniq('nobody'), BOT);
  assert.equal(m.status, 404); assert.match(m.robots, /noindex/i);
  assert.equal(ogTitle(d.text), ogTitle(m.text), 'no difference a visitor could read');
});

/* ── 10. username history ── */
test('10. a holder of a defensive word who renames is followed by the old address (username history)', opts, async () => {
  const db = H.getPool();
  const to = H.uniq('careersco').toLowerCase();
  await db.query('UPDATE users SET username = $1 WHERE id = $2', [to, F.careers.id]);
  const r = await get('/careers');
  assert.equal(r.status, 301);
  assert.equal(r.location, '/' + to);
  const api = await H.api('GET', '/api/social/profile/careers', { token: F.normal.token });
  assert.equal(api.status, 404); assert.equal(api.body.moved, to, 'the in-app lookup follows it too');
  // and the released word is still refused for a NEW account
  const s = await H.api('PUT', '/api/auth/profile', { token: F.normal.token, body: { name: 'Test', username: 'careers' } });
  assert.equal(s.status, 400);
});

/* ── 11. logged out ── */
test('11. a signed-out visitor can open @atwe and @support (the public peek), as for any profile', opts, async () => {
  for (const w of ['atwe', 'support']) {
    const r = await H.api('GET', '/api/public/profile/' + w);
    assert.equal(r.status, 200, w);
    const u = r.body.user || r.body.profile || r.body;
    assert.equal(String(u.username || '').toLowerCase(), w);
    assert.equal(r.body.isPeek, true);
  }
  const n = await H.api('GET', '/api/public/profile/' + F.normal.username);
  assert.equal(n.status, 200);
});
