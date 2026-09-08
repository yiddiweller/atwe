/* CAN A COMPLETE STRANGER CREATE AN ACCOUNT?
 *
 * The founder's team found that nobody could. The cause was not a broken screen and
 * not a broken route — it was a route that LIED. `mailer.sendMail` degrades rather
 * than throwing: with no SMTP configured it logs the message to the server console
 * and returns `{delivered:false}`, deliberately, so the flow stays testable in dev.
 * `/api/auth/signup/start` awaited it inside a try/catch that only ever fired on a
 * THROW, so the no-transport case sailed straight through and the route answered
 * `{ok:true}`. The app said "we sent you a code" and showed the code screen, while
 * the only copy of that code sat in a log no member can read.
 *
 * Every existing probe passed. They drove screens and called functions; none asked
 * the one question a stranger asks — CAN I ACTUALLY JOIN? So this one does, twice:
 *
 *  1. THE WHOLE JOURNEY, through the real UI: the sign-in screen, an email nobody has
 *     used, the 6-digit code (read back out of the server's own output, which is the
 *     only place a dev box puts it), name, password, handle — and then it checks the
 *     account really exists and is really signed in.
 *  2. THE HONESTY RULE: with no way to deliver mail, a code route must REFUSE. It may
 *     never answer ok. Checked against the three routes that carry a code, and the two
 *     enumeration-safe ones (resend, reset) are additionally checked to refuse the same
 *     way for a real account and an invented one — a mail outage must not become a way
 *     to discover who has an account.
 *
 * A dev box keeps its console codes (req.hostname says localhost), so the refusal is
 * exercised by sending a production Host header — the same signal the server reads.
 *
 * Self-test: make signup/start answer `{ok:true}` again when it cannot mail, and the
 * honesty checks go red by name.
 */
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = 3287;
const DB = process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore';

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

/* The server is spawned HERE rather than reused, because the 6-digit code only exists
   in its stdout on a box with no SMTP — there is nowhere else to read it from (the
   database stores a hash). Owning the process is the only way to see it. */
let out = '';
const srv = spawn('node', [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: process.env.JWT_SECRET || 'scoresecret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => { out += d.toString(); });
srv.stderr.on('data', (d) => { out += d.toString(); });
const stop = () => { try { srv.kill('SIGKILL'); } catch (e) {} };

/* `X-Forwarded-Host`, NOT `Host`. Node's fetch silently DROPS a Host header (it is a
   forbidden header), so an earlier version of this sent nothing and every honesty check
   passed against a server that still thought it was on a dev box — i.e. it proved the
   opposite of what it claimed. The app sets `trust proxy`, which is exactly what makes
   Express read this one, and it is what Railway's own proxy sends. */
const api = async (p, body, host) => {
  const r = await fetch(`http://localhost:${PORT}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(host ? { 'X-Forwarded-Host': host } : {}) },
    body: JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};

/* /api/config sits BEHIND the still-setting-up gate; /api/health does not, and answers
   long before db.init() has finished. Waiting on health is how an earlier probe in this
   repo spent a whole run getting 503s. */
const waitUp = async () => {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/api/config`); if (r.ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
};

(async () => {
  if (!await waitUp()) { console.log('  FAIL the test server never came up'); stop(); process.exit(1); }

  /* ── 1. A stranger joins, through the real screens ───────────────────────────── */
  const email = 'joiner' + Date.now() + '@example.com';
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

  const press = (rx) => {
    const btns = [...document.querySelectorAll('button')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 60 && r.height > 20 && e.offsetParent && getComputedStyle(e).visibility !== 'hidden';
    });
    const b2 = btns.find((e) => rx.test(e.textContent.trim()));
    if (!b2 || b2.disabled) return false;
    b2.click(); return true;
  };
  const step = () => [...document.querySelectorAll('.auth-step')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id).join(',');
  const fill = ([id, v]) => { const f = document.getElementById(id); if (!f) return false; f.focus(); f.value = v; f.dispatchEvent(new Event('input', { bubbles: true })); return true; };

  await p.goto(`http://localhost:${PORT}/signup`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);

  ok(await p.evaluate(press, /Continue with Email/i), 'the sign-in screen offers a way in by email');
  await p.waitForTimeout(1200);
  await p.evaluate(fill, ['loginEmailAddr', email]);
  await p.waitForTimeout(400);
  await p.evaluate(press, /^Continue$/i);
  await p.waitForTimeout(1800);
  ok(await p.evaluate(() => document.getElementById('emailStepBtn').classList.contains('is-create')),
    'an email nobody has used offers to create an account');
  await p.evaluate(press, /Create an account/i);
  await p.waitForTimeout(1600);
  ok(await p.evaluate(step) === 'suTypeStep', 'and that opens the create-account wizard', await p.evaluate(step));

  await p.evaluate(press, /For myself|Personal/i);
  await p.waitForTimeout(1500);
  const before = out.length;
  await p.evaluate(press, /^(Continue|Send|Next)/i);
  await p.waitForTimeout(2600);
  ok(await p.evaluate(step) === 'suCodeStep', 'asking for the code means the server accepted the address', await p.evaluate(step));

  /* THE CODE ITSELF. On a box with no SMTP the mailer prints it; that is the only copy. */
  const m = /Your Atwe verification code is:?\s*(\d{6})/.exec(out.slice(before)) || /verification code is (\d{6})/.exec(out.slice(before));
  ok(!!m, 'a real 6-digit code was produced for that address');
  if (m) {
    await p.evaluate((c) => {
      const boxes = [...document.querySelectorAll('#suOtpRow .otp-box')];
      if (boxes.length) { boxes.forEach((b3, i) => { b3.value = c[i]; b3.dispatchEvent(new Event('input', { bubbles: true })); }); return; }
      const f = document.querySelector('#suCodeStep input'); if (f) { f.value = c; f.dispatchEvent(new Event('input', { bubbles: true })); }
    }, m[1]);
    await p.waitForTimeout(2600);
    ok(await p.evaluate(step) !== 'suCodeStep', 'entering it moves the wizard on', await p.evaluate(step));
  }

  /* Finish the account. Each step is filled from whatever field it actually shows, so a
     re-ordered wizard does not silently stop being covered. */
  const handle = 'joiner' + String(Date.now()).slice(-8);
  for (let i = 0; i < 10; i++) {
    const at = await p.evaluate(step);
    if (!at) break;
    await p.evaluate(([h, e]) => {
      const cur = [...document.querySelectorAll('.auth-step')].find((s) => getComputedStyle(s).display !== 'none');
      if (!cur) return;
      cur.querySelectorAll('input').forEach((f) => {
        if (f.type === 'hidden' || !f.offsetParent) return;
        if (f.value) return;
        const k = (f.id + f.name + f.placeholder + f.autocomplete).toLowerCase();
        if (/pass/.test(k)) f.value = 'Str0ng!Pass' + e.slice(0, 4);
        else if (/user|handle/.test(k)) f.value = h;
        else if (/date|dob|birth/.test(k) || f.type === 'date') f.value = '1994-03-11';
        else f.value = 'Joiner Test';
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }, [handle, String(Date.now())]);
    await p.waitForTimeout(700);
    const moved = await p.evaluate(press, /^(Continue|Next|Done|Finish|Create|Skip)/i);
    if (!moved) { if (process.env.SUDBG) console.log('   stalled at', at, await p.evaluate(() => { const c=[...document.querySelectorAll('.auth-step')].find(x=>getComputedStyle(x).display!=='none'); return c ? [...c.querySelectorAll('button')].filter(x=>x.offsetParent).map(x=>x.textContent.trim().slice(0,18)+(x.disabled?'(off)':'')).join(' / ') : ''; })); break; }
    if (process.env.SUDBG) console.log('   step', at, '->', await p.evaluate(step));
    await p.waitForTimeout(2000);
  }

  /* The last step (a profile photo) is where the account is actually created, and it
     offers Skip rather than Continue — so the loop must PRESS it, not stop at it. */
  await p.waitForTimeout(3500);
  /* Ask the SERVER, not the page. The last step hands off into onboarding, so `S.user`
     is legitimately null for a moment — an earlier version read it there and reported a
     failure on an account that had genuinely been created. The token is the proof, and
     what it proves is settled by the server. */
  const token = await p.evaluate(() => localStorage.getItem('atwe_token'));
  ok(!!token, 'the stranger ends up holding a real session');
  let me = null;
  if (token) {
    const r = await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) me = await r.json();
  }
  ok(!!(me && me.user && me.user.id), 'and the server agrees the account exists', JSON.stringify(me && me.user ? { id: me.user.id, u: me.user.username } : me));
  ok(!!(me && me.user && String(me.user.email || '').toLowerCase() === email), 'registered to the address they typed', me && me.user && me.user.email);
  ok(errs.length === 0, 'no JS errors on the way through', errs[0]);
  await ctx.close(); await b.close();

  /* ── 2. The honesty rule ─────────────────────────────────────────────────────── */
  const H = 'atwe.com'; // a production host: the server must stop using console codes
  const dev = await api('/api/auth/signup/start', { email: 'devcodes' + Date.now() + '@example.com' });
  ok(dev.status === 200, 'a DEV box still works — console codes are how this is tested', dev.status);

  const prod = await api('/api/auth/signup/start', { email: 'nobody' + Date.now() + '@example.com' }, H);
  ok(prod.status === 503 && prod.body && prod.body.emailDown === true,
    'with no way to send mail, creating an account REFUSES instead of claiming success',
    prod.status + ' ' + JSON.stringify(prod.body));
  ok(prod.body && !prod.body.ok, '...and never answers ok', JSON.stringify(prod.body));

  const resend = await api('/api/auth/signup/resend', { email: 'nobody' + Date.now() + '@example.com' }, H);
  ok(resend.status === 503 && resend.body.emailDown, 'resending a code refuses the same way', resend.status);

  /* The two enumeration-safe routes must refuse IDENTICALLY for a real account and an
     invented one, or a mail outage becomes a way to find out who has an account. */
  const realReset = await api('/api/auth/reset/send', { identifier: 'atwe' }, H);
  const fakeReset = await api('/api/auth/reset/send', { identifier: 'no-such-person-' + Date.now() }, H);
  ok(realReset.status === 503 && fakeReset.status === 503, 'a password reset refuses too',
    realReset.status + '/' + fakeReset.status);
  ok(realReset.status === fakeReset.status && JSON.stringify(realReset.body) === JSON.stringify(fakeReset.body),
    '...and refuses identically for a real and an invented account, so it leaks nothing');

  /* The legacy link-based reset, still what Settings -> Change password calls. Also
     always-200 by design, so its check runs before any lookup for the same reason. */
  const realForgot = await api('/api/auth/forgot', { email: 'atwe@atwe.internal' }, H);
  const fakeForgot = await api('/api/auth/forgot', { email: 'no-such-' + Date.now() + '@example.com' }, H);
  ok(realForgot.status === 503 && fakeForgot.status === 503, 'the emailed reset LINK refuses too',
    realForgot.status + '/' + fakeForgot.status);
  ok(JSON.stringify(realForgot.body) === JSON.stringify(fakeForgot.body),
    '...identically, so it leaks nothing either');

  /* The two AUTHED routes. No enumeration concern here — you are already signed in —
     so they may refuse loudly. change-email matters most: it moves the account to the
     new address and marks it UNVERIFIED before sending the link, so a refusal that
     came after the write would strand somebody on an address they can never verify. */
  const tok = (() => { try { return require('fs').readFileSync('/tmp/tok.txt', 'utf8').trim(); } catch (e) { return ''; } })();
  if (tok) {
    const authed = async (p, body) => {
      const r = await fetch(`http://localhost:${PORT}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': H, Authorization: 'Bearer ' + tok },
        body: JSON.stringify(body || {}),
      });
      let j = null; try { j = await r.json(); } catch (e) {}
      return { status: r.status, body: j || {} };
    };
    const beforeEmail = (await (async () => {
      const r = await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { Authorization: 'Bearer ' + tok } });
      const j = await r.json().catch(() => ({}));
      return (j.user || {}).email;
    })());
    /* An account made through signup/finish is ALREADY verified — the code proved the
       address — so this route legitimately answers "nothing to send" for it. Assert the
       honest outcome for whichever account /tmp/tok.txt happens to hold rather than
       demanding a 503 it has no reason to give; the guard itself is proved for all four
       routes by the source check below, which does not depend on account state. */
    const rv = await authed('/api/auth/resend-verification');
    ok(rv.status === 503 ? !!rv.body.emailDown : rv.body.alreadyVerified === true,
      're-sending a verification email either refuses, or has nothing to send',
      rv.status + ' ' + JSON.stringify(rv.body));
    const ce = await authed('/api/auth/change-email', { email: 'moved-' + Date.now() + '@example.com', password: 'not-the-password' });
    ok(ce.status === 503 && ce.body.emailDown, 'changing your email refuses', ce.status + ' ' + JSON.stringify(ce.body));
    const afterEmail = (await (async () => {
      const r = await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { Authorization: 'Bearer ' + tok } });
      const j = await r.json().catch(() => ({}));
      return (j.user || {}).email;
    })());
    ok(beforeEmail === afterEmail, '...BEFORE it changes anything, so nobody is stranded on an unverifiable address',
      beforeEmail + ' -> ' + afterEmail);
  }

  /* THE INVARIANT, checked in the source rather than over the wire: every route that
     sends somebody a code or a link must consult mailCanDeliver. A route test can only
     reach the ones whose preconditions the probe can arrange; this reaches all of them,
     and is what stops a NEW code route shipping with the same lie. */
  {
    const src = require('fs').readFileSync(require('path').join(ROOT, 'server.js'), 'utf8');
    const MUST_GUARD = [
      '/api/auth/signup/start',
      '/api/auth/signup/resend',
      '/api/auth/reset/send',
      '/api/auth/forgot',
      '/api/auth/resend-verification',
      '/api/auth/change-email',
    ];
    for (const route of MUST_GUARD) {
      const at = src.indexOf(`'${route}'`);
      /* The route's own body: from its handler to the next app.<verb>( after it. */
      const next = src.slice(at + 1).search(/\napp\.(get|post|put|patch|delete)\(/);
      const bodyText = at < 0 ? '' : src.slice(at, next < 0 ? at + 4000 : at + 1 + next);
      ok(at >= 0 && /mailCanDeliver\s*\(/.test(bodyText),
        `${route} refuses when mail cannot be delivered`);
    }
  }

  stop();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${pass}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'a stranger can join, and a code route never lies');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); stop(); process.exit(1); });
