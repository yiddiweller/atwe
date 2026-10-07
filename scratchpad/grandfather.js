/* Build 1877: a grandfathered holder of a reserved word opens at atwe.com/<word>.
 * Real app, real browser, signed out (the public peek) and signed in, plus the two
 * things that must NOT change: a real route still wins, and an unowned defensive word
 * is not a fake profile. Needs @atwe and @support to exist in the probe database.
 * Self-test: `node grandfather.js --break` serves the build-1876 RESERVED_PATHS
 * (defensive words router-reserved again) and must fail on /atwe and /support. */
'use strict';
const { chromium } = require('./node_modules/playwright-core');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:3262';
const BREAK = process.argv.includes('--break');
const TOK = process.env.TOK || (fs.existsSync('/tmp/tok.txt') ? fs.readFileSync('/tmp/tok.txt', 'utf8').trim() : '');
let pass = 0, fail = 0;
const say = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x ? '  ' + JSON.stringify(x).slice(0, 300) : '')); } };

(async () => {
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  async function ctx(token) {
    const c = await br.newContext({ viewport: { width: 390, height: 844 } });
    if (token) await c.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); } catch (e) {} }, token);
    if (BREAK) {
      await c.route('**/*', async (route) => {
        const req = route.request();
        if (req.resourceType() !== 'document' && !/\/__shell\//.test(req.url())) return route.continue();   // the SW fetches the shell from /__shell/<t>
        const r = await route.fetch(); let body = await r.text();
        body = body.replace("'null', 'undefined', 'true', 'false',\n  ]);", "'null', 'undefined', 'true', 'false', 'atwe', 'support', 'about', 'official',\n  ]);");
        return route.fulfill({ response: r, body });
      });
    }
    return c;
  }
  const state = (p) => p.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!(e && !e.classList.contains('hidden') && e.offsetParent !== null); };
    let peek = false; try { peek = !!S._peek; } catch (e) {}
    let prof = null; try { prof = AC._profileUser && AC._profileUser.username; } catch (e) {}
    const login = vis('loginOverlay') || (document.getElementById('loginOverlay') && document.getElementById('loginOverlay').classList.contains('open'));
    return { path: location.pathname, peek, prof: prof ? String(prof).toLowerCase() : null, profScreen: vis('acProfileScreen'), login: !!login,
             text: (document.querySelector('#acProfileScreen') || {}).innerText ? document.querySelector('#acProfileScreen').innerText.slice(0, 160) : '' };
  });

  console.log('\nsigned OUT');
  let c = await ctx(null);
  for (const w of ['atwe', 'support']) {
    const p = await c.newPage();
    const resp = await p.goto(BASE + '/' + w, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    const s = await state(p);
    say(resp.status() === 200, `/${w}: HTTP 200`, resp.status());
    say(s.peek && s.prof === w && s.profScreen, `/${w}: the public peek shows @${w}'s profile`, s);
    say(s.path === '/' + w, `/${w}: the address stays /${w}`, s.path);
    await p.close();
  }
  {
    // A FRESH context: once the service worker is installed it answers every navigation
    // with the app shell (200), so the server's own status is only visible before it.
    await c.close(); c = await ctx(null);
    const p = await c.newPage();
    const resp = await p.goto(BASE + '/about', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    const s = await state(p);
    say(resp.status() === 404, '/about (nobody holds it): HTTP 404', resp.status());
    say(!s.prof || s.prof !== 'about', '/about: no profile is invented', s);
    await p.close();
  }
  await c.close();

  if (!TOK) { say(false, 'no TOK for the signed-in half'); }
  else {
    console.log('\nsigned IN');
    c = await ctx(TOK);
    for (const w of ['atwe', 'support']) {
      const p = await c.newPage();
      await p.goto(BASE + '/' + w, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(4000);
      const s = await state(p);
      say(s.prof === w && s.profScreen && !s.peek, `/${w}: opens @${w}'s profile`, s);
      say(s.path === '/' + w, `/${w}: canonical address kept`, s.path);
      await p.close();
    }
    {
      const p = await c.newPage();
      await p.goto(BASE + '/?u=atwe', { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(4000);
      const s = await state(p);
      say(s.prof === 'atwe' && s.path === '/atwe', '/?u=atwe opens @atwe and settles on /atwe', s);
      await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4000);
      const s2 = await state(p);
      say(s2.prof === 'atwe' && s2.profScreen, '…and a reload of /atwe still opens @atwe', s2);
      await p.close();
    }
    {
      const p = await c.newPage();
      await p.goto(BASE + '/beam', { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(3500);
      const s = await state(p);
      say(s.path === '/beam' && !s.profScreen, '/beam is Beam, never a profile', s);
      await p.close();
    }
    await c.close();
  }
  await br.close();
  console.log(`\n${pass} passed, ${fail} FAILED`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
