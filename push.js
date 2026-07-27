/* ═══════════════════════════════════════════════
   WEB PUSH  —  PWA push notifications (VAPID)
   ───────────────────────────────────────────────
   Active only when VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY are set. When they
   aren't, isConfigured() is false and the app simply skips push (notifications
   still arrive over the SSE stream while a tab is open) — same graceful-
   degradation pattern as SMTP / Stripe.

   Generate a key pair once with:  npx web-push generate-vapid-keys
═══════════════════════════════════════════════ */
const webpush = require('web-push');

const PUBLIC = process.env.VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@atwe.com';

let configured = false;
if (PUBLIC && PRIVATE) {
  try { webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE); configured = true; }
  catch (e) { console.warn('⚠️  Web Push misconfigured (bad VAPID keys?):', e.message); }
} else {
  console.warn('⚠️  Web Push not configured — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to enable push notifications.');
}

function isConfigured() { return configured; }
function publicKey() { return PUBLIC || null; }

/* ─── The phone app ────────────────────────────────────────────────────────
   A browser gets a Web Push subscription; a phone gets an Expo push token,
   which looks like ExponentPushToken[…]. Expo holds the Apple and Google
   certificates and does the delivery, so nothing here needs either.

   Deliberately no key and no account: Expo's send endpoint is open, and the
   token itself is the address. That means native push works the moment the app
   is installed, with nothing to configure — unlike Web Push, which needs VAPID
   keys. So `isConfigured()` staying false does NOT switch the phone off. */
function isNativeToken(endpoint) {
  return typeof endpoint === 'string' && /^Expo(nent)?PushToken\[/.test(endpoint);
}
function nativeConfigured() { return true; }

async function sendNative(token, payload) {
  const body = {
    to: token,
    title: payload.title || 'Atwe',
    body: payload.body || '',
    sound: 'default',
    // What the app should open when it is tapped.
    data: { url: payload.url || null, path: payload.path || null },
    badge: typeof payload.badge === 'number' ? payload.badge : undefined,
  };
  const r = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  const d = j && (Array.isArray(j.data) ? j.data[0] : j.data);
  // Expo reports a dead token in the reply rather than by status, so translate
  // it into the same shape the Web Push path throws — the caller prunes on 410.
  if (d && d.status === 'error') {
    const err = new Error(d.message || 'push failed');
    const bad = d.details && (d.details.error === 'DeviceNotRegistered' || d.details.error === 'InvalidCredentials');
    err.statusCode = bad ? 410 : 500;
    throw err;
  }
  if (!r.ok) { const err = new Error('push failed'); err.statusCode = r.status; throw err; }
  return d || {};
}

// Send one notification. Resolves with the response, or rejects with an Error
// whose `.statusCode` is 404/410 for a dead subscription (the caller prunes it).
// A phone and a browser are told apart by the shape of the address.
async function send(subscription, payload) {
  const endpoint = subscription && subscription.endpoint;
  if (isNativeToken(endpoint)) return sendNative(endpoint, payload);
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = { isConfigured, publicKey, send, isNativeToken, nativeConfigured };
