/* ═══════════════════════════════════════════════
   AUTH  —  password hashing + JWT issuance/verification
═══════════════════════════════════════════════ */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const EXPIRES_IN = '30d';

if (!process.env.JWT_SECRET) {
  // Never let an insecure, publicly-known signing key reach production — every
  // token would be forgeable (full account/admin takeover).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production. Refusing to start with an insecure fallback.');
  }
  console.warn(
    '⚠️  JWT_SECRET not set — using an insecure dev fallback. Set JWT_SECRET in production.'
  );
}

// A real bcrypt hash used to equalize login timing when an email isn't found.
const DUMMY_HASH = bcrypt.hashSync('atwe-timing-equalizer', 10);

function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Token carries just enough to identify + authorize without a DB hit.
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, is_admin: user.is_admin },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

// A short-lived token used only in the SSE stream URL (URLs can leak into logs,
// so we never put the 30-day token there). Scoped with stream:true.
function signStreamToken(user) {
  return jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin, stream: true }, SECRET, { expiresIn: '30m' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Requires a valid token; 401 otherwise. Populates req.user.
function requireAuth(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  req.user = payload;
  next();
}

// Populates req.user when a valid token is present, but never blocks.
// Used by /api/chat so guests (local-only) still work.
function optionalAuth(req, res, next) {
  req.user = verifyToken(bearer(req)) || null;
  next();
}

// Requires the token to belong to an admin. Re-checks the DB so a revoked
// admin loses access immediately rather than only when the 30-day token expires.
async function requireAdmin(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  if (!payload.is_admin) return res.status(403).json({ error: 'Admin access required' });
  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [payload.id]);
    if (!rows[0] || !rows[0].is_admin) return res.status(403).json({ error: 'Admin access required' });
  } catch (e) {
    return res.status(503).json({ error: 'Service temporarily unavailable.' });
  }
  req.user = payload;
  next();
}

/* ───────────────────────────────────────────────
   Single-use tokens (email verification / password reset)
   The raw token goes in the emailed link; only its hash is stored.
─────────────────────────────────────────────── */
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/* ───────────────────────────────────────────────
   Password strength — reject the obviously-weak ones (common passwords,
   single-character or simple sequences, or the user's own name/email/handle).
   Returns a human message when weak, or null when acceptable. Length is
   enforced separately by the routes (>= 8).
─────────────────────────────────────────────── */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '12345678', '123456789',
  '1234567890', '123123123', '111111', '11111111', '00000000', '12341234',
  'qwerty', 'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfasdf',
  'iloveyou', 'admin123', 'welcome1', 'welcome123', 'letmein1', 'abc12345',
  'abcd1234', 'aaaaaaaa', 'football', 'baseball', 'sunshine', 'princess',
  'whatever', 'trustno1', 'dragon123', 'monkey12', 'starwars', 'superman',
  'michael1', 'computer', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'q1w2e3r4',
]);
function passwordIssue(password, ctx = {}) {
  const pw = String(password || '');
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  const low = pw.toLowerCase();
  if (COMMON_PASSWORDS.has(low)) return 'That password is too common — please choose a stronger one.';
  if (/^(.)\1+$/.test(pw)) return 'Please choose a stronger password (not a single repeated character).';
  // Straight ascending/descending runs like 12345678 or abcdefgh.
  const isRun = (s) => {
    if (s.length < pw.length) return false;
    let up = true, down = true;
    for (let i = 1; i < s.length; i++) {
      if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== 1) up = false;
      if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== -1) down = false;
    }
    return up || down;
  };
  if (isRun(low)) return 'Please choose a stronger password (not a simple sequence).';
  // Don't let the password just be their own handle/name/email local-part.
  const own = [ctx.username, ctx.name, (ctx.email || '').split('@')[0]]
    .map((s) => String(s || '').trim().toLowerCase()).filter((s) => s.length >= 4);
  if (own.includes(low)) return 'Your password can’t be your name, email or username.';
  return null;
}

module.exports = {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
  signToken,
  signStreamToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
  makeToken,
  hashToken,
  passwordIssue,
};
