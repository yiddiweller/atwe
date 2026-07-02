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
    // A random jti makes every issued token unique even when two are signed for the
    // same user in the same second — so each maps to a DISTINCT auth_sessions row
    // (one device = one session), which device-linking and rapid logins both rely on.
    { id: user.id, email: user.email, is_admin: user.is_admin, jti: crypto.randomBytes(9).toString('hex') },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

// A short-lived token used only in the SSE stream URL (URLs can leak into logs,
// so we never put the 30-day token there). Scoped with stream:true, and bound to
// the issuing session's hash (`sh`) so a revoked/logged-out session can't keep a
// realtime connection alive past the short positive-cache window.
function signStreamToken(user, tokenHash) {
  return jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin, stream: true, sh: tokenHash || null }, SECRET, { expiresIn: '30m' });
}

// Site-lock bypass: a signed cookie proving the visitor entered the access code.
// Carries no identity — just `pass:true`. Valid for `minutes` (the admin's
// "re-enter the code" interval).
function signGatePass(minutes) {
  const mins = Math.max(1, parseInt(minutes, 10) || 60);
  return jwt.sign({ pass: true }, SECRET, { expiresIn: mins * 60 });
}

// Short-lived token proving Google verified this email, used to carry a new
// Google user through the onboarding steps (birthday / password / username)
// before the account row is created.
function signGoogleSignupToken(data) {
  return jwt.sign({ gsignup: true, email: data.email, name: data.name || '', picture: data.picture || '' }, SECRET, { expiresIn: '30m' });
}

// Same idea for a new Sign in with Apple user (Apple provides no picture).
function signAppleSignupToken(data) {
  return jwt.sign({ asignup: true, email: data.email, name: data.name || '', sub: data.sub || '' }, SECRET, { expiresIn: '30m' });
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

/* ───────────────────────────────────────────────
   Session revocation: every token's hash must still have a row in
   auth_sessions. A short positive cache avoids a DB hit on every request;
   revoking clears the relevant cache entry so it takes effect at once.
─────────────────────────────────────────────── */
const _sessOk = new Map(); // token_hash -> validUntil (ms)
const SESSION_TTL = 60 * 1000;
async function sessionValid(tokenHash) {
  if (!db.isConfigured()) return true; // no session store; auth routes need the DB anyway
  const now = Date.now();
  const cached = _sessOk.get(tokenHash);
  if (cached && cached > now) return true;
  try {
    const { rows } = await db.query('SELECT 1 FROM auth_sessions WHERE token_hash = $1', [tokenHash]);
    if (!rows[0]) return false; // revoked / signed out elsewhere
    _sessOk.set(tokenHash, now + SESSION_TTL);
    db.query('UPDATE auth_sessions SET last_seen = now() WHERE token_hash = $1', [tokenHash]).catch(() => {});
    return true;
  } catch (e) {
    return true; // fail-open on a DB blip (availability over strict revocation during an outage)
  }
}
function sessionInvalidate(tokenHash) { if (tokenHash) _sessOk.delete(tokenHash); }
function sessionInvalidateAll() { _sessOk.clear(); }

// Requires a valid, non-revoked token; 401 otherwise. Populates req.user.
async function requireAuth(req, res, next) {
  const token = bearer(req);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  if (!(await sessionValid(hashToken(token)))) return res.status(401).json({ error: 'Your session was signed out. Please sign in again.' });
  req.user = payload;
  req.tokenHash = hashToken(token);
  next();
}

// Populates req.user when a valid, non-revoked token is present, but never
// blocks. Used by /api/chat so guests (local-only) still work.
async function optionalAuth(req, res, next) {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (payload && (await sessionValid(hashToken(token)))) { req.user = payload; req.tokenHash = hashToken(token); }
  else req.user = null;
  next();
}

// Requires the token to belong to an admin. Re-checks the DB so a revoked
// admin loses access immediately rather than only when the 30-day token expires.
async function requireAdmin(req, res, next) {
  const token = bearer(req);
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  if (!payload.is_admin) return res.status(403).json({ error: 'Admin access required' });
  if (!(await sessionValid(hashToken(token)))) return res.status(401).json({ error: 'Your session was signed out. Please sign in again.' });
  try {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id = $1', [payload.id]);
    if (!rows[0] || !rows[0].is_admin) return res.status(403).json({ error: 'Admin access required' });
  } catch (e) {
    return res.status(503).json({ error: 'Service temporarily unavailable.' });
  }
  req.user = payload;
  req.tokenHash = hashToken(token);
  next();
}

// Requires a specific admin permission SCOPE (staff RBAC / least-privilege). A
// superadmin (`is_admin`) always passes; otherwise the account must carry the scope
// in `admin_perms`. Re-checks the DB so a revoked grant loses access immediately.
// `req.adminPerms` is populated so routes/handlers can read the caller's scopes.
function requirePerm(scope) {
  return async function (req, res, next) {
    const token = bearer(req);
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Authentication required' });
    if (!(await sessionValid(hashToken(token)))) return res.status(401).json({ error: 'Your session was signed out. Please sign in again.' });
    try {
      const { rows } = await db.query('SELECT is_admin, admin_perms FROM users WHERE id = $1', [payload.id]);
      const row = rows[0];
      if (!row) return res.status(403).json({ error: 'Admin access required' });
      const perms = Array.isArray(row.admin_perms) ? row.admin_perms : [];
      if (!row.is_admin && !perms.includes(scope)) return res.status(403).json({ error: 'You don’t have access to this section.' });
      req.user = payload;
      req.tokenHash = hashToken(token);
      req.isSuperAdmin = !!row.is_admin;
      req.adminPerms = row.is_admin ? 'all' : perms;
    } catch (e) {
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
    next();
  };
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
  if (own.includes(low)) return 'Your password can’t be your name, email or handle.';
  return null;
}

/* ───────────────────────────────────────────────
   TOTP (RFC 6238) two-factor — implemented with Node crypto (no extra dep).
   A 20-byte secret is base32-encoded for authenticator apps; codes are 6-digit
   HMAC-SHA1 over a 30-second counter, checked with a ±1 step window for clock skew.
─────────────────────────────────────────────── */
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/,'').replace(/\s/g,'');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}
// The otpauth:// URI an authenticator app scans (or that the user enters manually).
function totpUri(secret, label, issuer = 'Atwe') {
  const acct = encodeURIComponent(label || 'account');
  return `otpauth://totp/${encodeURIComponent(issuer)}:${acct}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
function totpCodeForStep(secret, step) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  // 64-bit big-endian counter (top 32 bits are ~0 for any realistic time).
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}
function verifyTotp(secret, token, window = 1) {
  const t = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t) || !secret) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    // Constant-ish compare is fine here (codes are short-lived, low-entropy by design).
    if (totpCodeForStep(secret, step + w) === t) return true;
  }
  return false;
}

// Recovery (backup) codes: high-entropy single-use codes so a user who loses
// their authenticator can still sign in. We return the plaintext once and store
// only their SHA-256 hashes. Format: "xxxxx-xxxxx" (Crockford-ish base32).
function generateRecoveryCodes(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; // no easily-confused chars
  const codes = [];
  for (let i = 0; i < n; i++) {
    const bytes = crypto.randomBytes(8);
    let s = '';
    for (let j = 0; j < 10; j++) s += abc[bytes[j % 8] % abc.length];
    codes.push(s.slice(0, 5) + '-' + s.slice(5, 10));
  }
  return codes;
}
function normalizeRecoveryCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

module.exports = {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  signToken,
  signStreamToken,
  signGatePass,
  signGoogleSignupToken,
  signAppleSignupToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
  requirePerm,
  makeToken,
  hashToken,
  passwordIssue,
  sessionValid,
  sessionInvalidate,
  sessionInvalidateAll,
};
