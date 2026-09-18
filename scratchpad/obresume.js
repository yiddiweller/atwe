/* ONBOARDING IS RESUMABLE: complete, incomplete and DEFERRED are three states.
 *
 * "Skip" used to call the FINISH route, so pressing it did not postpone onboarding, it
 * completed it -- onboarded went true, the flow never came back, and there was no way
 * to ask for it. There was also no Back, and nothing durable anywhere: the step and the
 * chosen goal lived in one JS object and died with the tab.
 *
 * What was already durable matters as much as what was not, because it decides what
 * this probe has to prove. A topic chip writes a real `hashtag_follows` row the moment
 * it is tapped and a Follow writes a real `follows` row -- so those come back from the
 * SERVER on their own. The step and the goal are what needed a home. So the strongest
 * evidence here is a resumed session showing the topics still lit and the Done step
 * still carrying the goal that member chose, after a full logout and login.
 *
 * Everything that matters is measured as UI STATE or a real elementFromPoint, never as
 * a function call: .click() works perfectly on a buried element, which is how a whole
 * broken handoff hid from every probe in this repo once already.
 *
 * Self-test: `node obresume.js --break` serves the pre-2B page in flight (Skip wired
 * back to the finish route) and the deferral checks go red by name.
 */
const { spawn } = require('child_process');
const QA_DEFAULT_DB = require('./qa-fixture').DEFAULT_DB;  // the one place the fallback address lives
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require('playwright-core');
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.OB_PORT || 3297);
const DB = process.env.DATABASE_URL || QA_DEFAULT_DB;
const BREAK = process.argv.includes('--break');
const PASS = 'Onboard!Pass2026';

const ONLY = process.env.OB_ONLY || '';
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
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB, JWT_SECRET: process.env.JWT_SECRET || 'scoresecret',
         DB_SSL: process.env.DB_SSL || (/[?&]host=/.test(DB) ? 'false' : undefined) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => { out += d.toString(); });
srv.stderr.on('data', (d) => { out += d.toString(); });
const stop = () => { try { srv.kill('SIGKILL'); } catch (e) {} };

/* /api/config answers before db.init() has finished; a route BEHIND the gate does not. */
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

/* ── asked inside the page ──────────────────────────────────────────────────── */
const obState = () => {
  const el = document.getElementById('onboardingFlow');
  const open = !!(el && !el.classList.contains('hidden'));
  const step = open ? ([...document.querySelectorAll('#onboardingFlow .ob-step')]
    .find((s) => !s.classList.contains('hidden')) || {}).getAttribute
    ? [...document.querySelectorAll('#onboardingFlow .ob-step')].find((s) => !s.classList.contains('hidden')).getAttribute('data-ob') : null : null;
  const back = document.getElementById('obBack');
  const skip = document.getElementById('obSkip');
  const vis = (e) => { if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), t: (e.textContent || '').trim() } : null; };
  return {
    open, step,
    back: vis(back), skip: vis(skip),
    chipsOn: [...document.querySelectorAll('#obTopics .ob-chip.on')].map((c) => c.getAttribute('data-tag')),
    chips: document.querySelectorAll('#obTopics .ob-chip').length,
    doneH: (document.getElementById('obDoneH') || {}).textContent || '',
    tok: !!localStorage.getItem('atwe_token'),
    token: localStorage.getItem('atwe_token') || '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
};
/* Is THIS element what a finger would actually hit at its own centre? .click() works
   perfectly on a buried element, so "is it open" is never the same question as "is it
   what you see". */
const ownsItsCentre = (id) => {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('hidden')) return { shown: false };
  const r = el.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return { shown: false };
  const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return { shown: true, inside: !!(at && el.contains(at)), top: at ? (at.id || at.className || at.tagName) : null };
};
const cardState = () => {
  const el = document.getElementById('acOnboardCard');
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
  return {
    present: true, inside: !!(at && el.contains(at)),
    label: (el.querySelector('.me-lbl') || {}).textContent || '',
    sub: (el.querySelector('.me-secsub') || {}).textContent || '',
    y: Math.round(r.y), h: Math.round(r.height),
  };
};

let brokeOk = false;
async function serveBroken(ctx) {
  await ctx.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    const body = await res.text();
    const b2 = body.replace('id="obSkip" onclick="obDefer()"', 'id="obSkip" onclick="obFinish()"');
    if (b2 === body) console.log('  !! --break could not find the code to revert -- the self-test is meaningless');
    else if (!brokeOk) { brokeOk = true; console.log('  (--break: serving the pre-2B page, Skip wired back to the finish route)'); }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: b2 });
  });
}

/* ── one width ──────────────────────────────────────────────────────────────── */
async function run(b, W) {
  const L = '[' + W.name + '] ';
  /* THE SERVICE WORKER MUST BE BLOCKED, and finding that out cost a green self-test.
     sw.js is network-first for navigations, and a fetch it makes is NOT intercepted by
     Playwright's routing -- so the FIRST goto in a context was served the rewritten page
     and every later one came back from the worker, unmodified. `--break` therefore
     reported 120 green against code it had genuinely reverted. Blocking it also makes
     every run measure the code that is actually being served. */
  const ctx = await b.newContext({ viewport: { width: W.w, height: W.h }, deviceScaleFactor: W.phone ? 2 : 1, isMobile: W.phone, hasTouch: W.phone, serviceWorkers: 'block' });
  if (BREAK) await serveBroken(ctx);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 180)));

  const tap = (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
  /* THE SERVER is the source of truth, and `S` is a top-level let in the page rather
     than a window property -- so asking the page would both prove the wrong thing and
     come back empty. */
  const serverState = async () => {
    const tok = await p.evaluate(() => localStorage.getItem('atwe_token') || '');
    if (!tok) return { none: true };
    const r = await fetch(`http://localhost:${PORT}/api/auth/me`, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) return { status: r.status };
    const j = await r.json();
    return { onboarded: j.user.onboarded, step: j.user.onboardStep, deferred: j.user.onboardDeferred, intent: j.user.intent, username: j.user.username };
  };
  /* The client shows the next step BEFORE the server has been told: obAdvance calls
     obStep(next) and only then awaits obSaveProgress. So waiting on the UI and then
     asserting server state is a race, and the first run after a cold start lost it
     (F0 read step:null on a working app). Poll the server for the durable write, with
     the same bounded shape as waitFor below. */
  const waitServer = async (pred, ms) => {
    const end = Date.now() + (ms || 15000);
    let last;
    for (;;) {
      last = await serverState();
      if (pred(last)) return last;
      if (Date.now() > end) return last;
      await p.waitForTimeout(150);
    }
  };
  const waitFor = async (fn, arg, ms) => {
    const end = Date.now() + (ms || 20000);
    while (Date.now() < end) { if (await p.evaluate(fn, arg)) return true; await p.waitForTimeout(200); }
    return false;
  };
  const waitStep = (id) => waitFor((i) => { const e = document.getElementById(i); if (!e || e.classList.contains('hidden')) return false; const r = e.getBoundingClientRect(); return r.width > 10 && r.height > 10; }, id);
  const waitOb = (step, ms) => waitFor((s) => {
    const el = document.getElementById('onboardingFlow');
    if (!el || el.classList.contains('hidden')) return false;
    const cur = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden'));
    return !!cur && cur.getAttribute('data-ob') === s;
  }, step, ms);

  /* A fresh account, all the way through the real wizard, ending with onboarding open. */
  async function newAccount(tag) {
    const email = 'ob' + W.name + tag + Date.now() + '@example.com';
    const handle = 'ob' + W.name + tag + String(Date.now()).slice(-6);
    /* A fresh device. Without this the PREVIOUS journey's token is still in storage and
       boot signs that account in instead, so the next journey measures the wrong row. */
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
    await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await p.goto(`http://localhost:${PORT}/signup`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4500);
    await p.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find((e) => /Continue with Email/i.test(e.textContent)); if (b2) b2.click(); });
    await p.waitForTimeout(900);
    await p.evaluate((e) => { const f = document.getElementById('loginEmailAddr'); f.focus(); f.value = e; f.dispatchEvent(new Event('input', { bubbles: true })); }, email);
    await tap('#emailStepBtn');
    await waitFor(() => document.getElementById('emailStepBtn').classList.contains('is-create'));
    await tap('#emailStepBtn');
    await waitStep('suTypeStep');
    await p.evaluate(() => { const b2 = [...document.querySelectorAll('#suTypeStep button')].find((e) => /myself|personal/i.test(e.textContent)); if (b2) b2.click(); });
    await waitStep('suSendStep');
    const before = out.length;
    await tap('#suSendBtn'); await waitStep('suCodeStep');
    let code = null;
    for (let i = 0; i < 24 && !code; i++) { const m = /verification code is:?\s*(\d{6})/.exec(out.slice(before)); if (m) code = m[1]; else await p.waitForTimeout(500); }
    if (!code) {
      const at = await p.evaluate(() => [...document.querySelectorAll('.auth-step')].filter((e) => !e.classList.contains('hidden') && e.getBoundingClientRect().width > 10).map((e) => e.id));
      throw new Error('no verification code (visible step: ' + JSON.stringify(at) + ', server said: ' + JSON.stringify(out.slice(-400)) + ')');
    }
    await p.evaluate((c) => { [...document.querySelectorAll('#suCodeStep .otp-box')].forEach((b2, i) => { b2.value = c[i]; b2.dispatchEvent(new Event('input', { bubbles: true })); }); }, code);
    await waitStep('suDobStep');
    await tap('#suDobBtnContinue'); await waitStep('suNameStep');
    await p.evaluate(() => { const f = document.getElementById('suName'); f.focus(); f.value = 'Ob Test'; f.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(300); await tap('#suNameStep .auth-continue'); await waitStep('suPassStep');
    await p.evaluate((pw) => { const f = document.getElementById('suPass'); f.focus(); f.value = pw; f.dispatchEvent(new Event('input', { bubbles: true })); }, PASS);
    await p.waitForTimeout(300); await tap('#suPassStep .auth-continue'); await waitStep('suUserStep');
    await p.evaluate((h) => { const f = document.getElementById('suUser'); f.focus(); f.value = h; f.dispatchEvent(new Event('input', { bubbles: true })); }, handle);
    await waitFor(() => { const b2 = document.querySelector('#suUserStep .auth-continue'); return b2 && !b2.disabled && !b2.classList.contains('is-empty'); });
    await tap('#suUserStep .auth-continue'); await waitStep('suCatStep');
    await tap('#suCatBtn'); await waitStep('suPhotoStep');
    await tap('#suPhotoSkip');
    await waitOb('goal');
    return { email, handle };
  }
  const goAccount = async () => { await p.evaluate(() => appTab('profile')); await p.waitForTimeout(1400); };
  const signIn = async (email) => {
    await p.evaluate(() => { const b2 = [...document.querySelectorAll('button')].find((e) => /Continue with Email/i.test(e.textContent)); if (b2) b2.click(); });
    await p.waitForTimeout(900);
    await p.evaluate((e) => { const f = document.getElementById('loginEmailAddr'); f.focus(); f.value = e; f.dispatchEvent(new Event('input', { bubbles: true })); }, email);
    await tap('#emailStepBtn');
    await waitStep('authStep2');
    await p.evaluate((pw) => { const f = document.getElementById('loginPass'); f.focus(); f.value = pw; f.dispatchEvent(new Event('input', { bubbles: true })); }, PASS);
    await p.waitForTimeout(300);
    await tap('#loginBtn');
    await waitFor(() => !!localStorage.getItem('atwe_token'), null, 25000);
    await p.waitForTimeout(3500);
  };

  /* ── A. new user, straight through ──────────────────────────────────────── */
  await newAccount('a');
  let s = await p.evaluate(obState);
  ok(s.open && s.step === 'goal', L + 'A1. signup opens onboarding at Goal', JSON.stringify({ open: s.open, step: s.step }));
  ok(s.back === null, L + 'A2. Goal has no Back -- there is nowhere behind it', JSON.stringify(s.back));
  ok(!!s.skip && /skip for now/i.test(s.skip.t), L + 'A3. and the skip action reads "Skip for now"', JSON.stringify(s.skip));
  ok(!s.overflow, L + 'A4. nothing spills sideways', String(s.overflow));

  await p.evaluate(() => document.querySelector('#onboardingFlow .ob-goal').click());
  await waitOb('topics');
  s = await p.evaluate(obState);
  ok(!!s.back && s.back.w >= 44 && s.back.h >= 44, L + 'A5. Topics has a Back at a real finger size', JSON.stringify(s.back));
  ok(!!s.skip && s.skip.h >= 44, L + 'A6. "Skip for now" clears the touch floor too', JSON.stringify(s.skip));
  const apart = s.back && s.skip && (s.skip.x >= s.back.x + s.back.w || s.back.x >= s.skip.x + s.skip.w);
  ok(apart, L + 'A7. Back and "Skip for now" are separate controls that do not overlap', JSON.stringify({ back: s.back, skip: s.skip }));
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('people');
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('done');
  s = await p.evaluate(obState);
  ok(s.skip === null, L + 'A8. the last step offers no skip -- finishing is the only move', JSON.stringify(s.skip));
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await p.waitForTimeout(2200);
  s = await p.evaluate(obState);
  let st = await waitServer((x) => x.onboarded === true);
  ok(!s.open && st.onboarded === true, L + 'A9. finishing completes onboarding and closes it', JSON.stringify(st));
  await goAccount();
  let c = await p.evaluate(cardState);
  ok(c.present === false, L + 'A10. a finished account is offered no "Continue setup"', JSON.stringify(c));

  /* ── B. skip early ──────────────────────────────────────────────────────── */
  const B = await newAccount('b');
  await p.evaluate(() => document.querySelector('#onboardingFlow .ob-goal').click());
  await waitOb('topics');
  await tap('#obSkip');
  await p.waitForTimeout(2200);
  s = await p.evaluate(obState);
  st = await serverState();
  ok(!s.open, L + 'B1. "Skip for now" closes onboarding', String(s.open));
  ok(st.onboarded === false, L + 'B2. and does NOT mark it complete', JSON.stringify(st));
  ok(st.deferred === true && st.step === 'topics', L + 'B3. it records the deferral and the progress', JSON.stringify(st));
  ok(s.tok === true, L + 'B4. the member is in Atwe, signed in', String(s.tok));

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6500);
  s = await p.evaluate(obState);
  ok(!s.open, L + 'B5. a refresh does NOT force onboarding open again', JSON.stringify({ open: s.open, step: s.step }));
  await goAccount();
  c = await p.evaluate(cardState);
  ok(c.present && /continue setup/i.test(c.label), L + 'B6. Account offers "Continue setup"', JSON.stringify(c));
  ok(/1 of 4/.test(c.sub), L + 'B7. with a truthful count of what is done', JSON.stringify(c.sub));
  ok(c.inside === true, L + 'B8. and it is what you SEE, near the top of the page', JSON.stringify(c));
  ok(c.y < W.h, L + 'B9. it is on screen without scrolling', String(c.y));
  ok(await p.evaluate(() => { const r = document.querySelector('#acOnboardCard .me-row'); if (!r) return false; r.click(); return true; }),
    L + 'B10a. there is a re-entry row to press');
  ok(await waitOb('topics'), L + 'B10. tapping it reopens the SAME flow at the unfinished step', JSON.stringify(await p.evaluate(obState)));

  /* ── C + D + E. skip midway, log out and in, Back, then finish ──────────── */
  const C = await newAccount('c');
  await p.evaluate(() => {
    const g = [...document.querySelectorAll('#onboardingFlow .ob-goal')].find((x) => /sell/i.test(x.getAttribute('onclick') || ''));
    (g || document.querySelector('#onboardingFlow .ob-goal')).click();
  });
  await waitOb('topics');
  await waitFor(() => document.querySelectorAll('#obTopics .ob-chip').length > 1);
  await p.evaluate(() => { const ch = [...document.querySelectorAll('#obTopics .ob-chip')].slice(0, 2); ch.forEach((x) => x.click()); });
  await p.waitForTimeout(1600);
  const picked = (await p.evaluate(obState)).chipsOn;
  ok(picked.length === 2, L + 'C1. two topics picked', JSON.stringify(picked));
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('people');
  await tap('#obSkip');
  await p.waitForTimeout(2200);
  s = await p.evaluate(obState);
  st = await waitServer((x) => x.deferred === true && x.step === 'people');
  ok(!s.open && st.onboarded === false && st.deferred === true && st.step === 'people',
    L + 'C2. skipping during People defers at People', JSON.stringify(st));

  await p.evaluate(() => logout());
  await p.waitForTimeout(2500);
  await signIn(C.email);
  s = await p.evaluate(obState);
  st = await serverState();
  ok(!s.open, L + 'C3. the next LOGIN does not force onboarding open either', JSON.stringify({ open: s.open, step: s.step }));
  ok(st.onboarded === false && st.deferred === true && st.step === 'people' && st.intent === 'sell',
    L + 'C4. and the whole state came back from the server', JSON.stringify(st));
  await goAccount();
  c = await p.evaluate(cardState);
  ok(c.present && /2 of 4/.test(c.sub), L + 'C5. Account offers to continue, 2 of 4 done', JSON.stringify(c));
  ok(await p.evaluate(() => { const r = document.querySelector('#acOnboardCard .me-row'); if (!r) return false; r.click(); return true; }),
    L + 'C5a. there is a re-entry row to press');
  ok(await waitOb('people'), L + 'C6. and it resumes at People, not back at step one');

  await tap('#obBack');
  ok(await waitOb('topics'), L + 'D1. Back: People to Topics');
  await waitFor(() => document.querySelectorAll('#obTopics .ob-chip').length > 1);
  await p.waitForTimeout(900);
  s = await p.evaluate(obState);
  const kept = picked.every((t) => s.chipsOn.includes(t));
  ok(kept, L + 'D2. the topics chosen before the logout are still lit', JSON.stringify({ picked, now: s.chipsOn }));
  await tap('#obBack');
  ok(await waitOb('goal'), L + 'D3. Back: Topics to Goal');
  s = await p.evaluate(obState);
  ok(s.back === null, L + 'D4. and Goal still has no Back');
  st = await serverState();
  ok(st.onboarded === false, L + 'D5. going Back completed nothing', JSON.stringify(st));

  await p.evaluate(() => {
    const g = [...document.querySelectorAll('#onboardingFlow .ob-goal')].find((x) => /sell/i.test(x.getAttribute('onclick') || ''));
    (g || document.querySelector('#onboardingFlow .ob-goal')).click();
  });
  await waitOb('topics');
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('people');
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('done');
  s = await p.evaluate(obState);
  ok(/selling/i.test(s.doneH), L + 'D6. the goal survived the skip, the logout and the Back', JSON.stringify(s.doneH));
  await tap('#obBack');
  ok(await waitOb('people'), L + 'D7. Back: Done to People');
  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await waitOb('done');

  await p.evaluate(() => { const b2 = [...document.querySelectorAll('#onboardingFlow .ob-step')].find((x) => !x.classList.contains('hidden')).querySelector('.ob-next'); if (b2) b2.click(); });
  await p.waitForTimeout(2400);
  s = await p.evaluate(obState);
  st = await waitServer((x) => x.onboarded === true && x.deferred === false && x.step === null);
  ok(!s.open && st.onboarded === true && st.deferred === false && st.step === null,
    L + 'E1. finishing after a resume completes it and retires the resume state', JSON.stringify(st));
  await goAccount();
  c = await p.evaluate(cardState);
  ok(c.present === false, L + 'E2. the Account re-entry is gone', JSON.stringify(c));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6500);
  s = await p.evaluate(obState);
  ok(!s.open, L + 'E3. and a reload does not bring onboarding back', JSON.stringify({ open: s.open }));
  await goAccount();
  c = await p.evaluate(cardState);
  ok(c.present === false, L + 'E4. nor the re-entry', JSON.stringify(c));

  /* ── F. A REFUSED "Skip for now" ────────────────────────────────────────
     "Later" is a durable decision, so only a confirmed server write may grant it. This
     drives the real failure by refusing the real route in flight: the flow must stay
     open where it was, the control must come back, nothing local may pretend, and a
     REFRESH must show the server's answer (still not deferred) rather than the
     client's wish. Then the retry succeeds and the same refresh says the opposite. */
  await newAccount('f');
  await p.evaluate(() => document.querySelector('#onboardingFlow .ob-goal').click());
  await waitOb('topics');
  st = await waitServer((x) => x.step === 'topics');
  ok(st.step === 'topics', L + 'F0. the goal is saved before the failure', JSON.stringify(st));

  await p.route('**/api/onboarding/defer', (route) => route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Could not save.' }),
  }));
  await tap('#obSkip');
  await p.waitForTimeout(2500);
  s = await p.evaluate(obState);
  st = await serverState();
  ok(s.open && s.step === 'topics', L + 'F1. a refused skip leaves the member exactly where they were', JSON.stringify({ open: s.open, step: s.step }));
  const owns = await p.evaluate(ownsItsCentre, 'onboardingFlow');
  ok(owns.inside === true, L + 'F2. and onboarding is still the thing on screen', JSON.stringify(owns));
  ok(!!s.skip && /skip for now/i.test(s.skip.t), L + 'F3. the control is back, so they can try again', JSON.stringify(s.skip));
  /* VISIBLE and enabled. Asking only about `disabled` passed on the broken build, where
     the overlay had closed and the button was merely hidden -- a control nobody can see
     is not a control they can press. */
  ok(!!s.skip && await p.evaluate(() => { const b2 = document.getElementById('obSkip'); return !!b2 && !b2.disabled; }),
    L + 'F4. and it is enabled, not left dead', JSON.stringify(s.skip));
  ok(st.deferred === false && st.onboarded === false, L + 'F5. the server did NOT defer or complete anything', JSON.stringify(st));
  ok(st.step === 'topics' && st.intent, L + 'F6. and progress already saved is intact', JSON.stringify(st));

  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6500);
  ok(await waitOb('topics', 8000) || (await p.evaluate(obState)).open,
    L + 'F7. after a refresh the SERVER wins: onboarding is offered again', JSON.stringify(await p.evaluate(obState)));

  await p.unroute('**/api/onboarding/defer');
  await tap('#obSkip');
  await p.waitForTimeout(2500);
  s = await p.evaluate(obState);
  st = await serverState();
  ok(!s.open, L + 'F8. the retry closes onboarding', String(s.open));
  ok(st.deferred === true && st.onboarded === false && st.step === 'topics',
    L + 'F9. and this time the deferral is really saved', JSON.stringify(st));
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6500);
  s = await p.evaluate(obState);
  ok(!s.open, L + 'F10. so a refresh now leaves them alone', JSON.stringify({ open: s.open }));
  await goAccount();
  c = await p.evaluate(cardState);
  ok(c.present && /continue setup/i.test(c.label), L + 'F11. and the Account re-entry is there', JSON.stringify(c));

  const stale = await p.evaluate(() => [...document.querySelectorAll('.overlay')].filter((e) => !e.classList.contains('hidden') && ['onboardingFlow', 'suSplash', 'suPremium'].includes(e.id)).map((e) => e.id));
  ok(stale.length === 0, L + 'Z1. no stale onboarding or signup overlay is left behind', JSON.stringify(stale));
  s = await p.evaluate(obState);
  ok(!s.overflow, L + 'Z2. still nothing spilling sideways at the end', String(s.overflow));
  ok(errs.length === 0, L + 'Z3. no JS errors anywhere in the journey', errs[0]);

  try { require('fs').mkdirSync(path.join(__dirname, 'out'), { recursive: true }); } catch (e) {}
  await p.screenshot({ path: path.join(__dirname, 'out', 'obresume-' + W.name + '.png') }).catch(() => {});
  await ctx.close();
}

(async () => {
  if (!await waitUp()) { console.log('  FAIL the test server never came up\n' + out.slice(-800)); stop(); process.exit(1); }
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  try {
    for (const W of WIDTHS) { if (ONLY && W.name !== ONLY) continue; console.log('\n-- ' + W.w + 'x' + W.h + ' --'); await run(b, W); }
  } catch (e) { ok(false, 'the probe itself threw', String(e).slice(0, 300)); }
  await b.close(); stop();
  console.log('\n' + pass + ' passed, ' + fails.length + ' FAILED');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(fails.length ? 1 : 0);
})();
