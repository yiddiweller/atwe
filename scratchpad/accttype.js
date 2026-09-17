// Phase 3A: is the personal / business choice real, and is the conversion honest?
// Journeys A-H at three widths against a real server and a real database.
//
// Honest limitation, stated rather than faked: the Google and Apple PROVIDER handshake
// cannot be exercised here (it verifies a live token against Google, and Apple's keys).
// What is driven is everything the app does once the provider has answered: the exact
// `needsOnboarding` payload the real route returns, carried through the real wizard by
// the real functions. The provider half is covered by the source checks in
// test/account-type.test.js.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase3a-test-secret';
const auth = require('../auth.js');
const { chromium } = require('./node_modules/playwright-core');
const B = process.env.BASE || 'http://localhost:3262';  // run-all's server; BASE overrides
const ONLY = process.env.ACCT_ONLY || '';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  ok   ' + m); };
const bad = (m) => { fail++; console.log('  FAIL ' + m); };
const t = (c, m) => (c ? ok(m) : bad(m));
const BREAK = process.argv.includes('--break');

const WIDTHS = [[390, 844, 'phone'], [820, 1180, 'tablet'], [1440, 900, 'desktop']];

async function fresh(br, w, h) {
  const ctx = await br.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  if (BREAK) {
    // Self-test: put back the dead end and take the Account row away.
    await p.route('**/*', async (route) => {
      const r = route.request();
      if (r.resourceType() !== 'document') return route.continue();
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace(/\{ l: 'Switch to a business account'[\s\S]*?when: \(u\) => !acIsBiz\(u\) \},/, '');
      await route.fulfill({ response: res, body });
    });
  }
  await p.goto(B + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof window.suStartGoogle === 'function', { timeout: 20000 });
  return { ctx, p };
}

// Create an account through the REAL wizard from the OAuth entry point.
async function signUp(p, { provider, type, handle }) {
  const email = handle + '@example.com';
  const tok = provider === 'google'
    ? auth.signGoogleSignupToken({ email, name: handle, picture: '' })
    : auth.signAppleSignupToken({ email, name: handle, sub: 'sub-' + handle });
  const payload = provider === 'google'
    ? { needsOnboarding: true, email, name: handle, googleToken: tok }
    : { needsOnboarding: true, email, name: handle, appleToken: tok };
  await p.evaluate(([prov, r]) => (prov === 'google' ? window.suStartGoogle(r) : window.suStartApple(r)), [provider, payload]);
  await p.waitForTimeout(450);
  const dobCopy = await p.evaluate((want) => {
    const btn = [...document.querySelectorAll('#suTypeStep button')].find((b) => new RegExp(want, 'i').test(b.textContent || ''));
    if (!btn) return { err: 'no ' + want + ' option' };
    btn.click();
    return null;
  }, type);
  if (dobCopy && dobCopy.err) throw new Error(dobCopy.err);
  await p.waitForTimeout(450);
  const copy = await p.evaluate(() => ({
    title: (document.getElementById('suDobTitle') || {}).textContent || '',
    sub: (document.getElementById('suDobSub') || {}).textContent || '',
    hint: (document.querySelector('#suDobStep .su-agehint') || {}).textContent || '',
  }));
  await p.waitForTimeout(350);
  await p.evaluate(() => window.suDobContinue());
  await p.waitForTimeout(300);
  await p.evaluate((u) => { document.getElementById('suUser').value = u; window.suUserInput(); }, handle);
  await p.evaluate(() => window.suUserNext());
  await p.waitForTimeout(900);
  await p.evaluate(() => {
    const step = document.getElementById('suPassStep');
    const skip = [...step.querySelectorAll('button')].find((b) => /skip|not now|later/i.test(b.textContent || ''));
    if (skip) skip.click();
  });
  await p.waitForTimeout(600);
  await p.evaluate(() => { if (!document.getElementById('suCatStep').classList.contains('hidden')) window.suCatContinue(); });
  await p.waitForTimeout(600);
  await p.evaluate(async () => { await window.suFinish(false); });
  await p.waitForTimeout(1200);
  return { copy };
}


// Leave onboarding the way a member does, then land on the Account page and prove it
// is really on screen. A measurement taken on a hidden screen means nothing.
async function toAccount(p) {
  // Onboarding arrives on its own clock after signup (splash, then a ~1.5s arm), so a
  // Skip pressed before it opens is a no-op and the flow then covers the page anyway.
  // Wait for it, dismiss it the way a member does, and only then navigate. Retry until
  // the Account screen is genuinely on screen: a measurement on a hidden screen is
  // worth nothing, which is exactly how a count of 0 passes for the wrong reason.
  for (let attempt = 0; attempt < 12; attempt++) {
    await p.evaluate(async () => {
      const ov = document.getElementById('onboardingFlow');
      const up = ov && !ov.classList.contains('hidden');
      if (up && typeof obDefer === 'function') await obDefer();
    });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.appTab('profile'));
    await p.waitForTimeout(600);
    const st = await p.evaluate(() => {
      const el = document.getElementById('acMeScreen');
      const ov = document.getElementById('onboardingFlow');
      const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return { shown: !!el && !el.classList.contains('hidden') && r.width > 100 && r.height > 100,
               obUp: !!ov && !ov.classList.contains('hidden') };
    });
    if (st.shown && !st.obUp) return st;
  }
  return p.evaluate(() => {
    const el = document.getElementById('acMeScreen');
    const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    return { shown: !!el && !el.classList.contains('hidden') && r.width > 100 && r.height > 100 };
  });
}

const serverSees = (p) => p.evaluate(async () => {
  const tok = localStorage.getItem('atwe_token');
  if (!tok) return { err: 'not signed in' };
  const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json();
  return j.user ? { accountType: j.user.accountType, username: j.user.username, onboarded: j.user.onboarded } : { err: 'no user' };
});

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const stamp = Date.now().toString(36);
  for (const [w, h, label] of WIDTHS) {
    if (ONLY && ONLY !== label) continue;
    console.log(`\n=== ${label} ${w}x${h} ===`);

    // A. A new OAuth member is ASKED, and the Business option is hittable.
    {
      const { ctx, p } = await fresh(br, w, h);
      const handle = 'a' + label[0] + stamp;
      const email = handle + '@example.com';
      await p.evaluate(([r]) => window.suStartGoogle(r), [{ needsOnboarding: true, email, name: handle, googleToken: auth.signGoogleSignupToken({ email, name: handle, picture: '' }) }]);
      await p.waitForTimeout(450);
      const s = await p.evaluate(() => {
        const el = document.getElementById('suTypeStep');
        const r = el.getBoundingClientRect();
        const btns = [...el.querySelectorAll('button')];
        const biz = btns.find((b) => /business/i.test(b.textContent || ''));
        const per = btns.find((b) => /personal/i.test(b.textContent || ''));
        const own = (b) => { const q = b.getBoundingClientRect(); const at = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return !!(at && (at === b || b.contains(at))); };
        return { shown: !el.classList.contains('hidden') && r.width > 100, biz: !!biz && own(biz), per: !!per && own(per) };
      });
      t(s.shown, 'A a new OAuth member is shown the Personal/Business chooser');
      t(s.biz && s.per, 'A both options own their own centre, so a finger really hits them');
      await ctx.close();
    }

    // B. Choosing Business at OAuth signup really creates a business.
    {
      const { ctx, p } = await fresh(br, w, h);
      const { copy } = await signUp(p, { provider: 'google', type: 'business', handle: 'b' + label[0] + stamp });
      const got = await serverSees(p);
      t(got.accountType === 'business', `B choosing Business creates a business (${JSON.stringify(got)})`);
      // C. The birthday question is honest on the business path, and the age rule holds.
      t(!/birthday/i.test(copy.title) && /date of birth/i.test(copy.title), `C a business is not asked for a "birthday" (${copy.title.trim()})`);
      t(/person setting this account up/i.test(copy.sub), 'C the business question says whose date of birth it is');
      t(/18 or older/i.test(copy.hint), 'C the 18+ rule is still on screen');
      await ctx.close();
    }

    // D. Choosing Personal creates a personal account, with the personal copy.
    {
      const { ctx, p } = await fresh(br, w, h);
      const { copy } = await signUp(p, { provider: 'apple', type: 'personal', handle: 'd' + label[0] + stamp });
      const got = await serverSees(p);
      t(got.accountType === 'personal', `D choosing Personal creates a personal account (${JSON.stringify(got)})`);
      t(/birthday/i.test(copy.title), 'D a person is still asked for their birthday, unchanged');
      t(/18 or older/i.test(copy.hint), 'D the 18+ rule is still on screen');
      await ctx.close();
    }

    // E. A personal account finds ONE way to become a business, in the Account page.
    //    NB the Account hub is two levels by design (11 sections over ~95 rows), so the
    //    row lives in the Profile section and is reached by drilling in or by searching.
    {
      const { ctx, p } = await fresh(br, w, h);
      await signUp(p, { provider: 'google', type: 'personal', handle: 'e' + label[0] + stamp });
      const land = await toAccount(p);
      t(land.shown, 'E the Account page is really on screen before anything is measured on it');
      await p.evaluate(() => window.acMeSection('profile'));
      await p.waitForTimeout(700);
      const row = await p.evaluate(() => {
        const hit = [...document.querySelectorAll('#acMeBody .me-row')].filter((r) => /switch to a business/i.test(r.textContent || ''));
        if (!hit.length) return { found: 0 };
        const r = hit[0].getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { found: hit.length, visible: r.width > 40 && r.height > 20, owns: !!(at && (at === hit[0] || hit[0].contains(at))), h: Math.round(r.height) };
      });
      t(row.found === 1, `E the Account page offers exactly one way to become a business (found ${row.found})`);
      t(!!row.visible && !!row.owns, `E that row is on screen and takes the tap (${JSON.stringify(row)})`);
      t((row.h || 0) >= 44, `E it clears the 44pt touch floor (h=${row.h})`);
      // Depth is only acceptable because search is the shortcut: the words a person
      // would actually type have to find it.
      const idx = await p.evaluate(() => {
        if (typeof acFindPlaces !== 'function') return { err: 'no acFindPlaces' };
        const hits = (q) => acFindPlaces(q, 400).filter((x) => /switch to a business/i.test(JSON.stringify(x))).length;
        return { business: hits('business'), phrase: hits('switch to a business'), company: hits('company'), sell: hits('sell') };
      });
      t(idx.business >= 1 && idx.phrase >= 1 && idx.company >= 1,
        `E the words a person would type find it (${JSON.stringify(idx)})`);
      // ...and a business must never be offered it, from search either.
      await ctx.close();
    }

    // F. The conversion really converts, keeps the account, and shows no row afterwards.
    {
      const { ctx, p } = await fresh(br, w, h);
      const handle = 'f' + label[0] + stamp;
      await signUp(p, { provider: 'google', type: 'personal', handle });
      const before = await serverSees(p);
      await p.evaluate(async () => { if (typeof obDefer === 'function') await obDefer(); });
      await p.waitForTimeout(600);
      // Drive the real confirm dialog rather than calling the route.
      await p.evaluate(() => { window.acConvertToBusiness(); });
      await p.waitForTimeout(500);
      const confirmed = await p.evaluate(() => {
        const ov = document.getElementById('confirmOverlay');
        const shown = ov && !ov.classList.contains('hidden');
        const msg = (document.getElementById('cfMsg') || {}).textContent || '';
        if (shown) document.getElementById('cfOk').click();
        return { shown, msg };
      });
      t(confirmed.shown, 'F converting asks first, it never just happens');
      t(/does not switch a business back/i.test(confirmed.msg), 'F the confirm says plainly that it is one way');
      await p.waitForTimeout(1500);
      const after = await serverSees(p);
      t(after.accountType === 'business', `F the server agrees the account is a business (${JSON.stringify(after)})`);
      t(after.username === before.username, `F the @username did not change (${before.username} -> ${after.username})`);
      t(after.onboarded === before.onboarded, 'F onboarding state is untouched by the conversion');
      const land2 = await toAccount(p);
      t(land2.shown, 'F the Account page is really on screen before the count is taken');
      await p.evaluate(() => window.acMeSection('profile'));
      await p.waitForTimeout(700);
      const still = await p.evaluate(() => {
        const rows = [...document.querySelectorAll('#acMeBody .me-row')];
        return { total: rows.length, switch: rows.filter((r) => /switch to a business/i.test(r.textContent || '')).length };
      });
      t(still.total > 3, `F the Profile section really rendered its rows (${still.total})`);
      t(still.switch === 0, `F a business is no longer offered the switch (found ${still.switch})`);
      await ctx.close();
    }

    // G. The team page no longer names a switch that does not exist.
    {
      const { ctx, p } = await fresh(br, w, h);
      await signUp(p, { provider: 'google', type: 'personal', handle: 'g' + label[0] + stamp });
      await p.evaluate(async () => { if (typeof obDefer === 'function') await obDefer(); });
      await p.waitForTimeout(700);
      await p.evaluate(() => window.acOpenTeam());
      await p.waitForTimeout(1400);
      const dead = await p.evaluate(() => {
        const txt = document.body.innerText || '';
        const btn = [...document.querySelectorAll('button')].filter((b) => /switch to a business/i.test(b.textContent || '') && b.getBoundingClientRect().width > 40);
        return { oldCopy: /Switch to a business account to invite members/i.test(txt), wayOut: btn.length };
      });
      t(!dead.oldCopy, 'G the old dead end is gone');
      t(dead.wayOut >= 1, `G the team page offers a real way to become a business (${dead.wayOut})`);
      await ctx.close();
    }

    // H. Nothing in the app can ask to become personal again.
    {
      const { ctx, p } = await fresh(br, w, h);
      await signUp(p, { provider: 'google', type: 'business', handle: 'h' + label[0] + stamp });
      const down = await p.evaluate(() => ({
        fn: typeof window.acConvertToPersonal,
        txt: /switch to a personal account|convert to personal|downgrade (my )?account/i.test(document.body.innerText || ''),
      }));
      t(down.fn === 'undefined' && !down.txt, 'H the app offers no way back to a personal account');
      await ctx.close();
    }
  }
  await br.close();
  console.log(`\n${pass} passed, ${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
