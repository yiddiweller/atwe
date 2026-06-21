// apple.js — Sign in with Apple (web).
//
// Optional + graceful-degradation, like billing.js / mailer.js: with no
// APPLE_CLIENT_ID the module reports `isConfigured() === false` and the Apple
// routes return a clear 503 instead of crashing.
//
// The web flow verifies the `id_token` Apple returns (a JWT signed by Apple)
// against Apple's published public keys (JWKS). No client secret / .p8 key is
// needed — that's only required for server-side authorization-code exchange,
// which the sign-in flow doesn't use.

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Accept a comma-separated list so the same deploy can also honor a native
// iOS app's bundle id (its id_token `aud`) once that app ships.
const CLIENT_IDS = (process.env.APPLE_CLIENT_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const ISS = 'https://appleid.apple.com';
const JWKS_URL = 'https://appleid.apple.com/auth/keys';

let _keys = null;
let _keysAt = 0;

function isConfigured() { return CLIENT_IDS.length > 0; }

// The public Services ID the frontend uses to start the popup (first entry).
function clientId() { return CLIENT_IDS[0] || null; }

async function getKeys() {
  if (_keys && Date.now() - _keysAt < 60 * 60 * 1000) return _keys; // cache 1h
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error('Apple JWKS fetch failed (' + r.status + ')');
  const j = await r.json();
  _keys = j.keys || [];
  _keysAt = Date.now();
  return _keys;
}

// Verify the id_token and return { sub, email, emailVerified }. Throws on any
// invalid token (bad signature / audience / issuer / expiry).
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') throw new Error('Missing Apple token.');
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) throw new Error('Malformed Apple token.');
  let keys = await getKeys();
  let jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) { _keys = null; keys = await getKeys(); jwk = keys.find((k) => k.kid === decoded.header.kid); } // key may have rotated
  if (!jwk) throw new Error('Unknown Apple signing key.');
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const claims = jwt.verify(idToken, pub, { algorithms: ['RS256'], issuer: ISS, audience: CLIENT_IDS });
  return {
    sub: claims.sub,
    email: (claims.email || '').toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  };
}

module.exports = { isConfigured, clientId, verifyIdToken };
