/* ═══════════════════════════════════════════════
   STORAGE  —  put media in an object store instead of the database
   ───────────────────────────────────────────────
   Every photo, video and document in Atwe is currently a base64 data URL in a
   Postgres column. That works, and it is why the app runs with nothing but a
   database — but it means the database carries every byte anyone ever
   uploaded, and it caps how big a file can sensibly be.

   This moves new uploads to an S3-compatible bucket (AWS S3, Cloudflare R2,
   Backblaze B2, MinIO — they all speak the same API) and serves them from a
   CDN. Signed with SigV4 by hand: no SDK, no new dependency, which is the same
   rule the rest of this codebase follows.

   OPTIONAL, like every integration here. With nothing configured,
   isConfigured() is false and the app stores base64 exactly as it always has.
   Nothing already stored is touched or migrated — old rows keep working
   through the existing /api/media route, and new ones simply point at a URL.

   Set: S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, and either S3_ENDPOINT
   (R2/B2/MinIO) or S3_REGION (AWS).

   CDN_URL IS NOT OPTIONAL ON R2, and this comment said it was for several
   builds. What goes into the post is the URL publicUrl() returns, and mediaRef
   passes any non-data: value straight to the browser — so that address has to be
   one a member's phone can actually fetch. With no CDN_URL on R2 it falls back
   to the S3 API endpoint (*.r2.cloudflarestorage.com), which only answers SIGNED
   requests: every upload would succeed and every photo would render broken.
   Point CDN_URL at the bucket's public address (pub-*.r2.dev, or a custom
   domain). selfTest() reports this as `readable:false`, and the dashboard now
   treats that as a failure rather than a pass with a footnote.
═══════════════════════════════════════════════ */
const crypto = require('crypto');

/* EVERY ONE OF THESE IS TRIMMED, AND THAT IS NOT DEFENSIVE PADDING — it is a
   bug we shipped. A value pasted into a hosting dashboard picks up a leading or
   trailing space with no visible trace, and R2 refused every upload with
   `InvalidRegionName: the region name ' auto' is not valid` — while listing
   `auto` among the valid names, which is exactly how invisible this is. The
   same stray space in the SECRET would be far worse: the signature would come
   out wrong and the store would answer `SignatureDoesNotMatch`, which reads as
   a wrong key and sends you off rotating credentials that were correct all
   along. A matched pair of surrounding quotes is stripped too — pasting
   "auto" WITH the quotes is the other half of the same mistake, and no real
   value here is quoted at both ends. */
const envStr = (name, dflt = '') => {
  let v = process.env[name];
  if (v == null) return dflt;
  v = String(v).trim();
  if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
    v = v.slice(1, -1).trim();
  }
  return v || dflt;
};

const BUCKET = envStr('S3_BUCKET');
const ACCESS = envStr('S3_ACCESS_KEY');
const SECRET = envStr('S3_SECRET_KEY');
const REGION = envStr('S3_REGION', 'auto');
const ENDPOINT = envStr('S3_ENDPOINT').replace(/\/$/, '');
const CDN = envStr('CDN_URL').replace(/\/$/, '');
const PREFIX = (envStr('S3_PREFIX', 'atwe')).replace(/^\/|\/$/g, '');

const ok = !!(BUCKET && ACCESS && SECRET);
if (!ok) {
  console.warn('⚠️  Object storage not configured. Media stays in the database (which is fine, just heavier). Set S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY to move it out.');
}

function isConfigured() { return ok; }

// What the store actually said the last time an upload was refused. Read only by
// selfTest(), so the dashboard can show a reason instead of a shrug.
let _lastError = '';

// Where the bucket actually lives. A custom endpoint (R2/B2/MinIO) is used
// path-style; AWS is used virtual-host style, which is what it prefers.
function bucketHost() {
  if (ENDPOINT) return ENDPOINT.replace(/^https?:\/\//, '');
  return `${BUCKET}.s3.${REGION === 'auto' ? 'us-east-1' : REGION}.amazonaws.com`;
}
function objectPath(key) {
  return ENDPOINT ? `/${BUCKET}/${key}` : `/${key}`;
}
// The address a browser fetches — so it must be publicly readable. The fallback
// below is only correct for AWS (virtual-host style + a public-read object); on
// R2/B2/MinIO the endpoint is the private API host and CDN_URL is required.
function publicUrl(key) {
  if (CDN) return `${CDN}/${key}`;
  return `https://${bucketHost()}${ENDPOINT ? '/' + BUCKET : ''}/${key}`;
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const hmac = (k, v) => crypto.createHmac('sha256', k).update(v).digest();

/* AWS Signature Version 4, by hand. Long, but it is just the recipe from the
   spec written out — and it is the only thing standing between us and pulling
   in a large SDK for what is ultimately one PUT and one DELETE. */
function sign({ method, key, payloadHash, contentType, acl }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20260726T221500Z
  const dateStamp = amzDate.slice(0, 8);
  const host = bucketHost();
  const canonicalUri = objectPath(key).split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');

  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (contentType) headers['content-type'] = contentType;
  if (acl) headers['x-amz-acl'] = acl;

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((h) => `${h}:${String(headers[h]).trim()}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  let k = hmac('AWS4' + SECRET, dateStamp);
  k = hmac(k, REGION); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex');

  headers.Authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { headers, url: `https://${host}${objectPath(key)}` };
}

// A stable, unguessable key. The random part matters: object keys are often
// effectively public, so they must not be enumerable.
function makeKey(kind, ext) {
  const safeKind = String(kind || 'file').replace(/[^a-z0-9-]/gi, '').slice(0, 24) || 'file';
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  const rand = crypto.randomBytes(16).toString('hex');
  const safeExt = String(ext || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase();
  return `${PREFIX}/${safeKind}/${day}/${rand}.${safeExt}`;
}

const EXT_FOR = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'weba', 'audio/wav': 'wav',
  'application/pdf': 'pdf',
};

/* Take a data URL and put the bytes in the bucket. Returns the public URL, or
   null on ANY failure — the caller then keeps the data URL, so a storage
   outage degrades to today's behaviour instead of losing somebody's photo. */
async function putDataUrl(dataUrl, kind) {
  if (!ok || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const m = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1].toLowerCase();
  let body;
  try { body = Buffer.from(m[2], 'base64'); } catch (e) { return null; }
  if (!body.length) return null;
  const key = makeKey(kind, EXT_FOR[contentType] || contentType.split('/')[1]);
  try {
    /* NO ACL ON ANYTHING BUT AWS. `x-amz-acl: public-read` is an Amazon
       convention; Cloudflare R2 has no per-object ACLs at all and REJECTS a
       request carrying that header, so every upload failed with a 400 while the
       signature itself was perfectly correct. The offline signing test proved
       the maths and could not have caught this — it never spoke to R2. Public
       readability on R2 comes from the bucket's custom domain, which is why
       CDN_URL is required there (see the header comment). */
    const { headers, url } = sign({
      method: 'PUT', key, payloadHash: sha256(body), contentType,
      acl: ENDPOINT ? null : 'public-read',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, { method: 'PUT', headers, body, signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
    if (!r.ok) {
      // Keep WHY, not just THAT. A bare "refused" sent us guessing at the key,
      // the bucket name and the permissions when the store was telling us
      // exactly what was wrong all along.
      let detail = '';
      try { detail = (await r.text() || '').slice(0, 300).replace(/\s+/g, ' ').trim(); } catch (e) {}
      _lastError = `HTTP ${r.status}${detail ? ' - ' + detail : ''}`;
      console.warn('[storage] upload failed', _lastError);
      return null;
    }
    _lastError = '';
    return publicUrl(key);
  } catch (e) {
    _lastError = (e && e.message) || 'request failed';
    console.warn('[storage] upload error:', _lastError);
    return null;
  }
}

// Best-effort delete. A file left behind costs pennies; a delete that throws
// and breaks someone deleting their own post costs trust.
async function remove(url) {
  if (!ok || typeof url !== 'string') return false;
  const key = keyFromUrl(url);
  if (!key) return false;
  try {
    const { headers, url: signed } = sign({ method: 'DELETE', key, payloadHash: sha256('') });
    const r = await fetch(signed, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    return r.ok || r.status === 204;
  } catch (e) { return false; }
}

// Ours, or somebody else's link? Only our own object URLs are ever deleted.
function keyFromUrl(url) {
  const s = String(url || '');
  if (CDN && s.startsWith(CDN + '/')) return s.slice(CDN.length + 1).split('?')[0];
  const base = `https://${bucketHost()}${ENDPOINT ? '/' + BUCKET : ''}/`;
  if (s.startsWith(base)) return s.slice(base.length).split('?')[0];
  return null;
}
function isStoredUrl(url) { return !!keyFromUrl(url); }

// A one-line health check for the dashboard: writes a tiny object, reads the
// response, deletes it. Proves the credentials AND the permissions.
async function selfTest() {
  if (!ok) return { ok: false, reason: 'not configured' };
  const probe = 'data:text/plain;base64,' + Buffer.from('atwe-storage-check').toString('base64');
  const url = await putDataUrl(probe, 'healthcheck');
  if (!url) {
    return { ok: false, reason: 'upload was refused: check the key, the bucket name and the permissions'
      + (_lastError ? ` (the store said: ${_lastError})` : '') };
  }
  let readable = false;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); readable = r.ok; } catch (e) { readable = false; }
  await remove(url);
  return { ok: true, readable, url, cdn: !!CDN, endpoint: ENDPOINT || 'aws', bucket: BUCKET };
}

/* ─── Uploading straight to the bucket ─────────────────────────────────────
   Everything above sends the bytes through our own server first, which caps a
   file at whatever the JSON body limit is (~18MB of real video). That is the
   actual reason Atwe could not take a long or high-definition clip.

   A presigned URL removes the ceiling entirely: we sign a permission slip, the
   browser PUTs the file straight to the bucket, and our server never touches
   the bytes at all. The signature is scoped to ONE key, ONE method and a short
   window, so it cannot be reused to overwrite anything else.

   This is SigV4 again, but with the signature in the query string rather than a
   header — a browser cannot set an Authorization header on a plain PUT it makes
   from a file input without the whole request being ours to build. */
function presignPut(contentType, kind, seconds) {
  if (!ok) return null;
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (!/^[a-z]+\/[a-z0-9.+-]+$/.test(ct)) return null;
  const key = makeKey(kind, EXT_FOR[ct] || ct.split('/')[1]);
  const expires = Math.min(3600, Math.max(60, seconds || 900));

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = bucketHost();
  const canonicalUri = objectPath(key).split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/');
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;

  // Only the host is signed, so the browser is free to send whatever else it
  // likes (Content-Type included) without invalidating the signature.
  const q = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });
  // S3 requires the query string sorted by key.
  const canonicalQuery = [...q.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  let k = hmac('AWS4' + SECRET, dateStamp);
  k = hmac(k, REGION); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(stringToSign).digest('hex');

  return {
    uploadUrl: `https://${host}${objectPath(key)}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    publicUrl: publicUrl(key),
    key, expiresIn: expires,
  };
}

module.exports = { isConfigured, putDataUrl, remove, isStoredUrl, publicUrl, selfTest, presignPut };
