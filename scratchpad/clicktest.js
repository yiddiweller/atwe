// REAL clicks on the REAL controls, phone + desktop. After each: what screen is up,
// was anything covering the button, did JS throw.
process.env.JWT_SECRET = 'scoresecret';
const crypto = require('crypto'); const fs = require('fs');
const { Pool } = require('/home/user/atwe/node_modules/pg');
const auth = require('/home/user/atwe/auth');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const pool = new Pool({ connectionString: 'postgres://atwe:atwe@localhost:5432/atwescore' });
const B = 'http://localhost:' + (process.env.PORT || 3262);
const OUT = SP + 'click/'; fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('    ok   ' + m); } else { fail++; console.log('    FAIL ' + m); } };

const PROBE = (sel) => {
  const el = document.querySelector(sel); if (!el) return { missing: true };
  const cs0 = getComputedStyle(el);
  if (cs0.display === 'none' || cs0.visibility === 'hidden') return { hidden: true, disp: cs0.display };
  // elementFromPoint returns null for coordinates OUTSIDE the viewport, so a control
  // that is merely below the fold would read as "covered by nothing". Bring it into
  // view first (the same thing a real click does) and only then hit-test it.
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  if (r.width < 2) return { hidden: true, disp: cs.display };
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { clear: !!hit && (hit === el || el.contains(hit)),
    blocker: hit ? (hit.tagName + (hit.id ? '#' + hit.id : '') + '.' + String(hit.className).trim().split(/\s+/).slice(0,2).join('.')).slice(0,46) : 'NOTHING (no element at that point)',
    box: Math.round(r.width) + 'x' + Math.round(r.height), pe: cs.pointerEvents };
};
const SCREEN = () => {
  const up = [];
  document.querySelectorAll('.ac-screen,.overlay,.app-page,.page').forEach((e) => {
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 80 && parseFloat(cs.opacity) > .15)
      up.push(e.id || String(e.className).split(' ')[0]);
  });
  return up.join(',') || '(nothing)';
};

(async () => {
  const email = crypto.randomUUID().slice(0, 8) + '@t.local';
  const hash = await auth.hashPassword('x'.repeat(12));
  const h = 'ck' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents) VALUES ('Click Tester',$1,$2,$3,true,true,5000) RETURNING id`, [email, hash, h]);
  const uid = rows[0].id;
  const token = auth.signToken({ id: uid, email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), uid]);
  await pool.query("INSERT INTO notifications (user_id, actor_id, type, created_at) VALUES ($1,$1,'follow',now())", [uid]);

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errs = [];
  for (const [w, hgt, label] of [[390, 844, 'phone'], [1440, 900, 'desktop']]) {
    console.log('\n════ ' + label + ' (' + w + '×' + hgt + ') ════');
    const p = await b.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errs.push('[' + label + ' js] ' + String(e).slice(0, 200)));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push('[' + label + ' c] ' + m.text().slice(0, 200)); });
    await p.goto(B, { waitUntil: 'domcontentloaded' });
    await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam','circles','ai','wallet'])); }, token);
    await p.goto(B, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(4200);
    ok(errs.length === 0, 'boots with no JS error' + (errs.length ? ' :: ' + errs[0] : ''));

    const tap = async (sel, name, expect) => {
      const pr = await p.evaluate(PROBE, sel);
      if (pr.missing) { console.log('    ' + name.padEnd(22) + ' — not in the DOM'); return; }
      if (pr.hidden)  { console.log('    ' + name.padEnd(22) + ' — not shown here (display:' + pr.disp + ')'); return; }
      ok(pr.clear, name + ': nothing covers it' + (pr.clear ? '' : ' — the top element there is ' + pr.blocker));
      const n0 = errs.length;
      let clicked = true;
      try { await p.click(sel, { timeout: 3500 }); } catch (e) { clicked = false; }
      ok(clicked, name + ': the click lands');
      await p.waitForTimeout(1700);
      const sc = await p.evaluate(SCREEN);
      if (expect) ok(sc.includes(expect), name + ': opens ' + expect + '  (got ' + sc.slice(0, 60) + ')');
      ok(errs.length === n0, name + ': no JS error' + (errs.length > n0 ? ' :: ' + errs[n0] : ''));
      await p.screenshot({ path: OUT + label + '-' + name.replace(/[^a-z0-9]+/gi, '-') + '.png' });
    };

    // Atwe AI is no longer a tab — it opens from the circle beside the Engine search
    // bar — and Notifications took its slot.
    const NAV = w < 769
      ? [['#bnav-home', 'Home', 'acHomeScreen'], ['#bnav-chat', 'Beam', 'acListScreen'], ['#bnav-search', 'Engine', 'acSearchScreen'],
         ['#bnav-notifs', 'Alerts', 'notifOverlay'], ['#bnav-profile', 'Account', 'acMeScreen']]
      : [['#snav-home', 'Home', 'acHomeScreen'], ['#snav-chat', 'Beam', 'acListScreen'], ['#snav-search', 'Engine', 'acSearchScreen'],
         ['#snav-notifs', 'Alerts', 'notifOverlay'], ['#snav-profile', 'Account', 'acMeScreen']];
    for (const [sel, name, exp] of NAV) {
      await tap(sel, name, exp);
      // Alerts is a panel over the world you're in — close it so the next tap is clean.
      if (name === 'Alerts') { await p.evaluate(() => closeOverlay('notifOverlay')); await p.waitForTimeout(600); }
    }
    // The Atwe AI circle beside the Engine search bar is now the only way in.
    await p.evaluate(() => appTab('search')); await p.waitForTimeout(1200);
    await tap('#engAiBtn', 'Atwe AI (Engine circle)', null);

    // Notifications, by every route the user has
    await p.evaluate(() => { try { appTab('profile'); } catch (e) {} }); await p.waitForTimeout(1500);
    /* The Account page is two levels now (ME_SECTIONS): its rows live inside sections, so
       reach the section first. Assert the section row EXISTS rather than tapping blind —
       a selector that silently matches nothing would quietly drop this check instead of
       failing it, which is how the old flat selector went unnoticed. */
    /* NOT `.me-row.me-sec`: App & help was promoted to its own card at the top level,
       so it is a plain .me-row now. Match on what it DOES (opens the section), which
       survives it being moved again. */
    const secBtn = '.me-row[onclick*="acMeSection(\'app\')"]';
    ok(await p.$(secBtn) !== null, 'the Account page shows an “App & help” section');
    await tap(secBtn, 'App & help (Account page)', null);
    await tap('.me-row[onclick*="openNotifications"]', 'Notifications (Account → App & help)', 'notifOverlay');
    // and the direct call, to separate "the click path is broken" from "the function is broken"
    await p.evaluate(() => { document.querySelectorAll('.overlay.show').forEach((o) => o.classList.remove('show')); });
    await p.waitForTimeout(500);
    const n0 = errs.length;
    await p.evaluate(() => openNotifications());
    await p.waitForTimeout(1800);
    const direct = await p.evaluate(SCREEN);
    ok(direct.includes('notifOverlay'), 'openNotifications() called directly opens the panel (' + direct.slice(0, 60) + ')');
    ok(errs.length === n0, 'openNotifications() throws nothing' + (errs.length > n0 ? ' :: ' + errs[n0] : ''));
    await p.screenshot({ path: OUT + label + '-notif-direct.png' });
    await p.close();
  }
  console.log('\n── every JS/console error seen ──');
  if (!errs.length) console.log('  (none)');
  errs.slice(0, 15).forEach((e) => console.log('  ' + e));
  console.log('\n═══ ' + pass + ' passed, ' + fail + ' failed ═══');
  await b.close(); await pool.end(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
