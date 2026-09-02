/* Mint a bearer token for a probe run.
 *
 * The README says "TOK must be exported" and never said how to get one, so every session
 * rediscovered it — and got it wrong twice: `auth.signToken` alone is NOT enough, because
 * `requireAuth` also checks the token's SHA-256 against a live `auth_sessions` row (that is
 * the revocable session store), so a bare signed token 401s. It must also be minted with
 * the SAME `JWT_SECRET` the server is running under, or you silently get the insecure dev
 * fallback and a token the server will not accept.
 *
 *   cd /path/to/atwe
 *   DATABASE_URL=postgres://atwe:atwe@localhost:5432/atwescore JWT_SECRET=scoresecret \
 *     node scratchpad/mint-token.js <userId>
 *
 * It requires ../auth and ../db by relative path, so it works from anywhere.
 */
const crypto = require('crypto');
const auth = require('../auth');
const db = require('../db');

(async () => {
  const id = Number(process.argv[2] || 0);
  const r = id
    ? await db.query('SELECT id,email,is_admin FROM users WHERE id=$1', [id])
    : await db.query('SELECT id,email,is_admin FROM users WHERE username IS NOT NULL ORDER BY id LIMIT 1');
  const u = r.rows[0];
  if (!u) { console.error('no such account'); process.exit(1); }
  const tok = auth.signToken({ id: u.id, email: u.email, is_admin: u.is_admin });
  const hash = crypto.createHash('sha256').update(tok).digest('hex');
  await db.query(
    "INSERT INTO auth_sessions (token_hash,user_id,user_agent,ip,location,last_seen) " +
    "VALUES ($1,$2,'probe','127.0.0.1','local',now()) ON CONFLICT DO NOTHING", [hash, u.id]);
  console.log(tok);
  process.exit(0);
})();
