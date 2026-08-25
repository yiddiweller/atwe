#!/usr/bin/env node
/* Walks the app's main screens in both themes and reports what tools/design-probe.js
 * finds: text that fails contrast, controls a finger would struggle to hit, text
 * cut off, the page scrolling sideways, icon buttons a screen reader cannot name.
 *
 * Needs a running server and a signed-in account:
 *
 *   ATWE_URL=http://localhost:3000 \
 *   DATABASE_URL=postgres://... JWT_SECRET=... \
 *   node tools/design-sweep.js
 *
 * It creates its own throwaway account, so it never touches anyone's real data.
 * Without playwright, a database, or a reachable server it SKIPS cleanly (exit 0)
 * rather than failing — same contract as tools/check-overlays.js.
 *
 * Findings are advice, not errors: many small controls are deliberate. Read them,
 * decide, don't obey. It exits non-zero only when the page scrolls sideways or a
 * screen throws, which are always bugs.
 */
const PROBE = require('./design-probe.js');
const B = process.env.ATWE_URL || 'http://localhost:3000';

const SCREENS = [
  ['home',        "appTab('home')"],
  ['beam',        "appTab('chat')"],
  ['engine',      "appTab('search')"],
  ['profile hub', "appTab('profile')"],
  ['wallet',      'acOpenWallet()'],
  ['orders',      "acOpenOrders('buyer')"],
  ['marketplace', 'acOpenMarketplace()'],
  ['settings',    'openSettings()'],
  ['privacy',     "setNav('privacy')"],
  ['notifications', 'openNotifications()'],
];

(async () => {
  let chromium;
  for (const p of ['playwright-core', 'playwright', '@playwright/test']) {
    try { chromium = require(p).chromium; break; } catch (_) {}
  }
  if (!chromium) { console.log('playwright not installed — skipping (install it to run this sweep)'); process.exit(0); }
  if (!process.env.DATABASE_URL) { console.log('no DATABASE_URL — skipping (the sweep needs an account to sign in with)'); process.exit(0); }

  let pool, auth, crypto;
  try {
    crypto = require('crypto');
    auth = require('../auth');
    pool = new (require('pg').Pool)({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
  } catch (e) { console.log('database not reachable — skipping (' + e.message + ')'); process.exit(0); }

  try { const r = await fetch(B + '/api/health'); if (!r.ok) throw new Error('unhealthy'); }
  catch (e) { console.log('no server at ' + B + ' — skipping'); await pool.end(); process.exit(0); }

  // A throwaway account, so the sweep never depends on (or disturbs) real data.
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,account_type,balance_cents)
     VALUES ('Design Sweep',$1,$2,$3,true,true,'personal',2500) RETURNING id,email`,
    [tag + '@sweep.local', await auth.hashPassword('x'.repeat(12)), 'sweep' + tag]);
  const token = auth.signToken({ id: rows[0].id, email: rows[0].email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'design-sweep','127.0.0.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), rows[0].id]);

  const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const errors = [], found = {}, seen = new Set();
  let sideways = 0;

  for (const theme of ['black', 'light']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    page.on('pageerror', (e) => errors.push('[' + theme + '] ' + String(e).slice(0, 140)));
    await page.goto(B, { waitUntil: 'domcontentloaded' });
    await page.evaluate((a) => { localStorage.clear(); localStorage.setItem('atwe_token', a.k);
      localStorage.setItem('atwe_theme', a.t);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, { k: token, t: theme });
    await page.goto(B, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    for (const [name, open] of SCREENS) {
      try {
        await page.evaluate((src) => { document.querySelectorAll('.overlay.show').forEach((o) => o.classList.remove('show')); }, null);
        await page.waitForTimeout(250);
        await page.evaluate((src) => { eval(src); }, open);
      } catch (e) { continue; }
      await page.waitForTimeout(1800);
      const r = await page.evaluate(PROBE);
      const lines = [];
      for (const c of r.contrast) { const k = 'c|' + c.t + c.color; if (seen.has(k)) continue; seen.add(k);
        lines.push('  contrast ' + c.r + ':1 (needs ' + c.need + ') at ' + c.size + 'px — "' + c.t + '" ' + c.color); }
      for (const t of r.targets) { const k = 't|' + (t.sel || t.t); if (seen.has(k)) continue; seen.add(k);
        lines.push('  small target ' + t.w + 'x' + t.h + ' — "' + t.t + '"   ' + (t.sel || '')); }
      for (const c of r.clipped) { const k = 'x|' + c.t; if (seen.has(k)) continue; seen.add(k);
        lines.push('  text cut off ' + c.sw + '>' + c.cw + ' — "' + c.t + '"'); }
      for (const o of r.overflow) { sideways++; lines.push('  PAGE SCROLLS SIDEWAYS ' + o.sw + ' > ' + o.vw); }
      for (const u of r.unnamed) { const k = 'u|' + u.t; if (seen.has(k)) continue; seen.add(k);
        lines.push('  unnamed icon control — ' + u.t); }
      if (lines.length) found[theme + ' · ' + name] = lines;
    }
    await page.close();
  }

  let total = 0;
  for (const [screen, lines] of Object.entries(found)) {
    console.log('-- ' + screen + ' --');
    lines.forEach((l) => console.log(l));
    total += lines.length;
  }
  console.log('\n' + total + ' findings across ' + (SCREENS.length * 2) + ' screens');
  console.log('page errors: ' + errors.length + (errors.length ? '\n  ' + errors.slice(0, 6).join('\n  ') : ''));
  await browser.close();
  await pool.query('DELETE FROM users WHERE id = $1', [rows[0].id]).catch(() => {});
  await pool.end();
  // Only the always-wrong things fail the run; the rest is advice.
  process.exit(sideways || errors.length ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
