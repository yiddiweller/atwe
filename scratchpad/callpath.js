/* ══════════════════════════════════════════════════════════════════════════
   CALLS — THE PATHS THE HAPPY-PATH PROBE NEVER SEES.
   `twoperson.js` drives one perfect call between two browsers on one machine and
   it passes; the founder still reported that calling somebody does not ring them
   and that a ringing call cannot be picked up. Both of those live in the paths a
   perfect call never takes:

     · the credential request that every call waits on STALLS,
     · the server REFUSES the call in words,
     · picking up THROWS.

   Every call - 1:1, group, call link and Go Live - waits on
   `callIceServers()` before a single byte of the invitation is sent, and neither
   that request nor the server's own request to Cloudflare behind it had any time
   limit. So a slow answer did not delay a call, it CANCELLED it silently: the
   caller watched "Calling..." and the invitation was never sent, so the other
   person's phone never made a sound.

   PROBE LESSON PAID FOR IN THIS FILE: the first version of this reproduction read
   `peerId` off the conversations payload, where the field is plain `id`. It got
   null, `startCall` returned at its own first line, and the "Calling..." text it
   then measured was the PLACEHOLDER sitting in the hidden markup - so it "proved"
   a frozen call on a call that had never started, before AND after the fix. Assert
   on something a call actually DID: whether the invitation reached the server.
   ══════════════════════════════════════════════════════════════════════════ */
const { chromium } = require(process.env.PW_SCRATCH ? process.env.PW_SCRATCH + '/node_modules/playwright-core' : 'playwright-core');
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = 'http://localhost:3262';
const TOK = process.env.TOK;
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let pass = 0, fail = 0;
const ok = (c, what, detail) => { if (c) { pass++; console.log('  ok   ' + what + (detail ? '   ' + detail : '')); } else { fail++; console.log('  FAIL ' + what + (detail ? '   ' + detail : '')); } };
const head = (t) => console.log('\n-- ' + t + ' --');

async function newPage(b) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); } catch (e) {} }, TOK);
  return p;
}
async function boot(p) {
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, null, { timeout: 40000 });
  await p.waitForTimeout(900);
}
const peerOf = (p) => p.evaluate(async () => {
  const r = await API.req('GET', '/api/atchat/conversations');
  const c = (r.conversations || [])[0];
  return c ? { id: c.id, name: c.name } : null;   // the field is `id`, not `peerId`
});

(async () => {
  if (!TOK) { console.log('skipped: no TOK'); process.exit(0); }
  const src = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  /* ---- 1. the deadlines exist where every call waits ---- */
  head('1. nothing in a call waits without a limit');
  const ice = src.slice(src.indexOf('async function callIceServers'), src.indexOf('function callSignal'));
  ok(/timeout:\s*\d+/.test(ice), 'the credential request every call waits on gives up',
    (ice.match(/timeout:\s*(\d+)/) || [])[1] + 'ms');
  ok(/AbortSignal\.timeout\(CF_TURN_TIMEOUT_MS\)/.test(srv), 'and the server does not hang on Cloudflare either');
  ok(/callArmGiveUp\(\);/.test(src.slice(src.indexOf('async function startCall'), src.indexOf('function callOnSignal'))),
    'the caller arms its give-up timer before anything can stall');

  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  /* ---- 2. THE REPORTED BUG: credentials stall, does the other person still get rung? ---- */
  head('2. a stalled credential request still rings the other person');
  const p = await newPage(b);
  let offerAt = 0; const t0 = () => Date.now();
  await p.route('**/api/rt/ice-servers', () => { /* never answer, never fail */ });
  await boot(p);
  const peer = await peerOf(p);
  ok(!!(peer && peer.id), 'the probe has a real person to call', JSON.stringify(peer));
  if (peer && peer.id) {
    const started = t0();
    await p.route('**/api/rt/call', (r) => { if (!offerAt) offerAt = Date.now(); r.continue(); });
    await p.evaluate((pr) => { startCall('audio', pr); }, peer);   // never await: on the stalled path it never settles
    await p.waitForTimeout(11000);
    ok(offerAt > 0, 'the invitation reaches the server despite the stall',
      offerAt ? 'after ' + Math.round((offerAt - started) / 1000) + 's' : 'NEVER SENT — the other phone never rings');
    ok(offerAt > 0 && (offerAt - started) < 10000, 'and it does not take longer than a person will wait',
      offerAt ? Math.round((offerAt - started) / 1000) + 's' : 'n/a');
    /* SELF-TEST: with no deadline at all — the shipped behaviour before this — the
       same stall must NOT ring, or this check could never have caught the bug. */
    const p2 = await newPage(b);
    let offer2 = false;
    await p2.route('**/api/rt/ice-servers', () => {});
    await p2.addInitScript(() => { window.__noIceDeadline = true; });
    await boot(p2);
    await p2.evaluate(() => { const o = API.req.bind(API); API.req = (m, path, body, opts) => (path === '/api/rt/ice-servers' ? new Promise(() => {}) : o(m, path, body, opts)); });
    await p2.route('**/api/rt/call', (r) => { offer2 = true; r.continue(); });
    await p2.evaluate((pr) => { startCall('audio', pr); }, peer);
    await p2.waitForTimeout(11000);
    ok(!offer2, 'self-test: with no limit at all nothing is ever sent — so this check can fail', offer2 ? 'it rang anyway' : 'never sent, as the bug did');
    await p2.close();
  }
  await p.close();

  /* ---- 3. a refused call says so, instead of 45s of ringing ---- */
  head('3. a refusal is shown, not disguised as silence');
  const p3 = await newPage(b);
  await boot(p3);
  await p3.route('**/api/rt/call', (r) => r.fulfill({ status: 403, contentType: 'application/json',
    body: JSON.stringify({ error: 'This person isn’t accepting calls from you.' }) }));
  if (peer && peer.id) {
    /* A TOAST FADES, so reading the screen once several seconds later finds an empty
       page and calls a working message missing. Record them as they are raised. */
    await p3.evaluate(() => { window.__said = []; const o = showNotif; showNotif = (m, ...r) => { window.__said.push(String(m)); return o(m, ...r); }; });
    await p3.evaluate((pr) => { startCall('audio', pr); }, peer);
    await p3.waitForTimeout(6000);
    const st = await p3.evaluate(() => ({
      overlay: !!document.querySelector('#callOverlay:not(.hidden)'),
      toast: (window.__said || []).join(' | '),
    }));
    ok(/accepting calls/i.test(st.toast), 'the caller is told why', st.toast.slice(0, 80) || '(nothing said)');
    ok(!st.overlay, 'and the call screen is put away instead of ringing on', 'overlay=' + st.overlay);
  }
  await p3.close();

  /* ---- 4. picking up cannot strand the person on the ringing screen ---- */
  head('4. a pick-up that goes wrong clears the screen');
  const p4 = await newPage(b);
  await boot(p4);
  await p4.evaluate(() => {
    CALL = { peer: { id: 999999, name: 'Tester' }, media: 'audio', callId: 'probe-1', caller: false,
             state: 'incoming', offer: 'not json at all', pendingIce: [] };
    callShowUI('incoming');
  });
  await p4.waitForTimeout(300);
  ok(await p4.evaluate(() => !!document.querySelector('#callOverlay:not(.hidden)')), 'the incoming-call screen is up');
  await p4.evaluate(() => { try { callAccept(); } catch (e) {} });
  await p4.waitForTimeout(2500);
  const after = await p4.evaluate(() => ({
    overlay: !!document.querySelector('#callOverlay:not(.hidden)'),
    toast: Array.from(document.querySelectorAll('.notif')).map((n) => n.textContent.trim()).join(' | '),
  }));
  ok(!after.overlay, 'answering a call that cannot be built does not strand them on it', 'overlay=' + after.overlay);
  ok(!!after.toast, 'and they are told rather than left guessing', after.toast.slice(0, 70) || '(nothing said)');

  /* ---- 5. a missing microphone reads as a missing microphone ---- */
  head('5. the reason a call could not start is the real reason');
  await p4.evaluate(() => { CALL = null; });
  await p4.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' }));
  });
  await p4.evaluate(() => { startCall('audio', { id: 999999, name: 'Tester' }); });
  await p4.waitForTimeout(1200);
  const mic = await p4.evaluate(() => Array.from(document.querySelectorAll('.notif')).map((n) => n.textContent.trim()).join(' | '));
  ok(/no microphone was found/i.test(mic), 'a missing microphone is not reported as a permission problem', mic.slice(0, 80));
  await p4.close();

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  console.log(fail ? 'calls have a path that goes nowhere' : 'a call rings, is answerable, and says why when it cannot be');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('CRASH', e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e); process.exit(1); });
