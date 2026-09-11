/* ATWE NEVER WRITES AN EM DASH — the guard, in three parts.
 *
 * The founder's instruction, and it is a brand decision rather than a style one: the long
 * dash is the most recognisable tell of machine-written text, so an app covered in them
 * reads as generated rather than made. They had asked once before, it was half-done, and
 * they still kept meeting them. Half-done is exactly what a one-off sweep produces, because
 * the assistant writes NEW text on every reply and the next feature brings its own copy.
 *
 * 1. THE SOURCE. Every run a person can read — a string, a template, an HTML text node, a
 *    placeholder/title/aria-label — across every file. Comments are excluded because nobody
 *    reads them, and SQL is excluded because a dash in a query is invisible too.
 * 2. THE ASSISTANT. A scripted model that answers with an em dash EVERY time, in front of
 *    the real server, so the instruction and the net are tested rather than assumed. A real
 *    model might simply not use one that day and leave the hole untested.
 * 3. THE EXCEPTION. The founder's own: "except if someone posted". A member's own words
 *    coming back from proofread keep their dash, because editing somebody's writing is the
 *    opposite of what this is for.
 *
 * FILES ARE RESOLVED FROM __dirname, never the working directory: run-all.sh cd's into this
 * folder, and a relative path here is green standalone and CRASHED in the suite.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const { readableRanges } = require(ROOT + '/tools/jstext.js');

let pass = 0; const fails = [];
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); }
  else { fails.push(m + (x !== undefined ? ' :: ' + x : '')); console.log('  FAIL ' + m + (x !== undefined ? ' :: ' + x : '')); } };

/* A query is not prose and a dash inside one reaches nobody. Kept identical to the rule the
   sweep itself used, so the guard and the fix can never disagree about what counts. */
const LOOKS_LIKE_CODE = /\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE|ALTER TABLE|WITH)\b[\s\S]*\b(FROM|VALUES|SET|WHERE|AS)\b/;
const DASH = /[—–]/;

function sourceSweep() {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'))
    .concat(['public/index.html', 'public/admin.html']);
  const hits = [];
  let runs = 0;
  for (const f of files) {
    let src; try { src = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }
    for (const [a, b] of readableRanges(src, f.endsWith('.html'))) {
      const run = src.slice(a, b);
      runs++;
      if (!DASH.test(run) || LOOKS_LIKE_CODE.test(run)) continue;
      hits.push(f + ':' + src.slice(0, a).split('\n').length + ' ' + JSON.stringify(run.replace(/\s+/g, ' ').trim().slice(0, 80)));
    }
  }
  return { hits, runs, files: files.length };
}

/* ── the scripted model: every answer carries a dash ─────────────────────────── */
let LAST_SYSTEM = null;
const REPLY = 'Your order shipped — it should arrive Tuesday.';
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    try { const p = JSON.parse(body); LAST_SYSTEM = typeof p.system === 'string' ? p.system : JSON.stringify(p.system || ''); } catch (e) {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001',
      content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});

function post(port, p, token, payload) {
  return new Promise((resolve, reject) => {
    const b = JSON.stringify(payload);
    const r = http.request({ host: 'localhost', port, path: p, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b), authorization: 'Bearer ' + token } },
      (rs) => { let s = ''; rs.on('data', (d) => { s += d; }); rs.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(new Error(s.slice(0, 200))); } }); });
    r.on('error', reject); r.end(b);
  });
}
/* Wait on a route BEHIND the "still setting up" gate. /api/health answers before db.init()
   finishes, so waiting on it races the schema build and every later call 503s. */
const wait = (port, tries) => new Promise((resolve, reject) => {
  const go = (n) => http.get({ host: 'localhost', port, path: '/api/config' }, (r) => (r.statusCode === 200 ? resolve() : retry(n)))
    .on('error', () => retry(n));
  const retry = (n) => (n <= 0 ? reject(new Error('server never came up')) : setTimeout(() => go(n - 1), 500));
  go(tries);
});

(async () => {
  const s = sourceSweep();
  console.log(`  (scanned ${s.runs} readable runs across ${s.files} files)`);
  ok(s.hits.length === 0, 'nothing a person can read carries an em dash or an en dash',
    s.hits.length ? s.hits.length + ' left, first: ' + s.hits[0] : '');
  if (s.hits.length) s.hits.slice(0, 12).forEach((h) => console.log('        ' + h));

  if (!process.env.DATABASE_URL && !process.env.PGHOST) {
    console.log('  (no database — the live assistant half is skipped)');
    console.log(`\n${pass} passed, ${fails.length} FAILED`);
    if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
    return;
  }

  const { Pool } = require(ROOT + '/node_modules/pg');
  const auth = require(ROOT + '/auth.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
  const mkPort = 4700 + (process.pid % 90), srvPort = mkPort + 100;
  await new Promise((r) => mock.listen(mkPort, r));

  const tag = 'nd' + crypto.randomUUID().slice(0, 6);
  const h = await auth.hashPassword('x'.repeat(12));
  const { rows } = await pool.query(
    `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded)
     VALUES ($1,$2,$3,$4,true,true) RETURNING id`, [tag, tag + '@t.local', h, tag]);
  const uid = rows[0].id;
  const token = auth.signToken({ id: uid, email: tag + '@t.local', is_admin: false });
  await pool.query("INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip) VALUES ($1,$2,'t','1.1.1.1')",
    [crypto.createHash('sha256').update(token).digest('hex'), uid]);

  const srv = spawn('node', [ROOT + '/server.js'], { env: { ...process.env,
    PORT: String(srvPort), ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://localhost:' + mkPort,
    JWT_SECRET: process.env.JWT_SECRET,
    DATABASE_URL: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' }, stdio: 'ignore' });
  try {
    await wait(srvPort, 80);

    // The model answers with a dash every single time. The member must never see one.
    const r = await post(srvPort, '/api/ai/write', token, { task: 'improve', text: 'hello there' });
    ok(typeof r.text === 'string' && !DASH.test(r.text), 'a reply that HAD a dash reaches the member without one',
      JSON.stringify(String(r.text).slice(0, 90)));
    ok(typeof r.text === 'string' && /shipped\. It should arrive/.test(r.text),
      'and it was turned into the punctuation the sentence wanted, not deleted', JSON.stringify(String(r.text).slice(0, 90)));
    ok(LAST_SYSTEM && /em dash/i.test(LAST_SYSTEM), 'the model was told not to use one in the first place');

    // The founder's exception. A member's own words come back untouched.
    LAST_SYSTEM = null;
    const p = await post(srvPort, '/api/ai/write', token, { task: 'proofread', text: 'my own words — mine' });
    ok(typeof p.text === 'string' && DASH.test(p.text), 'proofread hands a member their OWN dash back, unedited',
      JSON.stringify(String(p.text).slice(0, 90)));
    ok(LAST_SYSTEM && !/em dash/i.test(LAST_SYSTEM), 'and proofread is not even given the rule');
  } finally {
    srv.kill(); mock.close();
    await pool.query('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await pool.end().catch(() => {});
  }

  console.log(`\n${pass} passed, ${fails.length} FAILED`);
  if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.log('CRASH ' + e.stack); process.exit(1); });
