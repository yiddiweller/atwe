/* EVERY ADMIN TAB MUST ACTUALLY REACH ITS ROUTE.
 *
 * `api(method, path, body)` — and ten later-written call sites across FIVE tabs
 * (Storage, Cluster, Webinars, App reviews, Advances) passed the PATH first. So
 * `api('/api/admin/storage')` called `fetch(undefined)` and `api('…/test','POST',{})`
 * called `fetch('POST')`. Every one of those tabs showed "Could not check." /
 * "Could not load." and had never once reached its (perfectly good) server route.
 * The owner reported it as a broken Storage page; it was five broken pages.
 *
 * Nothing caught it because no probe opened an admin tab and looked. This does two
 * things, and the second is the general one:
 *   1) render each view and assert it is not showing its failure line;
 *   2) require each render to have ACTUALLY ASKED THE SERVER — at least one request
 *      to /api/ while it ran.
 * (2) is the general one: a tab that loads data and makes no request is broken however
 * it happens to fail. Watching for a bogus URL instead would NOT have caught this —
 * `fetch` validates the method name and throws a TypeError on `/api/admin/storage`
 * before any request exists, so there is nothing on the wire to inspect. The absence
 * of a request is the signal, not the presence of a wrong one.
 *
 * Self-test: swap the arguments back at any one call site and this goes red twice.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const crypto = require('crypto');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m, extra) => { if (c) ok++; else fails.push(m + (extra ? ' — ' + extra : '')); };

const VIEWS = [
  ['Storage',     'renderStorageView'],
  ['Cluster',     'renderClusterView'],
  ['Webinars',    'renderWebinarsAdmin'],
  ['App reviews', 'renderAppReviews'],
  ['Advances',    'renderAdvancesAdmin'],
];
const DEAD = /Could not check|Could not load|could not run/i;

(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
  const auth = require('/home/user/atwe/auth.js');
  const { Pool } = require('/home/user/atwe/node_modules/pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const u = (await pool.query('SELECT id,email,is_admin FROM users WHERE is_admin LIMIT 1')).rows[0];
  chk(!!u, 'an admin account to sign in as');
  if (!u) { console.log('0 checks'); process.exit(1); }
  const tok = auth.signToken(u);
  await pool.query(
    'INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [crypto.createHash('sha256').update(tok).digest('hex'), u.id, 'admintabs', '127.0.0.1']);

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();

  let seen = [];
  p.on('request', (r) => { seen.push(r.method() + ' ' + r.url()); });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  // `let token = localStorage.getItem('atwe_token')` runs at load, so the token has to
  // be in storage BEFORE the page boots — assigning window.token afterwards cannot
  // rebind a `let`, and every request then goes out as `Bearer undefined` (401), which
  // renders the exact failure line this probe is looking for. It reported five red
  // checks on correct code before this was understood.
  await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
  await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  for (const [label, fn] of VIEWS) {
    seen = [];
    const r = await p.evaluate(async (f) => {
      const c = document.getElementById('content');
      if (typeof window[f] !== 'function') return { missing: true };
      c.innerHTML = '';
      document.body.classList.add('authed');
      try { await window[f](); } catch (e) { return { threw: String(e) }; }
      await new Promise((r) => setTimeout(r, 900));
      return { txt: (c.innerText || '').trim().slice(0, 200) };
    }, fn);
    chk(!r.missing, `${label}: its render function exists`);
    chk(!r.threw, `${label}: renders without throwing`, r.threw);
    chk(r.txt !== undefined && r.txt.length > 0, `${label}: renders something`, JSON.stringify(r));
    chk(r.txt !== undefined && !DEAD.test(r.txt), `${label}: is NOT showing its failure line`, r.txt);
    const asked = seen.filter((u) => u.includes('/api/'));
    chk(asked.length > 0, `${label}: actually asked the server for its data`, seen.join(' | ') || 'no requests at all');
  }

  chk(errs.length === 0, 'no JS errors', errs.join(' | '));

  /* The Test it button is its own call site with its own argument order, and the render
     checks above never press it. With no bucket configured the HONEST answer is "It did
     not work." plus the server's reason — that proves the route was reached. "The test
     could not run." is the api()-threw path, i.e. exactly the bug this probe exists for. */
  const t = await p.evaluate(async () => {
    const c = document.getElementById('content');
    await window.renderStorageView();
    await new Promise((r) => setTimeout(r, 400));
    if (typeof window.testStorage !== 'function') return { missing: true };
    try { await window.testStorage(); } catch (e) { return { threw: String(e) }; }
    await new Promise((r) => setTimeout(r, 800));
    return { txt: (document.getElementById('storageTest') || {}).innerText || '' };
  });
  chk(!t.missing && !t.threw, 'the Test it button runs', t.threw || 'missing');
  chk(!/could not run/i.test(t.txt || ''), 'Test it reaches the route (not an api() failure)', t.txt);
  chk(/not configured|works|would be broken|did not work/i.test(t.txt || ''),
      'Test it gives a real verdict', t.txt);

  await ctx.close(); await b.close(); await pool.end();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every admin tab reaches its route');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
