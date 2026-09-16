/* POST-SIGNUP HANDOFF: the new member must reach onboarding in the SAME session.
 *
 * The defect this file exists to prevent shipped for a long time and was invisible
 * to every probe in the repo, because nothing ever asked what was ON TOP after a
 * successful signup. The layering is the whole story:
 *
 *   body > .auth-step:not(.hidden)   position:fixed, z-index 1001
 *   .overlay                         z-index 1000
 *
 * so the finished wizard step (#suPhotoStep) outranked every overlay opened after
 * it. suFinish() got a token, called suShowSplash(), and never hid the step -- so
 * the splash and everything after it were painted UNDERNEATH a dead screen. The
 * member was signed in and stranded: only a reload escaped, because boot() has its
 * own maybeStartOnboarding() call.
 *
 * The fix is one line (suHideAll() on the success path) plus taking the Atwe Pro
 * pitch out of the critical path. The invariants below are what must stay true.
 *
 * SOURCE-LEVEL ON PURPOSE. This file runs in `npm test`, which has no browser and
 * no DOM, so it asserts the SHAPE of the handoff. The live half -- a real signup
 * driven through a real browser at three widths, measuring elementFromPoint during
 * the handoff and watching ten seconds for a stale timer -- is
 * scratchpad/signuphandoff.js, which run-all.sh runs. Neither replaces the other:
 * this one can never be skipped, that one can never pass on source text alone.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

/* A top-level function's body, from its declaration to the next one. Good enough
   here and deliberately dumber than a parser: every function it is pointed at is a
   plain top-level declaration in one script block. */
function fnBody(name) {
  const re = new RegExp('\\n(?:async )?function ' + name + '\\s*\\(');
  const m = APP.match(re);
  assert.ok(m, `${name}() should exist in public/index.html`);
  const at = m.index + 1;
  const next = APP.slice(at + 1).search(/\n(?:async )?function [A-Za-z_$]/);
  return next > -1 ? APP.slice(at, at + 1 + next) : APP.slice(at);
}

/* suFinish() is one try/catch. Splitting it is what lets the success path and the
   failure path be asserted separately -- the point of the whole fix is that they
   behave differently. */
function suFinishHalves() {
  const body = fnBody('suFinish');
  const cut = body.indexOf('\n  } catch (e) {');
  assert.ok(cut > -1, 'suFinish should still be one try/catch');
  return { success: body.slice(0, cut), failure: body.slice(cut) };
}

/* ── 1. A CONFIRMED SUCCESS DISMISSES THE WIZARD ─────────────────────────── */

test('1. suFinish hides the signup wizard after a successful account creation', () => {
  const { success } = suFinishHalves();
  assert.match(success, /\bsuHideAll\(\)/,
    'the success path must take the wizard down -- a body-level .auth-step outranks every overlay');
});

test('1b. it hides the wizard only AFTER the account really exists', () => {
  const { success } = suFinishHalves();
  const req = success.lastIndexOf('await API.req(');
  const hide = success.indexOf('suHideAll()');
  assert.ok(req > -1, 'suFinish should still await the create-account request');
  assert.ok(hide > req,
    'suHideAll() must come after the awaited request, never before it -- the UI may not be dismissed on hope');
});

test('1c. it hides the wizard BEFORE the splash opens, not after', () => {
  const { success } = suFinishHalves();
  const hide = success.indexOf('suHideAll()');
  const splash = success.indexOf('suShowSplash()');
  assert.ok(splash > -1, 'suFinish should still hand off to suShowSplash()');
  assert.ok(hide > -1, 'the success path must dismiss the wizard at all');
  assert.ok(hide < splash,
    'the step must be down before anything else opens, or the splash is painted underneath it');
});

test('1d. suHideAll really hides every step, #suPhotoStep included', () => {
  const body = fnBody('suHideAll');
  assert.match(body, /SU_STEPS\.forEach\([\s\S]*classList\.add\('hidden'\)/,
    'suHideAll must add .hidden to every wizard step');
  const steps = APP.match(/const SU_STEPS = \[([^\]]+)\]/);
  assert.ok(steps, 'SU_STEPS should exist');
  assert.match(steps[1], /'suPhotoStep'/,
    'the LAST step -- the one left standing by the bug -- must be in SU_STEPS');
  /* The CSS rule only stops matching when the class is on the element itself. */
  assert.match(APP, /body > \.auth-step:not\(\.hidden\)\{/,
    'the layering rule this fix works with must still key off .hidden');
});

/* ── 2. A FAILURE CHANGES NOTHING ────────────────────────────────────────── */

test('2. a failed signup does NOT dismiss the wizard', () => {
  const { failure } = suFinishHalves();
  assert.doesNotMatch(failure, /suHideAll\(\)/,
    'the wizard must survive a failed signup -- there is nowhere else for the member to go');
});

test('2b. a failed signup does NOT open the splash or start onboarding', () => {
  const { failure } = suFinishHalves();
  assert.doesNotMatch(failure, /suShowSplash\(\)/, 'no splash on a failure');
  assert.doesNotMatch(failure, /suShowProfileSetup\(\)/, 'no handoff on a failure');
  assert.doesNotMatch(failure, /maybeStartOnboarding/, 'no onboarding on a failure');
});

test('2c. a failed signup does not authenticate anybody', () => {
  const { failure } = suFinishHalves();
  assert.doesNotMatch(failure, /onAuthSuccess/, 'a failure must never establish a session');
  assert.match(failure, /setBtnLoading\(btn, false\)/,
    'the button must be released so the member can try again');
  assert.match(failure, /suShow\('suPassStep'\)[\s\S]*suShow\('suUserStep'\)/,
    'the existing error routing back to the fixable step must be untouched');
});

/* ── 3. THE PRO PITCH IS OFF THE CRITICAL PATH, NOT DELETED ──────────────── */

test('3. the signup handoff does not open the Atwe Pro pitch', () => {
  const body = fnBody('suShowSplash');
  assert.doesNotMatch(body, /showOverlay\('suPremium'\)/,
    'a new member\'s first screen after signup is onboarding, not a price');
});

test('3b. nothing anywhere opens #suPremium on the signup path', () => {
  const opens = APP.split("showOverlay('suPremium')").length - 1;
  assert.strictEqual(opens, 0,
    'the Pro sheet must have no opener while its placement is undecided');
});

test('3c. the Pro feature is NOT deleted -- sheet and handlers are intact', () => {
  assert.match(APP, /id="suPremium"/, 'the #suPremium sheet must still exist');
  assert.match(APP, /function suPremiumUpgrade\(\)[\s\S]{0,160}upgradeToPro\(\)/,
    'suPremiumUpgrade must still upgrade');
  assert.match(APP, /function suPremiumSkip\(\)[\s\S]{0,120}suShowProfileSetup\(\)/,
    'suPremiumSkip must still continue into the app');
  assert.match(APP, /onclick="suPremiumUpgrade\(\)"/, 'the sheet\'s own buttons stay wired');
  assert.match(APP, /onclick="suPremiumSkip\(\)"/, 'the sheet\'s own buttons stay wired');
});

/* ── 4. THE SPLASH STAYS, AND IT HANDS OFF TO ONBOARDING ─────────────────── */

test('4. the existing success splash is still part of the handoff', () => {
  const body = fnBody('suShowSplash');
  assert.match(body, /showOverlay\('suSplash'\)/, 'the splash must still open');
  assert.match(body, /closeOverlay\('suSplash'\)/, 'and still close itself');
  assert.match(body, /setTimeout\([\s\S]*?, 2200\)/,
    'its existing duration is unchanged -- this task did not redesign the splash');
});

test('4b. the splash hands straight to the onboarding entry point', () => {
  const body = fnBody('suShowSplash');
  assert.match(body, /closeOverlay\('suSplash'\);\s*suShowProfileSetup\(\);/,
    'closing the splash must continue into the app in the same tick');
});

test('4c. that entry point starts the EXISTING onboarding flow', () => {
  const body = fnBody('suShowProfileSetup');
  assert.match(body, /maybeStartOnboarding\(S\.user\)/,
    'onboarding must be reached in this session, not left to a reload');
  assert.match(body, /onAuthSuccess|appTab\('home'\)/,
    'the member must land in the real app behind it');
});

test('4d. onboarding is reachable without a reload -- the session is already live', () => {
  const body = fnBody('suShowSplash');
  assert.match(body, /onAuthSuccess\(SU\._token, SU\._user\)/,
    'the splash still signs the member in behind itself, so onboarding opens on a live session');
});

/* ── 5. ONE ONBOARDING, UNCHANGED ────────────────────────────────────────── */

test('5. there is exactly one onboarding implementation', () => {
  const starts = APP.split(/\nfunction obStart\s*\(/).length - 1;
  const gates = APP.split(/\nfunction maybeStartOnboarding\s*\(/).length - 1;
  assert.strictEqual(starts, 1, 'obStart must be defined once');
  assert.strictEqual(gates, 1, 'maybeStartOnboarding must be defined once');
  assert.strictEqual(APP.split('id="onboardingFlow"').length - 1, 1,
    'there must be exactly one onboarding surface');
});

test('5b. the onboarding gate and Skip semantics are untouched', () => {
  const gate = fnBody('maybeStartOnboarding');
  assert.match(gate, /user\.onboarded !== false \|\| OB\._active\) return/,
    'onboarding still shows once, for an account that has not completed it');
  const fin = fnBody('obFinish');
  assert.match(fin, /'\/api\/onboarding\/finish'/, 'finish/skip still records itself server-side');
  assert.match(fin, /closeOverlay\('onboardingFlow'\)/, 'and still closes into the app');
});

/* ── 6. OAUTH RIDES THE SAME HANDOFF ─────────────────────────────────────── */

test('6. a new Google/Apple member goes through the same repaired path', () => {
  const { success } = suFinishHalves();
  assert.match(success, /\/api\/auth\/apple\/complete/, 'OAuth completion lives in suFinish');
  assert.match(success, /\/api\/auth\/google\/complete/, 'OAuth completion lives in suFinish');
  assert.match(success, /\/api\/auth\/signup\/finish/, 'so does the email signup');
  /* One suHideAll() after the one awaited request covers all three. */
  assert.strictEqual(success.split('suHideAll()').length - 1, 1,
    'one dismissal serves every branch -- there must not be a second, divergent copy');
});

test('6b. a RETURNING OAuth member is untouched by this change', () => {
  /* They never enter the wizard: doGoogleAuth/doAppleAuth call onAuthSuccess directly
     and only a needsOnboarding reply starts the wizard. */
  const g = fnBody('doGoogleAuth');
  assert.match(g, /if \(r\.needsOnboarding\) \{ suStartGoogle\(r\); return; \}/,
    'only a NEW Google member enters the wizard');
  assert.match(g, /await onAuthSuccess\(r\.token, r\.user\)/,
    'a returning Google member still signs straight in');
});

/* ── 7. NOTHING ELSE MOVED ───────────────────────────────────────────────── */

test('7. the signup API contract is unchanged', () => {
  const { success } = suFinishHalves();
  assert.match(success, /body = \{ email: SU\.email, code: SU\.code, name: SU\.name, password: SU\.password, dob: SU\.dob, username: SU\.username, categories: SU\.categories, accountType: SU\.accountType \}/,
    'the request body sent to /api/auth/signup/finish must not drift');
});

test('7b. the account-type behaviour was deliberately NOT touched in this phase', () => {
  assert.match(APP, /SU\.mode = provider; SU\.oauth = true; SU\.provider = provider; SU\.accountType = 'personal';/,
    'the known OAuth account-type hardcoding is left exactly as found, for its own task');
});
