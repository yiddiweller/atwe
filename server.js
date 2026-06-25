require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const billing = require('./billing');
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
    }
    res.json({ received: true });
  } catch (err) {
    console.error(err);
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
  } catch (e) { /* notifications are best-effort */ }
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
// Public shape of a stream for the group "live now" banner.
function liveStreamPublic(s) {
  return { id: s.id, title: s.title, startedAt: s.startedAt, viewers: s.viewers.size,
    user: { id: s.userId, name: s.name, username: s.username, avatar: s.avatar } };
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
    const id = 'live_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const stream = {
      id, userId: req.user.id, name: me.name, username: me.username, avatar: me.avatar || null,
      title: (req.body.title || '').trim().slice(0, 120), groupId, groupName,
      startedAt: Date.now(), viewers: new Set(),
    };
    liveStreams.set(id, stream);
    // Notify every group member that someone is live now.
    if (groupId) {
      const info = { kind: 'started', streamId: id, groupId, groupName, title: stream.title, startedAt: stream.startedAt,
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
    if (kind === 'leave') s.viewers.delete(req.user.id);
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
  const avatar = typeof req.body.avatar === 'string' ? req.body.avatar : null;
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
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, dob, verified, verify_requested_at, created_at, account_type, dm_connections_only, password_hash FROM users WHERE lower(email) = $1 OR lower(username) = $1',
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
      'SELECT id, name, email, plan, is_admin, email_verified, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, dob, verified, verify_requested_at, created_at, account_type, business_verify_status, dm_connections_only, otw_visibility, has_password FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
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
              COALESCE(uc.unread, 0)::int AS unread
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
    const { rows } = await db.query('SELECT chat_pins, chat_archived, chat_muted, chat_mute_until, chat_unread_only FROM users WHERE id = $1', [req.user.id]);
    const r = rows[0] || {};
    res.json({
      pins: Array.isArray(r.chat_pins) ? r.chat_pins : [],
      archived: Array.isArray(r.chat_archived) ? r.chat_archived : [],
      muted: Array.isArray(r.chat_muted) ? r.chat_muted : [],
      muteUntil: (r.chat_mute_until && typeof r.chat_mute_until === 'object' && !Array.isArray(r.chat_mute_until)) ? r.chat_mute_until : {},
      unreadOnly: !!r.chat_unread_only,
    });
  } catch (err) {
    console.error(err);
    res.json({ pins: [], archived: [], muted: [], muteUntil: {}, unreadOnly: false });
  }
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
app.post('/api/atchat/with/:id/read', auth.requireAuth, async (req, res) => {
  const other = routeId(req.params.id);
  if (!Number.isInteger(other)) return res.status(400).json({ error: 'Invalid user id.' });
  try {
    const r = await db.query('UPDATE at_messages SET read_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL', [req.user.id, other]);
    if (r.rowCount) {
      rtPush(other, 'read', { peerId: req.user.id });          // tell the sender their messages were seen
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
    const { rows } = await db.query(
      `SELECT id, sender_id, body, image, media, media_kind, media_name, created_at, read_at, deleted_all, reply_to, edited, forwarded, meta, client_id,
              ($1 = ANY(hidden_for)) AS hidden, ($1 = ANY(starred_by)) AS starred, reactions FROM at_messages
       WHERE ((sender_id = $1 AND recipient_id = $2) OR (sender_id = $2 AND recipient_id = $1))
         AND created_at > COALESCE((SELECT cleared_at FROM at_cleared WHERE user_id = $1 AND other_id = $2), '-infinity'::timestamptz)
         AND NOT ($1 = ANY(deleted_for))
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at ASC`,
      [req.user.id, other]
    );
    // Only mark the messages we actually returned as read — avoids clearing the
    // unread badge for a message that arrived after this SELECT.
    const lastId = rows.length ? rows[rows.length - 1].id : 0;
    db.query(
      `UPDATE at_messages SET read_at = now()
       WHERE recipient_id = $1 AND sender_id = $2 AND read_at IS NULL AND id <= $3`,
      [req.user.id, other, lastId]
    ).then((r) => { if (r.rowCount) rtPush(other, 'read', { peerId: req.user.id }); }).catch(() => {});
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
      canMessage, request, incomingRequest, connectGated,
      disappearing: await dmDisappearSeconds(req.user.id, other),
      messages: rows.map((m) => ({
        id: m.id, body: m.body, image: m.image || null,
        media: m.media || null, media_kind: m.media_kind || null, media_name: m.media_name || null,
        created_at: m.created_at, mine: m.sender_id === req.user.id, read_at: m.read_at || null, clientId: m.client_id || null,
        deleted: !!m.deleted_all, hidden: !!m.hidden, starred: !!m.starred, reactions: m.reactions || {},
        reply_to: m.reply_to || null, edited: !!m.edited, forwarded: !!m.forwarded, meta: m.meta || null,
      })),
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
  const image = cleanImage(req.body.image);
  if (image === undefined) return res.status(400).json({ error: 'That image could not be attached.' });
  const media = mediaFromBody(req.body);
  if (media === undefined) return res.status(400).json({ error: 'That file could not be attached (unsupported type or too large — 16 MB max).' });
  const meta = cleanMeta(req.body.meta);
  if (meta === undefined) return res.status(400).json({ error: 'That couldn’t be attached.' });
  const replyTo = Number.isInteger(req.body.replyTo) ? req.body.replyTo : null;
  const clientId = (typeof req.body.clientId === 'string' && req.body.clientId.length <= 64) ? req.body.clientId : null;
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
    // Idempotent insert: a resend with the same clientId hits the unique
    // (sender_id, client_id) index and inserts nothing; we then return the
    // original row (and skip re-delivery) so a retry never duplicates a message.
    const COLS = 'id, body, image, media, media_kind, media_name, created_at, reply_to, forwarded, meta';
    // Disappearing-messages timer (if the conversation has one on).
    const dsec = await dmDisappearSeconds(req.user.id, other);
    const ins = await db.query(
      `INSERT INTO at_messages (sender_id, recipient_id, body, image, media, media_kind, media_name, reply_to, forwarded, meta, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${dsec ? `now() + interval '${dsec} seconds'` : 'NULL'})
       ON CONFLICT (sender_id, client_id) DO NOTHING RETURNING ${COLS}`,
      [req.user.id, other, body, image, media.data, media.kind, media.name, replyTo, !!req.body.forwarded, meta ? JSON.stringify(meta) : null, clientId]
    );
    let r = ins.rows[0];
    const isNew = !!r;
    if (!r) { // conflict (duplicate resend) — return the message we already stored
      const ex = await db.query(`SELECT ${COLS} FROM at_messages WHERE sender_id = $1 AND client_id = $2`, [req.user.id, clientId]);
      r = ex.rows[0];
      if (!r) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    const msg = { id: r.id, body: r.body, image: r.image || null, media: r.media || null, media_kind: r.media_kind || null, media_name: r.media_name || null, created_at: r.created_at, reply_to: r.reply_to || null, forwarded: !!r.forwarded, meta: r.meta || null };
    if (isNew) {
      // Replying to someone who had a pending request to me accepts it (X-style).
      db.query("UPDATE chat_requests SET status = 'accepted', updated_at = now() WHERE requester_id = $1 AND recipient_id = $2 AND status = 'pending' RETURNING id", [other, req.user.id])
        .then((u) => { if (u.rowCount) return db.query('INSERT INTO contact_allow (owner_id, allowed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, other]); })
        .catch(() => {});
      // Live-deliver to the recipient (their copy is not "mine").
      rtPush(other, 'msg', { kind: 'dm', peerId: req.user.id, message: { ...msg, mine: false } });
      notify(other, req.user.id, 'message', null);
    }
    res.json({ message: { ...msg, mine: true } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
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
      `SELECT m.id, m.body, m.image, m.media, m.media_kind, m.media_name, m.created_at, m.sender_id, m.forwarded, m.meta, m.client_id,
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
        starred: !!m.starred,
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
  const image = cleanImage(req.body.image);
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
    const GCOLS = 'id, body, image, media, media_kind, media_name, created_at, forwarded, meta';
    const gdis = await db.query('SELECT disappearing FROM at_groups WHERE id = $1', [gid]);
    const gsec = (gdis.rows[0] && gdis.rows[0].disappearing) || 0;
    const ins = await db.query(
      `INSERT INTO at_group_messages (group_id, sender_id, body, image, media, media_kind, media_name, forwarded, meta, client_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${gsec ? `now() + interval '${gsec} seconds'` : 'NULL'})
       ON CONFLICT (group_id, sender_id, client_id) DO NOTHING RETURNING ${GCOLS}`,
      [gid, req.user.id, body, image, media.data, media.kind, media.name, !!req.body.forwarded, meta ? JSON.stringify(meta) : null, clientId]
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

/* ═══════════════════════════════════════════════
   SOCIAL  —  follow + public posts (AtChat)
   Requires a @username. Posts are public on a user's profile.
═══════════════════════════════════════════════ */
const POSTS_SELECT = `
  SELECT p.id, p.body, p.image, p.media, p.media_kind, p.created_at, p.parent_id, p.location, p.reply_scope,
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
  return {
    id: r.id, body: r.body, image: r.image || null,
    media: r.media || null, mediaKind: r.media_kind || null, created_at: r.created_at,
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
    const u = await db.query('SELECT id, name, username, avatar, banner, bio, location, website, contact_email, phone, note, headline, socials, verified, categories, account_type, business_verify_status, otw_visibility FROM users WHERE lower(username) = lower($1)', [handle]);
    if (!u.rows[0]) return res.status(404).json({ error: 'User not found.' });
    const t = u.rows[0];
    const [counts, posts, exps, skills] = await Promise.all([
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
        `SELECT s.id, s.name,
                (SELECT COUNT(*)::int FROM skill_endorsements e WHERE e.skill_id = s.id) AS endorsements,
                EXISTS(SELECT 1 FROM skill_endorsements e WHERE e.skill_id = s.id AND e.endorser_id = $2) AS endorsed
         FROM user_skills s WHERE s.user_id = $1
         ORDER BY endorsements DESC, s.id`,
        [t.id, req.user.id]
      ),
    ]);
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
      businessJobs, businessPeople, mutualConnections,
      user: { id: t.id, name: t.name, username: t.username, avatar: t.avatar || null, banner: t.banner || null, bio: t.bio || null, location: t.location || null, website: t.website || null, contactEmail: t.contact_email || null, phone: t.phone || null, note: t.note || null, headline: t.headline || null, socials: (t.socials && typeof t.socials === 'object' && !Array.isArray(t.socials)) ? t.socials : {}, verified: !!t.verified, categories: Array.isArray(t.categories) ? t.categories : [], accountType: t.account_type === 'business' ? 'business' : 'personal', businessVerified: t.business_verify_status === 'verified', businessVerifyStatus: ['pending','verified'].includes(t.business_verify_status) ? t.business_verify_status : 'none', openToWork: t.otw_visibility === 'everyone' },
      experiences: exps.rows.map((e) => ({ id: e.id, title: e.title, company: e.company || e.company_user_name || null, companyUserId: e.company_user_id || null, companyUserUsername: e.company_user_username || null, startYear: e.start_year || null, endYear: e.end_year || null })),
      skills: skills.rows.map((s) => ({ id: s.id, name: s.name, endorsements: s.endorsements, endorsed: !!s.endorsed })),
      counts: { followers: counts.rows[0].followers, following: counts.rows[0].following, posts: counts.rows[0].posts, connections: counts.rows[0].connections },
      connectionState: (t.id === req.user.id) ? 'self'
        : counts.rows[0].conn_status === 'accepted' ? 'connected'
        : counts.rows[0].conn_status === 'pending' ? (counts.rows[0].conn_requester === req.user.id ? 'pending_out' : 'pending_in')
        : 'none',
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
      : `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now()`) + notBlocked;
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
    res.json({ posts: rows.map(mapPost) });
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
  const image = cleanImage(req.body.image);
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
    const ins = await db.query(
      `INSERT INTO posts (user_id, body, image, media, media_kind, parent_id, to_main, location, created_at, scheduled_at, quote_id, reply_scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), $9, $10, $11) RETURNING id`,
      [req.user.id, body, image, media.data, media.kind, parentId, toMain, location, scheduledAt, quoteId, replyScope]
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
app.post('/api/social/posts/:id/bookmark', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    const exists = await db.query('SELECT 1 FROM posts WHERE id = $1', [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Post not found.' });
    await db.query('INSERT INTO post_bookmarks (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.json({ ok: true, bookmarked: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
app.delete('/api/social/posts/:id/bookmark', auth.requireAuth, async (req, res) => {
  const id = routeId(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid post id.' });
  try {
    await db.query('DELETE FROM post_bookmarks WHERE post_id = $1 AND user_id = $2', [id, req.user.id]);
    res.json({ ok: true, bookmarked: false });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
});
// My bookmarks (newest saved first).
app.get('/api/social/bookmarks', auth.requireAuth, async (req, res) => {
  try {
    if (!(await requireHandle(req, res))) return;
    const { rows } = await db.query(
      POSTS_SELECT + `JOIN post_bookmarks bk ON bk.post_id = p.id AND bk.user_id = $1
       WHERE p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $1)
       ORDER BY bk.created_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ posts: rows.map(mapPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
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
    res.json({ tag, posts: rows.map(mapPost) });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Something went wrong. Please try again.' }); }
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
app.get('/api/search', auth.requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim().replace(/^@/, '');
  const scope = req.query.scope || '';
  if (!q) return res.json({});
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  const me = req.user.id;
  try {
    if (!(await requireHandle(req, res))) return;
    if (scope === 'posts') {
      const r = await db.query(
        POSTS_SELECT + `WHERE p.parent_id IS NULL AND p.to_main = true AND p.created_at <= now() AND p.body ILIKE $2 ORDER BY p.created_at DESC LIMIT 30`,
        [me, like]
      );
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
    // Default ('all'): people + posts.
    const [users, posts] = await Promise.all([
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
    ]);
    res.json({
      users: users.rows.map(mapSearchUser),
      posts: posts.rows.map(mapPost),
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
