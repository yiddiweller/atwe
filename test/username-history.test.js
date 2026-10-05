/* Username history + the 30-day hold (Route Audit batch 9, §37).
 *
 * A handle an account gives up is a public address other people have already shared:
 *   · the old handle 301s to the account's CURRENT handle while nobody else holds it;
 *   · nobody ELSE may take it for 30 days (the account that released it may take it back);
 *   · once another account legitimately takes it, the new owner wins and the old redirect
 *     is retired;
 *   · a deleted account's handle is held the same 30 days and redirects nowhere.
 * The history is written by a trigger on users, so these tests drive every write door the
 * app has and then read the table and the HTTP answers back. Real server, real database. */
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');
const auth = require('../auth');

const opts = { skip: H.SKIP ? 'no TEST_DATABASE_URL/DATABASE_URL set' : false };
let admin, adminToken;
before(async () => {
  if (H.SKIP) return;
  await H.startServer();
  admin = await H.seedUser();
  await H.getPool().query('UPDATE users SET is_admin = true WHERE id = $1', [admin.id]);
  adminToken = auth.signToken({ id: admin.id, email: admin.email, is_admin: true });
  await H.getPool().query('INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
    [admin.id, auth.hashToken(adminToken), 'uh-test', '127.0.0.1']);
});
after(async () => { if (!H.SKIP) await H.stopServer(); });

const db = () => H.getPool();
const rename = (token, username) => H.api('PUT', '/api/auth/profile', { token, body: { name: 'Test', username } });
const fresh = (p) => (p + '_' + Math.random().toString(36).slice(2, 9)).toLowerCase();
async function page(p) {
  const res = await fetch('http://localhost:' + H.port() + p, { redirect: 'manual', headers: { Accept: 'text/html' } });
  return { status: res.status, location: res.headers.get('location') || '' };
}
const histRows = async (name) => (await db().query('SELECT user_id, changed_at FROM username_history WHERE old_lower = lower($1) ORDER BY changed_at', [name])).rows;
const ago = (name, days) => db().query(`UPDATE username_history SET changed_at = now() - ($2 || ' days')::interval WHERE old_lower = lower($1)`, [name, String(days)]);

test('the table, its indexes and both triggers exist', opts, async () => {
  const cols = (await db().query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'username_history' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ['old_lower', 'user_id', 'changed_at']);
  const trg = (await db().query(`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'users_username_history_%' ORDER BY 1`)).rows.map((r) => r.tgname);
  assert.deepEqual(trg, ['users_username_history_del', 'users_username_history_upd']);
  const fk = (await db().query(`SELECT confdeltype FROM pg_constraint WHERE conrelid = 'username_history'::regclass AND contype = 'f'`)).rows[0];
  assert.equal(fk.confdeltype, 'n', 'user_id is SET NULL on delete, never CASCADE (a deletion must not free a held name early)');
});

test('no history is invented for an account that never renamed (no backfill)', opts, async () => {
  const u = await H.seedUser();
  assert.equal((await histRows(u.username)).length, 0);
  const t = await H.login(u);
  const same = await rename(t, u.username);             // saving a profile without changing the handle
  assert.equal(same.status, 200);
  assert.equal((await histRows(u.username)).length, 0, 'an unchanged handle writes nothing');
});

test('rename records the old handle atomically and the old address 301s to the new one', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const neu = fresh('nu');
  const r = await rename(t, neu);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const rows = await histRows(u.username);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, u.id);
  const a = await page('/' + u.username);
  assert.equal(a.status, 301);
  assert.equal(a.location, '/' + neu);
  const b = await page('/' + u.username + '/media?x=1');
  assert.equal(b.status, 301, 'a profile section follows too');
  assert.equal(b.location, '/' + neu + '/media?x=1', 'and keeps its query');
  assert.equal((await page('/' + neu)).status, 200, 'the new address is the fixed point');
  const api = await H.api('GET', '/api/social/profile/' + u.username, { token: t });
  assert.equal(api.status, 404);
  assert.equal(api.body.moved, neu, 'inside the app the old handle says where it went');
  const pub = await H.api('GET', '/api/public/profile/' + u.username);
  assert.equal(pub.body.moved, neu);
});

test('the released handle is held for 30 days against every other account and every door', opts, async () => {
  const owner = await H.seedUser();
  const ot = await H.login(owner);
  const old = owner.username;
  assert.equal((await rename(ot, fresh('own'))).status, 200);

  const other = await H.seedUser();
  const t2 = await H.login(other);
  const take = await rename(t2, old);
  assert.equal(take.status, 409, 'a profile change is refused: ' + JSON.stringify(take.body));
  const ex = await H.api('POST', '/api/auth/exists', { body: { identifier: old } });
  assert.equal(ex.body.reserved, true, 'the sign-up screen is told it is unavailable');
  const assign = await H.api('POST', '/api/admin/username-locks/' + old + '/assign', { token: adminToken, body: { toId: other.id } });
  assert.equal(assign.status, 409, 'staff cannot hand a held name to someone else');
  const look = await H.api('GET', '/api/handles/' + old, { token: t2 });
  assert.equal(look.body.claimable, false);
  // A paid claim: even with a price on the lock row, a held name is not sold.
  await db().query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, 100) ON CONFLICT (username) DO UPDATE SET price_cents = 100', [old]);
  await db().query('UPDATE users SET balance_cents = 100000 WHERE id = $1', [other.id]);
  const buy = await H.api('POST', '/api/handles/claim', { token: t2, body: { username: old, clientId: H.uniq('c') } });
  assert.notEqual(buy.status, 200, 'a paid claim is refused: ' + JSON.stringify(buy.body));
  await db().query('DELETE FROM reserved_usernames WHERE username = $1', [old]);
  assert.equal((await db().query('SELECT username FROM users WHERE id = $1', [other.id])).rows[0].username, other.username, 'nothing changed');
  assert.equal((await page('/' + old)).status, 301, 'and the old address still points at its owner');

  // The account that released it may take it back at any time.
  const back = await rename(ot, old);
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal((await histRows(old)).length, 0, 'reclaiming retires its history');
  assert.equal((await page('/' + old)).status, 200);
});

test('after the hold another account may take it, the new owner wins and the old redirect is retired', opts, async () => {
  const owner = await H.seedUser();
  const ot = await H.login(owner);
  const old = owner.username;
  const neu = fresh('after');
  assert.equal((await rename(ot, neu)).status, 200);
  await ago(old, 29);
  const other = await H.seedUser();
  const t2 = await H.login(other);
  assert.equal((await rename(t2, old)).status, 409, 'day 29: still held');
  await ago(old, 31);
  const ok = await rename(t2, old);
  assert.equal(ok.status, 200, 'day 31: free again: ' + JSON.stringify(ok.body));
  assert.equal((await histRows(old)).length, 0, 'claiming it retired the old row');
  const a = await page('/' + old);
  assert.equal(a.status, 200, 'the new owner wins: no redirect to the old owner');
  assert.equal((await page('/' + neu)).status, 200);
  // The second account's own old handle is now held for it.
  assert.equal((await histRows(other.username)).length, 1);
});

test('renaming again: every earlier handle points at the CURRENT one', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const h0 = u.username, h1 = fresh('h1'), h2 = fresh('h2');
  assert.equal((await rename(t, h1)).status, 200);
  assert.equal((await rename(t, h2)).status, 200);
  assert.equal((await page('/' + h0)).location, '/' + h2);
  assert.equal((await page('/' + h1)).location, '/' + h2);
  // A case-only change is not a release.
  assert.equal((await rename(t, h2.toUpperCase())).status, 200);
  assert.equal((await histRows(h2)).length, 0);
});

test('a deleted account: its handle is held 30 days and redirects nowhere', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const prior = u.username, cur = fresh('del');
  assert.equal((await rename(t, cur)).status, 200);
  await db().query('DELETE FROM users WHERE id = $1', [u.id]);
  const rows = await histRows(cur);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, null, "the deleted account's own handle is held with no owner");
  assert.equal((await histRows(prior)).length, 1, 'its earlier handle keeps its row (not freed early)');
  assert.equal((await page('/' + cur)).status, 404, 'a deleted account answers like an unknown one');
  assert.equal((await page('/' + prior)).status, 404, 'and its old handle no longer redirects');
  const other = await H.seedUser();
  const t2 = await H.login(other);
  assert.equal((await rename(t2, cur)).status, 409, 'held against everyone');
  await ago(cur, 31);
  assert.equal((await rename(t2, cur)).status, 200, 'free after 30 days');
});

test('a deactivated or suspended target is never revealed by an old handle', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const old = u.username, neu = fresh('hid');
  assert.equal((await rename(t, neu)).status, 200);
  await db().query('UPDATE users SET deactivated = true WHERE id = $1', [u.id]);
  assert.equal((await page('/' + old)).status, 404);
  assert.equal((await page('/' + neu)).status, 404);
  await db().query("UPDATE users SET deactivated = false, status = 'suspended' WHERE id = $1", [u.id]);
  assert.equal((await page('/' + old)).status, 404);
  assert.equal((await page('/' + neu)).status, 404);
  await db().query("UPDATE users SET status = 'active' WHERE id = $1", [u.id]);
  assert.equal((await page('/' + old)).status, 301);
});

test('staff handle assignment records the target\'s old handle too (and is one real transaction)', opts, async () => {
  const target = await H.seedUser();
  const prem = fresh('prem');
  await db().query('INSERT INTO reserved_usernames (username) VALUES ($1)', [prem]);
  const r = await H.api('POST', '/api/admin/username-locks/' + prem + '/assign', { token: adminToken, body: { toId: target.id } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await histRows(target.username)).length, 1);
  assert.equal((await page('/' + target.username)).location, '/' + prem);
  assert.equal((await db().query('SELECT 1 FROM reserved_usernames WHERE username = $1', [prem])).rowCount, 0);
});

test('a paid handle claim records the buyer\'s old handle', opts, async () => {
  const u = await H.seedUser({ balanceCents: 5000 });
  const t = await H.login(u);
  const prem = fresh('paid');
  await db().query('INSERT INTO reserved_usernames (username, price_cents) VALUES ($1, 500)', [prem]);
  const r = await H.api('POST', '/api/handles/claim', { token: t, body: { username: prem, clientId: H.uniq('c') } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await histRows(u.username)).length, 1);
  assert.equal((await page('/' + u.username)).location, '/' + prem);
});

test('clearing a username releases it (held, and it redirects nowhere)', opts, async () => {
  const u = await H.seedUser();
  const t = await H.login(u);
  const r = await H.api('PUT', '/api/auth/profile', { token: t, body: { name: 'Test', username: '' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await histRows(u.username)).length, 1);
  assert.equal((await page('/' + u.username)).status, 404);
  const other = await H.seedUser();
  assert.equal((await rename(await H.login(other), u.username)).status, 409);
});

test('the source: every username write door checks the hold', opts, () => {
  const s = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  // The hold lives inside the one "unavailable" helper the doors already call…
  assert.match(s, /async function usernameReserved\(username, forUserId\)[\s\S]{0,700}usernameHeld\(username, forUserId\)/);
  // …the profile change passes the caller (so it may take its own handle back)…
  assert.match(s, /usernameReserved\(username, req\.user\.id\)/);
  // …and the doors that bypass usernameReserved ask directly.
  assert.match(s, /usernameHeld\(username, target\.id\)/, 'staff assignment');
  assert.match(s, /FROM username_history WHERE old_lower = lower\(\$1\)[\s\S]{0,200}buyerId/, 'paid claim, inside its transaction');
  assert.match(s, /!taken\.rowCount && !\(await usernameReserved\(cand\)\)/, 'generated usernames');
  const seed = require('fs').readFileSync(require('path').join(__dirname, '..', 'seed', 'beta-account.js'), 'utf8');
  assert.match(seed, /await heldFor\(db, id\.username\)/, 'the beta seeding tool');
});
