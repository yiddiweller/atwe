/* ═══════════════════════════════════════════════
   WEBAUTHN  —  passkeys: signing in with a face, a fingerprint or a PIN
   ───────────────────────────────────────────────
   A passkey is a key pair. The private half never leaves the phone or laptop
   and is unlocked by the device's own biometrics; the public half lives here.
   Signing in means the device signs a random challenge, and we check the
   signature. Nothing secret is ever sent, so there is nothing to phish and
   nothing to steal from a database breach.

   Written by hand against the W3C spec — no library, which is the same rule
   the rest of this codebase follows. That means a small CBOR reader (the
   attestation object is CBOR) and a COSE key decoder, both below, both
   deliberately narrow: they read exactly the shapes WebAuthn produces and
   refuse anything else rather than trying to be general parsers.

   Supported algorithms: ES256 (what Apple, Google and Windows Hello all use)
   and RS256 (older Windows Hello / some security keys). Anything else is
   refused rather than half-verified.
═══════════════════════════════════════════════ */
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');

/* ─── A very small CBOR reader ─────────────────────────────────────────────
   Enough for an attestation object and a COSE key: maps, arrays, byte
   strings, text strings, unsigned and negative integers. It returns the value
   AND the offset it stopped at, so nested structures can be walked. Anything
   it does not recognise throws — a parser that guesses is a parser that can be
   fooled. */
function cborRead(buf, pos) {
  if (pos >= buf.length) throw new Error('CBOR: ran off the end');
  const first = buf[pos];
  const major = first >> 5;
  const minor = first & 0x1f;
  let val = minor;
  let p = pos + 1;
  if (minor === 24) { val = buf.readUInt8(p); p += 1; }
  else if (minor === 25) { val = buf.readUInt16BE(p); p += 2; }
  else if (minor === 26) { val = buf.readUInt32BE(p); p += 4; }
  else if (minor === 27) { throw new Error('CBOR: 64-bit lengths are not expected here'); }
  else if (minor > 27) throw new Error('CBOR: bad length');

  switch (major) {
    case 0: return { value: val, pos: p };                    // unsigned int
    case 1: return { value: -1 - val, pos: p };               // negative int
    case 2: {                                                 // byte string
      const end = p + val;
      if (end > buf.length) throw new Error('CBOR: byte string overruns');
      return { value: buf.subarray(p, end), pos: end };
    }
    case 3: {                                                 // text string
      const end = p + val;
      if (end > buf.length) throw new Error('CBOR: text overruns');
      return { value: buf.subarray(p, end).toString('utf8'), pos: end };
    }
    case 4: {                                                 // array
      const out = [];
      for (let i = 0; i < val; i++) { const r = cborRead(buf, p); out.push(r.value); p = r.pos; }
      return { value: out, pos: p };
    }
    case 5: {                                                 // map
      const out = new Map();
      for (let i = 0; i < val; i++) {
        const k = cborRead(buf, p); const v = cborRead(buf, k.pos);
        out.set(k.value, v.value); p = v.pos;
      }
      return { value: out, pos: p };
    }
    case 7:                                                   // simple values
      if (minor === 20) return { value: false, pos: p };
      if (minor === 21) return { value: true, pos: p };
      if (minor === 22) return { value: null, pos: p };
      throw new Error('CBOR: unsupported simple value');
    default: throw new Error('CBOR: unsupported type');
  }
}

/* ─── authenticatorData ────────────────────────────────────────────────────
   A fixed-layout blob: 32 bytes of RP ID hash, 1 flag byte, a 4-byte counter,
   and — on registration — the new credential appended. */
function parseAuthData(buf) {
  if (buf.length < 37) throw new Error('authenticator data is too short');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const out = {
    rpIdHash, flags, signCount,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    hasCredential: !!(flags & 0x40),
  };
  if (out.hasCredential) {
    if (buf.length < 55) throw new Error('credential data is truncated');
    const idLen = buf.readUInt16BE(53);
    const idEnd = 55 + idLen;
    if (buf.length < idEnd) throw new Error('credential id overruns');
    out.aaguid = buf.subarray(37, 53);
    out.credentialId = buf.subarray(55, idEnd);
    // The public key is a COSE map immediately after the id.
    const { value: cose } = cborRead(buf, idEnd);
    out.coseKey = cose;
  }
  return out;
}

/* ─── COSE key → something node's crypto can verify with ───────────────────
   Only the two algorithms real devices actually use. An unknown curve or
   algorithm is refused: a signature we cannot properly check is worse than no
   signature at all, because it looks like security. */
const COSE = { KTY: 1, ALG: 3, CRV: -1, X: -2, Y: -3, N: -1, E: -2 };
function coseToKey(cose) {
  if (!(cose instanceof Map)) throw new Error('public key is not a COSE map');
  const kty = cose.get(COSE.KTY);
  const alg = cose.get(COSE.ALG);
  if (kty === 2) {                                            // EC2
    if (alg !== -7) throw new Error('unsupported EC algorithm');
    if (cose.get(COSE.CRV) !== 1) throw new Error('unsupported curve');
    const x = cose.get(COSE.X), y = cose.get(COSE.Y);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('bad EC point');
    // Uncompressed point → JWK, which node accepts directly.
    const key = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) },
      format: 'jwk',
    });
    return { key, alg: 'ES256' };
  }
  if (kty === 3) {                                            // RSA
    if (alg !== -257) throw new Error('unsupported RSA algorithm');
    const n = cose.get(COSE.N), e = cose.get(COSE.E);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) throw new Error('bad RSA key');
    const key = crypto.createPublicKey({
      key: { kty: 'RSA', n: b64url(n), e: b64url(e) },
      format: 'jwk',
    });
    return { key, alg: 'RS256' };
  }
  throw new Error('unsupported key type');
}

// Store the key in a form we can read back later without re-parsing CBOR.
function exportKey(cose) {
  const { key, alg } = coseToKey(cose);
  return { pem: key.export({ type: 'spki', format: 'pem' }).toString(), alg };
}

function verifySignature(pem, alg, data, sig) {
  const key = crypto.createPublicKey(pem);
  if (alg === 'ES256') {
    // WebAuthn ES256 signatures are DER-encoded, which node verifies natively.
    return crypto.createVerify('SHA256').update(data).verify({ key, dsaEncoding: 'der' }, sig);
  }
  if (alg === 'RS256') return crypto.createVerify('SHA256').update(data).verify(key, sig);
  return false;
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest();

/* The client sends back what it signed over. Every field here is checked, not
   trusted: the type, the challenge we issued, and the origin — that last one
   is what makes a passkey un-phishable, so it is never skipped. */
function checkClientData(clientDataJSON, expectedType, expectedChallenge, allowedOrigins) {
  let d;
  try { d = JSON.parse(Buffer.from(clientDataJSON).toString('utf8')); }
  catch (e) { throw new Error('the browser sent something we could not read'); }
  if (d.type !== expectedType) throw new Error('this response is for the wrong kind of request');
  if (d.challenge !== expectedChallenge) throw new Error('that sign-in attempt has expired — try again');
  const origin = String(d.origin || '');
  if (!allowedOrigins.includes(origin)) throw new Error('this came from an unexpected address');
  return d;
}

/* ─── Registration ─────────────────────────────────────────────────────────
   Attestation is deliberately NOT verified: we use "none" attestation, which
   is what Apple and Google issue by default anyway. Verifying it would tell us
   which brand of device somebody used — a privacy cost for no security gain in
   a consumer product. What matters is the key, the origin and the challenge. */
function verifyRegistration({ attestationObject, clientDataJSON, expectedChallenge, allowedOrigins, rpId }) {
  checkClientData(clientDataJSON, 'webauthn.create', expectedChallenge, allowedOrigins);
  const { value: att } = cborRead(Buffer.from(attestationObject), 0);
  if (!(att instanceof Map)) throw new Error('bad attestation');
  const authData = att.get('authData');
  if (!Buffer.isBuffer(authData)) throw new Error('missing authenticator data');
  const parsed = parseAuthData(authData);
  if (!parsed.userPresent) throw new Error('the device did not confirm you were there');
  if (!parsed.hasCredential) throw new Error('no passkey was created');
  if (!parsed.rpIdHash.equals(sha256(rpId))) throw new Error('this passkey was made for a different site');
  const { pem, alg } = exportKey(parsed.coseKey);
  return {
    credentialId: b64url(parsed.credentialId),
    publicKeyPem: pem, alg,
    signCount: parsed.signCount,
    userVerified: parsed.userVerified,
  };
}

/* ─── Signing in ───────────────────────────────────────────────────────────
   The device signs authenticatorData + sha256(clientDataJSON). */
function verifyAssertion({ authenticatorData, clientDataJSON, signature, expectedChallenge, allowedOrigins, rpId, publicKeyPem, alg, storedSignCount }) {
  checkClientData(clientDataJSON, 'webauthn.get', expectedChallenge, allowedOrigins);
  const authData = Buffer.from(authenticatorData);
  const parsed = parseAuthData(authData);
  if (!parsed.userPresent) throw new Error('the device did not confirm you were there');
  if (!parsed.rpIdHash.equals(sha256(rpId))) throw new Error('this passkey belongs to a different site');
  const signed = Buffer.concat([authData, sha256(Buffer.from(clientDataJSON))]);
  if (!verifySignature(publicKeyPem, alg, signed, Buffer.from(signature))) throw new Error('that passkey did not check out');
  /* The counter catches a cloned authenticator: a real device only ever counts
     up. Many modern passkeys (Apple, Google) always report 0 — that is normal
     and explicitly allowed by the spec, so 0 is not treated as a failure. */
  let cloned = false;
  if (parsed.signCount > 0 && storedSignCount > 0 && parsed.signCount <= storedSignCount) cloned = true;
  return { signCount: parsed.signCount, userVerified: parsed.userVerified, cloned };
}

function newChallenge() { return crypto.randomBytes(32).toString('base64url'); }

module.exports = { newChallenge, verifyRegistration, verifyAssertion, b64url, fromB64url, parseAuthData, cborRead };
