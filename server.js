require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const auth = require('./auth');
const mailer = require('./mailer');
const billing = require('./billing');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_HOST = process.env.ADMIN_HOST || 'admin.atwe.ai';

// Honour X-Forwarded-* (Railway terminates TLS at its proxy) so req.hostname
// and req.protocol reflect the real client-facing host.
app.set('trust proxy', true);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = parseInt(s.metadata?.user_id || s.client_reference_id, 10);
      const customerId = typeof s.customer === 'string' ? s.customer : s.customer?.id || null;
      if (userId) {
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

app.use(express.json({ limit: '4mb' }));

// On the admin subdomain (admin.atwe.ai), the dashboard is the homepage.
app.use((req, res, next) => {
  if (req.hostname === ADMIN_HOST && (req.path === '/' || req.path === '/index.html')) {
    return res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

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

// Public feature flags so the frontend can adapt its UI.
app.get('/api/config', (_req, res) => {
  res.json({
    billingEnabled: billing.isConfigured(),
    emailEnabled: mailer.isConfigured(),
  });
});

// Help-center contact form. Saves to the DB (if configured) and emails the
// owner so they can follow up. Works for guests and signed-in users.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'atwe@atwe.ai';
app.post('/api/contact', auth.optionalAuth, async (req, res) => {
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
  }

  // Notify the owner (best-effort). reply-to is set to the sender's address.
  try {
    await mailer.sendMail({
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `New Atwe support message from ${email}`,
      text: `From: ${email}\n${req.user ? `Account: #${req.user.id}\n` : ''}\n${message}`,
      html: `<p><strong>From:</strong> ${email}</p>${req.user ? `<p><strong>Account:</strong> #${req.user.id}</p>` : ''}<p>${message.replace(/</g, '&lt;')}</p>`,
    });
  } catch (err) {
    console.error('Support email failed:', err.message);
  }

  // Succeed if we either stored it or emailed it; otherwise report failure.
  if (!saved && !mailer.isConfigured()) {
    return res.status(503).json({ error: 'Support is temporarily unavailable. Please email atwe@atwe.ai directly.' });
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
function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    is_admin: row.is_admin,
    email_verified: row.email_verified,
  };
}

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

async function sendVerifyEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?verify=${rawToken}`;
  await mailer.sendMail({
    to: user.email,
    subject: 'Verify your Atwe AI email',
    text: `Welcome to Atwe AI! Confirm your email address: ${link}`,
    html: `<p>Welcome to Atwe AI!</p><p><a href="${link}">Confirm your email address</a></p>`,
  });
}

async function sendResetEmail(user, rawToken) {
  const link = `${mailer.appUrl()}/?reset=${rawToken}`;
  await mailer.sendMail({
    to: user.email,
    subject: 'Reset your Atwe AI password',
    text: `Reset your Atwe AI password: ${link} (link expires in 1 hour)`,
    html: `<p><a href="${link}">Reset your Atwe AI password</a></p><p>This link expires in 1 hour.</p>`,
  });
}

async function sendWelcomeEmail(user) {
  const link = mailer.appUrl();
  await mailer.sendMail({
    to: user.email,
    subject: 'Welcome to Atwe AI',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `Welcome to Atwe AI — your intelligent assistant for business.\n\n` +
      `Start your first conversation any time: ${link}\n\n` +
      `— The Atwe AI team`,
    html:
      `<p>Hi ${user.name || 'there'},</p>` +
      `<p>Welcome to <strong>Atwe AI</strong> — your intelligent assistant for business.</p>` +
      `<p><a href="${link}">Open Atwe AI</a> to start your first conversation.</p>` +
      `<p>— The Atwe AI team</p>`,
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
      `— The Atwe AI team`,
    html:
      `<p>Hi ${user.name || 'there'},</p>` +
      `<p>Your upgrade to <strong>Atwe Pro</strong> is complete — thank you!</p>` +
      `<p>You now have access to longer, more in-depth responses and priority performance.</p>` +
      `<p><a href="${link}">Open Atwe AI</a> to pick up where you left off.</p>` +
      `<p>— The Atwe AI team</p>`,
  });
}

app.post('/api/auth/signup', async (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const exists = await db.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (exists.rowCount) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const isAdmin = !!process.env.ADMIN_EMAIL &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase();
    const hash = await auth.hashPassword(password);

    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, is_admin, email_verified, last_login_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id, name, email, plan, is_admin, email_verified`,
      [name, email, hash, isAdmin, isAdmin]
    );

    const user = rows[0];

    // Fire a verification email (best-effort; never blocks signup).
    if (!user.email_verified) {
      try {
        const raw = await issueToken(user.id, 'verify', 24 * 60 * 60 * 1000);
        await sendVerifyEmail(user, raw);
      } catch (e) {
        console.error('Verification email failed:', e.message);
      }
    }

    // Send a warm welcome on first sign-up (best-effort; never blocks signup).
    try {
      await sendWelcomeEmail(user);
    } catch (e) {
      console.error('Welcome email failed:', e.message);
    }

    res.status(201).json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified, password_hash FROM users WHERE lower(email) = $1',
      [email]
    );
    const user = rows[0];
    if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email address before signing in.' });
    }
    // Record the sign-in so the admin dashboard can show login activity.
    db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]).catch(() => {});
    res.json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Refresh the client's view of the account (plan/admin may change server-side).
app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin, email_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Update the signed-in user's display name.
app.put('/api/auth/profile', auth.requireAuth, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 80) return res.status(400).json({ error: 'Name is too long.' });
  try {
    const { rows } = await db.query(
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, plan, is_admin, email_verified',
      [name, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Confirm an email address from the link in the verification email.
app.post('/api/auth/verify', async (req, res) => {
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
app.post('/api/auth/forgot', async (req, res) => {
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
app.post('/api/auth/reset', async (req, res) => {
  const password = req.body.password || '';
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const userId = await consumeToken(req.body.token, 'reset');
    if (!userId) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    const hash = await auth.hashPassword(password);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
    // Invalidate any other outstanding reset tokens for this user.
    await db.query(`DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'reset'`, [userId]);
    res.json({ ok: true });
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
             u.created_at, u.last_login_at,
             COUNT(c.id)::int AS chat_count,
             MAX(c.updated_at) AS last_chat_at
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
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(id);
  try {
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${values.length}
       RETURNING id, name, email, plan, is_admin`,
      values
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(rows[0]) });
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

/* ═══════════════════════════════════════════════
   CHAT  —  the actual Claude call
   Plan is taken from the authenticated user (authoritative);
   guests (no token) fall back to the client-sent plan, local-only.
═══════════════════════════════════════════════ */
app.post('/api/chat', auth.optionalAuth, async (req, res) => {
  const { messages, plan: clientPlan } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' });
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
        'You are Atwe AI, an intelligent assistant built for modern businesses. Provide clear, actionable, insightful responses. Be professional yet conversational, thorough yet concise. Format responses with markdown when helpful — use **bold**, `code`, bullet lists, and headers where appropriate.',
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
   BOOT  —  init DB then listen
═══════════════════════════════════════════════ */
db.init()
  .catch((err) => console.error('Database init failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`\n🚀  Atwe server → http://localhost:${PORT}\n`);
    });
  });
