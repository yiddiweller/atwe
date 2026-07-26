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
   (R2/B2/MinIO) or S3_REGION (AWS). CDN_URL is optional; without it the files
   are served straight from the bucket's own public URL.
═══════════════════════════════════════════════ */
const crypto = require('crypto');

const BUCKET = process.env.S3_BUCKET;
const ACCESS = process.env.S3_ACCESS_KEY;
const SECRET = process.env.S3_SECRET_KEY;
const REGION = process.env.S3_REGION || 'auto';
const ENDPOINT = (process.env.S3_ENDPOINT || '').replace(/\/$/, '');
const CDN = (process.env.CDN_URL || '').replace(/\/$/, '');
const PREFIX = (process.env.S3_PREFIX || 'atwe').replace(/^\/|\/$/g, '');

const ok = !!(BUCKET && ACCESS && SECRET);
if (!ok) {
  console.warn('⚠️  Object storage not configured — media stays in the database (which is fine, just heavier). Set S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY to move it out.');
}

function isConfigured() { return ok; }

// Where the bucket actually lives. A custom endpoint (R2/B2/MinIO) is used
// path-style; AWS is used virtual-host style, which is what it prefers.
function bucketHost() {
  if (ENDPOINT) return ENDPOINT.replace(/^https?:\/\//, '');
  return `${BUCKET}.s3.${REGION === 'auto' ? 'us-east-1' : REGION}.amazonaws.com`;
}
function objectPath(key) {
  return ENDPOINT ? `/${BUCKET}/${key}` : `/${key}`;
}
// The address a browser fetches. A CDN in front is the whole point of this —
// without one, the bucket's own URL still works.
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
    const { headers, url } = sign({
      method: 'PUT', key, payloadHash: sha256(body), contentType, acl: 'public-read',
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(url, { method: 'PUT', headers, body, signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
    if (!r.ok) { console.warn('[storage] upload failed', r.status); return null; }
    return publicUrl(key);
  } catch (e) {
    console.warn('[storage] upload error:', e && e.message);
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
    const r = await fetch(signed, { method: 'DELETE', headers });
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
  if (!url) return { ok: false, reason: 'upload was refused — check the key, the bucket name and the permissions' };
  let readable = false;
  try { const r = await fetch(url); readable = r.ok; } catch (e) { readable = false; }
  await remove(url);
  return { ok: true, readable, url, cdn: !!CDN, endpoint: ENDPOINT || 'aws', bucket: BUCKET };
}

module.exports = { isConfigured, putDataUrl, remove, isStoredUrl, publicUrl, selfTest };
