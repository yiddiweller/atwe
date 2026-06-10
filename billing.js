/* ═══════════════════════════════════════════════
   BILLING  —  Stripe Checkout for Atwe Pro
   ───────────────────────────────────────────────
   Active only when STRIPE_SECRET_KEY + STRIPE_PRICE_ID are set. When
   they aren't, isConfigured() is false and the app falls back to the
   demo "instant upgrade" path so it keeps working without Stripe.
═══════════════════════════════════════════════ */
const Stripe = require('stripe');

const SECRET = process.env.STRIPE_SECRET_KEY;
const PRICE_ID = process.env.STRIPE_PRICE_ID;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const stripe = SECRET ? new Stripe(SECRET) : null;

if (!stripe || !PRICE_ID) {
  console.warn(
    '⚠️  Stripe not fully configured — "Upgrade to Pro" uses the demo instant-upgrade path. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to enable real billing.'
  );
}

function isConfigured() {
  return !!(stripe && PRICE_ID);
}

// Create a Checkout Session for the Pro subscription.
async function createCheckoutSession(user, { successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: PRICE_ID, quantity: 1 }],
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    client_reference_id: String(user.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: String(user.id) },
  });
}

// Verify + parse a webhook payload. Requires the raw request body.
function constructEvent(rawBody, signature) {
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

function hasWebhookSecret() {
  return !!WEBHOOK_SECRET;
}

module.exports = { isConfigured, createCheckoutSession, constructEvent, hasWebhookSecret, stripe };
