require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const db = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
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

app.get('/api/test', async (_req, res) => {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    res.json({ status: 'ok', reply: msg.content[0].text });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
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
  };
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
      `INSERT INTO users (name, email, password_hash, is_admin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, plan, is_admin`,
      [name, email, hash, isAdmin]
    );

    const user = rows[0];
    res.status(201).json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
      'SELECT id, name, email, plan, is_admin, password_hash FROM users WHERE lower(email) = $1',
      [email]
    );
    const user = rows[0];
    if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    res.json({ token: auth.signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refresh the client's view of the account (plan/admin may change server-side).
app.get('/api/auth/me', auth.requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, email, plan, is_admin FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Account not found.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/chats', auth.requireAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM chats WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════
   PLAN  —  authoritative, server-side
═══════════════════════════════════════════════ */
app.put('/api/plan', auth.requireAuth, async (req, res) => {
  const plan = req.body.plan === 'pro' ? 'pro' : 'free';
  try {
    await db.query('UPDATE users SET plan = $1 WHERE id = $2', [plan, req.user.id]);
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════
   ADMIN  —  /api/admin/* (requires is_admin)
═══════════════════════════════════════════════ */
app.get('/api/admin/users', auth.requireAdmin, async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.plan, u.is_admin, u.created_at,
             COUNT(c.id)::int AS chat_count
      FROM users u
      LEFT JOIN chats c ON c.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
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
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', auth.requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.user.id === id) {
    return res.status(400).json({ error: 'You cannot delete your own account here.' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.json({ content: msg.content[0].text, usage: msg.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
