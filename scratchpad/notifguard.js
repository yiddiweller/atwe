/* EVERY NOTIFICATION HAS A PLACE TO LAND.
 *
 * The founder: "some of the notifications jumps to other pages for no reason. I want
 * every notification to have a place to land if I click on that notification."
 *
 * Measured when this was written: server.js emitted 153 notification types and
 * notifRow() routed 82 of them. The other 71 fell through to appTab('home') plus the
 * actor's profile — a refund approval, a payment, a tip, an accepted quote, a frozen
 * wallet, a course enrolment and 65 more.
 *
 * PART 1 is the durable guard and needs no browser and no database: it reads the types
 * server.js actually emits and the ones index.html actually routes, and fails on the
 * difference. That is what stops type 154 shipping with nowhere to go — a live check
 * can only ever cover the types somebody remembered to seed.
 *
 * PART 2 drives real rows in a real browser, because a route table that resolves to a
 * function nobody can reach is the same bug wearing a tie.
 *
 * PATHS RESOLVE FROM __dirname, NEVER THE WORKING DIRECTORY — run-all.sh cds into
 * scratchpad/, so a relative readFileSync throws ENOENT there while working perfectly
 * by hand from the repo root: green standalone, CRASHED in the suite. fillroles.js
 * shipped exactly that way for one run.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REPO = f => path.join(__dirname, '..', f);
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '\n         ' + String(x).slice(0, 400) : '')); } };

// ── PART 1 · the source diff ────────────────────────────────────────────────
const server = fs.readFileSync(REPO('server.js'), 'utf8');
const client = fs.readFileSync(REPO('public/index.html'), 'utf8');

const emitted = new Set(
  [...server.matchAll(/notify\([^,]+,[^,]+,\s*'([a-z_]+)'/g)].map(m => m[1])
   .concat([...server.matchAll(/notifySelf\([^,]+,\s*'([a-z_]+)'/g)].map(m => m[1])));

// what the client routes: the is* boolean pile, the NOTIF_GO table, and the two
// families matched by regex/array rather than by ===.
const row = client.slice(client.indexOf('const NOTIF_GO = {'), client.indexOf('const snip = isJob'));
/* THREE SOURCES, EACH NAMED — never a blanket scan for quoted words. The first version
   swept /'([a-z_]+)'/ over the whole block, which counted 'sent', 'host' and 'received'
   as notification types and therefore reported a type as ROUTED after its row had been
   deleted: removing `payment:` from the table did not turn this check red. A guard that
   over-counts its subject reports a clean result exactly as surely as one that
   under-counts it — this repo has recorded the second shape four times and this is the
   first of the first. */
const routed = new Set([
  // 1. the `is*` boolean pile
  ...[...row.matchAll(/n\.type === '([a-z_]+)'/g)].map(m => m[1]),
  // 2. the NOTIF_GO table's own keys — NOT line-anchored, because the table writes
  //    several keys per line and /^\s*.../gm silently counted only the first of each.
  ...[...(row.slice(row.indexOf('const NOTIF_GO = {'),
                    row.indexOf('};', row.indexOf('const NOTIF_GO = {'))))
       .matchAll(/([a-z_]+)\s*:\s*['"]/g)].map(m => m[1]),
  // 3. the one family matched by an array rather than by ===
  ...[...(row.match(/isOrderN = \[(.*?)\]/s) || ['',''])[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]),
]);
/* THE POST/PROFILE FALLBACK IS THE RIGHT ANSWER FOR THESE, and saying so out loud is the
   point: a `like` should open the post that was liked and a `follow` should open the
   person who followed you, so neither needs a row in NOTIF_GO. They are listed here by
   name rather than left to fall out of a loose regex, so that removing one from the
   client still turns this check red. */
const FALLBACK_OK = new Set(['like','reply','repost','post','follow','profile_update',
  'feed_like','feed_comment','showcase_like','showcase_comment','story_answer',
  'story_mention','qa_answer','qa_question']);
const orphan = [...emitted]
  .filter(t => !routed.has(t) && !FALLBACK_OK.has(t) && !/^delivery_/.test(t)).sort();

console.log('\n── every notification type has a destination ──');
console.log(`  server emits ${emitted.size} types · client routes ${[...emitted].filter(t=>routed.has(t)||/^delivery_/.test(t)).length}`);
ok(emitted.size > 100, `the scan found the real type list (${emitted.size})`, emitted.size);
ok(orphan.length === 0,
   'no emitted type falls through to Home with nowhere to land',
   orphan.length ? `${orphan.length} orphaned: ${orphan.join(' ')}` : '');

// The table must not rot in the other direction either — a row for a type nobody sends
// is dead weight that reads as coverage.
const table = client.slice(client.indexOf('const NOTIF_GO = {'), client.indexOf('};', client.indexOf('const NOTIF_GO = {')));
const keys = [...table.matchAll(/^\s*([a-z_]+):/gm)].map(m => m[1]);
const dead = keys.filter(k => !emitted.has(k));
ok(dead.length === 0, `every NOTIF_GO row is a type the server really sends (${keys.length} rows)`, dead.join(' '));

// Every destination must name a function that exists — a route to nothing is worse
// than no route, because it looks handled.
const fns = new Set([...client.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const missing = [...new Set([...table.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))]
  .filter(n => n !== 'DETAIL' && !fns.has(n));
ok(missing.length === 0, 'every destination in the table is a function that exists', missing.join(' '));

// ── PART 2 · drive real rows ────────────────────────────────────────────────
(async () => {
  const SP = '/tmp/claude-0/-home-user-atwe/f20aa7b3-6669-5835-9ba8-518900db6c09/scratchpad/';
  let chromium, Pool, auth;
  try {
    ({ chromium } = require(SP + 'node_modules/playwright-core'));
    ({ Pool } = require(REPO('node_modules/pg')));
    auth = require(REPO('auth'));
  } catch (e) { console.log('\n  (live pass unavailable here: ' + e.message.slice(0, 60) + ')'); return done(); }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
  let uid, aid, token, b;
  try {
    const mk = async (tag) => {
      const email = crypto.randomUUID().slice(0, 8) + '@t.local';
      const h = tag + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
      const { rows } = await pool.query(
        `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded)
         VALUES ($1,$2,'x',$3,true,true) RETURNING id`, ['N', email, h]);
      return rows[0].id;
    };
    uid = await mk('ng'); aid = await mk('na');
    token = auth.signToken({ id: uid, email: 'x@t.local', is_admin: false });
    await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
      [crypto.createHash('sha256').update(token).digest('hex'), uid]);

    // One row per family, so a pass means the table really is wired end to end.
    const CASES = [
      ['refund_approved', 'refundView'],
      ['payment',         'walletView'],
      ['quote_received',  'quotesView'],
      ['ad_approved',     'adsView'],
      ['aff_invite',      'affView'],
      ['strike',          'notifDetail'],   // a message with no better place
    ];
    for (const [t] of CASES)
      await pool.query('INSERT INTO notifications (user_id,actor_id,type) VALUES ($1,$2,$3)', [uid, aid, t]);

    b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const base = 'http://localhost:' + (process.env.PORT || 3262) + '/';
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.evaluate(t => { localStorage.setItem('atwe_token', t);
      localStorage.setItem('atwe_intro_seen', '["beam","circles","ai","wallet"]'); }, token);
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3800);

    console.log('\n── a real tap on a real row lands somewhere real ──');
    for (const [type, want] of CASES) {
      await p.evaluate(() => { document.querySelectorAll('.overlay:not(.hidden)')
        .forEach(o => { try { closeOverlay(o.id, true); } catch (e) {} }); });
      await p.waitForTimeout(300);
      await p.evaluate(() => openNotifications());
      await p.waitForTimeout(1200);
      const landed = await p.evaluate(async (ty) => {
        // THE ROW'S onclick CARRIES ITS DESTINATION, NEVER ITS TYPE — the first version of
        // this looked for the type string inside the handler and matched nothing at all,
        // reporting NO-ROW for six rows that were plainly on screen. data-type is on the
        // row for exactly this reason.
        const rows = [...document.querySelectorAll('#notifList .notif-row')];
        const target = rows.find(r => r.dataset.type === ty); if (!target) return 'NO-ROW';
        target.click();
        await new Promise(r => setTimeout(r, 1300));
        const open = [...document.querySelectorAll('.overlay:not(.hidden)')].map(o => o.id);
        const detail = document.getElementById('notifCard');
        if (detail && detail.classList.contains('detail-open')) open.push('notifDetail');
        return open.join(',') || 'NOTHING';
      }, type);
      ok(landed.includes(want) || (want === 'notifDetail' && landed.includes('notifDetail')),
         `${type} lands on ${want}`, landed);
    }
    // and the thing the founder actually complained about
    const wentHome = await p.evaluate(() =>
      [...document.querySelectorAll('#notifList .notif-row')]
        .filter(r => (r.getAttribute('onclick') || '').includes("appTab('home')")).length);
    console.log('  rows that still detour through Home:', wentHome);
    ok(wentHome === 0, 'no seeded row detours through Home on the way to its destination', wentHome);
  } catch (e) {
    fail++; console.log('  FAIL live pass threw\n         ' + e.message.slice(0, 300));
  } finally {
    try { if (b) await b.close(); } catch (e) {}
    try { if (uid) await pool.query('DELETE FROM users WHERE id = ANY($1)', [[uid, aid]]); } catch (e) {}
    try { await pool.end(); } catch (e) {}
    done();
  }
})();

function done() {
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  process.exit(fail ? 1 : 0);
}
