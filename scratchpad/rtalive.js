/* THE LIVE CONNECTION MUST NOTICE WHEN IT HAS DIED.
 *
 * Everything realtime in Atwe rides one long-lived stream: a new message, and — the part
 * that made this urgent — the ring of an incoming call, the answer coming back, and the
 * hang-up. That stream dies quietly. A phone locking for a moment, a network blip, a
 * carrier dropping an idle connection; and on iOS the stream is killed while still
 * reporting OPEN. Nothing errors and nothing on screen changes.
 *
 * Nothing was watching. The only reconnect triggers were a CLOSED readyState (which a
 * half-dead iOS stream never reports), returning to the foreground, and the network
 * coming back — and a phone sitting with Atwe ON SCREEN hits none of them. The founder
 * reported both halves of the same fault without knowing they were one: "their phone
 * never rings" (the callee's stream was dead) and "it rings but answering does nothing"
 * (the CALLER's stream was dead, so the answer landed nowhere).
 *
 * So the server sends a real named `ping` every 15s — a `:ping` COMMENT keeps the socket
 * warm but fires nothing in the browser, which is why a page could never tell a dead
 * stream from a quiet one — and the page reconnects when three in a row go missing.
 */
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3262';
const TOK = process.env.TOK || (fs.existsSync('/tmp/tok.txt') ? fs.readFileSync('/tmp/tok.txt', 'utf8').trim() : '');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x ? ('  ' + JSON.stringify(x)) : '')); } };

(async () => {
  /* The server half, read out of the source: a NAMED event, not a comment. */
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  ok(/rtSend\(res, 'ping'/.test(srv), 'the stream sends a real ping event, not a silent comment');
  ok(!/res\.write\(':ping/.test(srv), 'the old invisible :ping comment is gone');

  if (!TOK) { console.log('  (no TOK — skipping the live half)'); console.log('\n' + pass + ' passed, ' + fail + ' FAILED'); process.exit(fail ? 1 : 0); }

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  /* Count how many times a stream is opened. A reconnect is a NEW EventSource, and that
     is the only honest evidence that the watchdog did anything. */
  await ctx.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); } catch (e) {}
    window.__es = 0; window.__pings = 0;
    const Real = window.EventSource;
    window.EventSource = function (...a) {
      window.__es++;
      const es = new Real(...a);
      es.addEventListener('ping', () => { window.__pings++; });
      return es;
    };
    window.EventSource.prototype = Real.prototype;
    Object.assign(window.EventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
  }, TOK);
  const p = await ctx.newPage();
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, { timeout: 40000 });
  await p.waitForFunction(() => window.__es > 0, { timeout: 30000 }).catch(() => {});
  ok(await p.evaluate(() => window.__es > 0), 'the app opens a live stream on boot');

  /* 1. A HEARTBEAT REALLY ARRIVES. Without this the watchdog would fire for ever. */
  const beat = await p.waitForFunction(() => window.__pings > 0, { timeout: 25000 }).then(() => true).catch(() => false);
  ok(beat, 'a heartbeat arrives within 25s (the server sends one every 15s)');
  ok(await p.evaluate(() => Date.now() - _rtBeat < 25000), 'the page records when it last heard from the server');

  /* 2. A STREAM THAT HAS GONE SILENT IS REBUILT, with the page in the foreground and
        nothing else happening — the exact situation the founder was in. */
  const before = await p.evaluate(() => window.__es);
  await p.evaluate(() => { _rtBeat = Date.now() - 120000; });   // three missed heartbeats
  const rebuilt = await p.waitForFunction((n) => window.__es > n, before, { timeout: 20000 }).then(() => true).catch(() => false);
  ok(rebuilt, 'a stream that has gone silent is torn down and rebuilt on its own', { before });

  /* 3. It does NOT reconnect while everything is healthy — a watchdog that fires on a
        working stream would reconnect every ten seconds for ever. */
  const steady = await p.evaluate(() => window.__es);
  await p.waitForTimeout(12000);
  ok(await p.evaluate((n) => window.__es === n, steady), 'a healthy stream is left alone', { steady });

  /* 4. A CALL CHECKS THE STREAM FIRST, on both sides. */
  const src = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const startCall = src.slice(src.indexOf('async function startCall('), src.indexOf('async function startCall(') + 1400);
  const accept = src.slice(src.indexOf('async function callAccept('), src.indexOf('async function callAccept(') + 900);
  ok(/rtEnsureLive\(\)/.test(startCall), 'placing a call makes sure the stream is alive first');
  ok(/rtEnsureLive\(\)/.test(accept), 'answering a call makes sure the stream is alive first');

  const woke = await p.evaluate(() => { const n = window.__es; _rtBeat = Date.now() - 120000; rtEnsureLive(); return n; });
  await p.waitForTimeout(2500);
  ok(await p.evaluate((n) => window.__es > n, woke), 'rtEnsureLive rebuilds a stale stream on the spot');

  /* 4b. A RING THAT REACHED NOBODY IS SAID AT ONCE, not after 45 seconds of hope. */
  const offline = await p.evaluate(async () => {
    /* A REAL PERSON WHO IS SIMPLY NOT CONNECTED. An invented id is refused by the
       contact check long before delivery is considered, so it proves nothing. */
    const c = await API.req('GET', '/api/atchat/conversations');
    const peer = (c.conversations || c.items || []).map((x) => x.id).filter(Boolean)[0];
    if (!peer) return { skip: true };
    const r = await API.req('POST', '/api/rt/call', { to: peer, kind: 'offer', callId: 'probe-offline', media: 'audio', sdp: 'x' });
    const r2 = await API.req('POST', '/api/rt/call', { to: peer, kind: 'ice', callId: 'probe-offline', candidate: 'x' });
    return { offer: r, later: r2 };
  });
  if (offline.skip) console.log('  (no conversation to call — skipping the delivery check)');
  if (!offline.skip) {
    ok(offline.offer && offline.offer.delivered === false, 'an offer to somebody with no live stream reports it was not delivered', offline.offer);
    ok(offline.later && offline.later.delivered === undefined, 'later signals in a live call are not second-guessed', offline.later);
  }
  ok(/r\.delivered === false/.test(src), 'the caller acts on that instead of ringing at nothing');

  /* 5. SELF-TEST. With the watchdog gone, a silent stream is never noticed — which is
        exactly what shipped, and what a phone left on screen was living with. */
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx2.addInitScript((t) => {
    try { localStorage.setItem('atwe_token', t); } catch (e) {}
    window.__es = 0;
    const Real = window.EventSource;
    window.EventSource = function (...a) { window.__es++; return new Real(...a); };
    window.EventSource.prototype = Real.prototype;
    Object.assign(window.EventSource, { CONNECTING: 0, OPEN: 1, CLOSED: 2 });
    /* Neuter the watchdog the way the shipped build effectively had it: no timer. */
    const realSetInterval = window.setInterval;
    window.setInterval = function (fn, ms, ...r) {
      if (ms === 10000 && String(fn).indexOf('rtHeartbeatCheck') >= 0) return 0;
      return realSetInterval(fn, ms, ...r);
    };
  }, TOK);
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, { timeout: 40000 });
  await p2.waitForTimeout(3000);
  await p2.evaluate(() => { if (typeof rtHeartbeatCheck === 'function') window.rtHeartbeatCheck = () => {}; _rtBeat = Date.now() - 120000; });
  const n2 = await p2.evaluate(() => window.__es);
  await p2.waitForTimeout(14000);
  const stillDead = await p2.evaluate((n) => window.__es === n, n2);
  ok(stillDead, 'self-test: with no watchdog, a silent stream is never noticed', { opened: n2 });
  await ctx2.close();

  await b.close();
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED' + (fail ? '' : ' — a dead stream is noticed and rebuilt'));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.message); process.exit(1); });
