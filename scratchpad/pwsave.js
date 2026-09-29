/* LETTING THE BROWSER SAVE THE PASSWORD (owner).
 *
 * Chrome, Safari and iOS Keychain decide "that was a sign-in, shall I save it?" by watching
 * for a real <form> submit that carries a username field and a current-password field. The
 * fields were already labelled correctly; the form and the submit were missing.
 *
 * WHAT THIS CANNOT TEST: the "Save password?" bubble itself is browser chrome, not page
 * content — no automated browser can see it. What is tested is every precondition the
 * browser looks at, and that sign-in still works, which is the real risk in touching this.
 *
 * IT OWNS ITS ACCOUNT. It needs one whose password it knows, and it used to demand that
 * somebody create pmtest@t.local by hand (the old instructions repurposed a hardcoded
 * user id). On a fresh database nobody had, so the email step never reached the password
 * step and the probe died in a raw 15s waitForSelector stack — in EVERY full run since
 * build 1874, unnoticed, because a stack trace carries no "FAILED" for a monitor to see.
 * `ensureFixture` now upserts that one deterministic identity through the shared
 * qa-fixture pool (the same database the server is using), hashed by the app's own
 * auth.hashPassword, and then asks the SERVER whether it can see it. Any failure there is
 * a named "FAILED fixture" line, never a stack. It is not a product assertion.
 * PM_EMAIL / PM_PASS still point it at an existing account instead; nothing is seeded then.
 */
const path = require('path');
const QA = require(path.join(__dirname, 'qa-fixture.js'));
const { chromium } = require(process.env.PW ? process.env.PW + '/node_modules/playwright-core' : 'playwright-core');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = process.env.BASE || 'http://localhost:3262';
const EMAIL = process.env.PM_EMAIL || 'pmtest@t.local';
const PASS = process.env.PM_PASS || 'TestPass!2345';

/* Test databases only: a local socket or localhost. The identity is on .local, which
   cannot be a real member's deliverable address, and the upsert touches only the row
   holding exactly that address. */
async function ensureFixture() {
  if (process.env.PM_EMAIL) return;                       // caller supplied an account
  /* Parsed by hand: a socket-style address (`user:pass@/db?host=/dir`) has an empty host,
     which the WHATWG URL parser rejects outright. */
  const url = QA.dbUrl();
  const host = ((url.match(/^[a-z]+:\/\/(?:[^@/]*@)?([^/:?]*)/i) || [])[1] || '').toLowerCase();
  const sock = /[?&]host=\//.test(url);
  if (!sock && !['localhost', '127.0.0.1', '::1', ''].includes(host)) {
    throw new Error('refusing to seed a non-local database (' + host + ')');
  }
  const pool = QA.newPool();
  try {
    const hash = await require('/home/user/atwe/auth').hashPassword(PASS);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, username, email_verified, onboarded, account_type)
       VALUES ('PM Test', $1, $2, 'pmtest', true, true, 'personal')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         email_verified = true, status = 'active', deactivated = false, totp_enabled = false`,
      [EMAIL, hash]);
  } finally { await pool.end(); }
  /* Prove the SERVER sees it — a fixture in one database and a server on another is the
     exact mismatch qa-fixture.js exists to stop. */
  const r = await fetch(BASE + '/api/auth/exists', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: EMAIL }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.exists) throw new Error(`the server at ${BASE} does not see ${EMAIL} (HTTP ${r.status}) - is it on DATABASE_URL?`);
}

(async () => {
  try { await ensureFixture(); } catch (e) {
    console.log(`  FAILED fixture: could not provide the sign-in account ${EMAIL} — ${e.message}`);
    console.log('\n1 FAILED (fixture/setup — no product assertion ran)');
    process.exit(1);
  }
  const b = await chromium.launch({ executablePath: CHROME });
  let bad = 0;
  const say = (ok, m) => { if (!ok) bad++; console.log(`  ${ok ? 'ok  ' : '✗   '} ${m}`); };

  const toPassword = async (p) => {
    await p.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3200);
    await p.evaluate(() => { const n = [...document.querySelectorAll('button')]
      .find((x) => (x.textContent || '').trim() === 'Continue with Email'); if (n) n.click(); });
    await p.waitForTimeout(800);
    await p.fill('#loginEmailAddr', EMAIL);
    await p.waitForTimeout(250);
    await p.evaluate(() => emailContinue());
    await p.waitForSelector('#authStep2:not(.hidden)', { timeout: 15000 });
    await p.waitForTimeout(600);
  };

  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await toPassword(p);

  /* 1. The step IS a form — the one thing that was missing. */
  const f = await p.evaluate(() => {
    const n = document.getElementById('authStep2');
    if (!n) return null;
    const fields = [...n.elements || []].map((e) => ({ id: e.id, type: e.type, ac: e.autocomplete }));
    return { tag: n.tagName, fields,
      submits: fields.filter((x) => x.type === 'submit').length };
  });
  say(f && f.tag === 'FORM', `the password step is a real <form> (${f ? f.tag : 'MISSING'})`);
  say(f && f.fields.some((x) => x.ac === 'username'), 'it carries a username field');
  say(f && f.fields.some((x) => x.ac === 'current-password' && x.type === 'password'), 'and a current-password field');
  say(f && f.submits >= 1, `with a real submit button (${f ? f.submits : 0})`);

  /* 2. The username is FILLED by the time it matters. A manager will not save a password
        it cannot name, and this step only echoes the address as text. */
  const uv = await p.evaluate(() => document.getElementById('loginPmUser').value);
  say(uv === EMAIL, `and the username is actually filled in ("${uv}")`);

  /* 3. It takes up no space: absolutely positioned, so not a flex item of the step. */
  const geo = await p.evaluate(() => { const n = document.getElementById('loginPmUser');
    const cs = getComputedStyle(n), r = n.getBoundingClientRect();
    return { pos: cs.position, w: Math.round(r.width), h: Math.round(r.height), op: cs.opacity, disp: cs.display }; });
  say(geo.pos === 'absolute' && geo.w <= 2 && geo.h <= 2 && +geo.op === 0,
    `it occupies nothing on screen (${geo.pos}, ${geo.w}x${geo.h}, opacity ${geo.op})`);
  /* display:none would make a manager ignore it — it has to stay rendered. */
  say(geo.disp !== 'none', 'but is still RENDERED, or the manager would ignore it');

  /* 4. Pressing Enter submits ONCE. The field used to carry its own Enter handler; leaving
        that in place alongside the form's implicit submission would log in twice. */
  /* Count a REAL Enter press. An earlier version of this check dispatched a synthetic
     keydown AND called form.requestSubmit() — two submissions by construction, so it
     reported 1 or 2 depending on timing and told us nothing. A synthetic key event does
     not trigger implicit submission at all; only a real one does. */
  await p.evaluate(() => {
    window.__subs = 0; window.__logins = 0;
    document.getElementById('authStep2').addEventListener('submit', () => window.__subs++);
    window.__realLogin = window.doLogin;
    window.doLogin = function () { window.__logins++; };   // count, don't actually sign in
    document.getElementById('loginPass').value = 'x';
    authToggleContinue();
  });
  await p.focus('#loginPass');
  await p.press('#loginPass', 'Enter');
  await p.waitForTimeout(400);
  const counted = await p.evaluate(() => {
    const r = { submits: window.__subs, logins: window.__logins };
    window.doLogin = window.__realLogin;
    return r;
  });
  say(counted.submits === 1 && counted.logins === 1,
    `a real Enter press signs in exactly ONCE, not twice (${counted.submits} submit, ${counted.logins} login)`);

  /* 5. THE REAL RISK: sign-in must still work. The button lost its onclick and the field
        lost its Enter handler; if the form did not pick both up, nobody could log in. */
  await ctx.close();
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2 = await ctx2.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e).slice(0, 140)));
  await toPassword(p2);
  await p2.fill('#loginPass', PASS);
  await p2.waitForTimeout(250);
  await p2.click('#loginBtn');
  const inByClick = await p2.waitForFunction(() => !!localStorage.getItem('atwe_token'), { timeout: 20000 }).then(() => true).catch(() => false);
  say(inByClick, 'tapping Continue still signs you in');
  await ctx2.close();

  const ctx3 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p3 = await ctx3.newPage();
  await toPassword(p3);
  await p3.fill('#loginPass', PASS);
  await p3.waitForTimeout(250);
  await p3.press('#loginPass', 'Enter');
  const inByEnter = await p3.waitForFunction(() => !!localStorage.getItem('atwe_token'), { timeout: 20000 }).then(() => true).catch(() => false);
  say(inByEnter, 'and so does pressing Enter in the password field');
  await ctx3.close();

  say(errs.length === 0 && errs2.length === 0, `no JS errors${errs.concat(errs2).length ? ' — ' + errs.concat(errs2)[0] : ''}`);
  await b.close();
  console.log(bad ? `\n${bad} FAILED` : '\nthe browser has everything it needs to offer to save the password — and signing in still works');
  process.exit(bad ? 1 : 0);
})();
