/* A NEW MEMBER MUST REACH ONBOARDING IN THE SAME SESSION.
 *
 * The defect: suFinish() got its token and called suShowSplash() without ever taking
 * the finished wizard step down. A body-level .auth-step is position:fixed at
 * z-index 1001 and every .overlay is 1000, so #suPhotoStep stayed ON TOP of the
 * splash, of the Atwe Pro pitch and of everything after them. The member was signed
 * in and stranded on a dead screen; only a reload escaped, because boot() has its
 * own maybeStartOnboarding() call. Measured before the fix, thirty seconds after a
 * genuinely successful signup:
 *
 *    30s {"open":["suPremium"],"top":"suPhotoStep","visibleStep":["suPhotoStep"],"tok":true}
 *
 * NOT ONE PROBE IN THIS REPO COULD SEE IT, and the reason is the lesson: they press
 * buttons with .click(), which works perfectly on a buried element, and they ask
 * whether a function ran. The only question that finds this is WHAT IS ON TOP, so
 * every check below that matters is an elementFromPoint at a real coordinate.
 *
 * Two more traps this probe had to learn:
 *   - offsetParent is ALWAYS null for a position:fixed element, so "is this step
 *     visible" must be a getBoundingClientRect, never offsetParent.
 *   - the last step hands off into onboarding, so S.user is legitimately null for a
 *     moment. The token is the proof and the SERVER settles what it proves.
 *
 * It spawns its own server, like signupflow.js and cluster.js, because on a box with
 * no SMTP the 6-digit code exists only in that process's stdout; the database stores
 * a hash.
 *
 * Self-test: `node signuphandoff.js --break` serves the pre-fix page (no suHideAll,
 * and the Pro pitch back on the path) by rewriting the shell in flight, and the
 * on-top checks go red by name.
 */
const { spawn } = require('child_process');
const QA_DEFAULT_DB = require('./qa-fixture').DEFAULT_DB;  // the one place the fallback address lives
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.SH_PORT || 3296); // journeys.js owns 3291
const DB = process.env.DATABASE_URL || QA_DEFAULT_DB;
const BREAK = process.argv.includes('--break');

const WIDTHS = [
  { w: 390, h: 844, phone: true, name: '390' },
  { w: 820, h: 1180, phone: true, name: '820' },
  { w: 1440, h: 900, phone: false, name: '1440' },
];

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

let out = '';
const srv = spawn('node', [path.join(ROOT, 'server.js')], {
  cwd: ROOT,
  /* DB_SSL: the auto-detect keys off `@host`, so a socket-style DSN (which a local
     test cluster usually is) needs it said out loud -- otherwise db.init() succeeds
     and every request pool fails with "the server does not support SSL connections". */
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: process.env.JWT_SECRET || 'scoresecret',
         DB_SSL: process.env.DB_SSL || (/[?&]host=/.test(DB) ? 'false' : undefined) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => { out += d.toString(); });
srv.stderr.on('data', (d) => { out += d.toString(); });
const stop = () => { try { srv.kill('SIGKILL'); } catch (e) {} };

/* /api/config is BEHIND the still-setting-up gate; /api/health answers long before
   db.init() has finished, which is how an earlier probe here spent a run on 503s. */
const waitUp = async () => {
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/auth/exists`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'warmup@example.com' }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && !j.starting) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
};

/* ── what the page is asked, in the page ──────────────────────────────────────── */

/* A wizard step is position:fixed, so offsetParent is useless here. */
const visibleSteps = () => [...document.querySelectorAll('.auth-step')]
  .filter((e) => {
    if (e.classList.contains('hidden')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 10 && r.height > 10 && getComputedStyle(e).visibility !== 'hidden';
  }).map((e) => e.id);

/* Is THIS element what a finger would actually hit at its own centre? */
const ownsItsCentre = (id) => {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('hidden')) return { shown: false };
  const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return { shown: false };
  const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return { shown: true, inside: !!(at && el.contains(at)), top: at ? (at.id || at.className || at.tagName) : null };
};

const snapshot = () => {
  const open = ['suSplash', 'suPremium', 'suProfilePrompt', 'onboardingFlow', 'introSheet']
    .filter((id) => { const e = document.getElementById(id); return e && !e.classList.contains('hidden'); });
  const steps = [...document.querySelectorAll('.auth-step')].filter((e) => {
    if (e.classList.contains('hidden')) return false;
    const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10;
  }).map((e) => e.id);
  const at = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight / 2));
  return { open, steps, centre: at ? (at.closest('[id]') ? at.closest('[id]').id : at.tagName) : null,
           tok: !!localStorage.getItem('atwe_token') };
};

/* ── the pre-fix page, for the self-test ──────────────────────────────────────── */
/* Rewritten as it is SERVED. Overriding a rule at runtime is NOT the same state --
   this repo has a recorded case where a CSSOM edit computed the same values and
   still did not reproduce the bug. */
let brokeOk = false;
async function serveBroken(ctx) {
  /* A glob of two stars plus a trailing slash matches only a URL ENDING in a slash, and
     the wizard is entered at /signup -- so an earlier version of this intercepted
     nothing, served the FIXED page and reported a clean self-test. A self-test that
     silently does not apply is worse than none, hence the verification below. */
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (req.resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    const body = await res.text();
    const a = body.replace('    suHideAll();\n    suShowSplash();', '    suShowSplash();');
    const b2 = a.replace("closeOverlay('suSplash'); suShowProfileSetup();", "closeOverlay('suSplash'); showOverlay('suPremium');");
    if (a === body || b2 === a) { console.log('  !! --break could not find the code to revert -- the self-test is meaningless'); }
    else if (!brokeOk) { brokeOk = true; console.log('  (--break: serving the pre-fix page)'); }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: b2 });
  });
}

/* ── one complete journey at one width ────────────────────────────────────────── */
async function journey(b, W, opts) {
  opts = opts || {};
  const L = '[' + (opts.label || W.name) + '] ';
  const ctx = await b.newContext({
    viewport: { width: W.w, height: W.h },
    deviceScaleFactor: W.phone ? 2 : 1, isMobile: W.phone, hasTouch: W.phone,
  });
  if (BREAK) await serveBroken(ctx);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));

  const tap = (sel) => p.evaluate((s2) => { const e = document.querySelector(s2); if (!e) return false; e.click(); return true; }, sel);
  const trace = async (w) => { if (process.env.SHDBG) console.log('    ' + w + ' -> ' + JSON.stringify(await p.evaluate(visibleSteps))); };
  /* WAIT, never sleep. The exists-check on a cold server took longer than a fixed
     1800ms pause, so the second press landed on a still-DISABLED button, did nothing,
     and the wizard was then driven from a step nobody was on -- a probe failure that
     read exactly like a broken app. */
  const waitFor = async (fn, arg, ms) => {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { if (await p.evaluate(fn, arg)) return true; await p.waitForTimeout(200); }
    return false;
  };
  const waitStep = (id) => waitFor((i) => {
    const e = document.getElementById(i);
    if (!e || e.classList.contains('hidden')) return false;
    const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10;
  }, id);

  const email = 'handoff' + W.name + Date.now() + '@example.com';
  const handle = 'handoff' + W.name + String(Date.now()).slice(-6);

  await p.goto(`http://localhost:${PORT}/signup`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);

  /* Into the wizard. The email step checks the address FIRST and relabels its own
     button, so it takes two presses -- an earlier script stalled here for that. */
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((e) => /Continue with Email/i.test(e.textContent));
    if (btn) btn.click();
  });
  await p.waitForTimeout(1000);
  await p.evaluate((e) => { const f = document.getElementById('loginEmailAddr'); f.focus(); f.value = e; f.dispatchEvent(new Event('input', { bubbles: true })); }, email);
  await p.waitForTimeout(400);
  await tap('#emailStepBtn');
  ok(await waitFor(() => document.getElementById('emailStepBtn').classList.contains('is-create')),
    L + 'an address nobody has used offers to create an account');
  await tap('#emailStepBtn');
  ok(await waitStep('suTypeStep'), L + 'and that opens the create-account wizard');
  await trace('type');
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#suTypeStep button')].find((e) => /myself|personal/i.test(e.textContent)); if (b2) b2.click(); });
  await waitStep('suSendStep');

  const before = out.length;
  await trace('send'); await tap('#suSendBtn'); await waitStep('suCodeStep');
  let code = null;
  for (let i = 0; i < 24 && !code; i++) {
    const m = /verification code is:?\s*(\d{6})/.exec(out.slice(before));
    if (m) code = m[1]; else await p.waitForTimeout(500);
  }
  if (!code) { ok(false, L + 'a real 6-digit code was produced'); await ctx.close(); return { errs }; }
  await p.evaluate((c) => {
    const boxes = [...document.querySelectorAll('#suCodeStep .otp-box')];
    boxes.forEach((b2, i) => { b2.value = c[i]; b2.dispatchEvent(new Event('input', { bubbles: true })); });
  }, code);
  ok(await waitStep('suDobStep'), L + 'the code is accepted and the wizard moves on');

  /* Birthday is a WHEEL picker, not selects -- it opens on a usable default. */
  await trace('dob'); await tap('#suDobBtnContinue'); await waitStep('suNameStep');
  await p.evaluate(() => { const f = document.getElementById('suName'); f.focus(); f.value = 'Handoff Test'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(400); await tap('#suNameStep .auth-continue'); await waitStep('suPassStep');
  await p.evaluate(() => { const f = document.getElementById('suPass'); f.focus(); f.value = 'Handoff!Pass2026'; f.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(400); await tap('#suPassStep .auth-continue'); await waitStep('suUserStep');
  await p.evaluate((h) => { const f = document.getElementById('suUser'); f.focus(); f.value = h; f.dispatchEvent(new Event('input', { bubbles: true })); }, handle);
  await waitFor(() => { const b3 = document.querySelector('#suUserStep .auth-continue'); return b3 && !b3.disabled && !b3.classList.contains('is-empty'); });
  await tap('#suUserStep .auth-continue'); await waitStep('suCatStep');
  await trace('cat'); await tap('#suCatBtn'); await waitStep('suPhotoStep');

  /* THE FAILURE RULE. "Do not hide the signup UI prematurely": the wizard may only be
     dismissed after a CONFIRMED success, so a refused create-account request has to
     leave the member exactly where they were, holding no session. Driven by failing the
     real route in flight, which is the only way to reach the catch branch honestly. */
  if (opts.failFinish) {
    await p.route('**/api/auth/signup/finish', (route) => route.fulfill({
      status: 500, contentType: 'application/json',
      body: JSON.stringify({ error: 'Something went wrong on our side.' }),
    }));
  }

  /* A. the final step, before submission */
  const atPhoto = await p.evaluate(visibleSteps);
  ok(atPhoto.length === 1 && atPhoto[0] === 'suPhotoStep', L + 'A. the last wizard step is the one on screen before submitting', JSON.stringify(atPhoto));
  const photoSeen = await p.evaluate(ownsItsCentre, 'suPhotoStep');
  ok(photoSeen.inside === true, L + 'A2. and it is what you SEE, not something painted over it', JSON.stringify(photoSeen));

  /* B. submit */
  const t0 = Date.now();
  await tap('#suPhotoSkip');

  if (opts.failFinish) {
    await p.waitForTimeout(5000);
    const after = await p.evaluate(snapshot);
    const stepOwns = await p.evaluate(ownsItsCentre, 'suPhotoStep');
    ok(after.steps.length > 0, L + 'a refused signup leaves the wizard exactly where it was', JSON.stringify(after));
    ok(stepOwns.inside === true, L + '...and it is still the thing on screen', JSON.stringify(stepOwns));
    ok(!after.open.includes('suSplash'), L + '...no success splash', JSON.stringify(after.open));
    ok(!after.open.includes('onboardingFlow'), L + '...no onboarding', JSON.stringify(after.open));
    ok(!after.open.includes('suPremium'), L + '...no Pro pitch', JSON.stringify(after.open));
    ok(after.tok === false, L + '...and nobody is falsely signed in', String(after.tok));
    const btn = await p.evaluate(() => { const b3 = document.getElementById('suPhotoSkip'); return b3 ? { dis: !!b3.disabled, busy: b3.className.includes('loading') } : null; });
    ok(!!(btn && !btn.dis), L + '...and they can try again', JSON.stringify(btn));
    ok(errs.length === 0, L + '...with no JS errors', errs[0]);
    await ctx.close();
    return { errs };
  }

  /* ONE watch, from the moment of success to ten seconds later. Everything after the
     handoff is judged from it, and that is deliberate: an earlier version waited for
     onboarding FIRST and only then started the ten-second watch, so on a build where
     onboarding never opens the wait ate the whole window and the "the Pro pitch never
     appears" check passed while the Pro pitch was on screen. A watch that can be
     starved by the failure it sits next to is not a watch. */
  let splashSeen = null, stepSamples = [], premiumSamples = [], obAt = 0, obSeen = null, goalHit = null;
  let confirmed = 0;   // the moment the account is confirmed -- NOT the moment of the tap
  const timeline = [];
  while (Date.now() - t0 < 11000) {
    const s = await p.evaluate(snapshot);
    /* The wizard is SUPPOSED to stand until the create-account request comes back --
       that is the whole failure rule ("do not hide the signup UI prematurely"). So the
       step is only a fault from the moment success is visible. */
    if (!confirmed && (s.tok || s.open.includes('suSplash'))) confirmed = Date.now();
    if (s.open.includes('suSplash') && (!splashSeen || !splashSeen.inside)) splashSeen = await p.evaluate(ownsItsCentre, 'suSplash');
    if (confirmed && s.steps.length) stepSamples.push(Math.round((Date.now() - t0) / 100) / 10 + ':' + s.steps.join('+'));
    if (s.open.includes('suPremium')) premiumSamples.push(Math.round((Date.now() - t0) / 100) / 10);
    if (s.open.includes('onboardingFlow') && !obAt) {
      obAt = Date.now() - t0;
      obSeen = await p.evaluate(ownsItsCentre, 'onboardingFlow');
      goalHit = await p.evaluate(() => {
        const g = document.querySelector('#onboardingFlow .ob-goal');
        if (!g) return { none: true };
        const r = g.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { hit: !!(at && g.contains(at)), top: at ? (at.id || at.className || at.tagName) : null };
      });
    }
    if (process.env.SHDBG) timeline.push(Math.round((Date.now() - t0) / 100) / 10 + 's open=[' + s.open.join('+') + '] steps=[' + s.steps.join('+') + '] centre=' + s.centre);
    await p.waitForTimeout(180);
  }
  if (process.env.SHDBG) timeline.filter((_, i) => i % 5 === 0).forEach((l) => console.log('    | ' + l));

  ok(!!(splashSeen && splashSeen.shown), L + 'C. the success splash appears', JSON.stringify(splashSeen));
  ok(!!(splashSeen && splashSeen.inside), L + 'C2. and it is what you SEE -- not buried under the finished step', JSON.stringify(splashSeen));
  ok(stepSamples.length === 0, L + 'D. no signup step is left standing from the moment success shows', stepSamples.slice(0, 4).join(' '));

  const token = await p.evaluate(() => localStorage.getItem('atwe_token'));
  ok(!!token, L + 'B. the account is really created and the session is live');
  let me = null;
  if (token) {
    const r = await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) me = await r.json();
  }
  ok(!!(me && me.user && me.user.id), L + 'B2. and the server agrees the account exists', JSON.stringify(me && me.user ? { u: me.user.username } : me));

  ok(obAt > 0, L + 'E. onboarding opens by itself, in the same session, with no reload', 'not within 11s');
  ok(!!(obSeen && obSeen.inside), L + 'F. onboarding is what you SEE and could press', JSON.stringify(obSeen));
  ok(!!(goalHit && goalHit.hit), L + 'F2. a real goal card is under the finger, not a leftover layer', JSON.stringify(goalHit));
  ok(premiumSamples.length === 0, L + 'H. the Atwe Pro pitch never appears on the signup path', premiumSamples.join(','));
  ok(obAt > 0 && obAt < 6000, L + 'H2. and it arrives promptly rather than after a long dead screen', obAt + 'ms');

  /* G. finish onboarding and land in the app */
  await p.evaluate(() => { const g = document.querySelector('#onboardingFlow .ob-goal'); if (g) g.click(); });
  await p.waitForTimeout(1400);
  for (const s of ['topics', 'people', 'done']) {
    await p.evaluate(() => {
      const st = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((e) => !e.classList.contains('hidden'));
      const n = st && st.querySelector('.ob-next'); if (n) n.click();
    });
    await p.waitForTimeout(1400);
  }
  await p.waitForTimeout(1600);
  const landed = await p.evaluate(() => ({
    ob: !document.getElementById('onboardingFlow').classList.contains('hidden'),
    /* The home feed screen is #acHomeScreen -- there is no #homeScreen, and asking for
       one reports "not in the app" on a screen that is plainly there. */
    home: (() => { const h = document.getElementById('acHomeScreen'); if (!h || h.classList.contains('hidden')) return false; const r = h.getBoundingClientRect(); return r.width > 10 && r.height > 10; })(),
    steps: [...document.querySelectorAll('.auth-step')].filter((e) => !e.classList.contains('hidden') && e.getBoundingClientRect().width > 10).map((e) => e.id),
  }));
  ok(landed.ob === false && landed.home === true && landed.steps.length === 0,
    L + 'G. finishing onboarding lands in the normal app', JSON.stringify(landed));

  ok(errs.length === 0, L + 'I. no JS errors anywhere in the journey', errs[0]);

  /* scratchpad/out/ is gitignored; the scratchpad root is not, and a probe that litters
     the repo with artefacts turns every later `git status` into noise. */
  try { require('fs').mkdirSync(path.join(__dirname, 'out'), { recursive: true }); } catch (e) {}
  await p.screenshot({ path: path.join(__dirname, 'out', 'signuphandoff-' + W.name + '.png') }).catch(() => {});
  await ctx.close();
  return { errs };
}

(async () => {
  if (!await waitUp()) { console.log('  FAIL the test server never came up\n' + out.slice(-800)); stop(); process.exit(1); }
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    for (const W of WIDTHS) { console.log('\n-- ' + W.w + 'x' + W.h + ' --'); await journey(b, W); }
    console.log('\n-- a REFUSED signup (390x844) --');
    await journey(b, { ...WIDTHS[0], name: '390' }, { failFinish: true, label: 'refused' });
  } catch (e) {
    ok(false, 'the probe itself threw', String(e).slice(0, 300));
  }
  await b.close(); stop();
  console.log('\n' + pass + ' passed, ' + fails.length + ' FAILED');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(fails.length ? 1 : 0);
})();
