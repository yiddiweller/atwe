/* RESUMABLE ONBOARDING: complete, incomplete and DEFERRED are three states.
 *
 * The third is the one this file exists for. Before it, "Skip" called the finish
 * route, which sets onboarded = true -- so pressing it did not defer onboarding, it
 * COMPLETED it, and there was no way back. Now:
 *
 *   complete    onboarded = true                                (Done, and nothing else)
 *   incomplete  onboarded = false                               (started, not finished)
 *   deferred    onboarded = false AND onboard_deferred = true   ("Skip for now")
 *
 * `onboard_step` is the FURTHEST unfinished step, so a member returns to where they
 * stopped. It never moves backwards: Back is navigation, not un-completing something,
 * which is asserted directly below because a read-modify-write would get it wrong.
 *
 * LIVE, against the real server and a real database -- these are database semantics
 * and an UPDATE's own WHERE clause, and a source grep cannot see either. Skips cleanly
 * with no database, like the rest of the suite. The CLIENT half (Back, "Skip for now",
 * the Account re-entry, and what is actually on screen) is scratchpad/obresume.js.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const me = (token) => H.api('GET', '/api/auth/me', { token });
const progress = (token, body) => H.api('POST', '/api/onboarding/progress', { token, body });
const defer = (token, body) => H.api('POST', '/api/onboarding/defer', { token, body });
const finish = (token, body) => H.api('POST', '/api/onboarding/finish', { token, body: body || {} });

/* ── source invariants: true with or without a database ──────────────────────── */

test('S1. there is exactly one onboarding implementation', () => {
  assert.strictEqual(APP.split(/\nfunction obStart\s*\(/).length - 1, 1, 'obStart defined once');
  assert.strictEqual(APP.split(/\nfunction obStep\s*\(/).length - 1, 1, 'obStep defined once');
  assert.strictEqual(APP.split('id="onboardingFlow"').length - 1, 1, 'one onboarding surface');
  assert.strictEqual(APP.split(/\nfunction maybeStartOnboarding\s*\(/).length - 1, 1);
});

test('S2. "Skip for now" is a DIFFERENT server action from finishing', () => {
  assert.match(APP, /id="obSkip"[^>]*onclick="obDefer\(\)"/,
    'the skip control must call the defer path, never the finish path');
  assert.match(APP, /Skip for now<\/button>/, 'and it must say so');
  const defer = APP.slice(APP.indexOf('async function obDefer('), APP.indexOf('function obPickGoal('));
  assert.doesNotMatch(defer, /onboarding\/finish/, 'deferring must not call the completion route');
  assert.doesNotMatch(defer, /onboarded\s*=\s*true/, 'deferring must not mark anybody complete');
});

test('S3. only the finish route sets onboarded = true', () => {
  const sets = SERVER.match(/SET onboarded = true/g) || [];
  assert.strictEqual(sets.length, 1, 'exactly one place in the server completes onboarding');
  const fin = SERVER.slice(SERVER.indexOf("app.post('/api/onboarding/finish'"));
  assert.match(fin.slice(0, 700), /onboard_step = NULL, onboard_deferred = false/,
    'completing must retire the resume state in the same statement');
});

test('S4. Back is navigation: it writes nothing', () => {
  const back = APP.slice(APP.indexOf('function obBack()'), APP.indexOf('async function obAdvance('));
  assert.doesNotMatch(back, /API\.req/, 'Back must not call the API');
  assert.doesNotMatch(back, /onboarded/, 'Back must not touch completion state');
  assert.match(back, /obStep\(OB_STEPS\[i - 1\]\)/, 'it just shows the previous step');
});

test('S5. a deferred member is left alone by the automatic start', () => {
  const gate = APP.slice(APP.indexOf('function maybeStartOnboarding('), APP.indexOf('function obResume('));
  assert.match(gate, /if \(user\.onboardDeferred\) return;/,
    'boot/navigation/refresh/login must not force the overlay open after "Skip for now"');
  assert.match(gate, /obStart\(user\.onboardStep\)/, 'and a non-deferred resume opens at the recorded step');
});

/* ── live: the state machine itself ──────────────────────────────────────────── */

test('onboarding resume', { skip: H.SKIP ? 'no database' : false }, async (t) => {
  await H.startServer();
  t.after(() => H.stopServer());

  await t.test('1. a fresh account is incomplete, not deferred, and starts at the beginning', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    const r = await me(token);
    assert.strictEqual(r.body.user.onboarded, false);
    assert.strictEqual(r.body.user.onboardStep, null, 'no step yet means step one');
    assert.strictEqual(r.body.user.onboardDeferred, false);
  });

  await t.test('2. the goal is durable the moment it is picked, not only at the end', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    const r = await progress(token, { step: 'topics', intent: 'sell' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.step, 'topics');
    assert.strictEqual(r.body.intent, 'sell');
    const fresh = await me(token);   // a new request: this is server state, not a variable
    assert.strictEqual(fresh.body.user.intent, 'sell');
    assert.strictEqual(fresh.body.user.onboardStep, 'topics');
    assert.strictEqual(fresh.body.user.onboarded, false, 'progress never completes anything');
  });

  await t.test('3. progress advances, and NEVER moves backwards', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    await progress(token, { step: 'topics' });
    await progress(token, { step: 'people' });
    const back = await progress(token, { step: 'topics' });   // what Back would look like
    assert.strictEqual(back.body.step, 'people', 'a lower step must not overwrite a higher one');
    const done = await progress(token, { step: 'done' });
    assert.strictEqual(done.body.step, 'done');
  });

  await t.test('4. the step survives a new session entirely', async () => {
    const u = await H.seedUser();
    const t1 = await H.login(u);
    await progress(t1, { step: 'people', intent: 'network' });
    const t2 = await H.login(u);   // a different session, as a later login would be
    const r = await me(t2);
    assert.strictEqual(r.body.user.onboardStep, 'people');
    assert.strictEqual(r.body.user.intent, 'network');
    assert.strictEqual(r.body.user.onboarded, false);
  });

  await t.test('5. "Skip for now" defers: incomplete, recorded, and left alone', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    await progress(token, { step: 'topics', intent: 'job' });
    const d = await defer(token, { step: 'people' });
    assert.strictEqual(d.status, 200);
    assert.strictEqual(d.body.onboarded, false, 'skipping must NOT complete onboarding');
    assert.strictEqual(d.body.deferred, true);
    assert.strictEqual(d.body.step, 'people', 'and it keeps the progress so far');
    const t2 = await H.login(u);
    const r = await me(t2);
    assert.strictEqual(r.body.user.onboarded, false, 'still incomplete at the next login');
    assert.strictEqual(r.body.user.onboardDeferred, true, 'still deferred, so nothing forces it open');
    assert.strictEqual(r.body.user.onboardStep, 'people', 'and it resumes in the right place');
    assert.strictEqual(r.body.user.intent, 'job', 'the goal came back too');
  });

  await t.test('6. only finishing completes it, and that retires the resume state', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    await progress(token, { step: 'people', intent: 'hiring' });
    await defer(token, { step: 'done' });
    const f = await finish(token, {});
    assert.strictEqual(f.status, 200);
    const r = await me(token);
    assert.strictEqual(r.body.user.onboarded, true);
    assert.strictEqual(r.body.user.onboardStep, null, 'no step left to come back to');
    assert.strictEqual(r.body.user.onboardDeferred, false, 'a deferral cannot outlive what it deferred');
    assert.strictEqual(r.body.user.intent, 'hiring', 'the goal is kept, for a later phase to use');
  });

  await t.test('7. a completed member can never be dragged back in', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    await finish(token, { intent: 'explore' });
    const p = await progress(token, { step: 'goal' });
    const d = await defer(token, { step: 'goal' });
    assert.strictEqual(p.body.onboarded, true);
    assert.strictEqual(d.body.onboarded, true);
    const r = await me(token);
    assert.strictEqual(r.body.user.onboarded, true);
    assert.strictEqual(r.body.user.onboardStep, null, 'a stale tab must not resurrect the re-entry');
    assert.strictEqual(r.body.user.onboardDeferred, false);
  });

  /* ── legacy ─────────────────────────────────────────────────────────────── */

  await t.test('8. an existing completed account is untouched and never re-onboarded', async () => {
    const u = await H.seedUser();
    await H.getPool().query('UPDATE users SET onboarded = true WHERE id = $1', [u.id]);
    const token = await H.login(u);
    const r = await me(token);
    assert.strictEqual(r.body.user.onboarded, true);
    assert.strictEqual(r.body.user.onboardStep, null);
    assert.strictEqual(r.body.user.onboardDeferred, false, 'the new column defaults to the harmless value');
  });

  await t.test('8b. the new columns default safely for every row that predates them', async () => {
    const { rows } = await H.getPool().query(
      `SELECT count(*)::int AS bad FROM users
        WHERE onboard_deferred IS NULL OR (onboarded = true AND onboard_step IS NOT NULL)`);
    assert.strictEqual(rows[0].bad, 0,
      'no row may be NULL-deferred, and no completed row may carry a resume step');
  });

  /* ── security ───────────────────────────────────────────────────────────── */

  await t.test('9. the routes refuse an invalid step or goal', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    for (const bad of ['nonsense', '', 'DONE', 'goal; DROP TABLE users', 1]) {
      const r = await progress(token, { step: bad });
      assert.strictEqual(r.status, 400, `step ${JSON.stringify(bad)} must be refused`);
    }
    assert.strictEqual((await progress(token, { step: 'topics', intent: 'wat' })).status, 400);
    assert.strictEqual((await defer(token, { step: 'topics', intent: 'wat' })).status, 400);
    assert.strictEqual((await finish(token, { intent: 'wat' })).status, 400);
    const r = await me(token);
    assert.strictEqual(r.body.user.onboardStep, null, 'a refused call writes nothing at all');
    assert.strictEqual(r.body.user.onboarded, false);
  });

  await t.test('10. they need a session, and act ONLY on that session', async () => {
    const a = await H.seedUser(); const ta = await H.login(a);
    const b = await H.seedUser(); const tb = await H.login(b);
    assert.strictEqual((await H.api('POST', '/api/onboarding/progress', { body: { step: 'topics' } })).status, 401);
    assert.strictEqual((await H.api('POST', '/api/onboarding/defer', { body: {} })).status, 401);
    await progress(ta, { step: 'done' });
    const rb = await me(tb);
    assert.strictEqual(rb.body.user.onboardStep, null, "one member's progress must not reach another");
    /* There is no user argument to abuse, so the strongest statement is that naming one
       changes nothing: the routes read req.user and nothing else. */
    await progress(tb, { step: 'topics', userId: a.id, id: a.id, username: a.username });
    const ra = await me(ta);
    assert.strictEqual(ra.body.user.onboardStep, 'done', "A's row is exactly as A left it");
    assert.strictEqual((await me(tb)).body.user.onboardStep, 'topics', "and B wrote B's own row");
  });

  await t.test('11. unrelated account fields cannot be mutated through these routes', async () => {
    const u = await H.seedUser();
    const token = await H.login(u);
    const before = (await H.getPool().query(
      'SELECT is_admin, account_type, email, username, password_hash, plan, balance_cents, seed_tag FROM users WHERE id = $1', [u.id])).rows[0];
    await progress(token, {
      step: 'topics', is_admin: true, isAdmin: true, account_type: 'business', accountType: 'business',
      email: 'attacker@example.com', username: 'attacker', password: 'hunter2', plan: 'pro',
      balance_cents: 999999, balanceCents: 999999, seed_tag: 'beta-keep', onboarded: true,
    });
    await defer(token, { step: 'topics', is_admin: true, onboarded: true, plan: 'pro' });
    const after = (await H.getPool().query(
      'SELECT is_admin, account_type, email, username, password_hash, plan, balance_cents, seed_tag FROM users WHERE id = $1', [u.id])).rows[0];
    assert.deepStrictEqual(after, before, 'not one unrelated column may move');
    const r = await me(token);
    assert.strictEqual(r.body.user.onboarded, false, 'and `onboarded` in the body is ignored too');
  });
});
