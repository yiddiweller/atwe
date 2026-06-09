/* ═══════════════════════════════════════════════
   AUTH  —  password hashing + JWT issuance/verification
═══════════════════════════════════════════════ */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const EXPIRES_IN = '30d';

if (!process.env.JWT_SECRET) {
  console.warn(
    '⚠️  JWT_SECRET not set — using an insecure dev fallback. Set JWT_SECRET in production.'
  );
}

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

// Requires the token to belong to an admin.
function requireAdmin(req, res, next) {
  const payload = verifyToken(bearer(req));
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  if (!payload.is_admin) return res.status(403).json({ error: 'Admin access required' });
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

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireAdmin,
  makeToken,
  hashToken,
};
