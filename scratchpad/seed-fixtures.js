/* Give the regression's own account the world it needs BEFORE any probe runs.
 *
 * Four probes came back red on build 1845 — chatscroll, openbottom and friends —
 * and the app was fine: the account they sign in as had a NINE message
 * conversation, so "can you scroll a conversation" measured 0 -> 0 and reported a
 * failure on a perfectly good scroller. The same shape as every fixture lesson in
 * this repo: a probe that depends on somebody having seeded something by hand will
 * eventually run against nothing and say so in the language of a bug.
 *
 * Idempotent: it tops the thread up to MIN_MSGS and does nothing if it is already
 * there, so running it before every regression costs a query.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const { Pool } = require(ROOT + '/node_modules/pg');
const auth = require(ROOT + '/auth');
const MIN_MSGS = 80;
const tokFile = '/tmp/tok.txt';

(async () => {
  let tok;
  try { tok = require('fs').readFileSync(tokFile, 'utf8').trim(); } catch (e) { console.log('no token — nothing to seed'); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore' });
  try {
    const h = crypto.createHash('sha256').update(tok).digest('hex');
    const who = (await pool.query('SELECT user_id FROM auth_sessions WHERE token_hash = $1', [h])).rows[0];
    if (!who) { console.log('token has no session — nothing to seed'); return; }
    const me = who.user_id;
    // A peer to talk to: reuse one if a thread already exists, else make one.
    let peer = (await pool.query(
      `SELECT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS id FROM at_messages
       WHERE (sender_id = $1 OR recipient_id = $1) AND sender_id <> recipient_id
         AND thread_id IS NULL LIMIT 1`, [me])).rows[0];
    if (!peer) {
      const e = crypto.randomUUID().slice(0, 8) + '@t.local';
      const ph = await auth.hashPassword('x'.repeat(12));
      const u = 'fx' + crypto.randomUUID().replace(/-/g, '').slice(0, 9);
      const { rows } = await pool.query(
        `INSERT INTO users (name,email,password_hash,username,email_verified,onboarded,last_seen)
         VALUES ('Fixture Peer',$1,$2,$3,true,true,now()) RETURNING id`, [e, ph, u]);
      peer = { id: rows[0].id };
    }
    const [{ n }] = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM at_messages WHERE thread_id IS NULL
         AND ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))`, [me, peer.id])).rows;
    if (n >= MIN_MSGS) { console.log('conversation already ' + n + ' messages — nothing to do'); return; }
    const want = MIN_MSGS - n;
    for (let i = 0; i < want; i++) {
      const mine = i % 2 === 0;
      await pool.query('INSERT INTO at_messages (sender_id,recipient_id,body,client_id) VALUES ($1,$2,$3,$4)',
        [mine ? me : peer.id, mine ? peer.id : me,
         'Fixture message ' + i + ' — long enough to take a whole line in the thread.', crypto.randomUUID()]);
    }
    console.log('topped the conversation up ' + n + ' -> ' + MIN_MSGS + ' messages');
  } finally { await pool.end(); }
})().catch((e) => { console.log('seeding skipped: ' + (e && e.message)); });
