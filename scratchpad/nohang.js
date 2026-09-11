/* NO SCREEN MAY WAIT FOR EVER.
 *
 * The founder pressed Post on 5G, watched "Posting..." sit there, and had to back out of
 * the composer. It was not the composer: `fetch` does NOT reject when a phone loses signal
 * mid-request, it stays PENDING, and API.req -- the one function every write in the app goes
 * through -- had no deadline. So every catch and finally in the app was unreachable, and any
 * action could hang for ever with nothing on screen to say so.
 *
 * This drives the real app with the connection stalled (a route that never answers, which is
 * what a lift or a tunnel actually does) and requires each surface to come back to life.
 * A probe that only tests a FAILING request proves nothing here: an instant failure was
 * always handled. The stall is the case that was broken.
 */
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://localhost:3262';
const TOK = (process.env.TOK || fs.readFileSync('/tmp/tok.txt', 'utf8')).trim();

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

(async () => {
  /* ---- 1. the deadline exists in the shipped source, and is size-aware ---- */
  const src = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const reqBlock = src.slice(src.indexOf('async req(method, path, body, opts)'), src.indexOf('function isAccount()'));
  ok(/signal:\s*API\._deadline\(/.test(reqBlock), 'every API.req fetch carries a deadline');
  ok(/TIMEOUT_MS_PER_KB/.test(src), 'the deadline grows with the payload, so a real photo upload is not cancelled');
  ok(/AI_REPLY_TIMEOUT_MS/.test(src) && !/abort\(\), 30000\)/.test(src),
    'Atwe AI no longer gives up at 30s', /abort\(\), 30000\)/.test(src) ? 'a 30s abort is still there' : '');

  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.addInitScript((t) => { try { localStorage.setItem('atwe_token', t); } catch (e) {} }, TOK);
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof S !== 'undefined' && S.user && S.user.id, null, { timeout: 40000 });
  await p.waitForTimeout(1200);

  /* ---- 2. the real thing: press Post while the route never answers ---- */
  /* A tiny deadline for the run, so the probe does not sit here for forty seconds proving
     something the constant already states. The point under test is that a stall ENDS. */
  await p.evaluate(() => { API.TIMEOUT_BASE_MS = 2500; API.TIMEOUT_MS_PER_KB = 0; });
  await p.route('**/api/social/posts', () => { /* never answer, never fail */ });

  await p.evaluate(() => acOpenPost());
  await p.waitForTimeout(600);
  await p.evaluate(() => { const t = document.getElementById('acPostText'); t.value = 'nohang ' + Date.now(); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.getElementById('acPostBtn').click());

  const btn = () => p.evaluate(() => { const e = document.getElementById('acPostBtn'); return { label: e.textContent.trim(), disabled: e.disabled }; });
  await p.waitForTimeout(700);
  const mid = await btn();
  ok(mid.disabled && /Posting|Scheduling/.test(mid.label), 'while it is sending, the button says so', JSON.stringify(mid));

  await p.waitForTimeout(5000);
  const end = await btn();
  ok(!end.disabled, 'a stalled Post lets the button go again instead of freezing', JSON.stringify(end));
  ok(end.label === 'Post', 'and the label goes back to Post', JSON.stringify(end));

  /* Nothing the member typed may be lost: a stalled post is queued, not dropped. */
  const queued = await p.evaluate(() => { try { return JSON.parse(localStorage.getItem('atwe_outbox') || '[]').length; } catch (e) { return -1; } });
  ok(queued >= 1, 'and the post is kept to send later rather than thrown away', 'outbox=' + queued);
  const pill = await p.evaluate(() => (document.getElementById('outboxPill') || {}).textContent || '');
  ok(/waiting to send/.test(pill), 'with something on screen saying it is waiting', JSON.stringify(pill));

  /* ---- 3. a stalled request that CANNOT be queued says so, in plain words ---- */
  await p.evaluate(() => { try { localStorage.removeItem('atwe_outbox'); } catch (e) {} });
  await p.route('**/api/wallet', () => {});
  const msg = await p.evaluate(async () => {
    try { await API.req('GET', '/api/wallet'); return '(no error at all)'; }
    catch (e) { return e.message; }
  });
  ok(!/abort/i.test(msg) && msg !== '(no error at all)', 'a stalled read fails in plain words, never "aborted"', JSON.stringify(msg));
  ok(/try again/i.test(msg), 'and it tells the member what to do', JSON.stringify(msg));

  await b.close();
  console.log('\n' + pass + ' passed, ' + fails.length + ' FAILED');
  if (fails.length) { console.log(fails.map((f) => '  x ' + f).join('\n')); process.exit(1); }
  console.log('nothing in the app waits for ever');
})().catch((e) => { console.log('CRASH ' + e.stack); process.exit(1); });
