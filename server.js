require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const billing = require('./billing');
const push = require('./push');
const geoip = require('./geoip');
const apple = require('./apple');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.atwe.com';

// Honour X-Forwarded-* (Railway terminates TLS at its proxy) so req.hostname
// and req.protocol reflect the real client-facing host.
app.set('trust proxy', 1);

// Permanently move the old atwe.ai domain to atwe.com. A bare visit lands on the
// Atwe AI page (?go=ai); deep links (verify/reset, etc.) keep their path + query,
// and the old admin subdomain maps to the new one.
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  if (host === 'atwe.ai' || host === 'www.atwe.ai') {
    const url = (!req.originalUrl || req.originalUrl === '/') ? '/ai' : req.originalUrl;
    return res.redirect(301, 'https://atwe.com' + url);
  }
  if (host === 'admin.atwe.ai') {
    return res.redirect(301, 'https://admin.atwe.com' + (req.originalUrl || '/'));
  }
  // Canonicalise www → apex on the primary domain (keeps path + query).
  if (host === 'www.atwe.com') {
    return res.redirect(301, 'https://atwe.com' + (req.originalUrl || '/'));
  }
  next();
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Lightweight in-memory per-IP rate limiter for abuse-prone routes.
const _rlBuckets = new Map();
// `bucket` lets parameterized/auth routes share one limit (e.g. all DM sends by
// a user) instead of keying on the full path (which varies by :id and is trivially
// bypassable). When a bucket is given, the key is user-id (or ip) + bucket.
function rateLimit(max, windowMs, bucket) {
  return (req, res, next) => {
    const who = bucket && req.user ? `u${req.user.id}` : (req.ip || 'unknown');
    const key = who + ':' + (bucket || req.path);
    const now = Date.now();
    let b = _rlBuckets.get(key);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; _rlBuckets.set(key, b); }
    b.count++;
    if (b.count > max) return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of _rlBuckets) if (now > b.reset) _rlBuckets.delete(k);
}, 60000).unref();

/* ═══════════════════════════════════════════════
   SITE LOCK  —  private-testing gate
   ───────────────────────────────────────────────
   When enabled from the admin dashboard, public page visits get a black
   "Atwe is unavailable" screen. Testers who know the access code tap the
   logo, enter it, and receive a signed bypass cookie. The admin dashboard,
   the API and the unlock flow are never gated. Settings live in app_settings
   (key `site_lock`) and are cached in memory, refreshed on a short interval.
═══════════════════════════════════════════════ */
const SITE_LOCK_KEY = 'site_lock';
const SITE_LOCK_COOKIE = 'atwe_pass';
// passMinutes: how long a tester stays in after entering the code before it's
// required again. 0 = single use (every visit); 60 = 1h; 1440 = 24h; 10080 = 7d.
let _siteLock = { locked: false, lockUntil: null, code: null, codeLength: 4, passMinutes: 0 };
const PASS_CHOICES = [0, 60, 1440, 10080];

function genCode(n) {
  n = Math.max(4, Math.min(10, parseInt(n, 10) || 4));
  let c = '';
  for (let i = 0; i < n; i++) c += Math.floor(Math.random() * 10);
  return c;
}

async function loadSiteLock() {
  if (!db.isConfigured()) return _siteLock;
  try {
    const v = await db.getSetting(SITE_LOCK_KEY);
    if (v && typeof v === 'object') _siteLock = { locked: false, lockUntil: null, code: null, codeLength: 4, passMinutes: 0, ...v };
  } catch (e) { /* keep last-known state */ }
  return _siteLock;
}

// Currently locked? A timed lock auto-expires once lockUntil passes.
function siteLockEffective() {
  const s = _siteLock;
  if (!s || !s.locked) return false;
  if (s.lockUntil && Date.now() >= new Date(s.lockUntil).getTime()) return false;
  return true;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Access passes honour the admin's `passMinutes` setting:
//   0  → single use: a one-time token consumed the instant it lets a page
//        through, so the code is required again on every visit / reload.
//   >0 → a signed, time-window cookie valid for that many minutes (survives
//        reloads) before the code is required again.
const _gatePasses = new Map(); // single-use tokens: token -> expiresAt (ms)
function issueGatePass() {
  const mins = _siteLock.passMinutes || 0;
  if (mins > 0) return { token: auth.signGatePass(mins), maxAgeMs: mins * 60 * 1000 };
  const tok = require('crypto').randomBytes(18).toString('hex');
  _gatePasses.set(tok, Date.now() + 5 * 60 * 1000); // a 5-min window to be used once
  return { token: tok, maxAgeMs: 0 };               // session cookie
}
function hasGatePass(req, consume) {
  const tok = parseCookies(req)[SITE_LOCK_COOKIE];
  if (!tok) return false;
  // Single-use token (in-memory)?
  if (_gatePasses.has(tok)) {
    const exp = _gatePasses.get(tok);
    if (Date.now() > exp) { _gatePasses.delete(tok); return false; }
    if (consume) _gatePasses.delete(tok);
    return true;
  }
  // Time-window signed pass?
  const d = auth.verifyToken(tok);
  return !!(d && d.pass === true);
}

// Refresh the cache periodically so admin changes propagate to all instances,
// and drop expired one-time passes.
setInterval(() => {
  loadSiteLock().catch(() => {});
  const now = Date.now();
  for (const [t, exp] of _gatePasses) if (now > exp) _gatePasses.delete(t);
}, 10000).unref();

/* ═══════════════════════════════════════════════
   STRIPE WEBHOOK
   Must read the RAW request body for signature verification, so it is
   mounted BEFORE express.json() (which would otherwise consume the body).
═══════════════════════════════════════════════ */
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!billing.isConfigured() || !billing.hasWebhookSecret()) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  let event;
  try {
    event = billing.constructEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }
  // Idempotency — Stripe delivers at-least-once. Claim the event id first; if it's
  // already claimed, this is a duplicate and we skip it (prevents double-credits on
  // wallet top-ups / sends / tips). On a processing error we release the claim so
  // Stripe's retry can re-run it.
  try {
    const claim = await db.query(
      'INSERT INTO processed_stripe_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
      [event.id]
    );
    if (!claim.rowCount) return res.json({ received: true, duplicate: true });
  } catch (e) {
    // Fail CLOSED: if the dedupe store is unavailable we can't guarantee we won't
    // double-process a money event, so 500 and let Stripe retry when the DB heals.
    console.error('webhook idempotency claim failed — asking Stripe to retry:', e.message);
    return res.status(500).json({ error: 'Temporarily unavailable.' });
  }
  try {
    if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'boost') {
      // A job boost was paid for → feature the job.
      const s = event.data.object;
      const jobId = parseInt(s.metadata?.job_id, 10);
      const days = parseInt(s.metadata?.days, 10) || 30;
      if (Number.isInteger(jobId)) {
        await db.query(`UPDATE jobs SET featured_until = now() + ($2 * interval '1 day') WHERE id = $1`, [jobId, days]);
      } else {
        console.warn('boost checkout.session.completed with no resolvable job_id:', s.id);
      }
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'promote') {
      // A post promotion was paid for → surface the post.
      const s = event.data.object;
      const postId = parseInt(s.metadata?.post_id, 10);
      const days = parseInt(s.metadata?.days, 10) || 7;
      if (Number.isInteger(postId)) {
        await db.query(`UPDATE posts SET promoted_until = now() + ($2 * interval '1 day') WHERE id = $1`, [postId, days]);
      } else {
        console.warn('promote checkout.session.completed with no resolvable post_id:', s.id);
      }
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'tip') {
      const s = event.data.object, m = s.metadata || {};
      const from = parseInt(m.user_id, 10), to = parseInt(m.to_id, 10), amt = parseInt(m.amount_cents, 10);
      if (Number.isInteger(from) && Number.isInteger(to) && Number.isInteger(amt)) await recordTip(from, to, amt, m.tip_message || null);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'event_ticket') {
      const s = event.data.object, m = s.metadata || {};
      const uid = parseInt(m.user_id, 10), eid = parseInt(m.event_id, 10);
      if (Number.isInteger(uid) && Number.isInteger(eid)) {
        await db.query(`INSERT INTO event_rsvps (event_id, user_id, status, paid) VALUES ($1,$2,'going',true) ON CONFLICT (event_id, user_id) DO UPDATE SET status = 'going', paid = true`, [eid, uid]);
        notify((await db.query('SELECT host_id FROM events WHERE id = $1', [eid])).rows[0]?.host_id, uid, 'event_rsvp');
      }
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'newsletter_sub') {
      const s = event.data.object, m = s.metadata || {};
      const uid = parseInt(m.user_id, 10), nid = parseInt(m.newsletter_id, 10);
      if (Number.isInteger(uid) && Number.isInteger(nid)) await db.query(`INSERT INTO newsletter_subs (newsletter_id, user_id, paid) VALUES ($1,$2,true) ON CONFLICT (newsletter_id, user_id) DO UPDATE SET paid = true`, [nid, uid]);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'invoice') {
      const s = event.data.object, m = s.metadata || {};
      const invId = parseInt(m.invoice_id, 10);
      if (Number.isInteger(invId)) await recordInvoicePaid(invId);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'order') {
      const s = event.data.object, m = s.metadata || {};
      const orderId = parseInt(m.order_id, 10);
      if (Number.isInteger(orderId)) await recordOrderPaid(orderId);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'wallet_topup') {
      // Wallet top-up paid → credit the user's balance.
      const s = event.data.object, m = s.metadata || {};
      const uid = parseInt(m.user_id, 10), amt = parseInt(m.amount_cents, 10);
      if (Number.isInteger(uid) && Number.isInteger(amt)) await recordTopup(uid, amt);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'wallet_send') {
      // Send-money paid by card → top the sender up and move it to the recipient.
      const s = event.data.object, m = s.metadata || {};
      const from = parseInt(m.user_id, 10), to = parseInt(m.to_id, 10), amt = parseInt(m.amount_cents, 10);
      if (Number.isInteger(from) && Number.isInteger(to) && Number.isInteger(amt)) await recordMoneySend(from, to, amt, m.pay_note || null, true);
    } else if (event.type === 'checkout.session.completed' && event.data.object.metadata?.type === 'creator_sub') {
      // Creator subscription started — grant access for a period. (Must be checked
      // BEFORE the generic Pro branch, since this is also mode:'subscription'.)
      const s = event.data.object, m = s.metadata || {};
      const sub = parseInt(m.user_id, 10), creator = parseInt(m.creator_id, 10);
      if (Number.isInteger(sub) && Number.isInteger(creator)) await recordCreatorSub(sub, creator);
    } else if (event.type === 'invoice.paid' && event.data.object.subscription) {
      // Monthly renewal of a creator subscription — extend the period if we can map it.
      const inv = event.data.object, line = (inv.lines && inv.lines.data && inv.lines.data[0]) || {};
      const m = (line.metadata && Object.keys(line.metadata).length ? line.metadata : inv.metadata) || {};
      const sub = parseInt(m.user_id, 10), creator = parseInt(m.creator_id, 10);
      if (m.type === 'creator_sub' && Number.isInteger(sub) && Number.isInteger(creator)) await recordCreatorSub(sub, creator);
    } else if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = parseInt(s.metadata?.user_id || s.client_reference_id, 10);
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id || null;
      if (!Number.isInteger(userId)) {
        console.warn('checkout.session.completed with no resolvable user_id:', s.id);
      } else {
        // Always refresh the customer id; only email when the plan actually flips to Pro.
        const { rows } = await db.query(
          `UPDATE users u SET plan = 'pro', stripe_customer_id = COALESCE($1, u.stripe_customer_id)
           FROM (SELECT plan AS old_plan FROM users WHERE id = $2) prev
           WHERE u.id = $2
           RETURNING u.name, u.email, prev.old_plan`,
          [customerId, userId]
        );
        if (rows[0] && rows[0].old_plan !== 'pro') {
          try {
            await sendProWelcomeEmail(rows[0]);
          } catch (e) {
            console.error('Pro welcome email failed:', e.message);
          }
        }
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const customerId =
        typeof event.data.object.customer === 'string'
          ? event.data.object.customer
          : event.data.object.customer?.id || null;
      const { rowCount } = await db.query('UPDATE users SET plan = $1 WHERE stripe_customer_id = $2', [
        'free',
        customerId,
      ]);
      if (!rowCount) console.warn('Subscription cancelled but no user matched customer', customerId);
    } else if (event.type === 'account.updated') {
      // A Connect (Express) account changed — flip the user's payouts-enabled flag
      // so cash-out unlocks automatically the moment onboarding finishes (no need
      // to wait for the next on-demand status check). Connect events are delivered
      // to this same endpoint when it's subscribed to connected-account events.
      const acct = event.data.object;
      const enabled = !!acct.payouts_enabled;
      const r = await db.query(
        'UPDATE users SET connect_payouts_enabled = $2 WHERE stripe_connect_id = $1 RETURNING id',
        [acct.id, enabled]
      );
      const uid = r.rows[0] ? r.rows[0].id : parseInt(acct.metadata?.user_id, 10);
      if (Number.isInteger(uid)) rtPush(uid, 'wallet', { type: 'cashout_status', payoutsEnabled: enabled });
    }
    res.json({ received: true });
  } catch (err) {
    console.error(err);
    // Release the idempotency claim so Stripe's retry re-processes this event.
    await db.query('DELETE FROM processed_stripe_events WHERE event_id = $1', [event.id]).catch(() => {});
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.use(express.json({ limit: '25mb' })); // large enough for base64 images + PDFs

// On the admin subdomain (admin.atwe.com), the dashboard is the homepage.
app.use((req, res, next) => {
  if (req.hostname === ADMIN_HOST && (req.path === '/' || req.path === '/index.html')) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  next();
});

// Sign in with Apple domain verification: serve the association file Apple
// gives you (set its contents as APPLE_DOMAIN_ASSOCIATION). Kept above the site
// lock so Apple's verifier can always reach it.
app.get('/.well-known/apple-developer-domain-association.txt', (_req, res) => {
  const body = process.env.APPLE_DOMAIN_ASSOCIATION;
  if (!body) return res.status(404).type('text/plain').send('Not found');
  res.type('text/plain').send(body);
});

// Site lock: serve the black "unavailable" screen for public page visits while
// the gate is on. Never blocks the admin dashboard, the API, the unlock flow,
// or a tester who already holds a valid bypass cookie.
app.use((req, res, next) => {
  if (!siteLockEffective()) return next();
  if (req.hostname === ADMIN_HOST) return next();         // admin dashboard host
  if (req.path === '/admin.html') return next();          // admin on the main domain
  if (req.path.startsWith('/api/')) return next();        // API incl. /api/site/unlock
  if (req.method !== 'GET') return next();
  if (!(req.headers.accept || '').includes('text/html')) return next(); // only navigations
  if (hasGatePass(req, true)) return next();              // tester with a valid one-time pass (consumed)
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(__dirname, 'public', 'locked.html'));
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    // The app shell + service worker must always revalidate so a fresh deploy
    // is picked up immediately — some in-app browsers otherwise keep serving an
    // old cached page. (Other assets — icons, images — may cache normally.)
    if (/\.html$/i.test(filePath) || /[\\/]sw\.js$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// Deploy diagnostic — reports what the SERVER's on-disk index.html actually
// contains (corner radius, hash, size) so we can tell, with zero browser cache
// involved, exactly what's deployed. Unique path + no-store = uncacheable.
app.get('/_diag', (req, res) => {
  try {
    const fs = require('fs'), crypto = require('crypto');
    const idx = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
    const ver = (sw.match(/atwe-v\d+/) || ['?'])[0];
    res.set('Cache-Control', 'no-store');
    res.type('text/plain').send(
      'sw version:                 ' + ver + '\n' +
      'index.html sha256:          ' + crypto.createHash('sha256').update(idx).digest('hex').slice(0, 16) + '\n' +
      'index.html bytes:           ' + idx.length + '\n' +
      'served at:                  ' + new Date().toISOString()
    );
  } catch (e) { res.status(500).type('text/plain').send('diag error: ' + e.message); }
});

// Same as /_diag but under /api/ so the service worker NEVER intercepts it
// (the SW skips /api/), and it reports the voice connecting-corner radius so we
// can confirm, from the live server, exactly which build is being served.
app.get('/api/diag', (req, res) => {
  try {
    const fs = require('fs'), crypto = require('crypto');
    const idx = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    const sw = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');
    const ver = (sw.match(/atwe-v\d+/) || ['?'])[0];
    const corner = (idx.match(/\.msg-bubble\.voice\{padding:0;border-radius:(\d+)px/) || [, 'NONE'])[1];
    res.set('Cache-Control', 'no-store');
    res.type('text/plain').send(
      'LIVE SERVER REPORT\n' +
      'sw version:            ' + ver + '\n' +
      'voice corner (right):  ' + corner + 'px   (latest code = 999 = full round both ends)\n' +
      'index.html sha256:     ' + crypto.createHash('sha256').update(idx).digest('hex').slice(0, 12) + '\n' +
      'time:                  ' + new Date().toISOString()
    );
  } catch (e) { res.status(500).type('text/plain').send('diag error: ' + e.message); }
});

// An edge/CDN is caching the HTML by path (so "/" and "/index.html" go stale
// while dynamic paths stay fresh). Serve the shell with no-store at paths the
// cache can't pin: `/go` for a manual check, and `/__shell/<unique>` which the
// service worker hits with a fresh value on every navigation so the page can
// never be served stale.
function _serveShellFresh(_req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
}
app.get('/go', _serveShellFresh);
app.get(/^\/__shell\//, _serveShellFresh);

/* ── Site lock: public status + code-unlock; admin read/update ── */
app.get('/api/site/status', (req, res) => {
  res.json({
    locked: siteLockEffective(),
    codeLength: _siteLock.codeLength || 4,
    allowed: hasGatePass(req, false),
  });
});

app.post('/api/site/unlock', rateLimit(12, 60000), (req, res) => {
  if (!siteLockEffective()) return res.json({ ok: true });
  const code = String((req.body && req.body.code) || '').trim();
  if (!_siteLock.code || code !== _siteLock.code) {
    return res.status(401).json({ error: 'Incorrect code.' });
  }
  const pass = issueGatePass();
  const opts = { httpOnly: true, sameSite: 'lax', secure: req.protocol === 'https' };
  if (pass.maxAgeMs > 0) opts.maxAge = pass.maxAgeMs; // else a session cookie (single use)
  res.cookie(SITE_LOCK_COOKIE, pass.token, opts);
  res.json({ ok: true });
});

app.get('/api/admin/site', auth.requireAdmin, async (_req, res) => {
  await loadSiteLock();
  if (!_siteLock.code) { _siteLock.code = genCode(_siteLock.codeLength); }
  res.json({
    locked: !!_siteLock.locked,
    effectiveLocked: siteLockEffective(),
    lockUntil: _siteLock.lockUntil || null,
    code: _siteLock.code,
    codeLength: _siteLock.codeLength || 4,
    passMinutes: _siteLock.passMinutes || 0,
  });
});

app.patch('/api/admin/site', auth.requireAdmin, async (req, res) => {
  await loadSiteLock();
  const s = { ..._siteLock };
  const b = req.body || {};
  // Code length (4–10) regenerates a fresh code at that length.
  if (b.codeLength != null) {
    s.codeLength = Math.max(4, Math.min(10, parseInt(b.codeLength, 10) || 4));
    s.code = genCode(s.codeLength);
  }
  // Explicit custom code (digits only).
  if (typeof b.code === 'string' && b.code.trim()) {
    const c = b.code.trim();
    if (!/^[0-9]{4,10}$/.test(c)) return res.status(400).json({ error: 'Code must be 4–10 digits.' });
    s.code = c;
    s.codeLength = c.length;
  }
  if (b.regenerate) s.code = genCode(s.codeLength || 4);
  // How long a tester stays in after entering the code (0 = single use).
  if (b.passMinutes != null) {
    const n = parseInt(b.passMinutes, 10);
    s.passMinutes = PASS_CHOICES.includes(n) ? n : 0;
  }
  // Timed lock (locks now, auto-unlocks after N minutes).
  if (b.lockForMinutes != null) {
    const m = parseInt(b.lockForMinutes, 10);
    if (m > 0) { s.locked = true; s.lockUntil = new Date(Date.now() + m * 60000).toISOString(); }
  }
  // Immediate lock / unlock switch.
  if (typeof b.locked === 'boolean') {
    s.locked = b.locked;
    if (!b.locked) s.lockUntil = null;
    else if (b.lockForMinutes == null) s.lockUntil = null; // on = indefinite
  }
  if (!s.code) s.code = genCode(s.codeLength || 4);
  try {
    await db.setSetting(SITE_LOCK_KEY, s);
    _siteLock = s;
    res.json({
      locked: !!s.locked,
      effectiveLocked: siteLockEffective(),
      lockUntil: s.lockUntil || null,
      code: s.code,
      codeLength: s.codeLength || 4,
      passMinutes: s.passMinutes || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save site-lock settings.' });
  }
});

/* ═══════════════════════════════════════════════
   HEALTH / DIAGNOSTICS
═══════════════════════════════════════════════ */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    db: db.isConfigured() ? 'configured' : 'not-configured',
    timestamp: new Date().toISOString(),
  });
});

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();

// Public feature flags so the frontend can adapt its UI.
app.get('/api/config', (_req, res) => {
  res.json({
    billingEnabled: billing.isConfigured(),
    emailEnabled: mailer.isConfigured(),
    pushEnabled: push.isConfigured(),         // PWA push available?
    vapidPublicKey: push.publicKey(),         // public — needed to subscribe
    gifEnabled: !!process.env.TENOR_API_KEY,  // GIF search available?
    googleClientId: GOOGLE_CLIENT_ID || null, // public — used to start Google sign-in
    appleClientId: apple.clientId(),          // public — Services ID used to start Apple sign-in
  });
});

// Help-center contact form. Saves to the DB (if configured) and emails the
// owner so they can follow up. Works for guests and signed-in users.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@atwe.com';
// From-addresses for the two outbound mailboxes. Support handles help-center
// acknowledgements + admin replies; Team handles broadcast/marketing email.
const SUPPORT_FROM = process.env.SUPPORT_FROM || `Atwe Support <${SUPPORT_EMAIL}>`;
const TEAM_EMAIL = process.env.TEAM_EMAIL || 'team@atwe.com';
const TEAM_FROM = process.env.TEAM_FROM || `Atwe <${TEAM_EMAIL}>`;
// Real inbox where the owner actually reads support-request notifications.
// SUPPORT_EMAIL is a send-only display address, so deliver these to the reply-to
// inbox (team@) by default.
const SUPPORT_INBOX = process.env.SUPPORT_INBOX || process.env.MAIL_REPLY_TO || TEAM_EMAIL;
// Dedicated send-only address for account/security alerts (sign-in, account
// changes, deletion) — a code default like support@, no Railway var needed.
const ALERTS_EMAIL = process.env.ALERTS_EMAIL || 'alerts@atwe.com';
const ALERTS_FROM = process.env.ALERTS_FROM || `Atwe <${ALERTS_EMAIL}>`;
app.post('/api/contact', rateLimit(6, 60000), auth.optionalAuth, async (req, res) => {
  const email = (req.body.email || '').trim();
  const message = (req.body.message || '').trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email is required.' });
  if (message.length < 4) return res.status(400).json({ error: 'Please include a message.' });
  if (message.length > 5000) return res.status(400).json({ error: 'Message is too long.' });

  let saved = false;
  if (db.isConfigured()) {
    try {
      await db.query(
        'INSERT INTO support_requests (user_id, email, message) VALUES ($1, $2, $3)',
        [req.user?.id || null, email, message]
      );
      saved = true;
    } catch (err) {
      console.error('Support request save failed:', err.message);
    }

    // For signed-in users, also surface the message in their admin message
    // thread so the owner can reply from the dashboard. If they typed a
    // different reply-to address, note it so context isn't lost.
    if (req.user?.id) {
      const threadBody = email && email.toLowerCase() !== (req.user.email || '').toLowerCase()
        ? `[via Help center · reply-to ${email}]\n${message}`
        : `[via Help center]\n${message}`;
      try {
        await db.query(
          `INSERT INTO admin_messages (user_id, sender, body, read_by_user, read_by_admin)
           VALUES ($1, 'user', $2, true, false)`,
          [req.user.id, threadBody]
        );
      } catch (err) {
        console.error('Support thread insert failed:', err.message);
      }
    }
  }

  // Notify the owner in the real support inbox (team@). Reply-to is the sender's
  // address so a reply goes straight back to them.
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let mailed = false;
  try {
    await mailer.sendMail({
      from: SUPPORT_FROM,
      to: SUPPORT_INBOX,
      replyTo: email,
      subject: `New Atwe support message from ${email}`,
      text: `From: ${email}\n${req.user ? `Account: #${req.user.id}\n` : ''}\n${message}`,
      html: `<p><strong>From:</strong> ${esc(email)}</p>${req.user ? `<p><strong>Account:</strong> #${req.user.id}</p>` : ''}<p>${esc(message)}</p>`,
    });
    mailed = true;
  } catch (err) {
    console.error('Support email failed:', err.message);
  }

  // Acknowledge the sender so they know we received it (best-effort). Appears
  // to come from support@atwe.com (a send-only display address; replies fall
  // back to MAIL_REPLY_TO, like alerts@).
  try {
    await mailer.sendMail({
      from: SUPPORT_FROM,
      to: email,
      subject: 'We got your message — Atwe',
      text:
        `Hi there,\n\n` +
        `Thanks for reaching out to Atwe. We've received your message and a member of our team will get back to you as soon as possible.\n\n` +
        `For your reference, here's what you sent:\n"${message}"\n\n` +
        `— The Atwe team`,
      html: mailer.brand({
        preheader: "We've received your message and will reply soon.",
        heading: 'Thanks for reaching out',
        intro: "We've received your message and a member of the Atwe team will get back to you as soon as possible.",
        bodyHtml: `<b>Your message</b><br/><span style="color:#52525b;">${esc(message)}</span>`,
      }),
    });
  } catch (err) {
    console.error('Support acknowledgement email failed:', err.message);
  }

  // Succeed only if the message was actually stored or delivered.
  if (!saved && !mailed) {
    return res.status(503).json({ error: `Support is temporarily unavailable. Please email ${SUPPORT_EMAIL} directly.` });
  }
  res.json({ ok: true });
});

app.get('/api/test', async (_req, res) => {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    res.json({ status: 'ok', reply: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', error: 'Diagnostics call failed' });
  }
});

/* ═══════════════════════════════════════════════
   AUTH  —  /api/auth/*
═══════════════════════════════════════════════ */
// X-style verification eligibility: Pro + complete profile (name + avatar) +
// confirmed email + account ≥ 30 days old. `verified` is granted by an admin
// after the user applies (verify_requested_at set, not yet verified = pending).
const VERIFY_MIN_AGE_DAYS = 30;
function verifyState(row) {
  const missing = [];
  if (row.plan !== 'pro') missing.push('pro');
  if (!row.email_verified) missing.push('email');
  if (!(row.name && row.avatar)) missing.push('profile');
  const ageDays = row.created_at ? (Date.now() - new Date(row.created_at).getTime()) / 86400000 : 0;
  if (ageDays < VERIFY_MIN_AGE_DAYS) missing.push('age');
  return {
    verified: !!row.verified,
    pending: !!row.verify_requested_at && !row.verified,
    eligible: missing.length === 0,
    missing,
    ageDays: Math.floor(ageDays),
  };
}
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    is_admin: row.is_admin,
    email_verified: row.email_verified,
    username: row.username || null,
    avatar: row.avatar || null,
    banner: row.banner || null,
    bio: row.bio || null,
    location: row.location || null,
    website: row.website || null,
    contactEmail: row.contact_email || null,
    phone: row.phone || null,
    note: row.note || null,
    headline: row.headline || null,
    socials: (row.socials && typeof row.socials === 'object' && !Array.isArray(row.socials)) ? row.socials : {},
    dob: row.dob ? new Date(row.dob).toISOString().slice(0, 10) : null,
    verified: !!row.verified,
    verification: verifyState(row),
    categories: Array.isArray(row.categories) ? row.categories : [],
    accountType: row.account_type === 'business' ? 'business' : 'personal',
    businessVerifyStatus: ['pending', 'verified'].includes(row.business_verify_status) ? row.business_verify_status : 'none',
    businessVerified: row.business_verify_status === 'verified',
    dmConnectionsOnly: !!row.dm_connections_only,
    otwVisibility: ['recruiters', 'everyone'].includes(row.otw_visibility) ? row.otw_visibility : 'off',
    openToWork: row.otw_visibility === 'everyone', // drives the public #OpenToWork ring
    hasPassword: row.has_password !== false, // false only for Google-only accounts
    twoFactorEnabled: !!row.totp_enabled,
    subPriceCents: row.sub_price_cents || 0, // own creator-subscription price (0 = off)
    readReceipts: row.read_receipts !== false,
    privateProfileViews: !!row.private_profile_views,
    balanceCents: row.balance_cents || 0, // wallet balance (spendable in-app)
  };
}

// Record a login session (one row per device) so it can be listed + revoked.
async function createSession(userId, token, req) {
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = (fwd || req.ip || '').slice(0, 60);
    const hash = auth.hashToken(token);
    await db.query(
      `INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO UPDATE SET last_seen = now()`,
      [userId, hash, ua, ip]
    );
    // Resolve the city/country off the request path — fill it in once it returns
    // (best-effort; the Devices list falls back to the raw IP until/unless it does).
    geoip.lookup(ip).then((loc) => {
      if (loc) db.query('UPDATE auth_sessions SET location = $1 WHERE token_hash = $2', [loc.slice(0, 120), hash]).catch(() => {});
    }).catch(() => {});
  } catch (e) { console.error('session create failed:', e.message); }
}
// Sign a token for `user` and register its device session in one step.
async function issueSession(user, req) {
  const token = auth.signToken(user);
  await createSession(user.id, token, req);
  return token;
}

// Minimal HTML escaping for values interpolated into email bodies.
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Validate an optional photo sent as a base64 data URL.
// Returns: null = none provided, string = valid, undefined = invalid/too large.
const MAX_IMG_CHARS = 3_500_000; // ~2.6 MB decoded — plenty for a chat photo/avatar
function cleanImage(img) {
  if (img == null || img === '') return null;
  if (typeof img !== 'string') return undefined;
  if (img.length > MAX_IMG_CHARS) return undefined;
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(img);
  if (!m) return undefined;
  // Sniff the magic bytes so the payload actually matches the declared type.
  let head;
  try { head = Buffer.from(m[2].slice(0, 24), 'base64'); } catch { return undefined; }
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpg = head[0] === 0xff && head[1] === 0xd8;
  const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
  const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46;
  if (!(isPng || isJpg || isGif || isWebp)) return undefined;
  return img;
}

// A GIF picked from the search proxy is sent as a remote https URL (not stored as
// base64) — validate it's an https URL on an allowed GIF CDN host.
const GIF_HOSTS = /^https:\/\/(media\.tenor\.com|c\.tenor\.com|media[0-9]?\.giphy\.com|i\.giphy\.com)\//i;
function cleanGifUrl(u) {
  if (typeof u !== 'string' || u.length > 600) return null;
  return GIF_HOSTS.test(u) ? u : null;
}

// Download a remote profile photo (e.g. a Google avatar) and return it as a
// validated base64 data URL, or null. Best-effort — never throws.
async function fetchRemoteAvatar(url) {
  try {
    if (!/^https:\/\/\S+$/i.test(url || '')) return null;
    const bigger = url.replace(/=s\d+-c\b/, '=s256-c'); // ask Google for a crisper size
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000); // never hang signup on a slow image
    const r = await fetch(bigger, { redirect: 'follow', signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 1.5 * 1024 * 1024) return null;
    let ct = '';
    if (buf[0] === 0x89 && buf[1] === 0x50) ct = 'image/png';
    else if (buf[0] === 0xff && buf[1] === 0xd8) ct = 'image/jpeg';
    else if (buf[0] === 0x47 && buf[1] === 0x49) ct = 'image/gif';
    else if (buf[0] === 0x52 && buf[1] === 0x49) ct = 'image/webp';
    else return null;
    return cleanImage(`data:${ct};base64,${buf.toString('base64')}`) || null;
  } catch { return null; }
}

// Rich media (video / audio / file) as a base64 data URL.
// Returns: null = none, { data, kind } = valid, undefined = invalid/too large.
// Kept generous on size since the JSON body limit (25mb) is the real ceiling.
// Base64 inflates the payload by ~4/3, so a 16 MB binary attachment arrives as
// ~22.4M chars (plus the `data:...;base64,` prefix). Keep the char cap above
// that so the client's 16 MB limit isn't falsely rejected here; the 25 MB JSON
// body limit is still the real ceiling.
const MAX_MEDIA_CHARS = 23_000_000; // ~16 MB binary once base64-decoded
function cleanMedia(media) {
  if (media == null || media === '') return null;
  if (typeof media !== 'string') return undefined;
  if (media.length > MAX_MEDIA_CHARS) return undefined;
  // Split on the fixed `;base64,` marker rather than matching the whole media
  // type with a regex: the type can carry arbitrary parameters (MediaRecorder
  // emits `audio/webm;codecs=opus`, and iOS `audio/mp4; codecs="mp4a.40.2"`
  // with spaces and quotes). We only trust the bare type for the whitelist.
  if (!media.startsWith('data:')) return undefined;
  const marker = ';base64,';
  const idx = media.indexOf(marker);
  if (idx === -1) return undefined;
  const mediatype = media.slice(5, idx);       // between 'data:' and ';base64,'
  const b64 = media.slice(idx + marker.length);
  const mime = mediatype.split(';')[0].trim().toLowerCase(); // drop any parameters
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) return undefined;
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return undefined;
  const ok =
    /^video\/(mp4|webm|ogg|quicktime|x-matroska|x-m4v|3gpp)$/.test(mime) ||
    /^audio\/(mpeg|mp3|ogg|wav|x-wav|webm|mp4|aac|x-m4a|m4a|3gpp|flac)$/.test(mime) ||
    /^image\/(png|jpe?g|gif|webp|heic|heif)$/.test(mime) ||
    /^application\/(pdf|zip|x-zip-compressed|msword|rtf|json|octet-stream|vnd\.[a-z0-9.-]+)$/.test(mime) ||
    /^text\/(plain|csv|markdown)$/.test(mime);
  if (!ok) return undefined;
  let kind;
  if (mime.startsWith('video/')) kind = 'video';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (mime.startsWith('image/')) kind = 'image';
  else kind = 'file';
  // Store a normalized data URL (bare type, no messy parameters) — the browser
  // sniffs the real codec on playback, so the parameters aren't needed.
  return { data: `data:${mime};base64,${b64}`, kind };
}
// Sanitize a user-supplied filename for display/download.
function cleanMediaName(n) {
  if (typeof n !== 'string') return null;
  const s = n.replace(/[^\w .()\[\]+-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || null;
}
// Pull the optional media attachment out of a request body.
// Returns { data, kind, name } (any of which may be null) or undefined if invalid.
// Validate an array of base64 images (multi-image posts / messages). Returns the
// cleaned array (≤MAX_IMAGES, bad/oversized ones dropped), or undefined if the
// input isn't an array. An empty/absent array → [].
const MAX_IMAGES = 4;
function cleanImages(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) return undefined;
  const out = [];
  for (const x of arr.slice(0, MAX_IMAGES)) {
    const c = cleanImage(x);
    if (c) out.push(c); // skip null/undefined (empty or invalid) silently
  }
  return out;
}
function mediaFromBody(body) {
  const media = cleanMedia(body.media);
  if (media === undefined) return undefined;
  if (!media) return { data: null, kind: null, name: null };
  const name = media.kind === 'file' ? cleanMediaName(body.mediaName) : null;
  return { data: media.data, kind: media.kind, name };
}

// Structured rich-message payload (poll / event / location / contact).
// Returns: null = none, object = sanitized payload, undefined = invalid.
// Interactive types start with empty live state (votes / RSVPs) that later
// mutates via the dedicated endpoints — never trusted from the sender.
const metaStr = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
function cleanMeta(meta) {
  if (meta == null) return null;
  if (typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const t = meta.t;
  if (t === 'location') {
    const lat = Number(meta.lat), lng = Number(meta.lng);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
    return { t: 'location', lat: +lat.toFixed(6), lng: +lng.toFixed(6), label: metaStr(meta.label, 160) || null };
  }
  if (t === 'contact') {
    const name = metaStr(meta.name, 80);
    if (!name) return undefined;
    return { t: 'contact', name, phone: metaStr(meta.phone, 40) || null, email: metaStr(meta.email, 160) || null, username: metaStr(meta.username, 40) || null };
  }
  if (t === 'poll') {
    const q = metaStr(meta.q, 200);
    const opts = Array.isArray(meta.opts)
      ? meta.opts.map((o) => metaStr(o && typeof o === 'object' ? o.text : o, 100)).filter(Boolean).slice(0, 10).map((text, i) => ({ i, text }))
      : [];
    if (!q || opts.length < 2) return undefined;
    return { t: 'poll', q, multi: !!meta.multi, opts, votes: {} };
  }
  if (t === 'event') {
    const title = metaStr(meta.title, 120);
    const at = (meta.at && !isNaN(Date.parse(meta.at))) ? new Date(meta.at).toISOString() : null;
    if (!title || !at) return undefined;
    return { t: 'event', title, at, loc: metaStr(meta.loc, 160) || null, note: metaStr(meta.note, 500) || null, rsvp: {} };
  }
  return undefined;
}

/* ═══════════════════════════════════════════════
   REALTIME  —  Server-Sent Events (live messages, typing, presence)
   One stream per connection; client→server signals use normal POSTs.
═══════════════════════════════════════════════ */
const rtClients = new Map(); // userId -> Set<res>
function rtSend(res, event, data) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}
function rtPush(userId, event, data) {
  const set = rtClients.get(userId);
  if (set) for (const res of set) rtSend(res, event, data);
}
function rtBroadcast(event, data, exceptId) {
  for (const [uid, set] of rtClients) {
    if (uid === exceptId) continue;
    for (const res of set) rtSend(res, event, data);
  }
}
// Force-close a user's live SSE connections — used after a password reset / "log
// out everywhere" so the realtime channel can't outlive the revoked session. The
// per-connection 'close' handler cleans up rtClients + presence.
function rtKickUser(userId) {
  const set = rtClients.get(userId);
  if (!set) return;
  for (const res of [...set]) { try { res.end(); } catch {} }
}
async function groupMemberIds(groupId, exceptId) {
  const { rows } = await db.query('SELECT user_id FROM at_group_members WHERE group_id = $1', [groupId]);
  return rows.map((r) => r.user_id).filter((id) => id !== exceptId);
}
// Contact privacy: can `callerId` start a call/video/DM with `targetId`?
// Allowed when the target permits Everyone, or the caller matches a checked
// category (people the target follows / people who follow the target), or the
// caller is on the target's allow-list. A block always denies.
async function canContact(callerId, targetId) {
  if (callerId === targetId) return true;
  // The block check fails CLOSED — a block must never leak through on a DB error.
  try {
    const blocked = await db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [targetId, callerId]);
    if (blocked.rowCount) return false;
  } catch (e) { return false; }
  try {
    const { rows } = await db.query('SELECT pc_everyone, pc_following, pc_followers, dm_connections_only FROM users WHERE id = $1', [targetId]);
    const p = rows[0];
    if (!p) return false;
    // Explicitly approved (accepted a request / added to contacts) always works.
    const al = await db.query('SELECT 1 FROM contact_allow WHERE owner_id = $1 AND allowed_id = $2', [targetId, callerId]);
    if (al.rowCount) return true;
    // Connections-only overrides the broader privacy flags: must be connected.
    if (p.dm_connections_only) {
      const cn = await db.query(`SELECT 1 FROM connections WHERE status = 'accepted' AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)) LIMIT 1`, [targetId, callerId]);
      return cn.rowCount > 0;
    }
    if (p.pc_everyone) return true;
    if (p.pc_following) { // people the target follows
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [targetId, callerId]);
      if (f.rowCount) return true;
    }
    if (p.pc_followers) { // people who follow the target
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [callerId, targetId]);
      if (f.rowCount) return true;
    }
    return false;
  } catch (e) { return false; } // on error, deny rather than over-share
}

// Can `meId` send a DM to `otherId`? True when contact privacy permits, OR an
// established conversation already exists (so tightening privacy later doesn't
// silently break ongoing chats) — but never when blocked.
async function dmAllowed(meId, otherId) {
  if (meId === otherId) return true; // you can always message yourself
  if (await canContact(meId, otherId)) return true; // also denies on block
  try {
    const b = await db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [otherId, meId]);
    if (b.rowCount) return false;
    const r = await db.query(
      'SELECT 1 FROM at_messages WHERE (sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1) LIMIT 1',
      [meId, otherId]
    );
    return r.rowCount > 0;
  } catch (e) { return false; }
}

// True if a block exists in EITHER direction between two users. Used to gate
// social actions (follow / reply / like) so a blocked user can't reach the
// blocker. Fails CLOSED (treats as blocked) on a DB error.
async function blockedEither(a, b) {
  try {
    const r = await db.query('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1', [a, b]);
    return r.rowCount > 0;
  } catch (e) { return true; }
}

// Record a notification for `userId` caused by `actorId` (and push it live).
// `feedId` deep-links feed notifications; `groupId` deep-links group ones
// (post_id stays null for those).
async function notify(userId, actorId, type, postId, feedId, groupId) {
  if (!userId || userId === actorId) return;
  try {
    await db.query('INSERT INTO notifications (user_id, actor_id, type, post_id, feed_id, group_id) VALUES ($1, $2, $3, $4, $5, $6)', [userId, actorId, type, postId || null, feedId || null, groupId || null]);
    rtPush(userId, 'notif', { type });
    sendPushForNotif(userId, actorId, type).catch(() => {}); // best-effort web push
  } catch (e) { /* notifications are best-effort */ }
}

// Short server-side verb map for push bodies (mirrors the client's notif copy).
const PUSH_VERBS = {
  like: 'liked your post', reply: 'replied to your post', follow: 'followed you',
  message: 'sent you a message', call: 'called you', video_call: 'video-called you',
  chat_request: 'wants to chat with you', mention: 'mentioned you', quote: 'quoted your post',
  job_application: 'applied to your job', connection_request: 'wants to connect',
  connection_accepted: 'accepted your connection', endorsement: 'endorsed your skills',
  event_rsvp: 'is going to your event', rec_received: 'recommended you',
  creator_sub: 'subscribed to you', tip: 'sent you a tip', appt_request: 'requested an appointment',
};
// Fan a web-push notification out to all of a user's subscribed devices,
// pruning any that the push service reports as gone (404/410).
async function pushToUser(userId, { title, body, url, tag }) {
  if (!push.isConfigured() || !db.isConfigured()) return;
  let subs;
  try { subs = (await db.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId])).rows; }
  catch { return; }
  await Promise.all(subs.map(async (s) => {
    try {
      await push.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { title, body, url: url || '/', tag: tag || 'atwe' });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]).catch(() => {});
      }
    }
  }));
}
async function sendPushForNotif(userId, actorId, type) {
  const verb = PUSH_VERBS[type];
  if (!verb) return; // only push the user-facing, actionable types
  let actorName = 'Someone';
  try { const a = await db.query('SELECT name FROM users WHERE id = $1', [actorId]); if (a.rows[0]) actorName = a.rows[0].name; } catch {}
  await pushToUser(userId, { title: 'Atwe', body: `${actorName} ${verb}`, tag: type });
}

// Mint a short-lived token for the SSE URL (the long-lived bearer token must
// never go in a URL — those leak into logs/history). Auth'd via the header.
app.get('/api/rt/token', auth.requireAuth, (req, res) => {
  res.json({ token: auth.signStreamToken(req.user, req.tokenHash) });
});

// The live event stream. EventSource can't send headers, so a *short-lived*
// stream token comes as a query param (over HTTPS). Presence is derived from
// active connections.
app.get('/api/rt/stream', async (req, res) => {
  const payload = auth.verifyToken(req.query.token);
  if (!payload || !payload.stream) return res.status(401).end();
  // Honour session revocation: a stream token whose issuing session was logged out
  // (or password-reset away) can't open a new connection. Old tokens minted before
  // this carried no `sh` and are allowed until they expire (≤30 min).
  if (payload.sh && !(await auth.sessionValid(payload.sh))) return res.status(401).end();
  const uid = payload.id;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const wasOffline = !rtClients.has(uid);
  if (wasOffline) rtClients.set(uid, new Set());
  rtClients.get(uid).add(res);
  db.query('UPDATE users SET last_seen = now() WHERE id = $1', [uid]).catch(() => {});
  rtSend(res, 'presence-init', { online: [...rtClients.keys()] });
  if (wasOffline) rtBroadcast('presence', { userId: uid, online: true }, uid);
  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    const set = rtClients.get(uid);
    if (!set) return;
    set.delete(res);
    if (!set.size) {
      rtClients.delete(uid);
      db.query('UPDATE users SET last_seen = now() WHERE id = $1', [uid]).catch(() => {});
      rtBroadcast('presence', { userId: uid, online: false, last_seen: new Date().toISOString() }, uid);
      // Drop them from any live group calls so the roster/banner stays accurate.
      for (const gid of [...groupCalls.keys()]) gcallRemove(gid, uid).catch(() => {});
    }
  });
});

// Typing indicator relay (DM or group).
app.post('/api/rt/typing', auth.requireAuth, async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const groupId = parseInt(req.body.groupId, 10);
  try {
    const me = await chatIdentity(req.user.id);
    const from = { id: req.user.id, name: me ? me.name : '' };
    if (Number.isInteger(groupId)) {
      if (await isGroupMember(groupId, req.user.id)) {
        for (const id of await groupMemberIds(groupId, req.user.id)) rtPush(id, 'typing', { from, groupId });
      }
    } else if (Number.isInteger(to)) {
      rtPush(to, 'typing', { from, groupId: null });
    }
  } catch {}
  res.json({ ok: true });
});

// Presence lookup for a set of user ids (online + last seen).
app.get('/api/atchat/presence', auth.requireAuth, async (req, res) => {
  const ids = (req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Number.isInteger).slice(0, 300);
  try {
    const online = new Set(rtClients.keys());
    const { rows } = ids.length ? await db.query('SELECT id, last_seen FROM users WHERE id = ANY($1)', [ids]) : { rows: [] };
    const presence = {};
    ids.forEach((id) => {
      const r = rows.find((x) => x.id === id);
      presence[id] = { online: online.has(id), last_seen: r ? r.last_seen : null };
    });
    res.json({ presence });
  } catch (err) {
    console.error(err);
    res.json({ presence: {} });
  }
});

// Cloudflare Realtime TURN issues short-lived credentials via its API, so we
// mint a batch and cache it until shortly before it expires (rather than calling
// Cloudflare on every request). Returns a TURN ICE server object, or null.
const STUN_SERVER = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] };
let _cfTurnCache = null; // { server, exp }
async function cloudflareTurnServer() {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) return null;
  if (_cfTurnCache && _cfTurnCache.exp > Date.now()) return _cfTurnCache.server;
  const ttl = 86400; // 24h credentials
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl }),
  });
  if (!r.ok) throw new Error('Cloudflare TURN responded ' + r.status);
  const data = await r.json();
  const ice = data.iceServers || data;
  const urls = ice && ice.urls;
  // Only cache a well-formed credential set; otherwise fall through to the fallback.
  if (!urls || (Array.isArray(urls) && !urls.length)) throw new Error('Cloudflare TURN returned no urls');
  const server = { urls, username: ice.username, credential: ice.credential };
  // Refresh ~10 min before the credentials actually expire.
  _cfTurnCache = { server, exp: Date.now() + (ttl - 600) * 1000 };
  return server;
}

// ICE servers for WebRTC. STUN is always on. TURN priority: Cloudflare Realtime
// (env: CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN) → a static TURN
// server (env: TURN_URL[,url2] / TURN_USERNAME / TURN_CREDENTIAL) → a free public
// relay fallback. Every layer degrades gracefully.
app.get('/api/rt/ice-servers', auth.requireAuth, async (_req, res) => {
  const iceServers = [STUN_SERVER];
  try {
    const cf = await cloudflareTurnServer();
    if (cf) { iceServers.push(cf); return res.json({ iceServers }); }
  } catch (e) {
    console.warn('⚠️  Cloudflare TURN unavailable, falling back:', e.message);
  }
  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_CREDENTIAL || undefined,
    });
  } else {
    // No TURN configured → fall back to a free public relay so cross-network
    // calls still connect out of the box. For production reliability + capacity,
    // set the Cloudflare or static TURN env vars above.
    iceServers.push({
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
  }
  res.json({ iceServers });
});

// Relay a 1:1 call signal (offer / answer / ICE / end / decline / cancel) to the peer.
const _callNotified = new Set(); // de-dupes the bell notification per callId
app.post('/api/rt/call', auth.requireAuth, rateLimit(300, 60000, 'rt-call'), async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const kind = String(req.body.kind || '');
  if (!Number.isInteger(to)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!['offer', 'answer', 'ice', 'end', 'decline', 'cancel'].includes(kind)) {
    return res.status(400).json({ error: 'Invalid call signal.' });
  }
  // Privacy: only gate the initial offer (later signals belong to a live call).
  if (kind === 'offer' && !(await canContact(req.user.id, to))) {
    return res.status(403).json({ error: 'This person isn’t accepting calls from you.' });
  }
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  // A new incoming call leaves one bell notification (audio vs video) — de-duped
  // by callId so re-sent offers don't spam the callee.
  if (kind === 'offer') {
    const key = (req.body.callId || ('c' + req.user.id + '-' + to)) + ':' + to;
    if (!_callNotified.has(key)) {
      _callNotified.add(key);
      if (_callNotified.size > 5000) _callNotified.clear();
      notify(to, req.user.id, req.body.media === 'video' ? 'video_call' : 'call', null);
    }
  }
  rtPush(to, 'call', {
    kind,
    callId: req.body.callId || null,
    media: req.body.media === 'video' ? 'video' : 'audio',
    sdp: req.body.sdp || null,
    candidate: req.body.candidate || null,
    from: me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id },
  });
  res.json({ ok: true });
});

/* ═══════════════════════════════════════════════
   GROUP CALLS  —  drop-in, WhatsApp-style calls for group@username groups.
   Full-mesh WebRTC over the SSE relay (no SFU): any member can start a call and
   any member can join while it's live. Room state is in-memory and ephemeral —
   a "room" only exists while someone is in it. To avoid SDP glare, the JOINING
   peer always offers to everyone already in the room; existing peers answer.
═══════════════════════════════════════════════ */
const groupCalls = new Map(); // groupId -> Map<userId, { since:number }>
// Full-mesh upload cost grows with every participant (each sends to all others),
// so cap a call's size to keep it stable. A bigger room would need an SFU.
const GROUP_CALL_MAX = 8;

// Remove a user from a group call (on explicit leave or SSE disconnect) and
// tell the rest of the group the roster changed. Best-effort.
async function gcallRemove(groupId, userId) {
  const room = groupCalls.get(groupId);
  if (!room || !room.has(userId)) return;
  room.delete(userId);
  if (!room.size) groupCalls.delete(groupId);
  try {
    for (const id of await groupMemberIds(groupId, userId)) {
      rtPush(id, 'group-call', { kind: 'leave', groupId, userId, count: room.size, inCall: [...room.keys()] });
    }
  } catch {}
}

// Join (or start) a group's drop-in call. Returns the peers already in the room
// that the caller should send offers to.
app.post('/api/rt/group-call/join', auth.requireAuth, rateLimit(120, 60000, 'gcall-join'), async (req, res) => {
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: 'Invalid group.' });
  if (!(await isGroupMember(groupId, req.user.id))) return res.status(403).json({ error: 'You’re not a member of this group.' });
  let room = groupCalls.get(groupId);
  // Cap the room (rejoins by someone already in it are always allowed).
  if (room && !room.has(req.user.id) && room.size >= GROUP_CALL_MAX) {
    return res.status(409).json({ error: `This call is full (max ${GROUP_CALL_MAX}).` });
  }
  const starting = !room || room.size === 0;
  if (!room) { room = new Map(); groupCalls.set(groupId, room); }
  // Peers already in the call — the newcomer offers to each of these.
  const peers = [...room.keys()].filter((id) => id !== req.user.id);
  room.set(req.user.id, { since: Date.now() });
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  const member = me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id };
  // The group name rides along on a fresh call so members who haven't opened the
  // group can still see "<name> started a call in <group>" in the live alert.
  let groupName = null;
  if (starting) {
    try { const g = await db.query('SELECT name FROM at_groups WHERE id = $1', [groupId]); groupName = g.rows[0] ? g.rows[0].name : null; } catch {}
  }
  // Tell the whole group the call's live state changed (powers the "Call in
  // progress · N" banner so anyone can drop in). `starting` flags a fresh call.
  try {
    for (const id of await groupMemberIds(groupId, req.user.id)) {
      rtPush(id, 'group-call', { kind: 'join', groupId, groupName, member, starting, count: room.size, inCall: [...room.keys()] });
    }
  } catch {}
  res.json({ ok: true, peers, count: room.size });
});

// Relay one mesh signal (offer / answer / ICE) to a specific group member.
app.post('/api/rt/group-call/signal', auth.requireAuth, rateLimit(900, 60000, 'gcall-sig'), async (req, res) => {
  const groupId = parseInt(req.body.groupId, 10);
  const to = parseInt(req.body.to, 10);
  const kind = String(req.body.kind || '');
  if (!Number.isInteger(groupId) || !Number.isInteger(to)) return res.status(400).json({ error: 'Invalid signal.' });
  if (!['offer', 'answer', 'ice'].includes(kind)) return res.status(400).json({ error: 'Invalid call signal.' });
  // Both ends must belong to the group (a live call is members-only).
  if (!(await isGroupMember(groupId, req.user.id)) || !(await isGroupMember(groupId, to))) {
    return res.status(403).json({ error: 'You’re not a member of this group.' });
  }
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  rtPush(to, 'group-call', {
    kind,
    groupId,
    media: req.body.media === 'audio' ? 'audio' : 'video',
    sdp: req.body.sdp || null,
    candidate: req.body.candidate || null,
    from: me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id },
  });
  res.json({ ok: true });
});

// Leave a group's call.
app.post('/api/rt/group-call/leave', auth.requireAuth, async (req, res) => {
  const groupId = parseInt(req.body.groupId, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: 'Invalid group.' });
  await gcallRemove(groupId, req.user.id);
  res.json({ ok: true });
});

// Current live-call roster for a group (used on open/boot to show the banner).
app.get('/api/rt/group-call/:groupId', auth.requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.groupId, 10);
  if (!Number.isInteger(groupId)) return res.status(400).json({ error: 'Invalid group.' });
  if (!(await isGroupMember(groupId, req.user.id))) return res.status(403).json({ error: 'You’re not a member of this group.' });
  const room = groupCalls.get(groupId);
  res.json({ inCall: room ? [...room.keys()] : [], count: room ? room.size : 0 });
});

/* ═══════════════════════════════════════════════
   CALL LOG  —  recent-calls history (one row per side, like WhatsApp's Calls tab)
═══════════════════════════════════════════════ */
// Record a finished call from the caller's/callee's own point of view.
app.post('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    const peerId = parseInt(req.body.peerId, 10);
    if (!Number.isInteger(peerId) || peerId === req.user.id) {
      return res.status(400).json({ error: 'Invalid call.' });
    }
    const direction = req.body.direction === 'in' ? 'in' : 'out';
    const media = req.body.media === 'video' ? 'video' : 'audio';
    const missed = !!req.body.missed;
    const duration = Math.max(0, Math.min(86400, parseInt(req.body.duration, 10) || 0));
    const { rows } = await db.query(
      `INSERT INTO calls (user_id, peer_id, direction, media, missed, duration)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [req.user.id, peerId, direction, media, missed, duration]
    );
    res.json({ id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not log the call.' }); }
});

// Recent calls (newest first), joined with the peer's current profile.
app.get('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.direction, c.media, c.missed, c.duration, c.created_at,
              p.id AS peer_id, p.name AS peer_name, p.username AS peer_username, p.avatar AS peer_avatar
       FROM calls c JOIN users p ON p.id = c.peer_id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    const calls = rows.map((r) => ({
      id: r.id, direction: r.direction, media: r.media, missed: r.missed,
      duration: r.duration, created_at: r.created_at,
      peer: { id: r.peer_id, name: r.peer_name, username: r.peer_username, avatar: r.peer_avatar },
    }));
    res.json({ calls });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load calls.' }); }
});

// Delete one call-log entry (mine only).
app.delete('/api/calls/:id', auth.requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
    await db.query('DELETE FROM calls WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});

// Clear the whole call history.
app.delete('/api/calls', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM calls WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not clear.' }); }
});

/* ═══════════════════════════════════════════════
   LIVE STREAMING  —  P2P (broadcaster → viewers) over WebRTC, signaled via SSE
═══════════════════════════════════════════════ */
const liveStreams = new Map(); // streamId -> { id, userId, name, username, avatar, title, groupId, groupName, startedAt, viewers:Set }

// The currently-active stream broadcast into a group (or null).
function groupLiveStream(groupId) {
  for (const s of liveStreams.values()) if (s.groupId === groupId) return s;
  return null;
}
// Public shape of a stream for the group "live now" banner / live strip.
// Audio rooms ("Spaces") also expose the stage: speakers + raised-hand requests.
function liveStreamPublic(s) {
  const base = { id: s.id, title: s.title, startedAt: s.startedAt, viewers: s.viewers.size,
    mode: s.mode || 'video',
    user: { id: s.userId, name: s.name, username: s.username, avatar: s.avatar } };
  if (s.mode === 'audio') {
    base.host = s.userId;
    base.speakers = [...s.speakers.values()];
    base.requests = [...s.requests.values()];
  }
  return base;
}
// Push a fresh stage snapshot (speakers + requests) to everyone in an audio room:
// the host, every current speaker, and every listener (viewers set).
function pushStage(s) {
  if (!s || s.mode !== 'audio') return;
  const payload = { kind: 'stage', streamId: s.id,
    speakers: [...s.speakers.values()], requests: [...s.requests.values()] };
  const seen = new Set();
  for (const uid of [s.userId, ...s.speakers.keys(), ...s.viewers]) {
    if (seen.has(uid)) continue; seen.add(uid);
    rtPush(uid, 'live', payload);
  }
}
// Tear down a stream: tell its viewers (and, for a group stream, all members)
// that it ended, then drop it.
async function endLiveStream(s) {
  for (const v of s.viewers) rtPush(v, 'live', { kind: 'ended', streamId: s.id });
  if (s.groupId) {
    for (const id of await groupMemberIds(s.groupId, s.userId)) rtPush(id, 'live', { kind: 'group-ended', groupId: s.groupId, streamId: s.id });
  }
  liveStreams.delete(s.id);
}

// Start broadcasting: register a live stream. Pass `groupId` to go live inside a
// group chat — only members can watch, and they're all notified it started.
app.post('/api/live/start', auth.requireAuth, async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    let groupId = null, groupName = null;
    if (req.body.groupId != null && req.body.groupId !== '') {
      groupId = parseInt(req.body.groupId, 10);
      if (!Number.isInteger(groupId) || !(await isGroupMember(groupId, req.user.id))) {
        return res.status(403).json({ error: 'You’re not a member of this group.' });
      }
      const g = await db.query('SELECT name FROM at_groups WHERE id = $1', [groupId]);
      groupName = g.rows[0] ? g.rows[0].name : null;
    }
    // One live stream per user — replace any existing (tell viewers/members it ended).
    for (const [, s] of liveStreams) if (s.userId === req.user.id) await endLiveStream(s);
    const mode = req.body.mode === 'audio' ? 'audio' : 'video';
    const id = 'live_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const stream = {
      id, userId: req.user.id, name: me.name, username: me.username, avatar: me.avatar || null,
      title: (req.body.title || '').trim().slice(0, 120), groupId, groupName, mode,
      startedAt: Date.now(), viewers: new Set(),
      // Audio room ("Space"): a stage of speakers (the host starts on stage) and a
      // queue of listeners who raised their hand to speak.
      speakers: new Map(), requests: new Map(),
    };
    if (mode === 'audio') {
      stream.speakers.set(req.user.id, { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null });
    }
    liveStreams.set(id, stream);
    // Notify every group member that someone is live now.
    if (groupId) {
      const info = { kind: 'started', streamId: id, groupId, groupName, title: stream.title, startedAt: stream.startedAt, mode,
        user: { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } };
      for (const uid of await groupMemberIds(groupId, req.user.id)) rtPush(uid, 'live', info);
    }
    res.json({ streamId: id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start the stream.' }); }
});
// Stop broadcasting.
app.post('/api/live/stop', auth.requireAuth, async (req, res) => {
  const s = liveStreams.get(req.body.streamId);
  if (s && s.userId === req.user.id) await endLiveStream(s);
  res.json({ ok: true });
});
// List active streams (newest first). Group streams are private to their group,
// so they're excluded from this global list.
app.get('/api/live', auth.requireAuth, (_req, res) => {
  const list = [...liveStreams.values()].filter((s) => !s.groupId).sort((a, b) => b.startedAt - a.startedAt).map(liveStreamPublic);
  res.json({ streams: list });
});
// Relay WebRTC signaling between a broadcaster and a viewer.
app.post('/api/live/signal', auth.requireAuth, async (req, res) => {
  const to = parseInt(req.body.to, 10);
  const kind = String(req.body.kind || '');
  const streamId = req.body.streamId || null;
  if (!Number.isInteger(to)) return res.status(400).json({ error: 'Invalid user id.' });
  if (!['watch', 'offer', 'answer', 'ice', 'leave'].includes(kind)) return res.status(400).json({ error: 'Invalid signal.' });
  const s = streamId ? liveStreams.get(streamId) : null;
  if (s) {
    if (kind === 'watch') {
      // A group stream is members-only.
      if (s.groupId && !(await isGroupMember(s.groupId, req.user.id))) {
        return res.status(403).json({ error: 'This stream is for group members only.' });
      }
      s.viewers.add(req.user.id);
    }
    if (kind === 'leave') {
      s.viewers.delete(req.user.id);
      // Leaving an audio room also vacates the stage / clears a raised hand.
      if (s.mode === 'audio' && req.user.id !== s.userId) {
        const wasOn = s.speakers.delete(req.user.id);
        const wasReq = s.requests.delete(req.user.id);
        if (wasOn || wasReq) pushStage(s);
      }
    }
  }
  let me = null;
  try { me = await chatIdentity(req.user.id); } catch {}
  rtPush(to, 'live', {
    kind, streamId,
    sdp: req.body.sdp || null, candidate: req.body.candidate || null,
    viewers: s ? s.viewers.size : 0,
    from: me ? { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null } : { id: req.user.id },
  });
  res.json({ ok: true });
});

/* ─── Audio rooms ("Spaces"): stage management ─── */
// Resolve an audio stream the caller can interact with (member-gated for group rooms).
async function loadAudioStream(streamId, uid) {
  const s = streamId ? liveStreams.get(streamId) : null;
  if (!s || s.mode !== 'audio') return null;
  if (s.groupId && !(await isGroupMember(s.groupId, uid))) return null;
  return s;
}
// A listener raises their hand to speak. The host sees it in the requests queue.
app.post('/api/live/raise', auth.requireAuth, async (req, res) => {
  const s = await loadAudioStream(req.body.streamId, req.user.id);
  if (!s) return res.status(404).json({ error: 'That room is no longer available.' });
  if (s.userId === req.user.id || s.speakers.has(req.user.id)) return res.json({ ok: true }); // already on stage
  const lower = req.body.cancel === true;
  if (lower) { s.requests.delete(req.user.id); }
  else {
    const me = await chatIdentity(req.user.id);
    if (!me) return res.status(400).json({ error: 'Could not raise your hand.' });
    s.requests.set(req.user.id, { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null });
  }
  pushStage(s);
  res.json({ ok: true });
});
// Host invites a listener up to the stage (approve a raised hand, or invite directly).
app.post('/api/live/invite', auth.requireAuth, async (req, res) => {
  const s = await loadAudioStream(req.body.streamId, req.user.id);
  if (!s) return res.status(404).json({ error: 'That room is no longer available.' });
  if (s.userId !== req.user.id) return res.status(403).json({ error: 'Only the host can manage speakers.' });
  const uid = parseInt(req.body.userId, 10);
  if (!Number.isInteger(uid) || uid === s.userId) return res.status(400).json({ error: 'Invalid user.' });
  if (s.speakers.size >= 11) return res.status(400).json({ error: 'The stage is full (10 speakers max).' });
  const info = s.requests.get(uid) || await (async () => { const m = await chatIdentity(uid); return m ? { id: m.id, name: m.name, username: m.username, avatar: m.avatar || null } : null; })();
  if (!info) return res.status(404).json({ error: 'That person isn’t here.' });
  s.requests.delete(uid);
  s.speakers.set(uid, info);
  // Tell the promoted listener to start publishing their mic, and refresh the stage for all.
  rtPush(uid, 'live', { kind: 'promoted', streamId: s.id });
  pushStage(s);
  res.json({ ok: true });
});
// Remove a speaker from the stage (host removes anyone; a speaker can step down themselves).
app.post('/api/live/demote', auth.requireAuth, async (req, res) => {
  const s = await loadAudioStream(req.body.streamId, req.user.id);
  if (!s) return res.status(404).json({ error: 'That room is no longer available.' });
  const uid = parseInt(req.body.userId, 10);
  if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid user.' });
  if (uid === s.userId) return res.status(400).json({ error: 'The host can’t leave their own stage.' });
  const isHost = s.userId === req.user.id;
  if (!isHost && uid !== req.user.id) return res.status(403).json({ error: 'Only the host can remove other speakers.' });
  if (!s.speakers.delete(uid)) return res.json({ ok: true });
  rtPush(uid, 'live', { kind: 'demoted', streamId: s.id });
  pushStage(s);
  res.json({ ok: true });
});
// Current stage snapshot (speakers + requests) — used to refresh on (re)join.
app.get('/api/live/stage', auth.requireAuth, async (req, res) => {
  const s = await loadAudioStream(req.query.streamId, req.user.id);
  if (!s) return res.status(404).json({ error: 'That room is no longer available.' });
  res.json({ speakers: [...s.speakers.values()], requests: s.userId === req.user.id ? [...s.requests.values()] : [], host: s.userId, viewers: s.viewers.size });
});

// Issue a single-use token (verification / reset), storing only its hash.
async function issueToken(userId, type, ttlMs) {
  const raw = auth.makeToken();
  await db.query(
    'INSERT INTO auth_tokens (token_hash, user_id, type, expires_at) VALUES ($1, $2, $3, $4)',
    [auth.hashToken(raw), userId, type, new Date(Date.now() + ttlMs)]
  );
  return raw;
}

// Atomically validate + consume a token, returning its user_id or null.
async function consumeToken(raw, type) {
  if (!raw) return null;
  const { rows } = await db.query(
    `DELETE FROM auth_tokens
     WHERE token_hash = $1 AND type = $2 AND expires_at > now()
     RETURNING user_id`,
    [auth.hashToken(raw), type]
  );
  return rows[0]?.user_id || null;
}

// Escape a user's name for safe inclusion in email HTML (falls back to "there").
function safeName(n) { const s = String(n || '').trim(); return s ? escapeHtml(s) : 'there'; }

// ── Account / security notification emails (all branded, from alerts@) ──
async function sendProfileChangedEmail(user, changes) {
  const what = changes.join(' and ');
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: user.email,
    subject: 'Your Atwe account details changed',
    text: `Hi ${user.name || 'there'},\n\nYour Atwe ${what} ${changes.length > 1 ? 'were' : 'was'} just changed.\n\nIf this was you, no action is needed. If you didn't make this change, reset your password and email support@atwe.com right away.\n\n— Atwe`,
    html: mailer.brand({
      preheader: `Your Atwe ${what} changed`,
      heading: 'Account details changed',
      intro: `Hi ${safeName(user.name)}, your Atwe ${what} ${changes.length > 1 ? 'were' : 'was'} just changed.`,
      bodyHtml: `If this was you, you can ignore this email. If you didn’t make this change, <a href="${mailer.appUrl()}" style="color:#0ea5e9;">reset your password</a> and email support@atwe.com right away.`,
    }),
  });
}
async function sendLoginAlertEmail(user, req) {
  const ua = (req.headers['user-agent'] || '').slice(0, 180);
  const when = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.ip || '';
  const where = await geoip.lookup(ip).catch(() => null); // best-effort; omit the line if unknown
  const whereText = where ? `\nLocation: ${where}` : '';
  const whereHtml = where ? `<b>Location:</b> ${escapeHtml(where)}<br/>` : '';
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: user.email,
    subject: 'New sign-in to your Atwe account',
    text: `Hi ${user.name || 'there'},\n\nA new sign-in to your Atwe account just happened.\n\nWhen: ${when}${whereText}\nDevice: ${ua || 'Unknown'}\n\nIf this was you, no action is needed. If not, reset your password right away.\n\n— Atwe`,
    html: mailer.brand({
      preheader: 'New sign-in to your Atwe account',
      heading: 'New sign-in to your account',
      intro: `Hi ${safeName(user.name)}, we noticed a new sign-in to your Atwe account from a device we haven’t seen before:`,
      bodyHtml: `<b>When:</b> ${escapeHtml(when)}<br/>${whereHtml}<b>Device:</b> ${escapeHtml(ua) || 'Unknown'}<br/><br/>If this was you, you can ignore this email. If not, <a href="${mailer.appUrl()}" style="color:#0ea5e9;">reset your password</a> right away.`,
    }),
  });
}
async function sendAccountDeletedEmail(email, name) {
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: email,
    subject: 'Your Atwe account has been deleted',
    text: `Hi ${name || 'there'},\n\nYour Atwe account and all of its data have been permanently deleted, as requested.\n\nWe're sorry to see you go. If you didn't request this, email support@atwe.com right away.\n\n— Atwe`,
    html: mailer.brand({
      preheader: 'Your Atwe account has been deleted',
      heading: 'Your account has been deleted',
      intro: `Hi ${safeName(name)}, your Atwe account and all of its data have been permanently deleted, as requested.`,
      bodyHtml: 'We’re sorry to see you go. If you didn’t request this, email support@atwe.com right away.',
    }),
  });
}
async function sendChatRequestEmail(recipient, requester, body) {
  await mailer.sendMail({
    to: recipient.email,
    subject: `${requester.name || '@' + requester.username} wants to chat with you on Atwe`,
    text: `Hi ${recipient.name || 'there'},\n\n${requester.name || ''} (@${requester.username}) wants to chat with you on Atwe.${body ? `\n\n"${body}"` : ''}\n\nOpen Atwe to accept or decline: ${mailer.appUrl()}\n\n— Atwe`,
    html: mailer.brand({
      preheader: `${safeName(requester.name)} wants to chat with you`,
      heading: 'New message request',
      intro: `Hi ${safeName(recipient.name)}, <b>${safeName(requester.name)}</b> (@${escapeHtml(requester.username)}) wants to chat with you on Atwe.`,
      bodyHtml: (body ? `“${escapeHtml(body)}”<br/><br/>` : '') + 'Open Atwe to accept or decline the request.',
      button: { text: 'Open Atwe', url: mailer.appUrl() },
    }),
  });
}

async function sendVerifyEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?verify=${rawToken}`;
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: user.email,
    subject: 'Verify your Atwe email',
    text: `Welcome to Atwe! Confirm your email address: ${link}`,
    html: mailer.brand({
      preheader: 'Confirm your Atwe email address',
      heading: 'Confirm your email',
      intro: `Hi ${safeName(user.name)}, tap the button below to confirm your email address and finish setting up your Atwe account.`,
      button: { text: 'Confirm email', url: link },
    }),
  });
}

async function sendSignupCode(email, name, code) {
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: email,
    subject: `${code} is your Atwe verification code`,
    text:
      `Hi ${name || 'there'},\n\n` +
      `Your Atwe verification code is: ${code}\n\n` +
      `Enter it to finish creating your account. The code expires in 15 minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html: mailer.brand({
      preheader: `Your Atwe verification code is ${code}`,
      heading: 'Confirm your email',
      intro: `Hi ${safeName(name)}, enter this code to finish creating your Atwe account:`,
      code,
      bodyHtml: 'The code expires in 15 minutes. If you didn’t request this, you can safely ignore this email.',
    }),
  });
}

async function sendResetEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?reset=${rawToken}`;
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: user.email,
    subject: 'Reset your Atwe password',
    text: `Reset your Atwe password: ${link} (link expires in 1 hour)`,
    html: mailer.brand({
      preheader: 'Reset your Atwe password',
      heading: 'Reset your password',
      intro: `Hi ${safeName(user.name)}, tap the button below to choose a new password.`,
      button: { text: 'Reset password', url: link },
      bodyHtml: 'This link expires in 1 hour. If you didn’t request a reset, you can ignore this email — your password won’t change.',
    }),
  });
}

// Code-based reset: email a 6-digit code the user types in-app.
async function sendResetCode(email, name, code) {
  await mailer.sendMail({
    from: ALERTS_FROM,
    to: email,
    subject: `${code} is your Atwe password reset code`,
    text:
      `Hi ${name || 'there'},\n\n` +
      `Your Atwe password reset code is: ${code}\n\n` +
      `Enter it to reset your password. The code expires in 15 minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
    html: mailer.brand({
      preheader: `Your Atwe password reset code is ${code}`,
      heading: 'Reset your password',
      intro: `Hi ${safeName(name)}, enter this code in the app to reset your password:`,
      code,
      bodyHtml: 'The code expires in 15 minutes. If you didn’t request this, you can safely ignore this email.',
    }),
  });
}
// Columns needed to build a public user / sign a token (no password_hash).
const RESET_USER_COLS = 'id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, dob, verified, verify_requested_at, created_at, categories, account_type, business_verify_status, dm_connections_only, otw_visibility, has_password';
// Look up an account by email or @username.
async function findUserByIdentifier(identifier) {
  const id = (identifier || '').trim().toLowerCase().replace(/^@/, '');
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT ${RESET_USER_COLS} FROM users WHERE lower(email) = $1 OR lower(username) = $1`, [id]);
  return rows[0] || null;
}
// Mask an email for display: jo***n@gmail.com
function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!d) return email || '';
  const masked = u.length <= 2 ? u[0] + '*' : u[0] + '*'.repeat(Math.max(1, u.length - 2)) + u[u.length - 1];
  return `${masked}@${d}`;
}

async function sendWelcomeEmail(user) {
  const link = mailer.appUrl();
  await mailer.sendMail({
    to: user.email,
    subject: 'Welcome to Atwe',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `Welcome to Atwe — the network built for business. Connect, message and grow, all in one place.\n\n` +
      `Open Atwe to set up your profile and find your first connections: ${link}\n\n` +
      `Glad to have you,\n— The Atwe team`,
    html: mailer.brand({
      preheader: 'Welcome to Atwe — the network built for business.',
      heading: `Welcome to Atwe, ${safeName(user.name)}`,
      intro: 'You’re in. Atwe is the network built for business — connect, message, share, and grow, all in one place.',
      bodyHtml: 'Set up your profile, follow a few people, and share your first post to get started.',
      button: { text: 'Open Atwe', url: link },
    }),
  });
}

async function sendProWelcomeEmail(user) {
  const link = mailer.appUrl();
  await mailer.sendMail({
    to: user.email,
    subject: "You're now on Atwe Pro",
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `Your upgrade to Atwe Pro is complete — thank you!\n\n` +
      `You now have access to longer, more in-depth responses and priority performance.\n\n` +
      `Pick up where you left off: ${link}\n\n` +
      `— The Atwe team`,
    html: mailer.brand({
      preheader: 'Your upgrade to Atwe Pro is complete.',
      heading: 'You’re on Atwe Pro 🎉',
      intro: `Thanks for upgrading, ${safeName(user.name)}! Your Atwe Pro features are now active.`,
      bodyHtml: 'You now get longer, more in-depth AI responses and priority performance.',
      button: { text: 'Open Atwe', url: link },
    }),
  });
}

// Notify a user by email that the Atwe team sent them a message in-app.
async function sendAdminMessageEmail(user, body) {
  const link = mailer.appUrl();
  const preview = body.length > 280 ? body.slice(0, 280) + '…' : body;
  await mailer.sendMail({
    from: SUPPORT_FROM,
    to: user.email,
    subject: 'You have a new message from Atwe',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `You have a new message from the Atwe team:\n\n` +
      `"${preview}"\n\n` +
      `Open Atwe to read it and reply: ${link}\n\n` +
      `— The Atwe team`,
    html: mailer.brand({
      preheader: 'You have a new message from the Atwe team.',
      heading: 'You have a new message',
      intro: `Hi ${safeName(user.name)}, the Atwe team just sent you a message:`,
      bodyHtml: `<span style="color:#52525b;">${escapeHtml(preview)}</span>`,
      button: { text: 'Open Atwe to reply', url: link },
    }),
  });
}

// Email a team broadcast (announcement / marketing) to a list of users from
// team@atwe.com, using the branded template. Best-effort and sequential so a
// large list doesn't hold a request open; runs detached from the response.
async function sendTeamBroadcastEmails(recipients, subject, body) {
  const link = mailer.appUrl();
  const htmlBody = escapeHtml(body).replace(/\n/g, '<br/>'); // keep the writer's line breaks
  let sent = 0, failed = 0;
  for (const u of recipients) {
    try {
      await mailer.sendMail({
        from: TEAM_FROM,
        to: u.email,
        subject,
        text: `${body}\n\n— The Atwe team\n${link}`,
        html: mailer.brand({
          preheader: subject,
          heading: subject,
          intro: `Hi ${safeName(u.name)},`,
          bodyHtml: htmlBody,
          button: { text: 'Open Atwe', url: link },
        }),
      });
      sent++;
    } catch {
      failed++;
    }
  }
  console.log(`📣  Team broadcast emailed: ${sent} sent, ${failed} failed.`);
}

// Exact age in years from a YYYY-MM-DD date of birth (null if unparseable).
function ageFromDob(dob) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
}
// X-style auto handle: the name (sanitized) + random digits, guaranteed unique.
function baseUsernameFromName(name) {
  let base = (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]/g, '');
  return (base || 'user').slice(0, 20);
}
async function generateUsername(name) {
  const base = baseUsernameFromName(name);
  for (let i = 0; i < 15; i++) {
    const cand = base + Math.floor(1000 + Math.random() * 90000);
    const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [cand]);
    if (!taken.rowCount) return cand;
  }
  return base + Date.now().toString().slice(-7);
}

// Is a username admin-locked (reserved)? Locked names can't be registered or
// switched-to by anyone (the current holder, if any, keeps theirs).
async function usernameReserved(username) {
  if (!username) return false;
  try {
    const r = await db.query('SELECT 1 FROM reserved_usernames WHERE username = lower($1)', [username]);
    return r.rowCount > 0;
  } catch { return false; }
}

function makeSignupCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
const SIGNUP_CODE_TTL = 15 * 60 * 1000;

// Does an account already exist for this identifier? Drives both login flows:
// existing → ask for the password; new → offer to create an account.
app.post('/api/auth/exists', rateLimit(20, 60000, 'exists'), async (req, res) => {
  // Accept an email (email login) or a @username (username login).
  const identifier = (req.body.identifier || req.body.email || '').trim().toLowerCase().replace(/^@/, '');
  if (!identifier) return res.status(400).json({ error: 'Enter a username or email.' });
  try {
    const { rowCount } = await db.query('SELECT 1 FROM users WHERE lower(email) = $1 OR lower(username) = $1', [identifier]);
    // An admin-locked (reserved) username is unavailable for signup even though no
    // account holds it — surface it here so the username step rejects it up front
    // instead of bouncing the user back after the whole wizard.
    const reserved = await usernameReserved(identifier);
    res.json({ exists: rowCount > 0, reserved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Step 1: validate the details, stash a pending signup, and email a 6-digit code.
// No real account exists until the code is confirmed (step 2).
app.post('/api/auth/signup', rateLimit(15, 60000, 'signup'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const dob = (req.body.dob || '').trim();

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!dob) return res.status(400).json({ error: 'Please enter your date of birth.' });
  const age = ageFromDob(dob);
  if (age === null || age > 120) return res.status(400).json({ error: 'Please enter a valid date of birth.' });
  if (age < 18) return res.status(403).json({ error: 'You must be at least 18 years old to create an account.' });

  const accountType = req.body.accountType === 'business' ? 'business' : 'personal';
  let wantUser = (req.body.username || '').trim().replace(/^@/, '');
  if (wantUser) {
    if (wantUser.length > 40) return res.status(400).json({ error: 'Username is too long.' });
    if (!/^[a-zA-Z0-9._-]+$/.test(wantUser)) {
      return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
    }
  }

  try {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });
    if (wantUser) {
      const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [wantUser]);
      if (taken.rowCount) return res.status(409).json({ error: 'That username is already taken.' });
      if (await usernameReserved(wantUser)) return res.status(409).json({ error: 'That username isn’t available.' });
    }

    const hash = await auth.hashPassword(password);
    const code = makeSignupCode();
    await db.query(
      `INSERT INTO pending_signups (email, name, password_hash, dob, username, account_type, code_hash, attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, dob = EXCLUDED.dob,
         username = EXCLUDED.username, account_type = EXCLUDED.account_type, code_hash = EXCLUDED.code_hash, attempts = 0,
         expires_at = EXCLUDED.expires_at, created_at = now()`,
      [email, name, hash, dob, wantUser || null, accountType, auth.hashToken(code), new Date(Date.now() + SIGNUP_CODE_TTL)]
    );
    try { await sendSignupCode(email, name, code); }
    catch (e) { console.error('Signup code email failed:', e.message); }
    res.json({ pending: true, email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Step 2: confirm the emailed code → create the (email-verified) account.
app.post('/api/auth/signup/verify', rateLimit(20, 60000, 'signup-verify'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  try {
    const p = await db.query('SELECT * FROM pending_signups WHERE email = $1', [email]);
    const pend = p.rows[0];
    if (!pend || new Date(pend.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'That code has expired. Please start again.' });
    }
    if (pend.attempts >= 6) {
      await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
      return res.status(429).json({ error: 'Too many attempts. Please start again.' });
    }
    if (auth.hashToken(code) !== pend.code_hash) {
      await db.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = $1', [email]);
      return res.status(400).json({ error: 'That code is incorrect. Please try again.' });
    }
    // Code is good — create the verified account.
    if (pend.username && await usernameReserved(pend.username)) {
      return res.status(409).json({ error: 'That username isn’t available. Please choose another.' });
    }
    let username = pend.username || await generateUsername(pend.name);
    const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const dobStr = pend.dob ? new Date(pend.dob).toISOString().slice(0, 10) : null;
    const acctType = pend.account_type === 'business' ? 'business' : 'personal';
    const insert = (u) => db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at, username, dob, account_type)
       VALUES ($1, $2, $3, $4, true, now(), $5, $6, $7)
       RETURNING id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, verified, verify_requested_at, created_at, account_type`,
      [pend.name, email, pend.password_hash, isAdmin, u, dobStr, acctType]
    );
    let rows;
    try { ({ rows } = await insert(username)); }
    catch (e) {
      if (e.code === '23505') {
        // email or username taken in the meantime
        const emailTaken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
        if (emailTaken.rowCount) { await db.query('DELETE FROM pending_signups WHERE email = $1', [email]); return res.status(409).json({ error: 'An account with that email already exists.' }); }
        if (pend.username) return res.status(409).json({ error: 'That username is already taken.' });
        ({ rows } = await insert(await generateUsername(pend.name)));
      } else throw e;
    }
    await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
    const user = rows[0];
    try { await sendWelcomeEmail(user); } catch (e) { console.error('Welcome email failed:', e.message); }
    res.status(201).json({ token: await issueSession(user, req), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Re-send the signup code (no enumeration; always 200 when a pending signup exists).
app.post('/api/auth/signup/resend', rateLimit(6, 60000, 'signup-resend'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  try {
    const p = await db.query('SELECT name FROM pending_signups WHERE email = $1', [email]);
    if (p.rows[0]) {
      const code = makeSignupCode();
      await db.query('UPDATE pending_signups SET code_hash = $1, attempts = 0, expires_at = $2 WHERE email = $3',
        [auth.hashToken(code), new Date(Date.now() + SIGNUP_CODE_TTL), email]);
      try { await sendSignupCode(email, p.rows[0].name, code); } catch (e) { console.error('Resend code failed:', e.message); }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: true });
  }
});

// ── Page-by-page signup: verify the email FIRST, then collect the rest ──
// Step 1: stash the email and send a 6-digit code (no other fields yet).
app.post('/api/auth/signup/start', rateLimit(10, 60000, 'signup-start'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  try {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'An account with that email already exists.' });
    const code = makeSignupCode();
    await db.query(
      `INSERT INTO pending_signups (email, code_hash, attempts, expires_at)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (email) DO UPDATE SET
         code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [email, auth.hashToken(code), new Date(Date.now() + SIGNUP_CODE_TTL)]);
    try { await sendSignupCode(email, '', code); } catch (e) { console.error('Signup code email failed:', e.message); }
    res.json({ ok: true, email: maskEmail(email) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Step 2: check the emailed code without consuming it (counts attempts).
app.post('/api/auth/signup/check', rateLimit(20, 60000, 'signup-check'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  try {
    const p = await db.query('SELECT code_hash, attempts, expires_at FROM pending_signups WHERE email = $1', [email]);
    const pend = p.rows[0];
    if (!pend || new Date(pend.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'That code has expired. Please start again.' });
    if (pend.attempts >= 6) { await db.query('DELETE FROM pending_signups WHERE email = $1', [email]); return res.status(429).json({ error: 'Too many attempts. Please start again.' }); }
    if (auth.hashToken(code) !== pend.code_hash) {
      await db.query('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = $1', [email]);
      return res.status(400).json({ error: 'That code is incorrect. Please try again.' });
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Auto-join a user to the official industry circles matching the categories they
// picked (by exact name), so a new account lands inside its fields right away.
async function joinCategoryCircles(userId, categories) {
  if (!userId || !Array.isArray(categories) || !categories.length) return;
  try {
    await db.query(
      `INSERT INTO circle_members (circle_id, user_id)
       SELECT c.id, $1 FROM circles c WHERE c.official = true AND c.name = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [userId, categories]
    );
  } catch (e) { console.error('joinCategoryCircles failed:', e.message); }
}

// Final: validate the collected fields + create the (email-verified) account.
app.post('/api/auth/signup/finish', rateLimit(15, 60000, 'signup-finish'), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const code = (req.body.code || '').trim();
  const name = (req.body.name || '').trim();
  const password = req.body.password || '';
  const dob = (req.body.dob || '').trim();
  // Validate the avatar to a clean image data URL (same contract as PUT /profile).
  // Storing it raw would let a crafted string break out of the CSS url()/onclick
  // JS-string contexts it's later interpolated into on other users' screens.
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That profile photo could not be used.' });
  const categories = Array.isArray(req.body.categories)
    ? req.body.categories.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim().slice(0, 60)).slice(0, 40)
    : [];
  const wantUser = (req.body.username || '').trim().replace(/^@/, '');
  const accountType = req.body.accountType === 'business' ? 'business' : 'personal';
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  const pwIssue = auth.passwordIssue(password, { email, username: wantUser, name });
  if (pwIssue) return res.status(400).json({ error: pwIssue });
  if (!dob) return res.status(400).json({ error: 'Please enter your date of birth.' });
  const age = ageFromDob(dob);
  if (age === null || age > 120) return res.status(400).json({ error: 'Please enter a valid date of birth.' });
  if (age < 18) return res.status(403).json({ error: 'You must be at least 18 years old to create an account.' });
  if (!wantUser) return res.status(400).json({ error: 'Please choose a username.' });
  if (wantUser.length > 40) return res.status(400).json({ error: 'Username is too long.' });
  if (!/^[a-zA-Z0-9._-]+$/.test(wantUser)) return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  try {
    const p = await db.query('SELECT code_hash, expires_at FROM pending_signups WHERE email = $1', [email]);
    const pend = p.rows[0];
    if (!pend || new Date(pend.expires_at).getTime() < Date.now()) return res.status(400).json({ error: 'Your code has expired. Please start again.' });
    if (auth.hashToken(code) !== pend.code_hash) return res.status(400).json({ error: 'That code is incorrect.' });
    const emailTaken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (emailTaken.rowCount) { await db.query('DELETE FROM pending_signups WHERE email = $1', [email]); return res.status(409).json({ error: 'An account with that email already exists.' }); }
    if (await usernameReserved(wantUser)) return res.status(409).json({ error: 'That username isn’t available.' });
    const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [wantUser]);
    if (taken.rowCount) return res.status(409).json({ error: 'That username is already taken.' });
    const hash = await auth.hashPassword(password);
    const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at, username, dob, avatar, categories, account_type)
       VALUES ($1, $2, $3, $4, true, now(), $5, $6, $7, $8::jsonb, $9)
       RETURNING ${RESET_USER_COLS}`,
      [name, email, hash, isAdmin, wantUser, dob, avatar, JSON.stringify(categories), accountType]);
    await db.query('DELETE FROM pending_signups WHERE email = $1', [email]);
    const user = rows[0];
    await joinCategoryCircles(user.id, user.categories); // land them in their industry circles
    try { await sendWelcomeEmail(user); } catch (e) { console.error('Welcome email failed:', e.message); }
    res.status(201).json({ token: await issueSession(user, req), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username or email is already taken.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/auth/login', rateLimit(12, 60000), async (req, res) => {
  // Accept either an email or a @username as the identifier.
  const identifier = (req.body.identifier || req.body.email || '').trim().toLowerCase().replace(/^@/, '');
  const password = req.body.password || '';
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Enter your email or username and password.' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, dob, verified, verify_requested_at, created_at, account_type, dm_connections_only, password_hash, totp_secret, totp_enabled, totp_recovery FROM users WHERE lower(email) = $1 OR lower(username) = $1',
      [identifier]
    );
    const user = rows[0];
    // Always run a bcrypt comparison (even when the user doesn't exist) so the
    // response time doesn't reveal whether an account exists.
    const ok = await auth.verifyPassword(password, user ? user.password_hash : auth.DUMMY_HASH);
    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid email/username or password.' });
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before signing in.' });
    }
    // Two-factor challenge: password was correct, but a valid TOTP code is also
    // required. The client re-submits identifier+password+code.
    if (user.totp_enabled && user.totp_secret) {
      const code = String(req.body.code || req.body.totp || '').trim();
      if (!code) return res.status(401).json({ twoFactorRequired: true, error: 'Enter the 6-digit code from your authenticator app.' });
      let pass2fa = auth.verifyTotp(user.totp_secret, code);
      if (!pass2fa) {
        // Fall back to a single-use recovery code: if it matches, consume it.
        const stored = Array.isArray(user.totp_recovery) ? user.totp_recovery : [];
        const hash = auth.hashRecoveryCode(code);
        if (stored.includes(hash)) {
          pass2fa = true;
          db.query('UPDATE users SET totp_recovery = array_remove(totp_recovery, $1) WHERE id = $2', [hash, user.id]).catch(() => {});
        }
      }
      if (!pass2fa) return res.status(401).json({ twoFactorRequired: true, error: 'That code isn’t valid. Try again.' });
    }
    // Record the sign-in so the admin dashboard can show login activity.
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(() => {});
    // Security alert: a self-notification that a new sign-in happened.
    db.query('INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $1, $2)', [user.id, 'login']).catch(() => {});
    rtPush(user.id, 'notif', { type: 'login' });
    // Email a sign-in alert, but only for a device we haven't seen before — so
    // routine logins from the same browser don't email every time.
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    const seen = await db.query('SELECT 1 FROM auth_sessions WHERE user_id = $1 AND user_agent = $2 LIMIT 1', [user.id, ua]).catch(() => ({ rowCount: 1 }));
    const token = await issueSession(user, req);
    if (!seen.rowCount) sendLoginAlertEmail(user, req).catch((e) => console.error('Login alert email failed:', e.message));
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Sign in / sign up with Google. The browser obtains a Google access token via
// Google Identity Services (no client secret needed) and posts it here. We verify
// the token was minted for OUR client, fetch the verified Google profile, then
// log in the matching account (by email) or create a new verified one.
app.post('/api/auth/google', rateLimit(20, 60000), async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in isn’t available right now.' });
  const accessToken = String(req.body.accessToken || '').trim();
  if (!accessToken) return res.status(400).json({ error: 'Missing Google token.' });
  try {
    // 1) Verify the token belongs to our OAuth client (audience check).
    const ti = await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken));
    if (!ti.ok) return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    const info = await ti.json();
    if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ error: 'Google sign-in failed (token wasn’t issued for Atwe).' });
    }
    // 2) Read the verified profile.
    const ui = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!ui.ok) return res.status(401).json({ error: 'Could not read your Google profile.' });
    const p = await ui.json();
    const email = String(p.email || '').trim().toLowerCase();
    if (!email || p.email_verified === false) return res.status(401).json({ error: 'Your Google email isn’t verified.' });
    const name = String(p.name || email.split('@')[0]).slice(0, 80);
    if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured.' });

    // 3) Existing account → sign in. New email → onboarding (no row created yet),
    //    carrying a short-lived token that proves Google verified the email.
    const cols = 'id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, verified, verify_requested_at, created_at, has_password';
    const { rows } = await db.query(`SELECT ${cols} FROM users WHERE lower(email) = $1`, [email]);
    const user = rows[0];
    if (user) {
      if (!user.email_verified) { db.query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]).catch(() => {}); user.email_verified = true; }
      return res.json({ token: await issueSession(user, req), user: publicUser(user) });
    }
    res.json({ needsOnboarding: true, email, name, googleToken: auth.signGoogleSignupToken({ email, name, picture: p.picture || '' }) });
  } catch (err) {
    console.error('Google sign-in error:', err.message);
    res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// Finish a new Google sign-up: birthday (18+), username, optional password.
app.post('/api/auth/google/complete', rateLimit(20, 60000), async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in isn’t available right now.' });
  const d = auth.verifyToken(req.body.googleToken || '');
  if (!d || !d.gsignup || !d.email) return res.status(401).json({ error: 'Your Google session expired — please sign in with Google again.' });
  const email = String(d.email).toLowerCase();
  const name = (String(req.body.name || d.name || '').trim().slice(0, 80)) || email.split('@')[0];
  // Birthday — required, 18+.
  const dob = String(req.body.dob || '').trim();
  const age = ageFromDob(dob);
  if (age === null) return res.status(400).json({ error: 'Enter a valid date of birth.' });
  if (age < 18) return res.status(400).json({ error: 'You must be at least 18 years old.' });
  // Username — required + valid + available.
  const username = String(req.body.username || '').trim().replace(/^@/, '');
  if (!username || username.length > 40 || !/^[a-zA-Z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Choose a valid username.' });
  if (await usernameReserved(username)) return res.status(409).json({ error: 'That username isn’t available.' });
  // Password — optional (the user may skip it).
  const pwRaw = String(req.body.password || '');
  let hasPassword = false, passwordHash;
  if (pwRaw) {
    if (pwRaw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    passwordHash = await auth.hashPassword(pwRaw); hasPassword = true;
  } else {
    passwordHash = await auth.hashPassword(require('crypto').randomBytes(24).toString('hex'));
  }
  const categories = Array.isArray(req.body.categories) ? req.body.categories.filter((c) => typeof c === 'string').slice(0, 20) : [];
  const accountType = req.body.accountType === 'business' ? 'business' : 'personal';
  let avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  // No photo chosen → carry over their Google profile picture automatically.
  if (!avatar && d.picture) avatar = await fetchRemoteAvatar(d.picture);
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const cols = 'id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, verified, verify_requested_at, created_at, account_type, has_password';
    const ins = await db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at, username, dob, has_password, avatar, categories, account_type)
       VALUES ($1, $2, $3, $4, true, now(), $5, $6, $7, $8, $9::jsonb, $10) RETURNING ${cols}`,
      [name, email, passwordHash, isAdmin, username, dob, hasPassword, avatar || null, JSON.stringify(categories), accountType]
    ).catch((e) => { e._dberr = true; throw e; });
    const user = ins.rows[0];
    await joinCategoryCircles(user.id, categories); // land them in their industry circles
    try { await sendWelcomeEmail(user); } catch (e) { console.error('Welcome email failed:', e.message); }
    res.status(201).json({ token: await issueSession(user, req), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      const emailTaken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]).catch(() => ({ rowCount: 0 }));
      if (emailTaken.rowCount) return res.status(409).json({ error: 'An account with that email already exists — try signing in.' });
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    console.error('Google complete error:', err.message);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});

// Sign in with Apple (web): verify the id_token, then sign in or start onboarding.
app.post('/api/auth/apple', rateLimit(20, 60000), async (req, res) => {
  if (!apple.isConfigured()) return res.status(503).json({ error: 'Apple sign-in isn’t available right now.' });
  let claims;
  try { claims = await apple.verifyIdToken(req.body.id_token); }
  catch (e) { console.error('Apple verify error:', e.message); return res.status(401).json({ error: 'Apple sign-in failed. Please try again.' }); }
  const email = claims.email;
  if (!email) return res.status(400).json({ error: 'Apple didn’t share an email. Please try another sign-in method.' });
  // Apple only returns the name on the FIRST authorization, via the client.
  let name = '';
  try {
    const u = typeof req.body.user === 'string' ? JSON.parse(req.body.user) : req.body.user;
    if (u && u.name) name = [u.name.firstName, u.name.lastName].filter(Boolean).join(' ').trim().slice(0, 80);
  } catch { /* ignore malformed user blob */ }
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const cols = 'id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, verified, verify_requested_at, created_at, has_password';
    const { rows } = await db.query(`SELECT ${cols} FROM users WHERE lower(email) = $1`, [email]);
    const user = rows[0];
    if (user) {
      if (!user.email_verified) { db.query('UPDATE users SET email_verified = true WHERE id = $1', [user.id]).catch(() => {}); user.email_verified = true; }
      return res.json({ token: await issueSession(user, req), user: publicUser(user) });
    }
    if (!name) name = email.split('@')[0];
    res.json({ needsOnboarding: true, email, name, appleToken: auth.signAppleSignupToken({ email, name, sub: claims.sub }) });
  } catch (err) {
    console.error('Apple sign-in error:', err.message);
    res.status(500).json({ error: 'Apple sign-in failed. Please try again.' });
  }
});

// Finish a new Apple sign-up: birthday (18+), username, optional password.
app.post('/api/auth/apple/complete', rateLimit(20, 60000), async (req, res) => {
  if (!apple.isConfigured()) return res.status(503).json({ error: 'Apple sign-in isn’t available right now.' });
  const d = auth.verifyToken(req.body.appleToken || '');
  if (!d || !d.asignup || !d.email) return res.status(401).json({ error: 'Your Apple session expired — please sign in with Apple again.' });
  const email = String(d.email).toLowerCase();
  const name = (String(req.body.name || d.name || '').trim().slice(0, 80)) || email.split('@')[0];
  const dob = String(req.body.dob || '').trim();
  const age = ageFromDob(dob);
  if (age === null) return res.status(400).json({ error: 'Enter a valid date of birth.' });
  if (age < 18) return res.status(400).json({ error: 'You must be at least 18 years old.' });
  const username = String(req.body.username || '').trim().replace(/^@/, '');
  if (!username || username.length > 40 || !/^[a-zA-Z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Choose a valid username.' });
  if (await usernameReserved(username)) return res.status(409).json({ error: 'That username isn’t available.' });
  const pwRaw = String(req.body.password || '');
  let hasPassword = false, passwordHash;
  if (pwRaw) {
    if (pwRaw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    passwordHash = await auth.hashPassword(pwRaw); hasPassword = true;
  } else {
    passwordHash = await auth.hashPassword(require('crypto').randomBytes(24).toString('hex'));
  }
  const categories = Array.isArray(req.body.categories) ? req.body.categories.filter((c) => typeof c === 'string').slice(0, 20) : [];
  const accountType = req.body.accountType === 'business' ? 'business' : 'personal';
  const avatar = cleanImage(req.body.avatar); // Apple provides no photo; only an upload, if any
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const isAdmin = !!process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const cols = 'id, name, email, plan, is_admin, email_verified, username, avatar, banner, dob, verified, verify_requested_at, created_at, account_type, has_password';
    const ins = await db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at, username, dob, has_password, avatar, categories, account_type)
       VALUES ($1, $2, $3, $4, true, now(), $5, $6, $7, $8, $9::jsonb, $10) RETURNING ${cols}`,
      [name, email, passwordHash, isAdmin, username, dob, hasPassword, avatar || null, JSON.stringify(categories), accountType]
    );
    const user = ins.rows[0];
    await joinCategoryCircles(user.id, categories); // land them in their industry circles
    try { await sendWelcomeEmail(user); } catch (e) { console.error('Welcome email failed:', e.message); }
    res.status(201).json({ token: await issueSession(user, req), user: publicUser(user) });
  } catch (err) {
    if (err.code === '23505') {
      const emailTaken = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]).catch(() => ({ rowCount: 0 }));
      if (emailTaken.rowCount) return res.status(409).json({ error: 'An account with that email already exists — try signing in.' });
      return res.status(409).json({ error: 'That username is already taken.' });
    }
    console.error('Apple complete error:', err.message);
    res.status(500).json({ error: 'Could not create your account. Please try again.' });
  }
});

// Refresh the client's view of the account (plan/admin may change server-side).
app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, dob, verified, verify_requested_at, created_at, account_type, business_verify_status, dm_connections_only, otw_visibility, has_password, totp_enabled, sub_price_cents, read_receipts, private_profile_views, balance_cents FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Two-factor authentication (TOTP authenticator app) ─── */
// Begin enrollment: generate (or reuse a not-yet-confirmed) secret and return the
// otpauth URI the authenticator scans + the secret for manual entry.
app.post('/api/auth/2fa/setup', auth.requireAuth, async (req, res) => {
  try {
    const u = (await db.query('SELECT email, totp_enabled FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u) return res.status(404).json({ error: 'Account not found.' });
    if (u.totp_enabled) return res.status(400).json({ error: 'Two-factor is already enabled. Disable it first to re-enroll.' });
    const secret = auth.generateTotpSecret();
    await db.query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, req.user.id]);
    res.json({ secret, uri: auth.totpUri(secret, u.email) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start two-factor setup.' }); }
});
// Confirm a code to turn 2FA on.
app.post('/api/auth/2fa/enable', auth.requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim();
  try {
    const u = (await db.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u || !u.totp_secret) return res.status(400).json({ error: 'Start setup first.' });
    if (u.totp_enabled) return res.status(400).json({ error: 'Two-factor is already enabled.' });
    if (!auth.verifyTotp(u.totp_secret, code)) return res.status(400).json({ error: 'That code isn’t valid. Check your authenticator app and try again.' });
    // Issue single-use recovery codes (returned once; only hashes are stored).
    const recovery = auth.generateRecoveryCodes(10);
    const hashes = recovery.map(auth.hashRecoveryCode);
    await db.query('UPDATE users SET totp_enabled = true, totp_recovery = $1 WHERE id = $2', [hashes, req.user.id]);
    res.json({ ok: true, twoFactorEnabled: true, recoveryCodes: recovery });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not enable two-factor.' }); }
});
// Regenerate recovery codes (invalidates the old set). Requires a current code.
app.post('/api/auth/2fa/recovery', auth.requireAuth, async (req, res) => {
  const code = String(req.body.code || '').trim();
  try {
    const u = (await db.query('SELECT totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u || !u.totp_enabled) return res.status(400).json({ error: 'Two-factor isn’t enabled.' });
    if (!auth.verifyTotp(u.totp_secret, code)) return res.status(403).json({ error: 'That code isn’t valid.' });
    const recovery = auth.generateRecoveryCodes(10);
    await db.query('UPDATE users SET totp_recovery = $1 WHERE id = $2', [recovery.map(auth.hashRecoveryCode), req.user.id]);
    res.json({ ok: true, recoveryCodes: recovery });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not regenerate recovery codes.' }); }
});
// Disable 2FA — requires the current password AND a current code (defence in depth).
app.post('/api/auth/2fa/disable', auth.requireAuth, async (req, res) => {
  const password = String(req.body.password || '');
  const code = String(req.body.code || '').trim();
  try {
    const u = (await db.query('SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u || !u.totp_enabled) return res.status(400).json({ error: 'Two-factor isn’t enabled.' });
    const okPw = await auth.verifyPassword(password, u.password_hash || auth.DUMMY_HASH);
    if (!okPw) return res.status(403).json({ error: 'Incorrect password.' });
    if (!auth.verifyTotp(u.totp_secret, code)) return res.status(403).json({ error: 'That code isn’t valid.' });
    await db.query("UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_recovery = '{}' WHERE id = $1", [req.user.id]);
    res.json({ ok: true, twoFactorEnabled: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not disable two-factor.' }); }
});

/* ─── GIF search (Tenor proxy; optional, env-gated) ─── */
app.get('/api/gif/search', auth.requireAuth, rateLimit(60, 60000, 'gif-search'), async (req, res) => {
  const key = process.env.TENOR_API_KEY;
  if (!key) return res.json({ configured: false, gifs: [] });
  const q = (req.query.q || '').toString().trim().slice(0, 80);
  const pos = (req.query.pos || '').toString().slice(0, 40);
  try {
    // Trending when there's no query; search otherwise.
    const base = q
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}`
      : `https://tenor.googleapis.com/v2/featured?`;
    const url = `${base}&key=${encodeURIComponent(key)}&client_key=atwe&limit=24&media_filter=tinygif,gif&contentfilter=high${pos ? '&pos=' + encodeURIComponent(pos) : ''}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: 'GIF search is unavailable right now.' });
    const data = await r.json();
    const gifs = (data.results || []).map((g) => {
      const mf = g.media_formats || {};
      const full = (mf.gif && mf.gif.url) || (mf.tinygif && mf.tinygif.url);
      const preview = (mf.tinygif && mf.tinygif.url) || full;
      return full ? { url: full, preview } : null;
    }).filter(Boolean);
    res.json({ configured: true, gifs, next: data.next || null });
  } catch (err) { console.error(err); res.status(502).json({ error: 'GIF search is unavailable right now.' }); }
});

// Privacy toggles (independent of the full profile editor): read receipts +
// anonymous profile views. Only the keys present are changed.
app.put('/api/privacy', auth.requireAuth, async (req, res) => {
  const fields = [], vals = [];
  if ('readReceipts' in req.body) { vals.push(req.body.readReceipts !== false); fields.push(`read_receipts = $${vals.length}`); }
  if ('privateProfileViews' in req.body) { vals.push(req.body.privateProfileViews === true); fields.push(`private_profile_views = $${vals.length}`); }
  if (!fields.length) return res.json({ ok: true });
  try {
    vals.push(req.user.id);
    const { rows } = await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING read_receipts, private_profile_views`, vals);
    res.json({ ok: true, readReceipts: rows[0].read_receipts !== false, privateProfileViews: !!rows[0].private_profile_views });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update privacy settings.' }); }
});

/* ─── Web Push subscriptions (PWA notifications) ─── */
app.post('/api/push/subscribe', auth.requireAuth, async (req, res) => {
  const sub = req.body.subscription || req.body;
  const endpoint = sub && typeof sub.endpoint === 'string' ? sub.endpoint : null;
  const p256dh = sub && sub.keys && sub.keys.p256dh, authKey = sub && sub.keys && sub.keys.auth;
  if (!endpoint || !p256dh || !authKey) return res.status(400).json({ error: 'Invalid push subscription.' });
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
      [req.user.id, endpoint.slice(0, 500), String(p256dh).slice(0, 200), String(authKey).slice(0, 200), ua]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the subscription.' }); }
});
app.post('/api/push/unsubscribe', auth.requireAuth, async (req, res) => {
  const endpoint = req.body.endpoint || (req.body.subscription && req.body.subscription.endpoint);
  try {
    if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [String(endpoint).slice(0, 500), req.user.id]);
    else await db.query('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user.id]); // no endpoint → remove all this user's
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the subscription.' }); }
});

/* ─── Devices / sessions — list + revoke (log out of all devices) ─── */
app.get('/api/auth/sessions', auth.requireAuth, async (req, res) => {
  try {
    // Prune dead rows first: a token is only valid 30 days from issuance, so a row
    // older than that is a definitely-expired session (or one whose device cleared
    // its storage without logging out) — otherwise it lingers as a phantom device.
    await db.query("DELETE FROM auth_sessions WHERE user_id = $1 AND created_at < now() - interval '31 days'", [req.user.id]).catch(() => {});
    const { rows } = await db.query(
      'SELECT id, user_agent, ip, location, created_at, last_seen, token_hash FROM auth_sessions WHERE user_id = $1 ORDER BY last_seen DESC LIMIT 100',
      [req.user.id]
    );
    res.json({ sessions: rows.map((r) => ({
      id: r.id, userAgent: r.user_agent || '', ip: r.ip || '', location: r.location || '',
      created_at: r.created_at, last_seen: r.last_seen, current: r.token_hash === req.tokenHash,
    })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load your devices.' }); }
});
// Remove one device (its token stops working).
app.delete('/api/auth/sessions/:id', auth.requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid session id.' });
  try {
    const { rows } = await db.query('DELETE FROM auth_sessions WHERE id = $1 AND user_id = $2 RETURNING token_hash', [id, req.user.id]);
    if (rows[0]) auth.sessionInvalidate(rows[0].token_hash);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove that device.' }); }
});
// Sign out the current device only (drops its session row).
app.post('/api/auth/logout', auth.requireAuth, async (req, res) => {
  try { await db.query('DELETE FROM auth_sessions WHERE token_hash = $1', [req.tokenHash]); auth.sessionInvalidate(req.tokenHash); } catch (e) {}
  res.json({ ok: true });
});
// Log out of ALL devices, including this one.
app.delete('/api/auth/sessions', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [req.user.id]);
    auth.sessionInvalidateAll();
    rtKickUser(req.user.id); // close live streams too, not just block future API calls
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// X-style verification: apply for the verified badge. Requires eligibility
// (Pro + complete profile + confirmed email + 30-day-old account); on success
// the request is queued (pending) for an admin to approve.
app.post('/api/verification/apply', auth.requireAuth, async (req, res) => {
  if (!db.isConfigured()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { rows } = await db.query(
      'SELECT id, name, plan, email_verified, avatar, verified, verify_requested_at, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    const st = verifyState(rows[0]);
    if (st.verified) return res.status(400).json({ error: 'You are already verified.', verification: st });
    if (st.pending) return res.json({ ok: true, verification: st });
    if (!st.eligible) return res.status(400).json({ error: 'Not eligible yet.', verification: st });
    await db.query('UPDATE users SET verify_requested_at = now() WHERE id = $1', [req.user.id]);
    res.json({ ok: true, verification: { ...st, pending: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update the signed-in user's profile: display name, @username, avatar photo.
app.put('/api/auth/profile', auth.requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  const username = (req.body.username || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Name is too long.' });
  if (username.length > 40) return res.status(400).json({ error: 'Username is too long.' });
  if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
  }
  // Block switching to an admin-locked username (but let the holder keep one
  // that was locked after they already had it).
  if (username && await usernameReserved(username)) {
    const mine = await db.query('SELECT 1 FROM users WHERE id = $1 AND lower(username) = lower($2)', [req.user.id, username]);
    if (!mine.rowCount) return res.status(409).json({ error: 'That username isn’t available.' });
  }

  // avatar / banner: absent = leave unchanged; '' / null = remove; data URL = set.
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  let setBanner = false, bannerVal = null;
  if ('banner' in req.body) {
    bannerVal = cleanImage(req.body.banner);
    if (bannerVal === undefined) return res.status(400).json({ error: 'That banner image could not be used.' });
    setBanner = true;
  }

  // birthday (dob): absent = unchanged; '' / null = clear; YYYY-MM-DD = set (must be 18+).
  let setDob = false, dobVal = null;
  if ('dob' in req.body) {
    const raw = (req.body.dob || '').trim();
    if (raw) {
      const age = ageFromDob(raw);
      if (age === null) return res.status(400).json({ error: 'Enter a valid date of birth.' });
      if (age < 18) return res.status(400).json({ error: 'You must be at least 18 years old.' });
      dobVal = raw;
    }
    setDob = true;
  }

  const fields = ['name = $1', 'username = $2'];
  const vals = [name, username || null];
  if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
  if (setBanner) { vals.push(bannerVal); fields.push(`banner = $${vals.length}`); }
  if (setDob) { vals.push(dobVal); fields.push(`dob = $${vals.length}`); }
  if ('bio' in req.body) { vals.push((req.body.bio || '').trim().slice(0, 280) || null); fields.push(`bio = $${vals.length}`); }
  if ('location' in req.body) { vals.push((req.body.location || '').trim().slice(0, 60) || null); fields.push(`location = $${vals.length}`); }
  if ('website' in req.body) {
    let w = (req.body.website || '').trim().slice(0, 120);
    // Tidy a bare domain into a usable link, but keep it null when empty.
    if (w && !/^https?:\/\//i.test(w)) w = 'https://' + w;
    vals.push(w || null); fields.push(`website = $${vals.length}`);
  }
  if ('contactEmail' in req.body) {
    const e = (req.body.contactEmail || '').trim().slice(0, 160);
    vals.push((e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) ? e : null);
    fields.push(`contact_email = $${vals.length}`);
  }
  if ('phone' in req.body) {
    vals.push((req.body.phone || '').trim().slice(0, 40) || null);
    fields.push(`phone = $${vals.length}`);
  }
  if ('note' in req.body) {
    vals.push((req.body.note || '').trim().slice(0, 80) || null);
    fields.push(`note = $${vals.length}`);
  }
  if ('headline' in req.body) {
    vals.push((req.body.headline || '').trim().slice(0, 120) || null);
    fields.push(`headline = $${vals.length}`);
  }
  if ('dmConnectionsOnly' in req.body) {
    vals.push(req.body.dmConnectionsOnly === true);
    fields.push(`dm_connections_only = $${vals.length}`);
  }
  if ('readReceipts' in req.body) {
    vals.push(req.body.readReceipts !== false);
    fields.push(`read_receipts = $${vals.length}`);
  }
  if ('privateProfileViews' in req.body) {
    vals.push(req.body.privateProfileViews === true);
    fields.push(`private_profile_views = $${vals.length}`);
  }
  if ('socials' in req.body) {
    // Accept any platform key (lowercase alphanumeric/underscore, <=24 chars);
    // value is a handle or URL, capped to keep the row small.
    const inObj = (req.body.socials && typeof req.body.socials === 'object' && !Array.isArray(req.body.socials)) ? req.body.socials : {};
    const out = {};
    for (const k of Object.keys(inObj)) {
      if (!/^[a-z0-9_]{1,24}$/.test(k)) continue;
      const v = typeof inObj[k] === 'string' ? inObj[k].trim().slice(0, 200) : '';
      if (v) out[k] = v;
      if (Object.keys(out).length >= 40) break;
    }
    vals.push(JSON.stringify(out)); fields.push(`socials = $${vals.length}::jsonb`);
  }
  vals.push(req.user.id);

  try {
    // Capture the old identity so we can email the user if it changes.
    const prev = (await db.query('SELECT name, username FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${vals.length}
       RETURNING id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, dob, verified, verify_requested_at, created_at, account_type, business_verify_status, dm_connections_only, has_password`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    // Security notice: email the user when their display name or @username changes.
    const changes = [];
    if (prev.name != null && rows[0].name !== prev.name) changes.push('display name');
    if ((prev.username || null) !== (rows[0].username || null)) changes.push('username');
    if (changes.length) sendProfileChangedEmail(rows[0], changes).catch((e) => console.error('Profile-changed email failed:', e.message));
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Erase ALL of the user's history — posts, comments, DMs, group messages, AI
// chats and notifications. The account, profile and username are kept.
app.delete('/api/auth/me/history', auth.requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    // Posts (cascades replies/likes/poll data/circle+feed links via FKs).
    await db.query('DELETE FROM posts WHERE user_id = $1', [uid]);
    // My likes / poll votes on other people's posts.
    await db.query('DELETE FROM post_likes WHERE user_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM post_poll_votes WHERE user_id = $1', [uid]).catch(() => {});
    // Direct messages (both directions) and my group messages.
    await db.query('DELETE FROM at_messages WHERE sender_id = $1 OR recipient_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM at_group_messages WHERE sender_id = $1', [uid]).catch(() => {});
    // AI assistant chats + projects.
    await db.query('DELETE FROM chats WHERE user_id = $1', [uid]).catch(() => {});
    await db.query('DELETE FROM projects WHERE user_id = $1', [uid]).catch(() => {});
    // Notifications to me or caused by me.
    await db.query('DELETE FROM notifications WHERE user_id = $1 OR actor_id = $1', [uid]).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Re-authenticate with the current password before a sensitive action
// (used by the "Delete account" flow to reveal the final confirm button).
app.post('/api/auth/verify-password', auth.requireAuth, rateLimit(10, 60000), async (req, res) => {
  const password = req.body.password || '';
  if (!password) return res.status(400).json({ error: 'Please enter your password.' });
  try {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    const ok = await auth.verifyPassword(password, rows[0].password_hash || auth.DUMMY_HASH);
    if (!ok) return res.status(401).json({ error: 'That password is incorrect.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Permanently delete the signed-in user's own account. The password is
// re-verified here too, so the destructive call can't be replayed without
// it. Relies on FK cascades (projects, chats, posts, messages, tokens, …)
// just like the admin delete.
app.delete('/api/auth/me', auth.requireAuth, rateLimit(10, 60000), async (req, res) => {
  const password = req.body.password || '';
  try {
    const { rows } = await db.query('SELECT password_hash, has_password, name, email FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    // Password accounts must re-verify; Google-only accounts (no password) are
    // authorized by their signed-in session + the in-app confirmation.
    if (rows[0].has_password !== false) {
      if (!password) return res.status(400).json({ error: 'Please enter your password.' });
      const ok = await auth.verifyPassword(password, rows[0].password_hash || auth.DUMMY_HASH);
      if (!ok) return res.status(401).json({ error: 'That password is incorrect.' });
    }
    const { name, email } = rows[0];
    await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    if (email) sendAccountDeletedEmail(email, name).catch((e) => console.error('Account-deleted email failed:', e.message));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// "Download your data" — a self-service GDPR-style export of the caller's own
// data as a single JSON bundle. Owner-scoped; never includes secrets (password
// hash, TOTP secret) or other users' private content.
app.get('/api/account/export', auth.requireAuth, rateLimit(5, 60000, 'data-export'), async (req, res) => {
  const uid = req.user.id;
  // Each entry: a label + a query. Missing tables/columns are tolerated (best-effort).
  const sections = {
    account: `SELECT id, name, email, username, plan, account_type, headline, bio, location, website, created_at, email_verified, verified, otw_visibility FROM users WHERE id = $1`,
    posts: `SELECT id, body, created_at, parent_id, subscribers_only FROM posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000`,
    direct_messages: `SELECT id, recipient_id, sender_id, body, created_at, (sender_id = $1) AS sent FROM at_messages WHERE (sender_id = $1 OR recipient_id = $1) AND NOT deleted_all ORDER BY created_at DESC LIMIT 10000`,
    group_memberships: `SELECT g.id, g.name FROM at_group_members m JOIN at_groups g ON g.id = m.group_id WHERE m.user_id = $1`,
    follows_following: `SELECT following_id FROM follows WHERE follower_id = $1`,
    followers: `SELECT follower_id FROM follows WHERE following_id = $1`,
    connections: `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS user_id, status, created_at FROM connections WHERE requester_id = $1 OR addressee_id = $1`,
    experiences: `SELECT title, company, start_year, end_year FROM experiences WHERE user_id = $1`,
    education: `SELECT school, degree, field, start_year, end_year FROM education WHERE user_id = $1`,
    certifications: `SELECT name, issuer, issue_year, expire_year, credential_id, url FROM certifications WHERE user_id = $1`,
    skills: `SELECT name FROM user_skills WHERE user_id = $1`,
    jobs_posted: `SELECT id, title, location, created_at FROM jobs WHERE posted_by = $1 ORDER BY created_at DESC LIMIT 1000`,
    job_applications: `SELECT job_id, status, created_at FROM job_applications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2000`,
    bookmarks: `SELECT post_id, created_at FROM post_bookmarks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000`,
    post_drafts: `SELECT id, body, updated_at FROM post_drafts WHERE user_id = $1`,
    notifications: `SELECT type, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2000`,
  };
  const out = { exportedAt: new Date().toISOString(), userId: uid };
  try {
    for (const [key, sql] of Object.entries(sections)) {
      try { out[key] = (await db.query(sql, [uid])).rows; }
      catch (e) { out[key] = { error: 'unavailable' }; } // tolerate a missing table/column
    }
    out.account = Array.isArray(out.account) ? (out.account[0] || null) : out.account; // single object
    res.setHeader('Content-Disposition', 'attachment; filename="atwe-data-export.json"');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not build your data export.' });
  }
});

// Confirm an email address from the link in the verification email.
app.post('/api/auth/verify', rateLimit(30, 60000), async (req, res) => {
  try {
    const userId = await consumeToken(req.body.token, 'verify');
    if (!userId) return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
    await db.query('UPDATE users SET email_verified = true WHERE id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Re-send the verification email to the signed-in user.
app.post('/api/auth/resend-verification', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, email, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });
    const raw = await issueToken(user.id, 'verify', 24 * 60 * 60 * 1000);
    await sendVerifyEmail(user, raw);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Start a password reset. Always 200 — never reveal whether the email exists.
app.post('/api/auth/forgot', rateLimit(5, 60000), async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  try {
    if (email) {
      const { rows } = await db.query('SELECT id, email FROM users WHERE lower(email) = $1', [email]);
      if (rows[0]) {
        const raw = await issueToken(rows[0].id, 'reset', 60 * 60 * 1000); // 1 hour
        await sendResetEmail(rows[0], raw);
      }
    }
  } catch (err) {
    console.error('Password reset request failed:', err.message);
  }
  res.json({ ok: true });
});

// Complete a password reset using the emailed token.
app.post('/api/auth/reset', rateLimit(15, 60000), async (req, res) => {
  const password = req.body.password || '';
  const pwIssue = auth.passwordIssue(password);
  if (pwIssue) return res.status(400).json({ error: pwIssue });
  try {
    const userId = await consumeToken(req.body.token, 'reset');
    if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    const hash = await auth.hashPassword(password);
    await db.query('UPDATE users SET password_hash = $1, has_password = true WHERE id = $2', [hash, userId]);
    // Invalidate any other outstanding reset tokens for this user.
    await db.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'reset'`, [userId]);
    // A reset must lock everyone out — drop every existing session (the whole point
    // of resetting if your account was compromised), and close their live streams.
    await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    auth.sessionInvalidateAll();
    rtKickUser(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── In-app code-based reset (from the password step: send code → verify → set) ──
// Send a 6-digit reset code to the account's email.
app.post('/api/auth/reset/send', rateLimit(6, 60000, 'reset-send'), async (req, res) => {
  try {
    const user = await findUserByIdentifier(req.body.identifier);
    if (user) {
      await db.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'reset_code'`, [user.id]);
      const code = makeSignupCode();
      await db.query(
        `INSERT INTO auth_tokens (token_hash, user_id, type, expires_at) VALUES ($1, $2, 'reset_code', $3)`,
        [auth.hashToken(code), user.id, new Date(Date.now() + 15 * 60 * 1000)]);
      try { await sendResetCode(user.email, user.name, code); } catch (e) { console.error('Reset code email failed:', e.message); }
    }
    // Don't leak whether the account exists, but echo a masked email when we have it.
    res.json({ ok: true, email: user ? maskEmail(user.email) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Check a reset code without consuming it (for the code-entry step).
app.post('/api/auth/reset/check', rateLimit(12, 60000, 'reset-check'), async (req, res) => {
  const code = (req.body.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  try {
    const user = await findUserByIdentifier(req.body.identifier);
    if (!user) return res.status(400).json({ error: 'That code is incorrect or expired.' });
    const { rowCount } = await db.query(
      `SELECT 1 FROM auth_tokens WHERE user_id = $1 AND type = 'reset_code' AND token_hash = $2 AND expires_at > now()`,
      [user.id, auth.hashToken(code)]);
    if (!rowCount) return res.status(400).json({ error: 'That code is incorrect or expired.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Confirm: verify the code, set the new password, and sign in.
app.post('/api/auth/reset/confirm', rateLimit(12, 60000, 'reset-confirm'), async (req, res) => {
  const code = (req.body.code || '').trim();
  const password = req.body.password || '';
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  const pwIssue = auth.passwordIssue(password);
  if (pwIssue) return res.status(400).json({ error: pwIssue });
  try {
    const user = await findUserByIdentifier(req.body.identifier);
    if (!user) return res.status(400).json({ error: 'That code is incorrect or expired.' });
    const del = await db.query(
      `DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'reset_code' AND token_hash = $2 AND expires_at > now() RETURNING user_id`,
      [user.id, auth.hashToken(code)]);
    if (!del.rowCount) return res.status(400).json({ error: 'That code is incorrect or expired.' });
    const hash = await auth.hashPassword(password);
    const { rows } = await db.query(`UPDATE users SET password_hash = $1, has_password = true WHERE id = $2 RETURNING ${RESET_USER_COLS}`, [hash, user.id]);
    await db.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type IN ('reset', 'reset_code')`, [user.id]);
    // Revoke every existing session + close live streams BEFORE issuing the new one,
    // so the device that just reset stays logged in but all others are kicked out.
    await db.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
    auth.sessionInvalidateAll();
    rtKickUser(user.id);
    const u = rows[0];
    res.json({ token: await issueSession(u, req), user: publicUser(u) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   PROJECTS  —  /api/projects
═══════════════════════════════════════════════ */
app.get('/api/projects', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, title FROM projects WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ projects: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Upsert (idempotent create/rename) keyed by the client-generated id.
app.put('/api/projects/:id', auth.requireAuth, async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });
  try {
    await db.query(
      `INSERT INTO projects (id, user_id, title) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
       WHERE projects.user_id = $2`,
      [req.params.id, req.user.id, title]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/projects/:id', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CHATS  —  /api/chats
═══════════════════════════════════════════════ */
app.get('/api/chats', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, project_id, title, messages, created_at
       FROM chats WHERE user_id = $1 ORDER BY updated_at DESC`,
      [req.user.id]
    );
    res.json({ chats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/chats/:id', auth.requireAuth, async (req, res) => {
  const title = (req.body.title || 'New chat').slice(0, 200);
  const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
  const projectId = req.body.projectId || null;
  try {
    await db.query(
      `INSERT INTO chats (id, user_id, project_id, title, messages, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE
         SET title = EXCLUDED.title,
             messages = EXCLUDED.messages,
             project_id = EXCLUDED.project_id,
             updated_at = now()
       WHERE chats.user_id = $2`,
      [req.params.id, req.user.id, projectId, title, JSON.stringify(messages)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/chats/:id', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM chats WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/chats', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM chats WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   MESSAGES  —  user side of the admin ↔ user thread
   The signed-in user reads messages from the Atwe team and replies.
═══════════════════════════════════════════════ */
app.get('/api/messages', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, sender, body, image, read_by_user, created_at
       FROM admin_messages WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    const unread = rows.filter((m) => m.sender === 'admin' && !m.read_by_user).length;
    res.json({
      messages: rows.map((m) => ({ id: m.id, sender: m.sender, body: m.body, image: m.image || null, created_at: m.created_at })),
      unread,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Mark all admin-sent messages as read (clears the user's unread badge).
app.post('/api/messages/read', auth.requireAuth, async (req, res) => {
  try {
    await db.query(
      `UPDATE admin_messages SET read_by_user = true
       WHERE user_id = $1 AND sender = 'admin' AND read_by_user = false`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// The user replies to the Atwe team; the reply surfaces in the admin dashboard.
app.post('/api/messages', auth.requireAuth, rateLimit(20, 60000), async (req, res) => {
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  if (!body && !image) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const { rows } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, image, read_by_user, read_by_admin)
       VALUES ($1, 'user', $2, $3, true, false)
       RETURNING id, sender, body, image, created_at`,
      [req.user.id, body, image]
    );
    res.json({ message: { ...rows[0], image: rows[0].image || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ATCHAT  —  user ↔ user direct messages (X-style)
   Requires the signed-in user to have a @username.
═══════════════════════════════════════════════ */
async function chatIdentity(userId) {
  const { rows } = await db.query('SELECT id, name, username, avatar, verified FROM users WHERE id = $1', [userId]);
  return rows[0] || null;
}
// Strict numeric id from a route param (rejects "5abc" etc.).
function routeId(v) {
  return /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
}
const NEED_USERNAME = { error: 'Choose a username first to use AtChat.', code: 'username_required' };

// Find users by @username (or name) to start a conversation.
app.get('/api/atchat/search', auth.requireAuth, rateLimit(60, 60000, 'atchat-search'), async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const q = (req.query.q || '').toString().trim().replace(/^@/, '');
    if (q.length < 1) return res.json({ users: [] });
    const { rows } = await db.query(
      `SELECT id, name, username, avatar, verified, categories FROM users
       WHERE username IS NOT NULL AND id <> $1 AND (
         username ILIKE $2 OR name ILIKE $2
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories) c WHERE c ILIKE $2)
       )
       ORDER BY (username ILIKE $3) DESC, username ASC LIMIT 20`,
      [req.user.id, '%' + q + '%', q + '%']
    );
    res.json({ users: rows.map(r => ({ ...r, categories: Array.isArray(r.categories) ? r.categories : [] })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// List the signed-in user's conversations (latest message + unread count each).
app.get('/api/atchat/conversations', auth.requireAuth, async (req, res) => {
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const { rows } = await db.query(
      `SELECT partner.id, partner.name, partner.username, partner.avatar,
              lm.body AS last_body, (lm.image IS NOT NULL) AS last_image, lm.media_kind AS last_media_kind,
              lm.meta->>'t' AS last_meta,
              lm.deleted_all AS last_deleted, lm.hidden AS last_hidden,
              lm.created_at AS last_at, (lm.sender_id = $1) AS last_mine,
              COALESCE(uc.unread, 0)::int AS unread,
              (1 + (SELECT COUNT(*)::int FROM dm_threads dt WHERE dt.a = LEAST($1, p.other_id) AND dt.b = GREATEST($1, p.other_id))) AS thread_count
       FROM (
         SELECT DISTINCT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END AS other_id
         FROM at_messages WHERE sender_id = $1 OR recipient_id = $1
       ) p
       JOIN users partner ON partner.id = p.other_id AND partner.username IS NOT NULL
       LEFT JOIN at_cleared cl ON cl.user_id = $1 AND cl.other_id = p.other_id
       JOIN LATERAL (
         SELECT body, image, media_kind, meta, deleted_all, ($1 = ANY(hidden_for)) AS hidden, created_at, sender_id FROM at_messages m
         WHERE ((m.sender_id = $1 AND m.recipient_id = p.other_id)
            OR (m.sender_id = p.other_id AND m.recipient_id = $1))
           AND m.created_at > COALESCE(cl.cleared_at, '-infinity'::timestamptz)
         ORDER BY created_at DESC LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread FROM at_messages m
         WHERE m.sender_id = p.other_id AND m.recipient_id = $1 AND m.read_at IS NULL
           AND m.sender_id <> m.recipient_id  -- self-chat (message-yourself) is never unread
           AND m.created_at > COALESCE(cl.cleared_at, '-infinity'::timestamptz)
       ) uc ON true
       ORDER BY lm.created_at DESC`,
      [req.user.id]
    );
    res.json({ conversations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Validate a thread id belongs to the (me, other) pair. Returns the integer thread
// id, null for the main conversation, or undefined if the id is bogus.
async function resolveDmThread(meId, otherId, threadId) {
  if (threadId == null || threadId === '' || threadId === 0 || threadId === '0') return null; // main
  const tid = parseInt(threadId, 10);
  if (!Number.isInteger(tid)) return undefined;
  const [a, b] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const r = await db.query('SELECT id FROM dm_threads WHERE id = $1 AND a = $2 AND b = $3', [tid, a, b]);
  return r.rows[0] ? tid : undefined;
}
// List the conversations (threads) I have with one person: the main chat + any
// extra threads, each with its last message + unread count.
app.get('/api/atchat/threads/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const [a, b] = req.user.id < other ? [req.user.id, other] : [other, req.user.id];
    const extra = await db.query('SELECT id, title FROM dm_threads WHERE a = $1 AND b = $2 ORDER BY id ASC', [a, b]);
    const list = [{ id: null, title: null }, ...extra.rows.map((t) => ({ id: t.id, title: t.title || null }))];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const cond = t.id == null ? 'thread_id IS NULL' : 'thread_id = $3';
      const params = t.id == null ? [req.user.id, other] : [req.user.id, other, t.id];
      const lm = await db.query(
        `SELECT body, (image IS NOT NULL OR media IS NOT NULL) AS has_media, meta->>'t' AS meta_t, created_at, deleted_all
           FROM at_messages
          WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1)) AND ${cond}
            AND created_at > COALESCE((SELECT cleared_at FROM at_cleared WHERE user_id = $1 AND other_id = $2), '-infinity'::timestamptz)
            AND NOT ($1 = ANY(deleted_for)) AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC LIMIT 1`, params);
      const un = await db.query(
        `SELECT COUNT(*)::int n FROM at_messages
          WHERE sender_id = $2 AND recipient_id = $1 AND read_at IS NULL AND sender_id <> recipient_id AND ${cond}
            AND created_at > COALESCE((SELECT cleared_at FROM at_cleared WHERE user_id = $1 AND other_id = $2), '-infinity'::timestamptz)`, params);
      const m = lm.rows[0];
      out.push({
        id: t.id,
        title: t.title || (t.id == null ? 'Main chat' : 'Conversation ' + (i + 1)),
        lastBody: m ? (m.deleted_all ? 'Message deleted' : (m.body || (m.has_media ? '📎 Attachment' : (m.meta_t ? 'Card' : '')))) : '',
        lastAt: m ? m.created_at : null,
        unread: un.rows[0].n,
      });
    }
    res.json({ threads: out });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load conversations.' }); }
});
// Start a new parallel conversation with someone (keeps the existing one separate).
app.post('/api/atchat/threads/:id', auth.requireAuth, rateLimit(20, 60000, 'dm-thread'), async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  if (other === req.user.id) return res.status(400).json({ error: 'Pick someone else.' });
  const title = (req.body.title || '').toString().trim().slice(0, 80) || null;
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    const [a, b] = req.user.id < other ? [req.user.id, other] : [other, req.user.id];
    const cnt = await db.query('SELECT COUNT(*)::int n FROM dm_threads WHERE a = $1 AND b = $2', [a, b]);
    if (cnt.rows[0].n >= 20) return res.status(400).json({ error: 'You have too many conversations with this person.' });
    const r = await db.query('INSERT INTO dm_threads (a, b, title, created_by) VALUES ($1,$2,$3,$4) RETURNING id, title', [a, b, title, req.user.id]);
    res.status(201).json({ thread: { id: r.rows[0].id, title: r.rows[0].title || null } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start a new conversation.' }); }
});

// Unread split into DMs vs groups (for the AtChat badge + the Messages/Groups tab dots).
// Archived conversations and muted DMs don't count toward the badge; muted groups
// are already excluded via `NOT m.muted`.
app.get('/api/atchat/unread', auth.requireAuth, async (req, res) => {
  try {
    const pr = await db.query('SELECT chat_archived, chat_muted, chat_mute_until FROM users WHERE id = $1', [req.user.id]);
    const arch = pr.rows[0]?.chat_archived || [], muted = pr.rows[0]?.chat_muted || [];
    const until = pr.rows[0]?.chat_mute_until || {};
    const now = Date.now();
    // A timed DM mute that has elapsed no longer suppresses the badge.
    const muteActive = muted.filter((k) => { const u = until[k]; return !(u && now >= u); });
    const num = (k) => parseInt(String(k).slice(1), 10);
    const exDm = [...new Set([...arch, ...muteActive].filter((k) => /^d\d+$/.test(k)).map(num))]; // archived OR muted DMs
    const exGrp = [...new Set(arch.filter((k) => /^g\d+$/.test(k)).map(num))];                  // archived groups
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM at_messages am WHERE am.recipient_id = $1 AND am.read_at IS NULL
                 AND am.sender_id <> am.recipient_id  -- exclude message-yourself notes
                 AND am.sender_id <> ALL($2::int[])   -- exclude archived/muted DMs
                 AND am.created_at > COALESCE((SELECT cleared_at FROM at_cleared cl WHERE cl.user_id = $1 AND cl.other_id = am.sender_id), '-infinity'::timestamptz)) AS dm,
              (SELECT COUNT(*)::int FROM at_group_members m
                 JOIN at_group_messages x ON x.group_id = m.group_id
                 WHERE m.user_id = $1 AND NOT (m.muted AND (m.muted_until IS NULL OR m.muted_until > now()))
                 AND m.group_id <> ALL($3::int[]) AND x.sender_id <> $1 AND x.created_at > m.last_read_at) AS grp`,
      [req.user.id, exDm, exGrp]
    );
    const dm = rows[0]?.dm || 0, grp = rows[0]?.grp || 0;
    res.json({ unread: dm + grp, dmUnread: dm, groupUnread: grp });
  } catch (err) {
    console.error(err);
    res.json({ unread: 0, dmUnread: 0, groupUnread: 0 });
  }
});

// Chat-list prefs (pinned conversations + the unread-only filter), synced across
// a user's devices. Pins are conversation keys like "d<userId>" / "g<groupId>".
const cleanKeys = (a) => Array.isArray(a)
  ? [...new Set(a.filter((k) => typeof k === 'string' && /^[dg]\d{1,18}$/.test(k)))].slice(0, 500)
  : [];
// Mute-expiry map: { "d2": <epoch ms> }, keyed like a muted DM, value a positive
// future timestamp. Drops junk keys/values and caps the size.
const cleanMuteUntil = (o) => {
  const out = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of Object.keys(o)) {
      if (!/^d\d{1,18}$/.test(k)) continue;
      const v = Number(o[k]);
      if (Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
      if (Object.keys(out).length >= 500) break;
    }
  }
  return out;
};
app.get('/api/atchat/prefs', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT chat_pins, chat_archived, chat_muted, chat_mute_until, chat_unread_only, chat_locked, chat_lock_pin, chat_themes FROM users WHERE id = $1', [req.user.id]);
    const r = rows[0] || {};
    res.json({
      pins: Array.isArray(r.chat_pins) ? r.chat_pins : [],
      archived: Array.isArray(r.chat_archived) ? r.chat_archived : [],
      muted: Array.isArray(r.chat_muted) ? r.chat_muted : [],
      muteUntil: (r.chat_mute_until && typeof r.chat_mute_until === 'object' && !Array.isArray(r.chat_mute_until)) ? r.chat_mute_until : {},
      unreadOnly: !!r.chat_unread_only,
      // Locked chats: the keys are returned (so the client can hide them), plus
      // whether a passcode exists. The passcode itself is never sent.
      locked: Array.isArray(r.chat_locked) ? r.chat_locked : [],
      hasLockPin: !!r.chat_lock_pin,
      themes: (r.chat_themes && typeof r.chat_themes === 'object' && !Array.isArray(r.chat_themes)) ? r.chat_themes : {},
    });
  } catch (err) {
    console.error(err);
    res.json({ pins: [], archived: [], muted: [], muteUntil: {}, unreadOnly: false, locked: [], hasLockPin: false, themes: {} });
  }
});
// Set (or clear) the wallpaper/theme for one conversation. theme '' clears it.
app.post('/api/atchat/theme', auth.requireAuth, async (req, res) => {
  const key = String(req.body.key || '').trim();
  const theme = String(req.body.theme || '').trim().slice(0, 40);
  if (!/^[dg]\d+$/.test(key)) return res.status(400).json({ error: 'Invalid thread.' });
  try {
    if (theme) {
      await db.query(`UPDATE users SET chat_themes = jsonb_set(COALESCE(chat_themes,'{}'::jsonb), $1, to_jsonb($2::text)) WHERE id = $3`, [`{${key}}`, theme, req.user.id]);
    } else {
      await db.query(`UPDATE users SET chat_themes = (COALESCE(chat_themes,'{}'::jsonb) - $1) WHERE id = $2`, [key, req.user.id]);
    }
    res.json({ ok: true, key, theme });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not set the wallpaper.' }); }
});
app.put('/api/atchat/prefs', auth.requireAuth, async (req, res) => {
  const pins = cleanKeys(req.body.pins);
  const archived = cleanKeys(req.body.archived);
  const muted = cleanKeys(req.body.muted);
  const muteUntil = cleanMuteUntil(req.body.muteUntil);
  const unreadOnly = req.body.unreadOnly === true;
  try {
    await db.query('UPDATE users SET chat_pins = $1::jsonb, chat_archived = $2::jsonb, chat_muted = $3::jsonb, chat_mute_until = $5::jsonb, chat_unread_only = $4 WHERE id = $6',
      [JSON.stringify(pins), JSON.stringify(archived), JSON.stringify(muted), unreadOnly, JSON.stringify(muteUntil), req.user.id]);
    res.json({ ok: true, pins, archived, muted, muteUntil, unreadOnly });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save preferences.' });
  }
});

// Mark a DM thread read (used when a live message lands while it's open).
// Read receipts are reciprocal (WhatsApp-style): the blue "seen" signal only
// flows when BOTH people have receipts on. Read state is still tracked for unread
// badges; only the cross-user receipt is suppressed.
async function bothReceiptsOn(a, b) {
  try {
    const { rows } = await db.query('SELECT id, read_receipts FROM users WHERE id = ANY($1)', [[a, b]]);
    return rows.length === 2 && rows.every((r) => r.read_receipts !== false);
  } catch { return true; } // fail open — don't lose receipts on a DB blip
}
const SECRET_SECONDS = 10; // a secret message self-destructs this long after it's seen
// Start the self-destruct countdown on any not-yet-seen secret messages the recipient
// is now viewing (stamps expires_at once), and tell the sender so their copy counts
// down + vanishes too. Returns the affected ids (for the read payload to reflect).
async function startSecretTimers(recipientId, senderId, thread) {
  try {
    const r = await db.query(
      `UPDATE at_messages SET expires_at = now() + interval '${SECRET_SECONDS} seconds'
         WHERE recipient_id = $1 AND sender_id = $2 AND thread_id IS NOT DISTINCT FROM $3
           AND secret = true AND expires_at IS NULL AND deleted_all = false
       RETURNING id, expires_at`,
      [recipientId, senderId, thread]
    );
    for (const row of r.rows) rtPush(senderId, 'dm_secret', { id: row.id, peerId: recipientId, expiresAt: row.expires_at });
    return r.rows;
  } catch (e) { return []; }
}
app.post('/api/atchat/with/:id/read', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    // Thread-scoped: opening one conversation must not clear unread on the others.
    const thread = await resolveDmThread(req.user.id, other, req.query.thread);
    if (thread === undefined) return res.json({ ok: false });
    await startSecretTimers(req.user.id, other, thread); // seeing it starts the self-destruct
    const r = await db.query('UPDATE at_messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL AND thread_id IS NOT DISTINCT FROM $3', [req.user.id, other, thread]);
    if (r.rowCount) {
      if (await bothReceiptsOn(req.user.id, other)) rtPush(other, 'read', { peerId: req.user.id }); // tell the sender their messages were seen
      rtPush(req.user.id, 'read-self', { peerId: other });     // tell MY other devices to clear this thread's unread
    }
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});
// Mark a DM thread UNREAD: re-open the most recent incoming message so it counts
// as unread again (badge + list reflect it; opening the thread re-reads it).
app.post('/api/atchat/with/:id/unread', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other) || other === req.user.id) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const r = await db.query(
      `UPDATE at_messages SET read_at = NULL WHERE id = (
         SELECT id FROM at_messages WHERE recipient_id = $1 AND sender_id = $2 AND sender_id <> recipient_id
         ORDER BY created_at DESC LIMIT 1)`,
      [req.user.id, other]
    );
    res.json({ ok: !!r.rowCount });
  } catch (err) { res.json({ ok: false }); }
});
// Mark a group thread read.
app.post('/api/atchat/groups/:id/read', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    await db.query('UPDATE at_group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    rtPush(req.user.id, 'read-self', { groupId: gid }); // tell MY other devices to clear this group's unread
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});
// Mark a group UNREAD: rewind last_read_at to just before the newest message from
// someone else, so it shows (at least) one unread.
app.post('/api/atchat/groups/:id/unread', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    const r = await db.query(
      `UPDATE at_group_members SET last_read_at = sub.t - interval '1 millisecond'
       FROM (SELECT MAX(created_at) AS t FROM at_group_messages WHERE group_id = $1 AND sender_id <> $2) sub
       WHERE group_id = $1 AND user_id = $2 AND sub.t IS NOT NULL`,
      [gid, req.user.id]
    );
    res.json({ ok: !!r.rowCount });
  } catch (err) { res.json({ ok: false }); }
});

// Read the thread with one user (marks their messages to me as read).
app.get('/api/atchat/with/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    // Which conversation (thread) with this person — null = the main chat.
    const thread = await resolveDmThread(req.user.id, other, req.query.thread);
    if (thread === undefined) return res.status(404).json({ error: 'Conversation not found.' });
    // Seeing the thread starts the self-destruct timer on any unseen secret messages.
    await startSecretTimers(req.user.id, other, thread);
    const { rows } = await db.query(
      `SELECT id, sender_id, body, image, images, media, media_kind, media_name, created_at, read_at, deleted_all, reply_to, edited, forwarded, meta, client_id, view_once, secret, expires_at, ($1 = ANY(viewed_by)) AS viewed,
              ($1 = ANY(hidden_for)) AS hidden, ($1 = ANY(starred_by)) AS starred, reactions FROM at_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND thread_id IS NOT DISTINCT FROM $3
         AND created_at > COALESCE((SELECT cleared_at FROM at_cleared WHERE user_id = $1 AND other_id = $2), '-infinity'::timestamptz)
         AND NOT ($1 = ANY(deleted_for))
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at ASC`,
      [req.user.id, other, thread]
    );
    // Only mark the messages we actually returned as read — avoids clearing the
    // unread badge for a message that arrived after this SELECT.
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    // Reciprocal read receipts: the "seen" signal flows only when both opted in.
    const showReceipts = await bothReceiptsOn(req.user.id, other);
    db.query(
      `UPDATE at_messages SET read_at = now()
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL AND id <= $3 AND thread_id IS NOT DISTINCT FROM $4`,
      [req.user.id, other, lastId, thread]
    ).then((r) => { if (r.rowCount && showReceipts) rtPush(other, 'read', { peerId: req.user.id }); }).catch(() => {});
    // Chat-permission state for the composer: can I message them, did I send a
    // request, and do they have a pending request to me (→ Allow/Decline bar).
    const canMessage = await dmAllowed(req.user.id, other);
    let request = null, incomingRequest = null, connectGated = false;
    try {
      const outg = await db.query('SELECT status FROM chat_requests WHERE requester_id = $1 AND recipient_id = $2', [req.user.id, other]);
      if (outg.rows[0]) request = outg.rows[0].status;
      const inc = await db.query("SELECT id, body FROM chat_requests WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending'", [other, req.user.id]);
      if (inc.rows[0]) incomingRequest = { id: inc.rows[0].id, body: inc.rows[0].body || null };
      // If they only accept DMs from connections and we aren't connected, the
      // client should prompt "connect first" instead of the chat-request bar.
      if (!canMessage) {
        const g = await db.query('SELECT dm_connections_only FROM users WHERE id = $1', [other]);
        connectGated = !!(g.rows[0] && g.rows[0].dm_connections_only);
      }
    } catch (e) { /* permission extras are best-effort */ }
    res.json({
      peer: { id: peer.id, name: peer.name, username: peer.username, avatar: peer.avatar || null },
      canMessage, request, incomingRequest, connectGated, thread,
      disappearing: await dmDisappearSeconds(req.user.id, other),
      messages: rows.map((m) => {
        // View-once: never ship the bytes in the thread payload. The recipient
        // opens it via the view endpoint (once); afterwards it reads as "opened".
        const vo = !!m.view_once;
        return {
        id: m.id, body: m.body, image: vo ? null : (m.image || null),
        images: vo ? [] : ((Array.isArray(m.images) && m.images.length) ? m.images : (m.image ? [m.image] : [])),
        media: vo ? null : (m.media || null), media_kind: m.media_kind || null, media_name: m.media_name || null,
        viewOnce: vo, viewed: vo ? !!m.viewed : false,
        created_at: m.created_at, mine: m.sender_id === req.user.id, read_at: showReceipts ? (m.read_at || null) : null, clientId: m.client_id || null,
        deleted: !!m.deleted_all, hidden: !!m.hidden, starred: !!m.starred, reactions: m.reactions || {},
        reply_to: m.reply_to || null, edited: !!m.edited, forwarded: !!m.forwarded, meta: m.meta || null,
        secret: !!m.secret, expiresAt: m.expires_at || null,
        };
      }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Send a DM to another user.
app.post('/api/atchat/with/:id', auth.requireAuth, rateLimit(40, 60000, 'atchat-send'), async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  const body = (req.body.body || '').trim();
  const imgs = cleanImages(req.body.images);
  if (imgs === undefined) return res.status(400).json({ error: 'Those images could not be attached.' });
  const gifUrl = cleanGifUrl(req.body.gifUrl);
  let image = gifUrl || (imgs.length ? imgs[0] : cleanImage(req.body.image));
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That file could not be attached (unsupported type or too large — 16 MB max).' });
  const meta = cleanMeta(req.body.meta);
  if (meta === undefined) return res.status(400).json({ error: 'That couldn’t be attached.' });
  const replyTo = Number.isInteger(req.body.replyTo) ? req.body.replyTo : null;
  const clientId = (typeof req.body.clientId === 'string' && req.body.clientId.length <= 64) ? req.body.clientId : null;
  // View-once is only meaningful for a photo/video — never for plain text.
  const viewOnce = req.body.viewOnce === true && !!(image || media.data);
  // Secret (self-destruct) — text or photo; the timer starts when the recipient sees it.
  const secret = req.body.secret === true && !!(body || image) && !meta;
  if (!body && !image && !media.data && !meta) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    if (!(await dmAllowed(req.user.id, other))) {
      return res.status(403).json({ error: 'This person only accepts messages from people they’ve approved. You can send them a chat request instead.', needRequest: true });
    }
    // Which conversation (thread) — null = main chat. A bogus id is rejected.
    const thread = await resolveDmThread(req.user.id, other, req.body.threadId);
    if (thread === undefined) return res.status(404).json({ error: 'Conversation not found.' });
    // Idempotent insert: a resend with the same clientId hits the unique
    // (sender_id, client_id) index and inserts nothing; we then return the
    // original row (and skip re-delivery) so a retry never duplicates a message.
    const COLS = 'id, body, image, images, media, media_kind, media_name, created_at, reply_to, forwarded, meta, view_once, thread_id, secret';
    // Disappearing-messages timer (if the conversation has one on). A secret message
    // has NO timer at send — it starts counting down only when the recipient sees it.
    const dsec = secret ? 0 : await dmDisappearSeconds(req.user.id, other);
    const ins = await db.query(
      `INSERT INTO at_messages (sender_id, recipient_id, body, image, images, media, media_kind, media_name, reply_to, forwarded, meta, client_id, view_once, thread_id, secret, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, ${dsec ? `now() + interval '${dsec} seconds'` : 'NULL'})
       ON CONFLICT (sender_id, client_id) DO NOTHING RETURNING ${COLS}`,
      [req.user.id, other, body, image, imgs.length > 1 ? imgs : null, media.data, media.kind, media.name, replyTo, !!req.body.forwarded, meta ? JSON.stringify(meta) : null, clientId, viewOnce, thread, secret]
    );
    let r = ins.rows[0];
    const isNew = !!r;
    if (!r) { // conflict (duplicate resend) — return the message we already stored
      const ex = await db.query(`SELECT ${COLS} FROM at_messages WHERE sender_id = $1 AND client_id = $2`, [req.user.id, clientId]);
      r = ex.rows[0];
      if (!r) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    const msg = { id: r.id, body: r.body, image: r.image || null, images: (Array.isArray(r.images) && r.images.length) ? r.images : (r.image ? [r.image] : []), media: r.media || null, media_kind: r.media_kind || null, media_name: r.media_name || null, created_at: r.created_at, reply_to: r.reply_to || null, forwarded: !!r.forwarded, meta: r.meta || null, viewOnce: !!r.view_once, threadId: r.thread_id || null, secret: !!r.secret };
    if (isNew) {
      // For a view-once message the recipient's live copy carries no media — they
      // must open it via the view endpoint (which records the one view).
      // Replying to someone who had a pending request to me accepts it (X-style).
      db.query("UPDATE chat_requests SET status = 'accepted', updated_at = now() WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING id", [other, req.user.id])
        .then((u) => { if (u.rowCount) return db.query('INSERT INTO contact_allow (owner_id, allowed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, other]); })
        .catch(() => {});
      // Live-deliver to the recipient (their copy is not "mine"). A view-once
      // photo/video is delivered without its bytes (opened via the view endpoint).
      const delivered = viewOnce
        ? { ...msg, mine: false, image: null, images: [], media: null, viewed: false }
        : { ...msg, mine: false };
      rtPush(other, 'msg', { kind: 'dm', peerId: req.user.id, message: delivered });
      notify(other, req.user.id, 'message', null);
    }
    res.json({ message: { ...msg, mine: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Open a view-once DM photo/video. The recipient may open it exactly once; the
// bytes are returned, the viewer is recorded, and the sender is notified.
app.post('/api/atchat/message/:id/view', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid message id.' });
  try {
    const m = (await db.query(
      'SELECT sender_id, recipient_id, image, images, media, media_kind, media_name, view_once, viewed_by, deleted_all FROM at_messages WHERE id = $1', [id])).rows[0];
    if (!m || m.deleted_all) return res.status(404).json({ error: 'That photo is no longer available.' });
    if (!m.view_once) return res.status(400).json({ error: 'Not a view-once message.' });
    if (m.recipient_id !== req.user.id) return res.status(403).json({ error: 'You can’t open this.' });
    if ((m.viewed_by || []).includes(req.user.id)) return res.status(410).json({ error: 'You’ve already opened this once.', expired: true });
    await db.query('UPDATE at_messages SET viewed_by = array_append(viewed_by, $1) WHERE id = $2', [req.user.id, id]);
    rtPush(m.sender_id, 'viewonce', { peerId: req.user.id, id });
    res.json({
      id,
      image: m.image || null,
      images: (Array.isArray(m.images) && m.images.length) ? m.images : (m.image ? [m.image] : []),
      media: m.media || null, media_kind: m.media_kind || null, media_name: m.media_name || null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not open the photo.' }); }
});

/* ─── Scheduled messages (send later) ─── */
const SCHEDULE_MAX_MS = 365 * 24 * 3600 * 1000; // up to a year out
// Queue a text message to deliver later (DM or group).
app.post('/api/atchat/schedule', auth.requireAuth, rateLimit(30, 60000, 'msg-schedule'), async (req, res) => {
  const kind = req.body.kind === 'group' ? 'group' : 'dm';
  const body = (req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Type a message to schedule.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  const when = new Date(req.body.sendAt);
  if (isNaN(when.getTime())) return res.status(400).json({ error: 'Pick a valid date and time.' });
  if (when.getTime() < Date.now() + 30000) return res.status(400).json({ error: 'Pick a time at least a minute from now.' });
  if (when.getTime() > Date.now() + SCHEDULE_MAX_MS) return res.status(400).json({ error: 'That’s too far in the future.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    let recipientId = null, groupId = null;
    if (kind === 'dm') {
      recipientId = parseInt(req.body.to, 10);
      if (!Number.isInteger(recipientId)) return res.status(400).json({ error: 'Invalid recipient.' });
      const peer = await chatIdentity(recipientId);
      if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
      if (!(await dmAllowed(req.user.id, recipientId))) return res.status(403).json({ error: 'You can’t message this person yet.' });
    } else {
      groupId = parseInt(req.body.to, 10);
      if (!Number.isInteger(groupId) || !(await isGroupMember(groupId, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
      const gb = await db.query('SELECT created_by, broadcast FROM at_groups WHERE id = $1', [groupId]);
      if (gb.rows[0] && gb.rows[0].broadcast && gb.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the admin can post in this channel.' });
    }
    const ins = await db.query(
      `INSERT INTO scheduled_messages (sender_id, kind, recipient_id, group_id, body, send_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, send_at`,
      [req.user.id, kind, recipientId, groupId, body, when.toISOString()]
    );
    res.json({ ok: true, id: ins.rows[0].id, sendAt: ins.rows[0].send_at });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not schedule the message.' }); }
});
// List my scheduled (not-yet-sent) messages, with peer/group context.
app.get('/api/atchat/scheduled', auth.requireAuth, async (req, res) => {
  try {
    const filterKind = req.query.kind === 'dm' || req.query.kind === 'group' ? req.query.kind : null;
    const to = parseInt(req.query.to, 10);
    const params = [req.user.id]; let extra = '';
    if (filterKind === 'dm' && Number.isInteger(to)) { params.push(to); extra = ` AND s.kind = 'dm' AND s.recipient_id = $${params.length}`; }
    else if (filterKind === 'group' && Number.isInteger(to)) { params.push(to); extra = ` AND s.kind = 'group' AND s.group_id = $${params.length}`; }
    const { rows } = await db.query(
      `SELECT s.id, s.kind, s.body, s.send_at, s.recipient_id, s.group_id,
              u.name AS peer_name, u.username AS peer_username, u.avatar AS peer_avatar,
              g.name AS group_name, g.username AS group_username, g.avatar AS group_avatar
       FROM scheduled_messages s
       LEFT JOIN users u ON u.id = s.recipient_id
       LEFT JOIN at_groups g ON g.id = s.group_id
       WHERE s.sender_id = $1${extra} ORDER BY s.send_at ASC LIMIT 200`,
      params
    );
    res.json({ scheduled: rows.map((s) => ({
      id: s.id, kind: s.kind, body: s.body, sendAt: s.send_at,
      peer: s.recipient_id ? { id: s.recipient_id, name: s.peer_name, username: s.peer_username, avatar: s.peer_avatar || null } : null,
      group: s.group_id ? { id: s.group_id, name: s.group_name, username: s.group_username || null, avatar: s.group_avatar || null } : null,
    })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load scheduled messages.' }); }
});
// Cancel a scheduled message (sender only).
app.delete('/api/atchat/scheduled/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM scheduled_messages WHERE id = $1 AND sender_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not cancel.' }); }
});
// Deliver one due scheduled row (re-checks permission/membership at send time).
async function deliverScheduled(s) {
  const sender = await chatIdentity(s.sender_id);
  if (!sender || !sender.username) return;
  if (s.kind === 'dm') {
    if (!(await dmAllowed(s.sender_id, s.recipient_id))) return; // permission revoked since scheduling
    const dsec = await dmDisappearSeconds(s.sender_id, s.recipient_id);
    const ins = await db.query(
      `INSERT INTO at_messages (sender_id, recipient_id, body, expires_at)
       VALUES ($1,$2,$3,${dsec ? `now() + interval '${dsec} seconds'` : 'NULL'})
       RETURNING id, body, created_at`,
      [s.sender_id, s.recipient_id, s.body]
    );
    const r = ins.rows[0];
    const msg = { id: r.id, body: r.body, image: null, media: null, media_kind: null, media_name: null, created_at: r.created_at, reply_to: null, forwarded: false, meta: null };
    rtPush(s.recipient_id, 'msg', { kind: 'dm', peerId: s.sender_id, message: { ...msg, mine: false } });
    rtPush(s.sender_id, 'msg', { kind: 'dm', peerId: s.recipient_id, message: { ...msg, mine: true } });
    notify(s.recipient_id, s.sender_id, 'message', null);
  } else {
    if (!(await isGroupMember(s.group_id, s.sender_id))) return;
    const gd = await db.query('SELECT disappearing FROM at_groups WHERE id = $1', [s.group_id]);
    const gsec = (gd.rows[0] && gd.rows[0].disappearing) || 0;
    const ins = await db.query(
      `INSERT INTO at_group_messages (group_id, sender_id, body, expires_at)
       VALUES ($1,$2,$3,${gsec ? `now() + interval '${gsec} seconds'` : 'NULL'})
       RETURNING id, body, created_at`,
      [s.group_id, s.sender_id, s.body]
    );
    const r = ins.rows[0];
    const base = { id: r.id, body: r.body, image: null, media: null, media_kind: null, media_name: null, created_at: r.created_at, forwarded: false, meta: null,
      sender: { id: sender.id, name: sender.name, username: sender.username, avatar: sender.avatar || null } };
    for (const id of await groupMemberIds(s.group_id, s.sender_id)) rtPush(id, 'msg', { kind: 'group', groupId: s.group_id, message: { ...base, mine: false } });
    rtPush(s.sender_id, 'msg', { kind: 'group', groupId: s.group_id, message: { ...base, mine: true } });
  }
}
// Flusher: deliver every due scheduled message, then drop it. Runs on an interval.
let _scheduleFlushing = false;
async function flushScheduledMessages() {
  if (_scheduleFlushing || !db.isConfigured || !db.isConfigured()) return;
  _scheduleFlushing = true;
  try {
    const due = await db.query(`SELECT * FROM scheduled_messages WHERE send_at <= now() ORDER BY send_at ASC LIMIT 50`);
    for (const s of due.rows) {
      try { await deliverScheduled(s); } catch (e) { console.error('scheduled delivery failed', e); }
      await db.query('DELETE FROM scheduled_messages WHERE id = $1', [s.id]).catch(() => {});
    }
  } catch (e) { /* DB may be down; try again next tick */ }
  finally { _scheduleFlushing = false; }
}
setInterval(flushScheduledMessages, Math.max(1000, parseInt(process.env.SCHEDULE_FLUSH_MS, 10) || 20000)).unref?.();

/* ─── Chat labels / folders ─── */
const LABEL_COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'teal', 'pink', 'gray'];
const LABEL_CAP = 20;
async function ownsLabel(id, uid) {
  const r = await db.query('SELECT 1 FROM chat_labels WHERE id = $1 AND user_id = $2', [id, uid]);
  return !!r.rows[0];
}
// List my labels, each with the chats it contains (kind+targetId pairs) + a count.
app.get('/api/atchat/labels', auth.requireAuth, async (req, res) => {
  try {
    const labels = await db.query('SELECT id, name, color FROM chat_labels WHERE user_id = $1 ORDER BY created_at ASC', [req.user.id]);
    const items = await db.query(
      `SELECT i.label_id, i.kind, i.target_id FROM chat_label_items i
       JOIN chat_labels l ON l.id = i.label_id WHERE l.user_id = $1`,
      [req.user.id]
    );
    const byLabel = {};
    items.rows.forEach((r) => { (byLabel[r.label_id] = byLabel[r.label_id] || []).push({ kind: r.kind, targetId: r.target_id }); });
    res.json({ labels: labels.rows.map((l) => ({ id: l.id, name: l.name, color: l.color, items: byLabel[l.id] || [], count: (byLabel[l.id] || []).length })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load labels.' }); }
});
app.post('/api/atchat/labels', auth.requireAuth, rateLimit(30, 60000, 'label-add'), async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Name your label.' });
  const color = LABEL_COLORS.includes(req.body.color) ? req.body.color : 'blue';
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM chat_labels WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= LABEL_CAP) return res.status(400).json({ error: `You can create up to ${LABEL_CAP} labels.` });
    const ins = await db.query('INSERT INTO chat_labels (user_id, name, color) VALUES ($1,$2,$3) RETURNING id, name, color', [req.user.id, name, color]);
    res.json({ label: { id: ins.rows[0].id, name: ins.rows[0].name, color: ins.rows[0].color, items: [], count: 0 } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the label.' }); }
});
app.patch('/api/atchat/labels/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await ownsLabel(id, req.user.id))) return res.status(404).json({ error: 'Not found.' });
    const sets = [], vals = []; let i = 1;
    if (req.body.name !== undefined) { const n = (req.body.name || '').trim().slice(0, 40); if (!n) return res.status(400).json({ error: 'Name your label.' }); sets.push(`name = $${i++}`); vals.push(n); }
    if (req.body.color !== undefined && LABEL_COLORS.includes(req.body.color)) { sets.push(`color = $${i++}`); vals.push(req.body.color); }
    if (sets.length) { vals.push(id); await db.query(`UPDATE chat_labels SET ${sets.join(', ')} WHERE id = $${i}`, vals); }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
app.delete('/api/atchat/labels/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM chat_labels WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});
// Tag / untag a chat with a label.
app.post('/api/atchat/labels/:id/assign', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const kind = req.body.kind === 'group' ? 'group' : 'dm';
  const targetId = parseInt(req.body.targetId, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid chat.' });
  try {
    if (!(await ownsLabel(id, req.user.id))) return res.status(404).json({ error: 'Not found.' });
    if (req.body.on === false) {
      await db.query('DELETE FROM chat_label_items WHERE label_id = $1 AND kind = $2 AND target_id = $3', [id, kind, targetId]);
    } else {
      await db.query('INSERT INTO chat_label_items (label_id, kind, target_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, kind, targetId]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});

/* ─── Broadcast lists ─── */
// Deliver a plain text/image DM from sender→recipient (used by broadcast fan-out
// and scheduled delivery). Returns the new message id, or null if not delivered.
async function deliverDM(senderId, recipientId, body, images) {
  if (senderId === recipientId) return null;
  if (!(await dmAllowed(senderId, recipientId))) return null;
  const imgs = Array.isArray(images) ? images.filter(Boolean).slice(0, MAX_IMAGES) : [];
  const image = imgs.length ? imgs[0] : null;
  const dsec = await dmDisappearSeconds(senderId, recipientId);
  const ins = await db.query(
    `INSERT INTO at_messages (sender_id, recipient_id, body, image, images, expires_at)
     VALUES ($1,$2,$3,$4,$5,${dsec ? `now() + interval '${dsec} seconds'` : 'NULL'})
     RETURNING id, body, image, images, created_at`,
    [senderId, recipientId, body, image, imgs.length > 1 ? imgs : null]
  );
  const r = ins.rows[0];
  const msg = { id: r.id, body: r.body, image: r.image || null, images: (Array.isArray(r.images) && r.images.length) ? r.images : (r.image ? [r.image] : []), media: null, media_kind: null, media_name: null, created_at: r.created_at, reply_to: null, forwarded: false, meta: null };
  rtPush(recipientId, 'msg', { kind: 'dm', peerId: senderId, message: { ...msg, mine: false } });
  rtPush(senderId, 'msg', { kind: 'dm', peerId: recipientId, message: { ...msg, mine: true } });
  notify(recipientId, senderId, 'message', null);
  return r.id;
}
const BROADCAST_MAX_MEMBERS = 256;
async function ownsBroadcast(id, uid) {
  const r = await db.query('SELECT 1 FROM broadcast_lists WHERE id = $1 AND owner_id = $2', [id, uid]);
  return !!r.rows[0];
}
// Validate + dedupe a member id array against real users (excluding the owner).
async function resolveBroadcastMembers(ids, ownerId) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n !== ownerId))].slice(0, BROADCAST_MAX_MEMBERS);
  if (!wanted.length) return [];
  const r = await db.query('SELECT id FROM users WHERE id = ANY($1) AND username IS NOT NULL', [wanted]);
  return r.rows.map((x) => x.id);
}
app.get('/api/atchat/broadcasts', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.name, (SELECT COUNT(*)::int FROM broadcast_list_members m WHERE m.list_id = b.id) AS count
       FROM broadcast_lists b WHERE b.owner_id = $1 ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json({ lists: rows.map((b) => ({ id: b.id, name: b.name, count: b.count })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load broadcast lists.' }); }
});
app.post('/api/atchat/broadcasts', auth.requireAuth, rateLimit(20, 60000, 'bcast-create'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const name = (req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name your broadcast list.' });
  try {
    const ins = await db.query('INSERT INTO broadcast_lists (owner_id, name) VALUES ($1,$2) RETURNING id', [req.user.id, name]);
    const id = ins.rows[0].id;
    const members = await resolveBroadcastMembers(req.body.members, req.user.id);
    for (const mid of members) await db.query('INSERT INTO broadcast_list_members (list_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, mid]);
    res.json({ id, name, count: members.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the list.' }); }
});
app.get('/api/atchat/broadcasts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const b = await db.query('SELECT id, name FROM broadcast_lists WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (!b.rows[0]) return res.status(404).json({ error: 'Not found.' });
    const members = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified FROM broadcast_list_members m
       JOIN users u ON u.id = m.member_id WHERE m.list_id = $1 ORDER BY lower(u.name)`,
      [id]
    );
    res.json({ id: b.rows[0].id, name: b.rows[0].name, members: members.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the list.' }); }
});
app.patch('/api/atchat/broadcasts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await ownsBroadcast(id, req.user.id))) return res.status(404).json({ error: 'Not found.' });
    if (req.body.name !== undefined) { const n = (req.body.name || '').trim().slice(0, 60); if (!n) return res.status(400).json({ error: 'Name your broadcast list.' }); await db.query('UPDATE broadcast_lists SET name = $1 WHERE id = $2', [n, id]); }
    if (req.body.members !== undefined) {
      const members = await resolveBroadcastMembers(req.body.members, req.user.id);
      await db.query('DELETE FROM broadcast_list_members WHERE list_id = $1', [id]);
      for (const mid of members) await db.query('INSERT INTO broadcast_list_members (list_id, member_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, mid]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update the list.' }); }
});
app.delete('/api/atchat/broadcasts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM broadcast_lists WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete the list.' }); }
});
// Send a message to every list member as an individual DM.
app.post('/api/atchat/broadcasts/:id/send', auth.requireAuth, rateLimit(15, 60000, 'bcast-send'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const body = (req.body.body || '').trim();
  const imgs = cleanImages(req.body.images);
  if (imgs === undefined) return res.status(400).json({ error: 'Those images could not be attached.' });
  if (!body && !imgs.length) return res.status(400).json({ error: 'Type a message to broadcast.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    if (!(await ownsBroadcast(id, req.user.id))) return res.status(404).json({ error: 'Not found.' });
    const members = await db.query('SELECT member_id FROM broadcast_list_members WHERE list_id = $1', [id]);
    let sent = 0;
    for (const m of members.rows) {
      try { if (await deliverDM(req.user.id, m.member_id, body, imgs)) sent++; } catch (e) { /* skip a failed recipient */ }
    }
    res.json({ ok: true, sent, total: members.rows.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send the broadcast.' }); }
});

/* ─── Chat requests — request / approve a conversation ─── */
// Ask to chat with someone whose privacy doesn't already allow you.
app.post('/api/atchat/request/:id', auth.requireAuth, rateLimit(20, 60000, 'chat-request'), async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  if (other === req.user.id) return res.status(400).json({ error: 'You cannot request yourself.' });
  const body = (req.body.body || '').trim().slice(0, 500) || null;
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const peer = await chatIdentity(other);
    if (!peer || !peer.username) return res.status(404).json({ error: 'User not found.' });
    // Block check fails closed; if they already allow me, no request is needed.
    const blocked = await db.query('SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [other, req.user.id]);
    if (blocked.rowCount) return res.status(403).json({ error: 'You can’t message this person.' });
    if (await dmAllowed(req.user.id, other)) return res.json({ ok: true, allowed: true });
    // Connections-only: a chat request won't help — guide them to connect instead.
    const gate = await db.query('SELECT dm_connections_only FROM users WHERE id = $1', [other]);
    if (gate.rows[0] && gate.rows[0].dm_connections_only) {
      return res.status(403).json({ error: 'This person only accepts messages from their connections. Send a connection request first.', connectGated: true });
    }
    await db.query(
      `INSERT INTO chat_requests (requester_id, recipient_id, body, status, updated_at)
       VALUES ($1, $2, $3, 'pending', now())
       ON CONFLICT (requester_id, recipient_id)
       DO UPDATE SET body = EXCLUDED.body, status = 'pending', updated_at = now()`,
      [req.user.id, other, body]
    );
    notify(other, req.user.id, 'chat_request', null);
    // Email the recipient that someone wants to chat, with who + their message.
    db.query('SELECT email, name FROM users WHERE id = $1', [other]).then((r) => {
      if (r.rows[0] && r.rows[0].email) sendChatRequestEmail(r.rows[0], me, body).catch(() => {});
    }).catch(() => {});
    res.json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Incoming pending requests for me (a "Message requests" inbox).
app.get('/api/atchat/requests', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.body, r.created_at, u.id AS uid, u.name, u.username, u.avatar, u.verified
       FROM chat_requests r JOIN users u ON u.id = r.requester_id
       WHERE r.recipient_id = $1 AND r.status = 'pending'
       ORDER BY r.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ requests: rows.map((r) => ({
      id: r.id, body: r.body || null, created_at: r.created_at,
      user: { id: r.uid, name: r.name, username: r.username, avatar: r.avatar || null, verified: r.verified },
    })) });
  } catch (err) { console.error(err); res.json({ requests: [] }); }
});

// Allow a chat request → grant the requester contact access + notify them.
app.post('/api/atchat/requests/:rid/accept', auth.requireAuth, async (req, res) => {
  const rid = parseInt(req.params.rid, 10);
  if (!Number.isInteger(rid)) return res.status(400).json({ error: 'Invalid request id.' });
  try {
    const { rows } = await db.query(
      "UPDATE chat_requests SET status = 'accepted', updated_at = now() WHERE id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING requester_id, body",
      [rid, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Request not found.' });
    const requester = rows[0].requester_id;
    await db.query('INSERT INTO contact_allow (owner_id, allowed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, requester]);
    // Surface the requester's intro message as the first DM, if they wrote one.
    if (rows[0].body) {
      const ins = await db.query(
        'INSERT INTO at_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at',
        [requester, req.user.id, rows[0].body]
      );
      const m = ins.rows[0];
      rtPush(req.user.id, 'msg', { kind: 'dm', peerId: requester, message: { id: m.id, body: m.body, image: null, media: null, media_kind: null, media_name: null, created_at: m.created_at, mine: false } });
    }
    notify(requester, req.user.id, 'chat_allowed', null);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Decline a chat request (silent — the requester isn't notified).
app.post('/api/atchat/requests/:rid/decline', auth.requireAuth, async (req, res) => {
  const rid = parseInt(req.params.rid, 10);
  if (!Number.isInteger(rid)) return res.status(400).json({ error: 'Invalid request id.' });
  try {
    await db.query("UPDATE chat_requests SET status = 'declined', updated_at = now() WHERE id = $1 AND recipient_id = $2", [rid, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Delete (clear) a DM conversation for me — hides messages up to now; the chat
// reappears only if a new message arrives. The other person keeps their copy.
app.delete('/api/atchat/with/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query(
      `INSERT INTO at_cleared (user_id, other_id, cleared_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id, other_id) DO UPDATE SET cleared_at = now()`,
      [req.user.id, other]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete a single DM (WhatsApp-style). `scope=me` hides it just for the caller;
// `scope=everyone` (sender only) removes the row so both sides lose it.
app.delete('/api/atchat/message/:id', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.json({ ok: true }); // already gone — treat as success
    if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    if (scope === 'everyone') {
      // Only the sender can delete a message for everyone (WhatsApp-style).
      if (req.user.id !== m.sender_id) {
        return res.status(403).json({ error: 'You can only delete your own messages for everyone.' });
      }
      // Tombstone: keep the row but wipe its content so both sides see
      // "This message was deleted."
      await db.query(
        `UPDATE at_messages SET deleted_all = true, body = '', image = NULL, media = NULL, media_kind = NULL, media_name = NULL
         WHERE id = $1`,
        [mid]
      );
      const other = req.user.id === m.sender_id ? m.recipient_id : m.sender_id;
      rtPush(other, 'dm_deleted', { peerId: req.user.id, id: mid }); // live-tombstone on their side
    } else {
      await db.query(
        'UPDATE at_messages SET deleted_for = array_append(deleted_for, $1) WHERE id = $2 AND NOT ($1 = ANY(deleted_for))',
        [req.user.id, mid]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Hide / unhide a single DM in my own view (privacy mask for sensitive content).
// Per-user: only affects the caller; the message stays for the other side.
app.post('/api/atchat/message/:id/hide', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const hide = req.body.hidden !== false; // default true
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.json({ ok: true });
    if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    if (hide) {
      await db.query('UPDATE at_messages SET hidden_for = array_append(hidden_for, $1) WHERE id = $2 AND NOT ($1 = ANY(hidden_for))', [req.user.id, mid]);
    } else {
      await db.query('UPDATE at_messages SET hidden_for = array_remove(hidden_for, $1) WHERE id = $2', [req.user.id, mid]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// React to a DM with an emoji (one per person). Sending the same emoji again, or
// an empty emoji, clears your reaction. Returns the updated reactions map.
app.post('/api/atchat/message/:id/react', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const emoji = (req.body.emoji || '').toString().slice(0, 12);
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id, reactions FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.json({ ok: true, reactions: {} });
    if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    const reactions = m.reactions || {};
    const key = String(req.user.id);
    if (!emoji || reactions[key] === emoji) delete reactions[key]; // toggle off
    else reactions[key] = emoji;
    await db.query('UPDATE at_messages SET reactions = $1 WHERE id = $2', [JSON.stringify(reactions), mid]);
    const other = req.user.id === m.sender_id ? m.recipient_id : m.sender_id;
    rtPush(other, 'dm_reaction', { peerId: req.user.id, id: mid, reactions });
    res.json({ ok: true, reactions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Star / unstar a DM for my own reference (a personal bookmark). Per-user.
app.post('/api/atchat/message/:id/star', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const star = req.body.starred !== false; // default true
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.json({ ok: true });
    if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) {
      return res.status(403).json({ error: 'Not allowed.' });
    }
    if (star) {
      await db.query('UPDATE at_messages SET starred_by = array_append(starred_by, $1) WHERE id = $2 AND NOT ($1 = ANY(starred_by))', [req.user.id, mid]);
    } else {
      await db.query('UPDATE at_messages SET starred_by = array_remove(starred_by, $1) WHERE id = $2', [req.user.id, mid]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Star / unstar a GROUP message (personal bookmark, like the DM star). Any member
// of the group may star any message; the flag is per-user (array of user ids).
app.post('/api/atchat/groups/:id/messages/:mid/star', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), mid = parseInt(req.params.mid, 10);
  if (!Number.isInteger(gid) || !Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid id.' });
  const star = req.body.starred !== false; // default true
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const { rows } = await db.query('SELECT id FROM at_group_messages WHERE id = $1 AND group_id = $2', [mid, gid]);
    if (!rows[0]) return res.json({ ok: true });
    if (star) {
      await db.query('UPDATE at_group_messages SET starred_by = array_append(starred_by, $1) WHERE id = $2 AND NOT ($1 = ANY(starred_by))', [req.user.id, mid]);
    } else {
      await db.query('UPDATE at_group_messages SET starred_by = array_remove(starred_by, $1) WHERE id = $2', [req.user.id, mid]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Aggregate "Starred messages" view — every message the caller has starred,
// across all DMs and groups, newest first, with enough context to jump to it.
// Excludes deleted / expired (disappeared) messages.
app.get('/api/atchat/starred', auth.requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const dm = await db.query(
      `SELECT m.id, m.body, m.image, m.media_kind, m.meta, m.created_at, m.sender_id,
              CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS peer_id,
              p.name AS peer_name, p.username AS peer_username, p.avatar AS peer_avatar
         FROM at_messages m
         JOIN users p ON p.id = (CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END)
        WHERE $1 = ANY(m.starred_by) AND NOT m.deleted_all
          AND (m.expires_at IS NULL OR m.expires_at > now())`,
      [uid]
    );
    const gm = await db.query(
      `SELECT m.id, m.body, m.image, m.media_kind, m.meta, m.created_at, m.sender_id,
              m.group_id, g.name AS group_name, g.username AS group_username, g.avatar AS group_avatar,
              u.name AS sender_name
         FROM at_group_messages m
         JOIN at_groups g ON g.id = m.group_id
         JOIN users u ON u.id = m.sender_id
        WHERE $1 = ANY(m.starred_by)
          AND (m.expires_at IS NULL OR m.expires_at > now())`,
      [uid]
    );
    const items = [
      ...dm.rows.map((m) => ({
        id: m.id, scope: 'dm', body: m.body || '', image: !!m.image, mediaKind: m.media_kind || null,
        meta: m.meta || null, created_at: m.created_at, mine: m.sender_id === uid,
        peer: { id: m.peer_id, name: m.peer_name, username: m.peer_username, avatar: m.peer_avatar || null },
      })),
      ...gm.rows.map((m) => ({
        id: m.id, scope: 'group', body: m.body || '', image: !!m.image, mediaKind: m.media_kind || null,
        meta: m.meta || null, created_at: m.created_at, mine: m.sender_id === uid, senderName: m.sender_name,
        group: { id: m.group_id, name: m.group_name, username: m.group_username || null, avatar: m.group_avatar || null },
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Pin / unpin a message for the whole conversation (WhatsApp-style). Either DM
// participant, or any group member, may pin. Shown in a pin banner.
function pinCard(row, senderName) {
  const kind = row.media_kind || (row.image ? 'image' : null);
  return { id: row.id, body: row.body || '', mediaKind: kind, sender: senderName || null, pinnedAt: row.pinned_at, mine: undefined };
}
app.post('/api/atchat/message/:id/pin', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const pin = req.body.pin !== false;
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Message not found.' });
    if (req.user.id !== m.sender_id && req.user.id !== m.recipient_id) return res.status(403).json({ error: 'Not allowed.' });
    await db.query('UPDATE at_messages SET pinned_at = $1 WHERE id = $2', [pin ? new Date() : null, mid]);
    const other = req.user.id === m.sender_id ? m.recipient_id : m.sender_id;
    rtPush(other, 'pin', { scope: 'dm', peerId: req.user.id, id: mid, pinned: pin });
    res.json({ ok: true, pinned: pin });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.get('/api/atchat/with/:id/pins', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const { rows } = await db.query(
      `SELECT m.id, m.body, m.media_kind, m.image, m.pinned_at, (m.sender_id = $1) AS mine, u.name AS sender_name
       FROM at_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.pinned_at IS NOT NULL AND m.deleted_all = false
         AND ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
       ORDER BY m.pinned_at DESC LIMIT 10`,
      [req.user.id, other]
    );
    res.json({ pins: rows.map((m) => ({ id: m.id, body: m.body || '', mediaKind: m.media_kind || (m.image ? 'image' : null), mine: !!m.mine, sender: m.sender_name, pinnedAt: m.pinned_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// Group pin / unpin + list.
app.post('/api/atchat/groups/:id/messages/:mid/pin', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), mid = routeId(req.params.mid);
  if (!Number.isInteger(gid) || !Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid request.' });
  const pin = req.body.pin !== false;
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(403).json({ error: 'You’re not a member of this group.' });
    const m = await db.query('SELECT id FROM at_group_messages WHERE id = $1 AND group_id = $2', [mid, gid]);
    if (!m.rows[0]) return res.status(404).json({ error: 'Message not found.' });
    await db.query('UPDATE at_group_messages SET pinned_at = $1 WHERE id = $2', [pin ? new Date() : null, mid]);
    for (const id of await groupMemberIds(gid, req.user.id)) rtPush(id, 'pin', { scope: 'group', groupId: gid, id: mid, pinned: pin });
    res.json({ ok: true, pinned: pin });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.get('/api/atchat/groups/:id/pins', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const { rows } = await db.query(
      `SELECT m.id, m.body, m.media_kind, m.image, m.pinned_at, (m.sender_id = $2) AS mine, u.name AS sender_name
       FROM at_group_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 AND m.pinned_at IS NOT NULL ORDER BY m.pinned_at DESC LIMIT 10`,
      [gid, req.user.id]
    );
    res.json({ pins: rows.map((m) => ({ id: m.id, body: m.body || '', mediaKind: m.media_kind || (m.image ? 'image' : null), mine: !!m.mine, sender: m.sender_name, pinnedAt: m.pinned_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Disappearing messages — per-conversation auto-delete timer.
const DISAPPEAR_OPTS = [0, 86400, 604800, 7776000]; // off / 24h / 7d / 90d
async function dmDisappearSeconds(a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const r = await db.query('SELECT seconds FROM dm_disappearing WHERE a = $1 AND b = $2', [lo, hi]);
  return (r.rows[0] && r.rows[0].seconds) || 0;
}
app.get('/api/atchat/with/:id/disappearing', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid id.' });
  try { res.json({ seconds: await dmDisappearSeconds(req.user.id, other) }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});
app.put('/api/atchat/with/:id/disappearing', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id), sec = parseInt(req.body.seconds, 10);
  if (!Number.isInteger(other) || !DISAPPEAR_OPTS.includes(sec)) return res.status(400).json({ error: 'Invalid request.' });
  const lo = Math.min(req.user.id, other), hi = Math.max(req.user.id, other);
  try {
    await db.query('INSERT INTO dm_disappearing (a, b, seconds) VALUES ($1,$2,$3) ON CONFLICT (a,b) DO UPDATE SET seconds = $3', [lo, hi, sec]);
    rtPush(other, 'disappearing', { scope: 'dm', peerId: req.user.id, seconds: sec });
    res.json({ ok: true, seconds: sec });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
app.get('/api/atchat/groups/:id/disappearing', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const r = await db.query('SELECT disappearing FROM at_groups WHERE id = $1', [gid]);
    res.json({ seconds: (r.rows[0] && r.rows[0].disappearing) || 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});
app.put('/api/atchat/groups/:id/disappearing', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), sec = parseInt(req.body.seconds, 10);
  if (!Number.isInteger(gid) || !DISAPPEAR_OPTS.includes(sec)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    await db.query('UPDATE at_groups SET disappearing = $1 WHERE id = $2', [sec, gid]);
    for (const id of await groupMemberIds(gid, req.user.id)) rtPush(id, 'disappearing', { scope: 'group', groupId: gid, seconds: sec });
    res.json({ ok: true, seconds: sec });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});

// Edit your own DM's text (sender only). Marks the message as edited.
app.post('/api/atchat/message/:id/edit', auth.requireAuth, async (req, res) => {
  const mid = parseInt(req.params.id, 10);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid message id.' });
  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const { rows } = await db.query('SELECT sender_id, recipient_id, body FROM at_messages WHERE id = $1', [mid]);
    const m = rows[0];
    if (!m) return res.status(404).json({ error: 'Message not found.' });
    if (req.user.id !== m.sender_id) return res.status(403).json({ error: 'You can only edit your own messages.' });
    if (!m.body) return res.status(400).json({ error: 'This message has no text to edit.' });
    await db.query('UPDATE at_messages SET body = $1, edited = true WHERE id = $2', [body, mid]);
    rtPush(m.recipient_id, 'dm_edited', { peerId: req.user.id, id: mid, body });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ── AtChat group chats (multi-person threads) ── */
async function isGroupMember(groupId, userId) {
  const { rows } = await db.query('SELECT 1 FROM at_group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
  return rows.length > 0;
}

// A group's @username follows the same rules as a user's handle.
const GROUP_USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
function cleanGroupUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the group.' };
  if (username.length > 40) return { error: 'Group username is too long.' };
  if (!GROUP_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}

// Create a group. A normal group/channel needs a @username (the creator becomes
// its admin); a "contact group" (req.body.contact) is username-less and casual.
// Display name and avatar are optional (name required for contact groups).
app.post('/api/atchat/groups', auth.requireAuth, rateLimit(20, 60000, 'group-create'), async (req, res) => {
  // A "contact group" is a casual, username-less group — just a name + a few people
  // (WhatsApp-style). It has no public @handle, isn't discoverable, and can't be a
  // broadcast channel. Everything else (membership, messaging, avatar) is identical.
  const contact = req.body.contact === true;
  let username = null;
  if (!contact) {
    const u = cleanGroupUsername(req.body.username);
    if (u.error) return res.status(400).json({ error: u.error });
    username = u.username;
  }
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Group name is too long.' });
  if (!name) {
    if (contact) return res.status(400).json({ error: 'Name your group.' }); // no handle to fall back to
    name = username; // fall back to the handle as the display name
  }
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  const broadcast = !contact && req.body.broadcast === true;
  const members = Array.isArray(req.body.members) ? req.body.members : [];
  const ids = [...new Set(members.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n !== req.user.id))];
  // A broadcast channel can be created solo (followers join via its link).
  if (!ids.length && !broadcast) return res.status(400).json({ error: 'Add at least one other person.' });
  if (ids.length > 49) return res.status(400).json({ error: 'Groups are limited to 50 people.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    // Keep only real users who have a username.
    const valid = ids.length ? await db.query('SELECT id FROM users WHERE id = ANY($1) AND username IS NOT NULL', [ids]) : { rows: [] };
    if (!valid.rows.length && !broadcast) return res.status(400).json({ error: 'None of those users could be added.' });
    let g;
    try {
      g = await db.query(
        'INSERT INTO at_groups (name, username, avatar, created_by, broadcast) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, username, avatar, req.user.id, broadcast]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That group username is already taken.' });
      throw e;
    }
    const gid = g.rows[0].id;
    const all = [req.user.id, ...valid.rows.map((r) => r.id)];
    const valuesSql = all.map((_, i) => `($1, $${i + 2})`).join(', ');
    await db.query(`INSERT INTO at_group_members (group_id, user_id) VALUES ${valuesSql} ON CONFLICT DO NOTHING`, [gid, ...all]);
    res.json({ group: { id: gid, name, username, avatar: avatar || null, members: all.length, broadcast } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a group's identity (admin only): display name, @username, avatar.
app.patch('/api/atchat/groups/:id', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  // A contact group stays username-less on edit (name + avatar only).
  const contact = req.body.contact === true;
  let username = null;
  if (!contact) {
    const u = cleanGroupUsername(req.body.username);
    if (u.error) return res.status(400).json({ error: u.error });
    username = u.username;
  }
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Group name is too long.' });
  if (!name) {
    if (contact) return res.status(400).json({ error: 'Name your group.' });
    name = username;
  }
  // avatar: absent = leave unchanged; '' / null = remove; data URL = set.
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (g.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the group admin can edit this group.' });
    const fields = ['name = $1', 'username = $2'];
    const vals = [name, username];
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    if (typeof req.body.broadcast === 'boolean') { vals.push(req.body.broadcast); fields.push(`broadcast = $${vals.length}`); }
    vals.push(gid);
    let upd;
    try {
      upd = await db.query(
        `UPDATE at_groups SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, name, username, avatar, created_by, broadcast`,
        vals
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That group username is already taken.' });
      throw e;
    }
    const r = upd.rows[0];
    res.json({ group: { id: r.id, name: r.name, username: r.username, avatar: r.avatar || null, createdBy: r.created_by, broadcast: r.broadcast } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// List the groups I'm in (latest message + unread each).
app.get('/api/atchat/groups', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT g.id, g.name, g.username, g.avatar, g.broadcast,
              (me.muted AND (me.muted_until IS NULL OR me.muted_until > now())) AS muted,
              EXTRACT(EPOCH FROM me.muted_until) * 1000 AS muted_until,
              (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members,
              lm.body AS last_body, (lm.image IS NOT NULL) AS last_image, lm.media_kind AS last_media_kind, lm.created_at AS last_at,
              lm.meta->>'t' AS last_meta,
              lm.sender_name AS last_sender, (lm.sender_id = $1) AS last_mine,
              (SELECT COUNT(*)::int FROM at_group_messages x
                 WHERE x.group_id = g.id AND x.created_at > me.last_read_at AND x.sender_id <> $1) AS unread
       FROM at_group_members me
       JOIN at_groups g ON g.id = me.group_id
       LEFT JOIN LATERAL (
         SELECT m.body, m.image, m.media_kind, m.meta, m.created_at, m.sender_id, u.name AS sender_name
         FROM at_group_messages m JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = g.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE me.user_id = $1
       ORDER BY COALESCE(lm.created_at, g.created_at) DESC`,
      [req.user.id]
    );
    res.json({ groups: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read a group thread (members + messages); marks it read for me.
// Public-ish preview for a shareable group@username link: basic info + the
// viewer's status (member / admin / already requested). Visible to non-members
// so they can request to join.
app.get('/api/atchat/groups/by-username/:username', auth.requireAuth, async (req, res) => {
  const u = (req.params.username || '').replace(/^@/, '').toLowerCase();
  if (!u) return res.status(400).json({ error: 'Invalid group.' });
  try {
    const g = await db.query(
      `SELECT g.id, g.name, g.username, g.avatar, g.created_by, g.broadcast,
              (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members,
              EXISTS(SELECT 1 FROM at_group_members m WHERE m.group_id = g.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM group_requests r WHERE r.group_id = g.id AND r.user_id = $1) AS requested
       FROM at_groups g WHERE lower(g.username) = $2`,
      [req.user.id, u]
    );
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    const t = g.rows[0];
    res.json({
      group: {
        id: t.id, name: t.name, username: t.username || null, avatar: t.avatar || null, broadcast: t.broadcast,
        members: t.members, isMember: t.is_member, isAdmin: t.created_by === req.user.id, requested: t.requested,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Request to join a group (non-members). Pings the group admin.
app.post('/api/atchat/groups/:id/request', auth.requireAuth, rateLimit(30, 60000, 'group-request'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (await isGroupMember(gid, req.user.id)) return res.json({ ok: true, isMember: true, requested: false });
    await db.query('INSERT INTO group_requests (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, req.user.id]);
    notify(g.rows[0].created_by, req.user.id, 'group_request', null, null, gid);
    res.json({ ok: true, isMember: false, requested: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Cancel my own pending request.
app.delete('/api/atchat/groups/:id/request', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    await db.query('DELETE FROM group_requests WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    res.json({ ok: true, requested: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Admin: approve / decline a pending join request.
app.post('/api/atchat/groups/:id/requests/:uid', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), uid = routeId(req.params.uid);
  if (!Number.isInteger(gid) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (g.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the group admin can do that.' });
    const approve = req.body.approve !== false;
    const had = await db.query('DELETE FROM group_requests WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [gid, uid]);
    if (approve && had.rows.length) {
      await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, uid]);
      notify(uid, req.user.id, 'group_approved', null, null, gid);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/atchat/groups/:id', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const g = await db.query(
      `SELECT g.id, g.name, g.username, g.avatar, g.created_by, g.broadcast, g.disappearing,
              (SELECT (m.muted AND (m.muted_until IS NULL OR m.muted_until > now())) FROM at_group_members m WHERE m.group_id = g.id AND m.user_id = $2) AS muted
       FROM at_groups g WHERE g.id = $1`,
      [gid, req.user.id]
    );
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    const members = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified FROM at_group_members m
       JOIN users u ON u.id = m.user_id WHERE m.group_id = $1 ORDER BY m.joined_at`,
      [gid]
    );
    const msgs = await db.query(
      `SELECT m.id, m.body, m.image, m.images, m.media, m.media_kind, m.media_name, m.created_at, m.sender_id, m.forwarded, m.meta, m.client_id,
              ($2 = ANY(m.starred_by)) AS starred,
              u.name AS sender_name, u.username AS sender_username, u.avatar AS sender_avatar, u.verified AS sender_verified
       FROM at_group_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 AND (m.expires_at IS NULL OR m.expires_at > now()) ORDER BY m.created_at ASC`,
      [gid, req.user.id]
    );
    // Capture how far I'd read BEFORE bumping it, so the client can draw the
    // "New messages" divider at the first message newer than that.
    const lrRow = await db.query('SELECT last_read_at FROM at_group_members WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    const lastRead = lrRow.rows[0]?.last_read_at || null;
    db.query('UPDATE at_group_members SET last_read_at = now() WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]).catch(() => {});
    const ls = groupLiveStream(gid);
    // Pending join requests — only the group admin sees these.
    let requests = [];
    if (g.rows[0].created_by === req.user.id) {
      const rq = await db.query(
        `SELECT u.id, u.name, u.username, u.avatar FROM group_requests r
         JOIN users u ON u.id = r.user_id WHERE r.group_id = $1 ORDER BY r.requested_at ASC LIMIT 100`,
        [gid]
      );
      requests = rq.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null }));
    }
    res.json({
      group: { id: g.rows[0].id, name: g.rows[0].name, username: g.rows[0].username || null, avatar: g.rows[0].avatar || null, createdBy: g.rows[0].created_by, broadcast: g.rows[0].broadcast, muted: !!g.rows[0].muted, disappearing: g.rows[0].disappearing || 0 },
      requests,
      lastRead,
      live: ls ? liveStreamPublic(ls) : null,
      members: members.rows.map((m) => ({ id: m.id, name: m.name, username: m.username, avatar: m.avatar || null, verified: !!m.verified })),
      messages: msgs.rows.map((m) => ({
        id: m.id, body: m.body, image: m.image || null,
        media: m.media || null, media_kind: m.media_kind || null, media_name: m.media_name || null,
        created_at: m.created_at, mine: m.sender_id === req.user.id, forwarded: !!m.forwarded, meta: m.meta || null, clientId: m.client_id || null,
        starred: !!m.starred, images: (Array.isArray(m.images) && m.images.length) ? m.images : (m.image ? [m.image] : []),
        sender: { id: m.sender_id, name: m.sender_name, username: m.sender_username, avatar: m.sender_avatar || null, verified: !!m.sender_verified },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Send a message to a group.
app.post('/api/atchat/groups/:id/messages', auth.requireAuth, rateLimit(60, 60000, 'group-send'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const body = (req.body.body || '').trim();
  const imgs = cleanImages(req.body.images);
  if (imgs === undefined) return res.status(400).json({ error: 'Those images could not be attached.' });
  const gifUrl = cleanGifUrl(req.body.gifUrl);
  let image = gifUrl || (imgs.length ? imgs[0] : cleanImage(req.body.image));
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That file could not be attached (unsupported type or too large — 16 MB max).' });
  const meta = cleanMeta(req.body.meta);
  if (meta === undefined) return res.status(400).json({ error: 'That couldn’t be attached.' });
  if (!body && !image && !media.data && !meta) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    // Broadcast ("channel") groups are admin-post-only.
    const gb = await db.query('SELECT created_by, broadcast FROM at_groups WHERE id = $1', [gid]);
    if (gb.rows[0] && gb.rows[0].broadcast && gb.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the admin can post in this channel.' });
    }
    const me = await chatIdentity(req.user.id);
    const clientId = (typeof req.body.clientId === 'string' && req.body.clientId.length <= 64) ? req.body.clientId : null;
    // Idempotent insert (see the DM route) — a resend dedupes on (sender_id, client_id).
    const GCOLS = 'id, body, image, images, media, media_kind, media_name, created_at, forwarded, meta';
    const gdis = await db.query('SELECT disappearing FROM at_groups WHERE id = $1', [gid]);
    const gsec = (gdis.rows[0] && gdis.rows[0].disappearing) || 0;
    const ins = await db.query(
      `INSERT INTO at_group_messages (group_id, sender_id, body, image, images, media, media_kind, media_name, forwarded, meta, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${gsec ? `now() + interval '${gsec} seconds'` : 'NULL'})
       ON CONFLICT (group_id, sender_id, client_id) DO NOTHING RETURNING ${GCOLS}`,
      [gid, req.user.id, body, image, imgs.length > 1 ? imgs : null, media.data, media.kind, media.name, !!req.body.forwarded, meta ? JSON.stringify(meta) : null, clientId]
    );
    let r = ins.rows[0];
    const isNew = !!r;
    if (!r) {
      const ex = await db.query(`SELECT ${GCOLS} FROM at_group_messages WHERE group_id = $1 AND sender_id = $2 AND client_id = $3`, [gid, req.user.id, clientId]);
      r = ex.rows[0];
      if (!r) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    const base = {
      id: r.id, body: r.body, image: r.image || null,
      images: (Array.isArray(r.images) && r.images.length) ? r.images : (r.image ? [r.image] : []),
      media: r.media || null, media_kind: r.media_kind || null, media_name: r.media_name || null,
      created_at: r.created_at, forwarded: !!r.forwarded, meta: r.meta || null,
      sender: { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null },
    };
    // Live-deliver to the other group members (only the first time — not on a resend).
    if (isNew) {
      const out = { kind: 'group', groupId: gid, message: { ...base, mine: false } };
      for (const id of await groupMemberIds(gid, req.user.id)) rtPush(id, 'msg', out);
    }
    res.json({ message: { ...base, mine: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Interactive rich messages — poll votes & event RSVPs (DM + group) ─── */
// Load a poll/event message of the given type and authorize the actor. Returns
// { table, row } or null. `gid` (optional) routes to the group-message table.
async function loadMetaMsg(mid, gid, uid, type) {
  const table = gid ? 'at_group_messages' : 'at_messages';
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [mid]);
  const row = rows[0];
  if (!row || !row.meta || row.meta.t !== type) return null;
  if (gid) {
    if (row.group_id !== gid || !(await isGroupMember(gid, uid))) return null;
  } else if (row.sender_id !== uid && row.recipient_id !== uid) {
    return null;
  }
  return { table, row };
}
// Fan a meta update out to the other participant(s) so their card updates live.
async function pushMetaUpd(row, gid, uid, mid, meta) {
  if (gid) {
    for (const id of await groupMemberIds(gid, uid)) rtPush(id, 'metaupd', { scope: 'group', groupId: gid, id: mid, meta });
  } else {
    const other = row.sender_id === uid ? row.recipient_id : row.sender_id;
    rtPush(other, 'metaupd', { scope: 'dm', peerId: uid, id: mid, meta });
  }
}

// Cast / change / clear a vote on a poll. body: { group?, option } (option may be
// a single index or an array when the poll allows multiple answers).
app.post('/api/atchat/poll/:id/vote', auth.requireAuth, rateLimit(80, 60000, 'poll-vote'), async (req, res) => {
  const mid = routeId(req.params.id);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid id.' });
  const gid = req.body.group ? routeId(req.body.group) : null;
  if (req.body.group && !Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const uid = req.user.id;
  try {
    const found = await loadMetaMsg(mid, gid, uid, 'poll');
    if (!found) return res.status(404).json({ error: 'Poll not found.' });
    const meta = found.row.meta;
    const valid = new Set(meta.opts.map((o) => o.i));
    let chosen = (Array.isArray(req.body.option) ? req.body.option : [req.body.option])
      .map((n) => parseInt(n, 10)).filter((n) => valid.has(n));
    if (!chosen.length) return res.status(400).json({ error: 'Invalid option.' });
    if (!meta.multi) chosen = [chosen[0]];
    meta.votes = meta.votes || {};
    const cur = meta.votes[uid] || [];
    if (meta.multi) {
      const set = new Set(cur);
      for (const c of chosen) { if (set.has(c)) set.delete(c); else set.add(c); }
      meta.votes[uid] = [...set];
    } else {
      meta.votes[uid] = (cur.length === 1 && cur[0] === chosen[0]) ? [] : chosen; // tap your choice again to clear
    }
    if (!meta.votes[uid].length) delete meta.votes[uid];
    await db.query(`UPDATE ${found.table} SET meta = $1 WHERE id = $2`, [JSON.stringify(meta), mid]);
    await pushMetaUpd(found.row, gid, uid, mid, meta);
    res.json({ meta });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Set / clear an RSVP on an event. body: { group?, rsvp: 'going'|'maybe'|'no' }.
app.post('/api/atchat/event/:id/rsvp', auth.requireAuth, rateLimit(80, 60000, 'event-rsvp'), async (req, res) => {
  const mid = routeId(req.params.id);
  if (!Number.isInteger(mid)) return res.status(400).json({ error: 'Invalid id.' });
  const gid = req.body.group ? routeId(req.body.group) : null;
  if (req.body.group && !Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const uid = req.user.id;
  const choice = ['going', 'maybe', 'no'].includes(req.body.rsvp) ? req.body.rsvp : null;
  if (!choice) return res.status(400).json({ error: 'Invalid RSVP.' });
  try {
    const found = await loadMetaMsg(mid, gid, uid, 'event');
    if (!found) return res.status(404).json({ error: 'Event not found.' });
    const meta = found.row.meta;
    meta.rsvp = meta.rsvp || {};
    if (meta.rsvp[uid] === choice) delete meta.rsvp[uid]; else meta.rsvp[uid] = choice; // tap again to clear
    await db.query(`UPDATE ${found.table} SET meta = $1 WHERE id = $2`, [JSON.stringify(meta), mid]);
    await pushMetaUpd(found.row, gid, uid, mid, meta);
    res.json({ meta });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

/* ═══════════════════════════════════════════════
   GROUP CLOUD  —  a shared drive per group (folders, files, sheets)
═══════════════════════════════════════════════ */
function cloudNode(r, withData) {
  const o = {
    id: r.id, parentId: r.parent_id || null, kind: r.kind, name: r.name,
    ownerId: r.owner_id || null, ownerName: r.owner_name || null, ownerUsername: r.owner_username || null,
    mime: r.mime || null, mediaKind: r.media_kind || null, size: r.size_bytes != null ? Number(r.size_bytes) : null,
    created_at: r.created_at, updated_at: r.updated_at,
  };
  if (withData) o.data = r.data || null;
  // Lightweight summary for "tool" nodes so the list can show progress/counts
  // without shipping the full blob (file blobs are never selected into list_data).
  const raw = r.list_data != null ? r.list_data : (withData ? r.data : null);
  if (raw && (r.kind === 'checklist' || r.kind === 'form' || r.kind === 'schedule' || r.kind === 'roster' || r.kind === 'expenses')) {
    try {
      const m = JSON.parse(raw);
      if (r.kind === 'checklist') { const it = Array.isArray(m.items) ? m.items : []; o.done = it.filter((x) => x && x.done).length; o.total = it.length; }
      else if (r.kind === 'form') { o.entries = Array.isArray(m.entries) ? m.entries.length : 0; }
      else if (r.kind === 'schedule') { o.shifts = Array.isArray(m.shifts) ? m.shifts.length : 0; }
      else if (r.kind === 'roster') { o.people = Array.isArray(m.people) ? m.people.length : 0; }
      else if (r.kind === 'expenses') { const it = Array.isArray(m.items) ? m.items : []; o.count = it.length; o.total = it.reduce((s, x) => s + (Number(x && x.amount) || 0), 0); }
    } catch { /* malformed → no summary */ }
  }
  return o;
}
// Post a lightweight group message announcing a Cloud change, and live-deliver it.
async function cloudNotify(gid, userId, text) {
  try {
    const me = await chatIdentity(userId);
    const ins = await db.query(
      'INSERT INTO at_group_messages (group_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at',
      [gid, userId, text]
    );
    const r = ins.rows[0];
    const base = {
      id: r.id, body: r.body, image: null, media: null, media_kind: null, media_name: null,
      created_at: r.created_at,
      sender: { id: me.id, name: me.name, username: me.username, avatar: me.avatar || null, verified: !!me.verified },
    };
    for (const id of await groupMemberIds(gid, userId)) rtPush(id, 'msg', { kind: 'group', groupId: gid, message: { ...base, mine: false } });
  } catch (e) { /* non-fatal */ }
}
function cloudPush(gid, exceptId, payload) {
  groupMemberIds(gid, exceptId).then((ids) => { for (const id of ids) rtPush(id, 'cloud', payload); }).catch(() => {});
}

// List a folder's contents (metadata only — no file blobs) + breadcrumb path.
app.get('/api/atchat/groups/:id/cloud', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const parent = req.query.parent ? parseInt(req.query.parent, 10) : null;
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const { rows } = await db.query(
      `SELECT n.id, n.parent_id, n.kind, n.name, n.owner_id, n.mime, n.media_kind, n.size_bytes, n.created_at, n.updated_at, u.name AS owner_name, u.username AS owner_username,
              CASE WHEN n.kind IN ('checklist','form','schedule','roster','expenses') THEN n.data ELSE NULL END AS list_data
       FROM group_cloud n LEFT JOIN users u ON u.id = n.owner_id
       WHERE n.group_id = $1 AND n.parent_id IS NOT DISTINCT FROM $2
       ORDER BY (n.kind = 'folder') DESC, lower(n.name)`,
      [gid, parent]
    );
    const path = [];
    let pid = parent, guard = 0;
    while (pid && guard++ < 50) {
      const p = await db.query('SELECT id, name, parent_id FROM group_cloud WHERE id = $1 AND group_id = $2', [pid, gid]);
      if (!p.rows[0]) break;
      path.unshift({ id: p.rows[0].id, name: p.rows[0].name });
      pid = p.rows[0].parent_id;
    }
    res.json({ items: rows.map((r) => cloudNode(r, false)), path, parentId: parent || null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Create a folder / sheet, or upload a file.
app.post('/api/atchat/groups/:id/cloud', auth.requireAuth, rateLimit(60, 60000, 'cloud-add'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const parentId = req.body.parentId ? parseInt(req.body.parentId, 10) : null;
  const kind = req.body.kind;
  let name = (req.body.name || '').toString().trim().slice(0, 120);
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    if (parentId) {
      const p = await db.query("SELECT id FROM group_cloud WHERE id = $1 AND group_id = $2 AND kind = 'folder'", [parentId, gid]);
      if (!p.rows[0]) return res.status(400).json({ error: 'Folder not found.' });
    }
    let mime = null, mediaKind = null, size = null, data = null;
    if (kind === 'folder') { if (!name) name = 'New folder'; }
    else if (kind === 'sheet') { if (!name) name = 'Untitled sheet'; data = JSON.stringify({ cols: 6, rows: 20, cells: {} }); }
    else if (kind === 'checklist') {
      if (!name) name = 'Checklist';
      // Optional seed items (blank list, an industry template, or an AI draft).
      const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 200)
        .map((it, i) => ({ id: 'i' + (i + 1), text: String((it && it.text != null ? it.text : it) || '').slice(0, 300), done: !!(it && it.done) }))
        .filter((it) => it.text);
      data = JSON.stringify({ items });
    }
    else if (kind === 'note') { if (!name) name = 'Untitled note'; data = JSON.stringify({ text: String(req.body.text || '').slice(0, 100000) }); }
    else if (kind === 'form') {
      if (!name) name = 'Form';
      // A form is a reusable set of fields + a running list of dated entries.
      const fields = (Array.isArray(req.body.fields) ? req.body.fields : []).slice(0, 40).map((f, i) => ({
        id: 'f' + (i + 1),
        label: String((f && f.label != null ? f.label : f) || '').slice(0, 120),
        type: ['text', 'number', 'check', 'date'].includes(f && f.type) ? f.type : 'text',
      })).filter((f) => f.label);
      data = JSON.stringify({ fields, entries: [] });
    }
    else if (kind === 'schedule') { if (!name) name = 'Schedule'; data = JSON.stringify({ shifts: [] }); }
    else if (kind === 'roster') { if (!name) name = 'Team & key info'; data = JSON.stringify({ people: [], info: [] }); }
    else if (kind === 'expenses') { if (!name) name = 'Expenses'; data = JSON.stringify({ items: [] }); }
    else if (kind === 'file') {
      const media = mediaFromBody(req.body);
      if (media === undefined || !media.data) return res.status(400).json({ error: 'That file could not be added (unsupported type or too large — 16 MB max).' });
      data = media.data; mediaKind = media.kind;
      const m = /^data:([^;]+);base64,/.exec(data); mime = m ? m[1] : null;
      size = Math.round((data.length - (data.indexOf(',') + 1)) * 3 / 4);
      if (!name) name = media.name || (mediaKind === 'image' ? 'Image' : mediaKind === 'video' ? 'Video' : mediaKind === 'audio' ? 'Audio' : 'File');
    } else return res.status(400).json({ error: 'Invalid kind.' });
    const ins = await db.query(
      `INSERT INTO group_cloud (group_id, parent_id, kind, name, owner_id, mime, media_kind, size_bytes, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [gid, parentId, kind, name, req.user.id, mime, mediaKind, size, data]
    );
    const labelVerb = { folder: 'created the folder', sheet: 'created the sheet', checklist: 'created the checklist', note: 'created the note', form: 'created the form', schedule: 'created the schedule', roster: 'created', expenses: 'started the expenses log' };
    const label = labelVerb[kind] ? `${labelVerb[kind]} “${name}”` : `added “${name}”`;
    cloudNotify(gid, req.user.id, `📁 ${label} in the Cloud`);
    cloudPush(gid, req.user.id, { groupId: gid, parentId });
    res.json({ node: cloudNode(ins.rows[0], false) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Fetch one node WITH its data (file blob / sheet json).
app.get('/api/atchat/groups/:id/cloud/:nid', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), nid = routeId(req.params.nid);
  if (!Number.isInteger(gid) || !Number.isInteger(nid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const { rows } = await db.query(
      'SELECT n.*, u.name AS owner_name, u.username AS owner_username FROM group_cloud n LEFT JOIN users u ON u.id = n.owner_id WHERE n.id = $1 AND n.group_id = $2',
      [nid, gid]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    res.json({ node: cloudNode(rows[0], true) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Rename a node, or save a sheet's data (collaborative — last write wins).
app.patch('/api/atchat/groups/:id/cloud/:nid', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), nid = routeId(req.params.nid);
  if (!Number.isInteger(gid) || !Number.isInteger(nid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const cur = await db.query('SELECT id, kind FROM group_cloud WHERE id = $1 AND group_id = $2', [nid, gid]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found.' });
    const sets = [], vals = [];
    if (typeof req.body.name === 'string') {
      const nm = req.body.name.trim().slice(0, 120);
      if (nm) { vals.push(nm); sets.push(`name = $${vals.length}`); }
    }
    if (typeof req.body.data === 'string' && ['sheet', 'checklist', 'note', 'form', 'schedule', 'roster', 'expenses'].includes(cur.rows[0].kind)) {
      if (req.body.data.length > 2_000_000) return res.status(400).json({ error: 'That’s too large to save.' });
      vals.push(req.body.data); sets.push(`data = $${vals.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    sets.push('updated_at = now()');
    vals.push(nid, gid);
    const { rows } = await db.query(
      `UPDATE group_cloud SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND group_id = $${vals.length} RETURNING *`,
      vals
    );
    cloudPush(gid, req.user.id, { groupId: gid, parentId: rows[0].parent_id || null, nodeId: nid });
    res.json({ node: cloudNode(rows[0], false) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Delete a node (folders cascade to their contents). Only the uploader/creator
// (the node's owner) may delete it.
app.delete('/api/atchat/groups/:id/cloud/:nid', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id), nid = routeId(req.params.nid);
  if (!Number.isInteger(gid) || !Number.isInteger(nid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const sel = await db.query('SELECT owner_id, parent_id FROM group_cloud WHERE id = $1 AND group_id = $2', [nid, gid]);
    if (!sel.rows[0]) return res.status(404).json({ error: 'Not found.' });
    if (sel.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Only the person who added this can delete it.' });
    await db.query('DELETE FROM group_cloud WHERE id = $1 AND group_id = $2', [nid, gid]);
    cloudPush(gid, req.user.id, { groupId: gid, parentId: sel.rows[0].parent_id || null });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Atwe AI drafts a checklist from a plain-English prompt (e.g. "opening checklist
// for a coffee shop"). Returns { title, items } — the client creates the node so
// creation stays in one path. Brand-safe: never mentions Claude/Anthropic.
app.post('/api/atchat/groups/:id/cloud/ai-checklist', auth.requireAuth, rateLimit(15, 60000, 'cloud-ai'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const prompt = (req.body.prompt || '').toString().trim().slice(0, 300);
  if (!prompt) return res.status(400).json({ error: 'Tell Atwe AI what the checklist is for.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const sys = 'You are Atwe AI, helping a business team build a practical work checklist. ' +
      'Given a short description, produce a clear, ordered checklist a worker could follow on the job. ' +
      'Use 5–15 concise, action-oriented items (no numbering in the text). ' +
      'Reply with STRICT JSON only: {"title": string, "items": [string, ...]}. No markdown, no prose outside JSON. ' +
      'Never mention "Claude" or "Anthropic".';
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: sys,
      messages: [{ role: 'user', content: 'Checklist for: ' + prompt + '\n\nReturn the JSON now.' }],
    });
    const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    const j = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    const parsed = JSON.parse(j);
    const title = (typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : prompt).slice(0, 120);
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((s) => String(s || '').trim().slice(0, 300)).filter(Boolean).slice(0, 30);
    if (!items.length) return res.status(502).json({ error: 'Atwe AI could not draft that. Try rephrasing.' });
    res.json({ title, items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not draft the checklist. Please try again.' }); }
});

// Atwe AI reads the group's recent messages and extracts the action items /
// to-dos into a checklist. Returns { title, items } (client creates the node).
app.post('/api/atchat/groups/:id/cloud/chat-checklist', auth.requireAuth, rateLimit(10, 60000, 'cloud-ai'), async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const { rows } = await db.query(
      `SELECT m.body, u.name AS sender FROM at_group_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 AND m.body IS NOT NULL AND m.body <> '' ORDER BY m.created_at DESC LIMIT 80`,
      [gid]
    );
    if (!rows.length) return res.status(400).json({ error: 'There are no messages to turn into tasks yet.' });
    // Oldest-first transcript, trimmed for the prompt.
    const transcript = rows.reverse().map((r) => `${(r.sender || 'Someone').split(' ')[0]}: ${String(r.body).slice(0, 300)}`).join('\n').slice(0, 6000);
    const sys = 'You are Atwe AI. Read a group chat transcript from a business team and extract the concrete action items / to-dos into a checklist. ' +
      'Only include real, actionable tasks people agreed to or asked for — ignore chit-chat. If there are none, return an empty items array. ' +
      'Each item is a short imperative task. Reply with STRICT JSON only: {"title": string, "items": [string, ...]}. No markdown, no prose outside JSON. ' +
      'Never mention "Claude" or "Anthropic".';
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024, system: sys,
      messages: [{ role: 'user', content: 'Transcript:\n' + transcript + '\n\nExtract the checklist now.' }],
    });
    const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    const j = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    const parsed = JSON.parse(j);
    const title = (typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : 'Tasks from chat').slice(0, 120);
    const items = (Array.isArray(parsed.items) ? parsed.items : []).map((s) => String(s || '').trim().slice(0, 300)).filter(Boolean).slice(0, 30);
    if (!items.length) return res.status(422).json({ error: 'Atwe AI didn’t find any clear tasks in the recent chat.' });
    res.json({ title, items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not build the checklist. Please try again.' }); }
});

// Tell a group member they've been assigned a checklist task. The assignment
// itself lives in the checklist node's data (saved via the generic PATCH); this
// just fires the notification (deep-links to the group).
app.post('/api/atchat/groups/:id/notify-task', auth.requireAuth, rateLimit(60, 60000, 'task-assign'), async (req, res) => {
  const gid = routeId(req.params.id), to = parseInt(req.body.to, 10);
  if (!Number.isInteger(gid) || !Number.isInteger(to)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    if (!(await isGroupMember(gid, to))) return res.status(400).json({ error: 'That person is not in the group.' });
    await notify(to, req.user.id, 'task_assigned', null, null, gid);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not notify.' }); }
});

// Add people to a group (any member can add).
app.post('/api/atchat/groups/:id/members', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const ids = [...new Set((Array.isArray(req.body.members) ? req.body.members : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ error: 'No one to add.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    // Broadcast channels are admin-controlled (admin-post-only) — only the creator
    // may add subscribers. Regular groups stay open: any member can add people.
    const gi = await db.query('SELECT created_by, broadcast FROM at_groups WHERE id = $1', [gid]);
    if (gi.rows[0] && gi.rows[0].broadcast && gi.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Only the channel admin can add members.' });
    }
    const valid = await db.query('SELECT id FROM users WHERE id = ANY($1) AND username IS NOT NULL', [ids]);
    for (const r of valid.rows) {
      await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, r.id]);
    }
    res.json({ ok: true, added: valid.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Mute / unmute a group or channel for myself (suppresses the unread badge).
app.post('/api/atchat/groups/:id/mute', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  const muted = req.body.muted === true;
  // Optional timed mute: `minutes` (a positive number) mutes for that long; null /
  // absent = mute "Always". Unmuting always clears any expiry.
  const mins = Number(req.body.minutes);
  const timed = muted && Number.isFinite(mins) && mins > 0;
  const until = timed ? new Date(Date.now() + Math.min(mins, 525600) * 60000) : null; // cap at ~1 year
  try {
    const r = await db.query('UPDATE at_group_members SET muted = $1, muted_until = $2 WHERE group_id = $3 AND user_id = $4', [muted, until, gid, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Group not found.' });
    res.json({ ok: true, muted, mutedUntil: until ? until.getTime() : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Leave a group.
app.delete('/api/atchat/groups/:id/members/me', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    await db.query('DELETE FROM at_group_members WHERE group_id = $1 AND user_id = $2', [gid, req.user.id]);
    // Clean up empty groups.
    await db.query('DELETE FROM at_groups g WHERE g.id = $1 AND NOT EXISTS (SELECT 1 FROM at_group_members m WHERE m.group_id = g.id)', [gid]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Group invite links (WhatsApp-style) ─── */
function newInviteCode() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 14; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
// Current invite link (members can see it; only the admin can create/revoke).
app.get('/api/atchat/groups/:id/invite', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    if (!(await isGroupMember(gid, req.user.id))) return res.status(404).json({ error: 'Group not found.' });
    const g = await db.query('SELECT invite_code, created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    res.json({ code: g.rows[0].invite_code || null, isAdmin: g.rows[0].created_by === req.user.id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the invite link.' }); }
});
// Create (or rotate) the invite link — admin only.
app.post('/api/atchat/groups/:id/invite', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (g.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the group admin can manage the invite link.' });
    // Retry on the rare unique-index collision.
    let code = null;
    for (let attempt = 0; attempt < 6 && !code; attempt++) {
      const candidate = newInviteCode();
      try {
        await db.query('UPDATE at_groups SET invite_code = $1 WHERE id = $2', [candidate, gid]);
        code = candidate;
      } catch (e) { /* collision → retry */ }
    }
    if (!code) return res.status(500).json({ error: 'Could not create the invite link.' });
    res.json({ code });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the invite link.' }); }
});
// Revoke the invite link — admin only.
app.delete('/api/atchat/groups/:id/invite', auth.requireAuth, async (req, res) => {
  const gid = routeId(req.params.id);
  if (!Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid group id.' });
  try {
    const g = await db.query('SELECT created_by FROM at_groups WHERE id = $1', [gid]);
    if (!g.rows[0]) return res.status(404).json({ error: 'Group not found.' });
    if (g.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the group admin can manage the invite link.' });
    await db.query('UPDATE at_groups SET invite_code = NULL WHERE id = $1', [gid]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not revoke the invite link.' }); }
});
// Preview a group by its invite code (name + member count) before joining.
app.get('/api/atchat/invite/:code', auth.requireAuth, async (req, res) => {
  const code = (req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Invalid invite link.' });
  try {
    const g = await db.query('SELECT id, name, avatar, broadcast FROM at_groups WHERE invite_code = $1', [code]);
    if (!g.rows[0]) return res.status(404).json({ error: 'This invite link is no longer valid.' });
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM at_group_members WHERE group_id = $1', [g.rows[0].id]);
    const member = await isGroupMember(g.rows[0].id, req.user.id);
    res.json({ group: { id: g.rows[0].id, name: g.rows[0].name, avatar: g.rows[0].avatar || null, broadcast: !!g.rows[0].broadcast, members: cnt.rows[0].n, member } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not open that invite link.' }); }
});
// Join a group via its invite code.
app.post('/api/atchat/invite/:code/join', auth.requireAuth, async (req, res) => {
  const code = (req.params.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Invalid invite link.' });
  try {
    const me = await chatIdentity(req.user.id);
    if (!me || !me.username) return res.status(403).json(NEED_USERNAME);
    const g = await db.query('SELECT id, name FROM at_groups WHERE invite_code = $1', [code]);
    if (!g.rows[0]) return res.status(404).json({ error: 'This invite link is no longer valid.' });
    const gid = g.rows[0].id;
    await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, req.user.id]);
    res.json({ ok: true, groupId: gid, name: g.rows[0].name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not join the group.' }); }
});

/* ─── Locked / hidden chats (passcode) ─── */
// Set or change the chat-lock passcode (4–10 digits). `current` is required when
// a passcode already exists. Returns the current locked list.
app.post('/api/atchat/lock/pin', auth.requireAuth, async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,10}$/.test(pin)) return res.status(400).json({ error: 'Use a 4–10 digit passcode.' });
  try {
    const u = (await db.query('SELECT chat_lock_pin FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (u && u.chat_lock_pin) {
      const ok = await auth.verifyPassword(String(req.body.current || ''), u.chat_lock_pin);
      if (!ok) return res.status(403).json({ error: 'Current passcode is incorrect.' });
    }
    const hash = await auth.hashPassword(pin);
    await db.query('UPDATE users SET chat_lock_pin = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true, hasPin: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not set the passcode.' }); }
});
// Verify the passcode to reveal locked chats this session.
app.post('/api/atchat/lock/unlock', auth.requireAuth, async (req, res) => {
  const pin = String(req.body.pin || '');
  try {
    const u = (await db.query('SELECT chat_lock_pin, chat_locked FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u || !u.chat_lock_pin) return res.status(400).json({ error: 'No passcode set yet.' });
    const ok = await auth.verifyPassword(pin, u.chat_lock_pin);
    if (!ok) return res.status(403).json({ error: 'Incorrect passcode.' });
    res.json({ ok: true, locked: Array.isArray(u.chat_locked) ? u.chat_locked : [] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unlock.' }); }
});
// Lock or unlock (hide/reveal) a specific thread key ("d2" / "g5"). Requires a
// passcode to already be set.
app.post('/api/atchat/lock/thread', auth.requireAuth, async (req, res) => {
  const key = String(req.body.key || '').trim();
  const lock = req.body.lock !== false;
  if (!/^[dg]\d+$/.test(key)) return res.status(400).json({ error: 'Invalid thread.' });
  try {
    const u = (await db.query('SELECT chat_lock_pin, chat_locked FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u || !u.chat_lock_pin) return res.status(400).json({ error: 'Set a passcode first.', needPin: true });
    let locked = Array.isArray(u.chat_locked) ? u.chat_locked.slice() : [];
    if (lock) { if (!locked.includes(key)) locked.push(key); }
    else locked = locked.filter((k) => k !== key);
    await db.query('UPDATE users SET chat_locked = $1 WHERE id = $2', [JSON.stringify(locked), req.user.id]);
    res.json({ ok: true, locked });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update the locked chats.' }); }
});

/* ═══════════════════════════════════════════════
   COMMUNITIES  —  umbrella over sub-groups + an announcement channel
═══════════════════════════════════════════════ */
async function isCommunityMember(communityId, userId) {
  const r = await db.query('SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2', [communityId, userId]);
  return r.rowCount > 0;
}
function mapCommunity(c, me) {
  return {
    id: c.id, name: c.name, description: c.description || null, avatar: c.avatar || null,
    announceGroupId: c.announce_group_id || null,
    members: c.members != null ? c.members : undefined,
    groups: c.groups != null ? c.groups : undefined,
    isAdmin: c.created_by === me, isMember: c.is_member === true || c.created_by === me,
    created_at: c.created_at,
  };
}
// Create a community — also spins up its broadcast "announcement" channel.
app.post('/api/communities', auth.requireAuth, rateLimit(10, 60000, 'community-create'), async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name your community.' });
  const description = (req.body.description || '').trim().slice(0, 500) || null;
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    if (!(await requireHandle(req, res))) return;
    // 1) the announcement channel (a broadcast group; only admins post).
    const ag = await db.query('INSERT INTO at_groups (name, created_by, broadcast) VALUES ($1, $2, true) RETURNING id', [name + ' — Announcements', req.user.id]);
    const announceId = ag.rows[0].id;
    await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [announceId, req.user.id]);
    // 2) the community itself.
    const c = await db.query('INSERT INTO communities (name, description, avatar, created_by, announce_group_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at', [name, description, avatar, req.user.id, announceId]);
    const id = c.rows[0].id;
    await db.query("INSERT INTO community_members (community_id, user_id, role) VALUES ($1,$2,'admin')", [id, req.user.id]);
    res.status(201).json({ community: { id, name, description, avatar: avatar || null, announceGroupId: announceId, isAdmin: true, isMember: true, members: 1, groups: 0, created_at: c.rows[0].created_at } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the community.' }); }
});
// List communities: scope=mine (joined) | discover (others, newest first).
app.get('/api/communities', auth.requireAuth, async (req, res) => {
  const scope = req.query.scope === 'mine' ? 'mine' : 'discover';
  try {
    const where = scope === 'mine'
      ? 'WHERE EXISTS(SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = $1)'
      : 'WHERE NOT EXISTS(SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = $1)';
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.description, c.avatar, c.created_by, c.announce_group_id, c.created_at,
              (SELECT COUNT(*)::int FROM community_members m WHERE m.community_id = c.id) AS members,
              (SELECT COUNT(*)::int FROM community_groups g WHERE g.community_id = c.id) AS groups,
              EXISTS(SELECT 1 FROM community_members m WHERE m.community_id = c.id AND m.user_id = $1) AS is_member
       FROM communities c ${where} ORDER BY c.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ communities: rows.map((c) => mapCommunity(c, req.user.id)) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load communities.' }); }
});
// Community detail: sub-groups (with my membership) + announcement channel.
app.get('/api/communities/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const c = (await db.query('SELECT id, name, description, avatar, created_by, announce_group_id, created_at FROM communities WHERE id = $1', [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Community not found.' });
    const member = await isCommunityMember(id, req.user.id);
    const subs = await db.query(
      `SELECT g.id, g.name, g.avatar, g.broadcast,
              (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members,
              EXISTS(SELECT 1 FROM at_group_members m WHERE m.group_id = g.id AND m.user_id = $2) AS joined
       FROM community_groups cg JOIN at_groups g ON g.id = cg.group_id
       WHERE cg.community_id = $1 ORDER BY g.id`,
      [id, req.user.id]
    );
    const memberCount = (await db.query('SELECT COUNT(*)::int AS n FROM community_members WHERE community_id = $1', [id])).rows[0].n;
    res.json({
      community: { ...mapCommunity({ ...c, members: memberCount, groups: subs.rowCount, is_member: member }, req.user.id) },
      announceGroupId: c.announce_group_id || null,
      groups: subs.rows.map((g) => ({ id: g.id, name: g.name, avatar: g.avatar || null, broadcast: !!g.broadcast, members: g.members, joined: !!g.joined })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the community.' }); }
});
// Join a community — also joins its announcement channel.
app.post('/api/communities/:id/join', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const c = (await db.query('SELECT announce_group_id FROM communities WHERE id = $1', [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Community not found.' });
    await db.query("INSERT INTO community_members (community_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, req.user.id]);
    if (c.announce_group_id) await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.announce_group_id, req.user.id]);
    res.json({ ok: true, joined: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not join.' }); }
});
// Leave a community (also leaves the announcement channel; sub-groups are kept).
app.delete('/api/communities/:id/join', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const c = (await db.query('SELECT created_by, announce_group_id FROM communities WHERE id = $1', [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Community not found.' });
    if (c.created_by === req.user.id) return res.status(400).json({ error: 'The owner can’t leave their own community.' });
    await db.query('DELETE FROM community_members WHERE community_id = $1 AND user_id = $2', [id, req.user.id]);
    if (c.announce_group_id) await db.query('DELETE FROM at_group_members WHERE group_id = $1 AND user_id = $2', [c.announce_group_id, req.user.id]);
    res.json({ ok: true, joined: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not leave.' }); }
});
// Add a sub-group: create a new group under the community (admin only).
app.post('/api/communities/:id/groups', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const name = (req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Name the group.' });
  try {
    const c = (await db.query('SELECT created_by FROM communities WHERE id = $1', [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Community not found.' });
    if (c.created_by !== req.user.id) return res.status(403).json({ error: 'Only the community admin can add groups.' });
    const g = await db.query('INSERT INTO at_groups (name, created_by) VALUES ($1, $2) RETURNING id', [name, req.user.id]);
    const gid = g.rows[0].id;
    await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, req.user.id]);
    await db.query('INSERT INTO community_groups (community_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, gid]);
    res.status(201).json({ ok: true, groupId: gid, name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the group.' }); }
});
// A community member joins one of its sub-groups.
app.post('/api/communities/:id/groups/:gid/join', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id), gid = routeId(req.params.gid);
  if (!Number.isInteger(id) || !Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    if (!(await isCommunityMember(id, req.user.id))) return res.status(403).json({ error: 'Join the community first.' });
    const linked = await db.query('SELECT 1 FROM community_groups WHERE community_id = $1 AND group_id = $2', [id, gid]);
    if (!linked.rowCount) return res.status(404).json({ error: 'That group isn’t part of this community.' });
    await db.query('INSERT INTO at_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, req.user.id]);
    res.json({ ok: true, groupId: gid });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not join the group.' }); }
});
// Remove a sub-group from the community (admin only; the group itself remains).
app.delete('/api/communities/:id/groups/:gid', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id), gid = routeId(req.params.gid);
  if (!Number.isInteger(id) || !Number.isInteger(gid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const c = (await db.query('SELECT created_by FROM communities WHERE id = $1', [id])).rows[0];
    if (!c) return res.status(404).json({ error: 'Community not found.' });
    if (c.created_by !== req.user.id) return res.status(403).json({ error: 'Only the community admin can remove groups.' });
    await db.query('DELETE FROM community_groups WHERE community_id = $1 AND group_id = $2', [id, gid]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the group.' }); }
});

/* ═══════════════════════════════════════════════
   STORIES / STATUS  —  ephemeral 24h updates (shown to your followers)
═══════════════════════════════════════════════ */
const STORY_KINDS = ['image', 'text']; // photo or text-on-gradient (video would need cleanMedia)
function mapStory(s, me) {
  return {
    id: s.id, kind: s.kind, media: s.media || null, caption: s.caption || null, bg: s.bg || null,
    createdAt: s.created_at, expiresAt: s.expires_at,
    mine: s.user_id === me, seen: !!s.seen, viewCount: s.view_count != null ? Number(s.view_count) : undefined,
  };
}
// Post a story (photo or text). Visible for 24h to your followers.
app.post('/api/stories', auth.requireAuth, rateLimit(30, 60000, 'story-post'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const kind = STORY_KINDS.includes(req.body.kind) ? req.body.kind : 'image';
  const caption = (req.body.caption || '').toString().trim().slice(0, 300) || null;
  const bg = (req.body.bg || '').toString().slice(0, 24) || null;
  let media = null;
  if (kind === 'image') {
    media = cleanImage(req.body.media);
    if (media === undefined || !media) return res.status(400).json({ error: 'Add a photo for your story.' });
  } else if (!caption) {
    return res.status(400).json({ error: 'Write something for your story.' });
  }
  try {
    const r = await db.query(
      'INSERT INTO stories (user_id, kind, media, caption, bg) VALUES ($1,$2,$3,$4,$5) RETURNING id, user_id, kind, media, caption, bg, created_at, expires_at',
      [req.user.id, kind, media, caption, bg]
    );
    // Let followers' open clients refresh their tray.
    const followers = await db.query('SELECT follower_id FROM follows WHERE following_id = $1', [req.user.id]);
    for (const f of followers.rows) rtPush(f.follower_id, 'story', { type: 'new', userId: req.user.id });
    res.status(201).json({ story: mapStory(r.rows[0], req.user.id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not post your story.' }); }
});
// The story tray: people I follow (+ me) who have an active story, grouped by user,
// newest activity first, with an unseen flag. Blocks-aware both ways.
app.get('/api/stories', auth.requireAuth, async (req, res) => {
  const me = req.user.id;
  try {
    const { rows } = await db.query(
      `SELECT s.user_id, u.name, u.username, u.avatar, u.account_type, u.verified,
              COUNT(*)::int AS count, MAX(s.created_at) AS last_at,
              bool_or(sv.viewer_id IS NULL) AS has_unseen
         FROM stories s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
        WHERE s.expires_at > now()
          AND (s.user_id = $1 OR s.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1))
          AND s.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
          AND s.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $1)
        GROUP BY s.user_id, u.name, u.username, u.avatar, u.account_type, u.verified
        ORDER BY (s.user_id = $1) DESC, bool_or(sv.viewer_id IS NULL) DESC, MAX(s.created_at) DESC`,
      [me]
    );
    res.json({ tray: rows.map((r) => ({
      user: { id: r.user_id, name: r.name, username: r.username, avatar: r.avatar || null, accountType: r.account_type === 'business' ? 'business' : 'personal', verified: !!r.verified },
      count: r.count, lastAt: r.last_at, hasUnseen: !!r.has_unseen, mine: r.user_id === me,
    })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load stories.' }); }
});
// A user's active stories (in order), with my seen flag per item. Author sees view counts.
app.get('/api/stories/:userId', auth.requireAuth, async (req, res) => {
  const me = req.user.id;
  const uid = routeId(req.params.userId);
  if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid user.' });
  try {
    if (uid !== me) {
      if (await blockedEither(me, uid)) return res.status(403).json({ error: 'Not available.' });
      // Must follow them (or it's your own) to view.
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [me, uid]);
      if (!f.rowCount) return res.status(403).json({ error: 'Follow them to see their story.' });
    }
    const { rows } = await db.query(
      `SELECT s.id, s.user_id, s.kind, s.media, s.caption, s.bg, s.created_at, s.expires_at,
              (sv.viewer_id IS NOT NULL) AS seen,
              ${uid === me ? '(SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id)' : 'NULL'} AS view_count
         FROM stories s
         LEFT JOIN story_views sv ON sv.story_id = s.id AND sv.viewer_id = $1
        WHERE s.user_id = $2 AND s.expires_at > now()
        ORDER BY s.created_at ASC`,
      [me, uid]
    );
    if (!rows.length) return res.status(404).json({ error: 'No active story.' });
    res.json({ stories: rows.map((s) => mapStory(s, me)) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the story.' }); }
});
// Mark a story seen by me.
app.post('/api/stories/:id/view', auth.requireAuth, rateLimit(300, 60000, 'story-view'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const s = (await db.query('SELECT user_id, expires_at FROM stories WHERE id = $1', [id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Story not found.' });
    if (s.user_id === req.user.id) return res.json({ ok: true }); // own view doesn't count
    if (await blockedEither(req.user.id, s.user_id)) return res.status(403).json({ error: 'Not available.' });
    await db.query('INSERT INTO story_views (story_id, viewer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not record the view.' }); }
});
// Author-only: who viewed a story (seen-by list).
app.get('/api/stories/:id/viewers', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const s = (await db.query('SELECT user_id FROM stories WHERE id = $1', [id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Story not found.' });
    if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Only the author can see viewers.' });
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.account_type, u.verified, v.viewed_at
         FROM story_views v JOIN users u ON u.id = v.viewer_id
        WHERE v.story_id = $1 ORDER BY v.viewed_at DESC LIMIT 200`,
      [id]
    );
    res.json({ viewers: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, accountType: u.account_type === 'business' ? 'business' : 'personal', verified: !!u.verified, viewedAt: u.viewed_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load viewers.' }); }
});
// Delete your own story.
app.delete('/api/stories/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM stories WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Story not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete the story.' }); }
});
// Light periodic sweep of expired stories (reads already filter them out).
setInterval(() => { db.query('DELETE FROM stories WHERE expires_at < now()').catch(() => {}); }, 600000).unref?.();

/* ═══════════════════════════════════════════════
   SOCIAL  —  follow + public posts (AtChat)
   Requires a @username. Posts are public on a user's profile.
═══════════════════════════════════════════════ */
const POSTS_SELECT = `
  SELECT p.id, p.body, p.image, p.images, p.media, p.media_kind, p.created_at, p.edited_at, p.parent_id, p.location, p.reply_scope, p.subscribers_only, p.image_alt,
         (p.promoted_until IS NOT NULL AND p.promoted_until > now()) AS promoted,
         (p.subscribers_only = false OR p.user_id = $1 OR EXISTS(SELECT 1 FROM creator_subs cs WHERE cs.creator_id = p.user_id AND cs.subscriber_id = $1 AND cs.status = 'active' AND (cs.period_end IS NULL OR cs.period_end > now()))) AS sub_ok,
         u.id AS author_id, u.name AS author_name, u.username AS author_username, u.avatar AS author_avatar, u.verified AS author_verified,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)::int AS likes,
         (SELECT COUNT(*) FROM posts r WHERE r.parent_id = p.id)::int AS replies,
         (SELECT COUNT(*) FROM post_reposts rp WHERE rp.post_id = p.id)::int AS reposts,
         (SELECT COUNT(*) FROM post_views pv WHERE pv.post_id = p.id)::int AS views,
         EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) AS liked,
         EXISTS(SELECT 1 FROM post_reposts rp WHERE rp.post_id = p.id AND rp.user_id = $1) AS reposted,
         EXISTS(SELECT 1 FROM post_bookmarks bm WHERE bm.post_id = p.id AND bm.user_id = $1) AS bookmarked,
         (SELECT json_build_object('username', ru.username, 'name', ru.name)
            FROM post_reposts rp JOIN users ru ON ru.id = rp.user_id
            WHERE rp.post_id = p.id AND (rp.user_id = $1 OR rp.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1))
            ORDER BY rp.created_at DESC LIMIT 1) AS reposted_by,
         (SELECT json_build_object('id', q.id, 'body', q.body, 'image', q.image, 'media', q.media, 'mediaKind', q.media_kind, 'created_at', q.created_at,
                    'author', json_build_object('id', qu.id, 'name', qu.name, 'username', qu.username, 'avatar', qu.avatar, 'verified', qu.verified))
            FROM posts q JOIN users qu ON qu.id = q.user_id WHERE q.id = p.quote_id) AS quote,
         (p.user_id = $1) AS mine,
         (SELECT json_agg(json_build_object('id', c.id, 'username', c.username, 'name', c.name))
            FROM post_circles pc JOIN circles c ON c.id = pc.circle_id WHERE pc.post_id = p.id) AS circles,
         (SELECT json_agg(json_build_object('id', f.id, 'username', f.username, 'name', f.name))
            FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id WHERE pf.post_id = p.id) AS feeds,
         (SELECT json_agg(json_build_object('id', o.id, 'text', o.text,
                            'votes', (SELECT COUNT(*)::int FROM post_poll_votes v WHERE v.option_id = o.id)) ORDER BY o.position)
            FROM post_poll_options o WHERE o.post_id = p.id) AS poll_options,
         (SELECT option_id FROM post_poll_votes v WHERE v.post_id = p.id AND v.user_id = $1) AS my_vote
  FROM posts p JOIN users u ON u.id = p.user_id `;
function mapPost(r) {
  let poll = null;
  if (r.poll_options && r.poll_options.length) {
    const total = r.poll_options.reduce((s, o) => s + o.votes, 0);
    poll = { options: r.poll_options, total, myVote: r.my_vote || null };
  }
  // Subscriber-only post the viewer can't access: ship a locked placeholder with
  // no body/media/poll (so non-subscribers see "subscribe to unlock", not content).
  const subLocked = !!r.subscribers_only && r.sub_ok === false;
  if (subLocked) {
    return {
      id: r.id, body: '', image: null, images: [], media: null, mediaKind: null,
      created_at: r.created_at, editedAt: null, promoted: false,
      parentId: r.parent_id || null, location: null,
      likes: r.likes, replies: r.replies || 0, liked: false, mine: false,
      reposts: r.reposts || 0, reposted: false, repostedBy: null,
      views: r.views || 0, bookmarked: false, quote: null,
      replyScope: 'everyone', circles: [], feeds: [], poll: null,
      subscribersOnly: true, locked: true,
      author: { id: r.author_id, name: r.author_name, username: r.author_username, avatar: r.author_avatar || null, verified: !!r.author_verified },
    };
  }
  return {
    id: r.id, body: r.body, image: r.image || null,
    images: (Array.isArray(r.images) && r.images.length) ? r.images : (r.image ? [r.image] : []),
    media: r.media || null, mediaKind: r.media_kind || null, created_at: r.created_at,
    subscribersOnly: !!r.subscribers_only, locked: false, imageAlt: r.image_alt || null,
    editedAt: r.edited_at || null, promoted: !!r.promoted,
    parentId: r.parent_id || null, location: r.location || null,
    likes: r.likes, replies: r.replies || 0, liked: r.liked, mine: r.mine,
    reposts: r.reposts || 0, reposted: !!r.reposted, repostedBy: r.reposted_by || null,
    views: r.views || 0, bookmarked: !!r.bookmarked, quote: r.quote || null,
    replyScope: r.reply_scope || 'everyone',
    circles: r.circles || [], feeds: r.feeds || [], poll,
    author: { id: r.author_id, name: r.author_name, username: r.author_username, avatar: r.author_avatar || null, verified: !!r.author_verified },
  };
}
async function requireHandle(req, res) {
  const me = await chatIdentity(req.user.id);
  if (!me || !me.username) { res.status(403).json(NEED_USERNAME); return null; }
  return me;
}
// Feed mute filter ($1 = viewer): drops muted authors + keyword-matching posts,
// but never the viewer's own posts. Append to a feed WHERE clause.
const MUTE_FILTER = ` AND p.user_id NOT IN (SELECT muted_id FROM post_mutes WHERE muter_id = $1)
  AND (p.user_id = $1 OR NOT EXISTS(SELECT 1 FROM muted_keywords mk WHERE mk.user_id = $1 AND p.body ILIKE '%' || mk.word || '%'))`;
// Hides subscriber-only posts the viewer ($1) can't access from the public feeds
// (they still appear as locked teasers on the creator's own profile).
const SUBONLY_FEED_FILTER = ` AND (p.subscribers_only = false OR p.user_id = $1
  OR EXISTS(SELECT 1 FROM creator_subs cs WHERE cs.creator_id = p.user_id AND cs.subscriber_id = $1 AND cs.status = 'active' AND (cs.period_end IS NULL OR cs.period_end > now())))`;
// Pull #hashtags out of post text (lowercased, deduped, capped).
function extractHashtags(body) {
  const out = new Set();
  const re = /#([\p{L}\p{N}_]{1,50})/gu;
  let m;
  while ((m = re.exec(body || '')) !== null) { out.add(m[1].toLowerCase()); if (out.size >= 10) break; }
  return [...out];
}
function extractMentions(body) {
  const out = new Set();
  const re = /@([a-zA-Z0-9_]{2,30})/g;
  let m;
  while ((m = re.exec(body || '')) !== null) out.add(m[1].toLowerCase());
  return [...out];
}
// Can `viewerId` reply to a post given its author + reply_scope + body?
async function canReplyTo(authorId, scope, body, viewerId) {
  if (authorId === viewerId) return true;
  scope = scope || 'everyone';
  if (scope === 'everyone') return true;
  if (scope === 'following') { const f = await db.query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [authorId, viewerId]); return !!f.rows[0]; }
  if (scope === 'mentioned') { const u = await db.query('SELECT username FROM users WHERE id = $1', [viewerId]); const un = ((u.rows[0] && u.rows[0].username) || '').toLowerCase(); return un ? extractMentions(body).includes(un) : false; }
  return true;
}

// Public profile by @username: identity, counts, follow state, and their posts.
// Lightweight follow counts for the signed-in user (sidebar profile block).
app.get('/api/social/mystats', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
              (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following`,
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { res.json({ followers: 0, following: 0 }); }
});

// The followers / following list for a user (by @username).
app.get('/api/social/follows/:username', auth.requireAuth, async (req, res) => {
  const username = (req.params.username || '').trim().replace(/^@/, '');
  const type = req.query.type === 'followers' ? 'followers' : 'following';
  try {
    const t = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (!t.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const uid = t.rows[0].id;
    // followers → people who follow uid; following → people uid follows.
    const sql = type === 'followers'
      ? `SELECT u.id, u.name, u.username, u.avatar, u.verified FROM follows f JOIN users u ON u.id = f.follower_id
         WHERE f.following_id = $1 AND u.username IS NOT NULL ORDER BY lower(u.name) LIMIT 200`
      : `SELECT u.id, u.name, u.username, u.avatar, u.verified FROM follows f JOIN users u ON u.id = f.following_id
         WHERE f.follower_id = $1 AND u.username IS NOT NULL ORDER BY lower(u.name) LIMIT 200`;
    const { rows } = await db.query(sql, [uid]);
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/social/profile/:username', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const handle = (req.params.username || '').replace(/^@/, '');
    const u = await db.query('SELECT id, name, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, verified, categories, account_type, business_verify_status, otw_visibility, pinned_post_id, sub_price_cents, sub_blurb FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const t = u.rows[0];
    const [counts, posts, exps, skills, recs, featured] = await Promise.all([
      db.query(
        `SELECT (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
                (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following,
                (SELECT COUNT(*)::int FROM posts   WHERE user_id      = $1 AND parent_id IS NULL) AS posts,
                (SELECT COUNT(*)::int FROM connections WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted') AS connections,
                (SELECT status FROM connections WHERE ((requester_id = $2 AND addressee_id = $1) OR (requester_id = $1 AND addressee_id = $2)) LIMIT 1) AS conn_status,
                (SELECT requester_id FROM connections WHERE ((requester_id = $2 AND addressee_id = $1) OR (requester_id = $1 AND addressee_id = $2)) LIMIT 1) AS conn_requester,
                EXISTS(SELECT 1 FROM follows WHERE follower_id = $2 AND following_id = $1) AS is_following,
                EXISTS(SELECT 1 FROM contacts WHERE owner_id = $2 AND contact_id = $1) AS is_contact,
                EXISTS(SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $1) AS is_blocked,
                EXISTS(SELECT 1 FROM post_notify WHERE user_id = $2 AND target_id = $1) AS is_notifying`,
        [t.id, req.user.id]
      ),
      db.query(POSTS_SELECT + 'WHERE p.user_id = $2 AND p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 50', [req.user.id, t.id]),
      db.query(
        `SELECT e.id, e.title, e.company, e.company_user_id, e.start_year, e.end_year,
                bu.username AS company_user_username, bu.name AS company_user_name
         FROM experiences e
         LEFT JOIN users bu ON bu.id = e.company_user_id
         WHERE e.user_id = $1
         ORDER BY (e.end_year IS NULL) DESC, COALESCE(e.end_year, 999999) DESC, COALESCE(e.start_year, 0) DESC, e.id DESC`,
        [t.id]
      ),
      db.query(
        `SELECT s.id, s.name, s.assessed,
                (SELECT COUNT(*)::int FROM skill_endorsements e WHERE e.skill_id = s.id) AS endorsements,
                EXISTS(SELECT 1 FROM skill_endorsements e WHERE e.skill_id = s.id AND e.endorser_id = $2) AS endorsed
         FROM user_skills s WHERE s.user_id = $1
         ORDER BY s.assessed DESC, endorsements DESC, s.id`,
        [t.id, req.user.id]
      ),
      db.query(
        `SELECT r.id, r.relationship, r.body, r.status, r.created_at, r.author_id, ${REC_AUTHOR_COLS}
         FROM recommendations r ${REC_AUTHOR_JOIN}
         WHERE r.subject_id = $1 AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT 50`,
        [t.id]
      ),
      db.query(FEATURED_SELECT + 'WHERE f.user_id = $1 ORDER BY f.position ASC, f.created_at DESC LIMIT 50', [t.id]),
    ]);
    const [edu, certs] = await Promise.all([
      db.query(`SELECT id, school, degree, field, start_year, end_year FROM education WHERE user_id = $1
                ORDER BY COALESCE(end_year, 999999) DESC, COALESCE(start_year, 0) DESC, id DESC`, [t.id]),
      db.query(`SELECT id, name, issuer, issue_year, expire_year, credential_id, url FROM certifications WHERE user_id = $1
                ORDER BY COALESCE(issue_year, 0) DESC, id DESC`, [t.id]),
    ]);
    // Pinned post (top of profile) + whether the viewer has muted this account.
    let pinnedPost = null;
    if (t.pinned_post_id) {
      const pp = await db.query(POSTS_SELECT + 'WHERE p.id = $2 AND p.parent_id IS NULL', [req.user.id, t.pinned_post_id]);
      if (pp.rows[0]) pinnedPost = mapPost(pp.rows[0]);
    }
    const isMuted = t.id !== req.user.id
      ? (await db.query('SELECT 1 FROM post_mutes WHERE muter_id = $1 AND muted_id = $2', [req.user.id, t.id])).rowCount > 0
      : false;
    // Creator-subscription state: their price, and whether I'm an active subscriber.
    const subscriberCount = (t.sub_price_cents > 0)
      ? (await db.query("SELECT COUNT(*)::int AS n FROM creator_subs WHERE creator_id = $1 AND status = 'active' AND (period_end IS NULL OR period_end > now())", [t.id])).rows[0].n
      : 0;
    const isSubscribed = t.id !== req.user.id
      ? (await db.query("SELECT 1 FROM creator_subs WHERE subscriber_id = $1 AND creator_id = $2 AND status = 'active' AND (period_end IS NULL OR period_end > now())", [req.user.id, t.id])).rowCount > 0
      : false;
    // A business account's profile IS its employer page: its posted jobs + the
    // people who currently work there (linked via experiences.company_user_id).
    let businessJobs = [], businessPeople = [];
    if (t.account_type === 'business') {
      const [jb, pp] = await Promise.all([
        db.query(`SELECT ${JOB_COLS}, (SELECT COUNT(*)::int FROM job_applications a WHERE a.job_id = j.id) AS applicants ${JOB_FROM} WHERE j.posted_by = $2 ORDER BY j.created_at DESC LIMIT 40`, [req.user.id, t.id]),
        db.query(`SELECT DISTINCT ON (u.id) u.id, u.name, u.username, u.avatar, u.verified, u.account_type, e.title
                  FROM experiences e JOIN users u ON u.id = e.user_id
                  WHERE e.company_user_id = $1 AND e.end_year IS NULL AND u.username IS NOT NULL
                  ORDER BY u.id, e.start_year DESC NULLS LAST LIMIT 100`, [t.id]),
      ]);
      businessJobs = jb.rows.map((x) => mapJob(x, req.user.id));
      businessPeople = pp.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, accountType: u.account_type, title: u.title || null }));
    }
    const reviewSummary = t.account_type === 'business' ? await businessReviewSummary(t.id) : null;
    // Mutual connections: people connected to BOTH me and this profile.
    let mutualConnections = 0;
    if (t.id !== req.user.id) {
      const mc = await db.query(
        `SELECT COUNT(*)::int AS n FROM (
           SELECT CASE WHEN requester_id = $2 THEN addressee_id ELSE requester_id END AS uid
           FROM connections WHERE (requester_id = $2 OR addressee_id = $2) AND status = 'accepted'
           INTERSECT
           SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS uid
           FROM connections WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
         ) z WHERE uid <> $1 AND uid <> $2`,
        [t.id, req.user.id]
      );
      mutualConnections = mc.rows[0].n;
    }
    res.json({
      businessJobs, businessPeople, mutualConnections, reviewSummary,
      user: { id: t.id, name: t.name, username: t.username, avatar: t.avatar || null, banner: t.banner || null, bio: t.bio || null, location: t.location || null, website: t.website || null, contactEmail: t.contact_email || null, phone: t.phone || null, note: t.note || null, headline: t.headline || null, socials: (t.socials && typeof t.socials === 'object' && !Array.isArray(t.socials)) ? t.socials : {}, verified: !!t.verified, categories: Array.isArray(t.categories) ? t.categories : [], accountType: t.account_type === 'business' ? 'business' : 'personal', businessVerified: t.business_verify_status === 'verified', businessVerifyStatus: ['pending','verified'].includes(t.business_verify_status) ? t.business_verify_status : 'none', openToWork: t.otw_visibility === 'everyone' },
      experiences: exps.rows.map((e) => ({ id: e.id, title: e.title, company: e.company || e.company_user_name || null, companyUserId: e.company_user_id || null, companyUserUsername: e.company_user_username || null, startYear: e.start_year || null, endYear: e.end_year || null })),
      education: edu.rows.map(mapEducation),
      certifications: certs.rows.map(mapCertification),
      skills: skills.rows.map((s) => ({ id: s.id, name: s.name, endorsements: s.endorsements, endorsed: !!s.endorsed, assessed: !!s.assessed })),
      recommendations: recs.rows.map(mapRec),
      featured: featured.rows.map(mapFeatured),
      counts: { followers: counts.rows[0].followers, following: counts.rows[0].following, posts: counts.rows[0].posts, connections: counts.rows[0].connections },
      connectionState: (t.id === req.user.id) ? 'self'
        : counts.rows[0].conn_status === 'accepted' ? 'connected'
        : counts.rows[0].conn_status === 'pending' ? (counts.rows[0].conn_requester === req.user.id ? 'pending_out' : 'pending_in')
        : 'none',
      pinnedPost, isMuted,
      subPrice: t.sub_price_cents || 0, subBlurb: t.sub_blurb || null, isSubscribed, subscriberCount,
      isFollowing: counts.rows[0].is_following,
      isContact: counts.rows[0].is_contact,
      isBlocked: counts.rows[0].is_blocked,
      isNotifying: counts.rows[0].is_notifying,
      isMe: t.id === req.user.id,
      posts: posts.rows.map(mapPost),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Follow / unfollow.
app.post('/api/social/follow/:id', auth.requireAuth, rateLimit(120, 60000, 'follow'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const t = await chatIdentity(target);
    if (!t || !t.username) return res.status(404).json({ error: 'User not found.' });
    if (await blockedEither(req.user.id, target)) return res.status(403).json({ error: 'You can’t follow this account.' });
    const f = await db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING following_id',
      [req.user.id, target]
    );
    if (f.rowCount) notify(target, req.user.id, 'follow', null);
    res.json({ ok: true, following: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/follow/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [req.user.id, target]);
    res.json({ ok: true, following: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
/* ═══════════════════════════════════════════════
   CONNECTIONS  —  the mutual professional graph
═══════════════════════════════════════════════ */
const CONN_USER_COLS = 'u.id, u.name, u.username, u.avatar, u.verified, u.headline, u.account_type';
const mapConnUser = (u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || null, accountType: u.account_type === 'business' ? 'business' : 'personal' });
// State between me and `other`: none | pending_out | pending_in | connected.
async function connState(me, other) {
  const r = await db.query(
    `SELECT requester_id, status FROM connections
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1) LIMIT 1`,
    [me, other]
  );
  if (!r.rows[0]) return 'none';
  if (r.rows[0].status === 'accepted') return 'connected';
  return r.rows[0].requester_id === me ? 'pending_out' : 'pending_in';
}
// Send a connection request (or auto-accept if they already requested me).
app.post('/api/connections/:id', auth.requireAuth, rateLimit(120, 60000, 'connect'), async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other) || other === req.user.id) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const t = await chatIdentity(other);
    if (!t || !t.username) return res.status(404).json({ error: 'User not found.' });
    if (await blockedEither(req.user.id, other)) return res.status(403).json({ error: 'You can’t connect with this account.' });
    // If they already sent ME a pending request, this accepts it (mutual intent).
    const rev = await db.query(`SELECT id FROM connections WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [other, req.user.id]);
    if (rev.rows[0]) {
      await db.query(`UPDATE connections SET status = 'accepted' WHERE id = $1`, [rev.rows[0].id]);
      notify(other, req.user.id, 'connection_accepted', null);
      return res.json({ ok: true, state: 'connected' });
    }
    await db.query(
      `INSERT INTO connections (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')
       ON CONFLICT (requester_id, addressee_id) DO NOTHING`,
      [req.user.id, other]
    );
    notify(other, req.user.id, 'connection_request', null);
    res.json({ ok: true, state: 'pending_out' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send the request.' }); }
});
// Accept a pending request from `:id`.
app.post('/api/connections/:id/accept', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const r = await db.query(`UPDATE connections SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending'`, [other, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'No pending request from this user.' });
    notify(other, req.user.id, 'connection_accepted', null);
    res.json({ ok: true, state: 'connected' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not accept.' }); }
});
// Withdraw a request / decline / remove a connection (any row either direction).
app.delete('/api/connections/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM connections WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)', [req.user.id, other]);
    res.json({ ok: true, state: 'none' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// My accepted connections.
app.get('/api/connections', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${CONN_USER_COLS} FROM connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END
       WHERE (c.requester_id = $1 OR c.addressee_id = $1) AND c.status = 'accepted'
       ORDER BY u.name LIMIT 1000`,
      [req.user.id]
    );
    res.json({ connections: rows.map(mapConnUser) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load connections.' }); }
});
// Incoming pending requests (people who want to connect with me).
app.get('/api/connections/requests', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${CONN_USER_COLS} FROM connections c
       JOIN users u ON u.id = c.requester_id
       WHERE c.addressee_id = $1 AND c.status = 'pending' ORDER BY c.created_at DESC LIMIT 300`,
      [req.user.id]
    );
    res.json({ requests: rows.map(mapConnUser) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load requests.' }); }
});
// Record a profile view (fire-and-forget from the client).
app.post('/api/profile-view/:id', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other) || other === req.user.id) return res.json({ ok: true });
  try {
    // Anonymous browsing (LinkedIn private mode): a viewer with private mode on
    // isn't recorded against the profile they visited.
    const me = await db.query('SELECT private_profile_views FROM users WHERE id = $1', [req.user.id]);
    if (me.rows[0] && me.rows[0].private_profile_views) return res.json({ ok: true, private: true });
    await db.query(
      `INSERT INTO profile_views (viewer_id, viewed_id) VALUES ($1,$2)
       ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = now()`,
      [req.user.id, other]
    );
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});
// Who viewed MY profile (recent viewers + a 7-day count).
app.get('/api/profile-views', auth.requireAuth, async (req, res) => {
  try {
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM profile_views WHERE viewed_id = $1 AND viewed_at > now() - interval '7 days'`, [req.user.id]);
    const { rows } = await db.query(
      `SELECT ${CONN_USER_COLS}, v.viewed_at FROM profile_views v JOIN users u ON u.id = v.viewer_id
       WHERE v.viewed_id = $1 ORDER BY v.viewed_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ weekCount: cnt.rows[0].n, viewers: rows.map((u) => ({ ...mapConnUser(u), viewedAt: u.viewed_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load viewers.' }); }
});
// "People you may know" — friends-of-friends ranked by mutual connections.
app.get('/api/connections/suggestions', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `WITH my_conns AS (
         SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS uid
         FROM connections WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
       ),
       fof AS (
         SELECT CASE WHEN c.requester_id IN (SELECT uid FROM my_conns) THEN c.addressee_id ELSE c.requester_id END AS uid
         FROM connections c
         WHERE c.status = 'accepted' AND (c.requester_id IN (SELECT uid FROM my_conns) OR c.addressee_id IN (SELECT uid FROM my_conns))
       )
       SELECT ${CONN_USER_COLS},
         (SELECT COUNT(*)::int FROM my_conns mc WHERE mc.uid IN (
            SELECT CASE WHEN c.requester_id = u.id THEN c.addressee_id ELSE c.requester_id END
            FROM connections c WHERE (c.requester_id = u.id OR c.addressee_id = u.id) AND c.status = 'accepted'
         )) AS mutuals
       FROM users u
       WHERE u.id IN (SELECT uid FROM fof) AND u.id <> $1 AND u.username IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM connections c WHERE ((c.requester_id = $1 AND c.addressee_id = u.id) OR (c.requester_id = u.id AND c.addressee_id = $1)))
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
       ORDER BY mutuals DESC, u.id DESC LIMIT 12`,
      [req.user.id]
    );
    res.json({ suggestions: rows.map((u) => ({ ...mapConnUser(u), mutuals: u.mutuals })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load suggestions.' }); }
});
// A user's public connection list (by @username).
app.get('/api/social/connections/:username', auth.requireAuth, async (req, res) => {
  try {
    const handle = (req.params.username || '').replace(/^@/, '');
    const t = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!t.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const uid = t.rows[0].id;
    const { rows } = await db.query(
      `SELECT ${CONN_USER_COLS} FROM connections c
       JOIN users u ON u.id = CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END
       WHERE (c.requester_id = $1 OR c.addressee_id = $1) AND c.status = 'accepted'
       ORDER BY u.name LIMIT 1000`,
      [uid]
    );
    res.json({ connections: rows.map(mapConnUser) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load connections.' }); }
});
// "Who to follow" — people you don't follow yet (most-followed first), for the
// empty feed / onboarding activation.
app.get('/api/social/suggestions', auth.requireAuth, async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar,
              (SELECT COUNT(*)::int FROM follows f WHERE f.following_id = u.id) AS followers
       FROM users u
       WHERE u.username IS NOT NULL AND u.id <> $1
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = $1))
       ORDER BY followers DESC, u.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, followers: u.followers })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load suggestions.' });
  }
});

// Block / unblock. Blocking also drops the follow relationship both ways and
// removes any post-notify subscriptions between the two.
app.post('/api/social/block/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  try {
    await db.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    await db.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [req.user.id, target]);
    await db.query('DELETE FROM post_notify WHERE (user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)', [req.user.id, target]);
    res.json({ ok: true, blocked: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/block/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [req.user.id, target]);
    res.json({ ok: true, blocked: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// List the accounts you've blocked (for Privacy settings).
app.get('/api/social/blocked', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar FROM blocks b
       JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY lower(u.name)`,
      [req.user.id]
    );
    res.json({ blocked: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load blocked accounts.' });
  }
});

/* ═══════════════════════════════════════════════
   MUTE  —  accounts + keywords (feed-only, silent)
═══════════════════════════════════════════════ */
// Mute an account: hide their posts from your feeds (no block, no unfollow).
app.post('/api/social/mute/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot mute yourself.' });
  try {
    const u = await db.query('SELECT 1 FROM users WHERE id = $1', [target]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    await db.query('INSERT INTO post_mutes (muter_id, muted_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    res.json({ ok: true, muted: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not mute.' }); }
});
app.delete('/api/social/mute/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM post_mutes WHERE muter_id = $1 AND muted_id = $2', [req.user.id, target]);
    res.json({ ok: true, muted: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unmute.' }); }
});
// List the accounts you've muted (Privacy settings).
app.get('/api/social/muted', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified FROM post_mutes m
       JOIN users u ON u.id = m.muted_id WHERE m.muter_id = $1 ORDER BY m.created_at DESC`,
      [req.user.id]);
    res.json({ muted: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load muted accounts.' }); }
});
// Muted keywords.
app.get('/api/social/muted-keywords', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, word FROM muted_keywords WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ keywords: rows.map((r) => ({ id: r.id, word: r.word })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load muted words.' }); }
});
app.post('/api/social/muted-keywords', auth.requireAuth, rateLimit(40, 60000, 'mute-word'), async (req, res) => {
  const word = (req.body.word || '').trim().slice(0, 60);
  if (!word) return res.status(400).json({ error: 'Enter a word or phrase to mute.' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM muted_keywords WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 100) return res.status(400).json({ error: 'You’ve reached the maximum number of muted words.' });
    const { rows } = await db.query(
      `INSERT INTO muted_keywords (user_id, word) VALUES ($1, $2)
       ON CONFLICT (user_id, lower(word)) DO NOTHING RETURNING id`, [req.user.id, word]);
    if (!rows[0]) { const ex = await db.query('SELECT id FROM muted_keywords WHERE user_id = $1 AND lower(word) = lower($2)', [req.user.id, word]); return res.json({ id: ex.rows[0] && ex.rows[0].id, word }); }
    res.status(201).json({ id: rows[0].id, word });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not mute that word.' }); }
});
app.delete('/api/social/muted-keywords/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM muted_keywords WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unmute.' }); }
});

/* ═══════════════════════════════════════════════
   PIN A POST  —  highlight one post on your profile
═══════════════════════════════════════════════ */
app.post('/api/social/posts/:id/pin', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const p = await db.query('SELECT user_id, parent_id FROM posts WHERE id = $1', [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
    if (p.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'You can only pin your own posts.' });
    if (p.rows[0].parent_id != null) return res.status(400).json({ error: 'Only top-level posts can be pinned.' });
    await db.query('UPDATE users SET pinned_post_id = $1 WHERE id = $2', [id, req.user.id]);
    res.json({ ok: true, pinned: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not pin the post.' }); }
});
app.delete('/api/social/posts/:id/pin', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    // Only clear if this post is the one currently pinned (idempotent otherwise).
    await db.query('UPDATE users SET pinned_post_id = NULL WHERE id = $1 AND pinned_post_id = $2', [req.user.id, id]);
    res.json({ ok: true, pinned: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unpin the post.' }); }
});

/* ═══════════════════════════════════════════════
   POST DRAFTS  —  server-saved unfinished posts
═══════════════════════════════════════════════ */
app.get('/api/social/drafts', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, body, updated_at FROM post_drafts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100', [req.user.id]);
    res.json({ drafts: rows.map((d) => ({ id: d.id, body: d.body || '', updatedAt: d.updated_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load drafts.' }); }
});
app.post('/api/social/drafts', auth.requireAuth, rateLimit(60, 60000, 'draft'), async (req, res) => {
  const body = (req.body.body || '').toString().slice(0, 2000);
  if (!body.trim()) return res.status(400).json({ error: 'Nothing to save.' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM post_drafts WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 50) return res.status(400).json({ error: 'You’ve reached the maximum number of drafts.' });
    const { rows } = await db.query('INSERT INTO post_drafts (user_id, body) VALUES ($1, $2) RETURNING id, updated_at', [req.user.id, body]);
    res.status(201).json({ id: rows[0].id, body, updatedAt: rows[0].updated_at });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the draft.' }); }
});
app.put('/api/social/drafts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const body = (req.body.body || '').toString().slice(0, 2000);
  try {
    const r = await db.query('UPDATE post_drafts SET body = $1, updated_at = now() WHERE id = $2 AND user_id = $3 RETURNING updated_at', [body, id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Draft not found.' });
    res.json({ ok: true, updatedAt: r.rows[0].updated_at });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the draft.' }); }
});
app.delete('/api/social/drafts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM post_drafts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete the draft.' }); }
});

/* ═══════════════════════════════════════════════
   THREAD  —  post a self-reply chain in one shot
═══════════════════════════════════════════════ */
app.post('/api/social/thread', auth.requireAuth, rateLimit(15, 60000, 'thread'), async (req, res) => {
  const segments = Array.isArray(req.body.posts) ? req.body.posts : [];
  if (segments.length < 2) return res.status(400).json({ error: 'A thread needs at least two posts.' });
  if (segments.length > 25) return res.status(400).json({ error: 'A thread can have at most 25 posts.' });
  // Pre-validate each segment: non-empty body or an image, within length.
  const prepared = [];
  for (const seg of segments) {
    const body = (seg && seg.body || '').toString().trim();
    if (body.length > 2000) return res.status(400).json({ error: 'One of the posts is too long (2000 chars max).' });
    const images = cleanImages(seg && seg.images);
    if (images === undefined) return res.status(400).json({ error: 'Those images could not be attached.' });
    const image = images.length ? images[0] : null;
    if (!body && !image) return res.status(400).json({ error: 'Every post in the thread needs text or an image.' });
    prepared.push({ body, image, images });
  }
  try {
    const me = await requireHandle(req, res); if (!me) return;
    const replyScope = ['everyone', 'following', 'mentioned'].includes(req.body.replyScope) ? req.body.replyScope : 'everyone';
    let parentId = null, rootId = null;
    for (let i = 0; i < prepared.length; i++) {
      const seg = prepared[i];
      // The root is a normal top-level post (to_main); the rest are self-replies
      // (parent_id chained), which keeps them off the main feed like X threads.
      const ins = await db.query(
        `INSERT INTO posts (user_id, body, image, images, parent_id, to_main, reply_scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.id, seg.body, seg.image, seg.images.length > 1 ? seg.images : null, parentId, i === 0, i === 0 ? replyScope : 'everyone']);
      const pid = ins.rows[0].id;
      if (i === 0) rootId = pid;
      for (const tag of extractHashtags(seg.body)) {
        await db.query('INSERT INTO post_hashtags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pid, tag]).catch(() => {});
      }
      parentId = pid;
    }
    // Bell subscribers: notify on the thread's root, like a normal post.
    try {
      const subs = await db.query('SELECT user_id FROM post_notify WHERE target_id = $1', [req.user.id]);
      for (const s of subs.rows) notify(s.user_id, req.user.id, 'post', rootId);
    } catch (e) { /* best-effort */ }
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, rootId]);
    res.status(201).json({ post: mapPost(rows[0]), count: prepared.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not post the thread.' }); }
});

/* ═══════════════════════════════════════════════
   CREATOR SUBSCRIPTIONS  —  recurring paid follow
═══════════════════════════════════════════════ */
const CREATOR_SUB_DAYS = 30;
// A user sets (or clears) their own monthly subscription price + blurb.
app.put('/api/creator/settings', auth.requireAuth, async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const priceCents = Math.min(Math.max(Math.round(Number(req.body.priceCents) || 0), 0), 50000);
  if (priceCents > 0 && priceCents < 100) return res.status(400).json({ error: 'The minimum subscription price is $1/month.' });
  const blurb = (req.body.blurb || '').toString().trim().slice(0, 200) || null;
  try {
    await db.query('UPDATE users SET sub_price_cents = $1, sub_blurb = $2 WHERE id = $3', [priceCents, blurb, req.user.id]);
    res.json({ ok: true, priceCents, blurb });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save your subscription settings.' }); }
});
// My own creator settings + subscriber count + monthly revenue estimate.
app.get('/api/creator/settings', auth.requireAuth, async (req, res) => {
  try {
    const u = (await db.query('SELECT sub_price_cents, sub_blurb FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const n = (await db.query("SELECT COUNT(*)::int AS n FROM creator_subs WHERE creator_id = $1 AND status = 'active' AND (period_end IS NULL OR period_end > now())", [req.user.id])).rows[0].n;
    res.json({ priceCents: u.sub_price_cents || 0, blurb: u.sub_blurb || null, subscribers: n, monthlyCents: (u.sub_price_cents || 0) * n });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load your settings.' }); }
});
// Subscribe to a creator (Stripe recurring Checkout, or demo-grant 30 days).
app.post('/api/creator/:id/subscribe', auth.requireAuth, async (req, res) => {
  const creatorId = routeId(req.params.id);
  if (!Number.isInteger(creatorId)) return res.status(400).json({ error: 'Invalid creator id.' });
  if (creatorId === req.user.id) return res.status(400).json({ error: 'You can’t subscribe to yourself.' });
  try {
    const c = (await db.query('SELECT id, name, username, sub_price_cents FROM users WHERE id = $1', [creatorId])).rows[0];
    if (!c || !c.username) return res.status(404).json({ error: 'Creator not found.' });
    if (!c.sub_price_cents || c.sub_price_cents <= 0) return res.status(400).json({ error: 'This person doesn’t offer subscriptions.' });
    if (await blockedEither(req.user.id, creatorId)) return res.status(403).json({ error: 'You can’t subscribe to this account.' });
    // Already active?
    const existing = await db.query("SELECT 1 FROM creator_subs WHERE subscriber_id = $1 AND creator_id = $2 AND status = 'active' AND (period_end IS NULL OR period_end > now())", [req.user.id, creatorId]);
    if (existing.rowCount) return res.json({ ok: true, subscribed: true });
    if (billing.isConfigured()) {
      const me = (await db.query('SELECT id, email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0];
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createRecurringSession(me, {
        amountCents: c.sub_price_cents,
        productName: 'Subscription to @' + c.username,
        metadata: { type: 'creator_sub', creator_id: String(creatorId) },
        successUrl: `${origin}/?creatorsub=success`, cancelUrl: `${origin}/?creatorsub=cancel`,
      });
      return res.json({ url: session.url });
    }
    // Demo: grant 30 days immediately.
    await recordCreatorSub(req.user.id, creatorId);
    res.json({ ok: true, subscribed: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not subscribe.' }); }
});
// Cancel — access remains until the current period ends (status flips to canceled).
app.delete('/api/creator/:id/subscribe', auth.requireAuth, async (req, res) => {
  const creatorId = routeId(req.params.id);
  if (!Number.isInteger(creatorId)) return res.status(400).json({ error: 'Invalid creator id.' });
  try {
    await db.query("UPDATE creator_subs SET status = 'canceled' WHERE subscriber_id = $1 AND creator_id = $2", [req.user.id, creatorId]);
    res.json({ ok: true, subscribed: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not cancel.' }); }
});
// Upsert an active subscription (shared by the demo path + the Stripe webhook).
async function recordCreatorSub(subscriberId, creatorId, days = CREATOR_SUB_DAYS) {
  await db.query(
    `INSERT INTO creator_subs (subscriber_id, creator_id, status, period_end)
     VALUES ($1, $2, 'active', now() + ($3 || ' days')::interval)
     ON CONFLICT (subscriber_id, creator_id) DO UPDATE SET status = 'active', period_end = now() + ($3 || ' days')::interval`,
    [subscriberId, creatorId, String(days)]
  );
  notify(creatorId, subscriberId, 'creator_sub', null);
}

// Translate a post's text into the reader's language (Atwe AI). Degrades to 503
// without a key; returns the same text when it's already in the target language.
app.post('/api/social/posts/:id/translate', auth.requireAuth, rateLimit(30, 60000, 'post-translate'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  const target = (req.body.to || 'English').toString().trim().slice(0, 40) || 'English';
  try {
    if (!(await requireHandle(req, res))) return;
    // Only translate a post the caller can actually read — apply the same
    // visibility gate as the single-post read so circle/feed/subscriber-only
    // post bodies can't leak via translation. (Visibility is checked BEFORE the
    // AI-availability gate so a non-entitled caller always gets a 404.)
    const pr = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    if (!pr.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
    const mapped = mapPost(pr.rows[0]);
    if (!mapped.mine) {
      if (mapped.locked) return res.status(404).json({ error: 'That post is no longer available.' });
      const vis = await db.query(
        `SELECT 1 FROM posts p WHERE p.id = $1 AND (
            (p.to_main = true AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = p.user_id AND b.blocked_id = $2) OR (b.blocker_id = $2 AND b.blocked_id = p.user_id)))
            OR EXISTS (SELECT 1 FROM post_circles pc JOIN circle_members cm ON cm.circle_id = pc.circle_id WHERE pc.post_id = p.id AND cm.user_id = $2)
            OR EXISTS (SELECT 1 FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id WHERE pf.post_id = p.id AND (f.open OR f.created_by = $2 OR EXISTS (SELECT 1 FROM feed_members fm WHERE fm.feed_id = f.id AND fm.user_id = $2))))`,
        [id, req.user.id]
      );
      if (!vis.rowCount) return res.status(404).json({ error: 'That post is no longer available.' });
    }
    const body = (mapped.body || '').toString();
    if (!body.trim()) return res.json({ translation: '', sameLanguage: true });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Translation is not available right now.' });
    const sys = 'You are Atwe AI, a translator. Translate the user\'s social-media post into ' + target + '. ' +
      'Preserve meaning, tone, @mentions, #hashtags, emoji and line breaks. If it is already in ' + target + ', return it unchanged. ' +
      'Reply with ONLY the translated text — no quotes, no notes, no preamble. Never mention "Claude" or "Anthropic".';
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: sys,
      messages: [{ role: 'user', content: body.slice(0, 4000) }],
    });
    const translation = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    if (!translation) return res.status(502).json({ error: 'Could not translate that post.' });
    res.json({ translation, sameLanguage: translation === body.trim() });
  } catch (err) { console.error(err); res.status(502).json({ error: 'Could not translate that post.' }); }
});

// Report a user (stored for the admin dashboard).
app.post('/api/social/report/:id', auth.requireAuth, rateLimit(20, 60000, 'report'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot report yourself.' });
  const reason = (req.body.reason || '').trim().slice(0, 500) || null;
  try {
    await db.query(
      `INSERT INTO reports (reporter_id, reported_id, target_type, target_id, reason)
       VALUES ($1, $2, 'user', $2, $3)
       ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING`,
      [req.user.id, target, reason]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Post-notification bell: subscribe / unsubscribe to a user's new posts.
app.post('/api/social/notify/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'Invalid.' });
  try {
    await db.query('INSERT INTO post_notify (user_id, target_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    res.json({ ok: true, notifying: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});
app.delete('/api/social/notify/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM post_notify WHERE user_id = $1 AND target_id = $2', [req.user.id, target]);
    res.json({ ok: true, notifying: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong.' }); }
});

// Contact privacy: who can call / video / DM you.
app.get('/api/social/privacy', auth.requireAuth, async (req, res) => {
  try {
    const u = await db.query('SELECT pc_everyone, pc_following, pc_followers, dm_connections_only FROM users WHERE id = $1', [req.user.id]);
    const allow = await db.query(
      `SELECT a.allowed_id AS id, u.name, u.username, u.avatar
       FROM contact_allow a JOIN users u ON u.id = a.allowed_id
       WHERE a.owner_id = $1 ORDER BY lower(u.name)`, [req.user.id]
    );
    const p = u.rows[0] || {};
    res.json({ everyone: p.pc_everyone !== false, following: !!p.pc_following, followers: !!p.pc_followers, connectionsOnly: !!p.dm_connections_only, allow: allow.rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load settings.' }); }
});
app.put('/api/social/privacy', auth.requireAuth, async (req, res) => {
  const everyone = !!req.body.everyone;
  const following = !!req.body.following;
  const followers = !!req.body.followers;
  const connectionsOnly = req.body.connectionsOnly === true;
  const usernames = (Array.isArray(req.body.usernames) ? req.body.usernames : [])
    .map((s) => String(s || '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean).slice(0, 300);
  try {
    await db.query('UPDATE users SET pc_everyone = $1, pc_following = $2, pc_followers = $3, dm_connections_only = $5 WHERE id = $4',
      [everyone, following, followers, req.user.id, connectionsOnly]);
    let ids = [];
    if (usernames.length) {
      const r = await db.query('SELECT id FROM users WHERE lower(username) = ANY($1) AND id <> $2', [usernames, req.user.id]);
      ids = r.rows.map((x) => x.id);
    }
    await db.query('DELETE FROM contact_allow WHERE owner_id = $1', [req.user.id]);
    for (const id of ids) {
      await db.query('INSERT INTO contact_allow (owner_id, allowed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, id]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save settings.' }); }
});

// Home feed. scope=following → your posts + people you follow; scope=foryou → everyone (recent).
app.get('/api/social/feed', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const following = req.query.scope === 'following';
    const notBlocked = ` AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)`;
    // Following scope also surfaces posts reposted by you or people you follow,
    // ordered by the more recent of the post time and that repost time.
    const repostBy = `EXISTS(SELECT 1 FROM post_reposts rp WHERE rp.post_id = p.id AND (rp.user_id = $1 OR rp.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)))`;
    const where = (following
      ? `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND (p.user_id = $1 OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1) OR ${repostBy})`
      : `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now()`) + notBlocked + MUTE_FILTER + SUBONLY_FEED_FILTER;
    // Following stays chronological (X-style). For You is engagement-weighted with
    // a recency decay: ~8h of age offsets one log-engagement point, so fresh +
    // engaged posts rise while old ones fall away. Tiebreak on recency.
    const orderBy = following
      ? ` ORDER BY GREATEST(p.created_at, COALESCE((SELECT MAX(rp.created_at) FROM post_reposts rp WHERE rp.post_id = p.id AND (rp.user_id = $1 OR rp.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1))), p.created_at)) DESC LIMIT 60`
      : ` ORDER BY (
           ln(1 + (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)
                 + 2 * (SELECT COUNT(*) FROM post_reposts rp2 WHERE rp2.post_id = p.id)
                 + (SELECT COUNT(*) FROM posts rr WHERE rr.parent_id = p.id)) * 3.0
           - EXTRACT(EPOCH FROM (now() - p.created_at)) / 28800.0
         ) DESC, p.created_at DESC LIMIT 60`;
    const { rows } = await db.query(
      POSTS_SELECT + where + orderBy,
      [req.user.id]
    );
    let posts = rows.map(mapPost);
    // For You only: surface up to 2 active promoted posts at the top (X-style),
    // skipping the viewer's own posts and any already in the feed.
    if (!following) {
      const promo = await db.query(
        POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now()
           AND p.promoted_until > now() AND p.user_id <> $1${notBlocked}${MUTE_FILTER}
         ORDER BY p.promoted_until DESC LIMIT 2`,
        [req.user.id]
      );
      const promoted = promo.rows.map(mapPost);
      const promotedIds = new Set(promoted.map((p) => p.id));
      // Hoist promoted posts to the top, removing any duplicate ranked copy.
      posts = promoted.concat(posts.filter((p) => !promotedIds.has(p.id)));
    }
    res.json({ posts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Feeds: short-form status posts (text / photo / small video) ─────────────
   Follower-gated. Text statuses expire after 24h; photos/videos are permanent.
   Distinct path (/api/feedposts) so it never collides with the legacy /api/feeds
   channel routes. */
const FEEDPOST_SELECT = `
  SELECT fp.id, fp.kind, fp.text, fp.bg, fp.media, fp.created_at, fp.expires_at,
         (fp.user_id = $1) AS mine,
         u.id AS author_id, u.name AS author_name, u.username AS author_username,
         u.avatar AS author_avatar, u.verified AS author_verified
  FROM feed_posts fp JOIN users u ON u.id = fp.user_id `;
function mapFeedPost(r) {
  return {
    id: r.id, kind: r.kind, text: r.text || null, bg: r.bg || null,
    media: r.media || null, created_at: r.created_at, expiresAt: r.expires_at || null,
    mine: !!r.mine,
    author: { id: r.author_id, name: r.author_name, username: r.author_username, avatar: r.author_avatar || null, verified: !!r.author_verified },
  };
}
const FEED_TEXT_MAX = 280;
const FEED_BG_RE = /^#[0-9a-fA-F]{6}$/;

// Create a feed post: text status (words on a colour), photo, or small video.
app.post('/api/feedposts', auth.requireAuth, rateLimit(30, 60000, 'feedpost'), async (req, res) => {
  try {
    const me = await requireHandle(req, res); if (!me) return;
    const kind = String(req.body.kind || '').trim();
    const text = (req.body.text || '').toString().slice(0, FEED_TEXT_MAX);
    const bg = (req.body.bg || '').toString();
    const media = req.body.media || null;
    let expiresAt = null;
    if (kind === 'text') {
      if (!text.trim()) return res.status(400).json({ error: 'Write something for your status.' });
      if (bg && !FEED_BG_RE.test(bg)) return res.status(400).json({ error: 'Invalid background colour.' });
      expiresAt = new Date(Date.now() + 24 * 3600 * 1000); // text statuses last 24h
    } else if (kind === 'photo' || kind === 'video') {
      const ok = kind === 'photo' ? /^data:image\//.test(media || '') : /^data:video\//.test(media || '');
      if (!ok) return res.status(400).json({ error: 'Please choose a ' + kind + ' to share.' });
    } else {
      return res.status(400).json({ error: 'Unsupported feed type.' });
    }
    const { rows } = await db.query(
      `INSERT INTO feed_posts (user_id, kind, text, bg, media, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, kind, text.trim() || null, kind === 'text' ? (bg || null) : null, kind === 'text' ? null : media, expiresAt]
    );
    const out = await db.query(FEEDPOST_SELECT + 'WHERE fp.id = $2', [req.user.id, rows[0].id]);
    res.json({ post: mapFeedPost(out.rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Timeline: active feed posts from people I follow (and my own), newest first.
app.get('/api/feedposts/timeline', auth.requireAuth, async (req, res) => {
  try {
    const me = await requireHandle(req, res); if (!me) return;
    const { rows } = await db.query(
      FEEDPOST_SELECT +
      ` WHERE (fp.expires_at IS NULL OR fp.expires_at > now())
          AND (fp.user_id = $1 OR fp.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1))
          AND fp.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
        ORDER BY fp.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ posts: rows.map(mapFeedPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// A specific member's active feed — must follow them (or be them); blocks deny.
app.get('/api/feedposts/u/:username', auth.requireAuth, async (req, res) => {
  try {
    const me = await requireHandle(req, res); if (!me) return;
    const uname = String(req.params.username || '').replace(/^@/, '').toLowerCase();
    const u = await db.query('SELECT id FROM users WHERE lower(username) = $1', [uname]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Account not found.' });
    const targetId = u.rows[0].id;
    if (targetId !== req.user.id) {
      const b = await db.query('SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)', [req.user.id, targetId]);
      if (b.rowCount) return res.status(403).json({ error: 'You can’t view this feed.' });
      const f = await db.query('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [req.user.id, targetId]);
      if (!f.rowCount) return res.status(403).json({ error: 'Follow this account to see their feed.' });
    }
    const { rows } = await db.query(
      FEEDPOST_SELECT + ` WHERE fp.user_id = $2 AND (fp.expires_at IS NULL OR fp.expires_at > now()) ORDER BY fp.created_at DESC LIMIT 100`,
      [req.user.id, targetId]
    );
    res.json({ posts: rows.map(mapFeedPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Delete my own feed post.
app.delete('/api/feedposts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM feed_posts WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Read a single post with its replies (oldest first, X-style thread).
app.get('/api/social/posts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const post = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    if (!post.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    // Visibility: a post you didn't write is readable only if it's public (to_main,
    // and the author hasn't blocked you / you them), OR you're a member of a circle
    // it was posted to, OR you can view a feed it was posted to. Otherwise a
    // circle/feed-only post would leak to anyone who guesses its id. 404 (not 403)
    // so we don't even confirm the post exists.
    if (!post.rows[0].mine) {
      const vis = await db.query(
        `SELECT 1 FROM posts p WHERE p.id = $1 AND (
            (p.to_main = true AND NOT EXISTS (
               SELECT 1 FROM blocks b WHERE (b.blocker_id = p.user_id AND b.blocked_id = $2)
                                          OR (b.blocker_id = $2 AND b.blocked_id = p.user_id)))
            OR EXISTS (SELECT 1 FROM post_circles pc JOIN circle_members cm ON cm.circle_id = pc.circle_id
                       WHERE pc.post_id = p.id AND cm.user_id = $2)
            OR EXISTS (SELECT 1 FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id
                       WHERE pf.post_id = p.id AND (f.open OR f.created_by = $2
                             OR EXISTS (SELECT 1 FROM feed_members fm WHERE fm.feed_id = f.id AND fm.user_id = $2))))`,
        [id, req.user.id]
      );
      if (!vis.rowCount) return res.status(404).json({ error: 'Post not found.' });
    }
    const replies = await db.query(
      POSTS_SELECT + 'WHERE p.parent_id = $2 ORDER BY p.created_at ASC LIMIT 200',
      [req.user.id, id]
    );
    const mapped = mapPost(post.rows[0]);
    // Whether this viewer is allowed to reply (gates the reply box client-side;
    // the create-post route enforces it authoritatively).
    mapped.canReply = await canReplyTo(mapped.author.id, mapped.replyScope, mapped.body, req.user.id);
    res.json({ post: mapped, replies: replies.rows.map(mapPost) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Create a post — or a reply when `parentId` is given.
app.post('/api/social/posts', auth.requireAuth, rateLimit(40, 60000, 'post'), async (req, res) => {
  const body = (req.body.body || '').trim();
  // Multiple images (carousel) or a single one (back-compat). `image` stays the
  // first image for list previews / older clients.
  const images = cleanImages(req.body.images);
  if (images === undefined) return res.status(400).json({ error: 'Those images could not be attached.' });
  let image = images.length ? images[0] : cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That video could not be attached (unsupported type or too large — 16 MB max).' });
  if (media.data && media.kind !== 'video') return res.status(400).json({ error: 'Only photos and videos can be posted.' });
  // Poll options (2–4) — top-level posts only.
  const pollOpts = (Array.isArray(req.body.poll) ? req.body.poll : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
  const hasPoll = pollOpts.length >= 2 && (req.body.parentId == null || req.body.parentId === '');
  if (!body && !image && !media.data && !hasPoll && (req.body.quoteId == null || req.body.quoteId === '')) return res.status(400).json({ error: 'Your post is empty.' });
  if (body.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 chars max).' });
  let parentId = null;
  if (req.body.parentId != null && req.body.parentId !== '') {
    parentId = parseInt(req.body.parentId, 10);
    if (!Number.isInteger(parentId)) return res.status(400).json({ error: 'Invalid post.' });
  }
  // Quote post (top-level only): embeds another post by id.
  let quoteId = null;
  if (req.body.quoteId != null && req.body.quoteId !== '' && parentId == null) {
    quoteId = parseInt(req.body.quoteId, 10);
    if (!Number.isInteger(quoteId)) return res.status(400).json({ error: 'Invalid quoted post.' });
  }
  // Circle targeting (top-level posts only): which circles to share into, and
  // whether the post also appears in the main feed.
  const circleIds = [...new Set((Array.isArray(req.body.circleIds) ? req.body.circleIds : [])
    .map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  // Feed targeting (top-level posts only): a broadcast post into a single feed
  // the requester admins. Feed posts never hit the main feed.
  let feedId = null;
  if (req.body.feedId != null && req.body.feedId !== '') {
    feedId = parseInt(req.body.feedId, 10);
    if (!Number.isInteger(feedId)) return res.status(400).json({ error: 'Invalid feed.' });
  }
  // Default: a normal post goes to the main feed. A circle-only post sets toMain false.
  let toMain = req.body.toMain === undefined ? true : !!req.body.toMain;
  if (!circleIds.length) toMain = true; // a post with no circles must live somewhere
  if (feedId != null) toMain = false; // feed broadcasts stay inside the feed
  try {
    if (!(await requireHandle(req, res))) return;
    let parentOwner = null;
    if (parentId != null) {
      const parent = await db.query('SELECT user_id, reply_scope, body FROM posts WHERE id = $1', [parentId]);
      if (!parent.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
      parentOwner = parent.rows[0].user_id;
      // Can't reply to someone who has blocked you (or whom you've blocked).
      if (parentOwner !== req.user.id && await blockedEither(req.user.id, parentOwner)) {
        return res.status(403).json({ error: 'You can’t reply to this post.' });
      }
      // Honour the author's reply controls.
      if (!(await canReplyTo(parentOwner, parent.rows[0].reply_scope, parent.rows[0].body, req.user.id))) {
        return res.status(403).json({ error: 'The author limited who can reply to this post.' });
      }
    }
    // Reply controls on a new top-level post.
    let replyScope = 'everyone';
    if (parentId == null && ['everyone', 'following', 'mentioned'].includes(req.body.replyScope)) replyScope = req.body.replyScope;
    // Only allow sharing into circles the author actually belongs to.
    let validCircles = [];
    if (circleIds.length && parentId == null) {
      const cm = await db.query(
        'SELECT circle_id FROM circle_members WHERE user_id = $1 AND circle_id = ANY($2)',
        [req.user.id, circleIds]
      );
      validCircles = cm.rows.map((r) => r.circle_id);
      if (!validCircles.length && !toMain) toMain = true; // none valid → keep it in the feed
    }
    // Only the feed's admin may broadcast into it.
    if (feedId != null && parentId == null) {
      const fa = await db.query('SELECT created_by FROM feeds WHERE id = $1', [feedId]);
      if (!fa.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
      if (fa.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can post here.' });
    } else {
      feedId = null;
    }
    const location = (req.body.location || '').trim().slice(0, 120) || null;
    // Scheduling (top-level posts only): created_at becomes the publish time.
    let scheduledAt = null;
    if (parentId == null && req.body.scheduledAt) {
      const d = new Date(req.body.scheduledAt);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now() + 30000) scheduledAt = d.toISOString();
    }
    // Validate the quoted post exists (best-effort) before linking it.
    let quoteOwner = null;
    if (quoteId != null) {
      const qp = await db.query('SELECT user_id FROM posts WHERE id = $1 AND parent_id IS NULL', [quoteId]);
      if (!qp.rows[0]) { quoteId = null; } else { quoteOwner = qp.rows[0].user_id; }
    }
    // Subscriber-only is for top-level main-feed posts (not replies/circle/feed).
    const subscribersOnly = req.body.subscribersOnly === true && parentId == null && feedId == null && (!validCircles.length || toMain);
    const imageAlt = (image || (images && images.length)) ? ((req.body.imageAlt || '').toString().trim().slice(0, 1000) || null) : null;
    const ins = await db.query(
      `INSERT INTO posts (user_id, body, image, images, media, media_kind, parent_id, to_main, location, created_at, scheduled_at, quote_id, reply_scope, subscribers_only, image_alt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()), $10, $11, $12, $13, $14) RETURNING id`,
      [req.user.id, body, image, images.length > 1 ? images : null, media.data, media.kind, parentId, toMain, location, scheduledAt, quoteId, replyScope, subscribersOnly, imageAlt]
    );
    const postId = ins.rows[0].id;
    if (quoteOwner != null) notify(quoteOwner, req.user.id, 'quote', postId);
    // Index hashtags for tag pages + trending.
    for (const tag of extractHashtags(body)) {
      await db.query('INSERT INTO post_hashtags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, tag]).catch(() => {});
    }
    for (const cid of validCircles) {
      await db.query('INSERT INTO post_circles (post_id, circle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, cid]);
    }
    if (feedId != null) {
      await db.query('INSERT INTO post_feeds (post_id, feed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, feedId]);
    }
    if (hasPoll) {
      for (let i = 0; i < pollOpts.length; i++) {
        await db.query('INSERT INTO post_poll_options (post_id, position, text) VALUES ($1, $2, $3)', [postId, i, pollOpts[i].slice(0, 80)]);
      }
    }
    if (parentId != null && parentOwner != null) notify(parentOwner, req.user.id, 'reply', parentId);
    // Bell subscribers: notify on a new top-level post that's live now.
    if (parentId == null && !scheduledAt) {
      try {
        const subs = await db.query('SELECT user_id FROM post_notify WHERE target_id = $1', [req.user.id]);
        for (const s of subs.rows) notify(s.user_id, req.user.id, 'post', postId);
      } catch (e) { /* best-effort */ }
      // Feed broadcast: notify every member (except the admin).
      if (feedId != null) {
        try {
          const mem = await db.query('SELECT user_id FROM feed_members WHERE feed_id = $1 AND user_id <> $2', [feedId, req.user.id]);
          for (const m of mem.rows) notify(m.user_id, req.user.id, 'post', postId);
        } catch (e) { /* best-effort */ }
      }
    }
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, postId]);
    res.json({ post: mapPost(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a post's text (X-style). Author-only, and only within a short window
// after publishing. Re-indexes hashtags; stamps edited_at so the UI can show
// an "Edited" label. Media / poll / targeting are not changed by an edit.
const POST_EDIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
app.patch('/api/social/posts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  const body = (req.body.body || '').trim();
  if (body.length > 2000) return res.status(400).json({ error: 'Post is too long (2000 chars max).' });
  try {
    const cur = await db.query('SELECT user_id, image, media, created_at, scheduled_at FROM posts WHERE id = $1', [id]);
    const p = cur.rows[0];
    if (!p) return res.status(404).json({ error: 'That post is no longer available.' });
    if (p.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own posts.' });
    // A post can't be emptied — it must keep some text or media.
    if (!body && !p.image && !p.media) return res.status(400).json({ error: 'Your post can’t be empty.' });
    // Edit window starts at publish time (created_at; for a scheduled post that's
    // the publish time too). Past the window, editing is locked.
    if (Date.now() - new Date(p.created_at).getTime() > POST_EDIT_WINDOW_MS) {
      return res.status(403).json({ error: 'The edit window for this post has passed.' });
    }
    await db.query('UPDATE posts SET body = $1, edited_at = now() WHERE id = $2', [body, id]);
    // Re-index hashtags: drop the old set, insert the current one.
    await db.query('DELETE FROM post_hashtags WHERE post_id = $1', [id]).catch(() => {});
    for (const tag of extractHashtags(body)) {
      await db.query('INSERT INTO post_hashtags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, tag]).catch(() => {});
    }
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    res.json({ post: mapPost(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Delete a post — by its author, or by an admin of a circle it's posted in.
app.delete('/api/social/posts/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const r = await db.query('DELETE FROM posts WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (r.rowCount) return res.json({ ok: true });
    // Not the author — allow if the requester admins a circle this post is in.
    const mod = await db.query(
      `SELECT 1 FROM post_circles pc JOIN circles c ON c.id = pc.circle_id
       WHERE pc.post_id = $1 AND c.created_by = $2
       UNION ALL
       SELECT 1 FROM post_feeds pf JOIN feeds f ON f.id = pf.feed_id
       WHERE pf.post_id = $1 AND f.created_by = $2 LIMIT 1`,
      [id, req.user.id]
    );
    if (mod.rows.length) {
      await db.query('DELETE FROM posts WHERE id = $1', [id]);
      return res.json({ ok: true });
    }
    res.json({ ok: true }); // nothing deleted (not owner / not admin) — idempotent
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Like / unlike a post.
app.post('/api/social/posts/:id/like', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const owner = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (!owner.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    const ownerId = owner.rows[0].user_id;
    // Can't like the post of someone who has blocked you (or whom you've blocked).
    if (ownerId !== req.user.id && await blockedEither(req.user.id, ownerId)) {
      return res.status(403).json({ error: 'You can’t like this post.' });
    }
    const r = await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS likes FROM post_likes WHERE post_id = $1', [id]);
    if (r.rowCount) notify(ownerId, req.user.id, 'like', id); // newly liked — notify the author
    res.json({ ok: true, liked: true, likes: c.rows[0].likes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/social/posts/:id/like', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS likes FROM post_likes WHERE post_id = $1', [id]);
    res.json({ ok: true, liked: false, likes: c.rows[0].likes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Repost / un-repost (X-style) — re-shares the post to your followers' feeds.
app.post('/api/social/posts/:id/repost', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const owner = await db.query('SELECT user_id FROM posts WHERE id = $1 AND parent_id IS NULL', [id]);
    if (!owner.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    const ownerId = owner.rows[0].user_id;
    if (ownerId !== req.user.id && await blockedEither(req.user.id, ownerId)) return res.status(403).json({ error: 'You can’t repost this.' });
    const r = await db.query('INSERT INTO post_reposts (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING post_id', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS reposts FROM post_reposts WHERE post_id = $1', [id]);
    if (r.rowCount) notify(ownerId, req.user.id, 'repost', id);
    res.json({ ok: true, reposted: true, reposts: c.rows[0].reposts });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.delete('/api/social/posts/:id/repost', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM post_reposts WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    const c = await db.query('SELECT COUNT(*)::int AS reposts FROM post_reposts WHERE post_id = $1', [id]);
    res.json({ ok: true, reposted: false, reposts: c.rows[0].reposts });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Record a post view (deduped per viewer per day; the author's own views don't
// count). Best-effort, never blocks.
app.post('/api/social/posts/:id/view', auth.requireAuth, rateLimit(200, 60000, 'post-view'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const o = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (o.rows[0] && o.rows[0].user_id !== req.user.id) {
      await db.query(
        `INSERT INTO post_views (post_id, viewer_id) SELECT $1, $2
         WHERE NOT EXISTS (SELECT 1 FROM post_views WHERE post_id = $1 AND viewer_id = $2 AND viewed_at::date = now()::date)`,
        [id, req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.json({ ok: true }); }
});
// Bookmark / un-bookmark a post (private — no count, never shown to others).
async function ownsBookmarkFolder(id, uid) {
  const r = await db.query('SELECT 1 FROM bookmark_folders WHERE id = $1 AND user_id = $2', [id, uid]);
  return !!r.rows[0];
}
app.post('/api/social/posts/:id/bookmark', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const exists = await db.query('SELECT 1 FROM posts WHERE id = $1', [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    // Optional: file the bookmark straight into one of my folders.
    let folderId = null;
    if (req.body.folderId != null && req.body.folderId !== '') {
      folderId = parseInt(req.body.folderId, 10);
      if (!Number.isInteger(folderId) || !(await ownsBookmarkFolder(folderId, req.user.id))) folderId = null;
    }
    await db.query('INSERT INTO post_bookmarks (post_id, user_id, folder_id) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO UPDATE SET folder_id = $3', [id, req.user.id, folderId]);
    res.json({ ok: true, bookmarked: true, folderId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
/* ─── Bookmark folders ─── */
const BMK_FOLDER_CAP = 30;
app.get('/api/social/bookmark-folders', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.id, f.name, (SELECT COUNT(*)::int FROM post_bookmarks b WHERE b.folder_id = f.id AND b.user_id = $1) AS count
       FROM bookmark_folders f WHERE f.user_id = $1 ORDER BY f.created_at ASC`,
      [req.user.id]
    );
    const unsorted = await db.query('SELECT COUNT(*)::int AS n FROM post_bookmarks WHERE user_id = $1 AND folder_id IS NULL', [req.user.id]);
    res.json({ folders: rows.map((f) => ({ id: f.id, name: f.name, count: f.count })), unsorted: unsorted.rows[0].n });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load folders.' }); }
});
app.post('/api/social/bookmark-folders', auth.requireAuth, rateLimit(30, 60000, 'bmk-folder'), async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Name your folder.' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM bookmark_folders WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= BMK_FOLDER_CAP) return res.status(400).json({ error: `You can create up to ${BMK_FOLDER_CAP} folders.` });
    const ins = await db.query('INSERT INTO bookmark_folders (user_id, name) VALUES ($1,$2) RETURNING id, name', [req.user.id, name]);
    res.json({ folder: { id: ins.rows[0].id, name: ins.rows[0].name, count: 0 } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the folder.' }); }
});
app.patch('/api/social/bookmark-folders/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const name = (req.body.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'Name your folder.' });
  try {
    const r = await db.query('UPDATE bookmark_folders SET name = $1 WHERE id = $2 AND user_id = $3', [name, id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not rename.' }); }
});
app.delete('/api/social/bookmark-folders/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM bookmark_folders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true }); // FK ON DELETE SET NULL leaves the bookmarks as unsorted
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});
// Move a saved bookmark into a folder (or out, with folderId null).
app.put('/api/social/bookmarks/:postId/folder', auth.requireAuth, async (req, res) => {
  const postId = routeId(req.params.postId);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    let folderId = null;
    if (req.body.folderId != null && req.body.folderId !== '') {
      folderId = parseInt(req.body.folderId, 10);
      if (!Number.isInteger(folderId) || !(await ownsBookmarkFolder(folderId, req.user.id))) return res.status(404).json({ error: 'Folder not found.' });
    }
    const r = await db.query('UPDATE post_bookmarks SET folder_id = $1 WHERE post_id = $2 AND user_id = $3', [folderId, postId, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'That post isn’t bookmarked.' });
    res.json({ ok: true, folderId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not move the bookmark.' }); }
});
app.delete('/api/social/posts/:id/bookmark', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM post_bookmarks WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true, bookmarked: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// My bookmarks (newest saved first). Optional ?folder=:id (or ?folder=unsorted).
app.get('/api/social/bookmarks', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const params = [req.user.id];
    let folderClause = '';
    if (req.query.folder === 'unsorted') folderClause = ' AND bk.folder_id IS NULL';
    else if (req.query.folder != null && req.query.folder !== '') {
      const fid = parseInt(req.query.folder, 10);
      if (Number.isInteger(fid)) { params.push(fid); folderClause = ` AND bk.folder_id = $${params.length}`; }
    }
    const { rows } = await db.query(
      POSTS_SELECT + `JOIN post_bookmarks bk ON bk.post_id = p.id AND bk.user_id = $1
       WHERE p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)${folderClause}
       ORDER BY bk.created_at DESC LIMIT 100`,
      params
    );
    res.json({ posts: rows.map(mapPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// Per-post analytics for the author: reach + engagement + a 14-day views trend.
app.get('/api/social/posts/:id/analytics', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const p = await db.query('SELECT user_id, created_at FROM posts WHERE id = $1', [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
    if (p.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Only the author can see post analytics.' });
    const [views, uniq, likes, reposts, replies, bookmarks, byday] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM post_views WHERE post_id = $1', [id]),
      db.query('SELECT COUNT(DISTINCT viewer_id)::int AS n FROM post_views WHERE post_id = $1', [id]),
      db.query('SELECT COUNT(*)::int AS n FROM post_likes WHERE post_id = $1', [id]),
      db.query('SELECT COUNT(*)::int AS n FROM post_reposts WHERE post_id = $1', [id]),
      db.query('SELECT COUNT(*)::int AS n FROM posts WHERE parent_id = $1', [id]),
      db.query('SELECT COUNT(*)::int AS n FROM post_bookmarks WHERE post_id = $1', [id]),
      db.query(`SELECT viewed_at::date AS day, COUNT(*)::int AS n FROM post_views WHERE post_id = $1 AND viewed_at > now() - interval '14 days' GROUP BY day`, [id]),
    ]);
    const vmap = {}; byday.rows.forEach((r) => { vmap[new Date(r.day).toISOString().slice(0, 10)] = r.n; });
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.push({ day: d, views: vmap[d] || 0 }); }
    const v = views.rows[0].n || 0;
    const engagements = (likes.rows[0].n || 0) + (reposts.rows[0].n || 0) + (replies.rows[0].n || 0) + (bookmarks.rows[0].n || 0);
    res.json({
      views: v, uniqueViewers: uniq.rows[0].n || 0,
      likes: likes.rows[0].n || 0, reposts: reposts.rows[0].n || 0, replies: replies.rows[0].n || 0, bookmarks: bookmarks.rows[0].n || 0,
      engagements, engagementRate: v ? Math.round((engagements / v) * 1000) / 10 : null,
      postedAt: p.rows[0].created_at, days,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load analytics.' }); }
});

/* ─── Promoted posts (paid reach) ─── */
const PROMOTE_DAYS = 7;
app.post('/api/social/posts/:id/promote', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const p = await db.query('SELECT user_id, parent_id, to_main FROM posts WHERE id = $1', [id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
    if (p.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'You can only promote your own posts.' });
    if (p.rows[0].parent_id != null || p.rows[0].to_main === false) return res.status(400).json({ error: 'Only your main-feed posts can be promoted.' });
    // Real payment when configured; otherwise the demo instant-promote.
    if (billing.isPromoteConfigured()) {
      const u = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPromoteSession(
        { id: req.user.id, email: u.email, stripe_customer_id: u.stripe_customer_id }, id, PROMOTE_DAYS,
        { successUrl: `${origin}/?promote=success`, cancelUrl: `${origin}/?promote=cancel` }
      );
      return res.json({ ok: true, url: session.url });
    }
    const r = await db.query(`UPDATE posts SET promoted_until = now() + ($2 * interval '1 day') WHERE id = $1 RETURNING promoted_until`, [id, PROMOTE_DAYS]);
    res.json({ ok: true, promoted: true, promotedUntil: r.rows[0].promoted_until, days: PROMOTE_DAYS });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not promote the post.' }); }
});
// Trending hashtags — top tags across recent public top-level posts (last 7 days).
app.get('/api/social/trending', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT h.tag, COUNT(DISTINCT h.post_id)::int AS count
       FROM post_hashtags h JOIN posts p ON p.id = h.post_id
       WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at > now() - interval '7 days'
         AND p.created_at <= now() AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
       GROUP BY h.tag ORDER BY count DESC, h.tag LIMIT 12`,
      [req.user.id]
    );
    res.json({ trends: rows.map((r) => ({ tag: r.tag, count: r.count })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// Posts for a hashtag (newest first).
app.get('/api/social/hashtag/:tag', auth.requireAuth, async (req, res) => {
  const tag = String(req.params.tag || '').replace(/^#/, '').toLowerCase().slice(0, 50);
  if (!tag) return res.status(400).json({ error: 'Invalid tag.' });
  try {
    const { rows } = await db.query(
      POSTS_SELECT + `JOIN post_hashtags h ON h.post_id = p.id AND h.tag = $2
       WHERE p.to_main = true AND p.created_at <= now()
         AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
       ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, tag]
    );
    const following = (await db.query('SELECT 1 FROM hashtag_follows WHERE user_id = $1 AND tag = $2', [req.user.id, tag])).rowCount > 0;
    res.json({ tag, following, posts: rows.map(mapPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// Follow / unfollow a hashtag.
app.post('/api/social/hashtag/:tag/follow', auth.requireAuth, async (req, res) => {
  const tag = String(req.params.tag || '').trim().replace(/^#/, '').toLowerCase().slice(0, 50);
  if (!tag || !/^[\p{L}\p{N}_]+$/u.test(tag)) return res.status(400).json({ error: 'Invalid tag.' });
  try {
    await db.query('INSERT INTO hashtag_follows (user_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, tag]);
    res.json({ ok: true, following: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not follow the tag.' }); }
});
app.delete('/api/social/hashtag/:tag/follow', auth.requireAuth, async (req, res) => {
  const tag = String(req.params.tag || '').replace(/^#/, '').toLowerCase().slice(0, 50);
  try {
    await db.query('DELETE FROM hashtag_follows WHERE user_id = $1 AND tag = $2', [req.user.id, tag]);
    res.json({ ok: true, following: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unfollow the tag.' }); }
});
// The hashtags I follow (with a recent-post count), newest follow first.
app.get('/api/social/followed-hashtags', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.tag, (SELECT COUNT(*)::int FROM post_hashtags h JOIN posts p ON p.id = h.post_id
                       WHERE h.tag = f.tag AND p.to_main = true AND p.created_at > now() - interval '7 days') AS recent
       FROM hashtag_follows f WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json({ hashtags: rows.map((r) => ({ tag: r.tag, recent: r.recent })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load followed hashtags.' }); }
});

/* ─── Lists (X-style curated timelines) ─── */
// My lists (with member counts).
app.get('/api/social/lists', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT l.id, l.name, l.created_at, (SELECT COUNT(*)::int FROM list_members m WHERE m.list_id = l.id) AS members
       FROM lists l WHERE l.owner_id = $1 ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json({ lists: rows.map((l) => ({ id: l.id, name: l.name, members: l.members, created_at: l.created_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.post('/api/social/lists', auth.requireAuth, rateLimit(30, 60000, 'list-create'), async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Give your list a name.' });
  try {
    const { rows } = await db.query('INSERT INTO lists (owner_id, name) VALUES ($1, $2) RETURNING id, name, created_at', [req.user.id, name]);
    res.status(201).json({ list: { id: rows[0].id, name: rows[0].name, members: 0, created_at: rows[0].created_at } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the list.' }); }
});
async function ownsList(listId, userId) { const r = await db.query('SELECT 1 FROM lists WHERE id = $1 AND owner_id = $2', [listId, userId]); return !!r.rows[0]; }
app.patch('/api/social/lists/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id); const name = (req.body.name || '').trim().slice(0, 60);
  if (!Number.isInteger(id) || !name) return res.status(400).json({ error: 'Invalid request.' });
  try {
    const r = await db.query('UPDATE lists SET name = $1 WHERE id = $2 AND owner_id = $3', [name, id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'List not found.' });
    res.json({ ok: true, name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not rename.' }); }
});
app.delete('/api/social/lists/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid list.' });
  try { await db.query('DELETE FROM lists WHERE id = $1 AND owner_id = $2', [id, req.user.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});
// List detail + members.
app.get('/api/social/lists/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid list.' });
  try {
    const l = await db.query('SELECT id, name FROM lists WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (!l.rows[0]) return res.status(404).json({ error: 'List not found.' });
    const m = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified, u.headline FROM list_members lm JOIN users u ON u.id = lm.user_id
       WHERE lm.list_id = $1 AND u.username IS NOT NULL ORDER BY lower(u.name) LIMIT 500`,
      [id]
    );
    res.json({ list: { id: l.rows[0].id, name: l.rows[0].name }, members: m.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || null })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.post('/api/social/lists/:id/members', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id), uid = parseInt(req.body.uid, 10);
  if (!Number.isInteger(id) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    if (!(await ownsList(id, req.user.id))) return res.status(404).json({ error: 'List not found.' });
    const u = await db.query('SELECT 1 FROM users WHERE id = $1 AND username IS NOT NULL', [uid]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    await db.query('INSERT INTO list_members (list_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, uid]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add.' }); }
});
app.delete('/api/social/lists/:id/members/:uid', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id), uid = routeId(req.params.uid);
  if (!Number.isInteger(id) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    if (!(await ownsList(id, req.user.id))) return res.status(404).json({ error: 'List not found.' });
    await db.query('DELETE FROM list_members WHERE list_id = $1 AND user_id = $2', [id, uid]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});
// A list's timeline — posts from its members (chronological).
app.get('/api/social/lists/:id/timeline', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid list.' });
  try {
    if (!(await ownsList(id, req.user.id))) return res.status(404).json({ error: 'List not found.' });
    const { rows } = await db.query(
      POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now()
         AND p.user_id IN (SELECT user_id FROM list_members WHERE list_id = $2)
         AND p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
       ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, id]
    );
    res.json({ posts: rows.map(mapPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});

// Vote on a poll (one vote per user, can't be changed).
app.post('/api/social/posts/:id/vote', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  const optionId = parseInt(req.body.optionId, 10);
  if (!Number.isInteger(id) || !Number.isInteger(optionId)) return res.status(400).json({ error: 'Invalid vote.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const o = await db.query('SELECT 1 FROM post_poll_options WHERE id = $1 AND post_id = $2', [optionId, id]);
    if (!o.rows[0]) return res.status(404).json({ error: 'That poll is no longer available.' });
    await db.query('INSERT INTO post_poll_votes (post_id, user_id, option_id) VALUES ($1, $2, $3) ON CONFLICT (post_id, user_id) DO NOTHING', [id, req.user.id, optionId]);
    const { rows } = await db.query(POSTS_SELECT + 'WHERE p.id = $2', [req.user.id, id]);
    res.json({ post: mapPost(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CIRCLES  —  industry / community feeds (circle@username)
   Anyone can create or join; the creator is the admin.
═══════════════════════════════════════════════ */
const CIRCLE_USERNAME_RE = /^[a-zA-Z0-9._-]+$/;
function cleanCircleUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the circle.' };
  if (username.length > 40) return { error: 'Circle username is too long.' };
  if (!CIRCLE_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}
async function isCircleMember(circleId, userId) {
  const { rows } = await db.query('SELECT 1 FROM circle_members WHERE circle_id = $1 AND user_id = $2', [circleId, userId]);
  return rows.length > 0;
}

// Create a circle (creator becomes admin + first member).
app.post('/api/circles', auth.requireAuth, rateLimit(20, 60000, 'circle-create'), async (req, res) => {
  const u = cleanCircleUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Circle name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    if (!(await requireHandle(req, res))) return;
    let c;
    try {
      c = await db.query(
        'INSERT INTO circles (username, name, bio, avatar, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [u.username, name, bio || null, avatar, req.user.id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That circle username is already taken.' });
      throw e;
    }
    const cid = c.rows[0].id;
    await db.query('INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cid, req.user.id]);
    res.json({ circle: { id: cid, username: u.username, name, bio: bio || null, avatar: avatar || null, members: 1, isMember: true, isAdmin: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Directory: circles I'm in first, then others to discover.
app.get('/api/circles', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by, c.official,
              (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
              EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member
       FROM circles c
       ORDER BY is_member DESC, c.official DESC, members DESC, c.name ASC
       LIMIT 200`,
      [req.user.id]
    );
    res.json({
      circles: rows.map((c) => ({
        id: c.id, username: c.username, name: c.name, bio: c.bio || null, avatar: c.avatar || null,
        members: c.members, isMember: c.is_member, isAdmin: c.created_by === req.user.id, official: !!c.official,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// The circles I belong to (for the post-composer checklist).
app.get('/api/circles/mine', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.username, c.name, c.avatar FROM circle_members m
       JOIN circles c ON c.id = m.circle_id WHERE m.user_id = $1 ORDER BY c.name`,
      [req.user.id]
    );
    res.json({ circles: rows.map((c) => ({ id: c.id, username: c.username, name: c.name, avatar: c.avatar || null })) });
  } catch (err) {
    console.error(err);
    res.json({ circles: [] });
  }
});

// A circle's profile + its feed.
// Resolve a circle @username → its id (for shareable /circle/<username> links).
app.get('/api/circles/by-username/:username', auth.requireAuth, async (req, res) => {
  const u = (req.params.username || '').replace(/^@/, '').toLowerCase();
  if (!u) return res.status(400).json({ error: 'Invalid circle.' });
  try {
    const r = await db.query('SELECT id FROM circles WHERE lower(username) = $1', [u]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    res.json({ id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/circles/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const c = await db.query(
      `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by, c.official,
              (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
              EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM circle_delete_requests r WHERE r.circle_id = c.id) AS delete_pending
       FROM circles c WHERE c.id = $2`,
      [req.user.id, cid]
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    const posts = await db.query(
      POSTS_SELECT + `JOIN post_circles pc ON pc.post_id = p.id
       WHERE pc.circle_id = $2 AND p.parent_id IS NULL AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, cid]
    );
    const t = c.rows[0];
    res.json({
      circle: {
        id: t.id, username: t.username, name: t.name, bio: t.bio || null, avatar: t.avatar || null,
        members: t.members, isMember: t.is_member, isAdmin: t.created_by === req.user.id,
        official: !!t.official, deletePending: !!t.delete_pending,
      },
      posts: posts.rows.map(mapPost),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Join / leave a circle.
app.post('/api/circles/:id/join', auth.requireAuth, rateLimit(60, 60000, 'circle-join'), async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const c = await db.query('SELECT id FROM circles WHERE id = $1', [cid]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    await db.query('INSERT INTO circle_members (circle_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [cid, req.user.id]);
    res.json({ ok: true, isMember: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/circles/:id/join', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  try {
    await db.query('DELETE FROM circle_members WHERE circle_id = $1 AND user_id = $2', [cid, req.user.id]);
    res.json({ ok: true, isMember: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a circle (admin only): name, @username, bio, avatar.
app.patch('/api/circles/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  const u = cleanCircleUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Circle name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const c = await db.query('SELECT created_by FROM circles WHERE id = $1', [cid]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    if (c.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the circle admin can edit this circle.' });
    const fields = ['name = $1', 'username = $2', 'bio = $3'];
    const vals = [name, u.username, bio || null];
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    vals.push(cid);
    let upd;
    try {
      upd = await db.query(`UPDATE circles SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, username, name, bio, avatar, created_by`, vals);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That circle username is already taken.' });
      throw e;
    }
    const r = upd.rows[0];
    res.json({ circle: { id: r.id, username: r.username, name: r.name, bio: r.bio || null, avatar: r.avatar || null, isAdmin: true, isMember: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// A circle creator can't delete a circle outright — they file a deletion request
// the Atwe team reviews. Official (seeded) circles can never be removed. Members
// keep the circle until an admin decides, so nobody is silently abandoned.
app.post('/api/circles/:id/delete-request', auth.requireAuth, rateLimit(10, 60000, 'circle-del-req'), async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid circle id.' });
  const reason = (req.body.reason || '').trim().slice(0, 500) || null;
  try {
    const c = await db.query('SELECT created_by, official, name FROM circles WHERE id = $1', [cid]);
    if (!c.rows[0]) return res.status(404).json({ error: 'Circle not found.' });
    if (c.rows[0].official) return res.status(403).json({ error: 'Official circles can’t be deleted.' });
    if (c.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the circle creator can request deletion.' });
    await db.query(
      `INSERT INTO circle_delete_requests (circle_id, requested_by, reason) VALUES ($1, $2, $3)
       ON CONFLICT (circle_id) DO UPDATE SET requested_by = $2, reason = $3, created_at = now()`,
      [cid, req.user.id, reason]
    );
    // Notify every admin in-app so it surfaces in their review queue.
    try {
      const admins = await db.query('SELECT id FROM users WHERE is_admin = true AND id <> $1', [req.user.id]);
      for (const a of admins.rows) {
        await db.query('INSERT INTO notifications (user_id, actor_id, type) VALUES ($1, $2, $3)', [a.id, req.user.id, 'circle_delete_request']);
      }
    } catch (_) { /* notification is best-effort */ }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin: review circle deletion requests.
app.get('/api/admin/circle-requests', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.reason, r.created_at, c.id AS circle_id, c.name, c.username,
              (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
              u.name AS requester_name, u.username AS requester_username
       FROM circle_delete_requests r
       JOIN circles c ON c.id = r.circle_id
       LEFT JOIN users u ON u.id = r.requested_by
       ORDER BY r.created_at ASC`
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load requests.' });
  }
});
app.post('/api/admin/circle-requests/:id', auth.requireAdmin, async (req, res) => {
  const rid = routeId(req.params.id);
  if (!Number.isInteger(rid)) return res.status(400).json({ error: 'Invalid request id.' });
  const approve = req.body.approve === true;
  try {
    const r = await db.query('SELECT circle_id FROM circle_delete_requests WHERE id = $1', [rid]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Request not found.' });
    if (approve) await db.query('DELETE FROM circles WHERE id = $1', [r.rows[0].circle_id]); // cascades members/posts links
    await db.query('DELETE FROM circle_delete_requests WHERE id = $1', [rid]); // clear either way
    res.json({ ok: true, approved: approve });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not process the request.' });
  }
});

/* ═══════════════════════════════════════════════
   JOBS  —  the networking engine's job board
═══════════════════════════════════════════════ */
const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Freelance'];
const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'];
const BUSINESS_FREE_JOB_CAP = 3;   // non-Pro business accounts: max live job posts
const JOB_BOOST_DAYS = 30;          // how long a boost lasts
function mapJob(j, me) {
  return {
    id: j.id, title: j.title, company: j.company || null, location: j.location || null,
    industry: j.industry || null, type: j.type || null, remote: !!j.remote,
    salaryMin: j.salary_min != null ? j.salary_min : null, salaryMax: j.salary_max != null ? j.salary_max : null,
    salaryPeriod: j.salary_period || null, hours: j.hours || null,
    description: j.description || null, created_at: j.created_at,
    poster: j.poster_id ? { id: j.poster_id, name: j.poster_name, username: j.poster_username, avatar: j.poster_avatar || null, accountType: j.poster_account_type === 'business' ? 'business' : 'personal' } : null,
    applicants: j.applicants != null ? j.applicants : undefined,
    // Insight: among the first applicants (LinkedIn-style "Be an early applicant").
    earlyApplicant: j.applicants != null ? j.applicants < 10 : undefined,
    applied: !!j.applied, saved: !!j.saved, mine: j.poster_id === me,
    applicationStatus: j.application_status || null, featured: !!j.featured,
    // Screening questions the applicant must answer — the knockout `expect` is
    // stripped here (applicants never see the required answer).
    screening: (Array.isArray(j.screening) ? j.screening : []).map((q) => ({ id: q.id, text: q.text, type: q.type, required: !!q.required })),
  };
}
// Sanitize employer-supplied screening questions (max 5). `expect` is the
// knockout target: 'yes'/'no' for yesno, a minimum number for `number`.
function sanitizeScreening(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 5).map((q, i) => {
    const type = ['yesno', 'number', 'text'].includes(q && q.type) ? q.type : 'yesno';
    const out = { id: 'q' + (i + 1), text: String((q && q.text) || '').slice(0, 200), type, required: !!(q && q.required) };
    if (type === 'yesno' && (q.expect === 'yes' || q.expect === 'no')) out.expect = q.expect;
    if (type === 'number' && q.expect != null && q.expect !== '' && Number.isFinite(Number(q.expect))) out.expect = Number(q.expect);
    return out;
  }).filter((q) => q.text);
}
// Does an applicant's answers satisfy a job's required knockouts?
function answersMeet(screening, answers) {
  answers = answers || {};
  for (const q of (screening || [])) {
    if (!q.required) continue;
    const v = answers[q.id];
    if (v == null || v === '') return false;
    if (q.type === 'yesno' && q.expect && String(v).toLowerCase() !== q.expect) return false;
    if (q.type === 'number' && q.expect != null && (Number(v) < q.expect)) return false;
  }
  return true;
}
const JOB_COLS = `j.id, j.title, j.company, j.location, j.industry, j.type, j.remote, j.description, j.created_at, j.screening,
  j.salary_min, j.salary_max, j.salary_period, j.hours,

  u.id AS poster_id, u.name AS poster_name, u.username AS poster_username, u.avatar AS poster_avatar, u.account_type AS poster_account_type,
  EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.user_id = $1) AS applied,
  EXISTS(SELECT 1 FROM saved_jobs sv WHERE sv.job_id = j.id AND sv.user_id = $1) AS saved,
  (SELECT a.status FROM job_applications a WHERE a.job_id = j.id AND a.user_id = $1) AS application_status,
  (j.featured_until IS NOT NULL AND j.featured_until > now()) AS featured`;
const JOB_FROM = `FROM jobs j LEFT JOIN users u ON u.id = j.posted_by`;

// Post a job.
app.post('/api/jobs', auth.requireAuth, rateLimit(20, 60000, 'job-post'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'A job title is required.' });
  if (title.length > 120) return res.status(400).json({ error: 'That title is too long.' });
  let company = (req.body.company || '').trim().slice(0, 120) || null;
  const location = (req.body.location || '').trim().slice(0, 120) || null;
  const industry = (req.body.industry || '').trim().slice(0, 60) || null;
  let type = (req.body.type || '').trim();
  type = JOB_TYPES.find((t) => t.toLowerCase() === type.toLowerCase()) || null;
  const remote = req.body.remote === true;
  const description = (req.body.description || '').trim().slice(0, 6000) || null;
  // Pay range + cadence and an hours/schedule note (all optional).
  const toAmt = (v) => { const n = parseInt(v, 10); return (Number.isInteger(n) && n >= 0 && n <= 100000000) ? n : null; };
  let salaryMin = toAmt(req.body.salaryMin), salaryMax = toAmt(req.body.salaryMax);
  if (salaryMin != null && salaryMax != null && salaryMax < salaryMin) { const t = salaryMin; salaryMin = salaryMax; salaryMax = t; } // tolerate reversed range
  let salaryPeriod = (req.body.salaryPeriod || '').trim().toLowerCase();
  salaryPeriod = SALARY_PERIODS.includes(salaryPeriod) ? salaryPeriod : null;
  if ((salaryMin != null || salaryMax != null) && !salaryPeriod) salaryPeriod = 'year'; // default cadence when a figure is given
  const hours = (req.body.hours || '').trim().slice(0, 60) || null;
  try {
    // Free-tier cap: a non-Pro business can keep up to BUSINESS_FREE_JOB_CAP live
    // posts; Pro is unlimited. (Personal accounts are unrestricted.)
    const meRow = (await db.query('SELECT plan, account_type FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    if (meRow.account_type === 'business' && meRow.plan !== 'pro') {
      const cnt = (await db.query('SELECT COUNT(*)::int AS n FROM jobs WHERE posted_by = $1', [req.user.id])).rows[0].n;
      if (cnt >= BUSINESS_FREE_JOB_CAP) {
        return res.status(402).json({ error: `Free accounts can post up to ${BUSINESS_FREE_JOB_CAP} jobs. Upgrade to Atwe Pro for unlimited postings.`, upgrade: true });
      }
    }
    const screening = sanitizeScreening(req.body.screening);
    const { rows } = await db.query(
      `INSERT INTO jobs (posted_by, title, company, location, industry, type, remote, description, salary_min, salary_max, salary_period, hours, screening)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [req.user.id, title, company, location, industry, type, remote, description, salaryMin, salaryMax, salaryPeriod, hours, JSON.stringify(screening)]
    );
    res.status(201).json({ id: rows[0].id });
    // Fan out saved-search alerts (best-effort, after responding).
    notifyJobMatch({ id: rows[0].id, title, company, location, industry, type, remote, description }, req.user.id);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not post the job.' }); }
});
// A newly posted job → notify users whose saved search (with alerts on) matches it.
async function notifyJobMatch(job, posterId) {
  try {
    const jobtext = [job.title, job.company, job.description].filter(Boolean).join(' ');
    const { rows } = await db.query(
      `SELECT DISTINCT s.user_id FROM saved_searches s
       WHERE s.notify = true AND s.user_id <> $1
         AND (s.industry IS NULL OR lower(s.industry) = lower($2))
         AND (s.type IS NULL OR lower(s.type) = lower($3))
         AND (s.remote = false OR $4 = true)
         AND (s.location IS NULL OR ($5 <> '' AND $5 ILIKE '%' || s.location || '%'))
         AND (s.q IS NULL OR $6 ILIKE '%' || s.q || '%')
       LIMIT 500`,
      [posterId, job.industry || '', job.type || '', !!job.remote, job.location || '', jobtext]
    );
    for (const r of rows) {
      try {
        await db.query('INSERT INTO notifications (user_id, actor_id, type, job_id) VALUES ($1,$2,$3,$4)', [r.user_id, posterId, 'job_match', job.id]);
        rtPush(r.user_id, 'notif', { type: 'job_match' });
      } catch (_) { /* per-user best-effort */ }
    }
  } catch (e) { /* alerts are best-effort */ }
}

// Browse jobs with optional filters: q, industry, location, remote, mine, applied.
app.get('/api/jobs', auth.requireAuth, async (req, res) => {
  const me = req.user.id;
  const q = (req.query.q || '').trim();
  const industry = (req.query.industry || '').trim();
  const location = (req.query.location || '').trim();
  const conds = [], params = [me];
  const type = (req.query.type || '').trim();
  if (q) { params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%'); conds.push(`(j.title ILIKE $${params.length} OR j.company ILIKE $${params.length} OR j.description ILIKE $${params.length})`); }
  if (industry) { params.push(industry); conds.push(`lower(j.industry) = lower($${params.length})`); }
  if (location) { params.push('%' + location.replace(/[%_\\]/g, '\\$&') + '%'); conds.push(`j.location ILIKE $${params.length}`); }
  if (type) { params.push(type); conds.push(`lower(j.type) = lower($${params.length})`); }
  if (req.query.remote === 'true') conds.push('j.remote = true');
  if (req.query.mine === 'true') { params.push(me); conds.push(`j.posted_by = $${params.length}`); }
  if (req.query.applied === 'true') conds.push(`EXISTS(SELECT 1 FROM job_applications a WHERE a.job_id = j.id AND a.user_id = ${me})`);
  if (req.query.saved === 'true') conds.push(`EXISTS(SELECT 1 FROM saved_jobs sv WHERE sv.job_id = j.id AND sv.user_id = ${me})`);
  // "For you": jobs whose industry is one of the official circles you've joined.
  if (req.query.forme === 'true') conds.push(`j.industry IN (SELECT c.name FROM circles c JOIN circle_members m ON m.circle_id = c.id WHERE m.user_id = ${me} AND c.official = true)`);
  try {
    const { rows } = await db.query(
      `SELECT ${JOB_COLS},
              (SELECT COUNT(*)::int FROM job_applications a WHERE a.job_id = j.id) AS applicants
       ${JOB_FROM}
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
       ORDER BY (j.featured_until IS NOT NULL AND j.featured_until > now()) DESC, j.created_at DESC LIMIT 60`,
      params
    );
    res.json({ jobs: rows.map((j) => mapJob(j, me)), types: JOB_TYPES });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load jobs.' }); }
});

// A single job (full detail + your applied state).
app.get('/api/jobs/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id); const me = req.user.id;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const { rows } = await db.query(
      `SELECT ${JOB_COLS}, (SELECT COUNT(*)::int FROM job_applications a WHERE a.job_id = j.id) AS applicants
       ${JOB_FROM} WHERE j.id = $2`,
      [me, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Job not found.' });
    res.json({ job: mapJob(rows[0], me) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the job.' }); }
});

// Delete a job (poster or admin).
app.delete('/api/jobs/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'You can only remove your own listings.' });
    await db.query('DELETE FROM jobs WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the job.' }); }
});

// Apply to a job (idempotent) — notifies the poster.
app.post('/api/jobs/:id/apply', auth.requireAuth, rateLimit(40, 60000, 'job-apply'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  if (!(await requireHandle(req, res))) return;
  const note = (req.body.note || '').trim().slice(0, 2000) || null;
  // Optional attached resume — snapshot title+data at apply time so the employer
  // can view it without needing access to the applicant's resume rows.
  let resumeId = null, resumeTitle = null, resumeData = null;
  if (req.body.resumeId) {
    const rr = await db.query('SELECT id, title, data FROM resumes WHERE id = $1 AND user_id = $2', [String(req.body.resumeId), req.user.id]);
    if (rr.rows[0]) { resumeId = rr.rows[0].id; resumeTitle = rr.rows[0].title || 'Resume'; resumeData = rr.rows[0].data || {}; }
  }
  // Screening answers: a small {questionId: value} map.
  let answers = null;
  if (req.body.answers && typeof req.body.answers === 'object') {
    answers = {};
    for (const k of Object.keys(req.body.answers).slice(0, 5)) answers[String(k).slice(0, 8)] = String(req.body.answers[k]).slice(0, 200);
  }
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by === req.user.id) return res.status(400).json({ error: 'This is your own listing.' });
    const r = await db.query(
      `INSERT INTO job_applications (job_id, user_id, note, resume_id, resume_title, resume_data, answers) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [id, req.user.id, note, resumeId, resumeTitle, resumeData ? JSON.stringify(resumeData) : null, answers ? JSON.stringify(answers) : null]
    );
    if (r.rowCount && j.rows[0].posted_by) {
      try { await db.query('INSERT INTO notifications (user_id, actor_id, type, job_id) VALUES ($1,$2,$3,$4)', [j.rows[0].posted_by, req.user.id, 'job_application', id]); rtPush(j.rows[0].posted_by, 'notif', { type: 'job_application' }); } catch (_) {}
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not apply.' }); }
});
app.delete('/api/jobs/:id/apply', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    await db.query('DELETE FROM job_applications WHERE job_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not withdraw.' }); }
});
// Who applied to a job — visible only to the poster (or an admin). Closes the
// loop: a poster sees each applicant's profile, when they applied + any note.
app.get('/api/jobs/:id/applicants', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by, title, screening FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the job poster can see applicants.' });
    const screening = Array.isArray(j.rows[0].screening) ? j.rows[0].screening : [];
    const { rows } = await db.query(
      `SELECT a.note, a.created_at, a.status, a.resume_title, a.resume_data, a.answers, u.id, u.name, u.username, u.avatar, u.verified, u.note AS profile_note, u.headline, u.account_type,
              EXISTS(SELECT 1 FROM saved_candidates sc WHERE sc.owner_id = $2 AND sc.candidate_id = u.id) AS saved
       FROM job_applications a JOIN users u ON u.id = a.user_id
       WHERE a.job_id = $1 ORDER BY (a.status = 'shortlisted') DESC, a.created_at DESC LIMIT 200`,
      [id, req.user.id]
    );
    res.json({
      title: j.rows[0].title,
      screening: screening.map((q) => ({ id: q.id, text: q.text, type: q.type, required: !!q.required })),
      applicants: rows.map((u) => {
        const ans = u.answers || null;
        // Pair each screening question with this applicant's answer for the poster.
        const answers = screening.length ? screening.map((q) => ({ id: q.id, text: q.text, value: ans && ans[q.id] != null ? ans[q.id] : null })) : [];
        return { id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, note: u.note || null, profileNote: u.profile_note || null, headline: u.headline || null, accountType: u.account_type === 'business' ? 'business' : 'personal', status: u.status || 'applied', saved: !!u.saved, applied_at: u.created_at, resumeTitle: u.resume_title || null, resume: u.resume_data || null, answers, meets: screening.some((q) => q.required) ? answersMeet(screening, ans) : null };
      }),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load applicants.' }); }
});
// Gather the seeker's context (skills, experience titles, headline, newest resume)
// for match-scoring + cover-note generation.
async function seekerContext(userId) {
  const u = (await db.query('SELECT name, headline, location FROM users WHERE id = $1', [userId])).rows[0] || {};
  const skills = (await db.query('SELECT name FROM user_skills WHERE user_id = $1 LIMIT 50', [userId])).rows.map((r) => r.name);
  const exp = (await db.query('SELECT title, company FROM experiences WHERE user_id = $1 ORDER BY (end_year IS NULL) DESC, end_year DESC NULLS FIRST LIMIT 12', [userId])).rows;
  const rz = (await db.query('SELECT data FROM resumes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [userId])).rows[0];
  return { name: u.name, headline: u.headline || '', location: u.location || '', skills, experience: exp, resume: rz && rz.data && rz.data.resume ? rz.data.resume : null };
}
function jobText(j) { return [j.title, j.company, j.industry, j.description].filter(Boolean).join(' '); }
// Heuristic match (no-AI fallback): skill keywords that appear in the job text.
function heuristicMatch(job, ctx) {
  const text = jobText(job).toLowerCase();
  const skills = (ctx.skills || []).map((s) => String(s)).filter(Boolean);
  const have = skills.filter((s) => text.includes(s.toLowerCase()));
  const titleHit = (ctx.experience || []).some((e) => e.title && job.title && (job.title.toLowerCase().includes(e.title.toLowerCase()) || e.title.toLowerCase().includes(job.title.toLowerCase())));
  let score = Math.min(95, (have.length ? 40 + Math.min(40, have.length * 12) : 25) + (titleHit ? 20 : 0));
  if (job.remote && /remote/.test((ctx.headline + ' ' + ctx.location).toLowerCase())) score = Math.min(96, score + 4);
  return { score, have: have.slice(0, 10), missing: [], summary: null, ai: false };
}
// "How you match" — Atwe AI scores how well the seeker fits a specific job.
app.post('/api/jobs/:id/match', auth.requireAuth, rateLimit(30, 60000, 'job-match-one'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const jr = await db.query('SELECT id, title, company, industry, type, location, remote, description FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    const job = jr.rows[0];
    const ctx = await seekerContext(req.user.id);
    if (!process.env.ANTHROPIC_API_KEY) return res.json(Object.assign({ level: 'Possible match' }, heuristicMatch(job, ctx)));
    const sys = 'You are Atwe AI, a job-fit analyst. Score how well a candidate matches a specific job from 0–100, honestly. ' +
      'List the key required/expected skills they clearly HAVE and the important ones they appear to be MISSING (short skill phrases). ' +
      'Write ONE short, encouraging-but-honest sentence on the fit. ' +
      'Reply STRICT JSON only: {"score":number,"level":string,"have":[string],"missing":[string],"summary":string}. ' +
      'level is one of "Strong match","Good match","Possible match","Stretch". No markdown, no prose outside JSON. Never mention "Claude" or "Anthropic".';
    const userMsg = 'JOB:\n' + JSON.stringify({ title: job.title, company: job.company, industry: job.industry, type: job.type, location: job.location, remote: job.remote, description: (job.description || '').slice(0, 2500) }) +
      '\n\nCANDIDATE:\n' + JSON.stringify({ headline: ctx.headline, location: ctx.location, skills: ctx.skills, experience: ctx.experience, summary: ctx.resume && ctx.resume.summary }) +
      '\n\nReturn the JSON now.';
    let out = null;
    try {
      const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 700, system: sys, messages: [{ role: 'user', content: userMsg }] });
      const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
      const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      out = {
        score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
        level: typeof parsed.level === 'string' ? parsed.level.slice(0, 40) : 'Possible match',
        have: (Array.isArray(parsed.have) ? parsed.have : []).map((s) => String(s).slice(0, 60)).filter(Boolean).slice(0, 12),
        missing: (Array.isArray(parsed.missing) ? parsed.missing : []).map((s) => String(s).slice(0, 60)).filter(Boolean).slice(0, 12),
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 300) : null,
        ai: true,
      };
    } catch (_) { out = Object.assign({ level: 'Possible match' }, heuristicMatch(job, ctx)); }
    res.json(out);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not score this job.' }); }
});
// Atwe AI writes a tailored cover note for a specific job (from the seeker's
// resume / profile). Returns { note } to drop into the application.
app.post('/api/jobs/:id/ai-cover', auth.requireAuth, rateLimit(15, 60000, 'job-cover'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  try {
    const jr = await db.query('SELECT title, company, industry, description FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    const job = jr.rows[0];
    const ctx = await seekerContext(req.user.id);
    const sys = 'You are Atwe AI, helping a job seeker apply. Write a concise, genuine cover note (3–5 sentences, first person) tailored to THIS job, drawing on the candidate’s real background. ' +
      'Warm and professional, no clichés, no made-up facts, no salutations/sign-off lines — just the body. Reply with the note text only (no quotes, no markdown). Never mention "Claude" or "Anthropic".';
    const userMsg = 'JOB: ' + JSON.stringify({ title: job.title, company: job.company, industry: job.industry, description: (job.description || '').slice(0, 2000) }) +
      '\nCANDIDATE: ' + JSON.stringify({ name: ctx.name, headline: ctx.headline, skills: ctx.skills, experience: ctx.experience, summary: ctx.resume && ctx.resume.summary }) +
      '\n\nWrite the cover note now.';
    const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 600, system: sys, messages: [{ role: 'user', content: userMsg }] });
    const note = (msg.content.find((b) => b.type === 'text')?.text || '').trim().slice(0, 1500);
    if (!note) return res.status(502).json({ error: 'Atwe AI could not draft that.' });
    res.json({ note });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not draft the note.' }); }
});

// Ask-for-a-referral: your accepted connections who currently work at the
// business that posted this job (a strong referral channel, LinkedIn-style).
app.get('/api/jobs/:id/referrers', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const jr = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    const posterId = jr.rows[0].posted_by;
    if (!posterId || posterId === req.user.id) return res.json({ referrers: [] });
    const { rows } = await db.query(
      `SELECT DISTINCT u.id, u.name, u.username, u.avatar, u.verified, u.headline, e.title
       FROM connections c
       JOIN users u ON u.id = (CASE WHEN c.requester_id = $1 THEN c.addressee_id ELSE c.requester_id END)
       JOIN experiences e ON e.user_id = u.id AND e.company_user_id = $2 AND e.end_year IS NULL
       WHERE (c.requester_id = $1 OR c.addressee_id = $1) AND c.status = 'accepted' AND u.username IS NOT NULL
       LIMIT 50`,
      [req.user.id, posterId]
    );
    res.json({ referrers: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || null, title: u.title || null })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load.' }); }
});
// Request a referral from a connection who works at the employer.
app.post('/api/jobs/:id/refer', auth.requireAuth, rateLimit(30, 60000, 'refer'), async (req, res) => {
  const id = routeId(req.params.id), to = parseInt(req.body.to, 10);
  if (!Number.isInteger(id) || !Number.isInteger(to)) return res.status(400).json({ error: 'Invalid request.' });
  if (to === req.user.id) return res.status(400).json({ error: 'You can’t ask yourself.' });
  try {
    const jr = await db.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    const conn = await db.query(
      `SELECT 1 FROM connections WHERE status = 'accepted' AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.user.id, to]
    );
    if (!conn.rows[0]) return res.status(403).json({ error: 'You can only ask your connections.' });
    await db.query('INSERT INTO notifications (user_id, actor_id, type, job_id) VALUES ($1,$2,$3,$4)', [to, req.user.id, 'referral_request', id]);
    rtPush(to, 'notif', { type: 'referral_request' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send the request.' }); }
});

// Boost / feature a job (owner). When a Stripe boost price is configured this
// returns a Checkout URL; otherwise it features the job instantly (demo, mirroring
// the existing Pro instant-upgrade fallback). Featured jobs sort to the top.
app.post('/api/jobs/:id/feature', auth.requireAuth, rateLimit(20, 60000, 'job-boost'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the poster can boost this job.' });
    // Real billing when a Stripe boost price is configured → pay first, the
    // webhook features the job. Otherwise feature instantly (demo fallback).
    if (billing.isBoostConfigured()) {
      const u = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createBoostSession(
        { id: req.user.id, email: u.email, stripe_customer_id: u.stripe_customer_id }, id, JOB_BOOST_DAYS,
        { successUrl: `${origin}/?boost=success`, cancelUrl: `${origin}/?boost=cancel` }
      );
      return res.json({ ok: true, url: session.url });
    }
    const r = await db.query(`UPDATE jobs SET featured_until = now() + ($2 * interval '1 day') WHERE id = $1 RETURNING featured_until`, [id, JOB_BOOST_DAYS]);
    res.json({ ok: true, featured: true, featuredUntil: r.rows[0].featured_until, days: JOB_BOOST_DAYS });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not boost the job.' }); }
});
// Poster moves an applicant through the pipeline (reviewed/shortlisted/rejected/hired).
const APPLICANT_STATUSES = ['applied', 'reviewed', 'shortlisted', 'rejected', 'hired'];
app.patch('/api/jobs/:id/applicants/:uid', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id), uid = routeId(req.params.uid);
  if (!Number.isInteger(id) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  const status = APPLICANT_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the job poster can update applicants.' });
    const r = await db.query('UPDATE job_applications SET status = $1 WHERE job_id = $2 AND user_id = $3', [status, id, uid]);
    if (!r.rowCount) return res.status(404).json({ error: 'Application not found.' });
    // Let the candidate know their application moved — 'applied' is the initial
    // state (set on apply), so only the poster's decisions generate a notif.
    if (status !== 'applied' && uid !== req.user.id) {
      try {
        await db.query('INSERT INTO notifications (user_id, actor_id, type, job_id) VALUES ($1,$2,$3,$4)', [uid, req.user.id, 'app_' + status, id]);
        rtPush(uid, 'notif', { type: 'app_' + status });
      } catch (_) { /* best-effort */ }
    }
    res.json({ ok: true, status });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// Bulk move several applicants to a status at once (poster only). Notifies each
// candidate of a real decision (everything but 'applied').
app.patch('/api/jobs/:id/applicants', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid request.' });
  const status = APPLICANT_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status.' });
  const uids = [...new Set((Array.isArray(req.body.uids) ? req.body.uids : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))].slice(0, 200);
  if (!uids.length) return res.status(400).json({ error: 'No applicants selected.' });
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the job poster can update applicants.' });
    const r = await db.query('UPDATE job_applications SET status = $1 WHERE job_id = $2 AND user_id = ANY($3) RETURNING user_id', [status, id, uids]);
    if (status !== 'applied') {
      for (const row of r.rows) {
        if (row.user_id === req.user.id) continue;
        try {
          await db.query('INSERT INTO notifications (user_id, actor_id, type, job_id) VALUES ($1,$2,$3,$4)', [row.user_id, req.user.id, 'app_' + status, id]);
          rtPush(row.user_id, 'notif', { type: 'app_' + status });
        } catch (_) { /* best-effort */ }
      }
    }
    res.json({ ok: true, status, updated: r.rowCount });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// Salary insight: how a job's pay compares to other jobs in the same industry.
const _ANNUALIZE = { year: 1, month: 12, week: 52, day: 260, hour: 2080 };
function annual(amount, period) { return amount == null ? null : amount * (_ANNUALIZE[period] || 1); }
app.get('/api/jobs/:id/salary-insight', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const jr = await db.query('SELECT industry, salary_min, salary_max, salary_period FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    const job = jr.rows[0];
    if (!job.industry) return res.json({ enough: false });
    // Peer jobs in the same industry with pay data → annualized midpoints.
    const { rows } = await db.query(
      `SELECT salary_min, salary_max, salary_period FROM jobs
       WHERE id <> $1 AND lower(industry) = lower($2) AND (salary_min IS NOT NULL OR salary_max IS NOT NULL) LIMIT 500`,
      [id, job.industry]
    );
    const mids = rows.map((r) => {
      const lo = r.salary_min != null ? r.salary_min : r.salary_max, hi = r.salary_max != null ? r.salary_max : r.salary_min;
      return annual((lo + hi) / 2, r.salary_period);
    }).filter((n) => n != null && n > 0).sort((a, b) => a - b);
    if (mids.length < 3) return res.json({ enough: false, count: mids.length });
    const pct = (p) => mids[Math.min(mids.length - 1, Math.floor(p * mids.length))];
    const median = pct(0.5), low = pct(0.25), high = pct(0.75);
    // This job's own annualized midpoint (if it has pay) → comparison.
    let comparison = null, thisAnnual = null;
    if (job.salary_min != null || job.salary_max != null) {
      const lo = job.salary_min != null ? job.salary_min : job.salary_max, hi = job.salary_max != null ? job.salary_max : job.salary_min;
      thisAnnual = annual((lo + hi) / 2, job.salary_period);
      comparison = thisAnnual >= high ? 'above' : thisAnnual < low ? 'below' : 'in-range';
    }
    res.json({ enough: true, industry: job.industry, count: mids.length, period: 'year', median: Math.round(median), low: Math.round(low), high: Math.round(high), thisAnnual: thisAnnual != null ? Math.round(thisAnnual) : null, comparison });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load salary insight.' }); }
});
// Record a job view (non-owner) — deduped to once per viewer per day, powering
// poster analytics. Best-effort; never blocks the viewer.
app.post('/api/jobs/:id/view', auth.requireAuth, rateLimit(120, 60000, 'job-view'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.json({ ok: true });
    if (j.rows[0].posted_by !== req.user.id) {
      await db.query(
        `INSERT INTO job_views (job_id, viewer_id) SELECT $1, $2
         WHERE NOT EXISTS (SELECT 1 FROM job_views WHERE job_id = $1 AND viewer_id = $2 AND viewed_at::date = now()::date)`,
        [id, req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (err) { res.json({ ok: true }); /* analytics is best-effort */ }
});
// Poster analytics for a job: views, unique viewers, applicants, apply-rate, a
// 14-day trend, and the applicant status breakdown.
app.get('/api/jobs/:id/analytics', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by, created_at FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the job poster can see analytics.' });
    const [tot, appl, vbyday, abyday, bystatus] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS views, COUNT(DISTINCT viewer_id)::int AS uniq FROM job_views WHERE job_id = $1', [id]),
      db.query('SELECT COUNT(*)::int AS n FROM job_applications WHERE job_id = $1', [id]),
      db.query(`SELECT viewed_at::date AS day, COUNT(*)::int AS n FROM job_views WHERE job_id = $1 AND viewed_at > now() - interval '14 days' GROUP BY day ORDER BY day`, [id]),
      db.query(`SELECT created_at::date AS day, COUNT(*)::int AS n FROM job_applications WHERE job_id = $1 AND created_at > now() - interval '14 days' GROUP BY day ORDER BY day`, [id]),
      db.query('SELECT status, COUNT(*)::int AS n FROM job_applications WHERE job_id = $1 GROUP BY status', [id]),
    ]);
    const views = tot.rows[0].views || 0, uniq = tot.rows[0].uniq || 0, applicants = appl.rows[0].n || 0;
    // Fill a 14-day series (zero-filled) for a clean sparkline.
    const days = [];
    const vmap = {}, amap = {};
    vbyday.rows.forEach((r) => { vmap[new Date(r.day).toISOString().slice(0, 10)] = r.n; });
    abyday.rows.forEach((r) => { amap[new Date(r.day).toISOString().slice(0, 10)] = r.n; });
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.push({ day: d, views: vmap[d] || 0, applicants: amap[d] || 0 }); }
    const byStatus = {}; bystatus.rows.forEach((r) => { byStatus[r.status || 'applied'] = r.n; });
    res.json({
      views, uniqueViewers: uniq, applicants,
      applyRate: uniq ? Math.round((applicants / uniq) * 100) : null,
      postedAt: j.rows[0].created_at, days, byStatus,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load analytics.' }); }
});
// Atwe AI auto-screening: rank the whole applicant list for the poster, with a
// fit score + one-line reason per applicant. Read-only — never auto-rejects.
app.post('/api/jobs/:id/rank-applicants', auth.requireAuth, rateLimit(10, 60000, 'rank-appl'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const j = await db.query('SELECT posted_by, title, description, industry, screening FROM jobs WHERE id = $1', [id]);
    if (!j.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (j.rows[0].posted_by !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Only the job poster can rank applicants.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
    const screening = Array.isArray(j.rows[0].screening) ? j.rows[0].screening : [];
    const { rows } = await db.query(
      `SELECT a.user_id, a.note, a.answers, a.resume_data, u.name, u.headline,
              (SELECT array_agg(s.name) FROM user_skills s WHERE s.user_id = u.id) AS skills
       FROM job_applications a JOIN users u ON u.id = a.user_id WHERE a.job_id = $1 LIMIT 80`,
      [id]
    );
    if (!rows.length) return res.json({ ranked: [] });
    const compact = rows.map((r, i) => ({
      i, name: r.name, headline: r.headline || null,
      skills: Array.isArray(r.skills) ? r.skills.filter(Boolean).slice(0, 20) : [],
      summary: r.resume_data && r.resume_data.resume ? (r.resume_data.resume.summary || null) : null,
      answers: screening.length ? screening.map((q) => ({ q: q.text, a: r.answers && r.answers[q.id] != null ? r.answers[q.id] : null })) : [],
      meets: screening.some((q) => q.required) ? answersMeet(screening, r.answers) : null,
      note: (r.note || '').slice(0, 300),
    }));
    const sys = 'You are Atwe AI, a hiring assistant. Rank job applicants for fit to a role, best first. ' +
      'Give each a 0–100 score and ONE short, specific reason. Weigh skills/experience match, screening answers (an applicant who fails a required knockout should rank low), and relevance. Be fair and honest. ' +
      'Reply STRICT JSON only: {"ranked":[{"i":number,"score":number,"reason":string}]}. No markdown, no prose outside JSON. Never mention "Claude" or "Anthropic".';
    const userMsg = 'JOB:\n' + JSON.stringify({ title: j.rows[0].title, industry: j.rows[0].industry, description: (j.rows[0].description || '').slice(0, 2000) }) +
      '\n\nAPPLICANTS:\n' + JSON.stringify(compact) + '\n\nReturn the ranked JSON now.';
    let ranked = [];
    try {
      const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: sys, messages: [{ role: 'user', content: userMsg }] });
      const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
      const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      ranked = (Array.isArray(parsed.ranked) ? parsed.ranked : [])
        .filter((m) => Number.isInteger(m.i) && rows[m.i])
        .map((m) => ({ uid: rows[m.i].user_id, score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))), reason: typeof m.reason === 'string' ? m.reason.slice(0, 240) : null }))
        .sort((a, b) => b.score - a.score);
    } catch (e) { return res.status(502).json({ error: 'Atwe AI could not rank the applicants. Try again.' }); }
    res.json({ ranked });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not rank applicants.' }); }
});
// Atwe AI interview prep: likely questions for THIS job, tailored to the seeker,
// with a tip for each + a couple to ask the employer.
app.post('/api/jobs/:id/interview-prep', auth.requireAuth, rateLimit(10, 60000, 'prep'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    const jr = await db.query('SELECT title, company, industry, description FROM jobs WHERE id = $1', [id]);
    if (!jr.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
    const job = jr.rows[0];
    const ctx = await seekerContext(req.user.id);
    const sys = 'You are Atwe AI, an interview coach. Prepare a candidate for an interview for a SPECIFIC job, drawing on their background. ' +
      'Give 5–7 likely interview questions with a short, concrete prep TIP for each (tailored to this candidate where possible), and 2–3 smart questions for them to ASK the employer. ' +
      'Reply STRICT JSON only: {"summary":string,"questions":[{"q":string,"tip":string}],"ask":[string]}. No markdown, no prose outside JSON. Never mention "Claude" or "Anthropic".';
    const userMsg = 'JOB: ' + JSON.stringify({ title: job.title, company: job.company, industry: job.industry, description: (job.description || '').slice(0, 2000) }) +
      '\nCANDIDATE: ' + JSON.stringify({ headline: ctx.headline, skills: ctx.skills, experience: ctx.experience, summary: ctx.resume && ctx.resume.summary }) +
      '\n\nReturn the prep JSON now.';
    const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 1500, system: sys, messages: [{ role: 'user', content: userMsg }] });
    const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map((x) => ({ q: String(x.q || '').slice(0, 300), tip: String(x.tip || '').slice(0, 400) })).filter((x) => x.q).slice(0, 10);
    const ask = (Array.isArray(parsed.ask) ? parsed.ask : []).map((s) => String(s || '').slice(0, 200)).filter(Boolean).slice(0, 6);
    if (!questions.length) return res.status(502).json({ error: 'Atwe AI could not prepare that. Try again.' });
    res.json({ summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : null, questions, ask });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not prepare. Please try again.' }); }
});
app.post('/api/candidates/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid) || cid === req.user.id) return res.status(400).json({ error: 'Invalid candidate.' });
  try { await db.query('INSERT INTO saved_candidates (owner_id, candidate_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, cid]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not save.' }); }
});
app.delete('/api/candidates/:id', auth.requireAuth, async (req, res) => {
  const cid = routeId(req.params.id);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: 'Invalid candidate.' });
  try { await db.query('DELETE FROM saved_candidates WHERE owner_id = $1 AND candidate_id = $2', [req.user.id, cid]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
app.get('/api/candidates', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified, u.headline, u.account_type,
              w.role, w.location, w.schedule, w.rate_min, w.rate_max, w.rate_period, w.remote,
              (SELECT array_agg(s.name) FROM user_skills s WHERE s.user_id = u.id) AS skills
       FROM saved_candidates sc JOIN users u ON u.id = sc.candidate_id
       LEFT JOIN worker_listings w ON w.user_id = u.id
       WHERE sc.owner_id = $1 ORDER BY sc.created_at DESC LIMIT 200`,
      [req.user.id]
    );
    res.json({ candidates: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || null, accountType: u.account_type === 'business' ? 'business' : 'personal', role: u.role || null, location: u.location || null, schedule: u.schedule || null, rateMin: u.rate_min != null ? u.rate_min : null, rateMax: u.rate_max != null ? u.rate_max : null, ratePeriod: u.rate_period || null, remote: !!u.remote, skills: Array.isArray(u.skills) ? u.skills.filter(Boolean) : [], saved: true })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load candidates.' }); }
});
// Save / unsave a job (bookmark).
app.post('/api/jobs/:id/save', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    await db.query('INSERT INTO saved_jobs (job_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save.' }); }
});
app.delete('/api/jobs/:id/save', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid job id.' });
  try {
    await db.query('DELETE FROM saved_jobs WHERE job_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not unsave.' }); }
});

/* ═══════════════════════════════════════════════
   WORKER LISTINGS  —  "open to work" (the other half of the marketplace)
═══════════════════════════════════════════════ */
function mapWorker(w) {
  return {
    userId: w.user_id, role: w.role || null, location: w.location || null, schedule: w.schedule || null,
    rateMin: w.rate_min != null ? w.rate_min : null, rateMax: w.rate_max != null ? w.rate_max : null,
    ratePeriod: w.rate_period || null, remote: !!w.remote, about: w.about || null,
    user: { id: w.user_id, name: w.name, username: w.username, avatar: w.avatar || null, verified: !!w.verified, headline: w.headline || null, accountType: w.account_type === 'business' ? 'business' : 'personal' },
    skills: Array.isArray(w.skills) ? w.skills.filter(Boolean) : [],
  };
}
const WORKER_COLS = `w.user_id, w.role, w.location, w.schedule, w.rate_min, w.rate_max, w.rate_period, w.remote, w.about,
  u.name, u.username, u.avatar, u.verified, u.headline, u.account_type,
  (SELECT array_agg(s.name) FROM user_skills s WHERE s.user_id = u.id) AS skills`;
// Create / update my own "open to work" listing.
app.post('/api/worker-listings', auth.requireAuth, rateLimit(20, 60000, 'worker-post'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const role = (req.body.role || '').trim().slice(0, 120);
  if (!role) return res.status(400).json({ error: 'What kind of work? (a role / trade)' });
  const location = (req.body.location || '').trim().slice(0, 120) || null;
  const schedule = (req.body.schedule || '').trim().slice(0, 60) || null;
  const about = (req.body.about || '').trim().slice(0, 2000) || null;
  const toAmt = (v) => { const n = parseInt(v, 10); return (Number.isInteger(n) && n >= 0 && n <= 100000000) ? n : null; };
  let rateMin = toAmt(req.body.rateMin), rateMax = toAmt(req.body.rateMax);
  if (rateMin != null && rateMax != null && rateMax < rateMin) { const t = rateMin; rateMin = rateMax; rateMax = t; }
  let ratePeriod = (req.body.ratePeriod || '').trim().toLowerCase();
  ratePeriod = SALARY_PERIODS.includes(ratePeriod) ? ratePeriod : null;
  if ((rateMin != null || rateMax != null) && !ratePeriod) ratePeriod = 'hour';
  const remote = req.body.remote === true;
  try {
    await db.query(
      `INSERT INTO worker_listings (user_id, role, location, schedule, rate_min, rate_max, rate_period, remote, about, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, location = EXCLUDED.location, schedule = EXCLUDED.schedule,
         rate_min = EXCLUDED.rate_min, rate_max = EXCLUDED.rate_max, rate_period = EXCLUDED.rate_period,
         remote = EXCLUDED.remote, about = EXCLUDED.about, updated_at = now()`,
      [req.user.id, role, location, schedule, rateMin, rateMax, ratePeriod, remote, about]
    );
    res.status(201).json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not post your listing.' }); }
});
// My own listing (to prefill the form / show I'm currently listed).
app.get('/api/worker-listings/me', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT ${WORKER_COLS} FROM worker_listings w JOIN users u ON u.id = w.user_id WHERE w.user_id = $1`, [req.user.id]);
    res.json({ listing: rows[0] ? mapWorker(rows[0]) : null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load.' }); }
});
// Go off the market.
app.delete('/api/worker-listings/me', auth.requireAuth, async (req, res) => {
  try { await db.query('DELETE FROM worker_listings WHERE user_id = $1', [req.user.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});
// Open-to-Work preferences: visibility ('off' | 'recruiters' | 'everyone') +
// whether a worker listing exists. 'everyone' lights the public #OpenToWork ring.
app.get('/api/open-to-work', auth.requireAuth, async (req, res) => {
  try {
    const u = await db.query('SELECT otw_visibility FROM users WHERE id = $1', [req.user.id]);
    const has = await db.query('SELECT 1 FROM worker_listings WHERE user_id = $1', [req.user.id]);
    const v = u.rows[0] && ['recruiters', 'everyone'].includes(u.rows[0].otw_visibility) ? u.rows[0].otw_visibility : 'off';
    res.json({ visibility: v, hasListing: !!has.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load.' }); }
});
app.put('/api/open-to-work', auth.requireAuth, async (req, res) => {
  const v = ['off', 'recruiters', 'everyone'].includes(req.body.visibility) ? req.body.visibility : null;
  if (!v) return res.status(400).json({ error: 'Invalid visibility.' });
  try {
    await db.query('UPDATE users SET otw_visibility = $1 WHERE id = $2', [v, req.user.id]);
    res.json({ visibility: v, openToWork: v === 'everyone' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// Browse "open to work" listings (the Workers tab) with optional filters.
app.get('/api/worker-listings', auth.requireAuth, async (req, res) => {
  const conds = [], params = [];
  const q = (req.query.q || '').trim();
  if (q) {
    const tokens = [...new Set(q.toLowerCase().split(/[\s,]+/).filter((t) => t.length >= 2))].slice(0, 8);
    if (tokens.length) {
      const ors = tokens.map((t) => { params.push('%' + t.replace(/[%_\\]/g, '\\$&') + '%'); const i = params.length; return `(w.role ILIKE $${i} OR w.about ILIKE $${i} OR u.headline ILIKE $${i} OR EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = u.id AND s.name ILIKE $${i}))`; });
      conds.push('(' + ors.join(' OR ') + ')');
    }
  }
  const location = (req.query.location || '').trim();
  if (location) { params.push('%' + location.replace(/[%_\\]/g, '\\$&') + '%'); conds.push(`w.location ILIKE $${params.length}`); }
  const schedule = (req.query.schedule || '').trim();
  if (schedule) { params.push(schedule); conds.push(`lower(w.schedule) = lower($${params.length})`); }
  if (req.query.remote === 'true') conds.push('w.remote = true');
  if (req.query.mine === 'true') { params.push(req.user.id); conds.push(`w.user_id = $${params.length}`); }
  // Budget filter: show workers whose asking rate is at or below a cap (a worker
  // who hasn't stated a rate is still shown — they're negotiable).
  const rateMax = parseInt(req.query.rateMax, 10);
  if (Number.isInteger(rateMax) && rateMax > 0) { params.push(rateMax); conds.push(`(w.rate_min IS NULL OR w.rate_min <= $${params.length})`); }
  // Sort: most recent (default) or lowest asking rate first.
  const order = req.query.sort === 'rate' ? 'w.rate_min ASC NULLS LAST, w.updated_at DESC' : 'w.updated_at DESC';
  try {
    const { rows } = await db.query(
      `SELECT ${WORKER_COLS} FROM worker_listings w JOIN users u ON u.id = w.user_id
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY ${order} LIMIT 60`,
      params
    );
    res.json({ workers: rows.map(mapWorker) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load workers.' }); }
});

/* ═══════════════════════════════════════════════
   REPORTS  —  flag a job / worker / user / post for admin review
═══════════════════════════════════════════════ */
const REPORT_TYPES = ['job', 'worker', 'user', 'post'];
const REPORT_REASONS = ['scam', 'spam', 'inappropriate', 'fake', 'harassment', 'other'];
app.post('/api/reports', auth.requireAuth, rateLimit(20, 60000, 'report'), async (req, res) => {
  const targetType = String(req.body.targetType || '');
  const targetId = parseInt(req.body.targetId, 10);
  if (!REPORT_TYPES.includes(targetType) || !Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid report.' });
  let reason = String(req.body.reason || '').toLowerCase();
  reason = REPORT_REASONS.includes(reason) ? reason : 'other';
  const note = (req.body.note || '').trim().slice(0, 1000) || null;
  if (targetType === 'user' && targetId === req.user.id) return res.status(400).json({ error: 'You can’t report yourself.' });
  try {
    await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING`,
      [req.user.id, targetType, targetId, reason, note]
    );
    res.status(201).json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not submit the report.' }); }
});
// Admin: open reports with reporter + target context.
app.get('/api/admin/reports', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.note, r.status, r.created_at,
              ru.name AS reporter_name, ru.username AS reporter_username,
              CASE r.target_type
                WHEN 'job'    THEN (SELECT j.title FROM jobs j WHERE j.id = r.target_id)
                WHEN 'worker' THEN (SELECT w.role FROM worker_listings w WHERE w.user_id = r.target_id)
                WHEN 'user'   THEN (SELECT u.name FROM users u WHERE u.id = r.target_id)
                WHEN 'post'   THEN (SELECT left(p.body, 80) FROM posts p WHERE p.id = r.target_id)
              END AS target_label,
              CASE r.target_type
                WHEN 'job'    THEN (SELECT u.username FROM jobs j JOIN users u ON u.id = j.posted_by WHERE j.id = r.target_id)
                WHEN 'worker' THEN (SELECT u.username FROM users u WHERE u.id = r.target_id)
                WHEN 'user'   THEN (SELECT u.username FROM users u WHERE u.id = r.target_id)
                WHEN 'post'   THEN (SELECT u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = r.target_id)
              END AS target_username
       FROM reports r JOIN users ru ON ru.id = r.reporter_id
       WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json({ reports: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load reports.' }); }
});
// Admin: open escrow disputes — orders held in escrow that a party has disputed.
app.get('/api/admin/disputes', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.total_cents, o.dispute_reason, o.disputed_by, o.created_at,
              bu.name AS buyer_name, bu.username AS buyer_username,
              su.name AS seller_name, su.username AS seller_username,
              (SELECT string_agg(oi.name, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS items
       FROM orders o JOIN users bu ON bu.id = o.buyer_id JOIN users su ON su.id = o.seller_id
       WHERE o.status = 'disputed' ORDER BY o.created_at DESC LIMIT 200`
    );
    res.json({ disputes: rows.map((r) => ({
      id: r.id, totalCents: r.total_cents, reason: r.dispute_reason, items: r.items || '',
      disputedBy: r.disputed_by || null, createdAt: r.created_at,
      buyer: { name: r.buyer_name, username: r.buyer_username },
      seller: { name: r.seller_name, username: r.seller_username },
    })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load disputes.' }); }
});
// Admin: resolve a dispute — refund the buyer or release the held funds to the seller.
app.post('/api/admin/disputes/:id/resolve', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const outcome = req.body.outcome === 'release' ? 'release' : req.body.outcome === 'refund' ? 'refund' : null;
  if (!outcome) return res.status(400).json({ error: 'Choose refund or release.' });
  try {
    const o = (await db.query('SELECT status FROM orders WHERE id = $1', [id])).rows[0];
    if (!o) return res.status(404).json({ error: 'Order not found.' });
    if (o.status !== 'disputed') return res.status(400).json({ error: 'That dispute is already resolved.' });
    const ok = outcome === 'refund' ? await refundEscrow(id) : await releaseEscrow(id);
    if (!ok) return res.status(400).json({ error: 'Could not resolve the dispute.' });
    res.json({ ok: true, outcome });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not resolve the dispute.' }); }
});
// Admin: resolve / dismiss a report, optionally removing the reported item.
app.patch('/api/admin/reports/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const status = ['resolved', 'dismissed'].includes(req.body.status) ? req.body.status : 'resolved';
  try {
    const r = await db.query('SELECT target_type, target_id FROM reports WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Report not found.' });
    if (req.body.removeTarget === true) { // take down the reported item
      const { target_type: tt, target_id: ti } = r.rows[0];
      if (tt === 'job') await db.query('DELETE FROM jobs WHERE id = $1', [ti]).catch(() => {});
      else if (tt === 'worker') await db.query('DELETE FROM worker_listings WHERE user_id = $1', [ti]).catch(() => {});
      else if (tt === 'post') await db.query('DELETE FROM posts WHERE id = $1', [ti]).catch(() => {});
      // 'user' removal is intentionally manual (use Delete user) to avoid accidents.
    }
    await db.query('UPDATE reports SET status = $1 WHERE id = $2', [status, id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update the report.' }); }
});


// A business account requests verification (admin reviews → 'verified').
app.post('/api/business/verify', auth.requireAuth, rateLimit(5, 3600000, 'biz-verify'), async (req, res) => {
  try {
    const u = await db.query('SELECT account_type, business_verify_status FROM users WHERE id = $1', [req.user.id]);
    const r = u.rows[0];
    if (!r || r.account_type !== 'business') return res.status(400).json({ error: 'Only business accounts can request verification.' });
    if (r.business_verify_status === 'verified') return res.json({ ok: true, status: 'verified' });
    await db.query(`UPDATE users SET business_verify_status = 'pending' WHERE id = $1`, [req.user.id]);
    res.json({ ok: true, status: 'pending' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not submit your request.' }); }
});

// Company analytics dashboard (LinkedIn-style) — aggregate reach for a business
// account: profile views (+14-day trend), followers, connections, post reach,
// and hiring stats across all their jobs. Business accounts only.
app.get('/api/business/analytics', auth.requireAuth, async (req, res) => {
  const uid = req.user.id;
  try {
    const acc = await db.query('SELECT account_type FROM users WHERE id = $1', [uid]);
    if (!acc.rows[0] || acc.rows[0].account_type !== 'business') {
      return res.status(403).json({ error: 'Analytics are available on business accounts.' });
    }
    const [pvTot, pv30, pvUniq, pvDays, followers, connections, posts, jobs, jobViews] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM profile_views WHERE viewed_id = $1', [uid]),
      db.query(`SELECT COUNT(*)::int AS n FROM profile_views WHERE viewed_id = $1 AND viewed_at > now() - interval '30 days'`, [uid]),
      db.query(`SELECT COUNT(DISTINCT viewer_id)::int AS n FROM profile_views WHERE viewed_id = $1 AND viewed_at > now() - interval '30 days'`, [uid]),
      db.query(`SELECT viewed_at::date AS day, COUNT(*)::int AS n FROM profile_views WHERE viewed_id = $1 AND viewed_at > now() - interval '14 days' GROUP BY day`, [uid]),
      db.query('SELECT COUNT(*)::int AS n FROM follows WHERE following_id = $1', [uid]),
      db.query(`SELECT COUNT(*)::int AS n FROM connections WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`, [uid]),
      db.query(`SELECT COUNT(*)::int AS posts,
                       COALESCE((SELECT COUNT(*) FROM post_views pv JOIN posts p2 ON p2.id = pv.post_id WHERE p2.user_id = $1),0)::int AS views,
                       COALESCE((SELECT COUNT(*) FROM post_likes pl JOIN posts p3 ON p3.id = pl.post_id WHERE p3.user_id = $1),0)::int AS likes,
                       COALESCE((SELECT COUNT(*) FROM post_reposts pr JOIN posts p4 ON p4.id = pr.post_id WHERE p4.user_id = $1),0)::int AS reposts
                FROM posts p WHERE p.user_id = $1 AND p.parent_id IS NULL`, [uid]),
      db.query(`SELECT COUNT(*)::int AS jobs,
                       COALESCE((SELECT COUNT(*) FROM job_applications a JOIN jobs j2 ON j2.id = a.job_id WHERE j2.posted_by = $1),0)::int AS applicants
                FROM jobs j WHERE j.posted_by = $1`, [uid]),
      db.query(`SELECT COALESCE((SELECT COUNT(*) FROM job_views v JOIN jobs j ON j.id = v.job_id WHERE j.posted_by = $1),0)::int AS n`, [uid]),
    ]);
    const vmap = {}; pvDays.rows.forEach((r) => { vmap[new Date(r.day).toISOString().slice(0, 10)] = r.n; });
    const days = [];
    for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.push({ day: d, views: vmap[d] || 0 }); }
    res.json({
      profileViews: { total: pvTot.rows[0].n || 0, last30: pv30.rows[0].n || 0, unique30: pvUniq.rows[0].n || 0, days },
      followers: followers.rows[0].n || 0,
      connections: connections.rows[0].n || 0,
      posts: { count: posts.rows[0].posts || 0, views: posts.rows[0].views || 0, likes: posts.rows[0].likes || 0, reposts: posts.rows[0].reposts || 0 },
      jobs: { count: jobs.rows[0].jobs || 0, applicants: jobs.rows[0].applicants || 0, views: jobViews.rows[0].n || 0 },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load analytics.' }); }
});

/* ═══════════════════════════════════════════════
   EXPERIENCE  —  a user's work-history timeline
═══════════════════════════════════════════════ */
const _expYear = (v) => { const n = parseInt(v, 10); return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null; };
// Resolve an experience's company links from the request: a business *account*
// (company_user_id, the new model) takes priority; otherwise auto-link to a
// business account by exact name/@username, falling back to a legacy company page.
// Returns { company, companyUserId }.
async function resolveExpCompany(body, companyText) {
  let company = companyText, companyUserId = null;
  if (body.companyUserId != null) {
    const uid = parseInt(body.companyUserId, 10);
    if (Number.isInteger(uid)) {
      const c = await db.query(`SELECT id, name FROM users WHERE id = $1 AND account_type = 'business'`, [uid]);
      if (c.rows[0]) { companyUserId = uid; if (!company) company = c.rows[0].name; }
    }
  }
  if (!companyUserId && company) { // auto-link a business account by name or @handle
    const m = await db.query(`SELECT id FROM users WHERE account_type = 'business' AND (lower(name) = lower($1) OR lower(username) = lower($1)) LIMIT 1`, [company.replace(/^@/, '')]);
    if (m.rows[0]) companyUserId = m.rows[0].id;
  }
  return { company, companyUserId };
}
// Add an experience entry.
app.post('/api/experiences', auth.requireAuth, rateLimit(40, 60000, 'exp-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const title = (req.body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'A role / title is required.' });
  const startYear = _expYear(req.body.startYear);
  const endYear = req.body.current ? null : _expYear(req.body.endYear);
  const { company, companyUserId } = await resolveExpCompany(req.body, (req.body.company || '').trim().slice(0, 120) || null);
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM experiences WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 50) return res.status(400).json({ error: 'You’ve reached the maximum number of entries.' });
    const { rows } = await db.query(
      `INSERT INTO experiences (user_id, title, company, company_user_id, start_year, end_year)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, title, company, companyUserId, startYear, endYear]
    );
    res.status(201).json({ id: rows[0].id, companyUserId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the experience.' }); }
});
// Edit an experience entry (own only).
app.patch('/api/experiences/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const title = (req.body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'A role / title is required.' });
  const startYear = _expYear(req.body.startYear);
  const endYear = req.body.current ? null : _expYear(req.body.endYear);
  const { company, companyUserId } = await resolveExpCompany(req.body, (req.body.company || '').trim().slice(0, 120) || null);
  try {
    const r = await db.query(
      `UPDATE experiences SET title = $1, company = $2, company_user_id = $3, start_year = $4, end_year = $5
       WHERE id = $6 AND user_id = $7`,
      [title, company, companyUserId, startYear, endYear, id, req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true, companyUserId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the experience.' }); }
});
app.delete('/api/experiences/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM experiences WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the experience.' }); }
});

/* ═══════════════════════════════════════════════
   EDUCATION  &  CERTIFICATIONS  —  profile sections
═══════════════════════════════════════════════ */
const _eduYear = _expYear; // same 1900–2100 guard
function mapEducation(e) {
  return { id: e.id, school: e.school, degree: e.degree || null, field: e.field || null, startYear: e.start_year || null, endYear: e.end_year || null };
}
function mapCertification(c) {
  return { id: c.id, name: c.name, issuer: c.issuer || null, issueYear: c.issue_year || null, expireYear: c.expire_year || null, credentialId: c.credential_id || null, url: c.url || null };
}
// ── Education ──
app.get('/api/education', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, school, degree, field, start_year, end_year FROM education WHERE user_id = $1
       ORDER BY COALESCE(end_year, 999999) DESC, COALESCE(start_year, 0) DESC, id DESC`, [req.user.id]);
    res.json({ education: rows.map(mapEducation) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load education.' }); }
});
app.post('/api/education', auth.requireAuth, rateLimit(40, 60000, 'edu-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const school = (req.body.school || '').trim().slice(0, 140);
  if (!school) return res.status(400).json({ error: 'A school is required.' });
  const degree = (req.body.degree || '').trim().slice(0, 120) || null;
  const field = (req.body.field || '').trim().slice(0, 120) || null;
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM education WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 30) return res.status(400).json({ error: 'You’ve reached the maximum number of entries.' });
    const { rows } = await db.query(
      `INSERT INTO education (user_id, school, degree, field, start_year, end_year) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, school, degree, field, _eduYear(req.body.startYear), req.body.current ? null : _eduYear(req.body.endYear)]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the education entry.' }); }
});
app.patch('/api/education/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const school = (req.body.school || '').trim().slice(0, 140);
  if (!school) return res.status(400).json({ error: 'A school is required.' });
  try {
    const r = await db.query(
      `UPDATE education SET school = $1, degree = $2, field = $3, start_year = $4, end_year = $5 WHERE id = $6 AND user_id = $7`,
      [school, (req.body.degree || '').trim().slice(0, 120) || null, (req.body.field || '').trim().slice(0, 120) || null,
       _eduYear(req.body.startYear), req.body.current ? null : _eduYear(req.body.endYear), id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the education entry.' }); }
});
app.delete('/api/education/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM education WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the entry.' }); }
});
// ── Certifications ──
app.get('/api/certifications', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, issuer, issue_year, expire_year, credential_id, url FROM certifications WHERE user_id = $1
       ORDER BY COALESCE(issue_year, 0) DESC, id DESC`, [req.user.id]);
    res.json({ certifications: rows.map(mapCertification) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load certifications.' }); }
});
app.post('/api/certifications', auth.requireAuth, rateLimit(40, 60000, 'cert-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const name = (req.body.name || '').trim().slice(0, 140);
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  let url = (req.body.url || '').trim().slice(0, 300) || null;
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM certifications WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 50) return res.status(400).json({ error: 'You’ve reached the maximum number of entries.' });
    const { rows } = await db.query(
      `INSERT INTO certifications (user_id, name, issuer, issue_year, expire_year, credential_id, url) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.id, name, (req.body.issuer || '').trim().slice(0, 120) || null, _eduYear(req.body.issueYear),
       _eduYear(req.body.expireYear), (req.body.credentialId || '').trim().slice(0, 120) || null, url]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the certification.' }); }
});
app.patch('/api/certifications/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const name = (req.body.name || '').trim().slice(0, 140);
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  let url = (req.body.url || '').trim().slice(0, 300) || null;
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const r = await db.query(
      `UPDATE certifications SET name = $1, issuer = $2, issue_year = $3, expire_year = $4, credential_id = $5, url = $6 WHERE id = $7 AND user_id = $8`,
      [name, (req.body.issuer || '').trim().slice(0, 120) || null, _eduYear(req.body.issueYear), _eduYear(req.body.expireYear),
       (req.body.credentialId || '').trim().slice(0, 120) || null, url, id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the certification.' }); }
});
app.delete('/api/certifications/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM certifications WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the entry.' }); }
});

/* ═══════════════════════════════════════════════
   PROFILE STRENGTH  —  completeness meter
═══════════════════════════════════════════════ */
app.get('/api/profile-strength', auth.requireAuth, async (req, res) => {
  try {
    const u = (await db.query('SELECT avatar, banner, bio, headline, location, username FROM users WHERE id = $1', [req.user.id])).rows[0];
    if (!u) return res.status(404).json({ error: 'Account not found.' });
    const [exp, edu, skl, cert] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS n FROM experiences WHERE user_id = $1', [req.user.id]),
      db.query('SELECT COUNT(*)::int AS n FROM education WHERE user_id = $1', [req.user.id]),
      db.query('SELECT COUNT(*)::int AS n FROM user_skills WHERE user_id = $1', [req.user.id]),
      db.query('SELECT COUNT(*)::int AS n FROM certifications WHERE user_id = $1', [req.user.id]),
    ]);
    const items = [
      { key: 'photo', label: 'Add a profile photo', done: !!u.avatar },
      { key: 'headline', label: 'Write a headline', done: !!(u.headline && u.headline.trim()) },
      { key: 'bio', label: 'Write an about / bio', done: !!(u.bio && u.bio.trim()) },
      { key: 'location', label: 'Add your location', done: !!(u.location && u.location.trim()) },
      { key: 'banner', label: 'Add a banner image', done: !!u.banner },
      { key: 'experience', label: 'Add work experience', done: exp.rows[0].n > 0 },
      { key: 'education', label: 'Add your education', done: edu.rows[0].n > 0 },
      { key: 'skills', label: 'List at least 3 skills', done: skl.rows[0].n >= 3 },
      { key: 'certification', label: 'Add a license or certification', done: cert.rows[0].n > 0 },
    ];
    const done = items.filter((i) => i.done).length;
    const score = Math.round((done / items.length) * 100);
    res.json({ score, done, total: items.length, items });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not compute profile strength.' }); }
});

/* ═══════════════════════════════════════════════
   SAVED SEARCHES  —  job alerts
═══════════════════════════════════════════════ */
function mapSavedSearch(s) {
  return { id: s.id, label: s.label || null, q: s.q || null, industry: s.industry || null, location: s.location || null, type: s.type || null, remote: !!s.remote, notify: !!s.notify };
}
app.get('/api/saved-searches', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, label, q, industry, location, type, remote, notify FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    res.json({ searches: rows.map(mapSavedSearch) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load saved searches.' }); }
});
app.post('/api/saved-searches', auth.requireAuth, rateLimit(30, 60000, 'search-save'), async (req, res) => {
  const label = (req.body.label || '').trim().slice(0, 80) || null;
  const q = (req.body.q || '').trim().slice(0, 120) || null;
  const industry = (req.body.industry || '').trim().slice(0, 60) || null;
  const location = (req.body.location || '').trim().slice(0, 120) || null;
  let type = (req.body.type || '').trim();
  type = JOB_TYPES.find((t) => t.toLowerCase() === type.toLowerCase()) || null;
  const remote = req.body.remote === true;
  const notify = req.body.notify !== false;
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM saved_searches WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 30) return res.status(400).json({ error: 'You’ve reached the maximum number of saved searches.' });
    const { rows } = await db.query(
      `INSERT INTO saved_searches (user_id, label, q, industry, location, type, remote, notify)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, label, q, industry, location, type, remote, notify`,
      [req.user.id, label, q, industry, location, type, remote, notify]
    );
    res.status(201).json({ search: mapSavedSearch(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the search.' }); }
});
app.patch('/api/saved-searches/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const fields = [], vals = [];
  if ('notify' in req.body) { vals.push(req.body.notify === true); fields.push(`notify = $${vals.length}`); }
  if ('label' in req.body) { vals.push((req.body.label || '').trim().slice(0, 80) || null); fields.push(`label = $${vals.length}`); }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });
  vals.push(id); vals.push(req.user.id);
  try {
    const r = await db.query(`UPDATE saved_searches SET ${fields.join(', ')} WHERE id = $${vals.length - 1} AND user_id = $${vals.length}`, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
app.delete('/api/saved-searches/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM saved_searches WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});

/* ═══════════════════════════════════════════════
   PROFESSIONAL EVENTS (LinkedIn-style)
═══════════════════════════════════════════════ */
const EVENTS_SELECT = `
  SELECT e.id, e.host_id, e.title, e.description, e.starts_at, e.ends_at, e.online, e.location, e.cover, e.created_at, e.price_cents,
         u.name AS host_name, u.username AS host_username, u.avatar AS host_avatar, u.verified AS host_verified, u.account_type AS host_type,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going')::int AS going,
         (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'interested')::int AS interested,
         (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1) AS my_rsvp,
         (SELECT paid FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1) AS my_paid,
         (e.host_id = $1) AS mine
  FROM events e JOIN users u ON u.id = e.host_id `;
function mapEvent(r) {
  return {
    id: r.id, title: r.title, description: r.description || '',
    startsAt: r.starts_at, endsAt: r.ends_at || null,
    online: !!r.online, location: r.location || null, cover: r.cover || null, createdAt: r.created_at,
    priceCents: r.price_cents || 0,
    going: r.going || 0, interested: r.interested || 0, myRsvp: r.my_rsvp || null, myPaid: !!r.my_paid, mine: !!r.mine,
    host: { id: r.host_id, name: r.host_name, username: r.host_username, avatar: r.host_avatar || null, verified: !!r.host_verified, business: r.host_type === 'business' },
  };
}
/* ═══════════════════════════════════════════════
   BUSINESS DIRECTORY  —  browsable, verified-first
═══════════════════════════════════════════════ */
app.get('/api/businesses/directory', auth.requireAuth, async (req, res) => {
  try {
    const params = [];
    const where = [`u.account_type = 'business'`, `u.username IS NOT NULL`];
    if (req.query.q) {
      params.push('%' + String(req.query.q).replace(/[%_\\]/g, '\\$&') + '%');
      where.push(`(u.name ILIKE $${params.length} OR u.username ILIKE $${params.length})`);
    }
    if (req.query.industry) {
      params.push(String(req.query.industry));
      where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.categories) c WHERE c ILIKE $${params.length})`);
    }
    if (req.query.verifiedOnly === 'true' || req.query.verifiedOnly === '1') {
      where.push(`u.business_verify_status = 'verified'`);
    }
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified, u.categories, u.account_type, u.business_verify_status, u.headline,
              (SELECT COUNT(*)::int FROM follows f WHERE f.following_id = u.id) AS followers,
              (SELECT COUNT(*)::int FROM jobs j WHERE j.posted_by = u.id) AS jobs
       FROM users u WHERE ${where.join(' AND ')}
       ORDER BY (u.business_verify_status = 'verified') DESC, followers DESC, lower(u.name) LIMIT 100`,
      params
    );
    res.json({ businesses: rows.map((u) => Object.assign(mapSearchUser(u), { followers: u.followers, jobs: u.jobs })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the directory.' }); }
});

/* ═══════════════════════════════════════════════
   TIPS  —  support a creator / business
═══════════════════════════════════════════════ */
async function recordTip(fromId, toId, amountCents, message) {
  await db.query('INSERT INTO tips (from_id, to_id, amount_cents, message) VALUES ($1,$2,$3,$4)', [fromId, toId, amountCents, message || null]);
  notify(toId, fromId, 'tip');
}
app.post('/api/tips/:userId', auth.requireAuth, rateLimit(20, 60000, 'tip'), async (req, res) => {
  const to = routeId(req.params.userId);
  if (!Number.isInteger(to)) return res.status(400).json({ error: 'Invalid user.' });
  const dollars = Math.round(Number(req.body.amount) || 0);
  if (!(dollars >= 1 && dollars <= 500)) return res.status(400).json({ error: 'Pick a tip amount between $1 and $500.' });
  const amountCents = dollars * 100;
  const message = (req.body.message || '').trim().slice(0, 200) || null;
  try {
    if (to === req.user.id) return res.status(400).json({ error: 'You can’t tip yourself.' });
    const u = await db.query('SELECT username FROM users WHERE id = $1', [to]);
    if (!u.rows[0] || !u.rows[0].username) return res.status(404).json({ error: 'User not found.' });
    if (await blockedEither(req.user.id, to)) return res.status(403).json({ error: 'You can’t tip this person.' });
    // Pay the tip from wallet balance — instant, money moves to the recipient.
    // Idempotent (a double-tap replays the first result instead of tipping twice).
    if (req.body.payWith === 'balance') {
      const cid = req.body.clientId;
      const idem = await walletClaimIdem(req.user.id, cid, 'tip');
      if (!idem.claimed) return res.json(idem.result || { ok: true, tipped: true, fromBalance: true, deduped: true });
      const bal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
      if (bal < amountCents) { await walletReleaseIdem(req.user.id, cid, 'tip'); return res.status(400).json({ error: 'Not enough wallet balance.', insufficientBalance: true }); }
      const t = await walletTransfer(req.user.id, to, amountCents, 'Tip', false);
      if (!t.ok) { await walletReleaseIdem(req.user.id, cid, 'tip'); return res.status(400).json({ error: t.insufficient ? 'Not enough wallet balance.' : 'Could not pay from balance.', insufficientBalance: !!t.insufficient }); }
      await recordTip(req.user.id, to, amountCents, message);
      rtPush(req.user.id, 'wallet', { type: 'update', amountCents });
      rtPush(to, 'wallet', { type: 'update', amountCents });
      const result = { ok: true, tipped: true, fromBalance: true };
      await walletStoreIdem(req.user.id, cid, 'tip', result);
      return res.json(result);
    }
    if (billing.isConfigured()) {
      const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
        { amountCents, productName: 'Tip to @' + u.rows[0].username, metadata: { type: 'tip', to_id: String(to), amount_cents: String(amountCents), tip_message: message || '' }, successUrl: `${origin}/?tip=success`, cancelUrl: `${origin}/?tip=cancel` }
      );
      return res.json({ url: session.url });
    }
    await recordTip(req.user.id, to, amountCents, message); // demo: instant tip
    res.json({ ok: true, tipped: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send the tip.' }); }
});
app.get('/api/tips/summary', auth.requireAuth, async (req, res) => {
  try {
    const r = await db.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(amount_cents),0)::int AS total FROM tips WHERE to_id = $1', [req.user.id]);
    res.json({ count: r.rows[0].count || 0, totalCents: r.rows[0].total || 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load.' }); }
});

/* ═══════════════════════════════════════════════
   WALLET  —  peer-to-peer money (send to a @username)
═══════════════════════════════════════════════ */
const WALLET_MIN_CENTS = 100;        // $1
const WALLET_MAX_CENTS = 200000;     // $2,000 per send/top-up
// Client idempotency for instant money moves. Claim a (user, clientId) before
// moving money; a duplicate returns the cached first response instead of moving
// money again. No clientId → no dedupe (back-compat). Returns
// { claimed:true } to proceed, or { claimed:false, result } for a duplicate.
async function walletClaimIdem(userId, clientId, kind) {
  if (!clientId) return { claimed: true };
  const cid = String(clientId).slice(0, 80);
  const ins = await db.query(
    'INSERT INTO wallet_idempotency (user_id, client_id, kind) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',
    [userId, cid, kind]
  );
  if (ins.rowCount) return { claimed: true };
  const prev = await db.query('SELECT result FROM wallet_idempotency WHERE user_id = $1 AND client_id = $2 AND kind = $3', [userId, cid, kind]);
  return { claimed: false, result: (prev.rows[0] && prev.rows[0].result) || null };
}
async function walletStoreIdem(userId, clientId, kind, body) {
  if (!clientId) return;
  await db.query('UPDATE wallet_idempotency SET result = $4 WHERE user_id = $1 AND client_id = $2 AND kind = $3', [userId, String(clientId).slice(0, 80), kind, JSON.stringify(body)]).catch(() => {});
}
// Release a claim so a genuine retry can re-run (used when the attempt errors out).
async function walletReleaseIdem(userId, clientId, kind) {
  if (!clientId) return;
  await db.query('DELETE FROM wallet_idempotency WHERE user_id = $1 AND client_id = $2 AND kind = $3', [userId, String(clientId).slice(0, 80), kind]).catch(() => {});
}
// Credit (or debit, if delta is negative) one user's balance + append a ledger row.
// MUST be called inside a transaction client so the balance + ledger stay consistent.
async function walletCredit(client, userId, deltaCents, kind, peerId, note) {
  const r = await client.query('UPDATE users SET balance_cents = balance_cents + $2 WHERE id = $1 RETURNING balance_cents', [userId, deltaCents]);
  const bal = r.rows[0].balance_cents;
  const ins = await client.query(
    'INSERT INTO wallet_tx (user_id, peer_id, kind, delta_cents, balance_after, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [userId, peerId || null, kind, deltaCents, bal, note || null]
  );
  return { balance: bal, txId: ins.rows[0].id };
}
// Atomic transfer fromId → toId. `sourceTopup` means the sender's funds came from
// an external charge (Stripe/demo), so we top them up first (net-zero to their
// balance) and then move it across — keeping the ledger and balance invariant true.
// Returns { ok } | { insufficient, balance } | { error }.
async function walletTransfer(fromId, toId, amountCents, note, sourceTopup) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    // Lock both rows in a stable order (by id) so concurrent transfers can't deadlock.
    const lock = await client.query('SELECT id, balance_cents FROM users WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[fromId, toId]]);
    const sender = lock.rows.find((r) => r.id === fromId);
    const recipient = lock.rows.find((r) => r.id === toId);
    if (!sender || !recipient) { await client.query('ROLLBACK'); return { error: 'nouser' }; }
    let bal = sender.balance_cents;
    if (sourceTopup) bal = (await walletCredit(client, fromId, amountCents, 'topup', null, 'Added funds')).balance;
    if (bal < amountCents) { await client.query('ROLLBACK'); return { insufficient: true, balance: bal }; }
    await walletCredit(client, fromId, -amountCents, 'send', toId, note);
    await walletCredit(client, toId, amountCents, 'receive', fromId, note);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
// Run a transfer, then fan out side-effects (DM money card, notification, SSE).
async function recordMoneySend(fromId, toId, amountCents, note, sourceTopup) {
  const r = await walletTransfer(fromId, toId, amountCents, note, sourceTopup);
  if (!r.ok) return r;
  try {
    if (await dmAllowed(fromId, toId)) {
      const meta = { t: 'money', amountCents, note: note || null };
      const m = await db.query(`INSERT INTO at_messages (sender_id, recipient_id, body, meta) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [fromId, toId, '', JSON.stringify(meta)]);
      const msg = { id: m.rows[0].id, body: '', image: null, images: [], media: null, media_kind: null, media_name: null, created_at: m.rows[0].created_at, reply_to: null, forwarded: false, meta };
      rtPush(toId, 'msg', { kind: 'dm', peerId: fromId, message: { ...msg, mine: false } });
      rtPush(fromId, 'msg', { kind: 'dm', peerId: toId, message: { ...msg, mine: true } });
    }
  } catch (e) { /* the money still moved even if the card fails */ }
  notify(toId, fromId, 'money_received');
  rtPush(toId, 'wallet', { type: 'receive', amountCents });
  rtPush(fromId, 'wallet', { type: 'send', amountCents });
  return { ok: true };
}
// A standalone top-up (no transfer) — credit a user's own balance.
async function recordTopup(userId, amountCents) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await walletCredit(client, userId, amountCents, 'topup', null, 'Added funds');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  rtPush(userId, 'wallet', { type: 'topup', amountCents });
  return true;
}
// Credit a user's balance in its own transaction with an explicit ledger `kind`
// (used to reverse a rejected cash-out without mislabeling it as a top-up).
async function walletCreditStandalone(userId, amountCents, kind, note) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await walletCredit(client, userId, amountCents, kind, null, note);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  rtPush(userId, 'wallet', { type: 'update', amountCents });
  return true;
}
function parseWalletAmount(v) {
  const cents = Math.round(Number(v) * 100);
  if (!(Number.isFinite(cents) && cents >= WALLET_MIN_CENTS && cents <= WALLET_MAX_CENTS)) return null;
  return cents;
}
// Wallet overview: balance + recent transaction history (with the other party).
app.get('/api/wallet', auth.requireAuth, async (req, res) => {
  try {
    const me = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0] || { balance_cents: 0 };
    const tx = await db.query(
      `SELECT w.id, w.kind, w.delta_cents, w.balance_after, w.note, w.created_at,
              u.id AS peer_id, u.name AS peer_name, u.username AS peer_username, u.avatar AS peer_avatar, u.account_type AS peer_type
         FROM wallet_tx w LEFT JOIN users u ON u.id = w.peer_id
        WHERE w.user_id = $1 ORDER BY w.created_at DESC, w.id DESC LIMIT 60`,
      [req.user.id]
    );
    res.json({
      balanceCents: me.balance_cents || 0,
      transactions: tx.rows.map((r) => ({
        id: r.id, kind: r.kind, deltaCents: r.delta_cents, balanceAfter: r.balance_after,
        note: r.note || null, createdAt: r.created_at,
        peer: r.peer_id ? { id: r.peer_id, name: r.peer_name, username: r.peer_username, avatar: r.peer_avatar || null, accountType: r.peer_type === 'business' ? 'business' : 'personal' } : null,
      })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load your wallet.' }); }
});
// Add money to your own balance (Stripe Checkout, or a demo grant without Stripe).
app.post('/api/wallet/topup', auth.requireAuth, rateLimit(20, 60000, 'wallet-topup'), async (req, res) => {
  const amountCents = parseWalletAmount(req.body.amount);
  if (amountCents === null) return res.status(400).json({ error: 'Enter an amount between $1 and $2,000.' });
  try {
    if (!(await requireHandle(req, res))) return;
    if (billing.isConfigured()) {
      const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
        { amountCents, productName: 'Add money to your Atwe wallet', metadata: { type: 'wallet_topup', amount_cents: String(amountCents) }, successUrl: `${origin}/?topup=success`, cancelUrl: `${origin}/?topup=cancel` }
      );
      return res.json({ url: session.url });
    }
    // Demo grant — idempotent so a double-tap doesn't credit twice.
    const cid = req.body.clientId;
    const idem = await walletClaimIdem(req.user.id, cid, 'topup');
    if (!idem.claimed) return res.json(idem.result || { ok: true, added: true, deduped: true });
    await recordTopup(req.user.id, amountCents); // demo: instant credit
    const bal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
    const result = { ok: true, added: true, balanceCents: bal };
    await walletStoreIdem(req.user.id, cid, 'topup', result);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add money.' }); }
});
// Send money to another username. Pays instantly from balance when it covers the
// amount; otherwise charges the sender (Stripe/demo) for the full amount.
app.post('/api/wallet/send', auth.requireAuth, rateLimit(20, 60000, 'wallet-send'), async (req, res) => {
  const amountCents = parseWalletAmount(req.body.amount);
  if (amountCents === null) return res.status(400).json({ error: 'Enter an amount between $1 and $2,000.' });
  const note = (req.body.note || '').toString().trim().slice(0, 200) || null;
  try {
    if (!(await requireHandle(req, res))) return;
    // Resolve the recipient — by id or by @username.
    let toRow;
    if (req.body.toId != null && String(req.body.toId).length) {
      const tid = parseInt(req.body.toId, 10);
      if (Number.isInteger(tid)) toRow = (await db.query('SELECT id, name, username FROM users WHERE id = $1', [tid])).rows[0];
    } else {
      const uname = String(req.body.to || '').trim().replace(/^@/, '').slice(0, 40);
      if (uname) toRow = (await db.query('SELECT id, name, username FROM users WHERE lower(username) = lower($1)', [uname])).rows[0];
    }
    if (!toRow || !toRow.username) return res.status(404).json({ error: 'No one found with that username.' });
    if (toRow.id === req.user.id) return res.status(400).json({ error: 'You can’t send money to yourself.' });
    if (await blockedEither(req.user.id, toRow.id)) return res.status(403).json({ error: 'You can’t send money to this person.' });
    const bal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
    const cid = req.body.clientId;
    if (bal >= amountCents) {
      // Pay instantly from balance. Idempotent: a double-tap replays the first result.
      const idem = await walletClaimIdem(req.user.id, cid, 'send');
      if (!idem.claimed) return res.json(idem.result || { ok: true, paid: true, fromBalance: true, deduped: true });
      const r = await recordMoneySend(req.user.id, toRow.id, amountCents, note, false);
      if (r.insufficient) { await walletReleaseIdem(req.user.id, cid, 'send'); return res.status(400).json({ error: 'Insufficient balance.' }); } // race: balance moved
      if (!r.ok) { await walletReleaseIdem(req.user.id, cid, 'send'); return res.status(400).json({ error: 'Could not send the money.' }); }
      const newBal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
      const result = { ok: true, paid: true, fromBalance: true, balanceCents: newBal, to: { id: toRow.id, name: toRow.name, username: toRow.username } };
      await walletStoreIdem(req.user.id, cid, 'send', result);
      return res.json(result);
    }
    // Not enough balance — charge the full amount.
    if (billing.isConfigured()) {
      const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
        { amountCents, productName: 'Send money to @' + toRow.username, metadata: { type: 'wallet_send', to_id: String(toRow.id), amount_cents: String(amountCents), pay_note: note || '' }, successUrl: `${origin}/?pay=success`, cancelUrl: `${origin}/?pay=cancel` }
      );
      return res.json({ url: session.url });
    }
    const idem = await walletClaimIdem(req.user.id, cid, 'send');
    if (!idem.claimed) return res.json(idem.result || { ok: true, paid: true, demo: true, deduped: true });
    const r = await recordMoneySend(req.user.id, toRow.id, amountCents, note, true); // demo: charge + deliver
    if (!r.ok) { await walletReleaseIdem(req.user.id, cid, 'send'); return res.status(400).json({ error: 'Could not send the money.' }); }
    const result = { ok: true, paid: true, demo: true, to: { id: toRow.id, name: toRow.name, username: toRow.username } };
    await walletStoreIdem(req.user.id, cid, 'send', result);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send the money.' }); }
});
const CASHOUT_MAX_CENTS = 1000000; // $10,000 per cash-out
// Atomically debit a user's balance + append a ledger row. Returns
// { ok, balance, txId } | { insufficient } | { error }.
async function walletDebit(userId, amountCents, kind, note) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!r.rows[0]) { await client.query('ROLLBACK'); return { error: 'nouser' }; }
    if (r.rows[0].balance_cents < amountCents) { await client.query('ROLLBACK'); return { insufficient: true }; }
    const credited = await walletCredit(client, userId, -amountCents, kind, null, note);
    await client.query('COMMIT');
    return { ok: true, balance: credited.balance, txId: credited.txId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
// Cash-out readiness: is Stripe/Connect configured, has the user onboarded, are
// payouts enabled on their connected account?
app.get('/api/wallet/cashout-status', auth.requireAuth, async (req, res) => {
  try {
    const u = (await db.query('SELECT balance_cents, stripe_connect_id, connect_payouts_enabled FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    const configured = billing.isConnectConfigured();
    // The `account.updated` webhook keeps `connect_payouts_enabled` current; fall
    // back to a live check (self-healing) when it's not yet true, in case webhooks
    // aren't configured or a delivery was missed.
    let payoutsEnabled = !!u.connect_payouts_enabled;
    if (configured && u.stripe_connect_id && !payoutsEnabled) {
      try {
        const acct = await billing.getConnectAccount(u.stripe_connect_id);
        payoutsEnabled = !!acct.payouts_enabled;
        if (payoutsEnabled) await db.query('UPDATE users SET connect_payouts_enabled = true WHERE id = $1', [req.user.id]);
      } catch (e) { /* keep the stored value */ }
    }
    res.json({ configured, connected: !!u.stripe_connect_id, payoutsEnabled, balanceCents: u.balance_cents || 0 });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not check cash-out status.' }); }
});
// Begin (or resume) Stripe Connect onboarding — returns a hosted account link.
app.post('/api/wallet/connect', auth.requireAuth, rateLimit(10, 60000, 'wallet-connect'), async (req, res) => {
  try {
    if (!billing.isConnectConfigured()) return res.status(503).json({ error: 'Cashing out to a bank isn’t set up yet.' });
    const u = (await db.query('SELECT email, stripe_connect_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    let acct = u.stripe_connect_id;
    if (!acct) {
      const created = await billing.createConnectAccount({ id: req.user.id, email: u.email });
      acct = created.id;
      await db.query('UPDATE users SET stripe_connect_id = $2 WHERE id = $1', [req.user.id, acct]);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const link = await billing.createAccountLink(acct, `${origin}/?cashout=refresh`, `${origin}/?cashout=ready`);
    res.json({ url: link.url });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start bank setup.' }); }
});
// Cash out wallet balance to the user's bank (Stripe payout), or a demo cash-out
// when Connect isn't configured (debits balance + records it, no real money).
app.post('/api/wallet/cashout', auth.requireAuth, rateLimit(10, 60000, 'wallet-cashout'), async (req, res) => {
  const amountCents = Math.round(Number(req.body.amount) * 100);
  if (!(Number.isFinite(amountCents) && amountCents >= WALLET_MIN_CENTS && amountCents <= CASHOUT_MAX_CENTS)) {
    return res.status(400).json({ error: 'Enter an amount between $1 and $10,000.' });
  }
  try {
    const u = (await db.query('SELECT balance_cents, stripe_connect_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
    if ((u.balance_cents || 0) < amountCents) return res.status(400).json({ error: 'Not enough wallet balance.', insufficientBalance: true });
    const cid = req.body.clientId;
    if (billing.isConnectConfigured()) {
      // Real payout path — must be onboarded with payouts enabled.
      if (!u.stripe_connect_id) return res.status(400).json({ error: 'Set up your bank first.', needsOnboarding: true });
      const acct = await billing.getConnectAccount(u.stripe_connect_id);
      if (!acct.payouts_enabled) return res.status(400).json({ error: 'Finish setting up your bank first.', needsOnboarding: true });
      // Idempotent: a double-tap can't debit/pay out twice.
      const idem = await walletClaimIdem(req.user.id, cid, 'cashout');
      if (!idem.claimed) return res.json(idem.result || { ok: true, cashedOut: true, deduped: true });
      // Reserve the funds, then transfer. The ledger row id is the Stripe
      // idempotency key, so a retried transfer can never pay out twice.
      const d = await walletDebit(req.user.id, amountCents, 'cashout', 'Cash out to bank');
      if (d.insufficient) { await walletReleaseIdem(req.user.id, cid, 'cashout'); return res.status(400).json({ error: 'Not enough wallet balance.', insufficientBalance: true }); }
      if (!d.ok) { await walletReleaseIdem(req.user.id, cid, 'cashout'); return res.status(400).json({ error: 'Could not cash out.' }); }
      try {
        await billing.createPayout(u.stripe_connect_id, amountCents, 'cashout_' + d.txId);
      } catch (e) {
        // Only refund when Stripe DEFINITIVELY rejected the transfer (a bad request
        // or card error). On an ambiguous failure (network/timeout/rate-limit) the
        // transfer may actually have gone through, so refunding would pay the user
        // twice — keep the debit and surface it for reconciliation instead.
        const definite = e && (e.type === 'StripeInvalidRequestError' || e.type === 'StripeCardError');
        if (definite) {
          // Reverse the debit with a properly-labelled ledger row. If the reversal
          // itself fails, surface it (don't silently strand the user's money).
          try { await walletCreditStandalone(req.user.id, amountCents, 'cashout_refund', 'Cash-out reversed'); }
          catch (re) { console.error('CRITICAL: cash-out reversal failed, balance debited:', re.message); }
          await walletReleaseIdem(req.user.id, cid, 'cashout'); // failed cleanly → a fresh retry is fine
          console.error('payout rejected, refunded balance:', e.message);
          return res.status(502).json({ error: 'The payout failed — your balance was not charged.' });
        }
        // Ambiguous → keep both the debit AND the idempotency claim, so a same-id
        // retry replays (no second debit) rather than risking a double payout.
        console.error('payout ambiguous (balance kept debited for reconciliation):', e.message);
        return res.status(502).json({ error: 'We couldn’t confirm the payout. If your balance was debited but no transfer arrives, contact support.' });
      }
      rtPush(req.user.id, 'wallet', { type: 'update', amountCents });
      const result = { ok: true, cashedOut: true, balanceCents: d.balance };
      await walletStoreIdem(req.user.id, cid, 'cashout', result);
      return res.json(result);
    }
    // Demo path (no Stripe): just debit + record, return the new balance.
    const idem = await walletClaimIdem(req.user.id, cid, 'cashout');
    if (!idem.claimed) return res.json(idem.result || { ok: true, cashedOut: true, demo: true, deduped: true });
    const d = await walletDebit(req.user.id, amountCents, 'cashout', 'Cash out (demo)');
    if (d.insufficient) { await walletReleaseIdem(req.user.id, cid, 'cashout'); return res.status(400).json({ error: 'Not enough wallet balance.', insufficientBalance: true }); }
    if (!d.ok) { await walletReleaseIdem(req.user.id, cid, 'cashout'); return res.status(400).json({ error: 'Could not cash out.' }); }
    rtPush(req.user.id, 'wallet', { type: 'update', amountCents });
    const result = { ok: true, cashedOut: true, demo: true, balanceCents: d.balance };
    await walletStoreIdem(req.user.id, cid, 'cashout', result);
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not cash out.' }); }
});

/* ═══════════════════════════════════════════════
   INVOICES  —  the "get paid" layer (issue → pay in chat)
═══════════════════════════════════════════════ */
function invoiceStatus(r) {
  // "overdue" is derived (an unpaid invoice past its due date).
  if (r.status === 'sent' && r.due_at && new Date(r.due_at).getTime() < Date.now()) return 'overdue';
  return r.status;
}
function mapInvoice(r, me) {
  return {
    id: r.id, title: r.title, items: Array.isArray(r.items) ? r.items : [], amountCents: r.amount_cents,
    note: r.note || null, dueAt: r.due_at || null, status: invoiceStatus(r), createdAt: r.created_at, paidAt: r.paid_at || null,
    mine: r.issuer_id === me, // I issued it (vs I'm the customer)
    issuer: { id: r.issuer_id, name: r.issuer_name, username: r.issuer_username, avatar: r.issuer_avatar || null },
    customer: { id: r.customer_id, name: r.customer_name, username: r.customer_username, avatar: r.customer_avatar || null },
  };
}
const INVOICE_SELECT = `SELECT i.id, i.issuer_id, i.customer_id, i.title, i.items, i.amount_cents, i.note, i.due_at, i.status, i.created_at, i.paid_at,
  iu.name AS issuer_name, iu.username AS issuer_username, iu.avatar AS issuer_avatar,
  cu.name AS customer_name, cu.username AS customer_username, cu.avatar AS customer_avatar
  FROM invoices i JOIN users iu ON iu.id = i.issuer_id JOIN users cu ON cu.id = i.customer_id`;
// Mark an invoice paid (shared by the demo path + the Stripe webhook). Notifies
// the issuer and pushes a live `invoice` update to both parties.
async function recordInvoicePaid(invoiceId) {
  // Only an outstanding ('sent') invoice can be paid — a cancelled one stays
  // cancelled even if a stale Stripe session completes, and a re-delivered
  // webhook on an already-paid invoice is a no-op.
  const { rows } = await db.query("UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'sent' RETURNING issuer_id, customer_id", [invoiceId]);
  if (!rows[0]) return false;
  const { issuer_id, customer_id } = rows[0];
  notify(issuer_id, customer_id, 'invoice_paid');
  rtPush(issuer_id, 'invoice', { id: invoiceId, status: 'paid' });
  rtPush(customer_id, 'invoice', { id: invoiceId, status: 'paid' });
  return true;
}
// Issue an invoice to another user (and drop a Pay card into the DM thread).
app.post('/api/invoices', auth.requireAuth, rateLimit(30, 60000, 'invoice-create'), async (req, res) => {
  const customerId = parseInt(req.body.customerId, 10);
  if (!Number.isInteger(customerId)) return res.status(400).json({ error: 'Choose who to invoice.' });
  if (customerId === req.user.id) return res.status(400).json({ error: 'You can’t invoice yourself.' });
  const title = (req.body.title || '').toString().trim().slice(0, 140);
  if (!title) return res.status(400).json({ error: 'Add a title for the invoice.' });
  // Line items (optional) — each {description, amountCents}; the total is the sum
  // if items are given, otherwise the provided amount.
  let items = null, amountCents;
  if (Array.isArray(req.body.items) && req.body.items.length) {
    items = req.body.items.map((it) => ({ description: (it && it.description || '').toString().trim().slice(0, 120), amountCents: Math.round(Number(it && it.amountCents) || 0) }))
      .filter((it) => it.description && it.amountCents > 0).slice(0, 20);
    amountCents = items.reduce((s, it) => s + it.amountCents, 0);
  } else {
    amountCents = Math.round(Number(req.body.amountCents) || 0);
  }
  if (!(amountCents >= 100 && amountCents <= 1000000)) return res.status(400).json({ error: 'The amount must be between $1 and $10,000.' });
  const note = (req.body.note || '').toString().trim().slice(0, 500) || null;
  let dueAt = null;
  if (req.body.dueAt) { const d = new Date(req.body.dueAt); if (!isNaN(d.getTime())) dueAt = d.toISOString(); }
  try {
    if (!(await requireHandle(req, res))) return;
    const cust = (await db.query('SELECT id, username FROM users WHERE id = $1', [customerId])).rows[0];
    if (!cust || !cust.username) return res.status(404).json({ error: 'Customer not found.' });
    if (await blockedEither(req.user.id, customerId)) return res.status(403).json({ error: 'You can’t invoice this person.' });
    const ins = await db.query(
      `INSERT INTO invoices (issuer_id, customer_id, title, items, amount_cents, note, due_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.user.id, customerId, title, items ? JSON.stringify(items) : null, amountCents, note, dueAt]
    );
    const id = ins.rows[0].id;
    // Drop an invoice card into the DM thread (server-built meta; not client-forgeable).
    // Respect the recipient's DM privacy: if they don't accept DMs from you, the
    // invoice + its notification still land (in their Received list) — just no card.
    try {
      if (!(await dmAllowed(req.user.id, customerId))) throw new Error('dm-not-allowed');
      const meta = { t: 'invoice', id, title, amountCents };
      const m = await db.query(
        `INSERT INTO at_messages (sender_id, recipient_id, body, meta) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
        [req.user.id, customerId, '', JSON.stringify(meta)]
      );
      const msg = { id: m.rows[0].id, body: '', image: null, images: [], media: null, media_kind: null, media_name: null, created_at: m.rows[0].created_at, reply_to: null, forwarded: false, meta };
      rtPush(customerId, 'msg', { kind: 'dm', peerId: req.user.id, message: { ...msg, mine: false } });
      rtPush(req.user.id, 'msg', { kind: 'dm', peerId: customerId, message: { ...msg, mine: true } });
    } catch (e) { /* the invoice still exists even if the chat card fails */ }
    notify(customerId, req.user.id, 'invoice');
    const det = await db.query(INVOICE_SELECT + ' WHERE i.id = $1', [id]);
    res.status(201).json({ invoice: mapInvoice(det.rows[0], req.user.id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the invoice.' }); }
});
// List my invoices: scope=sent (I issued) | received (billed to me).
app.get('/api/invoices', auth.requireAuth, async (req, res) => {
  const scope = req.query.scope === 'sent' ? 'sent' : 'received';
  try {
    const where = scope === 'sent' ? 'WHERE i.issuer_id = $1' : 'WHERE i.customer_id = $1';
    const { rows } = await db.query(INVOICE_SELECT + ' ' + where + ' ORDER BY i.created_at DESC LIMIT 200', [req.user.id]);
    res.json({ invoices: rows.map((r) => mapInvoice(r, req.user.id)) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load invoices.' }); }
});
// Invoice detail (issuer or customer only).
app.get('/api/invoices/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query(INVOICE_SELECT + ' WHERE i.id = $1', [id]);
    const inv = r.rows[0];
    if (!inv || (inv.issuer_id !== req.user.id && inv.customer_id !== req.user.id)) return res.status(404).json({ error: 'Invoice not found.' });
    res.json({ invoice: mapInvoice(inv, req.user.id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the invoice.' }); }
});
// Pay an invoice (customer only). Stripe Checkout, or demo-grant when unconfigured.
app.post('/api/invoices/:id/pay', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const inv = (await db.query('SELECT id, issuer_id, customer_id, title, amount_cents, status FROM invoices WHERE id = $1', [id])).rows[0];
    if (!inv || inv.customer_id !== req.user.id) return res.status(404).json({ error: 'Invoice not found.' });
    if (inv.status === 'paid') return res.json({ ok: true, paid: true });
    if (inv.status === 'cancelled') return res.status(400).json({ error: 'This invoice was cancelled.' });
    if (billing.isConfigured()) {
      const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
        { amountCents: inv.amount_cents, productName: 'Invoice: ' + inv.title, metadata: { type: 'invoice', invoice_id: String(id) }, successUrl: `${origin}/?invoice=success`, cancelUrl: `${origin}/?invoice=cancel` }
      );
      return res.json({ url: session.url });
    }
    await recordInvoicePaid(id); // demo: mark paid instantly
    res.json({ ok: true, paid: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not pay the invoice.' }); }
});
// Cancel an invoice (issuer only, while unpaid).
app.post('/api/invoices/:id/cancel', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1 AND issuer_id = $2 AND status = 'sent' RETURNING customer_id", [id, req.user.id]);
    if (!r.rowCount) return res.status(400).json({ error: 'That invoice can’t be cancelled.' });
    rtPush(r.rows[0].customer_id, 'invoice', { id, status: 'cancelled' });
    res.json({ ok: true, status: 'cancelled' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not cancel.' }); }
});

/* ═══════════════════════════════════════════════
   SHOP  —  products, cart, orders (chat-coordinated commerce)
═══════════════════════════════════════════════ */
const PRODUCT_KINDS = ['physical', 'digital', 'service'];
function mapProduct(p) {
  return { id: p.id, businessId: p.business_id, name: p.name, description: p.description || null, priceCents: p.price_cents, image: p.image || null, kind: PRODUCT_KINDS.includes(p.kind) ? p.kind : 'physical', active: p.active !== false };
}
// A business's products (active only for non-owners; the owner sees all + manages).
app.get('/api/businesses/:id/products', auth.requireAuth, async (req, res) => {
  const bid = routeId(req.params.id);
  if (!Number.isInteger(bid)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const owner = bid === req.user.id;
    const { rows } = await db.query(
      `SELECT id, business_id, name, description, price_cents, image, kind, active FROM products WHERE business_id = $1 ${owner ? '' : 'AND active = true'} ORDER BY created_at DESC LIMIT 200`,
      [bid]
    );
    res.json({ products: rows.map(mapProduct), owner });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load products.' }); }
});
// A listing for the marketplace / search: a product + its seller (so a card can
// render post-style and link to a business storefront).
function mapListing(r) {
  return Object.assign(mapProduct(r), {
    seller: { id: r.business_id, name: r.seller_name, username: r.seller_username, avatar: r.seller_avatar || null, accountType: r.seller_account_type === 'business' ? 'business' : 'personal', verified: !!r.seller_verified },
    createdAt: r.created_at,
  });
}
const LISTING_SELECT = `SELECT p.id, p.business_id, p.name, p.description, p.price_cents, p.image, p.kind, p.active, p.created_at,
  u.name AS seller_name, u.username AS seller_username, u.avatar AS seller_avatar, u.account_type AS seller_account_type, u.verified AS seller_verified
  FROM products p JOIN users u ON u.id = p.business_id`;
// Marketplace browse + search: active listings, optional q (name/description) and
// kind filter. Blocks-aware (you don't see a seller who blocked you / you them).
app.get('/api/marketplace', auth.requireAuth, async (req, res) => {
  const q = (req.query.q || '').toString().trim().slice(0, 80);
  const kind = PRODUCT_KINDS.includes(req.query.kind) ? req.query.kind : null;
  try {
    const params = [req.user.id]; const conds = ['p.active = true'];
    conds.push(`p.business_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1) AND p.business_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $1)`);
    if (q) { params.push('%' + q + '%'); conds.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
    if (kind) { params.push(kind); conds.push(`p.kind = $${params.length}`); }
    const { rows } = await db.query(`${LISTING_SELECT} WHERE ${conds.join(' AND ')} ORDER BY p.created_at DESC LIMIT 60`, params);
    res.json({ listings: rows.map(mapListing) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the marketplace.' }); }
});
// My own listings (any account) — for the Sell / manage surface.
app.get('/api/my-listings', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, business_id, name, description, price_cents, image, kind, active FROM products WHERE business_id = $1 ORDER BY created_at DESC LIMIT 300', [req.user.id]);
    res.json({ products: rows.map(mapProduct) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load your listings.' }); }
});
// A single listing (with seller) — the "view more" detail.
app.get('/api/listings/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query(LISTING_SELECT + ' WHERE p.id = $1', [id]);
    const l = r.rows[0];
    if (!l || (!l.active && l.business_id !== req.user.id)) return res.status(404).json({ error: 'That listing is no longer available.' });
    res.json({ listing: mapListing(l) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the listing.' }); }
});
// Post a listing (item or service). Anyone with a @username can sell — a business
// account also gets a storefront on its profile; a personal account sells without one.
app.post('/api/products', auth.requireAuth, rateLimit(40, 60000, 'product-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const name = (req.body.name || '').toString().trim().slice(0, 140);
  if (!name) return res.status(400).json({ error: 'Give the product a name.' });
  const priceCents = Math.round(Number(req.body.priceCents) || 0);
  if (!(priceCents >= 0 && priceCents <= 5000000)) return res.status(400).json({ error: 'Enter a valid price (up to $50,000).' });
  const kind = PRODUCT_KINDS.includes(req.body.kind) ? req.body.kind : 'physical';
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 300) return res.status(400).json({ error: 'You’ve reached the maximum number of products.' });
    const { rows } = await db.query(
      `INSERT INTO products (business_id, name, description, price_cents, image, kind) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, business_id, name, description, price_cents, image, kind, active`,
      [req.user.id, name, (req.body.description || '').toString().trim().slice(0, 1000) || null, priceCents, image, kind]
    );
    res.status(201).json({ product: mapProduct(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the product.' }); }
});
app.patch('/api/products/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const fields = [], vals = [];
  if ('name' in req.body) { const n = (req.body.name || '').toString().trim().slice(0, 140); if (!n) return res.status(400).json({ error: 'Name can’t be empty.' }); vals.push(n); fields.push(`name = $${vals.length}`); }
  if ('description' in req.body) { vals.push((req.body.description || '').toString().trim().slice(0, 1000) || null); fields.push(`description = $${vals.length}`); }
  if ('priceCents' in req.body) { const pc = Math.round(Number(req.body.priceCents) || 0); if (!(pc >= 0 && pc <= 5000000)) return res.status(400).json({ error: 'Invalid price.' }); vals.push(pc); fields.push(`price_cents = $${vals.length}`); }
  if ('kind' in req.body) { vals.push(PRODUCT_KINDS.includes(req.body.kind) ? req.body.kind : 'physical'); fields.push(`kind = $${vals.length}`); }
  if ('active' in req.body) { vals.push(req.body.active !== false); fields.push(`active = $${vals.length}`); }
  if ('image' in req.body) { const img = cleanImage(req.body.image); if (img === undefined) return res.status(400).json({ error: 'That image could not be used.' }); vals.push(img); fields.push(`image = $${vals.length}`); }
  if (!fields.length) return res.json({ ok: true });
  try {
    vals.push(id, req.user.id);
    const r = await db.query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${vals.length - 1} AND business_id = $${vals.length} RETURNING id, business_id, name, description, price_cents, image, kind, active`, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ product: mapProduct(r.rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the product.' }); }
});
app.delete('/api/products/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM products WHERE id = $1 AND business_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the product.' }); }
});

/* ─── Cart (per-buyer; grouped by seller at checkout) ─── */
app.get('/api/cart', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.product_id, c.qty, p.name, p.price_cents, p.image, p.kind, p.active, p.business_id,
              b.name AS biz_name, b.username AS biz_username, b.avatar AS biz_avatar
       FROM cart_items c JOIN products p ON p.id = c.product_id JOIN users b ON b.id = p.business_id
       WHERE c.user_id = $1 ORDER BY p.business_id, c.created_at`,
      [req.user.id]
    );
    // Group into one cart per seller (an order goes to a single business).
    const bySeller = new Map();
    for (const r of rows) {
      if (!r.active) continue; // a since-deactivated product drops out
      if (!bySeller.has(r.business_id)) bySeller.set(r.business_id, { seller: { id: r.business_id, name: r.biz_name, username: r.biz_username, avatar: r.biz_avatar || null }, items: [], totalCents: 0 });
      const g = bySeller.get(r.business_id);
      g.items.push({ productId: r.product_id, name: r.name, priceCents: r.price_cents, image: r.image || null, kind: r.kind, qty: r.qty });
      g.totalCents += r.price_cents * r.qty;
    }
    res.json({ carts: [...bySeller.values()] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load your cart.' }); }
});
// Add / set the quantity of a product in the cart (qty 0 removes it).
app.post('/api/cart', auth.requireAuth, async (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  // Default to 1 only when qty is absent — an explicit 0 must mean "remove".
  const rawQty = Number(req.body.qty);
  const qty = Number.isFinite(rawQty) ? Math.max(0, Math.min(99, Math.round(rawQty))) : 1;
  try {
    const p = (await db.query('SELECT business_id, active FROM products WHERE id = $1', [productId])).rows[0];
    if (!p || !p.active) return res.status(404).json({ error: 'That product isn’t available.' });
    if (p.business_id === req.user.id) return res.status(400).json({ error: 'You can’t buy your own product.' });
    if (qty === 0) { await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, productId]); return res.json({ ok: true, removed: true }); }
    await db.query('INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1,$2,$3) ON CONFLICT (user_id, product_id) DO UPDATE SET qty = $3', [req.user.id, productId, qty]);
    res.json({ ok: true, qty });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update your cart.' }); }
});
app.delete('/api/cart/:productId', auth.requireAuth, async (req, res) => {
  const productId = routeId(req.params.productId);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  try { await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user.id, productId]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not update your cart.' }); }
});

/* ─── Orders ─── */
function mapOrder(o, items, me) {
  return {
    id: o.id, status: o.status, totalCents: o.total_cents, note: o.note || null, createdAt: o.created_at, paidAt: o.paid_at || null,
    mine: o.seller_id === me, // I'm the seller (vs the buyer)
    escrow: !!o.escrow, autoReleaseAt: o.auto_release_at || null, releasedAt: o.released_at || null,
    disputeReason: o.dispute_reason || null, disputedByMe: o.disputed_by === me,
    buyer: { id: o.buyer_id, name: o.buyer_name, username: o.buyer_username, avatar: o.buyer_avatar || null },
    seller: { id: o.seller_id, name: o.seller_name, username: o.seller_username, avatar: o.seller_avatar || null },
    items: (items || []).map((it) => ({ name: it.name, priceCents: it.price_cents, qty: it.qty })),
  };
}
const ORDER_SELECT = `SELECT o.id, o.buyer_id, o.seller_id, o.total_cents, o.status, o.note, o.created_at, o.paid_at,
  o.escrow, o.auto_release_at, o.released_at, o.dispute_reason, o.disputed_by,
  bu.name AS buyer_name, bu.username AS buyer_username, bu.avatar AS buyer_avatar,
  su.name AS seller_name, su.username AS seller_username, su.avatar AS seller_avatar
  FROM orders o JOIN users bu ON bu.id = o.buyer_id JOIN users su ON su.id = o.seller_id`;
// Mark an order paid (demo path + webhook): drop an order card into the DM thread,
// notify the seller, and clear the buyer's cart for that seller.
async function recordOrderPaid(orderId) {
  const o = (await db.query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1 AND status = 'pending' RETURNING buyer_id, seller_id, total_cents", [orderId])).rows[0];
  if (!o) return false;
  // Clear the bought items from the buyer's cart (products belonging to this seller).
  await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id IN (SELECT id FROM products WHERE business_id = $2)', [o.buyer_id, o.seller_id]).catch(() => {});
  try {
    if (await dmAllowed(o.buyer_id, o.seller_id)) {
      const meta = { t: 'order', id: orderId, totalCents: o.total_cents };
      const m = await db.query(`INSERT INTO at_messages (sender_id, recipient_id, body, meta) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [o.buyer_id, o.seller_id, '', JSON.stringify(meta)]);
      const msg = { id: m.rows[0].id, body: '', image: null, images: [], media: null, media_kind: null, media_name: null, created_at: m.rows[0].created_at, reply_to: null, forwarded: false, meta };
      rtPush(o.seller_id, 'msg', { kind: 'dm', peerId: o.buyer_id, message: { ...msg, mine: false } });
      rtPush(o.buyer_id, 'msg', { kind: 'dm', peerId: o.seller_id, message: { ...msg, mine: true } });
    }
  } catch (e) { /* order still placed even if the card fails */ }
  notify(o.seller_id, o.buyer_id, 'order');
  rtPush(o.buyer_id, 'order', { id: orderId, status: 'paid' });
  return true;
}
// Pay a pending order from the buyer's wallet balance — the money lands in the
// seller's balance (internal transfer), then the order is marked paid.
async function payOrderFromBalance(buyerId, sellerId, orderId, totalCents) {
  const t = await walletTransfer(buyerId, sellerId, totalCents, 'Order payment', false);
  if (!t.ok) return t;
  await recordOrderPaid(orderId);
  rtPush(buyerId, 'wallet', { type: 'update', amountCents: totalCents });
  rtPush(sellerId, 'wallet', { type: 'update', amountCents: totalCents });
  return { ok: true };
}

/* ── Escrow / buyer protection ──
   A protected order debits the buyer's balance into escrow (held off any user's
   balance), then settles to the seller on release or back to the buyer on refund —
   so the ledger stays zero-sum. */
const ESCROW_AUTO_DAYS = 7; // auto-release window if the buyer never confirms
// Fund a freshly-created order into escrow from the buyer's balance, then stamp it
// 'escrow' — in ONE transaction so a crash can't debit the buyer without holding
// the order (which would strand the funds). Side-effects (card/notify) run after
// commit. Returns { ok } | { insufficient } | { error }.
async function fundEscrowOrder(buyerId, sellerId, orderId, totalCents) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT balance_cents FROM users WHERE id = $1 FOR UPDATE', [buyerId]);
    if (!r.rows[0]) { await client.query('ROLLBACK'); return { error: 'nouser' }; }
    if (r.rows[0].balance_cents < totalCents) { await client.query('ROLLBACK'); return { insufficient: true }; }
    await walletCredit(client, buyerId, -totalCents, 'escrow_hold', null, 'Held in escrow');
    await client.query(
      `UPDATE orders SET status = 'escrow', escrow = true, paid_at = now(), auto_release_at = now() + ($2 * interval '1 day') WHERE id = $1`,
      [orderId, ESCROW_AUTO_DAYS]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id IN (SELECT id FROM products WHERE business_id = $2)', [buyerId, sellerId]).catch(() => {});
  try {
    if (await dmAllowed(buyerId, sellerId)) {
      const meta = { t: 'order', id: orderId, totalCents, escrow: true };
      const m = await db.query(`INSERT INTO at_messages (sender_id, recipient_id, body, meta) VALUES ($1,$2,$3,$4) RETURNING id, created_at`, [buyerId, sellerId, '', JSON.stringify(meta)]);
      const msg = { id: m.rows[0].id, body: '', image: null, images: [], media: null, media_kind: null, media_name: null, created_at: m.rows[0].created_at, reply_to: null, forwarded: false, meta };
      rtPush(sellerId, 'msg', { kind: 'dm', peerId: buyerId, message: { ...msg, mine: false } });
      rtPush(buyerId, 'msg', { kind: 'dm', peerId: sellerId, message: { ...msg, mine: true } });
    }
  } catch (e) { /* order still funded even if the card fails */ }
  notify(sellerId, buyerId, 'order');
  rtPush(buyerId, 'wallet', { type: 'update', amountCents: totalCents });
  rtPush(buyerId, 'order', { id: orderId, status: 'escrow' });
  rtPush(sellerId, 'order', { id: orderId, status: 'escrow' });
  return { ok: true };
}
// Settle a held escrow in ONE transaction — flip the order status AND move the
// money together, so a crash can't mark it settled without paying out (which would
// destroy the held funds). `to` = 'seller' (release) or 'buyer' (refund). The
// status guard keeps it idempotent (a double-resolve / auto-flush race is a no-op).
async function settleEscrow(orderId, to) {
  const newStatus = to === 'buyer' ? 'refunded' : 'released';
  const client = await db.getPool().connect();
  let o;
  try {
    await client.query('BEGIN');
    o = (await client.query("UPDATE orders SET status = $2, released_at = now() WHERE id = $1 AND status IN ('escrow','disputed') RETURNING buyer_id, seller_id, total_cents", [orderId, newStatus])).rows[0];
    if (!o) { await client.query('ROLLBACK'); return false; }
    const payee = to === 'buyer' ? o.buyer_id : o.seller_id;
    await walletCredit(client, payee, o.total_cents, to === 'buyer' ? 'escrow_refund' : 'escrow_release', null, to === 'buyer' ? 'Escrow refunded' : 'Escrow released');
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  if (to === 'buyer') {
    notify(o.buyer_id, o.seller_id, 'escrow_refunded');
    rtPush(o.buyer_id, 'wallet', { type: 'receive', amountCents: o.total_cents });
  } else {
    notify(o.seller_id, o.buyer_id, 'escrow_released');
    rtPush(o.seller_id, 'wallet', { type: 'receive', amountCents: o.total_cents });
  }
  rtPush(o.buyer_id, 'order', { id: orderId, status: newStatus });
  rtPush(o.seller_id, 'order', { id: orderId, status: newStatus });
  return true;
}
const releaseEscrow = (orderId) => settleEscrow(orderId, 'seller');
const refundEscrow = (orderId) => settleEscrow(orderId, 'buyer');
// Auto-release escrows whose window has passed and that aren't under dispute.
async function flushEscrows() {
  try {
    const due = await db.query("SELECT id FROM orders WHERE status = 'escrow' AND auto_release_at IS NOT NULL AND auto_release_at <= now() LIMIT 50");
    for (const r of due.rows) { try { await releaseEscrow(r.id); } catch (e) { console.error('escrow auto-release failed:', e.message); } }
  } catch (e) { /* DB not ready / transient */ }
}
setInterval(flushEscrows, Math.max(5000, parseInt(process.env.ESCROW_FLUSH_MS, 10) || 60000)).unref?.();
// Checkout: turn the buyer's cart for one seller into an order, then pay.
app.post('/api/orders', auth.requireAuth, rateLimit(20, 60000, 'order-create'), async (req, res) => {
  const sellerId = parseInt(req.body.sellerId, 10);
  if (!Number.isInteger(sellerId)) return res.status(400).json({ error: 'Invalid seller.' });
  if (sellerId === req.user.id) return res.status(400).json({ error: 'You can’t order from yourself.' });
  try {
    if (!(await requireHandle(req, res))) return;
    if (await blockedEither(req.user.id, sellerId)) return res.status(403).json({ error: 'You can’t order from this seller.' });
    const cart = await db.query(
      `SELECT c.product_id, c.qty, p.name, p.price_cents FROM cart_items c JOIN products p ON p.id = c.product_id
       WHERE c.user_id = $1 AND p.business_id = $2 AND p.active = true`,
      [req.user.id, sellerId]
    );
    if (!cart.rows.length) return res.status(400).json({ error: 'Your cart for this seller is empty.' });
    const total = cart.rows.reduce((s, r) => s + r.price_cents * r.qty, 0);
    if (total <= 0) return res.status(400).json({ error: 'Order total must be greater than zero.' });
    const note = (req.body.note || '').toString().trim().slice(0, 500) || null;
    const ins = await db.query('INSERT INTO orders (buyer_id, seller_id, total_cents, note) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, sellerId, total, note]);
    const orderId = ins.rows[0].id;
    for (const r of cart.rows) {
      await db.query('INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES ($1,$2,$3,$4,$5)', [orderId, r.product_id, r.name, r.price_cents, r.qty]);
    }
    // Balance-funded paths (protected escrow or instant pay-from-balance) move real
    // money, so they're idempotent: a double-tap claims (user, clientId) before
    // paying, replays the first result on a duplicate, and drops the duplicate's
    // pending order. A failed pay also releases the claim + deletes the orphan order.
    const cid = req.body.clientId;
    const dropPending = () => db.query("DELETE FROM orders WHERE id = $1 AND status = 'pending'", [orderId]).catch(() => {});
    if (req.body.protected || req.body.payWith === 'balance') {
      const idem = await walletClaimIdem(req.user.id, cid, 'order');
      if (!idem.claimed) { await dropPending(); return res.json(idem.result || { ok: true, orderId, deduped: true }); }
      const bal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
      if (bal < total) { await walletReleaseIdem(req.user.id, cid, 'order'); await dropPending(); return res.status(400).json({ error: req.body.protected ? 'Not enough wallet balance to pay with protection.' : 'Not enough wallet balance.', insufficientBalance: true }); }
      const r = req.body.protected
        ? await fundEscrowOrder(req.user.id, sellerId, orderId, total)
        : await payOrderFromBalance(req.user.id, sellerId, orderId, total);
      if (!r.ok) { await walletReleaseIdem(req.user.id, cid, 'order'); await dropPending(); return res.status(400).json({ error: r.insufficient ? 'Not enough wallet balance.' : 'Could not complete the order.', insufficientBalance: !!r.insufficient }); }
      const result = req.body.protected ? { ok: true, orderId, escrow: true } : { ok: true, orderId, paid: true, fromBalance: true };
      await walletStoreIdem(req.user.id, cid, 'order', result);
      return res.json(result);
    }
    if (billing.isConfigured()) {
      const meRow = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: meRow.email, stripe_customer_id: meRow.stripe_customer_id },
        { amountCents: total, productName: 'Atwe order #' + orderId, metadata: { type: 'order', order_id: String(orderId) }, successUrl: `${origin}/?order=success`, cancelUrl: `${origin}/?order=cancel` }
      );
      return res.json({ url: session.url, orderId });
    }
    await recordOrderPaid(orderId); // demo: pay instantly
    res.status(201).json({ ok: true, orderId, paid: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not place the order.' }); }
});
// Buy now: a one-item order straight from a listing (no cart needed).
app.post('/api/orders/buy', auth.requireAuth, rateLimit(20, 60000, 'order-buy'), async (req, res) => {
  const productId = parseInt(req.body.productId, 10);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product.' });
  const qty = Math.max(1, Math.min(99, Math.round(Number(req.body.qty) || 1)));
  try {
    if (!(await requireHandle(req, res))) return;
    const p = (await db.query('SELECT business_id, name, price_cents, active FROM products WHERE id = $1', [productId])).rows[0];
    if (!p || !p.active) return res.status(404).json({ error: 'That listing isn’t available.' });
    if (p.business_id === req.user.id) return res.status(400).json({ error: 'You can’t buy your own listing.' });
    if (await blockedEither(req.user.id, p.business_id)) return res.status(403).json({ error: 'You can’t order from this seller.' });
    const total = p.price_cents * qty;
    const note = (req.body.note || '').toString().trim().slice(0, 500) || null;
    const ins = await db.query('INSERT INTO orders (buyer_id, seller_id, total_cents, note) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.id, p.business_id, total, note]);
    const orderId = ins.rows[0].id;
    await db.query('INSERT INTO order_items (order_id, product_id, name, price_cents, qty) VALUES ($1,$2,$3,$4,$5)', [orderId, productId, p.name, p.price_cents, qty]);
    // Balance-funded paths are idempotent (claim → pay → store; drop the orphan
    // order on duplicate/failure) — see /api/orders for the rationale.
    const cid = req.body.clientId;
    const dropPending = () => db.query("DELETE FROM orders WHERE id = $1 AND status = 'pending'", [orderId]).catch(() => {});
    if (req.body.protected || req.body.payWith === 'balance') {
      const idem = await walletClaimIdem(req.user.id, cid, 'order');
      if (!idem.claimed) { await dropPending(); return res.json(idem.result || { ok: true, orderId, deduped: true }); }
      const bal = (await db.query('SELECT balance_cents FROM users WHERE id = $1', [req.user.id])).rows[0].balance_cents;
      if (bal < total) { await walletReleaseIdem(req.user.id, cid, 'order'); await dropPending(); return res.status(400).json({ error: req.body.protected ? 'Not enough wallet balance to pay with protection.' : 'Not enough wallet balance.', insufficientBalance: true }); }
      const r = req.body.protected
        ? await fundEscrowOrder(req.user.id, p.business_id, orderId, total)
        : await payOrderFromBalance(req.user.id, p.business_id, orderId, total);
      if (!r.ok) { await walletReleaseIdem(req.user.id, cid, 'order'); await dropPending(); return res.status(400).json({ error: r.insufficient ? 'Not enough wallet balance.' : 'Could not complete the order.', insufficientBalance: !!r.insufficient }); }
      const result = req.body.protected ? { ok: true, orderId, escrow: true } : { ok: true, orderId, paid: true, fromBalance: true };
      await walletStoreIdem(req.user.id, cid, 'order', result);
      return res.json(result);
    }
    if (billing.isConfigured()) {
      const meRow = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
      const origin = `${req.protocol}://${req.get('host')}`;
      const session = await billing.createPaymentSession(
        { id: req.user.id, email: meRow.email, stripe_customer_id: meRow.stripe_customer_id },
        { amountCents: total, productName: p.name, metadata: { type: 'order', order_id: String(orderId) }, successUrl: `${origin}/?order=success`, cancelUrl: `${origin}/?order=cancel` }
      );
      return res.json({ url: session.url, orderId });
    }
    await recordOrderPaid(orderId);
    res.status(201).json({ ok: true, orderId, paid: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not place the order.' }); }
});
app.get('/api/orders', auth.requireAuth, async (req, res) => {
  const scope = req.query.scope === 'seller' ? 'seller' : 'buyer';
  try {
    const where = scope === 'seller' ? 'WHERE o.seller_id = $1' : 'WHERE o.buyer_id = $1';
    const { rows } = await db.query(ORDER_SELECT + ' ' + where + ' ORDER BY o.created_at DESC LIMIT 200', [req.user.id]);
    const out = [];
    for (const o of rows) {
      const items = (await db.query('SELECT name, price_cents, qty FROM order_items WHERE order_id = $1', [o.id])).rows;
      out.push(mapOrder(o, items, req.user.id));
    }
    res.json({ orders: out });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load orders.' }); }
});
app.get('/api/orders/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const o = (await db.query(ORDER_SELECT + ' WHERE o.id = $1', [id])).rows[0];
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) return res.status(404).json({ error: 'Order not found.' });
    const items = (await db.query('SELECT name, price_cents, qty FROM order_items WHERE order_id = $1', [id])).rows;
    res.json({ order: mapOrder(o, items, req.user.id) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the order.' }); }
});
// Seller marks an order fulfilled (notifies the buyer to leave a review).
app.post('/api/orders/:id/fulfill', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query("UPDATE orders SET status = 'fulfilled' WHERE id = $1 AND seller_id = $2 AND status = 'paid' RETURNING buyer_id", [id, req.user.id]);
    if (!r.rowCount) return res.status(400).json({ error: 'That order can’t be marked fulfilled.' });
    notify(r.rows[0].buyer_id, req.user.id, 'order_fulfilled');
    rtPush(r.rows[0].buyer_id, 'order', { id, status: 'fulfilled' });
    res.json({ ok: true, status: 'fulfilled' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update the order.' }); }
});
// Cancel: the buyer while still pending, or the seller before fulfilment.
app.post('/api/orders/:id/cancel', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const o = (await db.query('SELECT buyer_id, seller_id, status FROM orders WHERE id = $1', [id])).rows[0];
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) return res.status(404).json({ error: 'Order not found.' });
    // Only an unpaid (pending) order can be cancelled — money never moved, so no
    // refund is needed. A paid (balance/instant) order is final; a protected order
    // uses confirm/dispute/auto-release. This prevents cancelling a settled order
    // (which would keep the seller's money or strand held escrow funds).
    if (o.status !== 'pending') {
      const msg = (o.status === 'escrow' || o.status === 'disputed')
        ? 'A protected order can’t be cancelled — confirm receipt or open a dispute.'
        : 'This order is already paid and can’t be cancelled.';
      return res.status(400).json({ error: msg });
    }
    const r = await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING id", [id]);
    if (!r.rowCount) return res.status(400).json({ error: 'That order can’t be cancelled.' });
    const otherId = o.seller_id === req.user.id ? o.buyer_id : o.seller_id;
    rtPush(otherId, 'order', { id, status: 'cancelled' });
    res.json({ ok: true, status: 'cancelled' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not cancel the order.' }); }
});
// Buyer confirms receipt on a protected order → release the held escrow to the seller.
app.post('/api/orders/:id/confirm', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const o = (await db.query('SELECT buyer_id, status FROM orders WHERE id = $1', [id])).rows[0];
    if (!o || o.buyer_id !== req.user.id) return res.status(404).json({ error: 'Order not found.' });
    if (o.status !== 'escrow') return res.status(400).json({ error: 'There’s nothing held to release on this order.' });
    const ok = await releaseEscrow(id);
    if (!ok) return res.status(400).json({ error: 'Could not release the payment.' });
    res.json({ ok: true, status: 'released' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not confirm the order.' }); }
});
// Open a dispute on a held escrow (buyer or seller) → goes to the admin queue.
app.post('/api/orders/:id/dispute', auth.requireAuth, rateLimit(10, 60000, 'order-dispute'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const reason = (req.body.reason || '').toString().trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'Tell us what went wrong.' });
  try {
    const o = (await db.query('SELECT buyer_id, seller_id, status FROM orders WHERE id = $1', [id])).rows[0];
    if (!o || (o.buyer_id !== req.user.id && o.seller_id !== req.user.id)) return res.status(404).json({ error: 'Order not found.' });
    if (o.status !== 'escrow') return res.status(400).json({ error: 'Only a held (in-escrow) order can be disputed.' });
    const r = await db.query("UPDATE orders SET status = 'disputed', dispute_reason = $2, disputed_by = $3 WHERE id = $1 AND status = 'escrow' RETURNING id", [id, reason, req.user.id]);
    if (!r.rowCount) return res.status(400).json({ error: 'Could not open the dispute.' });
    const otherId = o.buyer_id === req.user.id ? o.seller_id : o.buyer_id;
    notify(otherId, req.user.id, 'order_disputed');
    rtPush(otherId, 'order', { id, status: 'disputed' });
    rtPush(req.user.id, 'order', { id, status: 'disputed' });
    res.json({ ok: true, status: 'disputed' });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not open the dispute.' }); }
});

/* ═══════════════════════════════════════════════
   BUSINESS REVIEWS & RATINGS
═══════════════════════════════════════════════ */
function mapReview(r, viewerId) {
  return {
    id: r.id, rating: r.rating, body: r.body || '', response: r.response || null, createdAt: r.created_at,
    mine: r.reviewer_id === viewerId,
    reviewer: { id: r.reviewer_id, name: r.reviewer_name, username: r.reviewer_username, avatar: r.reviewer_avatar || null, verified: !!r.reviewer_verified },
  };
}
async function businessReviewSummary(businessId) {
  const r = await db.query('SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::numeric(3,2) AS avg FROM business_reviews WHERE business_id = $1', [businessId]);
  return { count: r.rows[0].count || 0, average: Number(r.rows[0].avg) || 0 };
}
// Leave or update a review for a business (1:1 per reviewer; upsert).
app.post('/api/business/:id/reviews', auth.requireAuth, rateLimit(20, 60000, 'review'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid business id.' });
  const rating = parseInt(req.body.rating, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Pick a rating from 1 to 5 stars.' });
  const body = (req.body.body || '').trim().slice(0, 2000);
  try {
    if (id === req.user.id) return res.status(400).json({ error: 'You can’t review your own business.' });
    const b = await db.query('SELECT account_type FROM users WHERE id = $1', [id]);
    if (!b.rows[0]) return res.status(404).json({ error: 'Business not found.' });
    if (b.rows[0].account_type !== 'business') return res.status(400).json({ error: 'Only business accounts can be reviewed.' });
    if (await blockedEither(req.user.id, id)) return res.status(403).json({ error: 'You can’t review this business.' });
    // A new review (not an edit) resets any existing business response.
    await db.query(
      `INSERT INTO business_reviews (business_id, reviewer_id, rating, body) VALUES ($1,$2,$3,$4)
       ON CONFLICT (business_id, reviewer_id) DO UPDATE SET rating = $3, body = $4, response = NULL, created_at = now()`,
      [id, req.user.id, rating, body]
    );
    notify(id, req.user.id, 'review');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save your review.' }); }
});
// Reviews for a business (public) + summary + my own review.
app.get('/api/business/:id/reviews', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid business id.' });
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.rating, r.body, r.response, r.created_at, r.reviewer_id,
              u.name AS reviewer_name, u.username AS reviewer_username, u.avatar AS reviewer_avatar, u.verified AS reviewer_verified
       FROM business_reviews r JOIN users u ON u.id = r.reviewer_id
       WHERE r.business_id = $1 ORDER BY (r.reviewer_id = $2) DESC, r.created_at DESC LIMIT 200`,
      [id, req.user.id]
    );
    const summary = await businessReviewSummary(id);
    res.json({ reviews: rows.map((r) => mapReview(r, req.user.id)), summary, mine: rows.find((r) => r.reviewer_id === req.user.id) ? mapReview(rows.find((r) => r.reviewer_id === req.user.id), req.user.id) : null });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load reviews.' }); }
});
// Business responds to a review (owner only).
app.post('/api/business/reviews/:id/respond', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const response = (req.body.response || '').trim().slice(0, 2000);
  try {
    const r = await db.query('SELECT business_id, reviewer_id FROM business_reviews WHERE id = $1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Review not found.' });
    if (r.rows[0].business_id !== req.user.id) return res.status(403).json({ error: 'Only the business can respond.' });
    await db.query('UPDATE business_reviews SET response = $1 WHERE id = $2', [response || null, id]);
    if (response) notify(r.rows[0].reviewer_id, req.user.id, 'review_reply');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save your response.' }); }
});
// Delete a review (the reviewer, or the business removing it from its page... reviewer only here).
app.delete('/api/business/reviews/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM business_reviews WHERE id = $1 AND reviewer_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove your review.' }); }
});

/* ═══════════════════════════════════════════════
   APPOINTMENTS / BOOKING
═══════════════════════════════════════════════ */
const APPT_STATUSES = ['requested', 'confirmed', 'declined', 'cancelled'];
// Bookable services for a business (public read).
app.get('/api/business/:id/services', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid business id.' });
  try {
    const { rows } = await db.query('SELECT id, name, duration_min FROM business_services WHERE business_id = $1 ORDER BY created_at ASC', [id]);
    res.json({ services: rows.map((s) => ({ id: s.id, name: s.name, durationMin: s.duration_min })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load services.' }); }
});
app.post('/api/business/services', auth.requireAuth, rateLimit(30, 60000, 'svc-add'), async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Name the service.' });
  const dur = Math.min(Math.max(parseInt(req.body.durationMin, 10) || 30, 5), 1440);
  try {
    const u = await db.query('SELECT account_type FROM users WHERE id = $1', [req.user.id]);
    if (!u.rows[0] || u.rows[0].account_type !== 'business') return res.status(403).json({ error: 'Only business accounts can offer services.' });
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM business_services WHERE business_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 30) return res.status(400).json({ error: 'You can list up to 30 services.' });
    const ins = await db.query('INSERT INTO business_services (business_id, name, duration_min) VALUES ($1,$2,$3) RETURNING id', [req.user.id, name, dur]);
    res.json({ service: { id: ins.rows[0].id, name, durationMin: dur } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the service.' }); }
});
app.delete('/api/business/services/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM business_services WHERE id = $1 AND business_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});
function mapAppt(a) {
  return {
    id: a.id, service: a.service, whenAt: a.when_at, note: a.note || null, status: a.status, createdAt: a.created_at,
    business: { id: a.business_id, name: a.biz_name, username: a.biz_username, avatar: a.biz_avatar || null },
    customer: { id: a.customer_id, name: a.cust_name, username: a.cust_username, avatar: a.cust_avatar || null },
  };
}
// Request an appointment with a business.
app.post('/api/business/:id/appointments', auth.requireAuth, rateLimit(20, 60000, 'appt-req'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid business id.' });
  const service = (req.body.service || '').trim().slice(0, 120);
  if (!service) return res.status(400).json({ error: 'Choose a service.' });
  const when = new Date(req.body.whenAt);
  if (isNaN(when.getTime())) return res.status(400).json({ error: 'Pick a date and time.' });
  if (when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Pick a time in the future.' });
  const note = (req.body.note || '').trim().slice(0, 500) || null;
  try {
    if (id === req.user.id) return res.status(400).json({ error: 'You can’t book your own business.' });
    const b = await db.query('SELECT account_type, name FROM users WHERE id = $1', [id]);
    if (!b.rows[0] || b.rows[0].account_type !== 'business') return res.status(400).json({ error: 'You can only book business accounts.' });
    if (await blockedEither(req.user.id, id)) return res.status(403).json({ error: 'You can’t book this business.' });
    const ins = await db.query('INSERT INTO appointments (business_id, customer_id, service, when_at, note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [id, req.user.id, service, when.toISOString(), note]);
    notify(id, req.user.id, 'appt_request');
    // Also open a DM so the conversation is private (best-effort, permission allowing).
    try { if (await dmAllowed(req.user.id, id)) await deliverDM(req.user.id, id, `📅 Appointment request: ${service} on ${when.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}${note ? ' — ' + note : ''}`, []); } catch (e) {}
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not request the appointment.' }); }
});
// List my appointments: incoming (as a business) or mine (as a customer).
app.get('/api/appointments', auth.requireAuth, async (req, res) => {
  const scope = req.query.scope === 'incoming' ? 'incoming' : 'mine';
  try {
    const col = scope === 'incoming' ? 'a.business_id' : 'a.customer_id';
    const { rows } = await db.query(
      `SELECT a.id, a.service, a.when_at, a.note, a.status, a.created_at, a.business_id, a.customer_id,
              b.name AS biz_name, b.username AS biz_username, b.avatar AS biz_avatar,
              c.name AS cust_name, c.username AS cust_username, c.avatar AS cust_avatar
       FROM appointments a JOIN users b ON b.id = a.business_id JOIN users c ON c.id = a.customer_id
       WHERE ${col} = $1 ORDER BY a.when_at ASC LIMIT 200`,
      [req.user.id]
    );
    res.json({ appointments: rows.map(mapAppt) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load appointments.' }); }
});
// Update status: the business confirms/declines; either side cancels.
app.patch('/api/appointments/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const status = APPT_STATUSES.includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const a = await db.query('SELECT business_id, customer_id FROM appointments WHERE id = $1', [id]);
    if (!a.rows[0]) return res.status(404).json({ error: 'Not found.' });
    const isBiz = a.rows[0].business_id === req.user.id, isCust = a.rows[0].customer_id === req.user.id;
    if (!isBiz && !isCust) return res.status(403).json({ error: 'Not allowed.' });
    if ((status === 'confirmed' || status === 'declined') && !isBiz) return res.status(403).json({ error: 'Only the business can confirm or decline.' });
    await db.query('UPDATE appointments SET status = $1 WHERE id = $2', [status, id]);
    // Notify the other party.
    const other = isBiz ? a.rows[0].customer_id : a.rows[0].business_id;
    notify(other, req.user.id, status === 'confirmed' ? 'appt_confirmed' : status === 'declined' ? 'appt_declined' : 'appt_cancelled');
    res.json({ ok: true, status });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});

// List events: upcoming (default), mine (hosting), or attending.
app.get('/api/events', auth.requireAuth, async (req, res) => {
  const scope = ['upcoming', 'mine', 'attending', 'past'].includes(req.query.scope) ? req.query.scope : 'upcoming';
  try {
    let where, order = 'ORDER BY e.starts_at ASC', params = [req.user.id];
    if (scope === 'mine') where = 'WHERE e.host_id = $1';
    else if (scope === 'attending') where = 'WHERE EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = $1)';
    else if (scope === 'past') { where = 'WHERE e.starts_at < now()'; order = 'ORDER BY e.starts_at DESC'; }
    else where = 'WHERE e.starts_at >= now() - interval \'3 hours\'';
    const { rows } = await db.query(EVENTS_SELECT + where + ' ' + order + ' LIMIT 100', params);
    res.json({ events: rows.map(mapEvent) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load events.' }); }
});
// Create an event.
app.post('/api/events', auth.requireAuth, rateLimit(20, 60000, 'event-create'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const title = (req.body.title || '').trim().slice(0, 140);
  if (!title) return res.status(400).json({ error: 'An event title is required.' });
  const start = new Date(req.body.startsAt);
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'A valid start date/time is required.' });
  let end = null;
  if (req.body.endsAt) { const e = new Date(req.body.endsAt); if (!isNaN(e.getTime()) && e > start) end = e.toISOString(); }
  const online = req.body.online !== false;
  const description = (req.body.description || '').trim().slice(0, 4000);
  const location = (req.body.location || '').trim().slice(0, 300) || null;
  const cover = cleanImage(req.body.cover);
  if (cover === undefined) return res.status(400).json({ error: 'That cover image could not be attached.' });
  const priceCents = Math.min(Math.max(Math.round(Number(req.body.priceCents) || 0), 0), 100000);
  try {
    const ins = await db.query(
      `INSERT INTO events (host_id, title, description, starts_at, ends_at, online, location, cover, price_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [req.user.id, title, description, start.toISOString(), end, online, location, cover, priceCents]
    );
    // Host auto-RSVPs "going".
    await db.query('INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ins.rows[0].id, req.user.id, 'going']);
    const { rows } = await db.query(EVENTS_SELECT + 'WHERE e.id = $2', [req.user.id, ins.rows[0].id]);
    res.json({ event: mapEvent(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the event.' }); }
});
// Event detail.
app.get('/api/events/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  try {
    const { rows } = await db.query(EVENTS_SELECT + 'WHERE e.id = $2', [req.user.id, id]);
    if (!rows[0]) return res.status(404).json({ error: 'That event is no longer available.' });
    res.json({ event: mapEvent(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the event.' }); }
});
// Edit an event (host only).
app.patch('/api/events/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  try {
    const cur = await db.query('SELECT host_id, starts_at FROM events WHERE id = $1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'That event is no longer available.' });
    if (cur.rows[0].host_id !== req.user.id) return res.status(403).json({ error: 'Only the host can edit this event.' });
    const sets = [], vals = []; let i = 1;
    if (req.body.title !== undefined) { const t = (req.body.title || '').trim().slice(0, 140); if (!t) return res.status(400).json({ error: 'An event title is required.' }); sets.push(`title = $${i++}`); vals.push(t); }
    if (req.body.description !== undefined) { sets.push(`description = $${i++}`); vals.push((req.body.description || '').trim().slice(0, 4000)); }
    if (req.body.startsAt !== undefined) { const d = new Date(req.body.startsAt); if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid start time.' }); sets.push(`starts_at = $${i++}`); vals.push(d.toISOString()); }
    if (req.body.endsAt !== undefined) { let e = null; if (req.body.endsAt) { const d = new Date(req.body.endsAt); if (!isNaN(d.getTime())) e = d.toISOString(); } sets.push(`ends_at = $${i++}`); vals.push(e); }
    if (req.body.online !== undefined) { sets.push(`online = $${i++}`); vals.push(req.body.online !== false); }
    if (req.body.location !== undefined) { sets.push(`location = $${i++}`); vals.push((req.body.location || '').trim().slice(0, 300) || null); }
    if (req.body.priceCents !== undefined) { sets.push(`price_cents = $${i++}`); vals.push(Math.min(Math.max(Math.round(Number(req.body.priceCents) || 0), 0), 100000)); }
    if (!sets.length) { const { rows } = await db.query(EVENTS_SELECT + 'WHERE e.id = $2', [req.user.id, id]); return res.json({ event: mapEvent(rows[0]) }); }
    vals.push(id);
    await db.query(`UPDATE events SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    // Tell attendees the event changed.
    const att = await db.query('SELECT user_id FROM event_rsvps WHERE event_id = $1 AND user_id <> $2', [id, req.user.id]);
    for (const a of att.rows) notify(a.user_id, req.user.id, 'event_update');
    const { rows } = await db.query(EVENTS_SELECT + 'WHERE e.id = $2', [req.user.id, id]);
    res.json({ event: mapEvent(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update the event.' }); }
});
// Delete an event (host only).
app.delete('/api/events/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  try {
    const r = await db.query('DELETE FROM events WHERE id = $1 AND host_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found (or not yours).' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete the event.' }); }
});
// RSVP (going / interested). Upsert; host is notified.
app.post('/api/events/:id/rsvp', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  const status = ['going', 'interested'].includes(req.body.status) ? req.body.status : 'going';
  try {
    const e = await db.query('SELECT host_id, price_cents, title FROM events WHERE id = $1', [id]);
    if (!e.rows[0]) return res.status(404).json({ error: 'That event is no longer available.' });
    const price = e.rows[0].price_cents || 0;
    // Ticketed event: "going" needs a paid ticket (non-host). "Interested" is free.
    if (status === 'going' && price > 0 && e.rows[0].host_id !== req.user.id) {
      const r = await db.query('SELECT paid FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
      if (!(r.rows[0] && r.rows[0].paid)) {
        if (billing.isConfigured()) {
          const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
          const origin = `${req.protocol}://${req.get('host')}`;
          const session = await billing.createPaymentSession(
            { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
            { amountCents: price, productName: 'Ticket: ' + e.rows[0].title, metadata: { type: 'event_ticket', event_id: String(id) }, successUrl: `${origin}/?ticket=success`, cancelUrl: `${origin}/?ticket=cancel` }
          );
          return res.json({ url: session.url });
        }
        await db.query(`INSERT INTO event_rsvps (event_id, user_id, status, paid) VALUES ($1,$2,'going',true) ON CONFLICT (event_id, user_id) DO UPDATE SET status='going', paid=true`, [id, req.user.id]); // demo: instant ticket
        notify(e.rows[0].host_id, req.user.id, 'event_rsvp');
        return res.json({ ok: true, status: 'going' });
      }
    }
    const existed = await db.query('SELECT 1 FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
    await db.query('INSERT INTO event_rsvps (event_id, user_id, status) VALUES ($1,$2,$3) ON CONFLICT (event_id, user_id) DO UPDATE SET status = $3', [id, req.user.id, status]);
    if (!existed.rows[0]) notify(e.rows[0].host_id, req.user.id, 'event_rsvp');
    res.json({ ok: true, status });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not RSVP.' }); }
});
// Withdraw RSVP.
app.delete('/api/events/:id/rsvp', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  try {
    await db.query('DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update your RSVP.' }); }
});
// Attendee list (going first, then interested).
app.get('/api/events/:id/attendees', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid event id.' });
  try {
    const e = await db.query('SELECT 1 FROM events WHERE id = $1', [id]);
    if (!e.rows[0]) return res.status(404).json({ error: 'That event is no longer available.' });
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.username, u.avatar, u.verified, u.headline, r.status
       FROM event_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $1 ORDER BY (r.status = 'going') DESC, r.created_at ASC LIMIT 500`,
      [id]
    );
    res.json({ attendees: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || null, status: u.status })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load attendees.' }); }
});

/* ═══════════════════════════════════════════════
   NEWSLETTERS (LinkedIn-style)
═══════════════════════════════════════════════ */
function mapNewsletter(r) {
  const price = r.price_cents || 0;
  const paid = !!r.sub_paid;
  return {
    id: r.id, title: r.title, description: r.description || '', cover: r.cover || null, createdAt: r.created_at,
    subscribers: r.subscribers || 0, issues: r.issue_count || 0,
    subscribed: !!r.subscribed, mine: !!r.mine,
    priceCents: price, paid, locked: price > 0 && !r.mine && !(r.subscribed && paid),
    owner: { id: r.owner_id, name: r.owner_name, username: r.owner_username, avatar: r.owner_avatar || null, verified: !!r.owner_verified, business: r.owner_type === 'business' },
  };
}
const NL_SELECT = `
  SELECT n.id, n.title, n.description, n.cover, n.created_at, n.owner_id, n.price_cents,
         (SELECT paid FROM newsletter_subs s WHERE s.newsletter_id = n.id AND s.user_id = $1) AS sub_paid,
         u.name AS owner_name, u.username AS owner_username, u.avatar AS owner_avatar, u.verified AS owner_verified, u.account_type AS owner_type,
         (SELECT COUNT(*)::int FROM newsletter_subs s WHERE s.newsletter_id = n.id) AS subscribers,
         (SELECT COUNT(*)::int FROM newsletter_issues i WHERE i.newsletter_id = n.id) AS issue_count,
         EXISTS(SELECT 1 FROM newsletter_subs s WHERE s.newsletter_id = n.id AND s.user_id = $1) AS subscribed,
         (n.owner_id = $1) AS mine
  FROM newsletters n JOIN users u ON u.id = n.owner_id `;
app.get('/api/newsletters', auth.requireAuth, async (req, res) => {
  const scope = ['discover', 'mine', 'subscribed'].includes(req.query.scope) ? req.query.scope : 'discover';
  try {
    let where = '', order = 'ORDER BY subscribers DESC, n.created_at DESC';
    if (scope === 'mine') where = 'WHERE n.owner_id = $1';
    else if (scope === 'subscribed') where = 'WHERE EXISTS(SELECT 1 FROM newsletter_subs s WHERE s.newsletter_id = n.id AND s.user_id = $1)';
    const { rows } = await db.query(NL_SELECT + where + ' ' + order + ' LIMIT 100', [req.user.id]);
    res.json({ newsletters: rows.map(mapNewsletter) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load newsletters.' }); }
});
app.post('/api/newsletters', auth.requireAuth, rateLimit(10, 60000, 'nl-create'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const title = (req.body.title || '').trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: 'Give your newsletter a title.' });
  const description = (req.body.description || '').trim().slice(0, 600);
  const cover = cleanImage(req.body.cover);
  if (cover === undefined) return res.status(400).json({ error: 'That cover image could not be attached.' });
  const priceCents = Math.min(Math.max(Math.round(Number(req.body.priceCents) || 0), 0), 50000);
  try {
    const ins = await db.query('INSERT INTO newsletters (owner_id, title, description, cover, price_cents) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, title, description, cover, priceCents]);
    // The author auto-subscribes to their own publication.
    await db.query('INSERT INTO newsletter_subs (newsletter_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ins.rows[0].id, req.user.id]);
    const { rows } = await db.query(NL_SELECT + 'WHERE n.id = $2', [req.user.id, ins.rows[0].id]);
    res.json({ newsletter: mapNewsletter(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the newsletter.' }); }
});
app.get('/api/newsletters/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const { rows } = await db.query(NL_SELECT + 'WHERE n.id = $2', [req.user.id, id]);
    if (!rows[0]) return res.status(404).json({ error: 'That newsletter is no longer available.' });
    const issues = await db.query('SELECT id, title, left(body, 200) AS excerpt, created_at FROM newsletter_issues WHERE newsletter_id = $1 ORDER BY created_at DESC LIMIT 100', [id]);
    res.json({ newsletter: mapNewsletter(rows[0]), issues: issues.rows.map((i) => ({ id: i.id, title: i.title, excerpt: i.excerpt || '', createdAt: i.created_at })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the newsletter.' }); }
});
app.patch('/api/newsletters/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const cur = await db.query('SELECT owner_id FROM newsletters WHERE id = $1', [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: 'Not found.' });
    if (cur.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit this newsletter.' });
    const sets = [], vals = []; let i = 1;
    if (req.body.title !== undefined) { const t = (req.body.title || '').trim().slice(0, 120); if (!t) return res.status(400).json({ error: 'Give your newsletter a title.' }); sets.push(`title = $${i++}`); vals.push(t); }
    if (req.body.description !== undefined) { sets.push(`description = $${i++}`); vals.push((req.body.description || '').trim().slice(0, 600)); }
    if (req.body.priceCents !== undefined) { sets.push(`price_cents = $${i++}`); vals.push(Math.min(Math.max(Math.round(Number(req.body.priceCents) || 0), 0), 50000)); }
    if (sets.length) { vals.push(id); await db.query(`UPDATE newsletters SET ${sets.join(', ')} WHERE id = $${i}`, vals); }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
app.delete('/api/newsletters/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM newsletters WHERE id = $1 AND owner_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});
app.post('/api/newsletters/:id/subscribe', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const n = await db.query('SELECT owner_id, price_cents, title FROM newsletters WHERE id = $1', [id]);
    if (!n.rows[0]) return res.status(404).json({ error: 'That newsletter is no longer available.' });
    if (req.body.subscribe === false) { await db.query('DELETE FROM newsletter_subs WHERE newsletter_id = $1 AND user_id = $2', [id, req.user.id]); return res.json({ ok: true, subscribed: false }); }
    const price = n.rows[0].price_cents || 0;
    // Paid newsletter: a non-owner who hasn't paid must check out first.
    if (price > 0 && n.rows[0].owner_id !== req.user.id) {
      const already = await db.query('SELECT paid FROM newsletter_subs WHERE newsletter_id = $1 AND user_id = $2', [id, req.user.id]);
      if (!(already.rows[0] && already.rows[0].paid)) {
        if (billing.isConfigured()) {
          const me = (await db.query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [req.user.id])).rows[0] || {};
          const origin = `${req.protocol}://${req.get('host')}`;
          const session = await billing.createPaymentSession(
            { id: req.user.id, email: me.email, stripe_customer_id: me.stripe_customer_id },
            { amountCents: price, productName: 'Subscribe: ' + n.rows[0].title, metadata: { type: 'newsletter_sub', newsletter_id: String(id) }, successUrl: `${origin}/?nlsub=success`, cancelUrl: `${origin}/?nlsub=cancel` }
          );
          return res.json({ url: session.url });
        }
        await db.query('INSERT INTO newsletter_subs (newsletter_id, user_id, paid) VALUES ($1,$2,true) ON CONFLICT (newsletter_id, user_id) DO UPDATE SET paid = true', [id, req.user.id]); // demo: instant paid sub
        return res.json({ ok: true, subscribed: true });
      }
    }
    await db.query('INSERT INTO newsletter_subs (newsletter_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.json({ ok: true, subscribed: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// Publish an issue (owner) → notify every subscriber.
app.post('/api/newsletters/:id/issues', auth.requireAuth, rateLimit(20, 60000, 'nl-issue'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const title = (req.body.title || '').trim().slice(0, 160);
  if (!title) return res.status(400).json({ error: 'Give the issue a title.' });
  const body = (req.body.body || '').trim().slice(0, 20000);
  try {
    const n = await db.query('SELECT owner_id FROM newsletters WHERE id = $1', [id]);
    if (!n.rows[0]) return res.status(404).json({ error: 'Not found.' });
    if (n.rows[0].owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can publish issues.' });
    const ins = await db.query('INSERT INTO newsletter_issues (newsletter_id, title, body) VALUES ($1,$2,$3) RETURNING id, title, body, created_at', [id, title, body]);
    const subs = await db.query('SELECT user_id FROM newsletter_subs WHERE newsletter_id = $1 AND user_id <> $2', [id, req.user.id]);
    for (const s of subs.rows) notify(s.user_id, req.user.id, 'newsletter_issue');
    res.json({ issue: { id: ins.rows[0].id, title: ins.rows[0].title, body: ins.rows[0].body, createdAt: ins.rows[0].created_at } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not publish the issue.' }); }
});
app.get('/api/newsletters/issues/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const { rows } = await db.query(
      `SELECT i.id, i.title, i.body, i.created_at, i.newsletter_id, n.title AS nl_title, n.owner_id,
              u.name AS owner_name, u.username AS owner_username, u.avatar AS owner_avatar, u.verified AS owner_verified
       FROM newsletter_issues i JOIN newsletters n ON n.id = i.newsletter_id JOIN users u ON u.id = n.owner_id WHERE i.id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'That issue is no longer available.' });
    // Paid newsletter: only the owner and paid subscribers can read the full issue.
    const nl = await db.query('SELECT price_cents FROM newsletters WHERE id = $1', [r.newsletter_id]);
    if ((nl.rows[0]?.price_cents || 0) > 0 && r.owner_id !== req.user.id) {
      const sub = await db.query('SELECT paid FROM newsletter_subs WHERE newsletter_id = $1 AND user_id = $2', [r.newsletter_id, req.user.id]);
      if (!(sub.rows[0] && sub.rows[0].paid)) return res.status(402).json({ error: 'Subscribe to read this issue.', locked: true });
    }
    res.json({ issue: {
      id: r.id, title: r.title, body: r.body, createdAt: r.created_at,
      newsletter: { id: r.newsletter_id, title: r.nl_title },
      owner: { id: r.owner_id, name: r.owner_name, username: r.owner_username, avatar: r.owner_avatar || null, verified: !!r.owner_verified },
    } });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load the issue.' }); }
});

/* ═══════════════════════════════════════════════
   SKILLS + ENDORSEMENTS
═══════════════════════════════════════════════ */
app.post('/api/skills', auth.requireAuth, rateLimit(40, 60000, 'skill-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const name = (req.body.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'A skill name is required.' });
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM user_skills WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= 30) return res.status(400).json({ error: 'You’ve reached the maximum number of skills.' });
    const { rows } = await db.query(
      'INSERT INTO user_skills (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id, lower(name)) DO NOTHING RETURNING id',
      [req.user.id, name]
    );
    if (!rows[0]) return res.status(409).json({ error: 'You already added that skill.' });
    res.status(201).json({ id: rows[0].id, name });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the skill.' }); }
});
app.delete('/api/skills/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM user_skills WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove the skill.' }); }
});
// Endorse / unendorse someone else's skill (one vote each).
app.post('/api/skills/:id/endorse', auth.requireAuth, rateLimit(120, 60000, 'endorse'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const sk = await db.query('SELECT user_id FROM user_skills WHERE id = $1', [id]);
    if (!sk.rows[0]) return res.status(404).json({ error: 'Skill not found.' });
    const owner = sk.rows[0].user_id;
    if (owner === req.user.id) return res.status(400).json({ error: 'You can’t endorse your own skill.' });
    if (await blockedEither(req.user.id, owner)) return res.status(403).json({ error: 'You can’t endorse this account.' });
    const r = await db.query('INSERT INTO skill_endorsements (skill_id, endorser_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    if (r.rowCount) notify(owner, req.user.id, 'endorsement', null);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not endorse.' }); }
});
app.delete('/api/skills/:id/endorse', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM skill_endorsements WHERE skill_id = $1 AND endorser_id = $2', [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});

/* ═══════════════════════════════════════════════
   SKILL ASSESSMENTS  —  pass a quiz → verified-skill badge
═══════════════════════════════════════════════ */
const ASSESS_PASS = 0.7; // 70% to earn the badge
// Generate a multiple-choice quiz for one of MY skills (Atwe AI). Stores the
// answer key server-side under a token; returns only the questions + options.
app.post('/api/skills/:id/assessment', auth.requireAuth, rateLimit(10, 60000, 'skill-assess'), async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid skill id.' });
  try {
    const sk = await db.query('SELECT name, user_id FROM user_skills WHERE id = $1', [id]);
    if (!sk.rows[0]) return res.status(404).json({ error: 'Skill not found.' });
    if (sk.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'You can only take assessments for your own skills.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
    const skill = sk.rows[0].name;
    const sys = 'You are Atwe AI. Write a short professional knowledge quiz to assess competence in a given skill. '
      + 'Produce exactly 5 multiple-choice questions, each with 4 options and exactly one correct answer. '
      + 'Questions should be practical and unambiguous, ranging easy→hard. Reply with STRICT JSON only: '
      + '{"questions":[{"q":string,"options":[string,string,string,string],"answer":0-3}, ...]}. '
      + 'No markdown, no prose outside JSON. Never mention "Claude" or "Anthropic".';
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1200, system: sys,
      messages: [{ role: 'user', content: 'Skill to assess: ' + skill + '\n\nWrite the 5-question quiz now.' }],
    });
    const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    const qs = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .map((q) => ({
        q: String(q.q || '').slice(0, 400),
        options: (Array.isArray(q.options) ? q.options : []).map((o) => String(o || '').slice(0, 200)).slice(0, 4),
        answer: Number.isInteger(q.answer) ? q.answer : 0,
      }))
      .filter((q) => q.q && q.options.length === 4 && q.answer >= 0 && q.answer <= 3)
      .slice(0, 5);
    if (qs.length < 3) return res.status(422).json({ error: 'Could not build the assessment. Please try again.' });
    const token = 'asmt_' + require('crypto').randomBytes(18).toString('hex');
    await db.query(
      `INSERT INTO skill_assessments (token, user_id, skill_id, answer_key, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '20 minutes')`,
      [token, req.user.id, id, qs.map((q) => q.answer)]
    );
    res.json({ token, skill, questions: qs.map((q) => ({ q: q.q, options: q.options })) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not start the assessment.' }); }
});
// Submit answers; score against the stored key; pass → mark the skill assessed.
app.post('/api/skills/:id/assessment/submit', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid skill id.' });
  const token = String(req.body.token || '');
  const answers = Array.isArray(req.body.answers) ? req.body.answers.map((n) => parseInt(n, 10)) : [];
  try {
    const s = await db.query('SELECT answer_key FROM skill_assessments WHERE token = $1 AND user_id = $2 AND skill_id = $3 AND expires_at > now()', [token, req.user.id, id]);
    if (!s.rows[0]) return res.status(404).json({ error: 'This assessment has expired. Please start again.' });
    const key = s.rows[0].answer_key;
    let correct = 0;
    for (let i = 0; i < key.length; i++) if (answers[i] === key[i]) correct++;
    const passed = (correct / key.length) >= ASSESS_PASS;
    await db.query('DELETE FROM skill_assessments WHERE token = $1', [token]); // single-use
    if (passed) await db.query('UPDATE user_skills SET assessed = true WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ passed, score: correct, total: key.length });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not score the assessment.' }); }
});

/* ═══════════════════════════════════════════════
   RECOMMENDATIONS  —  written professional recommendations
═══════════════════════════════════════════════ */
function mapRec(r) {
  return {
    id: r.id, relationship: r.relationship || null, body: r.body, status: r.status, createdAt: r.created_at,
    author: { id: r.author_id, name: r.author_name, username: r.author_username, avatar: r.author_avatar || null, verified: !!r.author_verified, headline: r.author_headline || null },
    subject: r.subject_id ? { id: r.subject_id, name: r.subject_name, username: r.subject_username, avatar: r.subject_avatar || null } : undefined,
  };
}
const REC_AUTHOR_JOIN = `JOIN users au ON au.id = r.author_id`;
const REC_AUTHOR_COLS = `au.name AS author_name, au.username AS author_username, au.avatar AS author_avatar, au.verified AS author_verified, au.headline AS author_headline`;
// Write a recommendation about someone (author = caller). Starts pending.
app.post('/api/recommendations', auth.requireAuth, rateLimit(20, 60000, 'rec-write'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const body = (req.body.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Write a few words to recommend them.' });
  const relationship = (req.body.relationship || '').trim().slice(0, 120) || null;
  try {
    let subjectId = parseInt(req.body.subjectId, 10);
    if (!Number.isInteger(subjectId) && req.body.username) {
      const u = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [String(req.body.username).replace(/^@/, '')]);
      if (!u.rows[0]) return res.status(404).json({ error: 'That person could not be found.' });
      subjectId = u.rows[0].id;
    }
    if (!Number.isInteger(subjectId)) return res.status(400).json({ error: 'Who is this recommendation for?' });
    if (subjectId === req.user.id) return res.status(400).json({ error: 'You can’t recommend yourself.' });
    if (await blockedEither(req.user.id, subjectId)) return res.status(403).json({ error: 'You can’t recommend this person.' });
    const ins = await db.query(
      `INSERT INTO recommendations (author_id, subject_id, relationship, body, status)
       VALUES ($1,$2,$3,$4,'pending')
       ON CONFLICT (author_id, subject_id) DO UPDATE SET relationship = $3, body = $4, status = 'pending', created_at = now()
       RETURNING id`,
      [req.user.id, subjectId, relationship, body]
    );
    notify(subjectId, req.user.id, 'rec_received');
    res.json({ ok: true, id: ins.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save your recommendation.' }); }
});
// Visible recommendations for a profile (public).
app.get('/api/recommendations', auth.requireAuth, async (req, res) => {
  try {
    const handle = String(req.query.username || '').replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'Which profile?' });
    const u = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT r.id, r.relationship, r.body, r.status, r.created_at, r.author_id, ${REC_AUTHOR_COLS}
       FROM recommendations r ${REC_AUTHOR_JOIN}
       WHERE r.subject_id = $1 AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT 100`,
      [u.rows[0].id]
    );
    res.json({ recommendations: rows.map(mapRec) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load recommendations.' }); }
});
// Recommendations received by me awaiting my approval (pending).
app.get('/api/recommendations/pending', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.relationship, r.body, r.status, r.created_at, r.author_id, ${REC_AUTHOR_COLS}
       FROM recommendations r ${REC_AUTHOR_JOIN}
       WHERE r.subject_id = $1 AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ recommendations: rows.map(mapRec) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load.' }); }
});
// Subject approves a pending recommendation → it becomes visible on their profile.
app.post('/api/recommendations/:id/show', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query(`UPDATE recommendations SET status = 'visible' WHERE id = $1 AND subject_id = $2 RETURNING id`, [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not update.' }); }
});
// Hide (subject) or delete (author) a recommendation.
app.delete('/api/recommendations/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM recommendations WHERE id = $1 AND (author_id = $2 OR subject_id = $2)', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});
// Ask someone to write you a recommendation (notification prompt).
app.post('/api/recommendations/request', auth.requireAuth, rateLimit(20, 60000, 'rec-request'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  try {
    const handle = String(req.body.username || '').replace(/^@/, '');
    const u = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'That person could not be found.' });
    const to = u.rows[0].id;
    if (to === req.user.id) return res.status(400).json({ error: 'You can’t request from yourself.' });
    if (await blockedEither(req.user.id, to)) return res.status(403).json({ error: 'You can’t request from this person.' });
    notify(to, req.user.id, 'rec_request');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not send your request.' }); }
});

/* ═══════════════════════════════════════════════
   FEATURED  —  a curated highlight row on a profile
═══════════════════════════════════════════════ */
const FEATURED_CAP = 10;
function mapFeatured(r) {
  const base = { id: r.id, kind: r.kind, position: r.position, createdAt: r.created_at };
  if (r.kind === 'post') {
    base.post = r.post_id ? {
      id: r.post_id, body: r.p_body || '', image: r.p_image || null, media: r.p_media || null, mediaKind: r.p_media_kind || null, createdAt: r.p_created,
    } : null;
  } else {
    base.url = r.url || null; base.title = r.title || null; base.description = r.description || null; base.image = r.image || null;
  }
  return base;
}
const FEATURED_SELECT = `
  SELECT f.id, f.kind, f.post_id, f.url, f.title, f.description, f.image, f.position, f.created_at,
         p.body AS p_body, p.image AS p_image, p.media AS p_media, p.media_kind AS p_media_kind, p.created_at AS p_created
  FROM featured_items f LEFT JOIN posts p ON p.id = f.post_id `;
// Featured items for a profile (public).
app.get('/api/featured', auth.requireAuth, async (req, res) => {
  try {
    const handle = String(req.query.username || '').replace(/^@/, '');
    if (!handle) return res.status(400).json({ error: 'Which profile?' });
    const u = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(FEATURED_SELECT + 'WHERE f.user_id = $1 ORDER BY f.position ASC, f.created_at DESC LIMIT 50', [u.rows[0].id]);
    res.json({ featured: rows.map(mapFeatured) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load featured.' }); }
});
// Add a featured item — your own post, or an external link.
app.post('/api/featured', auth.requireAuth, rateLimit(30, 60000, 'featured-add'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const kind = req.body.kind === 'post' ? 'post' : 'link';
  try {
    const cnt = await db.query('SELECT COUNT(*)::int AS n FROM featured_items WHERE user_id = $1', [req.user.id]);
    if (cnt.rows[0].n >= FEATURED_CAP) return res.status(400).json({ error: `You can feature up to ${FEATURED_CAP} items.` });
    let postId = null, url = null, title = null, description = null, image = null;
    if (kind === 'post') {
      postId = parseInt(req.body.postId, 10);
      if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post.' });
      const p = await db.query('SELECT user_id FROM posts WHERE id = $1', [postId]);
      if (!p.rows[0]) return res.status(404).json({ error: 'That post is no longer available.' });
      if (p.rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'You can only feature your own posts.' });
      const dup = await db.query('SELECT 1 FROM featured_items WHERE user_id = $1 AND post_id = $2', [req.user.id, postId]);
      if (dup.rows[0]) return res.status(400).json({ error: 'That post is already featured.' });
    } else {
      url = (req.body.url || '').trim().slice(0, 600);
      if (!/^https?:\/\/.+/i.test(url)) return res.status(400).json({ error: 'Enter a valid link (starting with http).' });
      title = (req.body.title || '').trim().slice(0, 160) || null;
      description = (req.body.description || '').trim().slice(0, 400) || null;
      image = cleanImage(req.body.image);
      if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
    }
    const pos = await db.query('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM featured_items WHERE user_id = $1', [req.user.id]);
    const ins = await db.query(
      `INSERT INTO featured_items (user_id, kind, post_id, url, title, description, image, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [req.user.id, kind, postId, url, title, description, image, pos.rows[0].pos]
    );
    const { rows } = await db.query(FEATURED_SELECT + 'WHERE f.id = $1', [ins.rows[0].id]);
    res.json({ item: mapFeatured(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add to featured.' }); }
});
// Remove a featured item (owner only).
app.delete('/api/featured/:id', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const r = await db.query('DELETE FROM featured_items WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not remove.' }); }
});

/* ═══════════════════════════════════════════════
   FEEDS  —  broadcast channels (feeds@username)
   Only the creator/admin posts; everyone else follows to watch.
   `open` feeds let anyone join instantly; otherwise joins need approval.
═══════════════════════════════════════════════ */
function cleanFeedUsername(raw) {
  const username = (raw || '').trim().replace(/^@/, '');
  if (!username) return { error: 'Choose a username for the feed.' };
  if (username.length > 40) return { error: 'Feed username is too long.' };
  if (!CIRCLE_USERNAME_RE.test(username)) {
    return { error: 'Username can use letters, numbers, dots, dashes and underscores.' };
  }
  return { username };
}

// Create a feed (creator becomes admin + first member).
app.post('/api/feeds', auth.requireAuth, rateLimit(20, 60000, 'feed-create'), async (req, res) => {
  const u = cleanFeedUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Feed name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  const open = req.body.open === undefined ? true : !!req.body.open;
  const avatar = cleanImage(req.body.avatar);
  if (avatar === undefined) return res.status(400).json({ error: 'That image could not be used.' });
  try {
    if (!(await requireHandle(req, res))) return;
    let f;
    try {
      f = await db.query(
        'INSERT INTO feeds (username, name, bio, avatar, open, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [u.username, name, bio || null, avatar, open, req.user.id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That feed username is already taken.' });
      throw e;
    }
    const fid = f.rows[0].id;
    await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
    res.json({ feed: { id: fid, username: u.username, name, bio: bio || null, avatar: avatar || null, open, members: 1, isMember: true, isAdmin: true, requested: false } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Directory: feeds I'm in first, then others to discover.
app.get('/api/feeds', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
              (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
              EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM feed_requests r WHERE r.feed_id = f.id AND r.user_id = $1) AS requested
       FROM feeds f
       ORDER BY is_member DESC, members DESC, f.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json({
      feeds: rows.map((f) => ({
        id: f.id, username: f.username, name: f.name, bio: f.bio || null, avatar: f.avatar || null, open: f.open,
        members: f.members, isMember: f.is_member, isAdmin: f.created_by === req.user.id, requested: f.requested,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// A feed's profile + its broadcast posts (+ pending requests if you're the admin).
app.get('/api/feeds/:id', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const f = await db.query(
      `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
              (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
              EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
              EXISTS(SELECT 1 FROM feed_requests r WHERE r.feed_id = f.id AND r.user_id = $1) AS requested
       FROM feeds f WHERE f.id = $2`,
      [req.user.id, fid]
    );
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    const t = f.rows[0];
    const isAdmin = t.created_by === req.user.id;
    // A request-to-join (non-open) feed keeps its posts members-only: outsiders
    // see the profile + join prompt, but not the content.
    const canViewPosts = t.open || t.is_member || isAdmin;
    const posts = canViewPosts ? await db.query(
      POSTS_SELECT + `JOIN post_feeds pf ON pf.post_id = p.id
       WHERE pf.feed_id = $2 AND p.parent_id IS NULL AND p.created_at <= now() ORDER BY p.created_at DESC LIMIT 60`,
      [req.user.id, fid]
    ) : { rows: [] };
    let requests = [];
    if (isAdmin) {
      const rq = await db.query(
        `SELECT u.id, u.name, u.username, u.avatar FROM feed_requests r
         JOIN users u ON u.id = r.user_id WHERE r.feed_id = $1 ORDER BY r.requested_at ASC LIMIT 100`,
        [fid]
      );
      requests = rq.rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null }));
    }
    res.json({
      feed: {
        id: t.id, username: t.username, name: t.name, bio: t.bio || null, avatar: t.avatar || null, open: t.open,
        members: t.members, isMember: t.is_member, isAdmin, requested: t.requested, restricted: !canViewPosts,
      },
      posts: posts.rows.map(mapPost),
      requests,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Join (open → instant; otherwise request approval) / leave / cancel request.
app.post('/api/feeds/:id/join', auth.requireAuth, rateLimit(60, 60000, 'feed-join'), async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    if (!(await requireHandle(req, res))) return;
    const f = await db.query('SELECT id, open, created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].open || f.rows[0].created_by === req.user.id) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
      await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
      return res.json({ ok: true, isMember: true, requested: false });
    }
    // Request-to-join: record a pending request and ping the admin.
    await db.query('INSERT INTO feed_requests (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, req.user.id]);
    notify(f.rows[0].created_by, req.user.id, 'feed_request', null, fid);
    res.json({ ok: true, isMember: false, requested: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/feeds/:id/join', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  try {
    await db.query('DELETE FROM feed_members WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
    await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2', [fid, req.user.id]);
    res.json({ ok: true, isMember: false, requested: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin: approve / decline a pending join request.
app.post('/api/feeds/:id/requests/:uid', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id), uid = routeId(req.params.uid);
  if (!Number.isInteger(fid) || !Number.isInteger(uid)) return res.status(400).json({ error: 'Invalid request.' });
  try {
    const f = await db.query('SELECT created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can do that.' });
    const approve = req.body.approve !== false;
    const had = await db.query('DELETE FROM feed_requests WHERE feed_id = $1 AND user_id = $2 RETURNING user_id', [fid, uid]);
    if (approve && had.rows.length) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [fid, uid]);
      notify(uid, req.user.id, 'feed_approved', null, fid);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Edit a feed (admin only): name, @username, bio, avatar, join mode (open).
app.patch('/api/feeds/:id', auth.requireAuth, async (req, res) => {
  const fid = routeId(req.params.id);
  if (!Number.isInteger(fid)) return res.status(400).json({ error: 'Invalid feed id.' });
  const u = cleanFeedUsername(req.body.username);
  if (u.error) return res.status(400).json({ error: u.error });
  let name = (req.body.name || '').trim();
  if (name.length > 60) return res.status(400).json({ error: 'Feed name is too long.' });
  if (!name) name = u.username;
  const bio = (req.body.bio || '').trim().slice(0, 280);
  let setAvatar = false, avatarVal = null;
  if ('avatar' in req.body) {
    avatarVal = cleanImage(req.body.avatar);
    if (avatarVal === undefined) return res.status(400).json({ error: 'That image could not be used.' });
    setAvatar = true;
  }
  try {
    const f = await db.query('SELECT created_by FROM feeds WHERE id = $1', [fid]);
    if (!f.rows[0]) return res.status(404).json({ error: 'Feed not found.' });
    if (f.rows[0].created_by !== req.user.id) return res.status(403).json({ error: 'Only the feed admin can edit this feed.' });
    const fields = ['name = $1', 'username = $2', 'bio = $3'];
    const vals = [name, u.username, bio || null];
    if ('open' in req.body) { vals.push(!!req.body.open); fields.push(`open = $${vals.length}`); }
    if (setAvatar) { vals.push(avatarVal); fields.push(`avatar = $${vals.length}`); }
    vals.push(fid);
    let upd;
    try {
      upd = await db.query(`UPDATE feeds SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING id, username, name, bio, avatar, open, created_by`, vals);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'That feed username is already taken.' });
      throw e;
    }
    // Switching to open auto-clears the pending request queue.
    if ('open' in req.body && !!req.body.open) {
      await db.query('INSERT INTO feed_members (feed_id, user_id) SELECT feed_id, user_id FROM feed_requests WHERE feed_id = $1 ON CONFLICT DO NOTHING', [fid]);
      await db.query('DELETE FROM feed_requests WHERE feed_id = $1', [fid]);
    }
    const r = upd.rows[0];
    res.json({ feed: { id: r.id, username: r.username, name: r.name, bio: r.bio || null, avatar: r.avatar || null, open: r.open, isAdmin: true, isMember: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   CONTACTS  —  a personal saved list of people
═══════════════════════════════════════════════ */
app.get('/api/contacts', auth.requireAuth, async (req, res) => {
  try {
    const [list, counts] = await Promise.all([
      db.query(
        `SELECT u.id, u.name, u.username, u.avatar,
                c.email, c.phone, c.socials, c.website, c.address, c.about, c.notes
         FROM contacts c JOIN users u ON u.id = c.contact_id
         WHERE c.owner_id = $1 AND u.username IS NOT NULL
         ORDER BY lower(u.name)`,
        [req.user.id]
      ),
      db.query(
        `SELECT (SELECT COUNT(*)::int FROM contacts WHERE owner_id = $1) AS count,
                (SELECT COUNT(*)::int FROM contacts WHERE contact_id = $1) AS reverse_count`,
        [req.user.id]
      ),
    ]);
    res.json({
      count: counts.rows[0].count,
      reverseCount: counts.rows[0].reverse_count,
      contacts: list.rows.map((u) => ({
        id: u.id, name: u.name, username: u.username, avatar: u.avatar || null,
        email: u.email || '', phone: u.phone || '', socials: u.socials || '',
        website: u.website || '', address: u.address || '', about: u.about || '', notes: u.notes || '',
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Update a contact's owner-private details (not their profile).
app.patch('/api/contacts/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  const fields = ['email', 'phone', 'socials', 'website', 'address', 'about', 'notes'];
  const vals = [], sets = [];
  fields.forEach((f) => {
    if (f in req.body) { vals.push(String(req.body[f] || '').slice(0, 2000)); sets.push(`${f} = $${vals.length}`); }
  });
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.user.id, target);
  try {
    const r = await db.query(
      `UPDATE contacts SET ${sets.join(', ')} WHERE owner_id = $${vals.length - 1} AND contact_id = $${vals.length}`,
      vals
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
// Bulk-delete contacts (select / select-all on the contacts page).
// Declared before /:id so "delete" isn't captured as an :id.
app.post('/api/contacts/delete', auth.requireAuth, async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body.ids) ? req.body.ids : []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
  try {
    if (req.body.all) await db.query('DELETE FROM contacts WHERE owner_id = $1', [req.user.id]);
    else if (ids.length) await db.query('DELETE FROM contacts WHERE owner_id = $1 AND contact_id = ANY($2)', [req.user.id, ids]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.post('/api/contacts/:id', auth.requireAuth, rateLimit(120, 60000, 'contact'), async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  if (target === req.user.id) return res.status(400).json({ error: 'You cannot add yourself.' });
  try {
    const t = await chatIdentity(target);
    if (!t || !t.username) return res.status(404).json({ error: 'User not found.' });
    await db.query('INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, target]);
    notify(target, req.user.id, 'contact', null);
    res.json({ ok: true, isContact: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.delete('/api/contacts/:id', auth.requireAuth, async (req, res) => {
  const target = routeId(req.params.id);
  if (!Number.isInteger(target)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    await db.query('DELETE FROM contacts WHERE owner_id = $1 AND contact_id = $2', [req.user.id, target]);
    res.json({ ok: true, isContact: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   NOTIFICATIONS  —  likes / replies / follows / contacts
═══════════════════════════════════════════════ */
app.get('/api/notifications', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT n.id, n.type, n.post_id, n.feed_id, n.group_id, n.job_id, n.read, n.created_at,
              u.id AS actor_id, u.name AS actor_name, u.username AS actor_username, u.avatar AS actor_avatar,
              p.body AS post_body, j.title AS job_title
       FROM notifications n
       JOIN users u ON u.id = n.actor_id
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN jobs j ON j.id = n.job_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC LIMIT 60`,
      [req.user.id]
    );
    const unread = rows.filter((r) => !r.read).length;
    res.json({
      unread,
      notifications: rows.map((r) => ({
        id: r.id, type: r.type, postId: r.post_id || null, feedId: r.feed_id || null, groupId: r.group_id || null, jobId: r.job_id || null, read: r.read, created_at: r.created_at,
        postBody: r.post_body || null, jobTitle: r.job_title || null,
        actor: { id: r.actor_id, name: r.actor_name, username: r.actor_username, avatar: r.actor_avatar || null },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});
app.get('/api/notifications/count', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read = false', [req.user.id]);
    res.json({ unread: rows[0].unread });
  } catch (err) { res.json({ unread: 0 }); }
});
app.post('/api/notifications/read', auth.requireAuth, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET read = true WHERE user_id = $1 AND read = false', [req.user.id]);
    res.json({ ok: true });
  } catch (err) { res.json({ ok: false }); }
});

/* ═══════════════════════════════════════════════
   SEARCH  —  people + posts
═══════════════════════════════════════════════ */
const mapSearchUser = (u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: u.verified, categories: Array.isArray(u.categories) ? u.categories : [], accountType: u.account_type === 'business' ? 'business' : 'personal', businessVerified: u.business_verify_status === 'verified', headline: u.headline || null });
// Lightweight @mention autocomplete: a few users whose @username/name starts with
// (or contains) the typed prefix. Prefix matches rank first; blocked users excluded.
app.get('/api/social/mention-search', auth.requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase().slice(0, 30);
  if (!q) return res.json({ users: [] });
  try {
    const { rows } = await db.query(
      `SELECT id, name, username, avatar, verified, account_type, business_verify_status FROM users
       WHERE username IS NOT NULL AND (lower(username) LIKE $1 || '%' OR lower(name) LIKE '%' || $1 || '%')
         AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $2)
         AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $2)
       ORDER BY (lower(username) = $1) DESC, (lower(username) LIKE $1 || '%') DESC, lower(username) LIMIT 6`,
      [q, req.user.id]
    );
    res.json({ users: rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, accountType: u.account_type === 'business' ? 'business' : 'personal' })) });
  } catch (err) { console.error(err); res.json({ users: [] }); }
});
// Parse X-style search operators out of a query into a filter object. Unknown
// tokens stay as free text. Validates dates and numbers; bad values are ignored.
function parsePostSearch(raw) {
  const f = { text: '', from: null, tag: null, since: null, until: null, hasMedia: false, hasImage: false, hasVideo: false, minLikes: null, minReposts: null, sort: 'latest' };
  const words = [];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  for (const tok of String(raw || '').trim().split(/\s+/)) {
    if (!tok) continue;
    const m = tok.match(/^([a-z_]+):(.+)$/i);
    if (m) {
      const k = m[1].toLowerCase(), v = m[2];
      if (k === 'from') { f.from = v.replace(/^@/, '').slice(0, 40); continue; }
      if (k === 'since' && DATE_RE.test(v) && !isNaN(Date.parse(v))) { f.since = v; continue; }
      if (k === 'until' && DATE_RE.test(v) && !isNaN(Date.parse(v))) { f.until = v; continue; }
      if (k === 'has') { const lv = v.toLowerCase(); if (lv === 'image' || lv === 'photo') f.hasImage = true; else if (lv === 'video') f.hasVideo = true; else if (lv === 'media') f.hasMedia = true; continue; }
      if ((k === 'min_likes' || k === 'minlikes') && /^\d+$/.test(v)) { f.minLikes = Math.min(parseInt(v, 10), 1e9); continue; }
      if ((k === 'min_reposts' || k === 'minreposts') && /^\d+$/.test(v)) { f.minReposts = Math.min(parseInt(v, 10), 1e9); continue; }
      if (k === 'sort' && (v === 'top' || v === 'latest')) { f.sort = v; continue; }
    }
    if (tok[0] === '#' && tok.length > 1) { f.tag = tok.slice(1).toLowerCase().replace(/[^\p{L}\p{N}_]/gu, ''); continue; }
    words.push(tok);
  }
  f.text = words.join(' ').trim();
  return f;
}
app.get('/api/search', auth.requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().replace(/^@/, '');
  const scope = req.query.scope || '';
  if (!q) return res.json({});
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  const me = req.user.id;
  try {
    if (!(await requireHandle(req, res))) return;
    if (scope === 'posts') {
      // X-style operators: from:user  since:YYYY-MM-DD  until:YYYY-MM-DD
      // has:media|image|video  min_likes:N  min_reposts:N  #tag  @mention.
      const f = parsePostSearch(req.query.q || '');
      const where = ['p.parent_id IS NULL', 'p.to_main = true', 'p.created_at <= now()'];
      const params = [me];
      if (f.text) { params.push('%' + f.text.replace(/[%_\\]/g, '\\$&') + '%'); where.push(`p.body ILIKE $${params.length}`); }
      if (f.from) { params.push(f.from); where.push(`p.user_id = (SELECT id FROM users WHERE lower(username) = lower($${params.length}))`); }
      if (f.tag) { params.push(f.tag); where.push(`EXISTS(SELECT 1 FROM post_hashtags h WHERE h.post_id = p.id AND h.tag = lower($${params.length}))`); }
      if (f.since) { params.push(f.since); where.push(`p.created_at >= $${params.length}`); }
      if (f.until) { params.push(f.until); where.push(`p.created_at < ($${params.length}::date + interval '1 day')`); }
      if (f.hasImage) where.push(`p.image IS NOT NULL`);
      if (f.hasVideo) where.push(`p.media_kind = 'video'`);
      if (f.hasMedia) where.push(`(p.image IS NOT NULL OR p.media IS NOT NULL)`);
      if (f.minLikes != null) { params.push(f.minLikes); where.push(`(SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) >= $${params.length}`); }
      if (f.minReposts != null) { params.push(f.minReposts); where.push(`(SELECT COUNT(*) FROM post_reposts rp WHERE rp.post_id = p.id) >= $${params.length}`); }
      // Need at least one real constraint beyond the base (avoid dumping the whole feed).
      if (!f.text && !f.from && !f.tag && !f.since && !f.until && !f.hasMedia && !f.hasImage && !f.hasVideo && f.minLikes == null && f.minReposts == null) {
        return res.json({ posts: [] });
      }
      const order = f.sort === 'top'
        ? `ORDER BY (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) DESC, p.created_at DESC`
        : `ORDER BY p.created_at DESC`;
      const r = await db.query(POSTS_SELECT + 'WHERE ' + where.join(' AND ') + ' ' + order + ' LIMIT 40', params);
      return res.json({ posts: r.rows.map(mapPost) });
    }
    if (scope === 'circles') {
      const r = await db.query(
        `SELECT c.id, c.username, c.name, c.bio, c.avatar, c.created_by,
                (SELECT COUNT(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS members,
                EXISTS(SELECT 1 FROM circle_members m WHERE m.circle_id = c.id AND m.user_id = $1) AS is_member
         FROM circles c WHERE c.name ILIKE $2 OR c.username ILIKE $2 ORDER BY members DESC, c.name LIMIT 30`,
        [me, like]
      );
      return res.json({ circles: r.rows.map((c) => ({ id: c.id, username: c.username, name: c.name, bio: c.bio || null, avatar: c.avatar || null, members: c.members, isMember: c.is_member, isAdmin: c.created_by === me })) });
    }
    if (scope === 'feeds') {
      const r = await db.query(
        `SELECT f.id, f.username, f.name, f.bio, f.avatar, f.open, f.created_by,
                (SELECT COUNT(*)::int FROM feed_members m WHERE m.feed_id = f.id) AS members,
                EXISTS(SELECT 1 FROM feed_members m WHERE m.feed_id = f.id AND m.user_id = $1) AS is_member,
                EXISTS(SELECT 1 FROM feed_requests rq WHERE rq.feed_id = f.id AND rq.user_id = $1) AS requested
         FROM feeds f WHERE f.name ILIKE $2 OR f.username ILIKE $2 ORDER BY members DESC, f.name LIMIT 30`,
        [me, like]
      );
      return res.json({ feeds: r.rows.map((f) => ({ id: f.id, username: f.username, name: f.name, bio: f.bio || null, avatar: f.avatar || null, open: f.open, members: f.members, isMember: f.is_member, isAdmin: f.created_by === me, requested: f.requested })) });
    }
    if (scope === 'chats') {
      const r = await db.query(
        `SELECT m.id, m.body, m.created_at,
                (CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END) AS peer_id,
                u.name AS peer_name, u.username AS peer_username, u.avatar AS peer_avatar
         FROM at_messages m
         JOIN users u ON u.id = (CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END)
         WHERE (m.sender_id = $1 OR m.recipient_id = $1) AND m.body ILIKE $2
         ORDER BY m.created_at DESC LIMIT 30`,
        [me, like]
      );
      return res.json({ messages: r.rows.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, peer: { id: m.peer_id, name: m.peer_name, username: m.peer_username, avatar: m.peer_avatar || null } })) });
    }
    if (scope === 'groups') {
      const r = await db.query(
        `SELECT g.id, g.name, g.username, g.avatar,
                (SELECT COUNT(*)::int FROM at_group_members m WHERE m.group_id = g.id) AS members
         FROM at_groups g JOIN at_group_members me2 ON me2.group_id = g.id AND me2.user_id = $1
         WHERE g.name ILIKE $2 OR g.username ILIKE $2 ORDER BY g.name LIMIT 30`,
        [me, like]
      );
      return res.json({ groups: r.rows.map((g) => ({ id: g.id, name: g.name, username: g.username || null, avatar: g.avatar || null, members: g.members })) });
    }
    // Businesses scope: official business accounts (the company@username pages are
    // retired — a business is a real Atwe account now).
    if (scope === 'businesses' || scope === 'companies') {
      const r = await db.query(
        `SELECT id, name, username, avatar, verified, categories, account_type, headline, business_verify_status FROM users
         WHERE account_type = 'business' AND username IS NOT NULL AND (
           username ILIKE $1 OR name ILIKE $1
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories) c WHERE c ILIKE $1)
         )
         ORDER BY (lower(username) = lower($2)) DESC, (username ILIKE $1) DESC, lower(name) LIMIT 40`,
        [like, q]
      );
      return res.json({ businesses: r.rows.map(mapSearchUser) });
    }
    // Shop scope: marketplace listings (items / services) matched by name/description.
    if (scope === 'shop') {
      const r = await db.query(
        `${LISTING_SELECT} WHERE p.active = true AND (p.name ILIKE $1 OR p.description ILIKE $1)
           AND p.business_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $2)
           AND p.business_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $2)
         ORDER BY (p.name ILIKE $1) DESC, p.created_at DESC LIMIT 40`,
        [like, req.user.id]
      );
      return res.json({ listings: r.rows.map(mapListing) });
    }
    // People scope: professionals matched by name, @username, or industry.
    if (scope === 'people') {
      const r = await db.query(
        `SELECT id, name, username, avatar, verified, categories, account_type, headline, business_verify_status FROM users
         WHERE username IS NOT NULL AND (
           username ILIKE $1 OR name ILIKE $1
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories) c WHERE c ILIKE $1)
         )
         ORDER BY (lower(username) = lower($2)) DESC, (username ILIKE $1) DESC, lower(username) LIMIT 40`,
        [like, q]
      );
      return res.json({ users: r.rows.map(mapSearchUser) });
    }
    // Default ('all'): people + posts + a few marketplace listings.
    const [users, posts, listings] = await Promise.all([
      db.query(
        `SELECT id, name, username, avatar, verified, categories, account_type, headline, business_verify_status FROM users
         WHERE username IS NOT NULL AND (
           username ILIKE $1 OR name ILIKE $1
           OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(categories) c WHERE c ILIKE $1)
         )
         ORDER BY (lower(username) = lower($2)) DESC, (username ILIKE $1) DESC, lower(username) LIMIT 20`,
        [like, q]
      ),
      db.query(
        POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND p.body ILIKE $2 ORDER BY p.created_at DESC LIMIT 20`,
        [me, like]
      ),
      db.query(
        `${LISTING_SELECT} WHERE p.active = true AND (p.name ILIKE $1 OR p.description ILIKE $1)
           AND p.business_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $2)
           AND p.business_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $2)
         ORDER BY (p.name ILIKE $1) DESC, p.created_at DESC LIMIT 8`,
        [like, me]
      ),
    ]);
    res.json({
      users: users.rows.map(mapSearchUser),
      posts: posts.rows.map(mapPost),
      listings: listings.rows.map(mapListing),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   PLAN  —  authoritative, server-side
═══════════════════════════════════════════════ */
app.put('/api/plan', auth.requireAuth, async (req, res) => {
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  try {
    // Atomic transition: a row is returned only when the plan actually changes,
    // so concurrent upgrades (e.g. webhook + this call) can't double-send the email.
    const { rows } = await db.query(
      'UPDATE users SET plan = $1 WHERE id = $2 AND plan IS DISTINCT FROM $1 RETURNING name, email',
      [plan, req.user.id]
    );
    res.json({ plan });

    // Newly upgraded to Pro → confirm by email (best-effort, only on transition).
    if (plan === 'pro' && rows[0]) {
      try {
        await sendProWelcomeEmail(rows[0]);
      } catch (e) {
        console.error('Pro welcome email failed:', e.message);
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   BILLING  —  Stripe Checkout (webhook is mounted near the top)
═══════════════════════════════════════════════ */
app.post('/api/billing/checkout', auth.requireAuth, async (req, res) => {
  if (!billing.isConfigured()) {
    return res.status(503).json({ error: 'Billing not configured' });
  }
  try {
    const { rows } = await db.query(
      'SELECT id, email, stripe_customer_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await billing.createCheckoutSession(user, {
      successUrl: `${origin}/?checkout=success`,
      cancelUrl: `${origin}/?checkout=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ADMIN  —  /api/admin/* (requires is_admin)
═══════════════════════════════════════════════ */
app.get('/api/admin/users', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.plan, u.is_admin, u.email_verified,
             u.username, u.avatar, u.created_at, u.last_login_at,
             u.verified, u.verify_requested_at, u.account_type, u.business_verify_status,
             COUNT(c.id)::int AS chat_count,
             MAX(c.updated_at) AS last_chat_at,
             (SELECT COUNT(*)::int FROM admin_messages am
                WHERE am.user_id = u.id AND am.sender = 'user' AND am.read_by_admin = false) AS unread_msgs
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read one user's chats (full conversations) for the admin dashboard.
app.get('/api/admin/users/:id/chats', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT id, title, messages, created_at, updated_at
       FROM chats WHERE user_id = $1 ORDER BY updated_at DESC`,
      [id]
    );
    res.json({ user: u.rows[0], chats: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// AtChat ACTIVITY for one user — counts + their PUBLIC posts only.
// Deliberately never exposes private DM or group message contents.
app.get('/api/admin/users/:id/atchat', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, username, avatar FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const s = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM follows WHERE following_id = $1) AS followers,
        (SELECT COUNT(*)::int FROM follows WHERE follower_id  = $1) AS following,
        (SELECT COUNT(*)::int FROM posts   WHERE user_id      = $1) AS posts,
        (SELECT COUNT(DISTINCT CASE WHEN sender_id = $1 THEN recipient_id ELSE sender_id END)::int
           FROM at_messages WHERE sender_id = $1 OR recipient_id = $1) AS dm_people,
        (SELECT COUNT(*)::int FROM at_messages WHERE sender_id = $1) AS dm_sent,
        (SELECT COUNT(*)::int FROM at_group_members WHERE user_id = $1) AS groups,
        (SELECT COUNT(*)::int FROM at_group_messages WHERE sender_id = $1) AS group_sent`,
      [id]
    );
    const posts = await db.query(
      `SELECT p.id, p.body, p.image, p.created_at,
              (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes
       FROM posts p WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 30`,
      [id]
    );
    res.json({
      user: { id: u.rows[0].id, name: u.rows[0].name, username: u.rows[0].username, avatar: u.rows[0].avatar || null },
      stats: s.rows[0],
      posts: posts.rows.map((p) => ({ id: p.id, body: p.body, image: p.image || null, created_at: p.created_at, likes: p.likes })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Read the admin ↔ user message thread (viewing clears the unread badge).
app.get('/api/admin/users/:id/messages', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `SELECT id, sender, body, image, created_at FROM admin_messages
       WHERE user_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    // The admin is actively viewing, so mark the user's replies as read.
    db.query(
      `UPDATE admin_messages SET read_by_admin = true
       WHERE user_id = $1 AND sender = 'user' AND read_by_admin = false`,
      [id]
    ).catch(() => {});
    res.json({ user: u.rows[0], messages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Admin sends a message to a user; also emails them a notification (best-effort).
app.post('/api/admin/users/:id/messages', auth.requireAdmin, rateLimit(60, 60000, 'admin-msg'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const body = (req.body.body || '').trim();
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  if (!body && !image) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 5000) return res.status(400).json({ error: 'Message is too long.' });
  try {
    const u = await db.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const { rows } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, image, read_by_user, read_by_admin)
       VALUES ($1, 'admin', $2, $3, false, true)
       RETURNING id, sender, body, image, created_at`,
      [id, body, image]
    );
    try {
      await sendAdminMessageEmail(u.rows[0], body || '📷 Photo');
    } catch (e) {
      console.error('Admin message email failed:', e.message);
    }
    res.json({ message: { ...rows[0], image: rows[0].image || null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.patch('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  const fields = [];
  const values = [];
  if (req.body.plan === 'pro' || req.body.plan === 'free') {
    values.push(req.body.plan);
    fields.push(`plan = $${values.length}`);
  }
  if (typeof req.body.is_admin === 'boolean') {
    // Guard: an admin can't strip their own admin rights (avoid lockout).
    if (req.user.id === id && req.body.is_admin === false) {
      return res.status(400).json({ error: 'You cannot remove your own admin access.' });
    }
    values.push(req.body.is_admin);
    fields.push(`is_admin = $${values.length}`);
  }
  if (typeof req.body.email_verified === 'boolean') {
    values.push(req.body.email_verified);
    fields.push(`email_verified = $${values.length}`);
  }
  // Approve/revoke the verified badge. Either way the pending request is cleared.
  if (typeof req.body.verified === 'boolean') {
    values.push(req.body.verified);
    fields.push(`verified = $${values.length}`);
    fields.push('verify_requested_at = NULL');
  }
  // Business verification status: none | pending | verified.
  if (['none', 'pending', 'verified'].includes(req.body.businessVerifyStatus)) {
    values.push(req.body.businessVerifyStatus);
    fields.push(`business_verify_status = $${values.length}`);
  }
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, email, plan, is_admin, email_verified, verified, verify_requested_at, username, account_type, business_verify_status`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    // Return only the changed columns (no avatar/banner keys) so the client
    // merge can't blank out fields it didn't touch.
    res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid user id.' });
  if (req.user.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account here.' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ─── Admin: platform overview metrics ─── */
app.get('/api/admin/stats', auth.requireAdmin, async (_req, res) => {
  const c = (sql) => db.query(sql).then(r => parseInt(r.rows[0].c, 10) || 0).catch(() => 0);
  try {
    const [users, pro, admins, verified, withUsername, newToday, new7d,
           posts, replies, circles, groups, dms, calls, locks] = await Promise.all([
      c(`SELECT COUNT(*) c FROM users`),
      c(`SELECT COUNT(*) c FROM users WHERE plan = 'pro'`),
      c(`SELECT COUNT(*) c FROM users WHERE is_admin`),
      c(`SELECT COUNT(*) c FROM users WHERE email_verified`),
      c(`SELECT COUNT(*) c FROM users WHERE username IS NOT NULL`),
      c(`SELECT COUNT(*) c FROM users WHERE created_at > now() - interval '1 day'`),
      c(`SELECT COUNT(*) c FROM users WHERE created_at > now() - interval '7 days'`),
      c(`SELECT COUNT(*) c FROM posts WHERE parent_id IS NULL`),
      c(`SELECT COUNT(*) c FROM posts WHERE parent_id IS NOT NULL`),
      c(`SELECT COUNT(*) c FROM circles`),
      c(`SELECT COUNT(*) c FROM at_groups`),
      c(`SELECT COUNT(*) c FROM at_messages`),
      c(`SELECT COUNT(*) c FROM calls`),
      c(`SELECT COUNT(*) c FROM reserved_usernames`),
    ]);
    res.json({ stats: { users, pro, free: users - pro, admins, verified, withUsername,
      newToday, new7d, posts, replies, circles, groups, dms, calls, locks } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load stats.' });
  }
});

// Admin diagnostic: which TURN provider is live for calls, and (for Cloudflare)
// whether credentials actually mint successfully right now.
app.get('/api/admin/turn', auth.requireAdmin, async (_req, res) => {
  if (process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN) {
    try {
      const s = await cloudflareTurnServer();
      return res.json({ provider: 'cloudflare', ok: !!(s && s.urls), urls: s ? s.urls : null });
    } catch (e) {
      return res.json({ provider: 'cloudflare', ok: false, error: e.message });
    }
  }
  if (process.env.TURN_URL) {
    return res.json({ provider: 'static', ok: true, urls: process.env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean) });
  }
  res.json({ provider: 'fallback', ok: true, urls: ['turn:openrelay.metered.ca:443'] });
});

/* ─── Admin: username locks (reserved usernames) ─── */
app.get('/api/admin/username-locks', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.username, r.note, r.created_at,
              EXISTS(SELECT 1 FROM users u WHERE lower(u.username) = r.username) AS taken
       FROM reserved_usernames r ORDER BY r.created_at DESC`
    );
    res.json({ locks: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load username locks.' });
  }
});
app.post('/api/admin/username-locks', auth.requireAdmin, async (req, res) => {
  const username = (req.body.username || '').trim().replace(/^@/, '').toLowerCase();
  const note = ((req.body.note || '').trim().slice(0, 200)) || null;
  if (!username) return res.status(400).json({ error: 'Enter a username to lock.' });
  if (username.length > 40) return res.status(400).json({ error: 'Username is too long.' });
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can use letters, numbers, dots, dashes and underscores.' });
  }
  try {
    await db.query(
      `INSERT INTO reserved_usernames (username, note, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (username) DO UPDATE SET note = EXCLUDED.note`,
      [username, note, req.user.id]
    );
    const taken = await db.query('SELECT 1 FROM users WHERE lower(username) = $1', [username]);
    res.json({ ok: true, lock: { username, note, created_at: new Date().toISOString(), taken: taken.rowCount > 0 } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not lock that username.' });
  }
});
app.delete('/api/admin/username-locks/:username', auth.requireAdmin, async (req, res) => {
  const username = (req.params.username || '').trim().replace(/^@/, '').toLowerCase();
  try {
    await db.query('DELETE FROM reserved_usernames WHERE username = $1', [username]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not unlock that username.' });
  }
});

/* ─── Admin: user reports ─── */
app.get('/api/admin/reports', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id, r.reason, r.created_at,
              rep.name AS reporter_name, rep.username AS reporter_username,
              tgt.id AS reported_id, tgt.name AS reported_name, tgt.username AS reported_username
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       JOIN users tgt ON tgt.id = r.reported_id
       ORDER BY r.created_at DESC LIMIT 200`
    );
    res.json({ reports: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load reports.' }); }
});
app.delete('/api/admin/reports/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM reports WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not dismiss.' }); }
});

/* ─── Admin: content moderation (recent posts) ─── */
app.get('/api/admin/posts', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.body, p.image, p.created_at, p.parent_id,
              u.name AS author_name, u.username AS author_username,
              (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id)::int AS likes
       FROM posts p JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 60`
    );
    res.json({ posts: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load posts.' });
  }
});
app.delete('/api/admin/posts/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete that post.' });
  }
});

/* ─── Admin: support requests inbox ─── */
app.get('/api/admin/support', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT s.id, s.email, s.message, s.created_at, s.user_id, u.name AS user_name, u.username AS user_username
       FROM support_requests s LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.created_at DESC LIMIT 200`
    );
    res.json({ requests: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load support requests.' });
  }
});
app.delete('/api/admin/support/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    await db.query('DELETE FROM support_requests WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not dismiss that request.' });
  }
});

/* ─── Admin: broadcast to every user — lands in their in-app inbox AND, when
       SMTP is configured, emails them a branded message from team@atwe.com ─── */
app.post('/api/admin/broadcast', auth.requireAdmin, rateLimit(10, 60000, 'admin-broadcast'), async (req, res) => {
  const body = (req.body.body || '').trim();
  const subject = (req.body.subject || '').trim().slice(0, 160);
  const alsoEmail = req.body.email !== false; // default on
  if (!body) return res.status(400).json({ error: 'Write a message to broadcast.' });
  if (body.length > 4000) return res.status(400).json({ error: 'That message is too long.' });
  try {
    const { rowCount } = await db.query(
      `INSERT INTO admin_messages (user_id, sender, body, read_by_user, read_by_admin)
       SELECT id, 'admin', $1, false, true FROM users`,
      [body]
    );
    let emailing = 0;
    if (alsoEmail && mailer.isConfigured()) {
      const { rows } = await db.query(`SELECT name, email FROM users WHERE email IS NOT NULL AND email <> ''`);
      emailing = rows.length;
      // Detached: don't hold the response open while the list sends.
      sendTeamBroadcastEmails(rows, subject || 'A message from Atwe', body).catch((e) =>
        console.error('Team broadcast failed:', e.message)
      );
    }
    res.json({ ok: true, sent: rowCount, emailing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send the broadcast.' });
  }
});

/* ═══════════════════════════════════════════════
   CHAT  —  the actual Claude call
   Plan is taken from the authenticated user (authoritative);
   guests (no token) fall back to the client-sent plan, local-only.
═══════════════════════════════════════════════ */
app.post('/api/chat', auth.optionalAuth, rateLimit(30, 60000, 'chat'), async (req, res) => {
  const { messages, plan: clientPlan } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
  }
  if (messages.length > 60) {
    return res.status(400).json({ error: 'Conversation is too long.' });
  }
  const validShape = messages.every(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && m.content != null
  );
  if (!validShape) {
    return res.status(400).json({ error: 'Invalid messages' });
  }

  let plan = clientPlan;
  if (req.user) {
    try {
      const { rows } = await db.query('SELECT plan FROM users WHERE id = $1', [req.user.id]);
      plan = rows[0]?.plan || 'free';
    } catch {
      /* fall back to client plan if the lookup fails */
    }
  }

  try {
    const maxTokens = plan === 'pro' ? 4096 : 1500;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system:
        'You are Atwe AI, an intelligent assistant for modern businesses. Give clear, accurate, well-structured answers. Be professional, concise, and genuinely helpful — thorough when it matters, brief when it does not. Use markdown (bold, lists, headings, code) only when it improves clarity. Keep a clean, classy, understated tone; do not use emojis unless the user uses them first.',
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
    res.json({ content: text, usage: msg.usage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ═══════════════════════════════════════════════
   ATWE AI — job/worker matchmaker (retrieval + AI ranking)
═══════════════════════════════════════════════ */
const _likeArg = (s) => '%' + String(s).replace(/[%_\\]/g, '\\$&') + '%';
app.post('/api/ai/jobmatch', auth.requireAuth, rateLimit(20, 60000, 'ai-match'), async (req, res) => {
  if (!(await requireHandle(req, res))) return;
  const mode = req.body.mode === 'worker' ? 'worker' : 'job';
  const role = (req.body.role || '').trim().slice(0, 120);
  const location = (req.body.location || '').trim().slice(0, 120);
  const skills = (req.body.skills || '').trim().slice(0, 300);
  const schedule = (req.body.schedule || '').trim().slice(0, 60);
  const experience = (req.body.experience || '').trim().slice(0, 60);
  const remote = req.body.remote === true;
  // Match on individual keywords (role + each skill), not the whole phrase.
  const tokens = [...new Set((role + ' ' + skills).toLowerCase().split(/[\s,]+/).filter((t) => t.length >= 2))].slice(0, 8);
  try {
    // ── Retrieval: pull a candidate pool from the DB by loose criteria ──
    let candidates = [];
    if (mode === 'job') {
      const conds = [], params = [req.user.id]; // $1 = me (JOB_COLS applied/saved)
      if (tokens.length) {
        const ors = tokens.map((t) => { params.push(_likeArg(t)); const i = params.length; return `(j.title ILIKE $${i} OR j.description ILIKE $${i} OR j.industry ILIKE $${i} OR j.company ILIKE $${i})`; });
        conds.push('(' + ors.join(' OR ') + ')');
      }
      if (location) { params.push(_likeArg(location)); conds.push(`j.location ILIKE $${params.length}`); }
      if (remote) conds.push('j.remote = true');
      const { rows } = await db.query(
        `SELECT ${JOB_COLS} ${JOB_FROM} ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
         ORDER BY (j.featured_until IS NOT NULL AND j.featured_until > now()) DESC, j.created_at DESC LIMIT 25`,
        params
      );
      candidates = rows.map((j) => mapJob(j, req.user.id));
    } else {
      // LEFT JOIN the "open to work" listings so people who actively posted one
      // surface first and their listing text widens the match.
      const conds = [`u.username IS NOT NULL`, `u.account_type = 'personal'`], params = [];
      if (tokens.length) {
        const ors = tokens.map((t) => {
          params.push(_likeArg(t)); const i = params.length;
          return `(u.name ILIKE $${i} OR u.headline ILIKE $${i} OR u.note ILIKE $${i} OR wl.role ILIKE $${i} OR wl.about ILIKE $${i} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.categories) c WHERE c ILIKE $${i}) OR EXISTS (SELECT 1 FROM user_skills s WHERE s.user_id = u.id AND s.name ILIKE $${i}))`;
        });
        conds.push('(' + ors.join(' OR ') + ')');
      }
      if (location) { params.push(_likeArg(location)); conds.push(`(u.location ILIKE $${params.length} OR wl.location ILIKE $${params.length})`); }
      if (remote) conds.push('wl.remote = true');
      const { rows } = await db.query(
        `SELECT u.id, u.name, u.username, u.avatar, u.verified, u.headline, u.account_type, u.location, u.note,
                (SELECT array_agg(s.name) FROM user_skills s WHERE s.user_id = u.id) AS skills,
                wl.user_id IS NOT NULL AS open_to_work, wl.role AS listing_role, wl.about AS listing_about
         FROM users u LEFT JOIN worker_listings wl ON wl.user_id = u.id
         WHERE ${conds.join(' AND ')}
         ORDER BY (wl.user_id IS NOT NULL) DESC, COALESCE(wl.updated_at, u.created_at) DESC, u.id DESC LIMIT 25`,
        params
      );
      candidates = rows.map((u) => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar || null, verified: !!u.verified, headline: u.headline || u.listing_role || null, accountType: 'personal', location: u.location || null, note: u.note || u.listing_about || null, skills: Array.isArray(u.skills) ? u.skills.filter(Boolean) : [], openToWork: !!u.open_to_work }));
    }

    const brief = { mode, role, location, skills, schedule, experience, remote };
    // No AI configured (or nothing to rank) → return the retrieval as-is.
    if (!process.env.ANTHROPIC_API_KEY || !candidates.length) {
      return res.json({ mode, matches: candidates.slice(0, 8).map((c) => ({ candidate: c, reason: null })), summary: null, ai: false });
    }

    // ── AI ranking: ask Atwe AI to shortlist + explain ──
    const compact = candidates.map((c, i) => mode === 'job'
      ? { i, title: c.title, company: c.company, location: c.location, type: c.type, remote: c.remote, salary: salaryText(c), desc: (c.description || '').slice(0, 280) }
      : { i, name: c.name, headline: c.headline, location: c.location, skills: c.skills, about: c.note, openToWork: c.openToWork });
    const sys = 'You are Atwe AI, a job/worker matchmaker for a business networking app. ' +
      'Given what someone is looking for and a numbered list of candidates, pick the best matches (up to 8), best first. ' +
      'Only include genuinely relevant candidates — fewer is fine. Each reason is ONE short, specific sentence. ' +
      'Reply with STRICT JSON only: {"summary": string, "matches": [{"i": number, "reason": string}]}. No markdown, no prose outside JSON. ' +
      'Never mention "Claude" or "Anthropic".';
    const userMsg = (mode === 'job'
      ? 'A person is looking for a JOB.\n' : 'An employer is looking for a WORKER.\n') +
      'Their criteria: ' + JSON.stringify(brief) + '\n\nCandidates:\n' + JSON.stringify(compact) +
      '\n\nReturn the JSON shortlist now.';
    let summary = null, ranked = null;
    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1024, system: sys,
        messages: [{ role: 'user', content: userMsg }],
      });
      const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
      const j = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
      const parsed = JSON.parse(j);
      summary = typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : null;
      if (Array.isArray(parsed.matches)) ranked = parsed.matches;
    } catch (e) { /* fall back to retrieval order below */ }

    let matches;
    if (ranked) {
      matches = ranked
        .filter((m) => Number.isInteger(m.i) && candidates[m.i])
        .slice(0, 8)
        .map((m) => ({ candidate: candidates[m.i], reason: typeof m.reason === 'string' ? m.reason.slice(0, 240) : null }));
    } else {
      matches = candidates.slice(0, 8).map((c) => ({ candidate: c, reason: null }));
    }
    res.json({ mode, matches, summary, ai: !!ranked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not run the match. Please try again.' });
  }
});
// Short pay string for the AI brief (server-side mirror of the client formatter).
function salaryText(j) {
  if (j.salaryMin == null && j.salaryMax == null) return null;
  const f = (n) => '$' + Number(n).toLocaleString();
  const lo = j.salaryMin != null ? j.salaryMin : j.salaryMax, hi = j.salaryMax != null ? j.salaryMax : j.salaryMin;
  return (lo !== hi ? f(lo) + '–' + f(hi) : f(lo)) + (j.salaryPeriod ? '/' + j.salaryPeriod : '');
}

/* ═══════════════════════════════════════════════
   RESUMES — AI-built CVs a seeker can manage + download
═══════════════════════════════════════════════ */
function mapResume(r) {
  const data = r.data || {};
  return { id: r.id, title: r.title || (data.resume && data.resume.fullName) || 'Resume', data, created_at: r.created_at, updated_at: r.updated_at };
}
// List my resumes (newest first) — metadata + a small preview, no heavy payload trimming needed (resumes are small JSON).
app.get('/api/resumes', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, title, data, created_at, updated_at FROM resumes WHERE user_id = $1 ORDER BY updated_at DESC', [req.user.id]);
    res.json({ resumes: rows.map(mapResume) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.get('/api/resumes/:id', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, title, data, created_at, updated_at FROM resumes WHERE id = $1 AND user_id = $2', [String(req.params.id), req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Resume not found.' });
    res.json({ resume: mapResume(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// Create / update a resume (owner-scoped upsert, idempotent on the client id).
app.put('/api/resumes/:id', auth.requireAuth, async (req, res) => {
  const id = String(req.params.id).slice(0, 64);
  if (!id) return res.status(400).json({ error: 'Invalid id.' });
  const title = (req.body.title || '').toString().slice(0, 160) || 'Resume';
  let data = req.body.data;
  if (typeof data !== 'object' || data == null) data = {};
  if (JSON.stringify(data).length > 200000) return res.status(400).json({ error: 'That resume is too large.' });
  try {
    const { rows } = await db.query(
      `INSERT INTO resumes (id, user_id, title, data) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET title = $3, data = $4, updated_at = now() WHERE resumes.user_id = $2
       RETURNING id, title, data, created_at, updated_at`,
      [id, req.user.id, title, JSON.stringify(data)]
    );
    if (!rows[0]) return res.status(403).json({ error: 'Not your resume.' });
    res.json({ resume: mapResume(rows[0]) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the resume.' }); }
});
app.delete('/api/resumes/:id', auth.requireAuth, async (req, res) => {
  try { await db.query('DELETE FROM resumes WHERE id = $1 AND user_id = $2', [String(req.params.id), req.user.id]); res.json({ ok: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete.' }); }
});
// Atwe AI builds a structured, polished resume from the answers the seeker gives,
// enriched with their saved experiences + skills. Returns the resume JSON object.
app.post('/api/ai/resume', auth.requireAuth, rateLimit(12, 60000, 'ai-resume'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  const a = req.body || {};
  const clip = (v, n) => (v == null ? '' : String(v)).slice(0, n);
  const answers = {
    fullName: clip(a.fullName, 120), email: clip(a.email, 160), phone: clip(a.phone, 60), location: clip(a.location, 120),
    targetRole: clip(a.targetRole, 160), years: clip(a.years, 40), history: clip(a.history, 4000),
    education: clip(a.education, 2000), skills: clip(a.skills, 1000), about: clip(a.about, 2000), links: clip(a.links, 400),
  };
  try {
    // Enrich with what we already know (saved experience + skills + headline).
    let known = '';
    try {
      const u = await db.query('SELECT name, headline, location FROM users WHERE id = $1', [req.user.id]);
      const exp = await db.query('SELECT title, company, start_year, end_year FROM experiences WHERE user_id = $1 ORDER BY (end_year IS NULL) DESC, end_year DESC NULLS FIRST LIMIT 15', [req.user.id]);
      const sk = await db.query('SELECT name FROM user_skills WHERE user_id = $1 LIMIT 40', [req.user.id]);
      const parts = [];
      if (u.rows[0]) parts.push(`Profile: ${u.rows[0].name || ''}${u.rows[0].headline ? ' — ' + u.rows[0].headline : ''}${u.rows[0].location ? ' (' + u.rows[0].location + ')' : ''}`);
      if (exp.rows.length) parts.push('Saved experience:\n' + exp.rows.map((e) => `- ${e.title || ''}${e.company ? ' at ' + e.company : ''} (${e.start_year || '?'}–${e.end_year || 'Present'})`).join('\n'));
      if (sk.rows.length) parts.push('Saved skills: ' + sk.rows.map((s) => s.name).join(', '));
      known = parts.join('\n');
    } catch (_) { /* enrichment is best-effort */ }

    const sys = 'You are Atwe AI, an expert resume writer. Build a clean, professional, ATS-friendly resume from the information provided. ' +
      'Write a strong 2–3 sentence professional summary, turn raw history into concise achievement-oriented bullet points (start with action verbs, quantify where possible), and infer reasonable structure. Do NOT invent employers, dates, or facts that were not given. ' +
      'Reply with STRICT JSON only, this exact shape: ' +
      '{"fullName":string,"headline":string,"email":string,"phone":string,"location":string,"links":[string],"summary":string,' +
      '"experience":[{"title":string,"company":string,"location":string,"start":string,"end":string,"bullets":[string]}],' +
      '"education":[{"school":string,"degree":string,"field":string,"start":string,"end":string}],' +
      '"skills":[string]}. No markdown, no prose outside JSON. Never mention "Claude" or "Anthropic".';
    const userMsg = 'Build a resume.\nAnswers: ' + JSON.stringify(answers) + (known ? '\n\nWhat we already know about them:\n' + known : '') + '\n\nReturn the JSON resume now.';
    const msg = await anthropic.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2048, system: sys, messages: [{ role: 'user', content: userMsg }] });
    const txt = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    const j = txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    const resume = JSON.parse(j);
    if (!resume || typeof resume !== 'object') return res.status(502).json({ error: 'Atwe AI could not build that. Try adding a bit more detail.' });
    res.json({ resume, answers });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not build the resume. Please try again.' }); }
});

/* ═══════════════════════════════════════════════
   ATWE AI — in-app support assistant + "explain this" helper
═══════════════════════════════════════════════ */
const SUPPORT_SYSTEM =
  `You are Atwe AI Support, the in-app help assistant for Atwe — an AI assistant app for business that also includes AtChat, a social space. ` +
  `Help users ONLY with questions about the app: how features work, accounts/profiles, plans, and troubleshooting. ` +
  `Be warm, concise and clear; prefer short paragraphs or numbered steps.\n\n` +
  `What Atwe offers:\n` +
  `- Atwe AI: chat with an intelligent assistant; supports text, voice (mic), images, and PDFs. Group chats into Projects. History is saved when signed in.\n` +
  `- Plans: Free (Atwe Standard) and Pro ($9.99/month — longer, more in-depth answers, PDF understanding, priority speed). Manage your plan from the profile menu (bottom-left).\n` +
  `- Account: sign up with email; set a display name, @username and profile photo in Edit profile; toggle dark/light mode in Settings.\n` +
  `- AtChat (social): a Home feed (For you / Following), direct Messages, Groups, and your Profile. You can post (text/photo), like, follow/unfollow, DM people, and create group chats. A @username is required to use AtChat.\n\n` +
  `If you cannot fully resolve the issue, reassure the user and tell them to tap "Message the team" to leave their email and details so the Atwe team can follow up. ` +
  `Do not invent features that don't exist. If asked something unrelated to the app, gently steer back to app support. ` +
  `You are Atwe AI — never mention "Claude" or "Anthropic".`;

app.post('/api/support/ask', auth.optionalAuth, rateLimit(20, 60000), async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Invalid messages' });
  const ok = messages.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (!ok) return res.status(400).json({ error: 'Invalid messages' });
  const convo = messages.slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: SUPPORT_SYSTEM,
      messages: convo,
    });
    res.json({ content: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "Atwe AI is unavailable right now. Please try again, or tap “Message the team”." });
  }
});

// Explain / clarify an AtChat post or message.
app.post('/api/explain', auth.requireAuth, rateLimit(40, 60000, 'explain'), async (req, res) => {
  const text = (req.body.text || '').toString().trim().slice(0, 4000);
  const kind = req.body.kind === 'post' ? 'post' : 'message';
  const mode = req.body.mode === 'summarize' ? 'summarize' : 'explain';
  if (!text) return res.status(400).json({ error: 'Nothing to explain.' });
  const system = mode === 'summarize'
    ? `You are Atwe AI. In 1–2 short sentences, summarize the key point of the following AtChat ${kind} ` +
      `so the reader can grasp it at a glance. Be concise and neutral. ` +
      `You are Atwe AI — never mention "Claude" or "Anthropic".`
    : `You are Atwe AI. In 1–3 short, friendly sentences, explain or clarify the meaning, tone and intent of the following AtChat ${kind}. ` +
      `If it asks a question or makes a request, say what's being asked. Be concise and genuinely helpful. ` +
      `You are Atwe AI — never mention "Claude" or "Anthropic".`;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 320,
      system,
      messages: [{ role: 'user', content: text }],
    });
    res.json({ content: msg.content.find((b) => b.type === 'text')?.text ?? '' });
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: 'Atwe AI is unavailable right now. Please try again.' });
  }
});

// Shared AI writing assistant — powers the post/message composer, the profile
// optimizer, and the in-chat tools. One endpoint, a per-task system prompt.
const AI_WRITE_TASKS = {
  improve: 'Improve the writing: fix grammar and clarity, keep the meaning and roughly the same length and tone. Return only the improved text.',
  expand: 'Expand this into a longer, richer version with more detail — keep the same voice and intent. Return only the new text.',
  shorten: 'Make this more concise and punchy without losing the key point. Return only the shortened text.',
  rephrase: 'Reword this in a fresh way while keeping the same meaning and tone. Return only the rephrased text.',
  generate: 'Write a clear, engaging social post for a professional business network based on the user’s request. Keep it natural and not over-hashtagged. Return only the post text.',
  reply: 'Draft a brief, friendly, professional reply to the following message. Return only the reply text — no quotes, no preamble.',
  headline: 'Write one short, punchy professional profile headline (under 120 characters) from the details provided. Return only the headline, no quotes.',
  about: 'Write a confident, first-person professional "About" summary (2–4 short sentences) from the details provided. Return only the summary text.',
  summarize: 'Summarize the key points of the following conversation in 1–3 short sentences. Be neutral and concise. Return only the summary.',
  translate: 'Translate the following text. Return only the translation, nothing else.',
};
app.post('/api/ai/write', auth.requireAuth, rateLimit(40, 60000, 'ai-write'), async (req, res) => {
  const task = AI_WRITE_TASKS[req.body.task] ? req.body.task : null;
  if (!task) return res.status(400).json({ error: 'Unknown writing task.' });
  const text = (req.body.text || '').toString().trim().slice(0, 8000);
  const instruction = (req.body.instruction || '').toString().trim().slice(0, 400);
  if (!text && task !== 'generate') return res.status(400).json({ error: 'Nothing to work with.' });
  if (task === 'generate' && !instruction && !text) return res.status(400).json({ error: 'Tell Atwe AI what to write.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  let sys = 'You are Atwe AI, a writing assistant inside the Atwe business app. ' + AI_WRITE_TASKS[task]
    + ' Never add commentary, labels, or markdown fences. You are Atwe AI — never mention "Claude" or "Anthropic".';
  if (task === 'translate') sys += ' Target language: ' + (req.body.lang ? String(req.body.lang).slice(0, 40) : 'English') + '.';
  let userMsg = text;
  if (task === 'generate') userMsg = instruction ? ('Request: ' + instruction + (text ? '\n\nStarting draft: ' + text : '')) : text;
  else if (instruction) userMsg = text + '\n\nExtra instruction: ' + instruction;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: sys,
      messages: [{ role: 'user', content: userMsg }],
    });
    const out = (msg.content.find((b) => b.type === 'text')?.text || '').trim();
    if (!out) return res.status(503).json({ error: 'Atwe AI couldn’t generate that. Please try again.' });
    res.json({ text: out });
  } catch (err) { console.error(err); res.status(503).json({ error: 'Atwe AI is unavailable right now. Please try again.' }); }
});

// AI alt-text: describe an attached photo for screen readers (Atwe AI vision).
app.post('/api/ai/alt-text', auth.requireAuth, rateLimit(20, 60000, 'ai-alt'), async (req, res) => {
  const img = (req.body.image || '').toString();
  const m = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(img);
  if (!m || img.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Attach a photo first.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
  const mediaType = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 200,
      system: 'You are Atwe AI. Write concise alt text (≤2 sentences) describing this image for a blind user — the key subjects, setting and any visible text. No "image of"/"photo of" preamble, no markdown, no quotes. Never mention "Claude" or "Anthropic".',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } },
        { type: 'text', text: 'Describe this image as alt text.' },
      ] }],
    });
    const alt = (msg.content.find((b) => b.type === 'text')?.text || '').trim().slice(0, 1000);
    if (!alt) return res.status(503).json({ error: 'Atwe AI couldn’t describe that image.' });
    res.json({ alt });
  } catch (err) { console.error(err); res.status(503).json({ error: 'Atwe AI is unavailable right now.' }); }
});

// AI "network digest" — a short catch-up of what people you follow have posted.
app.post('/api/ai/digest', auth.requireAuth, rateLimit(12, 60000, 'ai-digest'), async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.body, u.name AS author
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at > now() - interval '3 days'
         AND p.body <> '' AND p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
       ORDER BY p.created_at DESC LIMIT 20`,
      [req.user.id]
    );
    if (!rows.length) return res.json({ text: 'Nothing new from people you follow in the last few days. Follow more people to get a livelier digest.' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Atwe AI is not available right now.' });
    const items = rows.map((r) => '- ' + (r.author || 'Someone').split(' ')[0] + ': ' + String(r.body).replace(/\s+/g, ' ').slice(0, 240)).join('\n').slice(0, 6000);
    const sys = 'You are Atwe AI. Given recent posts from the people someone follows on the Atwe business network, write a friendly 2–4 sentence "what’s happening in your network" digest highlighting the main themes and anything notable. Be concise and skimmable. No markdown headings. You are Atwe AI — never mention "Claude" or "Anthropic".';
    const msg = await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: sys, messages: [{ role: 'user', content: 'Recent posts:\n' + items + '\n\nWrite the digest.' }] });
    res.json({ text: (msg.content.find((b) => b.type === 'text')?.text || '').trim() || 'Could not build a digest right now.' });
  } catch (err) { console.error(err); res.status(503).json({ error: 'Atwe AI is unavailable right now.' }); }
});

/* ═══════════════════════════════════════════════
   ERROR HANDLER  —  consistent JSON for body-parser & unexpected errors
═══════════════════════════════════════════════ */
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

/* ═══════════════════════════════════════════════
   SPA DEEP LINKS
   Serve the app shell for pretty, shareable URLs (/<username>,
   /group/<username>, /circle/<username>, …). Static files are matched first
   (above), so this only catches app routes + misses; real-file misses (paths
   ending in a known asset extension) fall through to a normal 404. The client
   router reads location.pathname and opens the right profile/circle/group.
═══════════════════════════════════════════════ */
app.get('*', (req, res, next) => {
  if (req.hostname === ADMIN_HOST) return next();
  if (req.path.startsWith('/api/')) return next();
  if (/\.(png|jpe?g|svg|gif|webp|ico|js|mjs|css|json|txt|map|xml|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|pdf|webmanifest)$/i.test(req.path)) {
    return next(); // a missing real asset → let it 404 normally
  }
  res.set('Cache-Control', 'no-cache, must-revalidate'); // always revalidate the app shell
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ═══════════════════════════════════════════════
   BOOT  —  init DB then listen
═══════════════════════════════════════════════ */
db.init()
  .catch((err) => console.error('Database init failed:', err.message))
  .then(() => loadSiteLock().catch(() => {}))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
    });
  });
