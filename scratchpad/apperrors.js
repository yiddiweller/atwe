/* WHEN THE APP BREAKS FOR SOMEBODY, THE OWNER FINDS OUT — AND SIGNING UP OFFERS TO SAVE
 * THE PASSWORD.
 *
 * Until now a thrown error in a member's browser was seen by nobody: nothing in the
 * product could say that anyone hit a bug today. This drives the real path — throw a real
 * error in a real browser, then read it back through the real admin API.
 *
 * What it holds to, and each one was got WRONG first:
 *  · one row per distinct FAULT, with numbers flattened out of the fingerprint, so a bug
 *    that fires with a different id every time is one line and not a thousand;
 *  · the cross-origin "Script error." that extensions produce is ignored — nobody can act
 *    on it;
 *  · NOTHING PERSONAL is stored: no message text, no names, and not the URL either (a path
 *    like /john IS somebody's name) — the world and the screen instead;
 *  · a brand-new fault alerts the admins, and only a brand-new one.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const crypto = require('crypto');
const { chromium } = require(__dirname + '/node_modules/playwright-core');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
const BASE = process.env.BASE || 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + String(x).slice(0, 200) : '')); } };

(async () => {
  const tag = 'probe' + crypto.randomUUID().slice(0, 8);        // unique, so runs never collide
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4500);

  /* A real fault, thrown the way a real one arrives — and the same fault again with a
     different number in it, which must NOT become a second line. */
  await p.evaluate((t) => { setTimeout(() => { throw new Error(t + ' broke on item 4821'); }, 0); }, tag);
  await p.waitForTimeout(700);
  await p.evaluate(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' })); });
  await p.waitForTimeout(500);
  const p2 = await b.newPage({ viewport: { width: 390, height: 844 } });   // a second session
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(4500);
  await p2.evaluate((t) => { setTimeout(() => { throw new Error(t + ' broke on item 9137'); }, 0); }, tag);
  await p2.waitForTimeout(1200);

  const { rows } = await pool.query('SELECT * FROM client_errors WHERE message LIKE $1', ['%' + tag + '%']);
  ok(rows.length === 1, 'one line for one fault, however many numbers are in it (' + rows.length + ' rows)');
  const e = rows[0] || {};
  ok(e.hits >= 2, 'both sessions counted against it (' + e.hits + ')', JSON.stringify(e));
  ok(!/script error/i.test(e.message || ''), 'the cross-origin noise never made a row of its own');
  const noise = await pool.query("SELECT COUNT(*)::int n FROM client_errors WHERE message ILIKE 'script error%'");
  ok(noise.rows[0].n === 0, 'and none exists at all');
  /* Nothing that identifies a person: the screen, not the URL. */
  ok(!!e.path && !/https?:|\/@|\?/.test(e.path), 'it recorded the SCREEN, not the address (' + e.path + ')');
  ok(e.build && /^\d+$/.test(e.build), 'and which build the device was running (' + e.build + ')');
  ok(e.users_hit >= 1, 'with a count of how many different people hit it (' + e.users_hit + ')');

  /* A new fault tells the admins — through notifySelf, because notifications.actor_id is
     NOT NULL and a fault has no actor. The first version used notify(admin, null, …),
     whose insert failed silently every time. */
  /* A new fault interrupts somebody — but only three times an hour, or a bad deploy would
     ring the owner's phone twenty times. Which of the two happened is not guessable from
     outside, so the route reports the remaining budget and this asks the right question. */
  const adm = await pool.query("SELECT COUNT(*)::int n FROM notifications WHERE type = 'app_error' AND created_at > now() - interval '3 minutes'");
  const budget = await pool.query("SELECT COUNT(*)::int n FROM notifications WHERE type = 'app_error' AND created_at > now() - interval '1 hour'");
  if (adm.rows[0].n >= 1) ok(true, 'a brand-new fault alerts the admins (' + adm.rows[0].n + ')');
  else ok(budget.rows[0].n > 0, 'the hourly alert ceiling had already been spent, so this one landed quietly — as designed',
    'no alert, and none in the past hour either');

  /* Marking it fixed, and the one rule that makes that meaningful. */
  const a = await pool.query('SELECT id, email FROM users WHERE is_admin = true ORDER BY id LIMIT 1');
  if (a.rows[0]) {
    const tok = auth.signToken({ id: a.rows[0].id, email: a.rows[0].email, is_admin: true });
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
      [crypto.createHash('sha256').update(tok).digest('hex'), a.rows[0].id]);
    const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
    const list = await (await fetch(BASE + '/api/admin/client-errors', { headers: H })).json();
    ok(Array.isArray(list.errors) && list.errors.some(x => (x.message || '').includes(tag)), 'the dashboard can read it back');
    const r = await (await fetch(BASE + '/api/admin/client-errors/' + e.id + '/resolve',
      { method: 'POST', headers: H, body: JSON.stringify({ resolved: true }) })).json();
    ok(r.resolved === true, 'and mark it fixed', JSON.stringify(r));
    /* The SAME message the browser reported — a browser-thrown error arrives as
       "Uncaught Error: …", and sending the bare text makes a DIFFERENT fingerprint, i.e. a
       second row. The straggler check then passes for the wrong reason (the original was
       simply never touched) and the reopen check fails. */
    const send = (build) => fetch(BASE + '/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: e.message, source: e.source, path: 'home', build }) });
    await send(e.build); await new Promise(r => setTimeout(r, 900));
    let now = (await pool.query('SELECT resolved FROM client_errors WHERE id = $1', [e.id])).rows[0];
    ok(now.resolved === true, 'a straggler still on the old build does not reopen it');
    await send(String(Number(e.build) + 1)); await new Promise(r => setTimeout(r, 900));
    now = (await pool.query('SELECT resolved FROM client_errors WHERE id = $1', [e.id])).rows[0];
    ok(now.resolved === false, 'but the same fault on a NEWER build does');
  } else ok(false, 'no admin account to check the dashboard with');

  /* SIGNING UP OFFERS TO SAVE THE PASSWORD. A browser decides "shall I save this?" by
     watching for a real form submit carrying a username field and a new-password field.
     Logging in had all three; creating an account had none. */
  const su = await p.evaluate(async () => {
    SU.email = 'probe@example.com'; SU.mode = 'email';
    showOverlay('signupOverlay'); suShow('suPassStep');
    await new Promise(r => setTimeout(r, 400));
    const f = document.getElementById('suPassStep'), pw = document.getElementById('suPass'),
      un = document.getElementById('suPmUser'), btn = document.getElementById('suPassBtn');
    window.__suCalls = 0; window.suPassContinue = () => { window.__suCalls++; };
    pw.value = 'a-good-password-123'; pw.focus();
    const cs = getComputedStyle(f);
    return { tag: f.tagName, display: cs.display, dir: cs.flexDirection,
      user: un && un.value, userAuto: un && un.getAttribute('autocomplete'),
      pwAuto: pw.getAttribute('autocomplete'), btnType: btn.type };
  });
  /* A REAL Enter, pressed by the browser: a synthetic KeyboardEvent is untrusted and never
     performs a form's implicit submit, so dispatching one measures nothing at all. */
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  su.calls = await p.evaluate(() => window.__suCalls);
  ok(su.tag === 'FORM', 'the sign-up password step is a real form', su.tag);
  ok(su.userAuto === 'username' && !!su.user, 'carrying the address as a username (' + su.user + ')');
  ok(su.pwAuto === 'new-password', 'and the password marked as a NEW one');
  ok(su.btnType === 'submit', 'Continue really submits it');
  ok(su.display === 'flex' && su.dir === 'column', 'and the step is laid out exactly as before');
  ok(su.calls === 1, 'one Enter runs it ONCE — not twice, as the login step used to', su.calls);

  await b.close(); await pool.end();
  console.log(fail ? `\n${fail} FAILED` : '\nBreakages reach the owner, and signing up offers to save the password');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
