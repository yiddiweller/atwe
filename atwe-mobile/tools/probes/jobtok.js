/* The probe database, not production. Override with real env vars if yours differ. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'scoresecret';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://atwe:atwe@localhost:5432/atwescore';
const REPO = process.env.REPO || require('path').resolve(__dirname, '../../..');
const crypto = require('crypto');
const auth = require(REPO + '/auth.js');
const db = require(REPO + '/db.js');
(async () => {
  const id = Number(process.argv[2]);
  const { rows } = await db.query('SELECT id,email,is_admin,username,name,account_type FROM users WHERE id=$1', [id]);
  const u = rows[0];
  const t = auth.signToken({ id: u.id, email: u.email, is_admin: !!u.is_admin });
  await db.query(
    `INSERT INTO auth_sessions (token_hash, user_id, user_agent, ip, last_seen)
     VALUES ($1,$2,'probe','127.0.0.1',now()) ON CONFLICT (token_hash) DO NOTHING`,
    [crypto.createHash('sha256').update(t).digest('hex'), u.id],
  );
  console.log(JSON.stringify({ token: t, user: u }));
  process.exit(0);
})();
