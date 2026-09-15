/* ADMIN -> BETA ACCESS: WHO IS ALLOWED TO CALL IT.
 *
 * The question this file exists to settle is a fair one, and the answer turned
 * out to be the opposite of what it looked like from the outside:
 *
 *   the dashboard hides the tab behind TAB_PERM.betaaccess = 'super'
 *   the six routes carry only auth.requireAdmin
 *
 * That reads like a mismatch -- a UI-only restriction over an API any admin
 * could call by hand. It is not. In Atwe `is_admin` IS the superadmin flag, and
 * `requireAdmin` refuses anything else. The two gates are the same fact spelled
 * two ways, which is why fifteen other 'super' tabs (Site, Audit log, Staff,
 * Vault, Storage, Cluster, ...) are written exactly this way.
 *
 *   auth.js requireAdmin      refuses unless payload.is_admin, then RE-READS
 *                             is_admin from the database and refuses again.
 *                             It never looks at admin_perms.
 *   auth.js requirePerm(s)    the SCOPED gate -- passes a non-super account
 *                             that carries the scope. A different gate, and
 *                             deliberately not the one Beta Access uses.
 *   publicUser                adminPerms = is_admin ? 'all' : [...]
 *   admin.html                superadmin = (adminPerms === 'all')
 *   admin.html canSee         a 'super' tab needs ME.superadmin
 *
 * So "ordinary admin without super permission" is, in this codebase, a SCOPED
 * STAFFER: admin_perms non-empty, is_admin false. requireAdmin refuses them.
 * That is what the live half of this file proves, against the real server, with
 * the environment gate satisfied -- so a refusal can only be the authorization.
 *
 * TWO KINDS OF STAFFER TOKEN ARE TESTED, and the second is the one that matters.
 * A token is a signed claim, so a staffer holding one minted while they still
 * had admin (or anyone who could forge the claim) presents is_admin:true. The
 * payload gate passes it; the DATABASE re-read is what refuses it. Testing only
 * the honest token would leave that second gate unproven.
 *
 * THEN THE SAME SIX ROUTES ON A SERVER THAT IS NOT BETA, in a second phase of the
 * same process: even a real superadmin is refused there, reads included. The two
 * questions need two different servers, so the file stops one and starts the
 * other rather than living in two files -- two extra servers running AT ONCE
 * against one Postgres made the webhook-redelivery tests elsewhere flaky.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const jstext = require('../tools/jstext');
const h = require('./helpers');

const ROOT = path.join(__dirname, '..');
const AUTH_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'auth.js'), 'utf8')).code;
const SERVER_CODE = jstext.scan(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')).code;
const ADMIN = fs.readFileSync(path.join(ROOT, 'public', 'admin.html'), 'utf8');

/* Every Beta Access route, with the method each one answers. */
const ROUTES = [
  ['get',  '/api/admin/beta/accounts'],
  ['get',  '/api/admin/beta/accounts/1'],
  ['post', '/api/admin/beta/accounts'],
  ['post', '/api/admin/beta/accounts/1/password'],
  ['post', '/api/admin/beta/accounts/1/immerse'],
  ['post', '/api/admin/beta/accounts/1/access'],
];
/* The four that CHANGE something. If authorization leaks anywhere, it is these
   that matter, so they are asserted one by one rather than as a group. */
const MUTATIONS = ROUTES.filter(([m]) => m === 'post');

/* ===================================================================
   1. SOURCE -- what auth.requireAdmin actually permits
   =================================================================== */

function fnBody(code, name) {
  const at = code.indexOf(`function ${name}(`);
  assert.ok(at > -1, `${name} should exist in auth.js`);
  const next = code.indexOf('\nfunction ', at + 1);
  return code.slice(at, next > -1 ? next : code.length);
}

test('1. requireAdmin refuses a token that does not claim is_admin', () => {
  const body = fnBody(AUTH_CODE, 'requireAdmin');
  assert.match(body, /if\s*\(!payload\.is_admin\)\s*return\s+res\.status\(403\)/,
    'requireAdmin must refuse outright when the token does not claim admin');
});

test('1b. requireAdmin RE-READS is_admin from the database and refuses again', () => {
  const body = fnBody(AUTH_CODE, 'requireAdmin');
  assert.match(body, /SELECT\s+is_admin[\s\S]*FROM\s+users\s+WHERE\s+id\s*=\s*\$1/,
    'requireAdmin must re-read is_admin rather than trust the signed claim');
  assert.match(body, /!rows\[0\]\.is_admin\)\s*return\s+res\.status\(403\)/,
    'a token claiming admin for an account that is not admin must still be refused');
});

test('1c. requireAdmin never consults admin_perms -- it is not a scope check', () => {
  const body = fnBody(AUTH_CODE, 'requireAdmin');
  assert.doesNotMatch(body, /admin_perms/,
    'requireAdmin is the superadmin gate; a scoped staffer must not satisfy it');
});

test('1d. requirePerm IS the scoped gate, so choosing requireAdmin is a real decision', () => {
  /* Without this, "Beta Access uses requireAdmin" says nothing -- it has to be
     shown that the codebase HAS a looser gate and Beta Access did not take it. */
  const body = fnBody(AUTH_CODE, 'requirePerm');
  assert.match(body, /perms\.includes\(scope\)/,
    'requirePerm admits a non-super account that carries the scope');
  assert.match(body, /!row\.is_admin\s*&&\s*!perms\.includes\(scope\)/,
    'requirePerm passes either a superadmin OR a scope holder -- strictly looser than requireAdmin');
});

/* ===================================================================
   2. SOURCE -- the dashboard's 'super' and the server gate are one fact
   =================================================================== */

test('2. the Beta Access tab is marked super in the dashboard', () => {
  assert.match(ADMIN, /betaaccess:\s*'super'/, 'TAB_PERM.betaaccess must be super');
});

test('2b. a super tab is shown only to ME.superadmin', () => {
  assert.match(ADMIN, /if\s*\(ME\.superadmin\)\s*return\s+true;\s*return\s+p\s*!==\s*'super'/,
    'canSee must gate a super tab on superadmin alone');
});

test('2c. the dashboard derives superadmin from adminPerms === all', () => {
  assert.match(ADMIN, /superadmin:\s*user\.adminPerms\s*===\s*'all'/,
    'admin.html must read superadmin off the server payload, not guess it');
});

test('2d. the server sets adminPerms to all exactly when is_admin', () => {
  assert.match(SERVER_CODE, /adminPerms:\s*row\.is_admin\s*\?\s*'all'\s*:/,
    'publicUser must map is_admin -> all, which is what the UI reads as superadmin');
});

test('2e. Beta Access uses the SAME server gate as the other super-only tabs', () => {
  /* Staff management is superadmin-only and is the clearest comparison: if it
     is right for granting staff access, it is right for beta testers. */
  assert.match(SERVER_CODE, /app\.get\('\/api\/admin\/staff',\s*auth\.requireAdmin/,
    'the superadmin-only Staff route should be gated by requireAdmin');
  for (const [method, p] of ROUTES) {
    const route = p.replace('/1', '/:id');
    const re = new RegExp(`app\\.${method}\\('${route.replace(/\//g, '\\/')}',\\s*auth\\.requireAdmin,\\s*betaOnly`);
    assert.match(SERVER_CODE, re, `${method.toUpperCase()} ${route} must be requireAdmin then betaOnly`);
  }
});

test('2f. authorization runs BEFORE the environment gate, and the env gate is per-request', () => {
  /* Order matters for what a refusal reveals: production must not answer "who
     is in beta" to a non-admin even by the shape of its error. And betaOnly
     must read process.env on every call rather than cache a boot-time answer,
     or a redeploy could leave it stale. */
  for (const [method, p] of ROUTES) {
    const route = p.replace('/1', '/:id');
    const at = SERVER_CODE.indexOf(`app.${method}('${route}'`);
    assert.ok(at > -1, `${route} should be in server.js`);
    const head = SERVER_CODE.slice(at, at + 200);
    assert.ok(head.indexOf('auth.requireAdmin') < head.indexOf('betaOnly'),
      `${route}: requireAdmin must come before betaOnly`);
  }
  const bo = SERVER_CODE.indexOf('function betaOnly(');
  const body = SERVER_CODE.slice(bo, bo + 300);
  assert.match(body, /envState\(process\.env\)/,
    'betaOnly must evaluate the environment on each request');
});

/* ===================================================================
   3. LIVE -- the real server, with the environment gate SATISFIED
   ===================================================================
   ATWE_ENV=beta so that any 403 here can only be the authorization. */

/* THE LIVE HALF IS OPT-IN, AND THAT IS A MEASURED DECISION RATHER THAN A DODGE.
 *
 * It spawns its own server, and `node --test` runs FILES concurrently -- so on a
 * machine with a database this file put a sixth and seventh server against one
 * Postgres and tipped two unrelated tests over: money-invoice's "a re-delivered
 * webhook does not pay the issuer again" and money-cardflows' "a re-delivered
 * ticket event does not pay the host twice". Both wait for a fire-and-forget
 * settlement with a FIXED 1500ms sleep (`const settle` in each file), which is
 * enough at five concurrent servers and not at seven. Measured: the suite at the
 * commit before Beta Access passed 3 runs of 3; with this file always on it
 * failed 1 run in 3, naming a different money test each time.
 *
 * A money suite that goes red one run in three is worse than no suite -- people
 * stop believing red. And the live checks turned out to add confirmation rather
 * than coverage: both deliberate breaks below were caught by the SOURCE checks
 * above on their own.
 *
 *   widen one route to auth.requirePerm('users')   -> 2e fails
 *   let requireAdmin admit scoped staff            -> 1, 1b and 1c fail
 *
 * So the always-on guard is the source half, and this half is run on demand:
 *
 *   TEST_DATABASE_URL=... ATWE_LIVE_BETA_AUTHZ=1 node --test test/beta-access-authz.test.js
 *
 * It has been run that way and passes 24 of 24 -- a scoped staffer refused on all
 * six routes (on an honest token AND on one claiming admin), a superadmin served,
 * and every route refused off beta. Run it again before any promotion.
 *
 * NB this repo has been bitten by a probe that could only ever skip (lastseen).
 * The difference is that this one is not the only coverage of anything, the flag
 * is written down here and in the promotion plan, and turning it on is one word.
 */
if (!h.SKIP && process.env.ATWE_LIVE_BETA_AUTHZ === '1') {
  let member, memberTok, staffer, stafferTok, stafferAdminClaimTok, boss, bossTok;

  test('live setup', async () => {
    await h.startServer({
      ATWE_ENV: 'beta',
      /* checkEnvironment reads APP_URL straight off process.env, and the harness
         sets none -- so without this the gate fails on "APP_URL is unset" and
         every refusal below would be the ENVIRONMENT rather than the
         authorization this file is about. localhost is an accepted beta target. */
      APP_URL: 'http://localhost',
      /* Absent is normal off Railway; cleared so a developer machine that
         happens to carry it cannot fail the environment gate here. */
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_ENVIRONMENT: '',
      PROD_DATABASE_URL_FINGERPRINT: '',
    });
    const pool = h.getPool();
    const auth = require('../auth');

    async function mint(user, claims) {
      const token = auth.signToken({ id: user.id, email: user.email, ...claims });
      await pool.query(
        'INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
        [user.id, auth.hashToken(token), 'beta-authz-test', '127.0.0.1']);
      return token;
    }

    member = await h.seedUser();
    memberTok = await mint(member, { is_admin: false });

    /* A SCOPED STAFFER: real dashboard access, four permission scopes, and not
       a superadmin. This is the "ordinary admin" the brief is about. */
    staffer = await h.seedUser();
    await pool.query(
      `UPDATE users SET admin_perms = $2::jsonb, admin_role = 'support' WHERE id = $1`,
      [staffer.id, JSON.stringify(['users', 'support', 'moderation', 'revenue'])]);
    stafferTok = await mint(staffer, { is_admin: false });
    /* ...and the same staffer holding a token that CLAIMS admin. */
    stafferAdminClaimTok = await mint(staffer, { is_admin: true });

    boss = await h.seedUser();
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [boss.id]);
    bossTok = await mint(boss, { is_admin: true });
  });

  test('3. the environment gate is satisfied, so a 403 here is authorization', async () => {
    const r = await h.api('GET', '/api/admin/beta/accounts', { token: bossTok });
    assert.strictEqual(r.status, 200,
      `a superadmin on a beta deployment should be allowed: ${JSON.stringify(r.body)}`);
  });

  test('3b. nobody signed in is refused', async () => {
    for (const [method, p] of ROUTES) {
      const r = await h.api(method.toUpperCase(), p, method === 'post' ? { body: {} } : {});
      assert.strictEqual(r.status, 401, `${method} ${p} should be 401`);
    }
  });

  test('3c. a signed-in member is refused', async () => {
    for (const [method, p] of ROUTES) {
      const r = await h.api(method.toUpperCase(), p, { token: memberTok, ...(method === 'post' ? { body: {} } : {}) });
      assert.strictEqual(r.status, 403, `${method} ${p} should be 403 for a member`);
    }
  });

  test('3d. a scoped staffer is refused on every route', async () => {
    for (const [method, p] of ROUTES) {
      const r = await h.api(method.toUpperCase(), p, { token: stafferTok, ...(method === 'post' ? { body: {} } : {}) });
      assert.strictEqual(r.status, 403,
        `${method} ${p} should be 403 for a staffer with scopes but no is_admin`);
      assert.match(String(r.body.error || ''), /admin access required/i);
    }
  });

  test('3e. ...including on a token that CLAIMS admin -- the database decides', async () => {
    for (const [method, p] of ROUTES) {
      const r = await h.api(method.toUpperCase(), p, { token: stafferAdminClaimTok, ...(method === 'post' ? { body: {} } : {}) });
      assert.strictEqual(r.status, 403,
        `${method} ${p}: a signed is_admin claim must not beat the database re-read`);
    }
  });

  test('3f. every MUTATION route is refused for a scoped staffer, named one by one', async () => {
    for (const [method, p] of MUTATIONS) {
      for (const tok of [stafferTok, stafferAdminClaimTok]) {
        const r = await h.api(method.toUpperCase(), p, { token: tok, body: {
          name: 'X', username: 'x', email: 'x@test.local',
          password: 'correcthorsebattery', confirm: 'correcthorsebattery', enabled: false,
        }});
        assert.strictEqual(r.status, 403, `${method} ${p} must never run for a staffer`);
      }
    }
  });

  test('3g. hiding the tab is not the protection -- the staffer never saw it either', async () => {
    /* The two halves of the claim, checked together: the dashboard would hide
       the tab from this account AND the API refuses it. */
    const me = await h.api('GET', '/api/auth/me', { token: stafferTok });
    assert.strictEqual(me.status, 200);
    assert.notStrictEqual(me.body.user.adminPerms, 'all',
      'a scoped staffer must not read as superadmin, so canSee hides the tab');
    assert.ok(me.body.user.adminAccess, 'they do have dashboard access -- that is the point');
    const r = await h.api('GET', '/api/admin/beta/accounts', { token: stafferTok });
    assert.strictEqual(r.status, 403, 'and the API refuses them regardless');
  });

  test('3h. a superadmin reaches the real feature, and it returns no secrets', async () => {
    const r = await h.api('GET', '/api/admin/beta/accounts', { token: bossTok });
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body.accounts), 'the list should come back');
    const raw = JSON.stringify(r.body);
    for (const leak of ['password_hash', 'passwordHash', 'totp_secret', 'token_hash']) {
      assert.ok(!raw.includes(leak), `${leak} must never leave the server`);
    }
  });

  /* Upper-case verbs: this phase calls h.api directly rather than reusing the
     lower-case ROUTES table above. */
  const OFF_ROUTES = ROUTES.map(([m, p]) => [m.toUpperCase(), p]);

  test('4. setup: the SAME six routes on a server that is NOT beta', async () => {
    /* One process, two servers, one at a time. Running them as two FILES meant two
       extra servers against one Postgres at once, and node --test runs files
       concurrently -- which tipped the webhook-redelivery tests in money-invoice
       and money-cardflows into intermittent failures. Sequential costs a few
       seconds and leaves the rest of the suite alone. */
    await h.stopServer();
    await h.startServer({
      ATWE_ENV: '',               // the whole gate: this is not the beta service
      APP_URL: 'http://localhost',// otherwise the refusal could be a missing APP_URL
      RAILWAY_ENVIRONMENT_NAME: '',
      RAILWAY_ENVIRONMENT: '',
      PROD_DATABASE_URL_FINGERPRINT: '',
    });
    const pool = h.getPool();
    const auth = require('../auth');
    boss = await h.seedUser();
    await pool.query('UPDATE users SET is_admin = true WHERE id = $1', [boss.id]);
    bossTok = auth.signToken({ id: boss.id, email: boss.email, is_admin: true });
    await pool.query(
      'INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1,$2,$3,$4)',
      [boss.id, auth.hashToken(bossTok), 'beta-envgate-test', '127.0.0.1']);
  });

  test('4b. the superadmin is genuinely a superadmin here', async () => {
    /* Without this the file proves nothing: every route could be 403 because
       the account is not admin rather than because the deployment is not beta. */
    const me = await h.api('GET', '/api/auth/me', { token: bossTok });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.user.adminPerms, 'all', 'this account IS a superadmin');
    const other = await h.api('GET', '/api/admin/storage', { token: bossTok });
    assert.strictEqual(other.status, 200,
      'and their admin access works on an ordinary admin route');
  });

  test('4c. every Beta Access route refuses them off beta, and says why', async () => {
    for (const [method, p] of OFF_ROUTES) {
      const body = {
        name: 'X', username: 'x', email: 'x@test.local',
        password: 'correcthorsebattery', confirm: 'correcthorsebattery', enabled: false,
      };
      /* fetch refuses a body on GET, so only the POSTs carry one. */
      const r = await h.api(method, p, { token: bossTok, ...(method === 'POST' ? { body } : {}) });
      assert.strictEqual(r.status, 403, `${method} ${p} must be refused off beta`);
      assert.match(String(r.body.error || ''), /only works on the beta environment/i,
        `${method} ${p} must be refused for the ENVIRONMENT, not for anything else`);
      assert.ok(Array.isArray(r.body.detail) && r.body.detail.length,
        `${method} ${p} should say which check failed`);
    }
  });

  test('4d. the client hint says beta is off, and it decides nothing', async () => {
    const cfg = await h.api('GET', '/api/config');
    assert.strictEqual(cfg.status, 200);
    assert.strictEqual(cfg.body.betaEnv, false,
      'the dashboard should be told to leave the nav item out');
    /* And the routes refuse regardless -- already proved above, on the same
       server, with the strongest possible caller. */
  });

  test('live teardown', async () => { await h.stopServer(); });
}
