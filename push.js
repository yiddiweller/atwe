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

// Send one notification. Resolves with the response, or rejects with an Error
// whose `.statusCode` is 404/410 for a dead subscription (the caller prunes it).
async function send(subscription, payload) {
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

module.exports = { isConfigured, publicKey, send };
