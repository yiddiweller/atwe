/* ═══════════════════════════════════════════════
   IMAGEGEN  —  make a picture from a description
   ───────────────────────────────────────────────
   Optional, like every other integration here (mailer, stt, shiplabels, sms):
   with no provider configured, isConfigured() is false, the app says so
   plainly, and nothing breaks.

   Deliberately provider-agnostic. Image models change every few months and
   this codebase should not be married to one. Point IMAGE_API_URL at anything
   that takes a prompt and returns an image, and describe the shape with the
   two env vars below if it differs from the common one.

     IMAGE_API_URL     the endpoint to POST to
     IMAGE_API_KEY     sent as a Bearer token
     IMAGE_MODEL       optional model name, passed through
     IMAGE_SIZE        optional, default 1024x1024

   The response is normalised to a data URL, because that is what every image
   field in Atwe already accepts — so a generated picture flows into a post,
   a listing or a profile with no special handling anywhere.
═══════════════════════════════════════════════ */
const API_URL = process.env.IMAGE_API_URL;
const API_KEY = process.env.IMAGE_API_KEY;
const MODEL = process.env.IMAGE_MODEL || null;
const SIZE = process.env.IMAGE_SIZE || '1024x1024';

const ok = !!(API_URL && API_KEY);
if (!ok) {
  console.warn('⚠️  Image generation not configured — the "make me a picture" button will say so. Set IMAGE_API_URL / IMAGE_API_KEY to enable it.');
}
function isConfigured() { return ok; }

// Providers disagree about where the image lives in the response. Rather than
// hardcode one, look in the places they actually use, in order.
function extractImage(body) {
  if (!body || typeof body !== 'object') return null;
  const first = Array.isArray(body.data) ? body.data[0]
    : Array.isArray(body.images) ? body.images[0]
    : Array.isArray(body.artifacts) ? body.artifacts[0] : null;
  const cand = [
    body.b64_json, body.image, body.imageBase64,
    first && (first.b64_json || first.base64 || first.image || first.url),
    body.url, body.output && body.output[0],
  ].find((x) => typeof x === 'string' && x.length > 32);
  if (!cand) return null;
  if (cand.startsWith('data:image/')) return cand;
  if (/^https?:\/\//i.test(cand)) return { remote: cand };
  // Bare base64 — assume PNG, which is what these APIs return.
  return 'data:image/png;base64,' + cand.replace(/\s/g, '');
}

/* Generate one image. Returns { dataUrl } or { error }. Never throws — a
   picture failing to appear must never take down whatever asked for it. */
async function generate(prompt, opts) {
  if (!ok) return { error: 'Image generation is not set up on this server.' };
  const text = String(prompt || '').trim().slice(0, 1000);
  if (!text) return { error: 'Describe the picture you want.' };
  const body = { prompt: text, size: (opts && opts.size) || SIZE, n: 1, response_format: 'b64_json' };
  if (MODEL) body.model = MODEL;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);   // these are slow
    const r = await fetch(API_URL, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).finally(() => clearTimeout(timer));
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { error: 'The picture service refused that (' + r.status + ').', detail: detail.slice(0, 200) };
    }
    const json = await r.json().catch(() => null);
    const img = extractImage(json);
    if (!img) return { error: 'The picture service replied with something we could not read.' };
    if (typeof img === 'object' && img.remote) {
      // Some providers hand back a URL instead of the bytes. Fetch it so the
      // result is the same shape either way.
      try {
        const ir = await fetch(img.remote);
        if (!ir.ok) return { error: 'Could not download the picture.' };
        const buf = Buffer.from(await ir.arrayBuffer());
        const type = ir.headers.get('content-type') || 'image/png';
        return { dataUrl: `data:${type.split(';')[0]};base64,` + buf.toString('base64') };
      } catch (e) { return { error: 'Could not download the picture.' }; }
    }
    return { dataUrl: img };
  } catch (e) {
    return { error: 'The picture service did not answer in time.' };
  }
}

module.exports = { isConfigured, generate };
