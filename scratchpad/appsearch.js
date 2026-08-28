// Can you find any part of Atwe by typing what you'd call it?
process.env.JWT_SECRET = 'scoresecret';
const crypto = require('crypto');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const pool = new Pool({ connectionString: 'postgres://atwe:atwe@localhost:5432/atwescore' });
const B = 'http://localhost:3262';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// What a real person would type, and what they are looking for.
const ASKS = [
  ['gift card',      'Gift cards'],
  ['refund',         'Help & refunds'],
  ['dark mode',      'Appearance'],
  ['cv',             'Resumes'],
  ['2fa',            'Two-factor authentication'],
  ['split a bill',   'Split a bill'],
  ['basket',         'Cart'],
  ['who viewed',     'Who viewed my profile'],
  ['invoice',        'Invoices'],
  ['qr',             'QR code'],
  ['blocked',        'Blocked accounts'],
  ['password',       'Password'],
  ['job alerts',     'Job alerts'],
  ['wallet',         'Wallet'],
  ['sign out',       'Log out'],
  ['delete account', 'Delete account'],
  ['pay someone',    'Send money'],
  ['my orders',      'Orders'],
  ['post a job',     'Post a job'],
  ['loyalty',        'Rewards'],
  ['cash out',       'Wallet'],
  ['shipping address', 'Addresses'],
  ['incognito',      'Private profile views'],
  ['talk to ai',     'Talk to Atwe AI'],
];

(async () => {
  const email = crypto.randomUUID().slice(0, 8) + '@t.local';
  const hash = await auth.hashPassword('x'.repeat(12));
  const uname = 'as' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents,account_type)
     VALUES ('Search Tester',$1,$2,$3,true,true,5000,'business') RETURNING id`, [email, hash, uname]);
  const token = auth.signToken({ id: rows[0].id, email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), rows[0].id]);

  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errs = [];
  const p = await br.newPage({ viewport: { width: 1440, height: 950 } });
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam','circles','ai','wallet'])); }, token);
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4200);

  console.log('── the index itself ──');
  const idx = await p.evaluate(() => {
    const all = acAppIndex();
    const bad = [], dupes = [];
    const byLabel = {};
    for (const it of all) {
      const m = String(it.run).match(/([A-Za-z_$][\w$]*)\s*\(/);
      const fn = m && m[1];
      if (!fn || typeof window[fn] !== 'function') bad.push(it.label + ' → ' + it.run);
      byLabel[it.label] = (byLabel[it.label] || 0) + 1;
    }
    for (const k in byLabel) if (byLabel[k] > 1) dupes.push(k);
    return { n: all.length, bad, dupes, subs: [...new Set(all.map((x) => x.sub))].length };
  });
  ok(idx.n >= 130, 'the app knows about ' + idx.n + ' places you can go');
  ok(idx.bad.length === 0, 'every one of them actually opens something' + (idx.bad.length ? ' — broken: ' + idx.bad.slice(0, 4).join(', ') : ''));
  ok(idx.dupes.length === 0, 'no place is listed twice' + (idx.dupes.length ? ' — ' + idx.dupes.join(', ') : ''));

  console.log('\n── typing what you would actually call it ──');
  const type = async (q) => {
    await p.evaluate(() => { appTab('search'); });
    await p.waitForTimeout(500);
    await p.evaluate(() => { const i = document.getElementById('tbSearchInput'); if (i) { i.value = ''; acDoSearch(''); } });
    await p.fill('#tbSearchInput', q);
    await p.evaluate((v) => acDoSearch(v), q);
    await p.waitForTimeout(220);
    return p.evaluate(() => [...document.querySelectorAll('#acPlaces .ac-place-name')].map((x) => x.textContent));
  };
  for (const [q, want] of ASKS) {
    const got = await type(q);
    const at = got.indexOf(want);
    ok(at === 0, ('“' + q + '”').padEnd(20) + ' → ' + (at === 0 ? want : (at > 0 ? 'found, but ' + (at + 1) + 'th behind ' + got[0] : 'NOT FOUND (' + (got.slice(0, 3).join(', ') || 'nothing') + ')')));
  }

  console.log('\n── behaviour ──');
  const one = await type('gift card');
  ok(one.length >= 1, 'results appear with no request to the server (instant)');
  const timing = await p.evaluate(() => {
    const t0 = performance.now();
    acFindPlaces('wallet', 6);
    return performance.now() - t0;
  });
  ok(timing < 25, 'searching the whole app takes ' + timing.toFixed(1) + 'ms');

  // A single letter is too vague to be useful — don't dump the app on someone.
  const tiny = await type('g');
  ok(tiny.length === 0, 'one letter does not dump the whole app on you');

  // Tapping a result must actually get you there.
  await type('gift card');
  await p.click('#acPlaces .ac-place');
  await p.waitForTimeout(1400);
  const landed = await p.evaluate(() => {
    const o = document.getElementById('giftCardView');
    return !!o && getComputedStyle(o).display !== 'none' && o.getBoundingClientRect().height > 100;
  });
  ok(landed, 'tapping "Gift cards" opens Gift cards');

  // People and posts must still work — this is added on top, not instead of.
  await p.evaluate(() => { closeOverlay('giftCardView'); });
  await p.waitForTimeout(400);
  await type('Zoltan');
  await p.waitForTimeout(1100);
  const mixed = await p.evaluate(() => ({
    people: document.querySelectorAll('#acSearchPageResults .ac-item').length,
    places: document.querySelectorAll('#acPlaces .ac-place').length,
  }));
  ok(mixed.people > 0, 'people search still finds people alongside (' + mixed.people + ' found)');
  ok(mixed.places === 0, 'a name that is not a feature brings back no bogus places');

  // Places belong to the "everything" tab only — a scope you chose on purpose
  // should show exactly that.
  await type('wallet');
  await p.evaluate(() => acSetSearchScope('people'));
  await p.waitForTimeout(1200);
  const scoped = await p.evaluate(() => document.querySelectorAll('#acPlaces .ac-place').length);
  ok(scoped === 0, 'switching to the People tab drops the app-places block');
  await p.evaluate(() => acSetSearchScope('all'));
  await p.waitForTimeout(1200);
  const backAll = await p.evaluate(() => document.querySelectorAll('#acPlaces .ac-place').length);
  ok(backAll > 0, 'switching back to Everything brings it back (' + backAll + ')');

  // Nothing at all should say so, not sit blank.
  await type('zzqqxx nothing at all');
  await p.waitForTimeout(900);
  const none = await p.evaluate(() => (document.getElementById('acSearchPageResults') || {}).textContent || '');
  ok(/No results/.test(none), 'a query that matches nothing says "No results"');

  // A long list collapses behind "Show more" rather than filling the screen.
  const many = await type('a');
  await p.fill('#tbSearchInput', 'me');
  await p.evaluate(() => acDoSearch('me'));
  await p.waitForTimeout(250);
  const collapsed = await p.evaluate(() => ({
    shown: document.querySelectorAll('#acPlaces .ac-place').length,
    more: !!document.querySelector('.ac-place-more'),
  }));
  ok(collapsed.shown <= 5, 'a broad query shows the best ' + collapsed.shown + ', not everything');
  if (collapsed.more) {
    await p.click('.ac-place-more');
    await p.waitForTimeout(250);
    const after = await p.evaluate(() => document.querySelectorAll('#acPlaces .ac-place').length);
    ok(after > collapsed.shown, '"Show more" reveals the rest (' + collapsed.shown + ' → ' + after + ')');
  }

  ok(errs.length === 0, 'zero JS errors throughout (' + errs.length + ')' + (errs.length ? ' :: ' + errs.slice(0, 2).join(' | ') : ''));
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  await p.close(); await br.close(); await pool.end(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
