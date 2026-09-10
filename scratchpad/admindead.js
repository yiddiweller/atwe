/* DOES EVERY CONTROL IN THE DASHBOARD LEAD SOMEWHERE?
 *
 * `deadends.js` asks this of the app and found two whole features with no door.
 * The dashboard has never been asked. Three ways, over the WHOLE file rather than
 * screen by screen — most of admin.html is rendered from template literals, so the
 * SOURCE is what has to be read, not the DOM.
 *   1) DEAD HANDLER  — every onclick/onchange/oninput/onsubmit names a function that
 *      really exists in the page. admin.html declares things as top-level `const`
 *      too, which are NOT window properties, so each name is resolved by eval in
 *      page scope rather than by looking at `window`.
 *   2) ORPHAN VIEW   — every tab in NAV_TITLES is reachable from the sidebar AND has
 *      a branch in renderView().
 *   3) api() ORDER   — `api(method, path, body)`. A first argument beginning with `/`
 *      is always the argument-order bug that left five tabs unable to reach their
 *      routes for months.
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const crypto = require('crypto');
const PORT = process.env.PORT || 3262;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let ok = 0; const fails = [];
const chk = (c, m, extra) => { if (c) ok++; else fails.push(m + (extra ? ' — ' + extra : '')); };

(async () => {
  const src = fs.readFileSync('/home/user/atwe/public/admin.html', 'utf8');
  /* Comments FIRST. The app's own docs contain example markup; read as markup that is
     a dead function, and the first run of deadends.js reported one on good code. */
  const body = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  chk(!/\bapi\(\s*'\//.test(body), 'no api() call passes the path where the method goes',
      (body.match(/\bapi\(\s*'\/[^']*'/g) || []).slice(0, 3).join(' | '));

  const names = new Set();
  for (const m of body.matchAll(/\son(?:click|change|input|submit)\s*=\s*"([^"]*)"/g)) {
    for (const f of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(f[1]);
  }
  for (const m of body.matchAll(/\son(?:click|change|input|submit)\s*=\s*\\?'([^']*)'/g)) {
    for (const f of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) names.add(f[1]);
  }
  /* Template literals build most of the dashboard's markup, so the handler text there
     is `onclick="fn(${id})"` inside a backtick string — the same two patterns above
     already catch it, but `${...}` leaves stray tokens; drop anything that is plainly
     not a call the browser will make. */
  const BUILTIN = new Set(['if','for','while','switch','catch','return','function','typeof','new','this','confirm','prompt','alert','parseInt','parseFloat','Number','String','JSON','Math','Object','Array','encodeURIComponent','decodeURIComponent','setTimeout','clearTimeout','fetch','esc']);
  const want = [...names].filter(n => !BUILTIN.has(n)).sort();

  process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
  const auth = require('/home/user/atwe/auth.js');
  const { Pool } = require('/home/user/atwe/node_modules/pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const u = (await pool.query('SELECT id,email,is_admin FROM users WHERE is_admin LIMIT 1')).rows[0];
  chk(!!u, 'an admin account to sign in as');
  if (!u) { console.log('0 checks'); process.exit(1); }
  const tok = auth.signToken(u);
  await pool.query('INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
    [crypto.createHash('sha256').update(tok).digest('hex'), u.id, 'admindead', '127.0.0.1']);

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript((t) => localStorage.setItem('atwe_token', t), tok);
  await p.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2200);

  /* A top-level `const fn = …` is NOT a window property, so `window[name]` reports a
     perfectly live handler as missing. eval in page scope sees the lexical binding. */
  const dead = await p.evaluate((list) => list.filter((n) => {
    try { return typeof (0, eval)(n) !== 'function'; } catch (e) { return true; }
  }), want);
  chk(dead.length === 0, `every handler in admin.html names a real function (${want.length} distinct)`, dead.join(', '));

  const viewInfo = await p.evaluate(() => {
    const tabs = Object.keys(NAV_TITLES);
    const sidebar = [...document.querySelectorAll('#tabs .tab')].map((t) => t.dataset.v);
    return { tabs, sidebar };
  });
  const noButton = viewInfo.tabs.filter((t) => !viewInfo.sidebar.includes(t));
  chk(noButton.length === 0, 'every named view has a sidebar button', noButton.join(', '));
  const noTitle = viewInfo.sidebar.filter((t) => !viewInfo.tabs.includes(t));
  chk(noTitle.length === 0, 'every sidebar button names a view', noTitle.join(', '));
  const noBranch = viewInfo.tabs.filter((t) => !new RegExp(`VIEW === '${t}'`).test(body) && t !== 'overview');
  chk(noBranch.length === 0, 'every view has a branch in renderView()', noBranch.join(', '));

  /* AND THE DASHBOARD MUST REPORT ITS OWN FAULTS. The app has since build 1830; this was
     the one surface still reporting nothing, which is the wrong way round for the place
     money and moderation are handled. Proved end to end rather than by reading the source:
     throw a real error in the page, then read the row back out of the database. */
  const marker = 'adminprobe-' + Date.now();
  await p.evaluate((m) => { setTimeout(() => { throw new Error(m); }, 0); }, marker);
  await p.waitForTimeout(1200);
  const row = (await pool.query(
    'SELECT platform, path FROM client_errors WHERE message LIKE $1 ORDER BY id DESC LIMIT 1',
    ['%' + marker + '%'])).rows[0];
  chk(!!row, 'a fault in the dashboard is reported, like a fault in the app', 'nothing reached client_errors');
  chk(row && row.platform === 'admin', 'and it is marked as the dashboard, not the app', row && row.platform);
  chk(row && /^admin \//.test(row.path || ''), 'and it says which tab, not a URL', row && row.path);
  if (row) await pool.query('DELETE FROM client_errors WHERE message LIKE $1', ['%' + marker + '%']);

  await ctx.close(); await b.close(); await pool.end();
  if (fails.length) console.log('== FAILS ==\n' + fails.map((f) => '  FAIL ' + f).join('\n'));
  console.log(`ok checks: ${ok}`);
  console.log(fails.length ? `${fails.length} FAILED` : 'every control in the dashboard leads somewhere');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
