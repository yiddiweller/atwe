/* Does the app's own search — and the assistant behind it — still know the whole app?
 *
 * The founder's question was "when we build something new, do I have to come back and
 * update the search and the AI too?". The answer is meant to be NO, and this probe is
 * what makes that true: everything below is derived from tables the app already keeps
 * (PLACES_EXTRA / ME_SECTIONS / SET_SEARCH_INDEX for places, features-data.js for what
 * the app can DO — written by tools/features.js in the same commit that ships a
 * feature). If somebody adds a screen and indexes nothing, this goes red and names it.
 *
 * Four things are checked, and the last one is the anti-staleness one:
 *   1. every BUILT feature is findable in the app's search
 *   2. the two result groups never say the same thing twice, and never point nowhere
 *   3. the server's retrieval hands the assistant the right features for real questions
 *   4. no new openable screen has appeared that nothing indexes
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');           // probes run with cwd=scratchpad
const { Pool } = require(ROOT + '/node_modules/pg');
const auth = require(ROOT + '/auth');
const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
const { chromium } = require(SP + 'node_modules/playwright-core');
const FEATURES = require(ROOT + '/features-data.js');
const B = 'http://localhost:3262';
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

/* Real questions, and the feature each one is really about. These are the assistant's
   exam: it is grounded on the catalogue, so the catalogue has to surface these.
   NB the expected name must be the CATALOGUE's name, not the page's — the place is
   called "Split a bill" and the feature "Split bills", and writing the wrong one here
   failed a retrieval that was working perfectly. */
const ASKS = [
  ['does Atwe hold my money until the buyer confirms it arrived?', 'Escrow / buyer protection'],
  ['how do I make messages disappear after a while',               'Disappearing messages'],
  ['can I schedule a post for tomorrow',                           'Scheduled posts & drafts'],
  ['can I sell tickets to an event',                               'Events'],
  ['does it do voice notes',                                       'Voice notes + AI transcripts'],
  ['can I show a story to only some people',                       'Close Friends'],
  ['how do I put a discount code on my shop',                      'Coupons'],
  ['can four of us split the cost of something',                   'Split bills'],
];
/* Two different properties, and conflating them made this fail on correct code.
   NOTHING AT ALL is only right when the question shares no vocabulary with Atwe —
   "email", "capital" and "translate" are all real Atwe words, so a question using one
   legitimately matches something. What must always hold is that an off-topic question
   is never BURIED: a couple of stray rows the model can ignore, not a wall of them. */
const OFF_TOPIC_SILENT = ['write me a poem about the sea'];
const OFF_TOPIC_QUIET = ['summarise this email for me', 'what is the capital of France', 'what is 15 percent of 240'];

/* Screens that legitimately have no entry in the search index. Every one is either
   contextual (it needs something already open or loaded, and opening it cold does
   nothing) or chrome (a picker, a menu, the login gate). If this probe names a screen
   that is NOT here, it is new: index it in PLACES_EXTRA / ME_SECTIONS, or add it here
   with the reason. Do not add a name here to make the probe quiet. */
const NOT_A_DESTINATION = {
  openLogin: 'the sign-in gate — you are already signed in when you can search',
  openSearch: 'the older search overlay; Engine is the indexed one',
  openNotifications: 'the bell — indexed as the world "Notifications"',
  openEmojiPicker: 'a picker inside the composer',
  openSocialPicker: 'a picker inside the profile editor',
  openSupportAi: 'opened from Help & feedback, which is indexed',
  openPause: 'a confirm step inside another flow',
  openPlans: 'indexed as "Your plan" and "Upgrade to Pro"',
  openChangeEmail: 'indexed as the Settings row "Change email"',
  openDeactivate: 'a row on Settings → Your account',
  openLockedSections: 'indexed as "Locked sections"',
  openDeleteAccount: 'indexed as "Delete account"',
  openDevices: 'indexed as "Devices & sessions"',
  acOpenLanguage: 'indexed as the Settings row "Language", which opens its page',
  acOpenCompose: 'the alt-text editor for a photo already attached',
  acOpenMore: 'a links sheet inside a profile',
  acOpenPhone: 'the dialler, opened from a contact',
  acOpenIssueCompose: 'writing an issue of a newsletter you already opened',
  acOpenAiMatch: 'the Ask-Atwe-AI hero on Engine; the world itself is indexed',
  acOpenAiHub: 'the AI tool sheet; Atwe AI is indexed',
  acOpenAiAsk: 'asks about a thing already on screen',
  acOpenPinsList: 'the pinned messages of the conversation you have open',
  acOpenIdentity: 'needs AC._identity — opened from a profile',
  acOpenTrust: 'needs AC._trust — opened from a profile',
  acOpenStrength: 'needs AC._strength — opened from your own profile',
  acOpenGroupAutomod: 'settings for the group you have open',
  acOpenDisappearing: 'the timer for the conversation you have open',
  acOpenCloud: 'the shared drive of the group you have open',
  acOpenWallpaper: 'the wallpaper of the conversation you have open',
  acOpenLinkScan: 'the camera, opened from Link a device',
  acOpenStoreLookRefresh: 'a Pro prompt inside Manage store',
  acOpenStoreBanner: 'a row inside Manage store',
  acOpenStoreTheme: 'a row inside Manage store',
  acOpenFreeShip: 'a row inside Manage store',
};

/* The same derivation the app does, read out of the FILE — so this sees screens no
   probe ever opens. A destination is "indexed" when some entry's run names it. */
function unindexedOpeners() {
  const src = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
  // Comments first: the file documents helpers in prose that would otherwise parse.
  const body = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const indexed = new Set();
  const runRe = /run:\s*"([^"]*)"|run:\s*'([^']*)'/g;
  let m;
  while ((m = runRe.exec(src))) {
    for (const call of ((m[1] || m[2] || '').match(/[A-Za-z_$][\w$]*\s*\(/g) || [])) indexed.add(call.replace(/\s*\($/, ''));
  }
  const out = [];
  const declRe = /\nfunction\s+((?:ac)?[Oo]pen[A-Z][A-Za-z0-9_]*)\s*\(\s*\)\s*\{/g;
  while ((m = declRe.exec(body))) {
    const name = m[1];
    if (indexed.has(name)) continue;
    const chunk = body.slice(m.index, m.index + 2500);
    const ov = (chunk.match(/showOverlay\(\s*['"]([A-Za-z0-9_]+)/) || [])[1];
    if (!ov) continue;                                         // shows no surface of its own
    if (!new RegExp('id=["\']' + ov + '["\']').test(src)) continue;   // and it must be real markup
    out.push(name);
  }
  return out;
}

/* Run the SHIPPED retrieval out of server.js rather than a copy of it — a copy would
   drift, and then this would be testing code nobody runs. */
function loadRetrieval() {
  const src = fs.readFileSync(ROOT + '/server.js', 'utf8');
  const a = src.indexOf('const CAP_SEND =');
  const b = src.indexOf('\n}\n', src.indexOf('function capabilityBlock')) + 3;
  if (a < 0 || b < 3) throw new Error('could not find capabilityBlock in server.js');
  return new Function('FEATURES_DATA', src.slice(a, b) + '\nreturn { capabilityBlock, CAP_ROWS, CAP_SEND };')(FEATURES);
}

(async () => {
  // ── 3. the server's retrieval, offline (no API key needed, and none is used) ──
  const R = loadRetrieval();
  ok(R.CAP_ROWS.length > 400, 'the assistant is grounded on the real catalogue (' + R.CAP_ROWS.length + ' features)');
  for (const [q, want] of ASKS) {
    const out = R.capabilityBlock([{ role: 'user', content: q }], false);
    const names = (out || '').split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2).split(' — ')[0].replace(' [admin dashboard]', ''));
    ok(names.includes(want), 'retrieval finds “' + want + '” for: ' + q + (names.includes(want) ? '' : ' → got ' + (names.slice(0, 3).join(', ') || 'nothing')));
    ok(names.length <= R.CAP_SEND, 'retrieval stays within its cap for: ' + q + ' (' + names.length + ')');
  }
  for (const q of OFF_TOPIC_SILENT) {
    ok(!R.capabilityBlock([{ role: 'user', content: q }], false), 'nothing at all injected for: ' + q);
  }
  for (const q of OFF_TOPIC_QUIET) {
    const n = (R.capabilityBlock([{ role: 'user', content: q }], false) || '').split('\n').filter((l) => l.startsWith('- ')).length;
    ok(n <= 3, 'an off-topic question is not buried (' + n + ' rows): ' + q);
  }
  // A member must never be shown the dashboard's own tools.
  /* The function existing proves nothing — it has to be WIRED into the route that
     actually answers a member. Read the source, because no API key is needed for this
     and a probe that drives the real chat route cannot run without one. */
  const srv = fs.readFileSync(ROOT + '/server.js', 'utf8');
  const chat = srv.slice(srv.indexOf("app.post('/api/chat'"), srv.indexOf("app.post('/api/chat'") + 4000);
  ok(/capabilityBlock\(/.test(chat), 'the chat route really uses the capability retrieval');
  ok(/appHintsBlock\(/.test(chat), 'the chat route really uses the search ranker\'s hints');
  ok(/appGuideBlock\(/.test(chat), 'the chat route still sends the list of places');

  /* These descriptions are no longer internal: they are shown to members in search
     and sent to the assistant, so the app's oldest rule applies to them — the
     product is Atwe and the assistant is Atwe AI, and the vendor behind it is never
     named. Checked on the catalogue itself, so a future entry cannot leak one. */
  const vendor = FEATURES.filter((f) => f.phase === 'inv')
    .filter((f) => /claude|anthropic|sonnet|haiku|opus|gpt|openai/i.test(f.name + ' ' + f.desc + ' ' + f.cat))
    .map((f) => f.name);
  ok(vendor.length === 0, vendor.length ? 'a member-visible feature names the AI vendor: ' + vendor.join(', ') : 'nothing member-visible names the AI vendor');

  const adminOnly = R.CAP_ROWS.filter((r) => r.admin).length;
  ok(adminOnly > 0, 'the catalogue does carry dashboard-only rows (' + adminOnly + ')');
  const memberOut = R.capabilityBlock([{ role: 'user', content: 'how do I refund a customer' }], false);
  ok(!/\[admin dashboard\]/.test(memberOut || ''), 'a member is never handed the dashboard-only rows');

  // ── 4. no new screen has appeared that nothing indexes ──
  const stale = unindexedOpeners().filter((n) => !NOT_A_DESTINATION[n]);
  ok(stale.length === 0, stale.length
    ? 'NEW SCREEN, NOT INDEXED: ' + stale.join(', ') + ' — add it to PLACES_EXTRA/ME_SECTIONS, or to NOT_A_DESTINATION here with why'
    : 'every openable screen is either indexed or a named exception');

  // ── 1 + 2. the search itself, in a real browser ──
  const email = crypto.randomUUID().slice(0, 8) + '@t.local';
  const hash = await auth.hashPassword('x'.repeat(12));
  const uname = 'ak' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,balance_cents,account_type)
     VALUES ('Knows Tester',$1,$2,$3,true,true,5000,'business') RETURNING id`, [email, hash, uname]);
  const token = auth.signToken({ id: rows[0].id, email, is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), rows[0].id]);

  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await br.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.evaluate((t) => { localStorage.clear(); localStorage.setItem('atwe_token', t);
    localStorage.setItem('atwe_intro_seen', JSON.stringify(['beam', 'circles', 'ai', 'wallet'])); }, token);
  await p.goto(B, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4500);
  await p.evaluate(() => acLoadCaps());
  // `_caps` is a top-level const in the page, NOT a window property — asking for
  // window._caps waits for ever on working code.
  await p.waitForFunction(() => typeof _caps !== 'undefined' && Array.isArray(_caps) && _caps.length > 0, null, { timeout: 20000 });

  const built = FEATURES.filter((f) => f.phase === 'inv').map((f) => f.name);
  const r = await p.evaluate((names) => {
    const idx = acAppIndex();
    const missing = [];
    for (const n of names) {
      if (!(acFindPlaces(n, 3) || []).length && !(acFindCaps(n, 3) || []).length) missing.push(n);
    }
    /* Nothing may be offered in both groups at once. NB the raw catalogue legitimately
       contains names that are also pages ("Communities", "Lists") — the dedupe happens
       when a query is answered, so that is what has to be asked. Checking the raw list
       instead reported five failures on correct code. */
    const placeNames = new Set(idx.map((x) => x.label.toLowerCase()));
    const shared = _caps.filter((c) => placeNames.has((c.n || '').toLowerCase())).map((c) => c.n);
    const dupes = shared.filter((n) => (acFindCaps(n, 5) || []).some((c) => c.n === n));
    // Every destination a capability offers must be a place that genuinely exists.
    const cats = [...new Set(_caps.map((c) => c.c))];
    const badWhere = cats.filter((c) => { const w = acCapPlace(c); return w && !placeNames.has(w.label.toLowerCase()); });
    // A capability row must lead somewhere: a real place, or the assistant.
    const noRoute = typeof acCapTap === 'function' ? [] : ['acCapTap missing'];
    return { n: idx.length, caps: _caps.length, missing, dupes, badWhere, noRoute,
             guide: acAiGuide().length, hints: acAiHints('how do I cash out to my bank') };
  }, built);

  ok(r.caps > 400, 'the catalogue reaches the page (' + r.caps + ' features)');
  ok(r.missing.length === 0, r.missing.length
    ? r.missing.length + ' built features find NOTHING in search: ' + r.missing.slice(0, 6).join(', ')
    : 'every one of ' + built.length + ' built features is findable in search');
  ok(r.dupes.length === 0, r.dupes.length ? 'listed as both a page and a feature: ' + r.dupes.slice(0, 5).join(', ') : 'nothing is offered twice');
  ok(r.badWhere.length === 0, r.badWhere.length ? 'a feature points at a place that does not exist: ' + r.badWhere.join(', ') : 'every "where it lives" chip names a real place');
  ok(r.noRoute.length === 0, 'a feature row always leads somewhere');
  ok(r.guide < 12000, 'the assistant\'s guide fits its cap (' + r.guide + ' of 12000)');
  ok(r.guide < 9600, 'and with room to grow (under 80% of the cap)');
  ok(/Wallet/.test(r.hints), 'the app\'s own ranker feeds the assistant its hints (' + (r.hints.split('\n')[0] || 'nothing') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));

  await br.close();
  await pool.end();
  console.log('\n' + pass + ' passed, ' + fail + ' FAILED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e && e.message); process.exit(1); });
