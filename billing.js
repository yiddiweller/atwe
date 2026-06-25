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
const BOOST_PRICE_ID = process.env.STRIPE_BOOST_PRICE_ID; // one-time price for a job boost
const PROMOTE_PRICE_ID = process.env.STRIPE_PROMOTE_PRICE_ID; // one-time price for a promoted post
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

// Boost billing is active when a one-time boost price is configured.
function isBoostConfigured() {
  return !!(stripe && BOOST_PRICE_ID);
}
// One-time Checkout Session to boost a specific job. The webhook reads the
// metadata (type=boost, job_id, days) to feature the job on payment.
async function createBoostSession(user, jobId, days, { successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: BOOST_PRICE_ID, quantity: 1 }],
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    client_reference_id: String(user.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: String(user.id), type: 'boost', job_id: String(jobId), days: String(days) },
  });
}

function isPromoteConfigured() {
  return !!(stripe && PROMOTE_PRICE_ID);
}
// One-time Checkout Session to promote a post. The webhook reads the metadata
// (type=promote, post_id, days) to surface the post on payment.
async function createPromoteSession(user, postId, days, { successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: PROMOTE_PRICE_ID, quantity: 1 }],
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    client_reference_id: String(user.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { user_id: String(user.id), type: 'promote', post_id: String(postId), days: String(days) },
  });
}

// Generic one-time Checkout Session for an arbitrary amount (tips, event tickets,
// paid subscriptions) using inline price_data — no pre-created Stripe price needed.
// `amountCents` is a positive integer; `metadata.type` routes the webhook.
async function createPaymentSession(user, { amountCents, productName, metadata, successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: productName || 'Atwe payment' } } }],
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    client_reference_id: String(user.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: Object.assign({ user_id: String(user.id) }, metadata || {}),
  });
}

// Recurring Checkout Session for a creator subscription, using an inline monthly
// price_data (each creator sets their own amount — no pre-created Stripe price).
// `metadata.type` = 'creator_sub' routes the webhook.
async function createRecurringSession(user, { amountCents, productName, metadata, successUrl, cancelUrl }) {
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, recurring: { interval: 'month' }, product_data: { name: productName || 'Atwe subscription' } } }],
    customer_email: user.stripe_customer_id ? undefined : user.email,
    customer: user.stripe_customer_id || undefined,
    client_reference_id: String(user.id),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: Object.assign({ user_id: String(user.id) }, metadata || {}),
  });
}

/* ── Connect (cash-out to bank) ──
   Wallet cash-out uses a Stripe Connect *Express* account per user: they onboard
   once (KYC + bank details via a hosted account link), then a payout transfers
   platform balance to their connected account. Needs only the secret key (Connect
   must be enabled on the platform account) — degrades to a demo cash-out when no
   key is set, matching the rest of the app. */
function isConnectConfigured() {
  return !!stripe;
}
// Create an Express connected account for a user (idempotent at the caller — we
// store the returned id on users.stripe_connect_id and reuse it).
async function createConnectAccount(user) {
  return stripe.accounts.create({
    type: 'express',
    email: user.email || undefined,
    capabilities: { transfers: { requested: true } },
    metadata: { user_id: String(user.id) },
  });
}
// Hosted onboarding link (KYC + bank). The user returns to returnUrl when done.
async function createAccountLink(accountId, refreshUrl, returnUrl) {
  return stripe.accountLinks.create({ account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' });
}
// Retrieve a connected account (to check payouts_enabled before cashing out).
async function getConnectAccount(accountId) {
  return stripe.accounts.retrieve(accountId);
}
// Move platform balance to a connected account (Stripe then pays out to their bank).
// An idempotencyKey makes a retried transfer safe — Stripe returns the existing
// transfer instead of creating a second one.
async function createPayout(accountId, amountCents, idempotencyKey) {
  return stripe.transfers.create(
    { amount: amountCents, currency: 'usd', destination: accountId },
    idempotencyKey ? { idempotencyKey } : undefined
  );
}

// Verify + parse a webhook payload. Requires the raw request body.
function constructEvent(rawBody, signature) {
  if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
}

function hasWebhookSecret() {
  return !!WEBHOOK_SECRET;
}

module.exports = { isConfigured, createCheckoutSession, isBoostConfigured, createBoostSession, isPromoteConfigured, createPromoteSession, createPaymentSession, createRecurringSession, isConnectConfigured, createConnectAccount, createAccountLink, getConnectAccount, createPayout, constructEvent, hasWebhookSecret, stripe };
